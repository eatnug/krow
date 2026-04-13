import type {
  ControlSignal,
  DoneSignal,
  FaultSignal,
  GateSignal,
  RuntimePhase,
  RunSignal,
  WorkflowState,
} from "./types.js";
import {
  clarifyGateInstructions,
  doneInstructions,
  faultInstructions,
  runSignalInstructions,
  submitDecisionsCommand,
} from "./instructions.js";
import { promptRefForPhase, schemaRefForPhase } from "./prompts.js";
import { workflowStatePath } from "./state-store.js";

function currentUnitId(state: WorkflowState): string | undefined {
  return state.units[state.currentUnitIndex]?.id;
}

export function buildRunSignal(state: WorkflowState, phase: RuntimePhase = state.phase): RunSignal {
  const stateRef = workflowStatePath(state.workflowId);
  return {
    type: "run",
    workflow_id: state.workflowId,
    mode: state.mode,
    unit_id: currentUnitId(state),
    phase,
    prompt_ref: promptRefForPhase(phase),
    required_schema: schemaRefForPhase(phase),
    state_ref: stateRef,
    on_complete: {
      kind: "phase_output",
      phase,
    },
    instructions: runSignalInstructions(state.workflowId, phase, schemaRefForPhase(phase), stateRef),
  };
}

export function buildClarifyGateSignal(state: WorkflowState): GateSignal {
  const stateRef = workflowStatePath(state.workflowId);
  return {
    type: "gate",
    gate: "clarify",
    workflow_id: state.workflowId,
    mode: state.mode,
    unit_id: currentUnitId(state),
    options: state.pendingDecisions.map((decision) => decision.id),
    state_ref: stateRef,
    on_complete: {
      kind: "decision_answers",
      command: submitDecisionsCommand(state.workflowId),
    },
    instructions: clarifyGateInstructions(state.workflowId, stateRef),
  };
}

export function buildDoneSignal(state: WorkflowState): DoneSignal {
  const stateRef = workflowStatePath(state.workflowId);
  return {
    type: "done",
    workflow_id: state.workflowId,
    mode: state.mode,
    status: state.status === "blocked" ? "blocked" : state.status === "stopped" ? "stopped" : "completed",
    state_ref: stateRef,
    outputs: Object.keys(state.outputs),
    message:
      state.status === "blocked"
        ? state.blockedReason || "workflow blocked"
        : state.status === "stopped"
          ? "workflow stopped"
          : "workflow completed",
  };
}

export function buildFaultSignal(
  state: WorkflowState | undefined,
  error: string,
  issues: string[] = [],
  recoverable: boolean,
): FaultSignal {
  const phase = state?.phase;

  return {
    type: "fault",
    workflow_id: state?.workflowId,
    mode: state?.mode,
    unit_id: state ? currentUnitId(state) : undefined,
    phase,
    expected_schema: phase ? schemaRefForPhase(phase) : undefined,
    issues,
    error,
    recoverable,
  };
}

export function attachSignalInstructions(signal: ControlSignal): ControlSignal {
  switch (signal.type) {
    case "run":
      return {
        ...signal,
        instructions: runSignalInstructions(
          signal.workflow_id,
          signal.phase,
          signal.required_schema,
          signal.state_ref,
        ),
      };
    case "gate":
      if (signal.gate === "clarify") {
        return {
          ...signal,
          instructions: clarifyGateInstructions(signal.workflow_id, signal.state_ref),
        };
      }
      return signal;
    case "done":
      return {
        ...signal,
        message: signal.message,
      };
    case "fault":
      return signal;
  }
}

export function signalForState(state: WorkflowState): ControlSignal {
  switch (state.status) {
    case "phase_clarify":
      return buildRunSignal(state, "clarify");
    case "clarify_pending":
      return buildClarifyGateSignal(state);
    case "phase_execute":
      return buildRunSignal(state, "execute");
    case "phase_verify":
      return buildRunSignal(state, "verify");
    case "phase_capture":
      return buildRunSignal(state, "capture");
    case "completed":
    case "blocked":
    case "stopped":
      return buildDoneSignal(state);
  }
}

export function doneSignalInstructions(signal: DoneSignal): string {
  return doneInstructions(signal.workflow_id, signal.state_ref);
}

export function faultSignalInstructions(signal: FaultSignal): string {
  return faultInstructions(signal.workflow_id, signal.recoverable);
}
