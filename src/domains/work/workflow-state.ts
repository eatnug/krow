import type { Answer, Question } from "./questions.js";
import type { TaskState } from "./task-graph.js";
import type { WorkOutputKind } from "./work-action.js";
import type { LanguageContextSelection } from "../language/language-alignment-service.js";
import type { LanguageUpdateProposal } from "./work-output-contracts.js";

export type WorkflowPhase = "plan" | "implement" | "review";
export type WorkflowStatus = "running" | "waiting" | "completed" | "blocked" | "stopped";
export type PendingPayloadKind = WorkOutputKind | "answers";

export interface RuntimeSession {
  started_at: string;
  runner: "node" | "npx";
  package: "krow-cli";
  requested: "latest" | "local";
  resolved_version: string;
  command_prefix?: string;
}

export interface PendingActionState {
  type: "run" | "ask";
  phase: WorkflowPhase;
  expects: PendingPayloadKind;
  output_path: string;
}

export interface OutputRecord {
  kind: PendingPayloadKind;
  path: string;
  created_at: string;
}

export interface WorkflowRefs {
  work_root: string;
  artifact_root: string;
  state: string;
}

export interface WorkWorkflowState {
  schema_version: string;
  workflow_id: string;
  request: string;
  status: WorkflowStatus;
  phase: WorkflowPhase;
  current?: PendingActionState;
  pending_questions?: Question[];
  answers?: Answer[];
  tasks?: TaskState[];
  outputs: OutputRecord[];
  runtime_session: RuntimeSession;
  refs: WorkflowRefs;
  language_context?: LanguageContextSelection;
  pending_language_updates?: LanguageUpdateProposal[];
  approved_language_updates?: LanguageUpdateProposal[];
  pending_review_result?: {
    passed: boolean;
    summary: string;
    evidence?: string[];
    issues?: string[];
  };
  language_update_refs?: string[];
  created_at: string;
  updated_at: string;
  blocked_reason?: string;
  risks?: string[];
}
