import type { WorkAction } from "./work-action.js";
import { plannedTasksToState } from "./task-graph.js";
import type { WorkWorkflowState, WorkflowPhase, PendingPayloadKind } from "./workflow-state.js";
import {
  validateAnswerPayload,
  validateImplementOutput,
  validatePlanOutput,
  validateReviewOutput,
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
    lines.push(`- Terms used in the plan: ${language.approved_terms.join(", ")}`);
  }
  if (language.updated_refs?.length) {
    lines.push(`- Updated language refs: ${language.updated_refs.join(", ")}`);
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

function clarificationReviewLines(output: PlanOutput): string[] {
  const clarification = output.clarification;
  if (!clarification) {
    return ["Clarification review: (not provided)"];
  }

  const lines = ["Clarification review:"];
  if (clarification.confirmed_requirements?.length) {
    lines.push("- Confirmed requirements:");
    lines.push(...clarification.confirmed_requirements.map((item) => `  - ${item}`));
  }
  if (clarification.confirmed_language?.length) {
    lines.push("- Confirmed language:");
    lines.push(...clarification.confirmed_language.map((item) => `  - ${item}`));
  }
  if (clarification.documents?.length) {
    lines.push("- Document agreement:");
    clarification.documents.forEach((doc) => {
      lines.push(`  - ${doc.doc}: ${doc.ref}`);
      if (doc.confirmed_by?.length) {
        lines.push(`    Confirmed by: ${doc.confirmed_by.join("; ")}`);
      }
      if (doc.open_questions?.length) {
        lines.push(`    Open questions: ${doc.open_questions.join("; ")}`);
      }
      if (doc.missing_premises?.length) {
        lines.push(`    Missing premises: ${doc.missing_premises.join("; ")}`);
      }
    });
  }
  if (clarification.open_questions?.length) {
    lines.push("- Open questions:");
    lines.push(...clarification.open_questions.map((item) => `  - ${item}`));
  }
  if (clarification.missing_premises?.length) {
    lines.push("- Missing premises:");
    lines.push(...clarification.missing_premises.map((item) => `  - ${item}`));
  }
  if (clarification.notes?.length) {
    lines.push(...clarification.notes.map((note) => `- ${note}`));
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
      ...clarificationReviewLines(output),
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
    (output.language.updated_refs?.length ?? 0) +
    (output.language.unresolved_terms?.length ?? 0) +
    (output.language.notes?.length ?? 0);

  if (languageItemCount === 0) {
    return ["plan_output.language must include approved terms, updated refs, unresolved terms, or notes before ready"];
  }
  if ((output.language.unresolved_terms?.length ?? 0) > 0) {
    return ["ready plan_output cannot include unresolved language terms; ask questions or update the actual language docs for user review"];
  }
  return [];
}

function readyPlanClarificationIssues(output: PlanOutput): string[] {
  if (!output.ready || (output.questions?.length ?? 0) > 0) {
    return [];
  }

  if (!output.clarification) {
    return ["plan_output.clarification is required before ready so missing requirements, project language, and premises are explicit before implementation review"];
  }

  const clarificationItemCount =
    (output.clarification.confirmed_requirements?.length ?? 0) +
    (output.clarification.confirmed_language?.length ?? 0) +
    (output.clarification.notes?.length ?? 0);

  if (clarificationItemCount === 0) {
    return ["plan_output.clarification must include confirmed requirements, confirmed language, or notes before ready"];
  }

  const documents = output.clarification.documents ?? [];
  const documentsByKind = new Map(documents.map((doc) => [doc.doc, doc]));
  const requiredDocs: Array<"goal" | "spec" | "plan"> = ["goal", "spec", "plan"];
  const missingDocs = requiredDocs.filter((doc) => !documentsByKind.has(doc));
  const issues: string[] = [];
  if (missingDocs.length > 0) {
    issues.push(`plan_output.clarification.documents must include ${missingDocs.join(", ")} before ready`);
  }
  requiredDocs.forEach((doc) => {
    const review = documentsByKind.get(doc);
    if (!review) {
      return;
    }
    const expectedRef = output.docs[doc];
    if (expectedRef && review.ref !== expectedRef) {
      issues.push(`clarification.documents ${doc} ref must match docs.${doc}`);
    }
    if ((review.confirmed_by?.length ?? 0) === 0) {
      issues.push(`${doc}.md must state what confirms its language and requirements before ready`);
    }
    if ((review.open_questions?.length ?? 0) > 0) {
      issues.push(`${doc}.md has open questions; ask the user before ready`);
    }
    if ((review.missing_premises?.length ?? 0) > 0) {
      issues.push(`${doc}.md has missing premises; resolve them through questions or evidence before ready`);
    }
  });

  const openQuestions = output.clarification.open_questions ?? [];
  const missingPremises = output.clarification.missing_premises ?? [];
  if (openQuestions.length > 0) {
    issues.push("ready plan_output must ask unresolved clarification questions before implementation review");
  }
  if (missingPremises.length > 0) {
    issues.push("ready plan_output must resolve missing premises through questions or evidence before implementation review");
  }
  return issues;
}

function systemDocRefs(output: PlanOutput): string[] {
  return [
    ...(output.language?.updated_refs ?? []),
    ...(output.clarification?.documents ?? []).map((document) => document.ref),
  ].filter((ref) => /^\.krow\/system\/docs\/.+\.md$/.test(ref));
}

function readyPlanLanguageCompoundingIssues(output: PlanOutput, state: WorkWorkflowState): string[] {
  if (!output.ready || (output.questions?.length ?? 0) > 0) {
    return [];
  }

  const issues: string[] = [];
  const hasSystemDocRef = systemDocRefs(output).length > 0;
  const gaps = state.language_context?.gaps ?? [];
  const languageRefs = output.language?.updated_refs ?? [];
  const updatesGlossaryOrMap = languageRefs.some((ref) => ref === ".krow/system/glossary.md" || ref === ".krow/system/map.md");
  const hasNoSystemDocs = gaps.some((gap) => gap.includes("system docs has no"));

  if (hasNoSystemDocs && !hasSystemDocRef) {
    issues.push("ready plan_output must create or update a .krow/system/docs/*.md System Document when the Language System has no behavior or responsibility documents");
  }
  if (updatesGlossaryOrMap && !hasSystemDocRef) {
    issues.push("project language compounding cannot stop at glossary or map updates; include a .krow/system/docs/*.md System Document before ready");
  }
  return issues;
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
      const clarificationIssues = readyPlanClarificationIssues(validation.value);
      if (clarificationIssues.length > 0) {
        return {
          fault: faultAction(
            state.workflow_id,
            "ready plan_output did not include clarification review",
            clarificationIssues,
            true,
          ),
        };
      }
      const compoundingIssues = readyPlanLanguageCompoundingIssues(validation.value, state);
      if (compoundingIssues.length > 0) {
        return {
          fault: faultAction(
            state.workflow_id,
            "ready plan_output did not compound project language into system docs",
            compoundingIssues,
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
