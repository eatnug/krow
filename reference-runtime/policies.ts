import { CapabilityIntent, IntakePlan, RequestAnchors, RouteDecision } from "./types";

const filePathPattern = /(?:^|[\s(])((?:src|app|lib|tests?|packages|services)\/[^\s)]+)/gi;
const symbolPattern = /\b([A-Z][A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)?)\b/g;
const ticketPattern = /\b(?:[A-Z]+-\d+|#\d+)\b/g;
const errorPattern =
  /\b((?:TypeError|ReferenceError|SyntaxError|Error|Exception|stack trace|failing test|test failure|bug|regression)[^,.;\n]*)/gi;
const testPattern = /\b([A-Za-z0-9_./-]*(?:test|spec)\.[A-Za-z0-9_.-]+)\b/gi;

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
  return unique(matches);
}

export function extractAnchors(message: string): RequestAnchors {
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
  return /\b(fix|debug|bug|regression|error|exception|failing)\b/i.test(objective) || /(버그|에러|오류|디버그|실패|회귀)/.test(objective);
}

function looksLikeCreate(objective: string): boolean {
  return /\b(create|build|implement|add|ship|feature)\b/i.test(objective) || /(만들|구현|추가)/.test(objective);
}

function looksLikeRemoval(objective: string): boolean {
  return /\b(remove|delete)\b/i.test(objective) || /(삭제|지워)/.test(objective);
}

export function buildIntakePlan(route: RouteDecision): IntakePlan {
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
