#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyDecisionAnswers,
  applyPhaseOutput,
  createWorkflow,
  nextSignal,
  stopWorkflow,
} from "./orchestrator.js";
import {
  absoluteWorkflowStatePath,
  loadWorkflowState,
  saveWorkflowState,
} from "./state-store.js";
import type {
  CapabilityIntent,
  CapabilityKind,
  CapabilityPolicy,
  IntakePlan,
  LocalControlCommandName,
  RequestAnchors,
  RouteConfidence,
  RouteDecision,
  RouteKind,
  RouteSource,
  RuntimePhase,
  WorkflowState,
} from "./types.js";
import { validateWorkflowState } from "./validators.js";

type FlagMap = Record<string, string | boolean>;

type StartFromMessageResult = {
  route: RouteDecision;
  intake: IntakePlan;
  entryPolicy: CapabilityPolicy;
  phasePolicy?: CapabilityPolicy;
  state?: WorkflowState;
  signal?: ReturnType<typeof nextSignal>;
  blockedByQuestions: boolean;
};

type LocalControlCommandOutput = {
  name: LocalControlCommandName;
  localOnly: true;
  description: string;
  capabilityPolicy: CapabilityPolicy;
};

const workPatterns = [
  /\b(fix|implement|build|create|add|remove|delete|rename|refactor|update|edit|change|write|ship|debug)\b/i,
  /(고쳐|수정|만들|추가|삭제|지워|바꿔|리팩터|구현|작성|디버그|해결)/,
];

const questionPatterns = [
  /\?\s*$/,
  /^\s*(what|why|how|explain|describe|tell me|can you explain)\b/i,
  /^\s*(뭐|무엇|왜|어떻게|설명|알려줘)\b/,
];

const anchorPatterns = [
  /(?:^|[\s(])(?:src|app|lib|tests?|packages|services)\/[^\s)]+/i,
  /\b[A-Z][A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?\b/,
  /\b(?:error|exception|stack trace|test|failing|regression|bug)\b/i,
  /(에러|오류|테스트|버그|실패|회귀)/,
];

const filePathPattern = /(?:^|[\s(])((?:src|app|lib|tests?|packages|services)\/[^\s)]+)/gi;
const symbolPattern = /\b([A-Z][A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\b/g;
const ticketPattern = /\b(?:[A-Z]+-\d+|#\d+)\b/g;
const errorPattern =
  /\b((?:TypeError|ReferenceError|SyntaxError|Error|Exception|stack trace|failing test|test failure|bug|regression)[^,.;\n]*)/gi;
const testPattern = /\b([A-Za-z0-9_./-]*(?:test|spec)\.[A-Za-z0-9_.-]+)\b/gi;

const localControlDescriptions: Record<LocalControlCommandName, string> = {
  route: "Classify a message as chat or work without creating workflow state.",
  intake: "Produce an intake plan and missing-context analysis without creating workflow state.",
  start: "Create workflow state from a message and emit the first control signal.",
  status: "Read workflow state and return a local summary.",
  next: "Read workflow state and emit the next control signal.",
  resume: "Alias of next for host surfaces that prefer resume wording.",
  "submit-phase": "Submit a structured phase payload and advance the workflow if valid.",
  "submit-decisions": "Submit answers to pending clarify decisions.",
  stop: "Stop a workflow locally and persist the terminal state.",
};

const canonicalPhases = new Set<RuntimePhase>(["clarify", "execute", "verify", "capture"]);

function outputJSON(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function printUsage(): void {
  const controlList = (
    Object.keys(localControlDescriptions) as LocalControlCommandName[]
  )
    .map((name) => `  - ${name}: ${localControlDescriptions[name]}`)
    .join("\n");

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

function installerScriptPath(): string {
  const cliFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(cliFile), "../install/krow.mjs");
}

function delegateInstaller(command: "init" | "remove", args: string[]): never {
  const result = spawnSync(process.execPath, [installerScriptPath(), command, ...args], {
    stdio: "inherit",
  });

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  process.exit(1);
}

function parseFlags(args: string[]): { positionals: string[]; flags: FlagMap } {
  const positionals: string[] = [];
  const flags: FlagMap = {};

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

function readJsonInput(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  const filePath = path.resolve(trimmed);
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function rootDir(flags: FlagMap): string {
  return typeof flags.root === "string" ? flags.root : process.cwd();
}

function requireMessage(args: string[], commandName: string): string {
  const message = args.join(" ").trim();
  if (!message) {
    throw new Error(`${commandName} requires a message`);
  }
  return message;
}

function loadValidatedWorkflowState(workflowId: string, flags: FlagMap): WorkflowState {
  if (!workflowId) {
    throw new Error("workflowId is required");
  }

  let state: WorkflowState;
  try {
    state = loadWorkflowState(workflowId, rootDir(flags));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to load workflow ${workflowId}: ${message}`);
  }

  const validation = validateWorkflowState(state);
  if (!validation.ok || !validation.value) {
    throw new Error(`invalid workflow state: ${validation.issues.join("; ")}`);
  }

  return validation.value;
}

function parseIntentFlag(flags: FlagMap): RouteKind | undefined {
  return flags.intent === "work" || flags.intent === "chat"
    ? (flags.intent as RouteKind)
    : undefined;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function captureAll(message: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of message.matchAll(pattern)) {
    if (match[1]) {
      matches.push(match[1]);
    } else if (match[0]) {
      matches.push(match[0]);
    }
  }
  return unique(matches.map((value) => value.trim()).filter(Boolean));
}

function cleanMessage(message: string): string {
  return message.trim();
}

function scorePatterns(message: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(message) ? 1 : 0), 0);
}

function confidenceFromScore(score: number): RouteConfidence {
  if (score >= 3) {
    return "high";
  }
  if (score === 2) {
    return "medium";
  }
  return "low";
}

function routeRequest(
  message: string,
  options?: { explicitIntent?: RouteKind; allowHeuristics?: boolean },
): RouteDecision {
  const normalizedMessage = cleanMessage(message);
  const reasons: string[] = [];

  if (options?.explicitIntent === "work") {
    reasons.push("explicit work intent");
    return {
      rawMessage: message,
      normalizedMessage,
      kind: "work",
      source: "explicit" as RouteSource,
      confidence: "high",
      forced: true,
      reasons,
    };
  }

  if (options?.explicitIntent === "chat") {
    reasons.push("explicit chat intent");
    return {
      rawMessage: message,
      normalizedMessage,
      kind: "chat",
      source: "explicit" as RouteSource,
      confidence: "high",
      forced: false,
      reasons,
    };
  }

  if (!options?.allowHeuristics) {
    reasons.push("no explicit work intent was provided");
    return {
      rawMessage: message,
      normalizedMessage,
      kind: "chat",
      source: "heuristic" as RouteSource,
      confidence: "high",
      forced: false,
      reasons,
    };
  }

  const workScore =
    scorePatterns(normalizedMessage, workPatterns) + scorePatterns(normalizedMessage, anchorPatterns);
  const chatScore = scorePatterns(normalizedMessage, questionPatterns);
  let kind: RouteKind = "chat";

  if (workScore > chatScore) {
    kind = "work";
    reasons.push("contains delivery-oriented verbs or concrete anchors");
  } else {
    reasons.push("looks more like a question or discussion");
  }

  return {
    rawMessage: message,
    normalizedMessage,
    kind,
    source: "heuristic" as RouteSource,
    confidence: confidenceFromScore(Math.max(workScore, chatScore)),
    forced: false,
    reasons,
  };
}

function extractAnchors(message: string): RequestAnchors {
  return {
    filePaths: captureAll(message, filePathPattern),
    symbols: captureAll(message, symbolPattern),
    errors: captureAll(message, errorPattern),
    tests: captureAll(message, testPattern),
    tickets: captureAll(message, ticketPattern),
  };
}

function hasAnyAnchor(anchors: RequestAnchors): boolean {
  return (
    anchors.filePaths.length > 0 ||
    anchors.symbols.length > 0 ||
    anchors.errors.length > 0 ||
    anchors.tests.length > 0 ||
    anchors.tickets.length > 0
  );
}

function looksGeneric(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 12) {
    return true;
  }
  return /^(fix it|do it|work on this|handle this|좀 해줘|이거 해줘|고쳐줘)$/i.test(trimmed);
}

function maybeAdd(intents: CapabilityIntent[], intent: CapabilityIntent): void {
  const duplicate = intents.some(
    (existing) =>
      existing.kind === intent.kind &&
      existing.query === intent.query &&
      JSON.stringify(existing.targets ?? []) === JSON.stringify(intent.targets ?? []),
  );
  if (!duplicate) {
    intents.push(intent);
  }
}

function summarizeObjective(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

function hasAcceptanceSignal(message: string): boolean {
  return (
    /\b(should|must|expected|acceptance|done when|success means|result should)\b/i.test(message) ||
    /(되어야|해야 한다|기대 결과|완료 조건|성공 조건)/.test(message)
  );
}

function looksLikeFix(objective: string): boolean {
  return (
    /\b(fix|debug|bug|regression|error|exception|failing)\b/i.test(objective) ||
    /(버그|에러|오류|디버그|실패|회귀)/.test(objective)
  );
}

function looksLikeCreate(objective: string): boolean {
  return /\b(create|build|implement|add|ship|feature)\b/i.test(objective) || /(만들|구현|추가)/.test(objective);
}

function looksLikeRemoval(objective: string): boolean {
  return /\b(remove|delete)\b/i.test(objective) || /(삭제|지워)/.test(objective);
}

function buildIntakePlan(route: RouteDecision): IntakePlan {
  const objective = summarizeObjective(route.normalizedMessage);
  const anchors = extractAnchors(route.normalizedMessage);
  const intents: CapabilityIntent[] = [];
  const notes: string[] = [];
  const missingEvidence: string[] = [];
  const questions: string[] = [];

  if (route.kind !== "work") {
    return {
      objective,
      anchors,
      intents,
      missingEvidence,
      questions,
      needsUserInput: false,
      notes: ["request was routed to chat mode"],
    };
  }

  maybeAdd(intents, {
    kind: "search_code",
    priority: "high",
    reason: "find the code surface related to the requested work",
    query: objective,
  });

  if (!hasAnyAnchor(anchors)) {
    maybeAdd(intents, {
      kind: "repo_scan",
      priority: "high",
      reason: "no concrete anchor was provided, so the system should map the relevant area first",
    });
    notes.push("request has no strong anchor; start with repo mapping before asking the user");
    missingEvidence.push("concrete target surface");
  }

  if (anchors.filePaths.length > 0 || anchors.symbols.length > 0) {
    maybeAdd(intents, {
      kind: "read_targets",
      priority: "high",
      reason: "read the explicitly mentioned files or symbols first",
      targets: unique([...anchors.filePaths, ...anchors.symbols]),
    });
  }

  if (anchors.errors.length > 0 || looksLikeFix(objective)) {
    maybeAdd(intents, {
      kind: "inspect_logs",
      priority: "high",
      reason: "the request sounds failure-oriented and should start from evidence",
      targets: anchors.errors,
    });
    maybeAdd(intents, {
      kind: "inspect_tests",
      priority: "medium",
      reason: "failing behavior often has existing tests or needs a check surface",
      targets: anchors.tests,
    });
  }

  if (looksLikeCreate(objective)) {
    maybeAdd(intents, {
      kind: "inspect_config",
      priority: "medium",
      reason: "new work should respect existing project boundaries and tooling",
    });
    maybeAdd(intents, {
      kind: "inspect_tests",
      priority: "medium",
      reason: "new work should identify the likely verification surface early",
      targets: anchors.tests,
    });
  }

  if (looksGeneric(objective)) {
    questions.push("What exact target should this work affect?");
    notes.push("request is too generic to start safely without at least one concrete target");
    missingEvidence.push("exact target");
  }

  if (!hasAcceptanceSignal(objective)) {
    questions.push("What exact outcome should be considered correct when this work is done?");
    missingEvidence.push("acceptance criteria");
  }

  if (looksLikeFix(objective) && anchors.errors.length === 0) {
    questions.push("What exact symptom, failing case, or error should be fixed?");
    missingEvidence.push("failure evidence or reproduction target");
  }

  if (looksLikeCreate(objective) && anchors.filePaths.length === 0 && anchors.symbols.length === 0) {
    questions.push("Which existing surface should this be added to, or what new surface should be created?");
    missingEvidence.push("implementation boundary");
  }

  if (looksLikeRemoval(objective) && anchors.filePaths.length === 0 && anchors.symbols.length === 0) {
    questions.push("What exact code, file, behavior, or configuration should be removed?");
    missingEvidence.push("removal target");
  }

  if (questions.length > 0) {
    notes.push("bundle every currently required external question into one clarify gate");
    notes.push("do not guess missing requirements; gather evidence from code, research, or user answers first");
  }

  return {
    objective,
    anchors,
    intents,
    missingEvidence,
    questions,
    needsUserInput: questions.length > 0,
    notes,
  };
}

function uniqueCapabilities(values: CapabilityKind[]): CapabilityKind[] {
  return [...new Set(values)];
}

function createPolicy(
  id: string,
  surface: CapabilityPolicy["surface"],
  allowed: CapabilityKind[],
  notes: string[],
): CapabilityPolicy {
  return {
    id,
    surface,
    mode: "allow-list",
    allowed: uniqueCapabilities(allowed),
    notes,
  };
}

function resolveEntryPolicy(route: RouteDecision): CapabilityPolicy {
  if (route.kind === "chat") {
    return createPolicy("entry:chat", "entry", [], ["chat entry does not grant workflow capabilities"]);
  }

  return createPolicy(
    "entry:work",
    "entry",
    [
      "repo_scan",
      "search_code",
      "read_targets",
      "read_files",
      "inspect_tests",
      "inspect_logs",
      "inspect_config",
      "inspect_docs",
      "ask_user",
      "read_state",
      "write_state",
    ],
    [
      "entry routing may gather local context and persist workflow state",
      "entry routing should not edit files or run verification checks yet",
      "entry routing should gather all currently required missing evidence before asking the user",
    ],
  );
}

function resolvePhasePolicy(phase: RuntimePhase): CapabilityPolicy {
  switch (phase) {
    case "clarify":
      return createPolicy(
        "phase:clarify",
        "phase",
        [
          "repo_scan",
          "search_code",
          "read_targets",
          "read_files",
          "inspect_tests",
          "inspect_logs",
          "inspect_config",
          "inspect_docs",
          "ask_user",
          "read_state",
          "write_state",
          "write_relay",
          "emit_gate",
        ],
        ["clarify can gather evidence and raise explicit questions", "clarify should not change project files"],
      );
    case "execute":
      return createPolicy(
        "phase:execute",
        "phase",
        [
          "read_files",
          "edit_files",
          "run_checks",
          "read_state",
          "write_state",
          "write_relay",
          "spawn_worker",
        ],
        [
          "execute can modify files and run scoped checks",
          "execute may fork bounded worker tasks when ownership is clean",
        ],
      );
    case "verify":
      return createPolicy(
        "phase:verify",
        "phase",
        [
          "read_files",
          "inspect_tests",
          "inspect_logs",
          "run_checks",
          "read_state",
          "write_state",
          "write_relay",
          "emit_gate",
        ],
        [
          "verify should focus on disproving the claimed result",
          "verify should not silently edit project files",
        ],
      );
    case "capture":
      return createPolicy(
        "phase:capture",
        "phase",
        ["read_files", "inspect_docs", "read_state", "write_state", "write_relay"],
        ["capture writes distilled knowledge, not implementation changes"],
      );
  }
}

function resolveControlPolicy(commandName: LocalControlCommandName): CapabilityPolicy {
  switch (commandName) {
    case "route":
    case "intake":
      return createPolicy(
        `control:${commandName}`,
        "control",
        ["repo_scan", "search_code"],
        ["local control command only", "does not advance workflow state"],
      );
    case "start":
      return createPolicy(
        "control:start",
        "control",
        ["read_state", "write_state"],
        ["local control command only", "creates workflow state without invoking a model"],
      );
    case "status":
    case "next":
    case "resume":
      return createPolicy(
        `control:${commandName}`,
        "control",
        ["read_state"],
        ["local control command only", "reads existing workflow state"],
      );
    case "submit-phase":
    case "submit-decisions":
    case "stop":
      return createPolicy(
        `control:${commandName}`,
        "control",
        ["read_state", "write_state"],
        ["local control command only", "mutates workflow state without invoking a model"],
      );
  }
}

function getLocalControlCommand(name: LocalControlCommandName): LocalControlCommandOutput {
  return {
    name,
    localOnly: true,
    description: localControlDescriptions[name],
    capabilityPolicy: resolveControlPolicy(name),
  };
}

function normalizeTitle(objective: string): string {
  const compact = objective.replace(/\s+/g, " ").trim();
  return compact.length <= 80 ? compact : `${compact.slice(0, 77)}...`;
}

function startFromMessage(input: {
  message: string;
  mode?: string;
  explicitIntent?: RouteKind;
  allowHeuristics?: boolean;
  captureEnabled?: boolean;
  maxVerifyAttempts?: number;
}): StartFromMessageResult {
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

function summarizeWorkflowState(state: WorkflowState) {
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

function handleRoute(args: string[], flags: FlagMap): void {
  const message = requireMessage(args, "route");
  outputJSON({
    control: getLocalControlCommand("route"),
    route: routeRequest(message, {
      explicitIntent: parseIntentFlag(flags),
      allowHeuristics: flags["allow-heuristics"] === true,
    }),
  });
}

function handleIntake(args: string[], flags: FlagMap): void {
  const message = requireMessage(args, "intake");
  const result = startFromMessage({
    message,
    explicitIntent: parseIntentFlag(flags),
    allowHeuristics: flags["allow-heuristics"] === true,
  });

  outputJSON({
    control: getLocalControlCommand("intake"),
    route: result.route,
    intake: result.intake,
    entryPolicy: result.entryPolicy,
    blockedByQuestions: result.blockedByQuestions,
  });
}

function handleStart(args: string[], flags: FlagMap): void {
  const message = requireMessage(args, "start");
  const result = startFromMessage({
    message,
    explicitIntent: parseIntentFlag(flags),
    allowHeuristics: flags["allow-heuristics"] === true,
    captureEnabled: flags.capture === true,
    mode: typeof flags.mode === "string" ? flags.mode : undefined,
  });

  if (result.state) {
    const savedPath = saveWorkflowState(result.state, rootDir(flags));
    outputJSON({
      control: getLocalControlCommand("start"),
      route: result.route,
      intake: result.intake,
      entryPolicy: result.entryPolicy,
      phasePolicy: result.phasePolicy,
      statePath: savedPath,
      signal: result.signal,
    });
    return;
  }

  outputJSON({
    control: getLocalControlCommand("start"),
    route: result.route,
    intake: result.intake,
    entryPolicy: result.entryPolicy,
    blockedByQuestions: result.blockedByQuestions,
  });
}

function handleStatus(args: string[], flags: FlagMap): void {
  const [workflowId] = args;
  const state = loadValidatedWorkflowState(workflowId, flags);
  outputJSON({
    control: getLocalControlCommand("status"),
    summary: summarizeWorkflowState(state),
  });
}

function handleNext(args: string[], flags: FlagMap): void {
  const [workflowId] = args;
  const state = loadValidatedWorkflowState(workflowId, flags);
  outputJSON({
    control: getLocalControlCommand("next"),
    signal: nextSignal(state),
  });
}

function handleResume(args: string[], flags: FlagMap): void {
  const [workflowId] = args;
  const state = loadValidatedWorkflowState(workflowId, flags);
  outputJSON({
    control: getLocalControlCommand("resume"),
    signal: nextSignal(state),
  });
}

function handleSubmitPhase(args: string[], flags: FlagMap): void {
  const [workflowId, phase, inputValue] = args;
  if (!workflowId || !phase || !inputValue) {
    throw new Error("submit-phase requires <workflowId> <phase> <json|path>");
  }
  if (!canonicalPhases.has(phase as RuntimePhase)) {
    throw new Error(`unsupported phase: ${phase}`);
  }

  const state = loadValidatedWorkflowState(workflowId, flags);
  const result = applyPhaseOutput(state, phase, readJsonInput(inputValue));
  if (result.state) {
    saveWorkflowState(result.state, rootDir(flags));
  }

  outputJSON({
    control: getLocalControlCommand("submit-phase"),
    signal: result.signal,
  });
}

function handleSubmitDecisions(args: string[], flags: FlagMap): void {
  const [workflowId, inputValue] = args;
  if (!workflowId || !inputValue) {
    throw new Error("submit-decisions requires <workflowId> <json|path>");
  }

  const state = loadValidatedWorkflowState(workflowId, flags);
  const result = applyDecisionAnswers(state, readJsonInput(inputValue));
  if (result.state) {
    saveWorkflowState(result.state, rootDir(flags));
  }

  outputJSON({
    control: getLocalControlCommand("submit-decisions"),
    signal: result.signal,
  });
}

function handleStop(args: string[], flags: FlagMap): void {
  const [workflowId, ...reasonParts] = args;
  const state = loadValidatedWorkflowState(workflowId, flags);
  const result = stopWorkflow(state, reasonParts.join(" ").trim() || undefined);
  saveWorkflowState(result.state, rootDir(flags));

  outputJSON({
    control: getLocalControlCommand("stop"),
    signal: result.signal,
    statePath: absoluteWorkflowStatePath(workflowId, rootDir(flags)),
  });
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { positionals, flags } = parseFlags(rest);

  switch (command) {
    case "init":
      delegateInstaller("init", rest);
      return;
    case "remove":
      delegateInstaller("remove", rest);
      return;
    case "route":
      handleRoute(positionals, flags);
      return;
    case "intake":
      handleIntake(positionals, flags);
      return;
    case "start":
      handleStart(positionals, flags);
      return;
    case "status":
      handleStatus(positionals, flags);
      return;
    case "next":
      handleNext(positionals, flags);
      return;
    case "resume":
      handleResume(positionals, flags);
      return;
    case "submit-phase":
      handleSubmitPhase(positionals, flags);
      return;
    case "submit-decisions":
      handleSubmitDecisions(positionals, flags);
      return;
    case "stop":
      handleStop(positionals, flags);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
