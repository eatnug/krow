import { RouteDecision, RouteKind } from "./types";

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

function cleanMessage(message: string): string {
  return message.trim();
}

function scorePatterns(message: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(message) ? 1 : 0), 0);
}

function confidenceFromScore(score: number): "low" | "medium" | "high" {
  if (score >= 3) {
    return "high";
  }
  if (score === 2) {
    return "medium";
  }
  return "low";
}

export function routeRequest(message: string, options?: { explicitIntent?: RouteKind; allowHeuristics?: boolean }): RouteDecision {
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

  if (!options?.allowHeuristics) {
    reasons.push("no explicit work intent was provided");
    return {
      rawMessage: message,
      normalizedMessage,
      kind: "chat",
      source: "heuristic",
      confidence: "high",
      forced: false,
      reasons,
    };
  }

  const workScore = scorePatterns(normalizedMessage, workPatterns) + scorePatterns(normalizedMessage, anchorPatterns);
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
    source: "heuristic",
    confidence: confidenceFromScore(Math.max(workScore, chatScore)),
    forced: false,
    reasons,
  };
}
