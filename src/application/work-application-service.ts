import path from "node:path";
import { actionFromState, faultAction } from "./work-action-assembler.js";
import { submitWorkPayload, stopWorkState } from "../domains/work/work-state-machine.js";
import type { WorkAction } from "../domains/work/work-action.js";
import type { PlannedTask } from "../domains/work/task-graph.js";
import type { WorkWorkflowState, RuntimeSession } from "../domains/work/workflow-state.js";
import { LanguageAlignmentService } from "../domains/language/language-alignment-service.js";
import type {
  StartWorkInput,
  StopWorkInput,
  SubmitWorkInput,
  WorkflowHandleInput,
  WorkStatusView,
  WorkUseCases,
} from "../inbound-ports/work-use-cases.js";
import type { WorkflowStateStore } from "../outbound-ports/workflow-state-store.js";
import type { WorkDocStore } from "../outbound-ports/work-doc-store.js";
import type { Clock } from "../outbound-ports/clock.js";
import type { IdGenerator } from "../outbound-ports/id-generator.js";
import type { LanguageStore } from "../outbound-ports/language-store.js";
import { workflowArtifactsDirPath, workflowStatePath } from "../outbound-adapters/filesystem/krow-paths.js";

export interface WorkApplicationServiceDependencies {
  workflowStateStore: WorkflowStateStore;
  workDocStore: WorkDocStore;
  languageStore: LanguageStore;
  languageAlignmentService: LanguageAlignmentService;
  clock: Clock;
  idGenerator: IdGenerator;
}

function initialState(input: {
  request: string;
  workflowId: string;
  runtimeSession: RuntimeSession;
  languageContext?: WorkWorkflowState["language_context"];
  createdAt: string;
}): WorkWorkflowState {
  const artifactRoot = workflowArtifactsDirPath(input.workflowId);
  return {
    schema_version: "2.0.0",
    workflow_id: input.workflowId,
    request: input.request,
    status: "running",
    phase: "plan",
    current: {
      type: "run",
      phase: "plan",
      expects: "plan_output",
      output_path: `${artifactRoot}/plan_output-01.json`,
    },
    pending_questions: [],
    tasks: [],
    outputs: [],
    runtime_session: input.runtimeSession,
    refs: {
      work_root: `.krow/work/${input.workflowId}`,
      artifact_root: artifactRoot,
      state: workflowStatePath(input.workflowId),
    },
    language_context: input.languageContext,
    created_at: input.createdAt,
    updated_at: input.createdAt,
  };
}

function rootDir(value: string | undefined): string | undefined {
  return value ? path.resolve(value) : undefined;
}

function action(state: WorkWorkflowState, input: { rootDir?: string; submitCommandPrefix: string }): WorkAction {
  return actionFromState(state, {
    submitCommandPrefix: state.runtime_session.command_prefix ?? input.submitCommandPrefix,
    rootDir: rootDir(input.rootDir),
  });
}

function tasksFromPayload(payload: unknown): PlannedTask[] {
  return payload && typeof payload === "object" && Array.isArray((payload as { tasks?: unknown }).tasks)
    ? ((payload as { tasks: PlannedTask[] }).tasks)
    : [];
}

export class WorkApplicationService implements WorkUseCases {
  constructor(private readonly dependencies: WorkApplicationServiceDependencies) {}

  startWork(input: StartWorkInput): WorkAction {
    const workflowId = input.workId ?? this.dependencies.idGenerator.createWorkId(input.request);
    const docs = this.dependencies.workDocStore.createWorkDocuments({
      request: input.request,
      rootDir: rootDir(input.rootDir),
      workId: workflowId,
    });
    const languageContext = this.dependencies.languageAlignmentService.selectContextForRequest({
      request: input.request,
      language: this.dependencies.languageStore.loadLanguageContext(rootDir(input.rootDir)),
    });
    const state = initialState({
      request: input.request,
      workflowId,
      runtimeSession: input.runtimeSession,
      languageContext,
      createdAt: this.dependencies.clock.nowIso(),
    });
    state.refs.work_root = docs.workDir;
    this.dependencies.workflowStateStore.save(state, rootDir(input.rootDir));
    return action(state, input);
  }

  next(input: WorkflowHandleInput): WorkAction {
    const state = this.dependencies.workflowStateStore.load(input.workflowId, rootDir(input.rootDir));
    return action(state, input);
  }

  submit(input: SubmitWorkInput): WorkAction {
    const state = this.dependencies.workflowStateStore.load(input.workflowId, rootDir(input.rootDir));
    const pendingKind = state.current?.expects;
    const result = submitWorkPayload(state, input.payload);
    if (result.fault) {
      return result.fault;
    }
    if (!result.state) {
      return faultAction(input.workflowId, "submit did not produce a workflow state", [], false);
    }

    if (pendingKind === "plan_output") {
      this.dependencies.workDocStore.writeTaskDocs(result.state.refs.work_root, tasksFromPayload(input.payload), rootDir(input.rootDir));
    }

    this.dependencies.workflowStateStore.save(result.state, rootDir(input.rootDir));
    return action(result.state, input);
  }

  status(input: WorkflowHandleInput): WorkStatusView {
    const state = this.dependencies.workflowStateStore.load(input.workflowId, rootDir(input.rootDir));
    return {
      workflow_id: state.workflow_id,
      request: state.request,
      status: state.status,
      phase: state.phase,
      current: state.current,
      pending_question_count: state.pending_questions?.length ?? 0,
      output_count: state.outputs.length,
      work_root: state.refs.work_root,
      state_ref: state.refs.state,
      tasks: state.tasks ?? [],
      blocked_reason: state.blocked_reason,
    };
  }

  stop(input: StopWorkInput): WorkAction {
    const state = this.dependencies.workflowStateStore.load(input.workflowId, rootDir(input.rootDir));
    const stopped = stopWorkState(state, input.reason);
    this.dependencies.workflowStateStore.save(stopped, rootDir(input.rootDir));
    return action(stopped, input);
  }
}
