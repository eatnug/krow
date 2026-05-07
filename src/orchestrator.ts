import type {
  CaptureOutput,
  ClarifyOutput,
  ControlSignal,
  CreateWorkflowInput,
  ExecuteOutput,
  FaultSignal,
  RunSignal,
  RuntimePhase,
  VerifyOutput,
  WorkflowState,
  WorkflowStatus,
  WorkflowUnit,
} from "./types.js";
import {
  validateCaptureOutput,
  validateClarifyOutput,
  validateDecisionAnswers,
  validateExecuteOutput,
  validateVerifyOutput,
  validateWorkflowState,
} from "./validators.js";
import {
  approvalPromptsForDocuments,
  unsatisfiedApprovalDocuments,
  type ApprovalTargetDocument,
} from "./document-contracts.js";
import {
  executionContractForUnit,
  validateExecuteOutputAgainstContract,
} from "./execution-contracts.js";
import {
  unitBatonPath,
  unitBriefPath,
  unitContextPath,
  unitRelayPath,
  unitResultPath,
  unitStatusPath,
  workflowRelayRootPath,
  workflowStatePath,
  workflowTaskIndexPath,
  workflowTaskRootPath,
} from "./state-store.js";
import { buildRunContext, completedUnitIds, nextReadyUnitIndex, unitDependencies } from "./workflow-graph.js";

type PhasePayload = ClarifyOutput | ExecuteOutput | VerifyOutput | CaptureOutput;
type SignalResult = { state?: WorkflowState; signal: ControlSignal };
type CreatedWorkflow = { state: WorkflowState; signal: ControlSignal };

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createWorkflowId(): string {
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentUnit(state: WorkflowState): WorkflowUnit | undefined {
  return state.units[state.currentUnitIndex];
}

function pendingDecisionsAreApproval(state: WorkflowState): boolean {
  return state.pendingDecisions.length > 0 && state.pendingDecisions.every((decision) => decision.kind === "approval");
}

function currentApprovalGaps(state: WorkflowState): ApprovalTargetDocument[] {
  const unit = currentUnit(state);
  const context = unit?.documentContext;
  if (!context || typeof context !== "object") {
    return [];
  }

  const approvalGaps = (context as { approvalGaps?: unknown }).approvalGaps;
  if (!Array.isArray(approvalGaps)) {
    return [];
  }

  return unsatisfiedApprovalDocuments(approvalGaps as ApprovalTargetDocument[], state.decisionHistory);
}

function currentUnitOutputBucket(state: WorkflowState): Record<string, unknown> {
  const unit = currentUnit(state);
  if (!unit) {
    return {};
  }
  if (!state.outputs[unit.id]) {
    state.outputs[unit.id] = {};
  }
  return state.outputs[unit.id] as Record<string, unknown>;
}

function storePhaseOutput(state: WorkflowState, phase: RuntimePhase, payload: PhasePayload): void {
  currentUnitOutputBucket(state)[phase] = payload;
}

function outputContractForPhase(phase: RuntimePhase): string {
  return `krow://contract/${phase}-output`;
}

function instructionForPhase(phase: RuntimePhase): string {
  switch (phase) {
    case "clarify":
      return "krow://phase/clarify";
    case "execute":
      return "krow://phase/execute";
    case "verify":
      return "krow://phase/verify";
    case "capture":
      return "krow://phase/capture";
  }
}

function toRuntimePhase(phase: string): RuntimePhase | undefined {
  switch (phase) {
    case "clarify":
    case "execute":
    case "verify":
    case "capture":
      return phase;
    default:
      return undefined;
  }
}

function runSignal(state: WorkflowState, phase: RuntimePhase, instructions: string): RunSignal {
  const context = buildRunContext(state);
  const unit = currentUnit(state);
  const currentUnitContext =
    context.currentUnit && typeof context.currentUnit === "object"
      ? (context.currentUnit as Record<string, unknown>)
      : undefined;
  const readySiblingUnitIds = Array.isArray(context.readySiblingUnitIds)
    ? context.readySiblingUnitIds.filter((value): value is string => typeof value === "string")
    : [];
  const detailLines = [instructions];

  if (typeof context.graphStrategy === "string") {
    detailLines.push(`Graph strategy: ${context.graphStrategy}.`);
  }
  if (currentUnitContext?.title && typeof currentUnitContext.title === "string") {
    detailLines.push(
      `Current unit: ${currentUnitContext.title}${typeof currentUnitContext.id === "string" ? ` (${currentUnitContext.id})` : ""}.`,
    );
  }
  if (readySiblingUnitIds.length > 0) {
    detailLines.push(
      `Other ready units: ${readySiblingUnitIds.join(", ")}. Use them as scheduling metadata only; this signal still covers one unit.`,
    );
  }

  return {
    type: "run",
    workflow_id: state.workflowId,
    mode: state.mode,
    unit_id: unit?.id,
    phase,
    instruction_ref: instructionForPhase(phase),
    output_contract: outputContractForPhase(phase),
    state_ref: workflowStatePath(state.workflowId),
    workflow_task_index_ref: workflowTaskIndexPath(state.workflowId),
    task_packet_ref: unit ? unitBriefPath(state.workflowId, unit.id) : undefined,
    task_context_ref: unit ? unitContextPath(state.workflowId, unit.id) : undefined,
    task_status_ref: unit ? unitStatusPath(state.workflowId, unit.id) : undefined,
    task_result_ref: unit ? unitResultPath(state.workflowId, unit.id) : undefined,
    baton_ref: unit ? unitBatonPath(state.workflowId, unit.id) : undefined,
    relay_refs: unit ? unitDependencies(unit).map((dependencyId) => unitRelayPath(state.workflowId, dependencyId)) : [],
    context,
    on_complete: {
      kind: "phase_output",
      phase,
    },
    instructions: detailLines.join(" "),
  };
}

function instructionsForPhase(state: WorkflowState, phase: RuntimePhase): string {
  if (phase !== "execute") {
    switch (phase) {
      case "clarify":
        return "Tighten the current unit until execution is safe, verification is clear, and blocked sibling units are not pulled into scope.";
      case "verify":
        return "Try to disprove the claimed result for the current unit and report recoverable issues precisely enough to drive the next clarify pass.";
      case "capture":
        return "Capture only durable, reusable patterns worth saving.";
    }
  }

  const contract = executionContractForUnit(currentUnit(state));
  if (contract && contract.exampleIds.length > 0) {
    return [
      "Execute the approved plan in this order: create or update tests from the referenced Examples, run the relevant tests before code when meaningful, implement the code, then rerun the tests after code.",
      `Required Examples: ${contract.exampleIds.join(", ")}.`,
      "The execute payload must include executionSteps, exampleTests, and implementationLinks that prove tests came before code and code links back to Examples.",
    ].join(" ");
  }

  return "Perform only the clarified unit of work. If the graph exposes other ready units, treat them as scheduler metadata for the host rather than silently expanding this unit.";
}

function faultSignal(
  state: WorkflowState | undefined,
  error: string,
  issues: string[],
  recoverable: boolean,
): FaultSignal {
  return {
    type: "fault",
    workflow_id: state?.workflowId,
    mode: state?.mode,
    unit_id: state ? currentUnit(state)?.id : undefined,
    phase: state ? toRuntimePhase(state.phase) : undefined,
    expected_contract: state && toRuntimePhase(state.phase) ? outputContractForPhase(toRuntimePhase(state.phase)!) : undefined,
    issues,
    error,
    recoverable,
  };
}

function terminalSignal(state: WorkflowState): ControlSignal {
  return {
    type: "done",
    workflow_id: state.workflowId,
    mode: state.mode,
    status: state.status === "blocked" ? "blocked" : state.status === "stopped" ? "stopped" : "completed",
    state_ref: workflowStatePath(state.workflowId),
    workflow_task_index_ref: workflowTaskIndexPath(state.workflowId),
    outputs: Object.keys(state.outputs),
    message:
      state.status === "blocked"
        ? state.blockedReason || "workflow blocked"
        : state.status === "stopped"
          ? "workflow stopped"
          : "workflow completed",
  };
}

function asSignalResult(result: SignalResult): SignalResult {
  return result;
}

function normalizeCreateWorkflowInput(input: CreateWorkflowInput | string): CreateWorkflowInput {
  if (typeof input !== "string") {
    return input;
  }

  const title = input.trim() || "main";
  return {
    mode: "work",
    description: input,
    units: [{ id: "main", title }],
  };
}

function setPhase(state: WorkflowState, status: WorkflowStatus, phase: RuntimePhase): void {
  state.status = status;
  state.phase = phase;
  state.updatedAt = nowIso();
}

function advanceToNextUnit(state: WorkflowState): void {
  const nextIndex = nextReadyUnitIndex(state);
  if (nextIndex === undefined) {
    state.status = "blocked";
    state.blockedReason = "no ready unit remained in the workflow graph";
    state.updatedAt = nowIso();
    return;
  }

  state.currentUnitIndex = nextIndex;
  state.verifyAttempts = 0;
  setPhase(state, "phase_clarify", "clarify");
}

export function validateState(state: unknown): FaultSignal | undefined {
  const result = validateWorkflowState(state);
  if (result.ok) {
    return undefined;
  }
  return faultSignal(undefined, "invalid workflow state", result.issues, false);
}

export function createWorkflow(input: CreateWorkflowInput | string): CreatedWorkflow {
  const normalized = normalizeCreateWorkflowInput(input);
  const timestamp = normalized.createdAt ?? nowIso();
  const initialUnitIndex = normalized.units.findIndex((unit) => (unit.dependsOn?.length ?? 0) === 0);
  const state = {
    schemaVersion: "1.2.0",
    workflowId: normalized.workflowId ?? createWorkflowId(),
    mode: normalized.mode,
    description: normalized.description,
    status: "phase_clarify",
    phase: "clarify",
    units: normalized.units,
    graphStrategy: normalized.graphStrategy,
    graphNotes: normalized.graphNotes,
    currentUnitIndex: initialUnitIndex >= 0 ? initialUnitIndex : 0,
    captureEnabled: normalized.captureEnabled ?? false,
    maxVerifyAttempts: normalized.maxVerifyAttempts ?? 3,
    verifyAttempts: 0,
    pendingDecisions: [],
    decisionHistory: [],
    outputs: {},
    taskRoot: "",
    relayRoot: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  } as unknown as WorkflowState;

  state.taskRoot = workflowTaskRootPath(state.workflowId);
  state.relayRoot = workflowRelayRootPath(state.workflowId);

  const stateValidation = validateWorkflowState(state);
  if (!stateValidation.ok) {
    const signal = faultSignal(state, "new workflow failed validation", stateValidation.issues, false);
    return { state, signal };
  }

  const signal = nextSignal(state);
  return { state, signal };
}

export function nextSignal(state: WorkflowState): ControlSignal {
  const stateValidation = validateWorkflowState(state);
  if (!stateValidation.ok) {
    return faultSignal(state, "invalid workflow state", stateValidation.issues, false);
  }

  switch (state.status) {
    case "phase_clarify":
      return runSignal(state, "clarify", instructionsForPhase(state, "clarify"));
    case "clarify_pending":
      return {
        type: "gate",
        gate: pendingDecisionsAreApproval(state) ? "approve" : "clarify",
        workflow_id: state.workflowId,
        mode: state.mode,
        unit_id: currentUnit(state)?.id,
        options: state.pendingDecisions.map((decision) => decision.id),
        decisions: state.pendingDecisions,
        state_ref: workflowStatePath(state.workflowId),
        workflow_task_index_ref: workflowTaskIndexPath(state.workflowId),
        task_status_ref: currentUnit(state) ? unitStatusPath(state.workflowId, currentUnit(state)!.id) : undefined,
        on_complete: {
          kind: "decision_answers",
        },
        instructions: pendingDecisionsAreApproval(state)
          ? "Collect one approval decision for each pending PRD/Plan decision, submit decision answers, then resume the workflow."
          : "Collect the pending external decisions, then submit decision answers and resume clarify.",
      };
    case "phase_execute":
      return runSignal(state, "execute", instructionsForPhase(state, "execute"));
    case "phase_verify":
      return runSignal(state, "verify", instructionsForPhase(state, "verify"));
    case "phase_capture":
      return runSignal(state, "capture", instructionsForPhase(state, "capture"));
    case "completed":
    case "blocked":
    case "stopped":
      return terminalSignal(state);
    default:
      return faultSignal(state, `unsupported status: ${String(state.status)}`, [], false);
  }
}

export function stopWorkflow(state: WorkflowState, reason = "workflow stopped"): CreatedWorkflow {
  const next = cloneState(state);
  next.status = "stopped";
  next.blockedReason = reason;
  next.updatedAt = nowIso();
  const signal = nextSignal(next);
  return { state: next, signal };
}

export function applyDecisionAnswers(state: WorkflowState, input: unknown): SignalResult {
  if (state.status !== "clarify_pending") {
    return asSignalResult({
      signal: faultSignal(state, "decision answers are only valid during clarify_pending", [], true),
    });
  }

  const validation = validateDecisionAnswers(input);
  if (!validation.ok || !validation.value) {
    return asSignalResult({
      signal: faultSignal(state, "invalid decision answers", validation.issues, true),
    });
  }

  const requiredDecisionIds = state.pendingDecisions.map((decision) => decision.id);
  const providedDecisionIds = validation.value.map((answer) => answer.decisionId);
  const missingDecisionIds = requiredDecisionIds.filter((decisionId) => !providedDecisionIds.includes(decisionId));
  const unknownDecisionIds = providedDecisionIds.filter((decisionId) => !requiredDecisionIds.includes(decisionId));
  const invalidOptionIssues = validation.value.flatMap((answer) => {
    const decision = state.pendingDecisions.find((item) => item.id === answer.decisionId);
    if (!decision) {
      return [];
    }
    return decision.options.some((option) => option.id === answer.selectedOptionId)
      ? []
      : [`${answer.decisionId} selected unknown option: ${answer.selectedOptionId}`];
  });

  if (missingDecisionIds.length > 0 || unknownDecisionIds.length > 0 || invalidOptionIssues.length > 0) {
    const issues: string[] = [];
    if (missingDecisionIds.length > 0) {
      issues.push(`missing bundled decisions: ${missingDecisionIds.join(", ")}`);
    }
    if (unknownDecisionIds.length > 0) {
      issues.push(`unknown decisions submitted: ${unknownDecisionIds.join(", ")}`);
    }
    issues.push(...invalidOptionIssues);
    return asSignalResult({
      signal: faultSignal(state, "decision answers did not match the pending bundled decisions", issues, true),
    });
  }

  const next = cloneState(state);
  next.decisionHistory.push(...validation.value);
  next.pendingDecisions = [];

  if (pendingDecisionsAreApproval(state)) {
    if (validation.value.some((answer) => answer.selectedOptionId === "stop")) {
      next.status = "stopped";
      next.blockedReason = "approval gate stopped by decision";
      next.updatedAt = nowIso();
      return asSignalResult({ state: next, signal: nextSignal(next) });
    }
    if (validation.value.some((answer) => answer.selectedOptionId === "revise")) {
      setPhase(next, "phase_clarify", "clarify");
      return asSignalResult({ state: next, signal: nextSignal(next) });
    }
    setPhase(next, "phase_execute", "execute");
    return asSignalResult({ state: next, signal: nextSignal(next) });
  }

  setPhase(next, "phase_clarify", "clarify");
  return asSignalResult({ state: next, signal: nextSignal(next) });
}

export function submitDecisions(state: WorkflowState, input: unknown): SignalResult {
  return applyDecisionAnswers(state, input);
}

export function applyPhaseOutput(state: WorkflowState, phase: string, input: unknown): SignalResult {
  if (state.phase !== phase) {
    return asSignalResult({
      signal: faultSignal(
        state,
        `phase output for ${phase} is invalid while workflow phase is ${state.phase}`,
        [],
        true,
      ),
    });
  }

  switch (phase) {
    case "clarify":
      return applyClarify(state, input);
    case "execute":
      return applyExecute(state, input);
    case "verify":
      return applyVerify(state, input);
    case "capture":
      return applyCapture(state, input);
    default:
      return asSignalResult({ signal: faultSignal(state, `unsupported phase: ${phase}`, [], false) });
  }
}

export function submitPhaseOutput(state: WorkflowState, phase: string, input: unknown): SignalResult {
  return applyPhaseOutput(state, phase, input);
}

function applyClarify(state: WorkflowState, input: unknown): SignalResult {
  if (state.status !== "phase_clarify") {
    return asSignalResult({
      signal: faultSignal(state, "clarify output is only valid during phase_clarify", [], true),
    });
  }

  const validation = validateClarifyOutput(input);
  if (!validation.ok || !validation.value) {
    return asSignalResult({
      signal: faultSignal(state, "invalid clarify output", validation.issues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "clarify", validation.value);

  if (!validation.value.ready) {
    if (validation.value.decisions.length === 0) {
      return asSignalResult({
        signal: faultSignal(
          state,
          "clarify output is not ready but did not supply any external decisions",
          [],
          true,
        ),
      });
    }
    next.pendingDecisions = validation.value.decisions;
    setPhase(next, "clarify_pending", "clarify");
    return asSignalResult({ state: next, signal: nextSignal(next) });
  }

  next.pendingDecisions = [];
  const approvalGaps = currentApprovalGaps(next);
  if (approvalGaps.length > 0) {
    next.pendingDecisions = approvalPromptsForDocuments(approvalGaps);
    setPhase(next, "clarify_pending", "clarify");
    return asSignalResult({ state: next, signal: nextSignal(next) });
  }
  setPhase(next, "phase_execute", "execute");
  return asSignalResult({ state: next, signal: nextSignal(next) });
}

function applyExecute(state: WorkflowState, input: unknown): SignalResult {
  if (state.status !== "phase_execute") {
    return asSignalResult({
      signal: faultSignal(state, "execute output is only valid during phase_execute", [], true),
    });
  }

  const validation = validateExecuteOutput(input);
  if (!validation.ok || !validation.value) {
    return asSignalResult({
      signal: faultSignal(state, "invalid execute output", validation.issues, true),
    });
  }

  const contractIssues = validateExecuteOutputAgainstContract(currentUnit(state), validation.value);
  if (contractIssues.length > 0) {
    return asSignalResult({
      signal: faultSignal(state, "execute output did not satisfy the approved Example -> test -> code contract", contractIssues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "execute", validation.value);
  setPhase(next, "phase_verify", "verify");
  return asSignalResult({ state: next, signal: nextSignal(next) });
}

function applyVerify(state: WorkflowState, input: unknown): SignalResult {
  if (state.status !== "phase_verify") {
    return asSignalResult({
      signal: faultSignal(state, "verify output is only valid during phase_verify", [], true),
    });
  }

  const validation = validateVerifyOutput(input);
  if (!validation.ok || !validation.value) {
    return asSignalResult({
      signal: faultSignal(state, "invalid verify output", validation.issues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "verify", validation.value);
  next.lastVerifyIssues = validation.value.issues;

  if (validation.value.passed) {
    const allUnitsComplete = completedUnitIds(next).length >= next.units.length;
    if (!allUnitsComplete) {
      advanceToNextUnit(next);
      return asSignalResult({ state: next, signal: nextSignal(next) });
    }
    if (next.captureEnabled) {
      next.verifyAttempts = 0;
      setPhase(next, "phase_capture", "capture");
      return asSignalResult({ state: next, signal: nextSignal(next) });
    }
    next.verifyAttempts = 0;
    next.status = "completed";
    next.updatedAt = nowIso();
    return asSignalResult({ state: next, signal: nextSignal(next) });
  }

  next.verifyAttempts += 1;

  if (validation.value.needsHuman) {
    if (!validation.value.decisions || validation.value.decisions.length === 0) {
      next.status = "blocked";
      next.blockedReason = validation.value.summary;
      next.updatedAt = nowIso();
      return asSignalResult({ state: next, signal: nextSignal(next) });
    }
    next.pendingDecisions = validation.value.decisions;
    setPhase(next, "clarify_pending", "clarify");
    return asSignalResult({ state: next, signal: nextSignal(next) });
  }

  if (next.verifyAttempts >= next.maxVerifyAttempts) {
    next.status = "blocked";
    next.blockedReason = validation.value.retryHint || validation.value.summary;
    next.updatedAt = nowIso();
    return asSignalResult({ state: next, signal: nextSignal(next) });
  }

  setPhase(next, "phase_clarify", "clarify");
  return asSignalResult({ state: next, signal: nextSignal(next) });
}

function applyCapture(state: WorkflowState, input: unknown): SignalResult {
  if (state.status !== "phase_capture") {
    return asSignalResult({
      signal: faultSignal(state, "capture output is only valid during phase_capture", [], true),
    });
  }

  const validation = validateCaptureOutput(input);
  if (!validation.ok || !validation.value) {
    return asSignalResult({
      signal: faultSignal(state, "invalid capture output", validation.issues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "capture", validation.value);
  next.status = "completed";
  next.updatedAt = nowIso();
  return asSignalResult({ state: next, signal: nextSignal(next) });
}
