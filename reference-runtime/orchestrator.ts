import {
  CaptureOutput,
  ClarifyOutput,
  ControlSignal,
  CreateWorkflowInput,
  ExecuteOutput,
  FaultSignal,
  Phase,
  RunSignal,
  VerifyOutput,
  WorkflowState,
  WorkflowStatus,
} from "./types";
import {
  validateCaptureOutput,
  validateClarifyOutput,
  validateDecisionAnswers,
  validateExecuteOutput,
  validateVerifyOutput,
  validateWorkflowState,
} from "./validators";
import { workflowStatePath } from "./state-store";

type PhasePayload = ClarifyOutput | ExecuteOutput | VerifyOutput | CaptureOutput;

function cloneState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createWorkflowId(): string {
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentUnit(state: WorkflowState) {
  return state.units[state.currentUnitIndex];
}

function currentUnitOutputBucket(state: WorkflowState): Record<string, unknown> {
  const unit = currentUnit(state);
  if (!state.outputs[unit.id]) {
    state.outputs[unit.id] = {};
  }
  return state.outputs[unit.id] as Record<string, unknown>;
}

function storePhaseOutput(state: WorkflowState, phase: Phase, payload: PhasePayload): void {
  currentUnitOutputBucket(state)[phase] = payload;
}

function schemaForPhase(phase: Phase): string {
  return `schemas/payloads/${phase}-output.schema.json`;
}

function promptForPhase(phase: Phase): string {
  switch (phase) {
    case "clarify":
      return "prompts/clarify.md";
    case "execute":
      return "prompts/executor.md";
    case "verify":
      return "prompts/verifier.md";
    case "capture":
      return "prompts/capture.md";
    default:
      return "prompts/clarify.md";
  }
}

function runSignal(state: WorkflowState, phase: Phase, instructions: string): RunSignal {
  return {
    type: "run",
    workflow_id: state.workflowId,
    mode: state.mode,
    unit_id: currentUnit(state)?.id,
    phase,
    prompt_ref: promptForPhase(phase),
    required_schema: schemaForPhase(phase),
    state_ref: workflowStatePath(state.workflowId),
    on_complete: {
      kind: "phase_output",
      phase,
    },
    instructions,
  };
}

function faultSignal(state: WorkflowState | undefined, error: string, issues: string[], recoverable: boolean): FaultSignal {
  return {
    type: "fault",
    workflow_id: state?.workflowId,
    mode: state?.mode,
    unit_id: state ? currentUnit(state)?.id : undefined,
    phase: state?.phase,
    expected_schema: state ? schemaForPhase(state.phase) : undefined,
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
    outputs: Object.keys(state.outputs),
    message:
      state.status === "blocked"
        ? state.blockedReason || "workflow blocked"
        : state.status === "stopped"
          ? "workflow stopped"
          : "workflow completed",
  };
}

export function validateState(state: unknown): FaultSignal | undefined {
  const result = validateWorkflowState(state);
  if (result.ok) {
    return undefined;
  }
  return faultSignal(undefined, "invalid workflow state", result.issues, false);
}

export function createWorkflow(input: CreateWorkflowInput): { state: WorkflowState; signal: ControlSignal } {
  const timestamp = input.createdAt ?? nowIso();
  const state: WorkflowState = {
    schemaVersion: "1.0.0",
    workflowId: input.workflowId ?? createWorkflowId(),
    mode: input.mode,
    description: input.description,
    status: "phase_clarify",
    phase: "clarify",
    units: input.units,
    currentUnitIndex: 0,
    captureEnabled: input.captureEnabled ?? false,
    maxVerifyAttempts: input.maxVerifyAttempts ?? 3,
    verifyAttempts: 0,
    pendingDecisions: [],
    decisionHistory: [],
    outputs: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const stateValidation = validateWorkflowState(state);
  if (!stateValidation.ok) {
    return {
      state,
      signal: faultSignal(state, "new workflow failed validation", stateValidation.issues, false),
    };
  }

  return { state, signal: nextSignal(state) };
}

export function nextSignal(state: WorkflowState): ControlSignal {
  const stateValidation = validateWorkflowState(state);
  if (!stateValidation.ok) {
    return faultSignal(state, "invalid workflow state", stateValidation.issues, false);
  }

  switch (state.status) {
    case "phase_clarify":
      return runSignal(state, "clarify", "Tighten the current unit until execution is safe and verification is clear.");
    case "clarify_pending":
      return {
        type: "gate",
        gate: "clarify",
        workflow_id: state.workflowId,
        mode: state.mode,
        unit_id: currentUnit(state)?.id,
        options: state.pendingDecisions.map((decision) => decision.id),
        state_ref: workflowStatePath(state.workflowId),
        instructions: "Collect the pending external decisions, then submit decision answers and resume clarify.",
      };
    case "phase_execute":
      return runSignal(state, "execute", "Perform only the clarified unit of work and leave evidence for verification.");
    case "phase_verify":
      return runSignal(state, "verify", "Try to disprove the claimed result and report recoverable issues precisely.");
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

export function stopWorkflow(state: WorkflowState, reason = "workflow stopped"): { state: WorkflowState; signal: ControlSignal } {
  const next = cloneState(state);
  next.status = "stopped";
  next.blockedReason = reason;
  next.updatedAt = nowIso();
  return { state: next, signal: nextSignal(next) };
}

function setPhase(state: WorkflowState, status: WorkflowStatus, phase: Phase): void {
  state.status = status;
  state.phase = phase;
  state.updatedAt = nowIso();
}

function advanceToNextUnit(state: WorkflowState): void {
  state.currentUnitIndex += 1;
  state.verifyAttempts = 0;
  setPhase(state, "phase_clarify", "clarify");
}

export function applyDecisionAnswers(state: WorkflowState, input: unknown): { state?: WorkflowState; signal: ControlSignal } {
  if (state.status !== "clarify_pending") {
    return {
      signal: faultSignal(state, "decision answers are only valid during clarify_pending", [], true),
    };
  }

  const validation = validateDecisionAnswers(input);
  if (!validation.ok || !validation.value) {
    return {
      signal: faultSignal(state, "invalid decision answers", validation.issues, true),
    };
  }

  const next = cloneState(state);
  next.decisionHistory.push(...validation.value);
  next.pendingDecisions = [];
  setPhase(next, "phase_clarify", "clarify");
  return { state: next, signal: nextSignal(next) };
}

export function applyPhaseOutput(
  state: WorkflowState,
  phase: Phase,
  input: unknown,
): { state?: WorkflowState; signal: ControlSignal } {
  if (state.phase !== phase) {
    return {
      signal: faultSignal(
        state,
        `phase output for ${phase} is invalid while workflow phase is ${state.phase}`,
        [],
        true,
      ),
    };
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
      return { signal: faultSignal(state, `unsupported phase: ${phase}`, [], false) };
  }
}

function applyClarify(state: WorkflowState, input: unknown): { state?: WorkflowState; signal: ControlSignal } {
  if (state.status !== "phase_clarify") {
    return { signal: faultSignal(state, "clarify output is only valid during phase_clarify", [], true) };
  }

  const validation = validateClarifyOutput(input);
  if (!validation.ok || !validation.value) {
    return { signal: faultSignal(state, "invalid clarify output", validation.issues, true) };
  }

  const next = cloneState(state);
  storePhaseOutput(next, "clarify", validation.value);

  if (!validation.value.ready) {
    if (validation.value.decisions.length === 0) {
      return {
        signal: faultSignal(
          state,
          "clarify output is not ready but did not supply any external decisions",
          [],
          true,
        ),
      };
    }
    next.pendingDecisions = validation.value.decisions;
    setPhase(next, "clarify_pending", "clarify");
    return { state: next, signal: nextSignal(next) };
  }

  next.pendingDecisions = [];
  setPhase(next, "phase_execute", "execute");
  return { state: next, signal: nextSignal(next) };
}

function applyExecute(state: WorkflowState, input: unknown): { state?: WorkflowState; signal: ControlSignal } {
  if (state.status !== "phase_execute") {
    return { signal: faultSignal(state, "execute output is only valid during phase_execute", [], true) };
  }

  const validation = validateExecuteOutput(input);
  if (!validation.ok || !validation.value) {
    return { signal: faultSignal(state, "invalid execute output", validation.issues, true) };
  }

  const next = cloneState(state);
  storePhaseOutput(next, "execute", validation.value);
  setPhase(next, "phase_verify", "verify");
  return { state: next, signal: nextSignal(next) };
}

function applyVerify(state: WorkflowState, input: unknown): { state?: WorkflowState; signal: ControlSignal } {
  if (state.status !== "phase_verify") {
    return { signal: faultSignal(state, "verify output is only valid during phase_verify", [], true) };
  }

  const validation = validateVerifyOutput(input);
  if (!validation.ok || !validation.value) {
    return { signal: faultSignal(state, "invalid verify output", validation.issues, true) };
  }

  const next = cloneState(state);
  storePhaseOutput(next, "verify", validation.value);
  next.lastVerifyIssues = validation.value.issues;

  if (validation.value.passed) {
    const isLastUnit = next.currentUnitIndex >= next.units.length - 1;
    if (!isLastUnit) {
      advanceToNextUnit(next);
      return { state: next, signal: nextSignal(next) };
    }
    if (next.captureEnabled) {
      next.verifyAttempts = 0;
      setPhase(next, "phase_capture", "capture");
      return { state: next, signal: nextSignal(next) };
    }
    next.verifyAttempts = 0;
    next.status = "completed";
    next.updatedAt = nowIso();
    return { state: next, signal: nextSignal(next) };
  }

  next.verifyAttempts += 1;

  if (validation.value.needsHuman) {
    if (!validation.value.decisions || validation.value.decisions.length === 0) {
      next.status = "blocked";
      next.blockedReason = validation.value.summary;
      next.updatedAt = nowIso();
      return { state: next, signal: nextSignal(next) };
    }
    next.pendingDecisions = validation.value.decisions;
    setPhase(next, "clarify_pending", "clarify");
    return { state: next, signal: nextSignal(next) };
  }

  if (next.verifyAttempts >= next.maxVerifyAttempts) {
    next.status = "blocked";
    next.blockedReason = validation.value.retryHint || validation.value.summary;
    next.updatedAt = nowIso();
    return { state: next, signal: nextSignal(next) };
  }

  setPhase(next, "phase_clarify", "clarify");
  return { state: next, signal: nextSignal(next) };
}

function applyCapture(state: WorkflowState, input: unknown): { state?: WorkflowState; signal: ControlSignal } {
  if (state.status !== "phase_capture") {
    return { signal: faultSignal(state, "capture output is only valid during phase_capture", [], true) };
  }

  const validation = validateCaptureOutput(input);
  if (!validation.ok || !validation.value) {
    return { signal: faultSignal(state, "invalid capture output", validation.issues, true) };
  }

  const next = cloneState(state);
  storePhaseOutput(next, "capture", validation.value);
  next.status = "completed";
  next.updatedAt = nowIso();
  return { state: next, signal: nextSignal(next) };
}
