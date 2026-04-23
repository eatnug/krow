import { existsSync, readFileSync } from "node:fs";
import type {
  LanguageGrounding,
  LanguageNamespace,
  LanguageStatement,
  LanguageTerm,
  LanguageTermMatch,
  RouteConfidence,
} from "./types.js";
import { absolutePath, projectLanguagePath } from "./workflow-files.js";

const SEED_MARKER = "This file defines the approved local language for this codebase.";

const builtinCoreTerms: Array<Omit<LanguageTerm, "status" | "source">> = [
  term("core:function", "core", "Function", ["function", "method", "함수", "메서드"]),
  term("core:class", "core", "Class", ["class", "클래스"]),
  term("core:object", "core", "Object", ["object", "객체"]),
  term("core:module", "core", "Module", ["module", "package", "모듈", "패키지"]),
  term("core:component", "core", "Component", ["component", "컴포넌트"]),
  term("core:service", "core", "Service", ["service", "서비스"]),
  term("core:api", "core", "API", ["api", "endpoint", "route", "엔드포인트", "라우트"]),
  term("core:event", "core", "Event", ["event", "이벤트"]),
  term("core:state", "core", "State", ["state", "상태"]),
  term("core:permission", "core", "Permission", ["permission", "approval", "권한", "승인"]),
  term("core:policy", "core", "Policy", ["policy", "정책"]),
  term("core:workflow", "core", "Workflow", ["workflow", "flow", "워크플로우", "플로우"]),
  term("core:job", "core", "Job", ["job", "task", "작업", "태스크"]),
  term("core:queue", "core", "Queue", ["queue", "큐"]),
  term("core:database", "core", "Database", ["database", "db", "디비", "DB"]),
  term("core:record", "core", "Record", ["record", "row", "레코드"]),
  term("core:migration", "core", "Migration", ["migration", "마이그레이션"]),
  term("core:test", "core", "Test", ["test", "spec", "테스트"]),
  term("core:build", "core", "Build", ["build", "빌드"]),
  term("core:release", "core", "Release", ["release", "deploy", "배포", "릴리즈"]),
  term("core:artifact", "core", "Artifact", ["artifact", "산출물"]),
  term("core:config", "core", "Config", ["config", "configuration", "설정", "컨피그"]),
  term("core:runtime", "core", "Runtime", ["runtime", "런타임"]),
  term("core:boundary", "core", "Boundary", ["boundary", "경계"]),
  term("core:adapter", "core", "Adapter", ["adapter", "어댑터"]),
  term("core:command", "core", "Command", ["command", "cli", "명령", "커맨드"]),
  term("core:file", "core", "File", ["file", "파일"]),
  term("core:script", "core", "Script", ["script", "스크립트"]),
  term("core:account", "core", "Account", ["account", "계정"]),
  term("core:role", "core", "Role", ["role", "역할"]),
  term("core:session", "core", "Session", ["session", "세션"]),
];

const builtinTechTerms: Array<Omit<LanguageTerm, "status" | "source">> = [
  term("tech:react", "tech", "React", ["react"]),
  term("tech:rust", "tech", "Rust", ["rust"]),
  term("tech:tauri", "tech", "Tauri", ["tauri"]),
  term("tech:fastapi", "tech", "FastAPI", ["fastapi"]),
  term("tech:sqlalchemy", "tech", "SQLAlchemy", ["sqlalchemy"]),
  term("tech:postgres", "tech", "Postgres", ["postgresql", "postgres"]),
  term("tech:sqlite", "tech", "SQLite", ["sqlite"]),
  term("tech:npm", "tech", "npm", ["npm", "npx"]),
  term("tech:cargo", "tech", "Cargo", ["cargo"]),
  term("tech:github-actions", "tech", "GitHub Actions", ["github actions", "actions"]),
  term("tech:testflight", "tech", "TestFlight", ["testflight", "테스트플라이트"]),
  term("tech:android", "tech", "Android", ["android", "안드로이드"]),
  term("tech:ios", "tech", "iOS", ["ios"]),
  term("tech:expo", "tech", "Expo", ["expo"]),
];

const relationPatterns: Array<{ relation: string; patterns: RegExp[] }> = [
  relation("calls", [/\bcalls?\b/i, /호출/]),
  relation("uses", [/\buses?\b/i, /\bwith\b/i, /사용|이용|써서|끼워/]),
  relation("creates", [/\bcreates?\b/i, /\badds?\b/i, /생성|만들|추가/]),
  relation("reads", [/\breads?\b/i, /읽/]),
  relation("writes", [/\bwrites?\b/i, /저장|쓰기|쓴다/]),
  relation("updates", [/\bupdates?\b/i, /\bchanges?\b/i, /수정|변경|바꿔/]),
  relation("removes", [/\bremoves?\b/i, /\bdeletes?\b/i, /삭제|지워/]),
  relation("depends_on", [/\bdepends?\s+on\b/i, /의존/]),
  relation("verifies", [/\bverif(?:y|ies)\b/i, /\btests?\b/i, /검증|테스트/]),
  relation("promotes_to", [/\bpromotes?\s+to\b/i, /승격|올려|배포/]),
  relation("routes_to", [/\broutes?\s+to\b/i, /라우팅|보내/]),
  relation("hands_off_to", [/\bhands?\s+off\s+to\b/i, /핸드오프/]),
  relation("blocks", [/\bblocks?\b/i, /막|차단/]),
  relation("emits", [/\bemits?\b/i, /emit|발행/]),
  relation("handles", [/\bhandles?\b/i, /처리/]),
];

const proposedStopWords = new Set([
  "그",
  "그거",
  "근데",
  "다",
  "뭐",
  "아니",
  "음",
  "이거",
  "저거",
  "좀",
  "하고",
  "해서",
  "테스트한다",
  "검증한다",
  "확인한다",
]);

function term(
  id: string,
  namespace: LanguageNamespace,
  canonical: string,
  aliases: string[] = [],
  evidence: string[] = [],
): Omit<LanguageTerm, "status" | "source"> {
  return { id, namespace, canonical, aliases, evidence };
}

function relation(relationName: string, patterns: RegExp[]) {
  return { relation: relationName, patterns };
}

function approvedBuiltinTerms(): LanguageTerm[] {
  return [...builtinCoreTerms, ...builtinTechTerms].map((item) => ({
    ...item,
    status: "approved" as const,
    source: "builtin" as const,
  }));
}

function namespaceFromHeading(heading: string): LanguageNamespace | undefined {
  const normalized = heading.toLowerCase();
  if (normalized.includes("core")) {
    return "core";
  }
  if (normalized.includes("tech") || normalized.includes("stack")) {
    return "tech";
  }
  if (normalized.includes("project") || normalized.includes("domain") || normalized.includes("architecture")) {
    return "project";
  }
  return undefined;
}

function namespaceFromId(id: string, fallback: LanguageNamespace | undefined): LanguageNamespace {
  if (id.startsWith("core:")) {
    return "core";
  }
  if (id.startsWith("tech:")) {
    return "tech";
  }
  if (id.startsWith("project:")) {
    return "project";
  }
  return fallback ?? "project";
}

function splitMarkdownRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function headerIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.includes(header.toLowerCase()));
}

function splitAliases(value: string | undefined): string[] {
  if (!value || value === "-" || value === "(none)") {
    return [];
  }
  return value
    .split(/[,;、]/)
    .map((alias) => alias.trim().replace(/^`|`$/g, ""))
    .filter(Boolean);
}

function normalizeId(namespace: LanguageNamespace, canonical: string, id?: string): string {
  const candidate = id && id !== "-" ? id : "";
  if (candidate) {
    return candidate.includes(":") ? candidate : `${namespace}:${slugify(candidate)}`;
  }
  return `${namespace}:${slugify(canonical)}`;
}

function parseTableRows(lines: string[], startIndex: number, namespace: LanguageNamespace | undefined): { terms: LanguageTerm[]; nextIndex: number } {
  const headers = splitMarkdownRow(lines[startIndex]);
  const lowerHeaders = headers.map((header) => header.toLowerCase());
  const idIndex = headerIndex(lowerHeaders, ["id", "term id", "key"]);
  const termIndex = headerIndex(lowerHeaders, ["term", "canonical", "name"]);
  const aliasIndex = headerIndex(lowerHeaders, ["aliases", "alias", "use instead of", "also called"]);
  const evidenceIndex = headerIndex(lowerHeaders, ["evidence", "binding", "code evidence", "source"]);
  const statusIndex = headerIndex(lowerHeaders, ["status"]);
  const terms: LanguageTerm[] = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim().startsWith("|")) {
    if (isTableSeparator(lines[index])) {
      index += 1;
      continue;
    }

    const cells = splitMarkdownRow(lines[index]);
    const canonical = cells[termIndex >= 0 ? termIndex : 0]?.replace(/^`|`$/g, "").trim();
    if (!canonical || canonical.toLowerCase() === "term") {
      index += 1;
      continue;
    }

    const id = idIndex >= 0 ? cells[idIndex]?.replace(/^`|`$/g, "").trim() : undefined;
    const resolvedNamespace = namespaceFromId(id ?? "", namespace);
    const aliases = splitAliases(aliasIndex >= 0 ? cells[aliasIndex] : undefined);
    const evidence = splitAliases(evidenceIndex >= 0 ? cells[evidenceIndex] : undefined);
    const statusValue = statusIndex >= 0 ? cells[statusIndex]?.toLowerCase() : "";

    terms.push({
      id: normalizeId(resolvedNamespace, canonical, id),
      namespace: resolvedNamespace,
      canonical,
      aliases,
      status: statusValue === "proposed" || statusValue === "unresolved" ? statusValue : "approved",
      source: "language_file",
      evidence,
    });
    index += 1;
  }

  return { terms, nextIndex: index };
}

function parseLanguageMarkdown(content: string): LanguageTerm[] {
  const lines = content.split(/\r?\n/);
  const terms: LanguageTerm[] = [];
  let currentNamespace: LanguageNamespace | undefined;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const heading = line.match(/^#{2,}\s+(.+)$/)?.[1]?.trim();
    if (heading) {
      currentNamespace = namespaceFromHeading(heading) ?? currentNamespace;
      index += 1;
      continue;
    }

    if (line.trim().startsWith("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const parsed = parseTableRows(lines, index, currentNamespace);
      terms.push(...parsed.terms);
      index = parsed.nextIndex;
      continue;
    }

    index += 1;
  }

  return terms;
}

function loadLanguageTerms(rootDir: string): {
  terms: LanguageTerm[];
  status: "missing" | "seed" | "custom";
  languageRef: string;
} {
  const languageRef = projectLanguagePath();
  const filePath = absolutePath(languageRef, rootDir);
  const builtinTerms = approvedBuiltinTerms();

  if (!existsSync(filePath)) {
    return { terms: builtinTerms, status: "missing", languageRef };
  }

  const content = readFileSync(filePath, "utf8");
  const parsed = parseLanguageMarkdown(content);
  const customTerms = parsed.filter((item) => item.status === "approved");
  const status = parsed.length === 0 && content.includes(SEED_MARKER) ? "seed" : "custom";
  return { terms: mergeTerms([...builtinTerms, ...customTerms]), status, languageRef };
}

function mergeTerms(terms: LanguageTerm[]): LanguageTerm[] {
  const seen = new Map<string, LanguageTerm>();
  for (const item of terms) {
    const existing = seen.get(item.id);
    if (!existing) {
      seen.set(item.id, item);
      continue;
    }
    seen.set(item.id, {
      ...existing,
      aliases: unique([...existing.aliases, ...item.aliases]),
      evidence: unique([...(existing.evidence ?? []), ...(item.evidence ?? [])]),
    });
  }
  return [...seen.values()];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]+$/.test(value);
}

function findPhrase(message: string, phrase: string): { index: number; matchedText: string } | undefined {
  if (!phrase || phrase.length < 2) {
    return undefined;
  }

  if (isAscii(phrase)) {
    const match = message.match(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i"));
    return match?.index === undefined ? undefined : { index: match.index, matchedText: match[0] };
  }

  const index = message.toLowerCase().indexOf(phrase.toLowerCase());
  return index >= 0 ? { index, matchedText: message.slice(index, index + phrase.length) } : undefined;
}

function matchTerms(message: string, terms: LanguageTerm[]): Array<LanguageTermMatch & { index: number }> {
  const matches: Array<LanguageTermMatch & { index: number }> = [];
  const sortedTerms = [...terms].sort((left, right) => right.canonical.length - left.canonical.length);

  for (const item of sortedTerms) {
    const phrases = unique([item.canonical, ...item.aliases]).sort((left, right) => right.length - left.length);
    const phraseMatch = phrases.map((phrase) => findPhrase(message, phrase)).find(Boolean);
    if (!phraseMatch) {
      continue;
    }
    if (matches.some((match) => match.id === item.id)) {
      continue;
    }
    matches.push({ ...item, matchedText: phraseMatch.matchedText, index: phraseMatch.index });
  }

  return matches.sort((left, right) => left.index - right.index);
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "term";
}

function cleanCandidate(value: string): string {
  return value
    .replace(/^[\s"'`([{<]+|[\s"'`\])}>.,;:!?]+$/g, "")
    .replace(/\s+(을|를|이|가|은|는|에게|에서|으로|로|와|과|의)$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addCandidate(candidates: Set<string>, value: string): void {
  const cleaned = cleanCandidate(value);
  if (cleaned.length < 2 || cleaned.length > 40) {
    return;
  }
  if (proposedStopWords.has(cleaned)) {
    return;
  }
  if (/^[\p{Script=Hangul}]{2,}로$/u.test(cleaned)) {
    return;
  }
  if (/(?:을|를)\s*(?:테스트|검증|실행)$/u.test(cleaned)) {
    return;
  }
  if (/(?:하고|해서|하며|올린다|올려|바꿔|고쳐|수정|구현|삭제|추가|배포).*[\p{Script=Hangul}]/u.test(cleaned) && cleaned.length > 12) {
    return;
  }
  if (!/[\p{Script=Hangul}`"'/-]/u.test(cleaned)) {
    return;
  }
  candidates.add(cleaned);
}

function addCandidateSegment(candidates: Set<string>, value: string): void {
  if (!/(?:에게|에서|으로|[이가은는을를])\s+/u.test(value)) {
    addCandidate(candidates, value);
  }

  const leadingHangulTerm = value.match(/^\s*([\p{Script=Hangul}]{2,8})(?=\s+[A-Za-z])/u)?.[1];
  if (leadingHangulTerm) {
    addCandidate(candidates, leadingHangulTerm);
  }

  const afterParticle = value.match(/(?:에게|에서|으로|[이가은는을를])\s+(.+)$/u)?.[1];
  if (afterParticle && /^[\p{Script=Hangul}]/u.test(afterParticle.trim())) {
    addCandidate(candidates, afterParticle);
  }
}

function addCandidateWithSplits(candidates: Set<string>, value: string): void {
  addCandidateSegment(candidates, value);

  for (const segment of value.split(/(?:하고|해서|하며|올린다|올려|바꿔|고쳐|수정|구현|삭제|추가|배포)/u)) {
    addCandidateSegment(candidates, segment);
  }
}

function extractProposedTerms(message: string, matchedTerms: LanguageTermMatch[]): LanguageTerm[] {
  const candidates = new Set<string>();
  const matchedTexts = matchedTerms.flatMap((item) => [item.canonical, item.matchedText, ...item.aliases]).map((item) => item.toLowerCase());

  for (const match of message.matchAll(/`([^`]+)`|"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’/g)) {
    addCandidateWithSplits(candidates, match.slice(1).find(Boolean) ?? "");
  }

  for (const match of message.matchAll(/[\p{Script=Hangul}A-Za-z0-9_ -]+(?:\/[\p{Script=Hangul}A-Za-z0-9_ -]+)+/gu)) {
    match[0].split("/").forEach((part) => addCandidateWithSplits(candidates, part));
  }

  for (const match of message.matchAll(/([\p{Script=Hangul}A-Za-z0-9_ -]+(?:,\s*[\p{Script=Hangul}A-Za-z0-9_ -]+)+)/gu)) {
    match[0].split(",").forEach((part) => addCandidateWithSplits(candidates, part));
  }

  for (const match of message.matchAll(/([\p{Script=Hangul}A-Za-z0-9_ -]{2,30})(?=(?:에게|은|는|이|가|을|를|의))/gu)) {
    addCandidateWithSplits(candidates, match[1]);
  }

  return [...candidates]
    .filter((candidate) => !matchedTexts.includes(candidate.toLowerCase()))
    .slice(0, 12)
    .map((candidate) => ({
      id: `project:${slugify(candidate)}`,
      namespace: "project" as const,
      canonical: candidate,
      aliases: [],
      status: "proposed" as const,
      source: "request" as const,
      evidence: ["mentioned in the user request"],
    }));
}

function termStatus(subject: LanguageTermMatch | LanguageTerm, object?: LanguageTermMatch | LanguageTerm): LanguageStatement["status"] {
  if (subject.status === "approved" && (!object || object.status === "approved")) {
    return "grounded";
  }
  if (subject.status === "unresolved" || object?.status === "unresolved") {
    return "unresolved";
  }
  return "proposed";
}

function sourceWindow(message: string, index: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(message.length, index + 60);
  return message.slice(start, end).replace(/\s+/g, " ").trim();
}

function inferRelationStatements(
  message: string,
  matchedTerms: Array<LanguageTermMatch & { index: number }>,
  proposedTerms: LanguageTerm[],
): LanguageStatement[] {
  const statements: LanguageStatement[] = matchedTerms.map((item) => ({
    subject: "request",
    relation: "mentions",
    object: item.id,
    status: termStatus(item),
    confidence: "high" as RouteConfidence,
    sourceText: item.matchedText,
  }));

  for (const item of proposedTerms) {
    statements.push({
      subject: "request",
      relation: "proposes_term",
      object: item.id,
      status: "proposed",
      confidence: "medium",
      sourceText: item.canonical,
    });
  }

  const positionedTerms = matchedTerms.map((item) => ({ id: item.id, status: item.status, index: item.index }));
  for (const relationItem of relationPatterns) {
    for (const pattern of relationItem.patterns) {
      const match = message.match(pattern);
      if (!match || match.index === undefined) {
        continue;
      }

      const before = [...positionedTerms].reverse().find((item) => item.index < match.index!);
      const after = positionedTerms.find((item) => item.index > match.index!);
      if (!before || !after) {
        statements.push({
          subject: "request",
          relation: `contains_relation:${relationItem.relation}`,
          object: "unresolved",
          status: "unresolved",
          confidence: "low",
          sourceText: sourceWindow(message, match.index),
        });
        continue;
      }

      statements.push({
        subject: before.id,
        relation: relationItem.relation,
        object: after.id,
        status: before.status === "approved" && after.status === "approved" ? "grounded" : "proposed",
        confidence: "medium",
        sourceText: sourceWindow(message, match.index),
      });
    }
  }

  return uniqueStatements(statements);
}

function uniqueStatements(statements: LanguageStatement[]): LanguageStatement[] {
  const keys = new Set<string>();
  return statements.filter((statement) => {
    const key = `${statement.subject}|${statement.relation}|${statement.object}`;
    if (keys.has(key)) {
      return false;
    }
    keys.add(key);
    return true;
  });
}

function formatTerms(terms: LanguageTerm[]): string {
  return terms
    .slice(0, 10)
    .map((item) => item.canonical)
    .join(", ");
}

export function groundRequestLanguage(message: string, rootDir = process.cwd()): LanguageGrounding {
  const loaded = loadLanguageTerms(rootDir);
  const matchedTerms = matchTerms(message, loaded.terms);
  const proposedTerms = extractProposedTerms(message, matchedTerms);
  const statements = inferRelationStatements(message, matchedTerms, proposedTerms);
  const unresolvedRelationCount = statements.filter((item) => item.status === "unresolved").length;
  const unresolvedRelationsRequireClarification = unresolvedRelationCount > 0 && proposedTerms.length > 0;
  const requiresClarification =
    proposedTerms.length > 0 || unresolvedRelationsRequireClarification;
  const questions: string[] = [];
  const notes: string[] = [
    "language grounding is controlled vocabulary plus evidence, not a layer-by-layer translation map",
    "core terms are general software concepts; tech terms name specific stacks/tools; project terms name product/domain concepts",
  ];

  if (loaded.status !== "custom" && proposedTerms.length > 0) {
    questions.push(
      `The project language file is ${loaded.status}. Confirm the canonical project terms and aliases that should govern this request before implementation.`,
    );
    notes.push("project vocabulary is not yet custom, so broad work should not invent durable project terms silently");
  }

  if (proposedTerms.length > 0) {
    questions.push(
      `Which proposed request terms should be approved project terms, aliases, or discarded? Proposed terms: ${formatTerms(proposedTerms)}.`,
    );
  }

  if (unresolvedRelationsRequireClarification) {
    questions.push("Some software relations were detected without grounded subject/object terms; clarify the intended term relationship before execution.");
  }

  return {
    summary: {
      languageRef: loaded.languageRef,
      vocabularyStatus: loaded.status,
      approvedTermCount: loaded.terms.length,
      matchedTermCount: matchedTerms.length,
      proposedTermCount: proposedTerms.length,
      unresolvedRelationCount,
      requiresClarification,
    },
    matchedTerms: matchedTerms.map(({ index: _index, ...item }) => item),
    proposedTerms,
    statements,
    notes,
    questions,
  };
}
