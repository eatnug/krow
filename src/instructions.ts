import type { RuntimePhase } from "./types.js";

let cachedPrefix: string | undefined;

export function cliPrefix(): string {
  if (cachedPrefix) {
    return cachedPrefix;
  }

  const arg1 = process.argv[1] ?? "";
  if (arg1.includes("cli.ts") || arg1.includes("cli.js")) {
    cachedPrefix = `node ${arg1}`;
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

export function submitPhaseCommand(workflowId: string, phase: RuntimePhase): string {
  return `${cliPrefix()} submit-phase ${workflowId} ${phase} '<JSON>'`;
}

export function submitDecisionsCommand(workflowId: string): string {
  return `${cliPrefix()} submit-decisions ${workflowId} '<JSON>'`;
}

export function runSignalInstructions(
  workflowId: string,
  phase: RuntimePhase,
  schemaRef: string,
  stateRef: string,
): string {
  const lines = [
    `Execute the ${phase} phase for workflow ${workflowId}.`,
    `Read the current workflow state from ${stateRef} before responding.`,
    `Return only a single JSON object matching ${schemaRef}.`,
    `When complete, run: ${submitPhaseCommand(workflowId, phase)}`,
  ];

  if (phase === "clarify") {
    lines.push("If external input is required, return ready=false with the full current decisions array.");
  }

  if (phase === "verify") {
    lines.push("If the result needs an external decision, set needsHuman=true and provide bundled decisions.");
  }

  return lines.join("\n");
}

export function clarifyGateInstructions(workflowId: string, stateRef: string): string {
  return [
    `Workflow ${workflowId} is waiting for bundled clarification decisions.`,
    `Read the current decision set from ${stateRef}.`,
    `Collect all requested decisions from the user, then run: ${submitDecisionsCommand(workflowId)}`,
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
