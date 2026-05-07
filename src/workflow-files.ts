import path from "node:path";

export const STATE_DIR = ".krow/state/workflows";
export const TASKS_DIR = ".krow/tasks";
export const RELAYS_DIR = ".krow/relays";
export const PROJECT_LANGUAGE_FILE = ".krow/language.md";
export const CONCEPTS_DIR = ".krow/concepts";
export const CONCEPT_INDEX_FILE = ".krow/concepts/index.md";
export const TEMPLATES_DIR = ".krow/templates";
export const PRDS_DIR = ".krow/prds";
export const PLANS_DIR = ".krow/plans";
export const EXAMPLES_DIR = ".krow/examples";
export const REVIEWS_DIR = ".krow/reviews";
export const GENERATED_DIR = ".krow/generated";
export const CHECKS_DIR = ".krow/checks";
export const ARTIFACTS_DIR = ".krow/artifacts";
export const LOGS_DIR = ".krow/logs";
export const KNOWLEDGE_DIR = ".krow/knowledge";

export function absoluteRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir);
}

export function workflowStatePath(workflowId: string): string {
  return `${STATE_DIR}/${workflowId}.json`;
}

export function projectLanguagePath(): string {
  return PROJECT_LANGUAGE_FILE;
}

export function conceptIndexPath(): string {
  return CONCEPT_INDEX_FILE;
}

export function conceptsDirPath(): string {
  return CONCEPTS_DIR;
}

export function conceptMapPath(conceptKey: string): string {
  return `${CONCEPTS_DIR}/${conceptKey}.md`;
}

export function templatesDirPath(): string {
  return TEMPLATES_DIR;
}

export function checksDirPath(): string {
  return CHECKS_DIR;
}

export function checkRunDirPath(checkId: string): string {
  return `${CHECKS_DIR}/${checkId}`;
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

export function unitReviewReportPath(workflowId: string, unitId: string): string {
  return `${REVIEWS_DIR}/${workflowId}-${unitId}.md`;
}

export function absolutePath(relativePath: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), relativePath);
}
