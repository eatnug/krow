import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkflowStateStore } from "../../outbound-ports/workflow-state-store.js";
import type { WorkWorkflowState } from "../../domains/work/workflow-state.js";
import { absolutePath, workflowStatePath } from "./krow-paths.js";

export class FilesystemWorkflowStateStore implements WorkflowStateStore {
  save(state: WorkWorkflowState, rootDir = process.cwd()): void {
    const statePath = absolutePath(state.refs.state, rootDir);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
    mkdirSync(absolutePath(state.refs.artifact_root, rootDir), { recursive: true });
  }

  load(workflowId: string, rootDir = process.cwd()): WorkWorkflowState {
    const ref = workflowStatePath(workflowId);
    const filePath = absolutePath(ref, rootDir);
    if (!existsSync(filePath)) {
      throw new Error(`workflow state does not exist: ${ref}`);
    }
    return JSON.parse(readFileSync(filePath, "utf8")) as WorkWorkflowState;
  }
}
