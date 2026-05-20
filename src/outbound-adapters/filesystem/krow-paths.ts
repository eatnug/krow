import path from "node:path";

export const STATE_DIR = ".krow/state/workflows";
export const SYSTEM_DIR = ".krow/system";
export const SYSTEM_DOCS_DIR = ".krow/system/docs";
export const WORK_DIR = ".krow/work";
export const GLOSSARY_FILE = ".krow/system/glossary.md";
export const SYSTEM_MAP_FILE = ".krow/system/map.md";
export const CHECKS_DIR = ".krow/check";

export function absoluteRoot(rootDir = process.cwd()): string {
  return path.resolve(rootDir);
}

export function workflowStatePath(workflowId: string): string {
  return `${workflowRunDirPath(workflowId)}/state.json`;
}

export function workflowRunDirPath(workflowId: string): string {
  return `${STATE_DIR}/${workflowId}`;
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

export function checksDirPath(): string {
  return CHECKS_DIR;
}

export function checkRunDirPath(checkId: string): string {
  return `${CHECKS_DIR}/${checkId}`;
}

export function absolutePath(relativePath: string, rootDir = process.cwd()): string {
  return path.join(absoluteRoot(rootDir), relativePath);
}
