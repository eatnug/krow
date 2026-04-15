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
  unitBriefPath,
  unitRelayPath,
  unitResultPath,
  unitStatusPath,
  workflowTaskIndexPath,
  workflowTaskRootPath,
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
  WorkflowEffort,
  WorkflowGraphStrategy,
  WorkflowPriority,
  WorkflowState,
  WorkflowUnit,
} from "./types.js";
import { validateWorkflowState } from "./validators.js";
import { completedUnitIds, readyUnits } from "./workflow-graph.js";

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
      "  submit-phase <workflowId> <phase> <json|path|-> [--root <dir>]",
      "  submit-decisions <workflowId> <json|path|-> [--root <dir>]",
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
  if (trimmed === "-") {
    return JSON.parse(readFileSync(0, "utf8")) as unknown;
  }

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

function makeUnitId(index: number): string {
  return `unit-${String(index).padStart(3, "0")}`;
}

function explicitDeliverables(message: string): { items: string[]; ordered: boolean } | undefined {
  const lines = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines
    .map((line) => line.match(/^\d+[.)]\s+(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  if (numbered.length >= 2) {
    return { items: numbered, ordered: true };
  }

  const bullets = lines
    .map((line) => line.match(/^[-*+]\s+(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
  if (bullets.length >= 2) {
    return { items: bullets, ordered: false };
  }

  return undefined;
}

function scopeKeyForFilePath(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return filePath;
  }

  const [root, second] = parts;
  if ((root === "packages" || root === "services") && second) {
    return `${root}/${second}`;
  }

  if ((root === "src" || root === "app" || root === "lib" || /^tests?$/i.test(root)) && second && !second.includes(".")) {
    return `${root}/${second}`;
  }

  return parts.slice(0, Math.min(parts.length - 1, 2)).join("/");
}

function inferUnitPriority(objective: string, anchors: RequestAnchors, kind: WorkflowUnit["kind"]): WorkflowPriority {
  if (kind === "integration") {
    return "high";
  }
  if (anchors.errors.length > 0 || anchors.tests.length > 0 || anchors.tickets.length > 0) {
    return "high";
  }
  if (looksLikeFix(objective) || looksLikeCreate(objective)) {
    return "medium";
  }
  return "low";
}

function inferUnitEffort(objective: string, scope: string[], dependencies: string[], kind: WorkflowUnit["kind"]): WorkflowEffort {
  if (kind === "integration") {
    return scope.length >= 3 ? "large" : "medium";
  }
  if (dependencies.length > 0 || scope.length >= 4) {
    return "large";
  }
  if (scope.length >= 2 || /\b(migrate|refactor|redesign|restructure|cross-cutting)\b/i.test(objective)) {
    return "medium";
  }
  return "small";
}

function inferAcceptanceCriteria(objective: string, anchors: RequestAnchors, scope: string[], kind: WorkflowUnit["kind"]): string[] {
  const criteria: string[] = [];

  if (kind === "integration") {
    criteria.push("Cross-unit interfaces and shared surfaces still align after all upstream units complete.");
    criteria.push("The final user-facing result matches the original request rather than only isolated slices.");
  }

  if (looksLikeFix(objective)) {
    criteria.push("The reported symptom or failing behavior is no longer reproducible on the scoped surface.");
  }

  if (looksLikeCreate(objective)) {
    criteria.push("The requested behavior or artifact exists on the intended surface and stays bounded to this unit.");
  }

  if (anchors.tests.length > 0) {
    criteria.push(`Verification can reference ${anchors.tests.join(", ")} without broadening into unrelated surfaces.`);
  }

  if (scope.length > 0) {
    criteria.push(`Changes remain bounded to: ${scope.join(", ")}.`);
  }

  return unique(criteria);
}

function inferSharedRisks(objective: string, anchors: RequestAnchors, scope: string[], kind: WorkflowUnit["kind"]): string[] {
  const risks: string[] = [];

  if (kind === "integration") {
    risks.push("Cross-unit merge drift can hide interface breakage until the final verify pass.");
  }
  if (anchors.errors.length > 0) {
    risks.push("A narrow fix can mask the symptom without proving the underlying failure surface is covered.");
  }
  if (anchors.tests.length === 0 && (looksLikeFix(objective) || looksLikeCreate(objective))) {
    risks.push("Verification surface is implicit, so clarify must lock down what proves the result.");
  }
  if (scope.some((item) => /(?:package\.json|tsconfig|vite\.config|eslint|prettier|pnpm-lock|package-lock|yarn\.lock)/i.test(item))) {
    risks.push("Config or toolchain changes can affect sibling units outside the local scope.");
  }
  if (scope.length >= 3) {
    risks.push("Wide scope increases the chance that a supposedly isolated unit bleeds into neighboring work.");
  }

  return unique(risks);
}

function enrichUnit(
  unit: WorkflowUnit,
  objective: string,
  anchors: RequestAnchors,
  graphStrategy: WorkflowGraphStrategy,
): WorkflowUnit {
  const scope = Array.isArray(unit.scope) ? unique(unit.scope) : [];
  const dependsOn = Array.isArray(unit.dependsOn) ? unit.dependsOn : [];
  const kind = unit.kind ?? "work";

  return {
    ...unit,
    scope,
    ownership: Array.isArray(unit.ownership) ? unique(unit.ownership) : [],
    priority: unit.priority ?? inferUnitPriority(objective, anchors, kind),
    estimatedEffort: unit.estimatedEffort ?? inferUnitEffort(objective, scope, dependsOn, kind),
    mergeRequired: unit.mergeRequired ?? graphStrategy !== "single",
    sharedRisks: unit.sharedRisks ?? inferSharedRisks(objective, anchors, scope, kind),
    acceptanceCriteria: unit.acceptanceCriteria ?? inferAcceptanceCriteria(objective, anchors, scope, kind),
  };
}

function buildSingleUnit(
  route: RouteDecision,
  objective: string,
  anchors: RequestAnchors,
  intents: CapabilityIntent[],
  notes: string[],
): WorkflowUnit {
  const scopedPaths = unique(anchors.filePaths.map(scopeKeyForFilePath));
  return enrichUnit({
    id: makeUnitId(1),
    title: normalizeTitle(objective),
    kind: "work",
    request: route.normalizedMessage,
    scope: unique([...anchors.filePaths, ...anchors.symbols]),
    dependsOn: [],
    parallelizable: false,
    ownership: scopedPaths,
    anchors,
    intakeIntents: intents,
    intakeNotes: notes,
  }, objective, anchors, "single");
}

function buildIntegrationUnit(
  objective: string,
  index: number,
  priorUnits: WorkflowUnit[],
  graphNotes: string[],
): WorkflowUnit {
  return enrichUnit({
    id: makeUnitId(index),
    title: "Integrate and verify cross-unit result",
    kind: "integration",
    request: `Integrate and verify the combined result for: ${objective}`,
    scope: unique(priorUnits.flatMap((unit) => unit.scope ?? [])),
    dependsOn: priorUnits.map((unit) => unit.id),
    parallelizable: false,
    ownership: unique(priorUnits.flatMap((unit) => unit.ownership ?? [])),
    intakeNotes: graphNotes,
    verifyFocus: [
      "Cross-unit interfaces still align after all ready units complete.",
      "The final user-facing result matches the original objective, not just each isolated slice.",
    ],
  }, objective, {
    filePaths: unique(priorUnits.flatMap((unit) => unit.anchors?.filePaths ?? [])),
    symbols: unique(priorUnits.flatMap((unit) => unit.anchors?.symbols ?? [])),
    errors: unique(priorUnits.flatMap((unit) => unit.anchors?.errors ?? [])),
    tests: unique(priorUnits.flatMap((unit) => unit.anchors?.tests ?? [])),
    tickets: unique(priorUnits.flatMap((unit) => unit.anchors?.tickets ?? [])),
  }, "parallel_fanout");
}

function carveWorkflowUnits(
  route: RouteDecision,
  objective: string,
  anchors: RequestAnchors,
  intents: CapabilityIntent[],
  notes: string[],
): { proposedUnits: WorkflowUnit[]; graphStrategy: WorkflowGraphStrategy; graphNotes: string[] } {
  const deliverables = explicitDeliverables(route.normalizedMessage);
  if (deliverables) {
    const graphNotes = deliverables.ordered
      ? ["carved from explicit numbered deliverables; run units in the declared order"]
      : ["carved from explicit bullet deliverables; root units are parallel-ready and fan into one integration unit"];

    const units: WorkflowUnit[] = deliverables.items.map((item, index) => {
      const itemAnchors = extractAnchors(item);
      const scopedPaths = unique(itemAnchors.filePaths.map(scopeKeyForFilePath));
      const dependsOn = deliverables.ordered && index > 0 ? [makeUnitId(index)] : [];
      return enrichUnit({
        id: makeUnitId(index + 1),
        title: normalizeTitle(item),
        kind: "work" as const,
        request: item,
        scope: unique([...itemAnchors.filePaths, ...itemAnchors.symbols]),
        dependsOn,
        parallelizable: !deliverables.ordered,
        ownership: scopedPaths,
        anchors: itemAnchors,
        intakeIntents: intents,
        intakeNotes: [...notes, ...graphNotes],
      } satisfies WorkflowUnit, item, itemAnchors, deliverables.ordered ? "serial" : "parallel_fanout");
    });

    const proposedUnits = !deliverables.ordered
      ? [...units, buildIntegrationUnit(objective, units.length + 1, units, graphNotes)]
      : units;

    return {
      proposedUnits,
      graphStrategy: deliverables.ordered ? "serial" : "parallel_fanout",
      graphNotes,
    };
  }

  const groupedScopes = new Map<string, string[]>();
  for (const filePath of anchors.filePaths) {
    const scope = scopeKeyForFilePath(filePath);
    groupedScopes.set(scope, [...(groupedScopes.get(scope) ?? []), filePath]);
  }

  if (groupedScopes.size >= 2) {
    const graphNotes = [
      "carved from disjoint file scopes; root units are parallel-ready when the host can execute them independently",
      "a final integration unit fans in after the scoped units verify successfully",
    ];
    const scopeEntries = [...groupedScopes.entries()];
    const units: WorkflowUnit[] = scopeEntries.map(([scope, scopedPaths], index) =>
      enrichUnit(
        {
          id: makeUnitId(index + 1),
          title: normalizeTitle(`${scope}: ${objective}`),
          kind: "work" as const,
          request: `${objective}\n\nFocus this unit on ${scope}.`,
          scope: scopedPaths,
          dependsOn: [],
          parallelizable: true,
          ownership: [scope],
          anchors: {
            ...anchors,
            filePaths: scopedPaths,
            symbols: anchors.symbols.filter((symbol) => scopedPaths.some((candidate) => candidate.includes(symbol.toLowerCase()))),
          },
          intakeIntents: intents,
          intakeNotes: [...notes, ...graphNotes],
        },
        objective,
        {
          ...anchors,
          filePaths: scopedPaths,
          symbols: [],
        },
        "parallel_fanout",
      ),
    );

    return {
      proposedUnits: [...units, buildIntegrationUnit(objective, units.length + 1, units, graphNotes)],
      graphStrategy: "parallel_fanout",
      graphNotes,
    };
  }

  if (anchors.symbols.length >= 2 && anchors.filePaths.length === 0) {
    const graphNotes = [
      "carved from multiple explicit symbol targets without concrete file paths",
      "each root unit should map its symbol to code before execution and fan into one integration pass",
    ];
    const units = anchors.symbols.map((symbol, index) =>
      enrichUnit(
        {
          id: makeUnitId(index + 1),
          title: normalizeTitle(`${symbol}: ${objective}`),
          kind: "work",
          request: `${objective}\n\nFocus this unit on the ${symbol} surface.`,
          scope: [symbol],
          dependsOn: [],
          parallelizable: true,
          ownership: [symbol],
          anchors: {
            ...anchors,
            filePaths: [],
            symbols: [symbol],
          },
          intakeIntents: intents,
          intakeNotes: [...notes, ...graphNotes],
        },
        objective,
        {
          ...anchors,
          filePaths: [],
          symbols: [symbol],
        },
        "parallel_fanout",
      ),
    );

    return {
      proposedUnits: [...units, buildIntegrationUnit(objective, units.length + 1, units, graphNotes)],
      graphStrategy: "parallel_fanout",
      graphNotes,
    };
  }

  return {
    proposedUnits: [buildSingleUnit(route, objective, anchors, intents, notes)],
    graphStrategy: "single",
    graphNotes: ["request stayed as one bounded workflow unit"],
  };
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
    const singleUnit = buildSingleUnit(route, objective, anchors, intents, ["request was routed to chat mode"]);
    return {
      objective,
      anchors,
      intents,
      proposedUnits: [singleUnit],
      graphStrategy: "single",
      graphNotes: ["request was routed to chat mode"],
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

  if ((looksLikeFix(objective) || looksLikeCreate(objective)) && anchors.tests.length === 0) {
    questions.push("What concrete test, reproduction, or verification surface should prove the result is correct?");
    missingEvidence.push("verification surface");
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

  const carved = carveWorkflowUnits(route, objective, anchors, intents, notes);

  return {
    objective,
    anchors,
    intents,
    proposedUnits: carved.proposedUnits,
    graphStrategy: carved.graphStrategy,
    graphNotes: carved.graphNotes,
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
    units: intake.proposedUnits,
    graphStrategy: intake.graphStrategy,
    graphNotes: intake.graphNotes,
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
  const completed = completedUnitIds(state);
  const ready = readyUnits(state);
  return {
    workflowId: state.workflowId,
    mode: state.mode,
    description: state.description,
    graphStrategy: state.graphStrategy ?? "single",
    status: state.status,
    phase: state.phase,
    workflowTaskIndexRef: workflowTaskIndexPath(state.workflowId),
    taskRoot: workflowTaskRootPath(state.workflowId),
    currentUnit: unit
      ? {
          id: unit.id,
          title: unit.title,
          kind: unit.kind ?? "work",
          dependsOn: unit.dependsOn ?? [],
          priority: unit.priority ?? "medium",
          estimatedEffort: unit.estimatedEffort ?? "medium",
          acceptanceCriteria: unit.acceptanceCriteria ?? [],
          sharedRisks: unit.sharedRisks ?? [],
          packetRef: unitBriefPath(state.workflowId, unit.id),
          statusRef: unitStatusPath(state.workflowId, unit.id),
          resultRef: unitResultPath(state.workflowId, unit.id),
          relayRefs: (unit.dependsOn ?? []).map((dependencyId) => unitRelayPath(state.workflowId, dependencyId)),
        }
      : undefined,
    readyUnits: ready.map((readyUnit) => ({
      id: readyUnit.id,
      title: readyUnit.title,
      kind: readyUnit.kind ?? "work",
      parallelizable: readyUnit.parallelizable === true,
      priority: readyUnit.priority ?? "medium",
      estimatedEffort: readyUnit.estimatedEffort ?? "medium",
      packetRef: unitBriefPath(state.workflowId, readyUnit.id),
    })),
    completedUnitCount: completed.length,
    totalUnitCount: state.units.length,
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
      workflowTaskIndexRef: workflowTaskIndexPath(result.state.workflowId),
      taskRoot: workflowTaskRootPath(result.state.workflowId),
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
    throw new Error("submit-phase requires <workflowId> <phase> <json|path|->");
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
    throw new Error("submit-decisions requires <workflowId> <json|path|->");
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
