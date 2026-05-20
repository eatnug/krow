import type { WorkWorkflowState } from "../domains/work/workflow-state.js";

export interface WorkflowStateStore {
  save(state: WorkWorkflowState, rootDir?: string): void;
  load(workflowId: string, rootDir?: string): WorkWorkflowState;
}

