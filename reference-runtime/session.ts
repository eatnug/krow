import { createWorkflow, nextSignal, stopWorkflow } from "./orchestrator";
import { buildIntakePlan } from "./policies";
import { routeRequest } from "./router";
import { StartFromMessageInput, StartFromMessageResult, WorkflowState } from "./types";
import { resolveEntryPolicy, resolvePhasePolicy } from "./tool-policy";

function normalizeTitle(objective: string): string {
  const compact = objective.replace(/\s+/g, " ").trim();
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

export function startFromMessage(input: StartFromMessageInput): StartFromMessageResult {
  const route = routeRequest(input.message, {
    explicitIntent: input.explicitIntent,
    allowHeuristics: input.allowHeuristics ?? false,
  });
  const intake = buildIntakePlan(route);
  const entryPolicy = resolveEntryPolicy(route);

  if (route.kind !== "work" || intake.needsUserInput) {
    return {
      route,
      intake,
      entryPolicy,
      blockedByQuestions: intake.needsUserInput,
    };
  }

  const { state, signal } = createWorkflow({
    mode: input.mode ?? "work",
    description: intake.objective,
    units: [
      {
        id: "unit-001",
        title: normalizeTitle(intake.objective),
        request: route.normalizedMessage,
        anchors: intake.anchors,
        intakeIntents: intake.intents,
        intakeNotes: intake.notes,
      },
    ],
    captureEnabled: input.captureEnabled ?? false,
    maxVerifyAttempts: input.maxVerifyAttempts ?? 3,
  });

  return {
    route,
    intake,
    entryPolicy,
    phasePolicy: resolvePhasePolicy(state.phase),
    state,
    signal,
    blockedByQuestions: false,
  };
}

export function resumeWorkflow(state: WorkflowState) {
  return nextSignal(state);
}

export function stopSession(state: WorkflowState, reason?: string) {
  return stopWorkflow(state, reason);
}

export function summarizeWorkflowState(state: WorkflowState) {
  const unit = state.units[state.currentUnitIndex];
  return {
    workflowId: state.workflowId,
    mode: state.mode,
    description: state.description,
    status: state.status,
    phase: state.phase,
    currentUnit: unit
      ? {
          id: unit.id,
          title: unit.title,
        }
      : undefined,
    verifyAttempts: state.verifyAttempts,
    maxVerifyAttempts: state.maxVerifyAttempts,
    pendingDecisionCount: state.pendingDecisions.length,
    outputUnitCount: Object.keys(state.outputs).length,
    blockedReason: state.blockedReason,
  };
}
