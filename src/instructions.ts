import type { Phase } from "./types.js";

// ============================================================================
// CLI command prefix
// ============================================================================

let _prefix: string | undefined;

export function cliPrefix(): string {
  if (_prefix) return _prefix;
  const arg1 = process.argv[1] ?? "";
  if (arg1.includes("cli.ts") || arg1.includes("cli.js")) {
    _prefix = `node ${arg1}`;
  } else {
    _prefix = "krow";
  }
  return _prefix;
}

// ============================================================================
// Command builders
// ============================================================================

export function submitWorkItemsCommand(workflowId: string, phase: Phase, taskId?: string): string {
  const taskArg = taskId ? ` --task ${taskId}` : "";
  return `${cliPrefix()} submit ${workflowId} ${phase}${taskArg} '<JSON>'`;
}

export function submitWorkItemResultCommand(workflowId: string, itemId: string): string {
  return `${cliPrefix()} submit-item ${workflowId} ${itemId} '<RESULT>'`;
}

export function submitSynthesizedCommand(workflowId: string): string {
  return `${cliPrefix()} submit-synthesized ${workflowId} '<JSON>'`;
}

export function decideCommand(workflowId: string): string {
  return `${cliPrefix()} decide ${workflowId} '<JSON>'`;
}

export function approvePlanCommand(workflowId: string): string {
  return `${cliPrefix()} approve-plan ${workflowId}`;
}

export function adjustPlanCommand(workflowId: string): string {
  return `${cliPrefix()} adjust-plan ${workflowId} '<feedback>'`;
}

export function resolveVerifyCommand(workflowId: string, taskId: string, action: "continue" | "stop"): string {
  return `${cliPrefix()} resolve-verify ${workflowId} ${taskId} ${action}`;
}

// ============================================================================
// Instruction strings
// ============================================================================

export function phaseInstructions(phase: Phase, onComplete: string): string {
  return [
    `Execute the prompt for the "${phase}" phase.`,
    `Return your output as a JSON array of work items: [{id, role, task, result?}, ...]`,
    `If you can do it all yourself, return 1 item with result included.`,
    `If complex, return multiple items (without result) — they'll be executed in parallel.`,
    `Then run: ${onComplete}`,
  ].join("\n");
}

export function gateClarifyInstructions(onComplete: string): string {
  return [
    `Present each decision to the user and collect their answers.`,
    `Then run: ${onComplete}`,
    `Replace '<JSON>' with an array of { decisionId, selectedOptionId, customInput? }.`,
  ].join("\n");
}

export function gatePlanInstructions(approveCmd: string, adjustCmd: string): string {
  return [
    `Present the plan to the user for review.`,
    `If approved, run: ${approveCmd}`,
    `If adjustments needed, run: ${adjustCmd}`,
  ].join("\n");
}

export function gateVerifyInstructions(taskTitle: string, attempts: number, continueCmd: string, stopCmd: string): string {
  return [
    `Task "${taskTitle}" has failed verification ${attempts} time(s).`,
    `Present the issues to the user.`,
    `Keep trying: ${continueCmd}`,
    `Stop this task: ${stopCmd}`,
  ].join("\n");
}

export function batchInstructions(count: number): string {
  return [
    `${count} items to execute in parallel.`,
    `Execute each independently. Submit each result separately using its onComplete command.`,
  ].join("\n");
}

export function synthesizeInstructions(phase: Phase, onComplete: string): string {
  return [
    `All work items completed. Synthesize the results into a single ${phase} output.`,
    `Then run: ${onComplete}`,
  ].join("\n");
}

export function doneInstructions(): string {
  return "The workflow has reached a terminal state. Report the result to the user.";
}

export function faultInstructions(recoverable: boolean): string {
  if (recoverable) return "A recoverable error occurred. Review the issues and retry.";
  return "An unrecoverable error occurred. Report the error to the user.";
}
