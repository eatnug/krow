import type {
  Phase,
  WorkflowState,
  WorkflowStatus,
  WorkItem,
  WorkItemState,
  Task,
  ProtocolResponse,
} from "./types.js";
import {
  validateWorkItems,
  allItemsHaveResults,
  validateClarifyOutput,
  validatePlanOutput,
  validateExecuteOutput,
  validateVerifyOutput,
  validateDecisionAnswers,
  validateWorkflowState,
} from "./validators.js";
import { buildPhaseResponse, buildBatchResponse, buildWorkItemBatchResponse, buildSynthesizeResponse, buildGateResponse, buildDoneResponse, buildFaultResponse } from "./responses.js";

// ============================================================================
// Helpers
// ============================================================================

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function now(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function setPhase(state: WorkflowState, status: WorkflowStatus, phase: Phase): void {
  state.status = status;
  state.phase = phase;
  state.updatedAt = now();
}

function findTask(state: WorkflowState, taskId: string): Task | undefined {
  return state.tasks.find((t) => t.id === taskId);
}

function readyTasks(state: WorkflowState): Task[] {
  const doneIds = new Set(state.tasks.filter((t) => t.status === "done").map((t) => t.id));
  return state.tasks.filter(
    (t) => t.status === "pending" && t.dependsOn.every((dep) => doneIds.has(dep)),
  );
}

function allTasksDone(state: WorkflowState): boolean {
  return state.tasks.length > 0 && state.tasks.every((t) => t.status === "done");
}

type Result = { state: WorkflowState; response: ProtocolResponse };
type MaybeResult = { state?: WorkflowState; response: ProtocolResponse };

// ============================================================================
// Public API
// ============================================================================

export function createWorkflow(description: string): Result {
  const timestamp = now();
  const state: WorkflowState = {
    schemaVersion: "1.0.0",
    workflowId: makeId(),
    description,
    status: "phase_clarify",
    phase: "clarify",
    pendingDecisions: [],
    decisionHistory: [],
    tasks: [],
    escalateAfter: 3,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const v = validateWorkflowState(state);
  if (!v.ok) {
    return { state, response: buildFaultResponse(state, "invalid initial state", v.issues, false) };
  }

  return { state, response: nextResponse(state) };
}

export function nextResponse(state: WorkflowState): ProtocolResponse {
  switch (state.status) {
    case "phase_clarify":
      return buildPhaseResponse(state, "clarify");
    case "gate_clarify":
      return buildGateResponse(state, "clarify");
    case "phase_plan":
      return buildPhaseResponse(state, "plan");
    case "gate_plan":
      return buildGateResponse(state, "plan");
    case "phase_execute":
    case "phase_verify":
      return buildNextTaskResponses(state);
    case "phase_synthesize":
      return buildSynthesizeFromState(state);
    case "gate_verify":
      return buildVerifyGate(state);
    case "completed":
    case "blocked":
    case "stopped":
      return buildDoneResponse(state);
    default:
      return buildFaultResponse(state, `unknown status: ${state.status}`, [], false);
  }
}

function buildNextTaskResponses(state: WorkflowState): ProtocolResponse {
  const actionable: { task: Task; phase: Phase }[] = [];

  for (const task of state.tasks) {
    if (task.status === "executing") actionable.push({ task, phase: "execute" });
    else if (task.status === "verifying") actionable.push({ task, phase: "verify" });
  }

  const ready = readyTasks(state);
  for (const task of ready) {
    task.status = "executing";
    actionable.push({ task, phase: "execute" });
  }

  if (actionable.length === 0) {
    if (allTasksDone(state)) {
      state.status = "completed";
      state.updatedAt = now();
      return buildDoneResponse(state);
    }
    return buildFaultResponse(state, "no actionable tasks", [], false);
  }

  if (actionable.length === 1) {
    return buildPhaseResponse(state, actionable[0].phase, actionable[0].task.id);
  }

  return buildBatchResponse(state, actionable.map((a) => ({ phase: a.phase, taskId: a.task.id })));
}

function buildVerifyGate(state: WorkflowState): ProtocolResponse {
  const stuck = state.tasks.find((t) => t.status === "verifying" && t.verifyAttempts >= state.escalateAfter);
  if (!stuck) return buildFaultResponse(state, "gate_verify but no stuck task found", [], false);
  return buildGateResponse(state, "verify", stuck.id);
}

function buildSynthesizeFromState(state: WorkflowState): ProtocolResponse {
  if (!state.activeWork) return buildFaultResponse(state, "phase_synthesize but no active work", [], false);
  return buildSynthesizeResponse(state, state.activeWork);
}

// ============================================================================
// Phase output: always WorkItem[]
// ============================================================================

/**
 * Submit work items for a phase. This is the universal entry point.
 * AI always returns WorkItem[].
 * - 1 item with result → proceed directly (single agent did the work)
 * - 1 item without result → spawn it, wait for result
 * - N items → spawn all, wait for results, then synthesize
 */
export function submitWorkItems(state: WorkflowState, phase: Phase, input: unknown, taskId?: string): MaybeResult {
  const v = validateWorkItems(input);
  if (!v.ok || !v.value) {
    return { response: buildFaultResponse(state, "invalid work items", v.issues, true) };
  }

  const items = v.value;

  if (items.length === 1 && allItemsHaveResults(items)) {
    // Single item with inline result → treat as direct phase output
    return submitPhaseOutput(state, phase, items[0].result, taskId);
  }

  // Multiple items or items without results → create work items, batch spawn
  const next = clone(state);
  next.activeWork = {
    phase,
    taskId,
    synthesize: `Combine the results from ${items.length} work items into a single ${phase} output.`,
    items: items.map((item) => ({
      id: item.id,
      role: item.role,
      task: item.task,
      status: (item.result !== undefined ? "done" : "pending") as "pending" | "running" | "done",
      result: item.result !== undefined ? JSON.stringify(item.result) : undefined,
    })),
  };

  // Check if all items already have results (all done inline)
  if (next.activeWork.items.every((i) => i.status === "done")) {
    next.status = "phase_synthesize";
    next.updatedAt = now();
    return { state: next, response: nextResponse(next) };
  }

  // Mark pending as running, return batch
  for (const item of next.activeWork.items) {
    if (item.status === "pending") item.status = "running";
  }
  next.status = "phase_synthesize"; // will route to synthesize when all done
  next.updatedAt = now();
  return { state: next, response: buildWorkItemBatchResponse(next, next.activeWork) };
}

/**
 * Submit a single work item result.
 */
export function submitWorkItemResult(state: WorkflowState, itemId: string, result: string): MaybeResult {
  if (!state.activeWork) {
    return { response: buildFaultResponse(state, "no active work items", [], true) };
  }

  const next = clone(state);
  const item = next.activeWork!.items.find((i) => i.id === itemId);
  if (!item) {
    return { response: buildFaultResponse(next, `work item ${itemId} not found`, [], true) };
  }

  item.status = "done";
  item.result = result;
  next.updatedAt = now();

  // Check if all items done → synthesize
  if (next.activeWork!.items.every((i) => i.status === "done")) {
    next.status = "phase_synthesize";
    return { state: next, response: nextResponse(next) };
  }

  // Still items running — return current state
  return { state: next, response: buildWorkItemBatchResponse(next, next.activeWork!) };
}

/**
 * Submit synthesized result — this continues the normal phase flow.
 */
export function submitSynthesizedResult(state: WorkflowState, input: unknown): MaybeResult {
  if (!state.activeWork) {
    return { response: buildFaultResponse(state, "no active work to synthesize", [], true) };
  }

  const work = state.activeWork;
  const next = clone(state);
  next.activeWork = undefined;

  // Route to the original phase handler
  const phaseStatus = `phase_${work.phase}` as WorkflowStatus;
  next.status = phaseStatus;
  next.phase = work.phase;

  return submitPhaseOutput(next, work.phase, input, work.taskId);
}

// ============================================================================
// Direct phase output (single item with result, or synthesized)
// ============================================================================

export function submitPhaseOutput(state: WorkflowState, phase: Phase, input: unknown, taskId?: string): MaybeResult {
  switch (phase) {
    case "clarify": return applyClarify(state, input);
    case "plan": return applyPlan(state, input);
    case "execute": return applyExecute(state, input, taskId);
    case "verify": return applyVerify(state, input, taskId);
    default:
      return { response: buildFaultResponse(state, `unsupported phase: ${phase}`, [], false) };
  }
}

export function submitDecisions(state: WorkflowState, input: unknown): MaybeResult {
  if (state.status !== "gate_clarify") {
    return { response: buildFaultResponse(state, "decisions only valid during gate_clarify", [], true) };
  }

  const v = validateDecisionAnswers(input);
  if (!v.ok || !v.value) {
    return { response: buildFaultResponse(state, "invalid decision answers", v.issues, true) };
  }

  const next = clone(state);
  next.decisionHistory.push(...v.value);
  next.pendingDecisions = [];
  setPhase(next, "phase_clarify", "clarify");
  return { state: next, response: nextResponse(next) };
}

export function approvePlan(state: WorkflowState): MaybeResult {
  if (state.status !== "gate_plan") {
    return { response: buildFaultResponse(state, "approve-plan only valid during gate_plan", [], true) };
  }

  const next = clone(state);
  if (next.tasks.length === 0) {
    return { response: buildFaultResponse(next, "no tasks to execute", [], true) };
  }

  const ready = readyTasks(next);
  for (const task of ready) task.status = "executing";

  setPhase(next, "phase_execute", "execute");
  return { state: next, response: nextResponse(next) };
}

export function adjustPlan(state: WorkflowState, feedback: string): MaybeResult {
  if (state.status !== "gate_plan") {
    return { response: buildFaultResponse(state, "adjust-plan only valid during gate_plan", [], true) };
  }

  const next = clone(state);
  next.planOutput = undefined;
  next.tasks = [];
  next.decisionHistory.push({
    decisionId: "plan-adjustment",
    selectedOptionId: "feedback",
    customInput: feedback,
  });
  setPhase(next, "phase_plan", "plan");
  return { state: next, response: nextResponse(next) };
}

export function resolveVerifyGate(state: WorkflowState, taskId: string, action: "continue" | "stop"): MaybeResult {
  if (state.status !== "gate_verify") {
    return { response: buildFaultResponse(state, "resolve-verify only valid during gate_verify", [], true) };
  }

  const next = clone(state);
  const task = findTask(next, taskId);
  if (!task) {
    return { response: buildFaultResponse(next, `task ${taskId} not found`, [], true) };
  }

  if (action === "stop") {
    task.status = "failed";
    next.status = "blocked";
    next.blockedReason = `User stopped task ${taskId} after ${task.verifyAttempts} verify attempts`;
    next.updatedAt = now();
    return { state: next, response: nextResponse(next) };
  }

  task.status = "executing";
  setPhase(next, "phase_execute", "execute");
  return { state: next, response: nextResponse(next) };
}

export function stopWorkflow(state: WorkflowState, reason = "stopped by user"): Result {
  const next = clone(state);
  next.status = "stopped";
  next.blockedReason = reason;
  next.updatedAt = now();
  return { state: next, response: nextResponse(next) };
}

// ============================================================================
// Phase Handlers
// ============================================================================

function applyClarify(state: WorkflowState, input: unknown): MaybeResult {
  const v = validateClarifyOutput(input);
  if (!v.ok || !v.value) {
    return { response: buildFaultResponse(state, "invalid clarify output", v.issues, true) };
  }

  const next = clone(state);
  next.clarifyOutput = v.value;

  if (!v.value.ready) {
    next.pendingDecisions = v.value.decisions;
    setPhase(next, "gate_clarify", "clarify");
    return { state: next, response: nextResponse(next) };
  }

  next.pendingDecisions = [];
  setPhase(next, "phase_plan", "plan");
  return { state: next, response: nextResponse(next) };
}

function applyPlan(state: WorkflowState, input: unknown): MaybeResult {
  const v = validatePlanOutput(input);
  if (!v.ok || !v.value) {
    return { response: buildFaultResponse(state, "invalid plan output", v.issues, true) };
  }

  const next = clone(state);
  next.planOutput = v.value;
  next.tasks = v.value.tasks.map((td) => ({
    id: td.id,
    title: td.title,
    scope: td.scope,
    context: td.context,
    dependsOn: td.dependsOn,
    status: "pending" as const,
    verifyAttempts: 0,
  }));

  setPhase(next, "gate_plan", "plan");
  return { state: next, response: nextResponse(next) };
}

function applyExecute(state: WorkflowState, input: unknown, taskId?: string): MaybeResult {
  const v = validateExecuteOutput(input);
  if (!v.ok || !v.value) {
    return { response: buildFaultResponse(state, "invalid execute output", v.issues, true) };
  }

  const next = clone(state);
  const resolvedId = taskId ?? next.tasks.find((t) => t.status === "executing")?.id;
  const task = resolvedId ? findTask(next, resolvedId) : undefined;
  if (!task) {
    return { response: buildFaultResponse(next, "no executing task", [], true) };
  }

  task.executeOutput = v.value;
  task.status = "verifying";
  task.verifyAttempts += 1;
  updateWorkflowPhase(next);
  return { state: next, response: nextResponse(next) };
}

function applyVerify(state: WorkflowState, input: unknown, taskId?: string): MaybeResult {
  const v = validateVerifyOutput(input);
  if (!v.ok || !v.value) {
    return { response: buildFaultResponse(state, "invalid verify output", v.issues, true) };
  }

  const next = clone(state);
  const resolvedId = taskId ?? next.tasks.find((t) => t.status === "verifying")?.id;
  const task = resolvedId ? findTask(next, resolvedId) : undefined;
  if (!task) {
    return { response: buildFaultResponse(next, "no verifying task", [], true) };
  }

  task.verifyOutput = v.value;

  if (v.value.passed) {
    task.status = "done";
  } else if (task.verifyAttempts >= next.escalateAfter) {
    next.status = "gate_verify";
    next.phase = "verify";
    next.updatedAt = now();
    return { state: next, response: nextResponse(next) };
  } else {
    task.status = "executing";
  }

  updateWorkflowPhase(next);
  return { state: next, response: nextResponse(next) };
}

function updateWorkflowPhase(state: WorkflowState): void {
  if (allTasksDone(state)) {
    state.status = "completed";
    state.updatedAt = now();
    return;
  }

  const hasExecuting = state.tasks.some((t) => t.status === "executing");
  const hasVerifying = state.tasks.some((t) => t.status === "verifying");
  const hasReady = readyTasks(state).length > 0;

  if (hasExecuting || hasReady) {
    setPhase(state, "phase_execute", "execute");
  } else if (hasVerifying) {
    setPhase(state, "phase_verify", "verify");
  }
}
