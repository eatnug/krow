import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { WorkflowState } from "./types.js";

const STATE_DIR = ".krow/state";

export function statePath(workflowId: string, rootDir = process.cwd()): string {
  return join(rootDir, STATE_DIR, `${workflowId}.json`);
}

export function saveState(state: WorkflowState, rootDir = process.cwd()): void {
  state.updatedAt = new Date().toISOString();
  const p = statePath(state.workflowId, rootDir);
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

export function loadState(workflowId: string, rootDir = process.cwd()): WorkflowState | null {
  const p = statePath(workflowId, rootDir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as WorkflowState;
}

export function listStates(rootDir = process.cwd()): WorkflowState[] {
  const dir = join(rootDir, STATE_DIR);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf-8")) as WorkflowState;
      } catch {
        return null;
      }
    })
    .filter((s): s is WorkflowState => s !== null)
    .filter((s) => s.status !== "completed" && s.status !== "stopped")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}
