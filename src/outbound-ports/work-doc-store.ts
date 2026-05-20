import type { PlannedTask } from "../domains/work/task-graph.js";

export interface WorkDocCreationResult {
  workId: string;
  workDir: string;
  createdRefs: string[];
  skippedRefs: string[];
}

export interface WorkDocStore {
  createWorkDocuments(input: {
    request: string;
    rootDir?: string;
    workId?: string;
    title?: string;
  }): WorkDocCreationResult;
  writeTaskDocs(workRoot: string, tasks: PlannedTask[], rootDir?: string): void;
}
