import { promises as fs } from "node:fs";
import path from "node:path";
import { applyDecisionAnswers, applyPhaseOutput, nextSignal, validateState } from "./orchestrator";
import { absoluteWorkflowStatePath, loadWorkflowState, saveWorkflowState } from "./file-store";
import { getLocalControlCommand, localControlCommands } from "./local-control";
import { routeRequest } from "./router";
import { startFromMessage, stopSession, summarizeWorkflowState } from "./session";
import { Phase } from "./types";

function printUsage(): void {
  const controlList = localControlCommands.map((command) => `  - ${command.name}: ${command.description}`).join("\n");
  process.stdout.write(
    [
      "Usage:",
      "  route <message> [--intent <work|chat>] [--allow-heuristics]",
      "  intake <message> [--intent <work|chat>] [--allow-heuristics]",
      "  start <message> [--intent <work|chat>] [--allow-heuristics] [--capture] [--mode <name>] [--root <dir>]",
      "  status <workflowId> [--root <dir>]",
      "  next <workflowId> [--root <dir>]",
      "  resume <workflowId> [--root <dir>]",
      "  submit-phase <workflowId> <phase> <json|path> [--root <dir>]",
      "  submit-decisions <workflowId> <json|path> [--root <dir>]",
      "  stop <workflowId> [reason] [--root <dir>]",
      "",
      "Local control commands:",
      controlList,
      "",
    ].join("\n"),
  );
}

function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    index += 1;
  }

  return { positionals, flags };
}

async function readJsonInput(value: string): Promise<unknown> {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  const filePath = path.resolve(trimmed);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function rootDir(flags: Record<string, string | boolean>): string {
  return typeof flags.root === "string" ? flags.root : process.cwd();
}

async function loadValidatedWorkflowState(workflowId: string, flags: Record<string, string | boolean>) {
  const state = await loadWorkflowState(workflowId, rootDir(flags));
  const stateError = validateState(state);
  if (stateError) {
    throw new Error(JSON.stringify(stateError));
  }
  return state;
}

function parseIntentFlag(flags: Record<string, string | boolean>): "work" | "chat" | undefined {
  return flags.intent === "work" || flags.intent === "chat" ? (flags.intent as "work" | "chat") : undefined;
}

async function handleRoute(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const message = args.join(" ").trim();
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("route"),
        route: routeRequest(message, {
          explicitIntent: parseIntentFlag(flags),
          allowHeuristics: flags["allow-heuristics"] === true,
        }),
      },
      null,
      2,
    )}\n`,
  );
}

async function handleIntake(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const message = args.join(" ").trim();
  const result = startFromMessage({
    message,
    explicitIntent: parseIntentFlag(flags),
    allowHeuristics: flags["allow-heuristics"] === true,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("intake"),
        route: result.route,
        intake: result.intake,
        entryPolicy: result.entryPolicy,
        blockedByQuestions: result.blockedByQuestions,
      },
      null,
      2,
    )}\n`,
  );
}

async function handleStart(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const message = args.join(" ").trim();
  const result = startFromMessage({
    message,
    explicitIntent: parseIntentFlag(flags),
    allowHeuristics: flags["allow-heuristics"] === true,
    captureEnabled: flags.capture === true,
    mode: typeof flags.mode === "string" ? flags.mode : undefined,
  });

  if (result.state) {
    const savedPath = await saveWorkflowState(result.state, rootDir(flags));
    process.stdout.write(
      `${JSON.stringify(
        {
          control: getLocalControlCommand("start"),
          route: result.route,
          intake: result.intake,
          entryPolicy: result.entryPolicy,
          phasePolicy: result.phasePolicy,
          statePath: savedPath,
          signal: result.signal,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("start"),
        ...result,
      },
      null,
      2,
    )}\n`,
  );
}

async function handleStatus(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [workflowId] = args;
  const state = await loadValidatedWorkflowState(workflowId, flags);
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("status"),
        summary: summarizeWorkflowState(state),
      },
      null,
      2,
    )}\n`,
  );
}

async function handleNext(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [workflowId] = args;
  const state = await loadValidatedWorkflowState(workflowId, flags);
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("next"),
        signal: nextSignal(state),
      },
      null,
      2,
    )}\n`,
  );
}

async function handleResume(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [workflowId] = args;
  const state = await loadValidatedWorkflowState(workflowId, flags);
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("resume"),
        signal: nextSignal(state),
      },
      null,
      2,
    )}\n`,
  );
}

async function handleSubmitPhase(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [workflowId, phase, inputValue] = args;
  const state = await loadValidatedWorkflowState(workflowId, flags);
  const result = applyPhaseOutput(state, phase as Phase, await readJsonInput(inputValue));
  if (result.state) {
    await saveWorkflowState(result.state, rootDir(flags));
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("submit-phase"),
        signal: result.signal,
      },
      null,
      2,
    )}\n`,
  );
}

async function handleSubmitDecisions(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [workflowId, inputValue] = args;
  const state = await loadValidatedWorkflowState(workflowId, flags);
  const result = applyDecisionAnswers(state, await readJsonInput(inputValue));
  if (result.state) {
    await saveWorkflowState(result.state, rootDir(flags));
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("submit-decisions"),
        signal: result.signal,
      },
      null,
      2,
    )}\n`,
  );
}

async function handleStop(args: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [workflowId, ...reasonParts] = args;
  const state = await loadValidatedWorkflowState(workflowId, flags);
  const result = stopSession(state, reasonParts.join(" ").trim() || undefined);
  await saveWorkflowState(result.state, rootDir(flags));
  process.stdout.write(
    `${JSON.stringify(
      {
        control: getLocalControlCommand("stop"),
        signal: result.signal,
        statePath: absoluteWorkflowStatePath(workflowId, rootDir(flags)),
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { positionals, flags } = parseFlags(rest);

  switch (command) {
    case "route":
      await handleRoute(positionals, flags);
      return;
    case "intake":
      await handleIntake(positionals, flags);
      return;
    case "start":
      await handleStart(positionals, flags);
      return;
    case "status":
      await handleStatus(positionals, flags);
      return;
    case "next":
      await handleNext(positionals, flags);
      return;
    case "resume":
      await handleResume(positionals, flags);
      return;
    case "submit-phase":
      await handleSubmitPhase(positionals, flags);
      return;
    case "submit-decisions":
      await handleSubmitDecisions(positionals, flags);
      return;
    case "stop":
      await handleStop(positionals, flags);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
