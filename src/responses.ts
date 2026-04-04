import type {
  Phase,
  Capability,
  WorkflowState,
  Task,
  ActiveWork,
  PhaseResponse,
  GateResponse,
  BatchResponse,
  DoneResponse,
  FaultResponse,
  ContextSpec,
  OutputSpec,
} from "./types.js";
import { buildClarifyPrompt, buildPlanPrompt, buildExecutePrompt, buildVerifyPrompt } from "./prompts.js";
import {
  submitWorkItemsCommand,
  submitWorkItemResultCommand,
  submitSynthesizedCommand,
  decideCommand,
  approvePlanCommand,
  adjustPlanCommand,
  resolveVerifyCommand,
  phaseInstructions,
  gateClarifyInstructions,
  gatePlanInstructions,
  gateVerifyInstructions,
  batchInstructions,
  synthesizeInstructions,
  doneInstructions,
  faultInstructions,
} from "./instructions.js";

// ============================================================================
// Capability mapping
// ============================================================================

const PHASE_CAPABILITY: Record<Phase, Capability> = {
  clarify: "read",
  plan: "read",
  execute: "write",
  verify: "read",
};

// ============================================================================
// Context spec builders
// ============================================================================

function clarifyContext(): ContextSpec {
  return { isolation: "isolated", inputs: [] };
}

function planContext(state: WorkflowState): ContextSpec {
  const inputs = [];
  if (state.clarifyOutput) inputs.push({ type: "data" as const, ref: "clarifyOutput" });
  return { isolation: "isolated", inputs };
}

function executeContext(state: WorkflowState, task: Task): ContextSpec {
  const inputs = [];
  if (state.clarifyOutput) inputs.push({ type: "data" as const, ref: "clarifyOutput" });
  if (state.planOutput) inputs.push({ type: "data" as const, ref: "planOutput.approach" });
  const ctx = Array.isArray(task.context) ? task.context : task.context ? [task.context] : [];
  for (const c of ctx) inputs.push({ type: "file" as const, ref: c });
  return { isolation: "isolated", inputs };
}

function verifyContext(state: WorkflowState, task: Task): ContextSpec {
  const inputs = [];
  if (task.executeOutput) {
    inputs.push({ type: "data" as const, ref: `tasks.${task.id}.executeOutput` });
    for (const f of task.executeOutput.changedFiles) inputs.push({ type: "file" as const, ref: f });
  }
  if (state.clarifyOutput?.verifyFocus) inputs.push({ type: "data" as const, ref: "clarifyOutput.verifyFocus" });
  return { isolation: "isolated", inputs };
}

// ============================================================================
// Output spec
// ============================================================================

function outputSpec(phase: Phase): OutputSpec {
  return { schema: `${phase}-output`, format: phase === "execute" ? "files" : "json" };
}

// ============================================================================
// Prompt + context dispatch (task-aware)
// ============================================================================

function buildPromptForTask(state: WorkflowState, phase: Phase, task: Task): string {
  switch (phase) {
    case "execute": return buildExecutePrompt(state, task);
    case "verify": return buildVerifyPrompt(state, task);
    default: return "";
  }
}

function contextForTask(state: WorkflowState, phase: Phase, task: Task): ContextSpec {
  switch (phase) {
    case "execute": return executeContext(state, task);
    case "verify": return verifyContext(state, task);
    default: return { isolation: "isolated", inputs: [] };
  }
}

// ============================================================================
// Response Builders
// ============================================================================

export function buildPhaseResponse(state: WorkflowState, phase: Phase, taskId?: string): PhaseResponse {
  if (phase === "clarify" || phase === "plan") {
    const onComplete = submitWorkItemsCommand(state.workflowId, phase);
    return {
      type: "phase",
      phase,
      workflowId: state.workflowId,
      prompt: phase === "clarify" ? buildClarifyPrompt(state) : buildPlanPrompt(state),
      capability: PHASE_CAPABILITY[phase],
      context: phase === "clarify" ? clarifyContext() : planContext(state),
      output: outputSpec(phase),
      onComplete,
      instructions: phaseInstructions(phase, onComplete),
    };
  }

  const task = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  const onComplete = submitWorkItemsCommand(state.workflowId, phase, taskId);
  if (!task) {
    return {
      type: "phase", phase, workflowId: state.workflowId,
      prompt: `Error: no task found for ${phase} phase.`,
      capability: PHASE_CAPABILITY[phase],
      context: { isolation: "isolated", inputs: [] },
      output: outputSpec(phase),
      onComplete,
      instructions: phaseInstructions(phase, onComplete),
    };
  }

  return {
    type: "phase",
    phase,
    workflowId: state.workflowId,
    taskId: task.id,
    prompt: buildPromptForTask(state, phase, task),
    capability: PHASE_CAPABILITY[phase],
    context: contextForTask(state, phase, task),
    output: outputSpec(phase),
    onComplete,
    instructions: phaseInstructions(phase, onComplete),
  };
}

export function buildBatchResponse(
  state: WorkflowState,
  items: Array<{ phase: Phase; taskId: string }>,
): BatchResponse {
  const responses = items.map((item) => buildPhaseResponse(state, item.phase, item.taskId));
  return {
    type: "batch",
    workflowId: state.workflowId,
    responses,
    instructions: batchInstructions(responses.length),
  };
}

export function buildWorkItemBatchResponse(state: WorkflowState, work: ActiveWork): BatchResponse {
  const running = work.items.filter((i) => i.status === "running" || i.status === "pending");
  const responses: PhaseResponse[] = running.map((item) => {
    const onComplete = submitWorkItemResultCommand(state.workflowId, item.id);
    return {
      type: "phase" as const,
      phase: work.phase,
      workflowId: state.workflowId,
      taskId: work.taskId,
      prompt: `# Work Item: ${item.role}\n\n${item.task}`,
      capability: PHASE_CAPABILITY[work.phase],
      context: { isolation: "isolated" as const, inputs: [] },
      output: { schema: "work-item-result", format: "json" as const },
      onComplete,
      instructions: `Execute this work item. Return your result as JSON (no prose, no markdown). Then run: ${onComplete}`,
    };
  });

  return {
    type: "batch",
    workflowId: state.workflowId,
    responses,
    instructions: batchInstructions(responses.length),
  };
}

export function buildSynthesizeResponse(state: WorkflowState, work: ActiveWork): PhaseResponse {
  const results = work.items.map((i) => `### ${i.role}\n${i.result ?? "(no result)"}`).join("\n\n");
  const onComplete = submitSynthesizedCommand(state.workflowId);

  return {
    type: "phase",
    phase: work.phase,
    workflowId: state.workflowId,
    taskId: work.taskId,
    prompt: `# Synthesize Results\n\n${work.synthesize}\n\n## Work Item Results\n\n${results}`,
    capability: PHASE_CAPABILITY[work.phase],
    context: { isolation: "shared", inputs: [] },
    output: outputSpec(work.phase),
    onComplete,
    instructions: synthesizeInstructions(work.phase, onComplete),
  };
}

export function buildGateResponse(state: WorkflowState, gate: "clarify" | "plan" | "verify", taskId?: string): GateResponse {
  if (gate === "clarify") {
    const onComplete = decideCommand(state.workflowId);
    return { type: "gate", gate: "clarify", workflowId: state.workflowId, decisions: state.pendingDecisions, onComplete, instructions: gateClarifyInstructions(onComplete) };
  }

  if (gate === "plan") {
    const approveCmd = approvePlanCommand(state.workflowId);
    const adjustCmd = adjustPlanCommand(state.workflowId);
    return { type: "gate", gate: "plan", workflowId: state.workflowId, tasks: state.tasks, approach: state.planOutput?.approach, risks: state.planOutput?.risks, onComplete: approveCmd, instructions: gatePlanInstructions(approveCmd, adjustCmd) };
  }

  const task = taskId ? state.tasks.find((t) => t.id === taskId) : undefined;
  const continueCmd = resolveVerifyCommand(state.workflowId, taskId ?? "", "continue");
  const stopCmd = resolveVerifyCommand(state.workflowId, taskId ?? "", "stop");
  return { type: "gate", gate: "verify", workflowId: state.workflowId, taskId, verifyAttempts: task?.verifyAttempts, lastIssues: task?.verifyOutput?.issues, onComplete: continueCmd, instructions: gateVerifyInstructions(task?.title ?? taskId ?? "", task?.verifyAttempts ?? 0, continueCmd, stopCmd) };
}

export function buildDoneResponse(state: WorkflowState): DoneResponse {
  let message: string;
  if (state.status === "completed") message = "Workflow completed successfully.";
  else if (state.status === "blocked") message = `Workflow blocked: ${state.blockedReason || "unknown reason"}`;
  else message = `Workflow stopped: ${state.blockedReason || "stopped by user"}`;

  return { type: "done", workflowId: state.workflowId, status: state.status as "completed" | "blocked" | "stopped", message, instructions: doneInstructions() };
}

export function buildFaultResponse(state: WorkflowState, error: string, issues: string[], recoverable: boolean): FaultResponse {
  return { type: "fault", workflowId: state.workflowId, error, issues, recoverable, instructions: faultInstructions(recoverable) };
}
