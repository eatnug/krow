import type { PlannedTask } from "../domains/work/task-graph.js";
import type { LanguageUpdateProposal } from "../domains/work/work-output-contracts.js";

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
  writeLanguageUpdates(workRoot: string, updates: LanguageUpdateProposal[], rootDir?: string): void;
}

