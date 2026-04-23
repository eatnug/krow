import type { RuntimePhase } from "./types.js";

let cachedPrefix: string | undefined;

export function cliPrefix(): string {
  if (cachedPrefix) {
    return cachedPrefix;
  }

  const arg1 = process.argv[1] ?? "";
  if (arg1.includes("cli.ts") || arg1.includes("cli.js")) {
    cachedPrefix = `node ${arg1}`;
  } else if (process.env.npm_command === "exec" || process.env.npm_execpath) {
    cachedPrefix = "npx krow-cli";
  } else {
    cachedPrefix = "krow";
  }
  return cachedPrefix;
}

export function routeCommand(): string {
  return `${cliPrefix()} route '<message>' [--intent <work|chat>] [--allow-heuristics]`;
}

export function intakeCommand(): string {
  return `${cliPrefix()} intake '<message>' [--intent <work|chat>] [--allow-heuristics]`;
}

export function startCommand(): string {
  return `${cliPrefix()} start '<message>' [--intent <work|chat>] [--allow-heuristics] [--capture] [--mode <name>]`;
}

export function statusCommand(workflowId: string): string {
  return `${cliPrefix()} status ${workflowId}`;
}

export function nextCommand(workflowId: string): string {
  return `${cliPrefix()} next ${workflowId}`;
}

export function resumeCommand(workflowId: string): string {
  return `${cliPrefix()} resume ${workflowId}`;
}

export function stopCommand(workflowId: string, reason = "<reason>"): string {
  return `${cliPrefix()} stop ${workflowId} '${reason}'`;
}

function stdinJsonCommand(command: string): string {
  return `${command} - <<'KROW_JSON'\n<JSON>\nKROW_JSON`;
}

export function submitPhaseCommand(workflowId: string, phase: RuntimePhase): string {
  return stdinJsonCommand(`${cliPrefix()} submit-phase ${workflowId} ${phase}`);
}

export function submitDecisionsCommand(workflowId: string): string {
  return stdinJsonCommand(`${cliPrefix()} submit-decisions ${workflowId}`);
}

export function runSignalInstructions(
  workflowId: string,
  phase: RuntimePhase,
  schemaRef: string,
  stateRef: string,
  context?: Record<string, unknown>,
): string {
  const lines = [
    `Execute the ${phase} phase for workflow ${workflowId}.`,
    `Read the current workflow state from ${stateRef} before responding.`,
    `Return only a single JSON object matching ${schemaRef}.`,
    `When complete, run: ${submitPhaseCommand(workflowId, phase)}`,
    "Do not inline JSON as a quoted shell argument. Replace the <JSON> heredoc line with the exact payload so apostrophes in model output cannot break the shell.",
  ];

  const graphStrategy = typeof context?.graphStrategy === "string" ? context.graphStrategy : undefined;
  const currentUnit =
    context?.currentUnit && typeof context.currentUnit === "object"
      ? (context.currentUnit as Record<string, unknown>)
      : undefined;
  const readySiblingUnitIds = Array.isArray(context?.readySiblingUnitIds)
    ? context.readySiblingUnitIds.filter((value): value is string => typeof value === "string")
    : [];
  const currentUnitRefs =
    context?.currentUnit && typeof context.currentUnit === "object"
      ? (context.currentUnit as Record<string, unknown>)
      : undefined;
  const dependencyRelayRefs = Array.isArray(context?.dependencyRelayRefs)
    ? context.dependencyRelayRefs.filter((value): value is string => typeof value === "string")
    : [];

  if (graphStrategy) {
    lines.push(`Graph strategy: ${graphStrategy}.`);
  }

  if (currentUnit?.title && typeof currentUnit.title === "string") {
    lines.push(`Current unit: ${currentUnit.title}${typeof currentUnit.id === "string" ? ` (${currentUnit.id})` : ""}.`);
  }

  if (currentUnitRefs?.packetRef && typeof currentUnitRefs.packetRef === "string") {
    lines.push(`Read the task packet at ${currentUnitRefs.packetRef}.`);
  }

  if (currentUnitRefs?.statusRef && typeof currentUnitRefs.statusRef === "string") {
    lines.push(`Update your understanding from ${currentUnitRefs.statusRef} before acting.`);
  }

  if (dependencyRelayRefs.length > 0) {
    lines.push(`Read upstream relay files first: ${dependencyRelayRefs.join(", ")}.`);
  }

  if (readySiblingUnitIds.length > 0) {
    lines.push(
      `Other ready units exist: ${readySiblingUnitIds.join(", ")}. This run still covers only the current unit; use the graph metadata for host-level scheduling, not silent scope expansion.`,
    );
  }

  if (phase === "clarify") {
    lines.push("If external input is required, return ready=false with the full current decisions array, plus evidence and acceptanceCriteria for what is already known.");
  }

  if (phase === "verify") {
    lines.push("If the result needs an external decision, set needsHuman=true and provide bundled decisions. Always include checks, evidence, and any unverifiedClaims.");
  }

  return lines.join("\n");
}

export function clarifyGateInstructions(workflowId: string, stateRef: string): string {
  return [
    `Workflow ${workflowId} is waiting for bundled clarification decisions.`,
    `Read the current decision set from ${stateRef}.`,
    `Collect all requested decisions from the user, then run: ${submitDecisionsCommand(workflowId)}`,
    "Replace the <JSON> heredoc line with the exact answers payload instead of quoting it inline.",
    `After submitting the answers, resume the workflow with: ${resumeCommand(workflowId)}`,
  ].join("\n");
}

export function doneInstructions(workflowId: string, stateRef: string): string {
  return [
    `Workflow ${workflowId} is terminal.`,
    `Read ${stateRef} if you need the persisted outputs before reporting completion.`,
    "Report the final result and any remaining blockers or risks to the user.",
  ].join("\n");
}

export function faultInstructions(
  workflowId: string | undefined,
  recoverable: boolean,
  stateRef?: string,
): string {
  const lines = [];

  if (workflowId) {
    lines.push(`Workflow ${workflowId} hit a fault.`);
  } else {
    lines.push("The runtime hit a fault before a workflow could be identified.");
  }

  if (stateRef) {
    lines.push(`Read ${stateRef} before deciding how to proceed.`);
  }

  if (recoverable && workflowId) {
    lines.push(`Fix the input or state issue, then continue with: ${nextCommand(workflowId)}`);
  } else {
    lines.push("Report the fault to the user instead of guessing past it.");
  }

  return lines.join("\n");
}
