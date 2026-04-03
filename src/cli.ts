#!/usr/bin/env node

import { Command } from "commander";
import {
  createWorkflow,
  submitWorkItems,
  submitWorkItemResult,
  submitSynthesizedResult,
  submitDecisions,
  approvePlan,
  adjustPlan,
  resolveVerifyGate,
  stopWorkflow,
  nextResponse,
} from "./orchestrator.js";
import { saveState, loadState, listStates } from "./state-store.js";
import type { Phase, ProtocolResponse, WorkflowState } from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

function outputJSON(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

function outputError(error: string, workflowId?: string): never {
  outputJSON({ type: "fault", workflowId, error, issues: [], recoverable: false, instructions: "Report this error to the user." });
  return process.exit(1) as never;
}

function requireState(workflowId: string) {
  const state = loadState(workflowId);
  if (!state) outputError(`No workflow found: ${workflowId}`, workflowId);
  return state;
}

function parseFlexibleJSON(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* continue */ }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch { /* continue */ } }
  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch { /* continue */ } }
  outputError(`Failed to parse JSON: ${raw.slice(0, 200)}`);
}

function handleResult(result: { state?: WorkflowState; response: ProtocolResponse }): void {
  if (result.state) saveState(result.state);
  outputJSON(result.response);
}

// ============================================================================
// CLI
// ============================================================================

const program = new Command()
  .name("krow")
  .description("Agent harness CLI")
  .version("0.1.0");

program
  .command("start")
  .description("Start a new workflow")
  .argument("<description>", "Task description")
  .action((description: string) => {
    const result = createWorkflow(description);
    saveState(result.state);
    outputJSON(result.response);
  });

program
  .command("submit")
  .description("Submit work items for a phase")
  .argument("<workflowId>", "Workflow ID")
  .argument("<phase>", "Phase name (clarify, plan, execute, verify)")
  .argument("<json>", "Work items as JSON array")
  .option("--task <taskId>", "Task ID (for execute/verify)")
  .action((workflowId: string, phase: string, json: string, opts: { task?: string }) => {
    const state = requireState(workflowId);
    const parsed = parseFlexibleJSON(json);
    const result = submitWorkItems(state, phase as Phase, parsed, opts.task);
    handleResult(result);
  });

program
  .command("submit-item")
  .description("Submit a single work item result")
  .argument("<workflowId>", "Workflow ID")
  .argument("<itemId>", "Work item ID")
  .argument("<result>", "Result text")
  .action((workflowId: string, itemId: string, result: string) => {
    const state = requireState(workflowId);
    const r = submitWorkItemResult(state, itemId, result);
    handleResult(r);
  });

program
  .command("submit-synthesized")
  .description("Submit synthesized result after work items complete")
  .argument("<workflowId>", "Workflow ID")
  .argument("<json>", "Synthesized phase output as JSON")
  .action((workflowId: string, json: string) => {
    const state = requireState(workflowId);
    const parsed = parseFlexibleJSON(json);
    const result = submitSynthesizedResult(state, parsed);
    handleResult(result);
  });

program
  .command("decide")
  .description("Submit decision answers for a clarify gate")
  .argument("<workflowId>", "Workflow ID")
  .argument("<json>", "Decision answers as JSON string")
  .action((workflowId: string, json: string) => {
    const state = requireState(workflowId);
    const parsed = parseFlexibleJSON(json);
    const result = submitDecisions(state, parsed);
    handleResult(result);
  });

program
  .command("approve-plan")
  .description("Approve the plan and start execution")
  .argument("<workflowId>", "Workflow ID")
  .action((workflowId: string) => {
    const state = requireState(workflowId);
    const result = approvePlan(state);
    handleResult(result);
  });

program
  .command("adjust-plan")
  .description("Request plan adjustments")
  .argument("<workflowId>", "Workflow ID")
  .argument("<feedback>", "Adjustment feedback")
  .action((workflowId: string, feedback: string) => {
    const state = requireState(workflowId);
    const result = adjustPlan(state, feedback);
    handleResult(result);
  });

program
  .command("resolve-verify")
  .description("Resolve a verify escalation gate")
  .argument("<workflowId>", "Workflow ID")
  .argument("<taskId>", "Task ID")
  .argument("<action>", "continue or stop")
  .action((workflowId: string, taskId: string, action: string) => {
    const state = requireState(workflowId);
    const result = resolveVerifyGate(state, taskId, action as "continue" | "stop");
    handleResult(result);
  });

program
  .command("stop")
  .description("Stop a workflow")
  .argument("<workflowId>", "Workflow ID")
  .argument("[reason]", "Stop reason")
  .action((workflowId: string, reason?: string) => {
    const state = requireState(workflowId);
    const result = stopWorkflow(state, reason);
    saveState(result.state);
    outputJSON(result.response);
  });

program
  .command("status")
  .description("Get current workflow status")
  .argument("<workflowId>", "Workflow ID")
  .action((workflowId: string) => {
    const state = requireState(workflowId);
    outputJSON(nextResponse(state));
  });

program
  .command("list")
  .description("List active workflows")
  .action(() => {
    const states = listStates();
    outputJSON({
      type: "list",
      workflows: states.map((s) => ({
        workflowId: s.workflowId,
        description: s.description,
        status: s.status,
        phase: s.phase,
        taskCount: s.tasks.length,
        activeTasks: s.tasks.filter((t) => t.status === "executing" || t.status === "verifying").length,
        doneTasks: s.tasks.filter((t) => t.status === "done").length,
        updatedAt: s.updatedAt,
      })),
    });
  });

program.parse();
