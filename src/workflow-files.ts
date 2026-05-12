import path from "node:path";

export const STATE_DIR = ".krow/state/workflows";
export const SYSTEM_DIR = ".krow/system";
export const SYSTEM_DOCS_DIR = ".krow/system/docs";
export const WORK_DIR = ".krow/work";
export const GLOSSARY_FILE = ".krow/system/glossary.md";
export const SYSTEM_MAP_FILE = ".krow/system/map.md";
export const TEMPLATES_DIR = "templates";
export const GENERATED_DIR = ".krow/state/generated";
export const CHECKS_DIR = ".krow/check";
export const ARTIFACTS_DIR = ".krow/state/artifacts";
export const LOGS_DIR = ".krow/logs";

export function absoluteRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir);
}

export function workflowStatePath(workflowId: string): string {
  return `${workflowRunDirPath(workflowId)}/state.json`;
}

export function workflowRunDirPath(workflowId: string): string {
  return `${STATE_DIR}/${workflowId}`;
}

export function workflowStepsDirPath(workflowId: string): string {
  return `${workflowRunDirPath(workflowId)}/steps`;
}

export function workflowArtifactsDirPath(workflowId: string): string {
  return `${workflowRunDirPath(workflowId)}/artifacts`;
}

export function systemDirPath(): string {
  return SYSTEM_DIR;
}

export function systemDocsDirPath(): string {
  return SYSTEM_DOCS_DIR;
}

export function workDirPath(): string {
  return WORK_DIR;
}

export function glossaryPath(): string {
  return GLOSSARY_FILE;
}

export function systemMapPath(): string {
  return SYSTEM_MAP_FILE;
}

export function systemDocsPath(): string {
  return SYSTEM_DOCS_DIR;
}

export function systemDocumentPath(documentKey: string): string {
  return `${SYSTEM_DOCS_DIR}/${documentKey}.md`;
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
  return workflowStepsDirPath(workflowId);
}

export function workflowTaskIndexPath(workflowId: string): string {
  return `${workflowTaskRootPath(workflowId)}/index.md`;
}

export function workflowRelayRootPath(workflowId: string): string {
  return `${workflowArtifactsDirPath(workflowId)}/relays`;
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
  return `${workflowArtifactsDirPath(workflowId)}/${unitId}`;
}

export function unitRelayPath(workflowId: string, unitId: string): string {
  return `${workflowRelayRootPath(workflowId)}/${unitId}.md`;
}

export function unitReviewReportPath(workflowId: string, unitId: string): string {
  return `${workflowArtifactsDirPath(workflowId)}/${unitId}-review.md`;
}

export function absolutePath(relativePath: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), relativePath);
}
