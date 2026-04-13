import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkflowState } from "./types.js";

const STATE_DIR = ".krow/state/workflows";

function absoluteRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir);
}

export function workflowStatePath(workflowId: string): string {
  return `${STATE_DIR}/${workflowId}.json`;
}

export function absoluteWorkflowStatePath(workflowId: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), workflowStatePath(workflowId));
}

export function statePath(workflowId: string, rootDir = process.cwd()): string {
  return absoluteWorkflowStatePath(workflowId, rootDir);
}

export function touchUpdatedAt(timestamp: string): string {
  return timestamp;
}

export function saveWorkflowState(state: WorkflowState, rootDir = process.cwd()): string {
  const filePath = absoluteWorkflowStatePath(state.workflowId, rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2));
  return filePath;
}

export function loadWorkflowState(workflowId: string, rootDir = process.cwd()): WorkflowState {
  const filePath = absoluteWorkflowStatePath(workflowId, rootDir);
  return JSON.parse(readFileSync(filePath, "utf8")) as WorkflowState;
}

export function saveState(state: WorkflowState, rootDir = process.cwd()): void {
  state.updatedAt = new Date().toISOString();
  saveWorkflowState(state, rootDir);
}

export function loadState(workflowId: string, rootDir = process.cwd()): WorkflowState | null {
  const filePath = absoluteWorkflowStatePath(workflowId, rootDir);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as WorkflowState;
}

export function listStates(rootDir = process.cwd()): WorkflowState[] {
  const dir = path.join(absoluteRoot(rootDir), STATE_DIR);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try {
        return JSON.parse(readFileSync(path.join(dir, entry), "utf8")) as WorkflowState;
      } catch {
        return null;
      }
    })
    .filter((state): state is WorkflowState => state !== null)
    .filter((state) => state.status !== "completed" && state.status !== "stopped")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
