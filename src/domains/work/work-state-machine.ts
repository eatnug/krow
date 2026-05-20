import type { WorkAction } from "./work-action.js";
import { plannedTasksToState } from "./task-graph.js";
import type { WorkWorkflowState, WorkflowPhase, PendingPayloadKind } from "./workflow-state.js";
import {
  validateAnswerPayload,
  validateImplementOutput,
  validatePlanOutput,
  validateReviewOutput,
  type LanguageUpdateProposal,
  type ImplementOutput,
  type PlanOutput,
  type ReviewOutput,
} from "./work-output-contracts.js";

const PLAN_REVIEW_QUESTION_ID = "plan-review";

export interface StateMachineResult {
  state?: WorkWorkflowState;
  fault?: WorkAction;
}

function nowIso(): string {
  return new Date().toISOString();
}

function outputPath(state: WorkWorkflowState, kind: PendingPayloadKind): string {
  const nextIndex = state.outputs.filter((output) => output.kind === kind).length + 1;
  return `${state.refs.artifact_root}/${kind}-${String(nextIndex).padStart(2, "0")}.json`;
}

function withRun(state: WorkWorkflowState, phase: WorkflowPhase, expects: Exclude<PendingPayloadKind, "answers">): WorkWorkflowState {
  return {
    ...state,
    status: "running",
    phase,
    pending_questions: [],
    current: {
      type: "run",
      phase,
      expects,
      output_path: outputPath(state, expects),
    },
    updated_at: nowIso(),
  };
}

function withAsk(state: WorkWorkflowState, questions: PlanOutput["questions"], phase: WorkflowPhase): WorkWorkflowState {
  return {
    ...state,
    status: "waiting",
    phase,
    pending_questions: questions ?? [],
    current: {
      type: "ask",
      phase,
      expects: "answers",
      output_path: outputPath(state, "answers"),
    },
    updated_at: nowIso(),
  };
}

function languageApprovalQuestions(updates: LanguageUpdateProposal[]): PlanOutput["questions"] {
  return updates.map((update, index) => ({
    id: `language-update-${index + 1}`,
    question: `Approve durable ${update.kind} update "${update.title ?? update.target ?? update.summary}"?`,
    context: [
      update.summary,
      ...(update.evidence?.length ? [`Evidence: ${update.evidence.join(", ")}`] : []),
      ...(update.refs?.length ? [`Refs: ${update.refs.join(", ")}`] : []),
    ].join("\n"),
    options: ["approve", "reject"],
  }));
}

function approvalAnswerAccepted(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/^(reject|rejected|no|n|skip|decline|denied|deny|거절|아니|ㄴㄴ)/.test(normalized)) {
    return false;
  }
  return /^(approve|approved|yes|y|ok|accept|accepted|승인|네|예|ㅇㅇ|좋아)/.test(normalized);
}

function languageReviewLines(output: PlanOutput): string[] {
  const language = output.language;
  if (!language) {
    return ["Project language: (not provided)"];
  }

  const termLine = (term: { term: string; meaning: string; evidence?: string[] }): string => {
    const evidence = term.evidence?.length ? ` Evidence: ${term.evidence.join(", ")}` : "";
    return `  - ${term.term}: ${term.meaning}${evidence}`;
  };

  const lines = ["Project language:"];
  if (language.approved_terms?.length) {
    lines.push(`- Approved terms used: ${language.approved_terms.join(", ")}`);
  }
  if (language.proposed_terms?.length) {
    lines.push("- Proposed terms:");
    language.proposed_terms.forEach((term) => {
      lines.push(termLine(term));
    });
  }
  if (language.unresolved_terms?.length) {
    lines.push("- Unresolved terms:");
    language.unresolved_terms.forEach((term) => {
      lines.push(termLine(term));
    });
  }
  if (language.notes?.length) {
    lines.push(...language.notes.map((note) => `- ${note}`));
  }
  return lines;
}

function planReviewQuestion(output: PlanOutput, state: WorkWorkflowState): NonNullable<PlanOutput["questions"]> {
  const taskIds = (output.tasks ?? []).map((task) => task.id).join(", ") || "(single work item)";
  const gaps = state.language_context?.gaps ?? [];
  return [{
    id: PLAN_REVIEW_QUESTION_ID,
    question: "Review and approve the planned project language, scope, and acceptance criteria before implementation.",
    context: [
      `Summary: ${output.summary}`,
      ...(gaps.length ? [`Language context gaps: ${gaps.join("; ")}`] : []),
      ...languageReviewLines(output),
      `Tasks: ${taskIds}`,
      `Goal: ${output.docs.goal ?? "(not provided)"}`,
      `Spec: ${output.docs.spec ?? "(not provided)"}`,
      `Plan: ${output.docs.plan ?? "(not provided)"}`,
      "Answer approve only if the project language, scope, acceptance criteria, and implementation direction are correct. Otherwise describe the revisions needed before implementation.",
    ].join("\n"),
    options: ["approve", "revise"],
  }];
}

function isPlanReviewAsk(state: WorkWorkflowState): boolean {
  const questions = state.pending_questions ?? [];
  return questions.length === 1 && questions[0]?.id === PLAN_REVIEW_QUESTION_ID;
}

function planReviewAccepted(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/\b(?:but|except|revise|change|adjust|modify|instead)\b/.test(normalized)) {
    return false;
  }
  if (/(수정|변경|바꿔|다만|근데|하지만|대신|추가)/.test(value)) {
    return false;
  }
  return approvalAnswerAccepted(value);
}

function readyPlanLanguageIssues(output: PlanOutput): string[] {
  if (!output.ready || (output.questions?.length ?? 0) > 0) {
    return [];
  }

  if (!output.language) {
    return ["plan_output.language is required before ready so the user can review project language before implementation"];
  }

  const languageItemCount =
    (output.language.approved_terms?.length ?? 0) +
    (output.language.proposed_terms?.length ?? 0) +
    (output.language.unresolved_terms?.length ?? 0) +
    (output.language.notes?.length ?? 0);

  if (languageItemCount === 0) {
    return ["plan_output.language must include approved terms, proposed terms, unresolved terms, or notes before ready"];
  }
  if ((output.language.unresolved_terms?.length ?? 0) > 0) {
    return ["ready plan_output cannot include unresolved language terms; ask questions or convert them into proposed terms for user review"];
  }
  return [];
}

function approvedLanguageUpdatesFromAnswers(
  updates: LanguageUpdateProposal[] | undefined,
  answers: { question_id: string; answer: string }[],
): LanguageUpdateProposal[] {
  return (updates ?? []).filter((_, index) => {
    const answer = answers.find((item) => item.question_id === `language-update-${index + 1}`);
    return answer ? approvalAnswerAccepted(answer.answer) : false;
  });
}

function recordOutput(state: WorkWorkflowState, kind: PendingPayloadKind, path: string): WorkWorkflowState {
  return {
    ...state,
    outputs: [
      ...state.outputs,
      {
        kind,
        path,
        created_at: nowIso(),
      },
    ],
    updated_at: nowIso(),
  };
}

function completedState(state: WorkWorkflowState, output: ReviewOutput): WorkWorkflowState {
  return {
    ...state,
    status: "completed",
    phase: "review",
    current: undefined,
    pending_questions: [],
    risks: output.issues ?? [],
    updated_at: nowIso(),
  };
}

function completedAfterLanguageApproval(state: WorkWorkflowState): WorkWorkflowState {
  return {
    ...state,
    status: "completed",
    phase: "review",
    current: undefined,
    pending_questions: [],
    pending_language_updates: [],
    risks: state.pending_review_result?.issues ?? state.risks ?? [],
    updated_at: nowIso(),
  };
}

function blockedState(state: WorkWorkflowState, reason: string, risks?: string[]): WorkWorkflowState {
  return {
    ...state,
    status: "blocked",
    current: undefined,
    pending_questions: [],
    blocked_reason: reason,
    risks,
    updated_at: nowIso(),
  };
}

function pendingActionMismatch(state: WorkWorkflowState, actual: PendingPayloadKind): StateMachineResult {
  return {
    fault: faultAction(
      state.workflow_id,
      "submitted payload does not match the current workflow action",
      [`expected ${state.current?.expects ?? "(none)"}`, `received ${actual}`],
      true,
    ),
  };
}

function faultAction(
  workflowId: string,
  error: string,
  issues: string[],
  recoverable: boolean,
): WorkAction {
  return {
    type: "fault",
    workflow_id: workflowId,
    error,
    issues,
    recoverable,
  };
}

function nextAfterPlan(state: WorkWorkflowState, output: PlanOutput): WorkWorkflowState {
  if ((output.questions?.length ?? 0) > 0 || !output.ready) {
    return withAsk(state, output.questions ?? [], "plan");
  }
  return withAsk(
    {
      ...state,
      tasks: plannedTasksToState(output.tasks),
    },
    planReviewQuestion(output, state),
    "plan",
  );
}

function nextAfterImplement(state: WorkWorkflowState, output: ImplementOutput): WorkWorkflowState {
  if ((output.questions?.length ?? 0) > 0) {
    return withAsk(state, output.questions, "implement");
  }
  return withRun(state, "review", "review_output");
}

function nextAfterReview(state: WorkWorkflowState, output: ReviewOutput): WorkWorkflowState {
  if ((output.questions?.length ?? 0) > 0) {
    return withAsk(state, output.questions, "review");
  }
  if (output.passed && (output.language_updates?.length ?? 0) > 0) {
    return withAsk(
      {
        ...state,
        pending_language_updates: output.language_updates,
        pending_review_result: {
          passed: output.passed,
          summary: output.summary,
          evidence: output.evidence,
          issues: output.issues,
        },
      },
      languageApprovalQuestions(output.language_updates ?? []),
      "review",
    );
  }
  if (output.passed) {
    return completedState(state, output);
  }
  if ((output.issues?.length ?? 0) === 0) {
    return blockedState(state, output.summary, ["review failed without actionable issues"]);
  }
  return withRun(
    {
      ...state,
      risks: output.issues ?? [],
    },
    "implement",
    "implement_output",
  );
}

export function submitWorkPayload(state: WorkWorkflowState, payload: unknown): StateMachineResult {
  if (!state.current) {
    return {
      fault: faultAction(state.workflow_id, "workflow has no pending action", [], false),
    };
  }

  switch (state.current.expects) {
    case "plan_output": {
      const validation = validatePlanOutput(payload);
      if (!validation.ok || !validation.value) {
        return { fault: faultAction(state.workflow_id, "invalid plan_output", validation.issues, true) };
      }
      if (!validation.value.ready && (validation.value.questions?.length ?? 0) === 0) {
        return {
          fault: faultAction(
            state.workflow_id,
            "plan_output is not ready and did not include questions",
            ["provide questions that explain the missing product, language, scope, or verification decision"],
            true,
          ),
        };
      }
      const languageIssues = readyPlanLanguageIssues(validation.value);
      if (languageIssues.length > 0) {
        return {
          fault: faultAction(
            state.workflow_id,
            "ready plan_output did not include project language review",
            languageIssues,
            true,
          ),
        };
      }
      const recorded = recordOutput(state, "plan_output", state.current.output_path);
      return { state: nextAfterPlan(recorded, validation.value) };
    }
    case "implement_output": {
      const validation = validateImplementOutput(payload);
      if (!validation.ok || !validation.value) {
        return { fault: faultAction(state.workflow_id, "invalid implement_output", validation.issues, true) };
      }
      const recorded = recordOutput(state, "implement_output", state.current.output_path);
      return { state: nextAfterImplement(recorded, validation.value) };
    }
    case "review_output": {
      const validation = validateReviewOutput(payload);
      if (!validation.ok || !validation.value) {
        return { fault: faultAction(state.workflow_id, "invalid review_output", validation.issues, true) };
      }
      const recorded = recordOutput(state, "review_output", state.current.output_path);
      return { state: nextAfterReview(recorded, validation.value) };
    }
    case "answers": {
      const validation = validateAnswerPayload(payload);
      if (!validation.ok || !validation.value) {
        return { fault: faultAction(state.workflow_id, "invalid answers", validation.issues, true) };
      }
      const expectedIds = (state.pending_questions ?? []).map((question) => question.id);
      const receivedIds = validation.value.answers.map((answer) => answer.question_id);
      const missing = expectedIds.filter((id) => !receivedIds.includes(id));
      const unknown = receivedIds.filter((id) => !expectedIds.includes(id));
      if (missing.length > 0 || unknown.length > 0) {
        return {
          fault: faultAction(
            state.workflow_id,
            "answers did not match the pending questions",
            [
              ...(missing.length > 0 ? [`missing questions: ${missing.join(", ")}`] : []),
              ...(unknown.length > 0 ? [`unknown questions: ${unknown.join(", ")}`] : []),
            ],
            true,
          ),
        };
      }
      const recorded = recordOutput(
        {
          ...state,
          answers: [...(state.answers ?? []), ...validation.value.answers],
        },
        "answers",
        state.current.output_path,
      );
      if (state.phase === "plan" && isPlanReviewAsk(state)) {
        const answer = validation.value.answers.find((item) => item.question_id === PLAN_REVIEW_QUESTION_ID);
        if (answer && planReviewAccepted(answer.answer)) {
          return { state: withRun(recorded, "implement", "implement_output") };
        }
        return {
          state: withRun(
            {
              ...recorded,
              tasks: [],
            },
            "plan",
            "plan_output",
          ),
        };
      }
      if (
        state.phase === "review" &&
        state.pending_review_result?.passed &&
        (state.pending_language_updates?.length ?? 0) > 0
      ) {
        return {
          state: completedAfterLanguageApproval({
            ...recorded,
            approved_language_updates: approvedLanguageUpdatesFromAnswers(
              state.pending_language_updates,
              validation.value.answers,
            ),
          }),
        };
      }
      const nextKind =
        state.phase === "implement"
          ? "implement_output"
          : state.phase === "review"
            ? "review_output"
            : "plan_output";
      return { state: withRun(recorded, state.phase, nextKind) };
    }
    default:
      return pendingActionMismatch(state, state.current.expects);
  }
}

export function stopWorkState(state: WorkWorkflowState, reason = "workflow stopped"): WorkWorkflowState {
  return {
    ...state,
    status: "stopped",
    current: undefined,
    pending_questions: [],
    blocked_reason: reason,
    updated_at: nowIso(),
  };
}
