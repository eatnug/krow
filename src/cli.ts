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
import { groundRequestLanguage } from "./language-grounding.js";
import type {
  CapabilityIntent,
  CapabilityKind,
  CapabilityPolicy,
  DecisionAnswer,
  DecisionPrompt,
  IntakePlan,
  IntakeIntentLock,
  LanguageGrounding,
  LanguageNamespace,
  LocalControlCommandName,
  RequestAnchors,
  RouteDecision,
  RouteKind,
  RuntimePhase,
  UnitReviewReport,
  WorkflowEffort,
  WorkflowGraphStrategy,
  WorkflowPriority,
  WorkflowState,
  WorkflowUnit,
} from "./types.js";
import { validateWorkflowState } from "./validators.js";
import { completedUnitIds, readyUnits } from "./workflow-graph.js";
import {
  deriveTraceOverview,
  findRelatedDocuments,
  scanKrowDocuments,
  type DocumentRetrieval,
  type KrowDocumentSummary,
} from "./document-contracts.js";
import { executionContractFromRetrieval } from "./execution-contracts.js";
import { writeUnitReviewReport } from "./review-report.js";
import { applyProjectCheckDecisions, runProjectCheck } from "./project-check.js";

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

const pathLikePattern = /(?:^|[\s(`])((?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)/gi;
const rootFilePattern =
  /\b((?:AGENTS|CLAUDE|README|CHANGELOG|Cargo|Makefile|Dockerfile)(?:\.[A-Za-z0-9_.-]+)?|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig(?:\.[A-Za-z0-9_.-]+)?\.json|vite\.config\.[A-Za-z0-9_.-]+|vitest\.config\.[A-Za-z0-9_.-]+|jest\.config\.[A-Za-z0-9_.-]+)\b/g;
const codeSpanPattern = /`([^`\n]+)`/g;
const symbolPattern =
  /\b([A-Z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?|[a-z][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?|[A-Z][A-Z0-9_]{2,}(?:\.[A-Za-z0-9_]+)?)\b/g;
const ticketPattern = /\b(?:[A-Z]+-\d+|#\d+)\b/g;
const errorPattern =
  /\b((?:TypeError|ReferenceError|SyntaxError|Error|Exception|stack trace|failing test|test failure)[^,.;\n]*)/gi;
const testPattern = /\b([A-Za-z0-9_./-]*(?:test|spec)\.[A-Za-z0-9_.-]+)\b/gi;
const verificationCommandPattern =
  /\b((?:cargo\s+(?:test|check|clippy|build)|(?:npm|pnpm|yarn|bun)\s+(?:(?:run|exec)\s+)?(?:test|typecheck|check|lint|build)|uv\s+run\s+(?:pytest|ruff|mypy|pyright)[^\n,;]*|pytest[^\n,;]*|go\s+test[^\n,;]*|swift\s+test[^\n,;]*|dotnet\s+test[^\n,;]*|mvn\s+test[^\n,;]*|(?:\.\/)?gradlew\s+test[^\n,;]*|xcodebuild\s+test[^\n,;]*|npx\s+(?:playwright\s+test|vitest|jest|tsc\s+--noEmit)[^\n,;]*)[^\n,;]*)/gi;
const verificationSurfacePattern =
  /(?:^|\n)\s*(?:[-*]\s*)?(?:verification|verify|tests?|checks?|run|repro(?:duction)?|validate|validation|manual qa)\s*:?\s+([^\n]+)/gi;
const proseSymbolStopWords = new Set([
  "Acceptance",
  "Add",
  "Build",
  "Change",
  "Check",
  "Checks",
  "Create",
  "Criteria",
  "Debug",
  "Delete",
  "Edit",
  "Expected",
  "Fix",
  "Focus",
  "AI",
  "UI",
  "UX",
  "TestFlight",
  "Android",
  "iOS",
  "Implement",
  "Remove",
  "Rename",
  "Request",
  "Result",
  "Run",
  "Ship",
  "Should",
  "Success",
  "Surface",
  "Test",
  "Tests",
  "Unit",
  "Update",
  "Verification",
  "Verify",
  "Write",
]);

const localControlDescriptions: Record<LocalControlCommandName, string> = {
  route: "Resolve explicit chat or work intent without creating workflow state.",
  intake: "Produce an intake plan and missing-context analysis without creating workflow state.",
  check: "Scan repo evidence, write a krow check report, and propose approved-language updates without changing source code.",
  "check-apply": "Apply explicit krow check decisions to .krow language and concept documents only.",
  documents: "Scan krow Markdown documents, approval sections, and derived trace ids.",
  review: "Derive a Review Report from workflow documents, execution traces, and verification output.",
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
      "  route <message> [--intent <work|chat>]",
      "  intake <message> [--intent <work|chat>]",
      "  check [description] [--about <text>] [--scope <path>] [--root <dir>]",
      "  check-apply <checkId> <json|path|-> [--root <dir>]",
      "  documents [message] [--root <dir>]",
      "  review <workflowId> [unitId] [--root <dir>]",
      "  start <message> [--intent <work|chat>] [--capture] [--mode <name>] [--root <dir>]",
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

function readDecisionAnswersInput(value: string): DecisionAnswer[] {
  const input = readJsonInput(value);
  if (Array.isArray(input)) {
    return input as DecisionAnswer[];
  }
  if (input && typeof input === "object" && Array.isArray((input as { answers?: unknown }).answers)) {
    return (input as { answers: DecisionAnswer[] }).answers;
  }
  throw new Error("check-apply input must be a JSON array or an object with an answers array");
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

function extractSymbols(message: string): string[] {
  return captureAll(message, symbolPattern).filter((symbol) => !proseSymbolStopWords.has(symbol));
}

function looksLikeFilePath(value: string): boolean {
  rootFilePattern.lastIndex = 0;
  return /^(?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+$/.test(value) || rootFilePattern.test(value);
}

function looksLikeTestPath(value: string): boolean {
  return /(?:test|spec)\.[A-Za-z0-9_.-]+$/i.test(value);
}

function cleanMessage(message: string): string {
  return message.trim();
}

function routeRequest(
  message: string,
  options?: { explicitIntent?: RouteKind },
): RouteDecision {
  const normalizedMessage = cleanMessage(message);
  const reasons: string[] = [];

  if (options?.explicitIntent === "work") {
    reasons.push("explicit work intent");
    return {
      rawMessage: message,
      normalizedMessage,
      kind: "work",
      source: "explicit",
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
      source: "explicit",
      confidence: "high",
      forced: false,
      reasons,
    };
  }

  reasons.push("no explicit intent was provided");
  return {
    rawMessage: message,
    normalizedMessage,
    kind: "chat",
    source: "default",
    confidence: "high",
    forced: false,
    reasons,
  };
}

function extractAnchors(message: string): RequestAnchors {
  const codeSpans = captureAll(message, codeSpanPattern);
  const codeSpanPaths = codeSpans.filter(looksLikeFilePath);
  const codeSpanSymbols = codeSpans.filter((value) => !looksLikeFilePath(value) && !value.includes(" "));
  const filePaths = unique([
    ...captureAll(message, pathLikePattern),
    ...captureAll(message, rootFilePattern),
    ...codeSpanPaths,
  ]);
  const tests = unique([...captureAll(message, testPattern), ...codeSpanPaths.filter(looksLikeTestPath)]);
  const verificationSurfaces = unique([
    ...tests,
    ...captureAll(message, verificationCommandPattern),
    ...captureAll(message, verificationSurfacePattern),
  ]);

  return {
    filePaths,
    symbols: unique([...extractSymbols(message), ...codeSpanSymbols]).filter((symbol) => !filePaths.includes(symbol)),
    errors: captureAll(message, errorPattern),
    tests,
    verificationSurfaces,
    tickets: captureAll(message, ticketPattern),
  };
}

function hasAnyAnchor(anchors: RequestAnchors): boolean {
  return (
    anchors.filePaths.length > 0 ||
    anchors.symbols.length > 0 ||
    anchors.errors.length > 0 ||
    anchors.tests.length > 0 ||
    anchors.verificationSurfaces.length > 0 ||
    anchors.tickets.length > 0
  );
}

function hasVerificationSurface(anchors: RequestAnchors): boolean {
  return anchors.tests.length > 0 || anchors.verificationSurfaces.length > 0;
}

function codeAnchorTarget(anchor: string): string {
  const code = anchor.match(/`([^`]+)`/)?.[1];
  if (code) {
    return code.trim();
  }

  const afterLabel = anchor.match(/^[A-Za-z][A-Za-z ]{1,30}:\s*(.+)$/)?.[1];
  return (afterLabel ?? anchor).trim();
}

function normalizeConceptToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function conceptSearchTexts(languageGrounding: LanguageGrounding): string[] {
  return unique(
    languageGrounding.relatedConceptMaps.flatMap((conceptMap) => [
      conceptMap.key,
      conceptMap.title,
      ...conceptMap.aliases,
      ...conceptMap.relatedConcepts,
    ]),
  );
}

function symbolIsConceptToken(symbol: string, languageGrounding: LanguageGrounding): boolean {
  const normalizedSymbol = normalizeConceptToken(symbol);
  if (!normalizedSymbol) {
    return false;
  }

  return conceptSearchTexts(languageGrounding)
    .map(normalizeConceptToken)
    .some((text) => text.split(" ").includes(normalizedSymbol));
}

function enrichAnchorsWithConceptMaps(anchors: RequestAnchors, languageGrounding: LanguageGrounding): RequestAnchors {
  const conceptTargets = unique(
    languageGrounding.relatedConceptMaps.flatMap((conceptMap) => conceptMap.codeAnchors.map(codeAnchorTarget)),
  );
  if (conceptTargets.length === 0) {
    return {
      ...anchors,
      symbols: anchors.symbols.filter((symbol) => !symbolIsConceptToken(symbol, languageGrounding)),
    };
  }

  return {
    ...anchors,
    filePaths: unique([...anchors.filePaths, ...conceptTargets]),
    symbols: anchors.symbols.filter((symbol) => !symbolIsConceptToken(symbol, languageGrounding)),
    tests: unique([...anchors.tests, ...conceptTargets.filter((target) => /(?:test|spec)\.[A-Za-z0-9_.-]+$/i.test(target))]),
    verificationSurfaces: unique([
      ...anchors.verificationSurfaces,
      ...conceptTargets.filter((target) => /(?:test|spec)\.[A-Za-z0-9_.-]+$/i.test(target)),
    ]),
  };
}

function documentConceptKeys(languageGrounding: LanguageGrounding | undefined): string[] {
  if (!languageGrounding) {
    return [];
  }
  return unique([
    ...languageGrounding.relatedConceptMaps.flatMap((conceptMap) => [
      conceptMap.key,
      ...conceptMap.relatedConcepts,
      ...conceptMap.aliases,
    ]),
    ...languageGrounding.matchedTerms
      .filter((term) => term.namespace === "project")
      .flatMap((term) => [term.id, term.canonical, ...term.aliases]),
    ...languageGrounding.proposedTerms.map((term) => term.canonical),
  ]);
}

function lacksSpecificRequest(message: string): boolean {
  const trimmed = message.trim();
  return trimmed.length < 12;
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
  if (anchors.errors.length > 0 || hasVerificationSurface(anchors) || anchors.tickets.length > 0) {
    return "high";
  }
  return objective.trim() ? "medium" : "low";
}

function inferUnitEffort(objective: string, scope: string[], dependencies: string[], kind: WorkflowUnit["kind"]): WorkflowEffort {
  if (kind === "integration") {
    return scope.length >= 3 ? "large" : "medium";
  }
  if (dependencies.length > 0 || scope.length >= 4) {
    return "large";
  }
  if (scope.length >= 2 || objective.length > 240) {
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

  if (hasVerificationSurface(anchors)) {
    criteria.push(
      `Verification can reference ${unique([...anchors.tests, ...anchors.verificationSurfaces]).join(", ")} without broadening into unrelated surfaces.`,
    );
  }

  if (scope.length > 0) {
    criteria.push(`Changes remain bounded to: ${scope.join(", ")}.`);
  }

  return unique(criteria);
}

function inferSharedRisks(anchors: RequestAnchors, scope: string[], kind: WorkflowUnit["kind"]): string[] {
  const risks: string[] = [];

  if (kind === "integration") {
    risks.push("Cross-unit merge drift can hide interface breakage until the final verify pass.");
  }
  if (anchors.errors.length > 0) {
    risks.push("A narrow fix can mask the symptom without proving the underlying failure surface is covered.");
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
    sharedRisks: unit.sharedRisks ?? inferSharedRisks(anchors, scope, kind),
    acceptanceCriteria: unit.acceptanceCriteria ?? inferAcceptanceCriteria(objective, anchors, scope, kind),
  };
}

function buildSingleUnit(
  route: RouteDecision,
  objective: string,
  anchors: RequestAnchors,
  intents: CapabilityIntent[],
  notes: string[],
  languageGrounding?: LanguageGrounding,
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
    languageGrounding,
  }, objective, anchors, "single");
}

function buildIntegrationUnit(
  objective: string,
  index: number,
  priorUnits: WorkflowUnit[],
  graphNotes: string[],
  languageGrounding?: LanguageGrounding,
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
    languageGrounding,
    verifyFocus: [
      "Cross-unit interfaces still align after all ready units complete.",
      "The final user-facing result matches the original objective, not just each isolated slice.",
    ],
  }, objective, {
    filePaths: unique(priorUnits.flatMap((unit) => unit.anchors?.filePaths ?? [])),
    symbols: unique(priorUnits.flatMap((unit) => unit.anchors?.symbols ?? [])),
    errors: unique(priorUnits.flatMap((unit) => unit.anchors?.errors ?? [])),
    tests: unique(priorUnits.flatMap((unit) => unit.anchors?.tests ?? [])),
    verificationSurfaces: unique(priorUnits.flatMap((unit) => unit.anchors?.verificationSurfaces ?? [])),
    tickets: unique(priorUnits.flatMap((unit) => unit.anchors?.tickets ?? [])),
  }, "parallel_fanout");
}

function carveWorkflowUnits(
  route: RouteDecision,
  objective: string,
  anchors: RequestAnchors,
  intents: CapabilityIntent[],
  notes: string[],
  languageGrounding?: LanguageGrounding,
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
        languageGrounding,
      } satisfies WorkflowUnit, item, itemAnchors, deliverables.ordered ? "serial" : "parallel_fanout");
    });

    const proposedUnits = !deliverables.ordered
      ? [...units, buildIntegrationUnit(objective, units.length + 1, units, graphNotes, languageGrounding)]
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
          languageGrounding,
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
      proposedUnits: [...units, buildIntegrationUnit(objective, units.length + 1, units, graphNotes, languageGrounding)],
      graphStrategy: "parallel_fanout",
      graphNotes,
    };
  }

  return {
    proposedUnits: [buildSingleUnit(route, objective, anchors, intents, notes, languageGrounding)],
    graphStrategy: "single",
    graphNotes: ["request stayed as one bounded workflow unit"],
  };
}

function buildIntakePlan(route: RouteDecision, rootDir = process.cwd()): IntakePlan {
  const objective = summarizeObjective(route.normalizedMessage);
  let anchors = extractAnchors(route.normalizedMessage);
  const languageGrounding = route.kind === "work" ? groundRequestLanguage(route.normalizedMessage, rootDir) : undefined;
  if (languageGrounding) {
    anchors = enrichAnchorsWithConceptMaps(anchors, languageGrounding);
  }
  const documentRetrieval: DocumentRetrieval | undefined =
    route.kind === "work"
      ? findRelatedDocuments(scanKrowDocuments(rootDir), objective, documentConceptKeys(languageGrounding))
      : undefined;
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

  if (languageGrounding) {
    notes.push(...languageGrounding.notes);
    maybeAdd(intents, {
      kind: "inspect_docs",
      priority: "high",
      reason: "ground the request in the approved project language before implementation",
      targets: unique([
        languageGrounding.summary.languageRef,
        languageGrounding.summary.conceptIndexRef,
        ...languageGrounding.relatedConceptMaps.map((conceptMap) => conceptMap.ref),
      ]),
    });

    if (languageGrounding.summary.requiresClarification) {
      notes.push(
        "resolve proposed or unresolved vocabulary during clarify from repository evidence; ask the user only when repository evidence conflicts or product behavior remains ambiguous",
      );
    }
  }

  if (documentRetrieval && documentRetrieval.related.length > 0) {
    notes.push(
      `related intent documents found: ${documentRetrieval.related.map((document) => document.ref).join(", ")}`,
    );
    maybeAdd(intents, {
      kind: "inspect_docs",
      priority: "high",
      reason: "load related PRD, plan, examples, or review docs before implementation",
      targets: documentRetrieval.related.map((document) => document.ref),
    });
  }

  if (documentRetrieval && documentRetrieval.approvalGaps.length > 0) {
    notes.push("related PRD or Plan documents are not approved; implementation should wait for approval");
    missingEvidence.push("PRD/Plan approval");
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

  if (anchors.errors.length > 0) {
    maybeAdd(intents, {
      kind: "inspect_logs",
      priority: "high",
      reason: "the request includes explicit failure evidence",
      targets: anchors.errors,
    });
    maybeAdd(intents, {
      kind: "inspect_tests",
      priority: "medium",
      reason: "explicit failure evidence should be checked against existing tests or a reproduction surface",
      targets: unique([...anchors.tests, ...anchors.verificationSurfaces]),
    });
  }

  if (lacksSpecificRequest(objective)) {
    notes.push("request is too generic to start safely without at least one concrete target");
    missingEvidence.push("exact target");
  }

  if (questions.length > 0) {
    notes.push("bundle every currently required external question into one clarify gate");
    notes.push("do not guess missing requirements; gather evidence from code, research, or user answers first");
  }

  const baseQuestions = unique(questions);
  const carved = carveWorkflowUnits(route, objective, anchors, intents, notes, languageGrounding);
  const proposedUnits = documentRetrieval
    ? carved.proposedUnits.map((unit) => ({
        ...unit,
        documentContext: visibleDocumentRetrieval(documentRetrieval),
        executionContract: executionContractFromRetrieval(documentRetrieval),
      }))
    : carved.proposedUnits;
  const intentLock = baseQuestions.length > 0
    ? buildIntentLock(
        objective,
        anchors,
        proposedUnits,
        carved.graphStrategy,
        unique(missingEvidence),
        languageGrounding,
      )
    : undefined;
  const bundledQuestions = intentLock
    ? [formatIntentLockBlock(intentLock), ...baseQuestions]
    : baseQuestions;

  return {
    objective,
    anchors,
    languageGrounding,
    intentLock,
    intents,
    proposedUnits,
    graphStrategy: carved.graphStrategy,
    graphNotes: carved.graphNotes,
    missingEvidence: unique(missingEvidence),
    questions: bundledQuestions,
    needsUserInput: bundledQuestions.length > 0,
    notes: unique(notes),
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
    case "check":
      return createPolicy(
        "control:check",
        "control",
        ["repo_scan", "search_code", "inspect_docs", "read_state", "write_state", "emit_gate"],
        [
          "local control command only",
          "writes generated evidence, check report, and proposed krow files under .krow only",
          "does not edit source code",
        ],
      );
    case "check-apply":
      return createPolicy(
        "control:check-apply",
        "control",
        ["inspect_docs", "read_state", "write_state"],
        ["local control command only", "applies explicit check decisions to .krow language and concept documents only"],
      );
    case "review":
      return createPolicy(
        "control:review",
        "control",
        ["inspect_docs", "read_state", "write_state"],
        ["local control command only", "derives a review report from stored workflow evidence"],
      );
    case "documents":
      return createPolicy(
        "control:documents",
        "control",
        ["inspect_docs"],
        ["local control command only", "reads krow Markdown documents and derived trace metadata"],
      );
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

function describeGraphStrategy(strategy: WorkflowGraphStrategy, units: WorkflowUnit[]): string {
  switch (strategy) {
    case "serial":
      return `${units.length} ordered workflow units`;
    case "parallel_fanout":
      return `${Math.max(1, units.length - 1)} scoped units plus one final integration unit`;
    case "single":
    default:
      return "one bounded workflow unit";
  }
}

function summarizePlannedUnits(units: WorkflowUnit[]): string {
  const titles = units
    .slice(0, 3)
    .map((unit) => unit.title.trim())
    .filter(Boolean);
  if (titles.length === 0) {
    return "(not carved yet)";
  }
  const remainder = units.length - titles.length;
  return remainder > 0 ? `${titles.join(" | ")} | +${remainder} more` : titles.join(" | ");
}

function summarizePlannedSurfaces(anchors: RequestAnchors, units: WorkflowUnit[]): string[] {
  return unique([
    ...anchors.filePaths.map(scopeKeyForFilePath),
    ...units.flatMap((unit) => unit.ownership ?? []),
    ...anchors.symbols,
  ]).slice(0, 5);
}

function summarizeNamespaceTerms(
  languageGrounding: LanguageGrounding | undefined,
  namespace: LanguageNamespace,
): string[] {
  if (!languageGrounding) {
    return [];
  }

  return unique(
    languageGrounding.matchedTerms
      .filter((term) => term.namespace === namespace)
      .map((term) => term.canonical),
  ).slice(0, 6);
}

function summarizeProposedTerms(languageGrounding: LanguageGrounding | undefined): string[] {
  if (!languageGrounding) {
    return [];
  }

  const matchedPhrases = unique(
    languageGrounding.matchedTerms.flatMap((term) => [term.canonical, ...term.aliases]).map((term) => term.toLowerCase()),
  );

  return unique(
    languageGrounding.proposedTerms
      .map((term) => term.canonical)
      .filter((term) => {
        const tokens = term.split(/\s+/).filter(Boolean);
        if (tokens.some((token) => token.length === 1)) {
          return false;
        }

        const normalized = term.toLowerCase();
        if (/[A-Za-z]/.test(term) && matchedPhrases.some((phrase) => normalized.includes(phrase))) {
          return false;
        }

        return true;
      }),
  ).slice(0, 8);
}

function formatIntentLockBlock(intentLock: IntakeIntentLock): string {
  return [
    intentLock.confirmationPrompt,
    "",
    "Current understanding:",
    ...intentLock.lines.map((line) => `- ${line}`),
  ].join("\n");
}

function buildIntentLock(
  objective: string,
  anchors: RequestAnchors,
  units: WorkflowUnit[],
  graphStrategy: WorkflowGraphStrategy,
  missingEvidence: string[],
  languageGrounding?: LanguageGrounding,
): IntakeIntentLock {
  const surfaces = summarizePlannedSurfaces(anchors, units);
  const verifySurface = unique([...anchors.tests, ...anchors.verificationSurfaces]).slice(0, 3);
  const coreTerms = summarizeNamespaceTerms(languageGrounding, "core");
  const techTerms = summarizeNamespaceTerms(languageGrounding, "tech");
  const projectTerms = summarizeNamespaceTerms(languageGrounding, "project");
  const conceptMaps = (languageGrounding?.relatedConceptMaps ?? []).map((conceptMap) => conceptMap.key).slice(0, 6);
  const unresolvedTerms = summarizeProposedTerms(languageGrounding);
  const lines = [
    `Objective: ${objective}`,
    `Workflow shape: ${describeGraphStrategy(graphStrategy, units)}`,
    `Planned units: ${summarizePlannedUnits(units)}`,
  ];

  if (surfaces.length > 0) {
    lines.push(`Likely surfaces: ${surfaces.join(", ")}`);
  }

  if (verifySurface.length > 0) {
    lines.push(`Current verify edge: ${verifySurface.join(", ")}`);
  } else {
    lines.push("Current verify edge: not locked yet");
  }

  if (coreTerms.length > 0) {
    lines.push(`Grounded core terms: ${coreTerms.join(", ")}`);
  }

  if (techTerms.length > 0) {
    lines.push(`Grounded tech terms: ${techTerms.join(", ")}`);
  }

  if (projectTerms.length > 0) {
    lines.push(`Grounded project terms: ${projectTerms.join(", ")}`);
  }

  if (conceptMaps.length > 0) {
    lines.push(`Related Project Concept Maps: ${conceptMaps.join(", ")}`);
  }

  if (unresolvedTerms.length > 0) {
    lines.push(`Request terms still needing repo grounding: ${unresolvedTerms.join(", ")}`);
  }

  if (missingEvidence.length > 0) {
    lines.push(`Still need confirmation for: ${missingEvidence.join(", ")}`);
  }

  return {
    summary: lines.join("\n"),
    lines,
    confirmationPrompt:
      "Confirm or correct this current understanding before implementation. Rewrite the target in the project language if any part is wrong.",
  };
}

function freeformDecisionPrompt(id: string, question: string, context?: string): DecisionPrompt {
  return {
    id,
    question,
    context,
    options: [
      {
        id: "answer",
        label: "Answer in free text",
        description: "Reply with the exact correction or confirmation needed to continue.",
      },
    ],
  };
}

function buildClarifyDecisionPrompts(intake: IntakePlan): DecisionPrompt[] {
  const decisionPrompts: DecisionPrompt[] = [];

  if (intake.intentLock) {
    decisionPrompts.push(
      freeformDecisionPrompt(
        "intent-lock",
        intake.intentLock.confirmationPrompt,
        formatIntentLockBlock(intake.intentLock),
      ),
    );
  }

  const followUpQuestions = intake.intentLock ? intake.questions.slice(1) : intake.questions;
  followUpQuestions.forEach((question, index) => {
    decisionPrompts.push(
      freeformDecisionPrompt(
        `clarify-${index + 1}`,
        question,
        "Answer concretely and keep the wording aligned with the project language where possible.",
      ),
    );
  });

  return decisionPrompts;
}

function primeWorkflowWithClarifyGate(state: WorkflowState, intake: IntakePlan): void {
  state.pendingDecisions = buildClarifyDecisionPrompts(intake);
  state.status = "clarify_pending";
  state.phase = "clarify";
  state.updatedAt = new Date().toISOString();
}

function startFromMessage(input: {
  message: string;
  mode?: string;
  explicitIntent?: RouteKind;
  captureEnabled?: boolean;
  maxVerifyAttempts?: number;
  rootDir?: string;
  createStateForQuestions?: boolean;
}): StartFromMessageResult {
  const route = routeRequest(input.message, {
    explicitIntent: input.explicitIntent,
  });
  const intake = buildIntakePlan(route, input.rootDir);
  const entryPolicy = resolveEntryPolicy(route);

  if (route.kind !== "work") {
    return {
      route,
      intake,
      entryPolicy,
      blockedByQuestions: intake.needsUserInput,
    };
  }

  if (intake.needsUserInput && !input.createStateForQuestions) {
    return {
      route,
      intake,
      entryPolicy,
      blockedByQuestions: true,
    };
  }

  const created = createWorkflow({
    mode: input.mode ?? "work",
    description: intake.objective,
    units: intake.proposedUnits,
    graphStrategy: intake.graphStrategy,
    graphNotes: intake.graphNotes,
    captureEnabled: input.captureEnabled ?? false,
    maxVerifyAttempts: input.maxVerifyAttempts ?? 3,
  });

  if (intake.needsUserInput) {
    primeWorkflowWithClarifyGate(created.state, intake);
  }

  return {
    route,
    intake,
    entryPolicy,
    phasePolicy: resolvePhasePolicy(created.state.phase),
    state: created.state,
    signal: nextSignal(created.state),
    blockedByQuestions: intake.needsUserInput,
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
    }),
  });
}

function handleIntake(args: string[], flags: FlagMap): void {
  const message = requireMessage(args, "intake");
  const result = startFromMessage({
    message,
    explicitIntent: parseIntentFlag(flags),
    rootDir: rootDir(flags),
  });

  outputJSON({
    control: getLocalControlCommand("intake"),
    route: result.route,
    intake: result.intake,
    entryPolicy: result.entryPolicy,
    blockedByQuestions: result.blockedByQuestions,
  });
}

function visibleDocumentSummary(document: KrowDocumentSummary) {
  return {
    kind: document.kind,
    ref: document.ref,
    title: document.title,
    approval: document.approval,
    concepts: document.concepts,
    traceLinks: document.traceLinks,
  };
}

function visibleDocumentRetrieval(retrieval: DocumentRetrieval) {
  return {
    related: retrieval.related.map(visibleDocumentSummary),
    approvalGaps: retrieval.approvalGaps.map(visibleDocumentSummary),
  };
}

function handleCheck(args: string[], flags: FlagMap): void {
  const positionalDescription = args.join(" ").trim() || undefined;
  const about = typeof flags.about === "string" ? flags.about : positionalDescription;
  const scope = typeof flags.scope === "string" ? flags.scope : undefined;
  const result = runProjectCheck({
    about,
    scope,
    rootDir: rootDir(flags),
  });

  outputJSON({
    control: getLocalControlCommand("check"),
    check: result,
  });
}

function handleCheckApply(args: string[], flags: FlagMap): void {
  const [checkId, inputValue] = args;
  if (!checkId || !inputValue) {
    throw new Error("check-apply requires <checkId> <json|path|->");
  }

  const result = applyProjectCheckDecisions({
    checkId,
    answers: readDecisionAnswersInput(inputValue),
    rootDir: rootDir(flags),
  });

  outputJSON({
    control: getLocalControlCommand("check-apply"),
    applied: result,
  });
}

function handleDocuments(args: string[], flags: FlagMap): void {
  const message = args.join(" ").trim();
  const documents = scanKrowDocuments(rootDir(flags));
  const languageGrounding = message ? groundRequestLanguage(message, rootDir(flags)) : undefined;
  const retrieval = message
    ? findRelatedDocuments(documents, message, documentConceptKeys(languageGrounding))
    : undefined;

  outputJSON({
    control: getLocalControlCommand("documents"),
    documents: {
      prds: documents.prds.map(visibleDocumentSummary),
      plans: documents.plans.map(visibleDocumentSummary),
      examples: documents.examples.map(visibleDocumentSummary),
      reviews: documents.reviews.map(visibleDocumentSummary),
      totalCount: documents.all.length,
    },
    traceOverview: deriveTraceOverview(documents),
    related: retrieval?.related.map(visibleDocumentSummary) ?? [],
    approvalGaps: retrieval
      ? retrieval.approvalGaps.map(visibleDocumentSummary)
      : documents.all
          .filter((document) => (document.kind === "prd" || document.kind === "plan") && document.approval.status !== "approved")
          .map(visibleDocumentSummary),
  });
}

function handleReview(args: string[], flags: FlagMap): void {
  const [workflowId, requestedUnitId] = args;
  if (!workflowId) {
    throw new Error("review requires <workflowId> [unitId]");
  }

  const state = loadValidatedWorkflowState(workflowId, flags);
  const unitId = requestedUnitId || state.units[state.currentUnitIndex]?.id;
  if (!unitId) {
    throw new Error("review could not determine a unit id");
  }

  const report = writeUnitReviewReport(state, unitId, rootDir(flags));
  saveWorkflowState(state, rootDir(flags));
  outputJSON({
    control: getLocalControlCommand("review"),
    reviewReport: report,
  });
}

function handleStart(args: string[], flags: FlagMap): void {
  const message = requireMessage(args, "start");
  const result = startFromMessage({
    message,
    explicitIntent: parseIntentFlag(flags),
    captureEnabled: flags.capture === true,
    mode: typeof flags.mode === "string" ? flags.mode : undefined,
    rootDir: rootDir(flags),
    createStateForQuestions: true,
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
  const submittedUnitId = state.units[state.currentUnitIndex]?.id;
  const result = applyPhaseOutput(state, phase, readJsonInput(inputValue));
  let reviewReport: UnitReviewReport | undefined;
  if (phase === "verify" && result.state && submittedUnitId) {
    reviewReport = writeUnitReviewReport(result.state, submittedUnitId, rootDir(flags));
  }
  if (result.state) {
    saveWorkflowState(result.state, rootDir(flags));
  }

  outputJSON({
    control: getLocalControlCommand("submit-phase"),
    signal: result.signal,
    reviewReport,
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
    case "check":
      handleCheck(positionals, flags);
      return;
    case "check-apply":
      handleCheckApply(positionals, flags);
      return;
    case "documents":
      handleDocuments(positionals, flags);
      return;
    case "review":
      handleReview(positionals, flags);
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
