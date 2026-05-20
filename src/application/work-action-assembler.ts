import { systemDocsPath, systemMapPath, glossaryPath } from "../outbound-adapters/filesystem/krow-paths.js";
import type { Question } from "../domains/work/questions.js";
import { readyTaskIds } from "../domains/work/task-graph.js";
import type { WorkAction, WorkOutputKind } from "../domains/work/work-action.js";
import type { WorkWorkflowState } from "../domains/work/workflow-state.js";

export interface WorkActionAssemblerOptions {
  submitCommandPrefix: string;
  rootDir?: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function submitCommand(prefix: string, workflowId: string, outputPath: string, rootDir?: string): string {
  const rootArg = rootDir ? ` --root ${shellQuote(rootDir)}` : "";
  return `${prefix} work submit ${workflowId} --input ${outputPath}${rootArg} --json`;
}

function commonContext(state: WorkWorkflowState): string[] {
  const taskRefs = (state.tasks ?? []).flatMap((task) => [
    `${state.refs.work_root}/tasks/${task.id}.md`,
  ]);
  return [...new Set([
    state.refs.state,
    `${state.refs.work_root}/index.md`,
    `${state.refs.work_root}/goal.md`,
    `${state.refs.work_root}/spec.md`,
    `${state.refs.work_root}/plan.md`,
    `${state.refs.work_root}/review.md`,
    ...((state.tasks?.length ?? 0) > 0 ? [`${state.refs.work_root}/tasks/index.md`, ...taskRefs] : []),
    ...(state.language_context?.refs ?? [glossaryPath(), systemMapPath(), systemDocsPath()]),
  ])];
}

function instructionFor(kind: WorkOutputKind, state: WorkWorkflowState): string {
  switch (kind) {
    case "plan_output":
      return [
        "Plan this work item before editing project files.",
        "Read the Work Docs and relevant Language System refs, inspect repository evidence as needed, then update goal.md, spec.md, and plan.md.",
        "Before depending on a drafted Goal, Spec, or Plan, resolve ambiguity that affects project language, requirements, scope, acceptance criteria, implementation direction, or verification.",
        "Express the request in the actual project language documents; when terms or map entries are missing, update the relevant Language System refs directly after the needed meaning is clear enough to draft for review.",
        "Ask questions when missing project language, product meaning, scope, acceptance criteria, approval, or technical choices affect implementation or verification.",
        "Classify requirements, project language, and Goal/Spec/Plan document wording as confirmed by the user request, prior answers, or repository evidence; represent remaining gaps as open questions or missing premises.",
        "Write plan_output JSON to the requested output path with ready, docs, summary, evidence, language, clarification, optional tasks, and optional questions.",
        "Before ready is true, update the actual docs and include plan_output.language as a review summary of terms used, document changes made, unresolved terms, or notes.",
        "A ready plan includes plan_output.clarification with confirmed requirements, confirmed language, and Goal/Spec/Plan document agreement; it carries no open questions or missing premises.",
        "A ready plan goes through user review of the changed docs for project language, scope, acceptance criteria, and implementation direction before implementation.",
      ].join(" ");
    case "implement_output":
      return [
        "Implement the planned work against the current Goal, Spec, Plan, Language System refs, and task docs when present.",
        `Ready task ids: ${readyTaskIds(state.tasks).join(", ") || "(single work item)"}.`,
        "Run ready tasks serially unless the agent runtime can run independent tasks in parallel with disjoint ownership or an explicit merge plan.",
        "Keep changes bounded to the planned scope, update code/tests/docs as needed, and run proportionate checks.",
        "Write implement_output JSON to the requested output path with summary, changed_files, evidence, and optional questions.",
      ].join(" ");
    case "review_output":
      return [
        "Review the implemented result against the Goal, Spec, Plan, and approved project language.",
        "Verify behavior with proportionate checks, record evidence and issues, and raise questions when language meaning needs user judgment.",
        "Write review_output JSON to the requested output path with passed, summary, evidence, issues, and optional questions.",
      ].join(" ");
  }
}

export function actionFromState(
  state: WorkWorkflowState,
  options: WorkActionAssemblerOptions,
): WorkAction {
  if (state.status === "completed" || state.status === "blocked" || state.status === "stopped") {
    return {
      type: "done",
      workflow_id: state.workflow_id,
      status: state.status,
      summary:
        state.status === "blocked"
          ? state.blocked_reason ?? "workflow blocked"
          : state.status === "stopped"
            ? state.blocked_reason ?? "workflow stopped"
            : "workflow completed",
      refs: [state.refs.work_root, state.refs.state, ...state.outputs.map((output) => output.path)],
      risks: state.risks ?? [],
    };
  }

  if (!state.current) {
    return {
      type: "fault",
      workflow_id: state.workflow_id,
      error: "workflow has no current action",
      recoverable: false,
    };
  }

  if (state.current.type === "ask") {
    return {
      type: "ask",
      workflow_id: state.workflow_id,
      questions: state.pending_questions ?? [],
      output: {
        path: state.current.output_path,
      },
      submit: submitCommand(options.submitCommandPrefix, state.workflow_id, state.current.output_path, options.rootDir),
    };
  }

  if (
    state.current.expects !== "plan_output" &&
    state.current.expects !== "implement_output" &&
    state.current.expects !== "review_output"
  ) {
    return {
      type: "fault",
      workflow_id: state.workflow_id,
      error: `run action cannot expect ${state.current.expects}`,
      recoverable: false,
    };
  }

  return {
    type: "run",
    workflow_id: state.workflow_id,
    instruction: instructionFor(state.current.expects, state),
    context: commonContext(state),
    output: {
      kind: state.current.expects,
      path: state.current.output_path,
    },
    submit: submitCommand(options.submitCommandPrefix, state.workflow_id, state.current.output_path, options.rootDir),
  };
}

export function faultAction(
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

export function askQuestions(state: WorkWorkflowState, questions: Question[], outputPath: string): WorkWorkflowState {
  return {
    ...state,
    status: "waiting",
    pending_questions: questions,
    current: {
      type: "ask",
      phase: state.phase,
      expects: "answers",
      output_path: outputPath,
    },
  };
}
