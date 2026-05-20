import type { Question } from "./questions.js";

export type WorkAction = RunAction | AskAction | DoneAction | FaultAction;

export type WorkOutputKind = "plan_output" | "implement_output" | "review_output";

interface ActionBase {
  type: "run" | "ask" | "done" | "fault";
  workflow_id: string;
}

export interface RunAction extends ActionBase {
  type: "run";
  instruction: string;
  context?: string[];
  output: {
    kind: WorkOutputKind;
    path: string;
  };
  submit: string;
}

export interface AskAction extends ActionBase {
  type: "ask";
  questions: Question[];
  output: {
    path: string;
  };
  submit: string;
}

export interface DoneAction extends ActionBase {
  type: "done";
  status: "completed" | "blocked" | "stopped";
  summary: string;
  refs?: string[];
  risks?: string[];
}

export interface FaultAction extends ActionBase {
  type: "fault";
  error: string;
  issues?: string[];
  recoverable: boolean;
  retry?: {
    command: string;
    reason: string;
  };
}

