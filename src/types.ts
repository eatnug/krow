// ============================================================================
// Phase & Status
// ============================================================================

export type Phase = "clarify" | "plan" | "execute" | "verify";

export type Capability = "read" | "write" | "full";

export type WorkflowStatus =
  | "phase_clarify"
  | "gate_clarify"
  | "phase_plan"
  | "gate_plan"
  | "phase_execute"
  | "phase_verify"
  | "gate_verify"
  | "phase_synthesize"
  | "completed"
  | "blocked"
  | "stopped";

// ============================================================================
// Decisions
// ============================================================================

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
}

export interface DecisionPrompt {
  id: string;
  question: string;
  context?: string;
  options: DecisionOption[];
}

export interface DecisionAnswer {
  decisionId: string;
  selectedOptionId: string;
  customInput?: string;
}

// ============================================================================
// Work Items (universal phase output)
// ============================================================================

/** AI always returns an array of work items. */
export interface WorkItem {
  id: string;
  role: string;
  task: string;
  result?: unknown;  // present if AI did it inline
}

// ============================================================================
// Phase Outputs (final, after synthesis)
// ============================================================================

export interface ClarifyOutput {
  ready: boolean;
  summary: string;
  assumptions: string[];
  verifyFocus?: string[];
  decisions: DecisionPrompt[];
}

export interface PlanOutput {
  tasks: TaskDefinition[];
  approach: string;
  risks: string[];
}

export interface TaskDefinition {
  id: string;
  title: string;
  scope: string[];
  context: string[];
  dependsOn: string[];
}

export interface ExecuteOutput {
  summary: string;
  changedFiles: string[];
  notes: string[];
}

export interface VerifyIssue {
  severity: "error" | "warning";
  description: string;
  suggestion?: string;
}

export interface VerifyOutput {
  passed: boolean;
  issues: VerifyIssue[];
  summary: string;
  retryHint?: string;
}

// ============================================================================
// Task State (runtime, tracked by orchestrator)
// ============================================================================

export interface Task {
  id: string;
  title: string;
  scope: string[];
  context: string[];
  dependsOn: string[];
  status: "pending" | "executing" | "verifying" | "done" | "failed";
  verifyAttempts: number;
  executeOutput?: ExecuteOutput;
  verifyOutput?: VerifyOutput;
}

// ============================================================================
// Work Item State (runtime, tracked by orchestrator)
// ============================================================================

export interface WorkItemState {
  id: string;
  role: string;
  task: string;
  status: "pending" | "running" | "done";
  result?: string;
}

export interface ActiveWork {
  phase: Phase;
  taskId?: string;
  synthesize: string;
  items: WorkItemState[];
}

// ============================================================================
// Workflow State
// ============================================================================

export interface WorkflowState {
  schemaVersion: string;
  workflowId: string;
  description: string;
  status: WorkflowStatus;
  phase: Phase;

  // Clarify
  clarifyOutput?: ClarifyOutput;
  pendingDecisions: DecisionPrompt[];
  decisionHistory: DecisionAnswer[];

  // Plan + Tasks
  planOutput?: PlanOutput;
  tasks: Task[];

  // Active work items (when phase has multiple items)
  activeWork?: ActiveWork;

  // Config
  escalateAfter: number;

  // Timestamps
  createdAt: string;
  updatedAt: string;
  blockedReason?: string;
}

// ============================================================================
// Protocol: Context & Output Specs
// ============================================================================

export interface ContextInput {
  type: "file" | "data";
  ref: string;
}

export interface ContextSpec {
  isolation: "isolated" | "shared";
  inputs: ContextInput[];
}

export interface OutputSpec {
  schema: string;
  format: "json" | "files";
}

// ============================================================================
// Protocol: Responses
// ============================================================================

export interface PhaseResponse {
  type: "phase";
  phase: Phase;
  workflowId: string;
  taskId?: string;
  prompt: string;
  capability: Capability;
  context: ContextSpec;
  output: OutputSpec;
  onComplete: string;
  instructions: string;
}

export interface GateResponse {
  type: "gate";
  gate: "clarify" | "plan" | "verify";
  workflowId: string;
  decisions?: DecisionPrompt[];
  tasks?: Task[];
  approach?: string;
  risks?: string[];
  taskId?: string;
  verifyAttempts?: number;
  lastIssues?: VerifyIssue[];
  onComplete: string;
  instructions: string;
}

export interface DoneResponse {
  type: "done";
  workflowId: string;
  status: "completed" | "blocked" | "stopped";
  message: string;
  instructions: string;
}

export interface FaultResponse {
  type: "fault";
  workflowId: string;
  error: string;
  issues: string[];
  recoverable: boolean;
  instructions: string;
}

export interface BatchResponse {
  type: "batch";
  workflowId: string;
  responses: PhaseResponse[];
  instructions: string;
}

export type ProtocolResponse =
  | PhaseResponse
  | GateResponse
  | DoneResponse
  | FaultResponse
  | BatchResponse;

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}
