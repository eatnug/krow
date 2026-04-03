import { promises as fs } from "node:fs";
import path from "node:path";
import { workflowStatePath } from "./state-store";
import { WorkflowState } from "./types";

function absoluteRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir);
}

export function absoluteWorkflowStatePath(workflowId: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), workflowStatePath(workflowId));
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function saveWorkflowState(state: WorkflowState, rootDir = process.cwd()): Promise<string> {
  const filePath = absoluteWorkflowStatePath(state.workflowId, rootDir);
  await ensureParentDirectory(filePath);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  return filePath;
}

export async function loadWorkflowState(workflowId: string, rootDir = process.cwd()): Promise<WorkflowState> {
  const filePath = absoluteWorkflowStatePath(workflowId, rootDir);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as WorkflowState;
}
