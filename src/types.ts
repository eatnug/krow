// ============================================================================
// Core Runtime Model
// ============================================================================

export type Phase = "clarify" | "plan" | "execute" | "verify";

export type RuntimePhase = "clarify" | "execute" | "verify" | "capture";

export type WorkflowPhase = RuntimePhase;

export type WorkflowStatus =
  | "phase_clarify"
  | "clarify_pending"
  | "phase_execute"
  | "phase_verify"
  | "phase_capture"
  | "completed"
  | "blocked"
  | "stopped";

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

export interface ClarifyOutput {
  ready: boolean;
  summary: string;
  assumptions: string[];
  verifyFocus?: string[];
  decisions: DecisionPrompt[];
}

export interface ExecuteOutput {
  summary: string;
  changedFiles: string[];
  outputFiles?: string[];
  artifacts?: string[];
  notes: string[];
}

export interface VerifyIssue {
  severity: "error" | "warning";
  category: string;
  description: string;
  suggestion?: string;
}

export interface VerifyScore {
  accuracy: number;
  completeness: number;
  consistency: number;
}

export interface VerifyOutput {
  passed: boolean;
  score?: VerifyScore;
  issues: VerifyIssue[];
  decisions?: DecisionPrompt[];
  needsHuman?: boolean;
  retryHint?: string;
  summary: string;
}

export interface CaptureEntry {
  filename: string;
  content: string;
  reason: string;
  action?: "create" | "update";
}

export interface CaptureOutput {
  entries: CaptureEntry[];
}

export interface WorkflowUnit {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface CreateWorkflowInput {
  workflowId?: string;
  mode: string;
  description: string;
  units: WorkflowUnit[];
  captureEnabled?: boolean;
  maxVerifyAttempts?: number;
  createdAt?: string;
}

export interface WorkflowOutputs {
  [unitId: string]: Partial<Record<RuntimePhase, unknown>>;
}

// ============================================================================
// Legacy Compatibility Types
// ============================================================================

export type Capability = "read" | "write" | "full";

export interface WorkItem {
  id: string;
  role: string;
  task: string;
  result?: unknown;
}

export interface TaskDefinition {
  id: string;
  title: string;
  scope: string[];
  context: string[];
  dependsOn: string[];
}

export interface PlanOutput {
  tasks: TaskDefinition[];
  approach: string;
  risks: string[];
}

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
// Workflow State
// ============================================================================

export interface WorkflowState {
  schemaVersion: string;
  workflowId: string;
  mode: string;
  description: string;
  status: WorkflowStatus;
  phase: RuntimePhase;
  units: WorkflowUnit[];
  currentUnitIndex: number;
  captureEnabled: boolean;
  maxVerifyAttempts: number;
  verifyAttempts: number;
  pendingDecisions: DecisionPrompt[];
  decisionHistory: DecisionAnswer[];
  outputs: WorkflowOutputs;
  createdAt: string;
  updatedAt: string;
  lastVerifyIssues?: VerifyIssue[];
  blockedReason?: string;

  // Compile-time compatibility only. The canonical runtime does not depend on,
  // validate, or mutate these legacy fields.
  clarifyOutput?: ClarifyOutput;
  planOutput?: PlanOutput;
  tasks: Task[];
  activeWork?: ActiveWork;
}

// ============================================================================
// Control Signals
// ============================================================================

export interface RunSignal {
  type: "run";
  workflow_id: string;
  mode?: string;
  unit_id?: string;
  phase: RuntimePhase;
  prompt_ref: string;
  required_schema: string;
  state_ref: string;
  context?: Record<string, unknown>;
  on_complete: {
    kind: "phase_output";
    phase: RuntimePhase;
  };
  instructions: string;
}

export interface GateSignal {
  type: "gate";
  gate: string;
  workflow_id: string;
  mode?: string;
  unit_id?: string;
  options: string[];
  state_ref: string;
  on_complete?: Record<string, unknown>;
  instructions: string;
}

export interface DoneSignal {
  type: "done";
  workflow_id: string;
  mode?: string;
  status: "completed" | "blocked" | "stopped";
  state_ref: string;
  outputs?: string[];
  message: string;
}

export interface FaultSignal {
  type: "fault";
  workflow_id?: string;
  mode?: string;
  unit_id?: string;
  phase?: RuntimePhase;
  expected_schema?: string;
  issues?: string[];
  error: string;
  recoverable: boolean;
}

export type ControlSignal = RunSignal | GateSignal | DoneSignal | FaultSignal;

// ============================================================================
// Legacy Protocol Shapes
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

export interface FaultResponse {
  type: "fault";
  workflowId: string;
  error: string;
  issues: string[];
  recoverable: boolean;
  instructions: string;
}

export interface DoneResponse {
  type: "done";
  workflowId: string;
  status: "completed" | "blocked" | "stopped";
  message: string;
  instructions: string;
}

export interface BatchResponse {
  type: "batch";
  workflowId: string;
  responses: PhaseResponse[];
  instructions: string;
}

export type ProtocolResponse =
  | ControlSignal
  | PhaseResponse
  | GateResponse
  | FaultResponse
  | DoneResponse
  | BatchResponse;

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}

export type RouteKind = "chat" | "work";

export type RouteSource = "explicit" | "heuristic";

export type RouteConfidence = "low" | "medium" | "high";

export interface RouteDecision {
  rawMessage: string;
  normalizedMessage: string;
  kind: RouteKind;
  source: RouteSource;
  confidence: RouteConfidence;
  forced: boolean;
  reasons: string[];
}

export type CapabilityKind =
  | "repo_scan"
  | "search_code"
  | "read_targets"
  | "read_files"
  | "inspect_tests"
  | "inspect_logs"
  | "inspect_config"
  | "inspect_docs"
  | "ask_user"
  | "edit_files"
  | "run_checks"
  | "spawn_worker"
  | "write_relay"
  | "read_state"
  | "write_state"
  | "emit_gate";

export interface CapabilityIntent {
  kind: CapabilityKind;
  priority: "high" | "medium" | "low";
  reason: string;
  query?: string;
  targets?: string[];
}

export type CapabilitySurface = "entry" | "phase" | "control" | "worker";

export interface CapabilityPolicy {
  id: string;
  surface: CapabilitySurface;
  mode: "allow-list";
  allowed: CapabilityKind[];
  notes: string[];
}

export interface RequestAnchors {
  filePaths: string[];
  symbols: string[];
  errors: string[];
  tests: string[];
  tickets: string[];
}

export interface IntakePlan {
  objective: string;
  anchors: RequestAnchors;
  intents: CapabilityIntent[];
  missingEvidence: string[];
  questions: string[];
  needsUserInput: boolean;
  notes: string[];
}

export interface StartFromMessageInput {
  message: string;
  mode?: string;
  explicitIntent?: RouteKind;
  allowHeuristics?: boolean;
  captureEnabled?: boolean;
  maxVerifyAttempts?: number;
}

export interface StartFromMessageResult {
  route: RouteDecision;
  intake: IntakePlan;
  entryPolicy: CapabilityPolicy;
  phasePolicy?: CapabilityPolicy;
  state?: WorkflowState;
  signal?: ControlSignal;
  blockedByQuestions: boolean;
}

export interface CollectedContext {
  summary: string;
  artifacts?: string[];
  unresolvedQuestions?: string[];
}

export interface CapabilityAdapter {
  collect(intents: CapabilityIntent[]): Promise<CollectedContext>;
}

export type WorkerExecutionMode = "inline" | "fork";

export interface WorkerLaunchRequest {
  workflowId: string;
  unitId: string;
  phase: RuntimePhase;
  promptRef: string;
  requiredSchema: string;
  instructions: string;
  capabilityPolicy: CapabilityPolicy;
  executionMode: WorkerExecutionMode;
  contextRefs: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkerLaunchResult {
  status: "completed" | "blocked" | "cancelled";
  output?: unknown;
  summary?: string;
  issues?: string[];
}

export interface ForkedWorkerAdapter {
  run(request: WorkerLaunchRequest): Promise<WorkerLaunchResult>;
}

export type LocalControlCommandName =
  | "route"
  | "intake"
  | "start"
  | "status"
  | "next"
  | "submit-phase"
  | "submit-decisions"
  | "stop"
  | "resume";

export interface LocalControlCommandSpec {
  name: LocalControlCommandName;
  localOnly: true;
  description: string;
}
