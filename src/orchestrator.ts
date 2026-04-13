import type {
  CaptureOutput,
  ClarifyOutput,
  ControlSignal,
  CreateWorkflowInput,
  ExecuteOutput,
  FaultSignal,
  Phase,
  ProtocolResponse,
  RunSignal,
  RuntimePhase,
  VerifyOutput,
  WorkflowState,
  WorkflowStatus,
  WorkflowUnit,
  WorkItem,
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
type CompatResult = { state?: WorkflowState; response: ProtocolResponse };
type CombinedResult = SignalResult & CompatResult;
type CreatedWorkflow = { state: WorkflowState; signal: ControlSignal; response: ProtocolResponse };

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

function schemaForPhase(phase: RuntimePhase): string {
  return `schemas/payloads/${phase}-output.schema.json`;
}

function promptForPhase(phase: RuntimePhase): string {
  switch (phase) {
    case "clarify":
      return "prompts/clarify.md";
    case "execute":
      return "prompts/executor.md";
    case "verify":
      return "prompts/verifier.md";
    case "capture":
      return "prompts/capture.md";
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
    prompt_ref: promptForPhase(phase),
    required_schema: schemaForPhase(phase),
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
    expected_schema: state && toRuntimePhase(state.phase) ? schemaForPhase(toRuntimePhase(state.phase)!) : undefined,
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

function withResponse(result: SignalResult): CombinedResult {
  return { ...result, response: result.signal };
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
    return { state, signal, response: signal };
  }

  const signal = nextSignal(state);
  return { state, signal, response: signal };
}

export function nextSignal(state: WorkflowState): ControlSignal {
  const stateValidation = validateWorkflowState(state);
  if (!stateValidation.ok) {
    return faultSignal(state, "invalid workflow state", stateValidation.issues, false);
  }

  switch (state.status) {
    case "phase_clarify":
      return runSignal(
        state,
        "clarify",
        "Tighten the current unit until execution is safe, verification is clear, and blocked sibling units are not pulled into scope.",
      );
    case "clarify_pending":
      return {
        type: "gate",
        gate: "clarify",
        workflow_id: state.workflowId,
        mode: state.mode,
        unit_id: currentUnit(state)?.id,
        options: state.pendingDecisions.map((decision) => decision.id),
        state_ref: workflowStatePath(state.workflowId),
        workflow_task_index_ref: workflowTaskIndexPath(state.workflowId),
        task_status_ref: currentUnit(state) ? unitStatusPath(state.workflowId, currentUnit(state)!.id) : undefined,
        instructions: "Collect the pending external decisions, then submit decision answers and resume clarify.",
      };
    case "phase_execute":
      return runSignal(
        state,
        "execute",
        "Perform only the clarified unit of work. If the graph exposes other ready units, treat them as scheduler metadata for the host rather than silently expanding this unit.",
      );
    case "phase_verify":
      return runSignal(
        state,
        "verify",
        "Try to disprove the claimed result for the current unit and report recoverable issues precisely enough to drive the next clarify pass.",
      );
    case "phase_capture":
      return runSignal(state, "capture", "Capture only durable, reusable patterns worth saving.");
    case "completed":
    case "blocked":
    case "stopped":
      return terminalSignal(state);
    default:
      return faultSignal(state, `unsupported status: ${String(state.status)}`, [], false);
  }
}

export function nextResponse(state: WorkflowState): ProtocolResponse {
  return nextSignal(state);
}

export function stopWorkflow(state: WorkflowState, reason = "workflow stopped"): CreatedWorkflow {
  const next = cloneState(state);
  next.status = "stopped";
  next.blockedReason = reason;
  next.updatedAt = nowIso();
  const signal = nextSignal(next);
  return { state: next, signal, response: signal };
}

export function applyDecisionAnswers(state: WorkflowState, input: unknown): CombinedResult {
  if (state.status !== "clarify_pending") {
    return withResponse({
      signal: faultSignal(state, "decision answers are only valid during clarify_pending", [], true),
    });
  }

  const validation = validateDecisionAnswers(input);
  if (!validation.ok || !validation.value) {
    return withResponse({
      signal: faultSignal(state, "invalid decision answers", validation.issues, true),
    });
  }

  const next = cloneState(state);
  next.decisionHistory.push(...validation.value);
  next.pendingDecisions = [];
  setPhase(next, "phase_clarify", "clarify");
  return withResponse({ state: next, signal: nextSignal(next) });
}

export function submitDecisions(state: WorkflowState, input: unknown): CombinedResult {
  return applyDecisionAnswers(state, input);
}

export function applyPhaseOutput(state: WorkflowState, phase: string, input: unknown): CombinedResult {
  if (state.phase !== phase) {
    return withResponse({
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
      return withResponse({ signal: faultSignal(state, `unsupported phase: ${phase}`, [], false) });
  }
}

export function submitPhaseOutput(state: WorkflowState, phase: string, input: unknown): CombinedResult {
  return applyPhaseOutput(state, phase, input);
}

function applyClarify(state: WorkflowState, input: unknown): CombinedResult {
  if (state.status !== "phase_clarify") {
    return withResponse({
      signal: faultSignal(state, "clarify output is only valid during phase_clarify", [], true),
    });
  }

  const validation = validateClarifyOutput(input);
  if (!validation.ok || !validation.value) {
    return withResponse({
      signal: faultSignal(state, "invalid clarify output", validation.issues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "clarify", validation.value);

  if (!validation.value.ready) {
    if (validation.value.decisions.length === 0) {
      return withResponse({
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
    return withResponse({ state: next, signal: nextSignal(next) });
  }

  next.pendingDecisions = [];
  setPhase(next, "phase_execute", "execute");
  return withResponse({ state: next, signal: nextSignal(next) });
}

function applyExecute(state: WorkflowState, input: unknown): CombinedResult {
  if (state.status !== "phase_execute") {
    return withResponse({
      signal: faultSignal(state, "execute output is only valid during phase_execute", [], true),
    });
  }

  const validation = validateExecuteOutput(input);
  if (!validation.ok || !validation.value) {
    return withResponse({
      signal: faultSignal(state, "invalid execute output", validation.issues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "execute", validation.value);
  setPhase(next, "phase_verify", "verify");
  return withResponse({ state: next, signal: nextSignal(next) });
}

function applyVerify(state: WorkflowState, input: unknown): CombinedResult {
  if (state.status !== "phase_verify") {
    return withResponse({
      signal: faultSignal(state, "verify output is only valid during phase_verify", [], true),
    });
  }

  const validation = validateVerifyOutput(input);
  if (!validation.ok || !validation.value) {
    return withResponse({
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
      return withResponse({ state: next, signal: nextSignal(next) });
    }
    if (next.captureEnabled) {
      next.verifyAttempts = 0;
      setPhase(next, "phase_capture", "capture");
      return withResponse({ state: next, signal: nextSignal(next) });
    }
    next.verifyAttempts = 0;
    next.status = "completed";
    next.updatedAt = nowIso();
    return withResponse({ state: next, signal: nextSignal(next) });
  }

  next.verifyAttempts += 1;

  if (validation.value.needsHuman) {
    if (!validation.value.decisions || validation.value.decisions.length === 0) {
      next.status = "blocked";
      next.blockedReason = validation.value.summary;
      next.updatedAt = nowIso();
      return withResponse({ state: next, signal: nextSignal(next) });
    }
    next.pendingDecisions = validation.value.decisions;
    setPhase(next, "clarify_pending", "clarify");
    return withResponse({ state: next, signal: nextSignal(next) });
  }

  if (next.verifyAttempts >= next.maxVerifyAttempts) {
    next.status = "blocked";
    next.blockedReason = validation.value.retryHint || validation.value.summary;
    next.updatedAt = nowIso();
    return withResponse({ state: next, signal: nextSignal(next) });
  }

  setPhase(next, "phase_clarify", "clarify");
  return withResponse({ state: next, signal: nextSignal(next) });
}

function applyCapture(state: WorkflowState, input: unknown): CombinedResult {
  if (state.status !== "phase_capture") {
    return withResponse({
      signal: faultSignal(state, "capture output is only valid during phase_capture", [], true),
    });
  }

  const validation = validateCaptureOutput(input);
  if (!validation.ok || !validation.value) {
    return withResponse({
      signal: faultSignal(state, "invalid capture output", validation.issues, true),
    });
  }

  const next = cloneState(state);
  storePhaseOutput(next, "capture", validation.value);
  next.status = "completed";
  next.updatedAt = nowIso();
  return withResponse({ state: next, signal: nextSignal(next) });
}
