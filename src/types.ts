// ============================================================================
// Core Runtime Model
// ============================================================================

export type RuntimePhase = "clarify" | "execute" | "verify" | "capture";

export type WorkflowPhase = RuntimePhase;

export type WorkflowGraphStrategy = "single" | "serial" | "parallel_fanout";
export type WorkflowUnitKind = "work" | "integration";
export type WorkflowPriority = "high" | "medium" | "low";
export type WorkflowEffort = "small" | "medium" | "large";

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
  kind?: "clarify" | "approval";
  target?: {
    kind: "prd" | "plan" | "glossary" | "system-document" | "scope";
    ref: string;
    status?: string;
  };
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
  evidence: string[];
  acceptanceCriteria: string[];
  verifyFocus?: string[];
  decisions: DecisionPrompt[];
}

export interface ExecuteOutput {
  summary: string;
  changedFiles: string[];
  outputFiles?: string[];
  artifacts?: string[];
  checks?: string[];
  executionSteps?: ExecutionStepTrace[];
  exampleTests?: ExampleTestTrace[];
  implementationLinks?: ImplementationTrace[];
  handoffNotes?: string[];
  notes: string[];
}

export type ExecutionStepId =
  | "tests-from-examples"
  | "run-tests-before-code"
  | "implement-code"
  | "run-tests-after-code";

export interface ExecutionStepTrace {
  id: ExecutionStepId;
  status: "completed" | "skipped" | "blocked";
  evidence: string;
}

export interface ExampleTestTrace {
  exampleId: string;
  testFiles: string[];
  testNames?: string[];
  status: "created" | "updated" | "existing";
}

export interface ImplementationTrace {
  codeFiles: string[];
  exampleIds?: string[];
  planIds?: string[];
  notes?: string;
}

export interface UnitReviewReport {
  ref: string;
  reviewId: string;
  generatedAt: string;
  gaps: string[];
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

export interface VerifyCheck {
  name: string;
  status: "passed" | "failed" | "skipped";
  command?: string;
  evidence: string;
}

export interface VerifyOutput {
  passed: boolean;
  score?: VerifyScore;
  checks: VerifyCheck[];
  evidence: string[];
  issues: VerifyIssue[];
  decisions?: DecisionPrompt[];
  needsHuman?: boolean;
  retryHint?: string;
  unverifiedClaims?: string[];
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
  kind?: WorkflowUnitKind;
  request?: string;
  scope?: string[];
  dependsOn?: string[];
  parallelizable?: boolean;
  ownership?: string[];
  priority?: WorkflowPriority;
  estimatedEffort?: WorkflowEffort;
  mergeRequired?: boolean;
  sharedRisks?: string[];
  acceptanceCriteria?: string[];
  verifyFocus?: string[];
  anchors?: RequestAnchors;
  intakeIntents?: CapabilityIntent[];
  intakeNotes?: string[];
  [key: string]: unknown;
}

export interface CreateWorkflowInput {
  workflowId?: string;
  mode: string;
  description: string;
  units: WorkflowUnit[];
  graphStrategy?: WorkflowGraphStrategy;
  graphNotes?: string[];
  captureEnabled?: boolean;
  maxVerifyAttempts?: number;
  createdAt?: string;
}

export interface UnitOutputs extends Partial<Record<RuntimePhase, unknown>> {
  reviewReport?: UnitReviewReport;
}

export interface WorkflowOutputs {
  [unitId: string]: UnitOutputs;
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
  graphStrategy?: WorkflowGraphStrategy;
  graphNotes?: string[];
  currentUnitIndex: number;
  captureEnabled: boolean;
  maxVerifyAttempts: number;
  verifyAttempts: number;
  pendingDecisions: DecisionPrompt[];
  decisionHistory: DecisionAnswer[];
  outputs: WorkflowOutputs;
  taskRoot: string;
  relayRoot: string;
  createdAt: string;
  updatedAt: string;
  lastVerifyIssues?: VerifyIssue[];
  blockedReason?: string;
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
  instruction_ref: string;
  output_contract: string;
  state_ref: string;
  workflow_task_index_ref?: string;
  task_packet_ref?: string;
  task_context_ref?: string;
  task_status_ref?: string;
  task_result_ref?: string;
  baton_ref?: string;
  relay_refs?: string[];
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
  decisions?: DecisionPrompt[];
  state_ref: string;
  workflow_task_index_ref?: string;
  task_status_ref?: string;
  on_complete?: Record<string, unknown>;
  instructions: string;
}

export interface DoneSignal {
  type: "done";
  workflow_id: string;
  mode?: string;
  status: "completed" | "blocked" | "stopped";
  state_ref: string;
  workflow_task_index_ref?: string;
  outputs?: string[];
  message: string;
}

export interface FaultSignal {
  type: "fault";
  workflow_id?: string;
  mode?: string;
  unit_id?: string;
  phase?: RuntimePhase;
  expected_contract?: string;
  issues?: string[];
  error: string;
  recoverable: boolean;
}

export type ControlSignal = RunSignal | GateSignal | DoneSignal | FaultSignal;

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}

export type RouteKind = "chat" | "work";

export type RouteSource = "explicit" | "default";

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
  verificationSurfaces: string[];
  tickets: string[];
}

export type GlossaryNamespace = "core" | "tech" | "project";

export type GlossaryTermStatus = "approved" | "proposed" | "unresolved" | "deprecated";

export interface GlossaryTerm {
  id: string;
  namespace: GlossaryNamespace;
  canonical: string;
  aliases: string[];
  status: GlossaryTermStatus;
  source: "builtin" | "glossary_file" | "request";
  evidence?: string[];
}

export interface GlossaryTermMatch extends GlossaryTerm {
  matchedText: string;
}

export interface GroundingStatement {
  subject: string;
  relation: string;
  object: string;
  status: "grounded" | "proposed" | "unresolved";
  confidence: RouteConfidence;
  sourceText: string;
}

export interface SystemDocumentMatch {
  key: string;
  title: string;
  ref: string;
  kind?: string;
  layer?: "product" | "system" | string;
  status?: GlossaryTermStatus;
  aliases: string[];
  relatedTerms: string[];
  references: string[];
  matchedText: string;
  matchFields: string[];
}

export interface ProjectGroundingSummary {
  glossaryRef: string;
  systemMapRef: string;
  vocabularyStatus: "missing" | "seed" | "custom";
  approvedTermCount: number;
  matchedTermCount: number;
  proposedTermCount: number;
  relatedSystemDocumentCount: number;
  unresolvedRelationCount: number;
  requiresClarification: boolean;
}

export interface ProjectGrounding {
  summary: ProjectGroundingSummary;
  matchedTerms: GlossaryTermMatch[];
  proposedTerms: GlossaryTerm[];
  relatedSystemDocuments: SystemDocumentMatch[];
  statements: GroundingStatement[];
  notes: string[];
  questions: string[];
}

export interface IntakeIntentLock {
  summary: string;
  lines: string[];
  confirmationPrompt: string;
}

export interface IntakePlan {
  objective: string;
  anchors: RequestAnchors;
  projectGrounding?: ProjectGrounding;
  intentLock?: IntakeIntentLock;
  intents: CapabilityIntent[];
  proposedUnits: WorkflowUnit[];
  graphStrategy: WorkflowGraphStrategy;
  graphNotes: string[];
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
  instructionRef: string;
  outputContract: string;
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
  | "check"
  | "check-apply"
  | "work"
  | "documents"
  | "review"
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
