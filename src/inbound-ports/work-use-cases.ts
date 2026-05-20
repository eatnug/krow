import type { WorkAction } from "../domains/work/work-action.js";
import type { RuntimeSession, WorkWorkflowState } from "../domains/work/workflow-state.js";

export interface StartWorkInput {
  request: string;
  rootDir?: string;
  workId?: string;
  submitCommandPrefix: string;
  runtimeSession: RuntimeSession;
}

export interface SubmitWorkInput {
  workflowId: string;
  payload: unknown;
  rootDir?: string;
  submitCommandPrefix: string;
}

export interface WorkflowHandleInput {
  workflowId: string;
  rootDir?: string;
  submitCommandPrefix: string;
}

export interface StopWorkInput extends WorkflowHandleInput {
  reason?: string;
}

export interface WorkStatusView {
  workflow_id: string;
  request: string;
  status: WorkWorkflowState["status"];
  phase: WorkWorkflowState["phase"];
  current?: WorkWorkflowState["current"];
  pending_question_count: number;
  output_count: number;
  work_root: string;
  state_ref: string;
  tasks: WorkWorkflowState["tasks"];
  blocked_reason?: string;
}

export interface WorkUseCases {
  startWork(input: StartWorkInput): WorkAction;
  submit(input: SubmitWorkInput): WorkAction;
  next(input: WorkflowHandleInput): WorkAction;
  status(input: WorkflowHandleInput): WorkStatusView;
  stop(input: StopWorkInput): WorkAction;
}

