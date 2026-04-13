import path from "node:path";

export const STATE_DIR = ".krow/state/workflows";
export const TASKS_DIR = ".krow/tasks";
export const RELAYS_DIR = ".krow/relays";

export function absoluteRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir);
}

export function workflowStatePath(workflowId: string): string {
  return `${STATE_DIR}/${workflowId}.json`;
}

export function absoluteWorkflowStatePath(workflowId: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), workflowStatePath(workflowId));
}

export function workflowTaskRootPath(workflowId: string): string {
  return `${TASKS_DIR}/${workflowId}`;
}

export function workflowTaskIndexPath(workflowId: string): string {
  return `${workflowTaskRootPath(workflowId)}/index.md`;
}

export function workflowRelayRootPath(workflowId: string): string {
  return `${RELAYS_DIR}/${workflowId}`;
}

export function unitTaskDirPath(workflowId: string, unitId: string): string {
  return `${workflowTaskRootPath(workflowId)}/${unitId}`;
}

export function unitBriefPath(workflowId: string, unitId: string): string {
  return `${unitTaskDirPath(workflowId, unitId)}/brief.md`;
}

export function unitContextPath(workflowId: string, unitId: string): string {
  return `${unitTaskDirPath(workflowId, unitId)}/context.md`;
}

export function unitStatusPath(workflowId: string, unitId: string): string {
  return `${unitTaskDirPath(workflowId, unitId)}/status.md`;
}

export function unitResultPath(workflowId: string, unitId: string): string {
  return `${unitTaskDirPath(workflowId, unitId)}/result.md`;
}

export function unitBatonPath(workflowId: string, unitId: string): string {
  return `${unitTaskDirPath(workflowId, unitId)}/baton.md`;
}

export function unitArtifactsDirPath(workflowId: string, unitId: string): string {
  return `${unitTaskDirPath(workflowId, unitId)}/artifacts`;
}

export function unitRelayPath(workflowId: string, unitId: string): string {
  return `${workflowRelayRootPath(workflowId)}/${unitId}.md`;
}

export function absolutePath(relativePath: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), relativePath);
}
