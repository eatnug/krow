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
import {
  unitBatonPath,
  unitBriefPath,
  unitContextPath,
  unitRelayPath,
  unitResultPath,
  unitStatusPath,
  workflowStatePath,
  workflowTaskIndexPath,
} from "./state-store.js";
import { buildRunContext } from "./workflow-graph.js";

function currentUnitId(state: WorkflowState): string | undefined {
  return state.units[state.currentUnitIndex]?.id;
}

function pendingDecisionsAreApproval(state: WorkflowState): boolean {
  return state.pendingDecisions.length > 0 && state.pendingDecisions.every((decision) => decision.kind === "approval");
}

export function buildRunSignal(state: WorkflowState, phase: RuntimePhase = state.phase): RunSignal {
  const stateRef = workflowStatePath(state.workflowId);
  const unitId = currentUnitId(state);
  return {
    type: "run",
    workflow_id: state.workflowId,
    mode: state.mode,
    unit_id: unitId,
    phase,
    prompt_ref: promptRefForPhase(phase),
    required_schema: schemaRefForPhase(phase),
    state_ref: stateRef,
    workflow_task_index_ref: workflowTaskIndexPath(state.workflowId),
    task_packet_ref: unitId ? unitBriefPath(state.workflowId, unitId) : undefined,
    task_context_ref: unitId ? unitContextPath(state.workflowId, unitId) : undefined,
    task_status_ref: unitId ? unitStatusPath(state.workflowId, unitId) : undefined,
    task_result_ref: unitId ? unitResultPath(state.workflowId, unitId) : undefined,
    baton_ref: unitId ? unitBatonPath(state.workflowId, unitId) : undefined,
    relay_refs: state.units[state.currentUnitIndex]
      ? (state.units[state.currentUnitIndex].dependsOn ?? []).map((dependencyId) => unitRelayPath(state.workflowId, dependencyId))
      : undefined,
    context: buildRunContext(state),
    on_complete: {
      kind: "phase_output",
      phase,
    },
    instructions: runSignalInstructions(state.workflowId, phase, schemaRefForPhase(phase), stateRef, buildRunContext(state)),
  };
}

export function buildClarifyGateSignal(state: WorkflowState): GateSignal {
  const stateRef = workflowStatePath(state.workflowId);
  const unitId = currentUnitId(state);
  return {
    type: "gate",
    gate: pendingDecisionsAreApproval(state) ? "approve" : "clarify",
    workflow_id: state.workflowId,
    mode: state.mode,
    unit_id: unitId,
    options: state.pendingDecisions.map((decision) => decision.id),
    decisions: state.pendingDecisions,
    state_ref: stateRef,
    workflow_task_index_ref: workflowTaskIndexPath(state.workflowId),
    task_status_ref: unitId ? unitStatusPath(state.workflowId, unitId) : undefined,
    on_complete: {
      kind: "decision_answers",
      command: submitDecisionsCommand(state.workflowId),
    },
    instructions: pendingDecisionsAreApproval(state)
      ? `Collect the pending PRD/Plan approval decisions, then run ${submitDecisionsCommand(state.workflowId)} with one answer per decision.`
      : clarifyGateInstructions(state.workflowId, stateRef),
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
          signal.context,
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
