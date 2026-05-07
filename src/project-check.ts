import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CHECKS_DIR,
  CONCEPT_INDEX_FILE,
  CONCEPTS_DIR,
  GENERATED_DIR,
  PROJECT_LANGUAGE_FILE,
  absolutePath,
  checkRunDirPath,
} from "./workflow-files.js";
import { scanKrowDocuments } from "./document-contracts.js";
import type { DecisionAnswer, DecisionPrompt } from "./types.js";

type CodeFileKind = "source" | "test" | "doc" | "config";

export interface CodeInventoryFile {
  path: string;
  kind: CodeFileKind;
  extension: string;
  size: number;
  symbols: string[];
  routes: string[];
}

export interface CodeInventory {
  generatedAt: string;
  root: string;
  fileCount: number;
  files: CodeInventoryFile[];
}

export interface CheckFinding {
  kind: "missing-concept" | "broken-anchor" | "uncovered-example" | "empty-language" | "empty-concepts";
  severity: "info" | "warning";
  message: string;
  refs: string[];
}

interface CandidateConcept {
  key: string;
  title: string;
  aliases: string[];
  evidence: string[];
  symbols: string[];
  kind: "concept" | "interface" | "module";
  layer: "product" | "system";
  means: string;
}

interface CheckProposal {
  checkId: string;
  generatedAt: string;
  concepts: CandidateConcept[];
}

export interface ProjectCheckResult {
  checkId: string;
  status: "clean" | "needs-review";
  reportRef: string;
  generatedRefs: string[];
  proposalRefs: string[];
  questionRefs: string[];
  findings: CheckFinding[];
  decisions: DecisionPrompt[];
  summary: {
    scannedFileCount: number;
    proposedConceptCount: number;
    findingCount: number;
    writesOutsideKrow: false;
  };
}

export interface CheckApplyResult {
  checkId: string;
  appliedRefs: string[];
  skipped: string[];
  reportRef: string;
}

const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  ".krow",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
]);

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".cs",
  ".sql",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
]);

const docExtensions = new Set([".md", ".mdx", ".txt", ".rst"]);
const configExtensions = new Set([".json", ".yaml", ".yml", ".toml", ".xml", ".ini"]);
const symbolicExtensions = new Set([...sourceExtensions, ...configExtensions]);
const maxReadableBytes = 500_000;
const maxFiles = 4000;
const maxSymbolsPerFile = 40;
const maxProposedConcepts = 8;

const conceptStopWords = new Set([
  "app",
  "args",
  "async",
  "base",
  "build",
  "cli",
  "client",
  "command",
  "config",
  "const",
  "context",
  "data",
  "default",
  "dist",
  "docs",
  "error",
  "file",
  "helper",
  "index",
  "input",
  "install",
  "json",
  "lib",
  "main",
  "node",
  "output",
  "package",
  "path",
  "props",
  "readme",
  "request",
  "result",
  "script",
  "server",
  "src",
  "state",
  "test",
  "tests",
  "type",
  "types",
  "utils",
  "value",
]);

function nowCompact(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function nowIso(): string {
  return new Date().toISOString();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`"'/_:.-]+/g, " ")
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  const slug = normalizeSearchText(value).replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "concept";
}

function titleFromWords(words: string[]): string {
  return words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9가-힣]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

function conceptTitleFromIdentifier(value: string): string | undefined {
  const words = splitIdentifier(value).filter((word) => {
    const normalized = word.toLowerCase();
    return word.length > 1 && !conceptStopWords.has(normalized) && !/^\d+$/.test(word);
  });
  if (words.length === 0 || words.length > 5) {
    return undefined;
  }
  if (!words.some((word) => word.length >= 4 || /[가-힣]/.test(word))) {
    return undefined;
  }
  return titleFromWords(words);
}

function isStableConceptSymbol(symbol: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(symbol);
}

function shouldReadFile(filePath: string): boolean {
  const extension = path.extname(filePath);
  return sourceExtensions.has(extension) || docExtensions.has(extension) || configExtensions.has(extension);
}

function fileKind(relativePath: string): CodeFileKind {
  const basename = path.basename(relativePath);
  const extension = path.extname(relativePath);
  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)/i.test(relativePath) || /\.(test|spec)\.[A-Za-z0-9]+$/i.test(basename)) {
    return "test";
  }
  if (docExtensions.has(extension)) {
    return "doc";
  }
  if (configExtensions.has(extension) || /(?:config|rc)\.[A-Za-z0-9]+$/i.test(basename)) {
    return "config";
  }
  return "source";
}

function extractSymbols(content: string): string[] {
  const symbols: string[] = [];
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        symbols.push(match[1]);
      }
      if (symbols.length >= maxSymbolsPerFile) {
        return unique(symbols);
      }
    }
  }

  return unique(symbols);
}

function extractRoutes(content: string): string[] {
  const routes: string[] = [];
  const patterns = [
    /\b(?:app|router)\.(?:get|post|put|patch|delete|use)\(\s*["']([^"']+)["']/g,
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+["']([^"']+)["']/g,
    /\bpath\s*:\s*["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]?.startsWith("/")) {
        routes.push(match[1]);
      }
    }
  }

  return unique(routes).slice(0, 20);
}

function walkFiles(rootDir: string, currentDir = rootDir, collected: string[] = []): string[] {
  if (collected.length >= maxFiles) {
    return collected;
  }

  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        continue;
      }
      walkFiles(rootDir, path.join(currentDir, entry.name), collected);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (!shouldReadFile(relativePath)) {
      continue;
    }
    collected.push(relativePath);
    if (collected.length >= maxFiles) {
      break;
    }
  }

  return collected;
}

function scopeFiles(rootDir: string, scope?: string): string[] {
  if (!scope) {
    return walkFiles(rootDir);
  }

  const target = path.resolve(rootDir, scope);
  const relative = path.relative(rootDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(target)) {
    return walkFiles(rootDir);
  }

  const stats = statSync(target);
  if (stats.isFile()) {
    const scopedPath = path.relative(rootDir, target).replace(/\\/g, "/");
    return shouldReadFile(scopedPath) ? [scopedPath] : [];
  }
  if (stats.isDirectory()) {
    return walkFiles(rootDir, target);
  }
  return walkFiles(rootDir);
}

function buildCodeInventory(rootDir: string, scope?: string): CodeInventory {
  const root = path.resolve(rootDir);
  const files = scopeFiles(root, scope).map((relativePath): CodeInventoryFile => {
    const fullPath = path.join(root, relativePath);
    const stats = statSync(fullPath);
    const extension = path.extname(relativePath);
    let content = "";
    if (stats.size <= maxReadableBytes && symbolicExtensions.has(extension)) {
      content = readFileSync(fullPath, "utf8");
    }
    return {
      path: relativePath,
      kind: fileKind(relativePath),
      extension,
      size: stats.size,
      symbols: content ? extractSymbols(content) : [],
      routes: content ? extractRoutes(content) : [],
    };
  });

  return {
    generatedAt: nowIso(),
    root,
    fileCount: files.length,
    files,
  };
}

function loadConceptMaps(rootDir: string): Array<{ key: string; title: string; ref: string; codeAnchors: string[] }> {
  const dir = absolutePath(CONCEPTS_DIR, rootDir);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => {
      const ref = `${CONCEPTS_DIR}/${entry.name}`;
      const content = readFileSync(absolutePath(ref, rootDir), "utf8");
      const key = content.match(/^Key:\s*(.+)$/m)?.[1]?.trim() || entry.name.replace(/\.md$/i, "");
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || key;
      const anchors = labelList(content, "Code Anchors")
        .map((item) => cleanAnchorTarget(item))
        .filter((value): value is string => Boolean(value) && !value.startsWith("<"));
      return { key, title, ref, codeAnchors: anchors };
    });
}

function loadLanguageText(rootDir: string): string {
  const ref = absolutePath(PROJECT_LANGUAGE_FILE, rootDir);
  return existsSync(ref) ? readFileSync(ref, "utf8") : "";
}

function labelList(content: string, label: string): string[] {
  const lines = content.split(/\r?\n/);
  const values: string[] = [];
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelPattern = new RegExp(`^${escapedLabel}:\\s*(.*)$`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(labelPattern);
    if (!match) {
      continue;
    }
    if (match[1]?.trim()) {
      values.push(match[1].trim());
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const trimmed = lines[next].trim();
      if (!trimmed) {
        break;
      }
      if (/^#{1,6}\s+/.test(trimmed) || /^[A-Za-z][A-Za-z ]{1,40}:\s*/.test(trimmed)) {
        break;
      }
      const item = trimmed.match(/^[-*]\s+(.+)$/)?.[1]?.trim();
      if (item) {
        values.push(item);
      }
    }
  }

  return unique(values);
}

function languageTerms(content: string): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) {
    const first = match[1]?.trim();
    const second = match[2]?.trim();
    if (!first || !second || first === "ID" || /^-+$/.test(first)) {
      continue;
    }
    values.push(first, second);
  }
  return unique(values.map(normalizeSearchText).filter(Boolean));
}

function candidateConcepts(inventory: CodeInventory, existingTerms: string[], existingConceptKeys: string[]): CandidateConcept[] {
  const byKey = new Map<string, CandidateConcept & { score: number }>();
  const existing = new Set([...existingTerms, ...existingConceptKeys.map(normalizeSearchText)]);

  function addCandidate(title: string | undefined, evidence: string, options: {
    symbol?: string;
    kind: CandidateConcept["kind"];
    layer: CandidateConcept["layer"];
    score: number;
  }): void {
    if (!title) {
      return;
    }
    const key = slugify(title);
    if (existing.has(normalizeSearchText(title)) || existing.has(normalizeSearchText(key))) {
      return;
    }
    const current = byKey.get(key);
    if (current) {
      current.score += options.score;
      current.evidence = unique([...current.evidence, evidence]).slice(0, 6);
      current.symbols = unique([...current.symbols, ...(options.symbol ? [options.symbol] : [])]).slice(0, 8);
      return;
    }

    byKey.set(key, {
      key,
      title,
      aliases: [],
      evidence: [evidence],
      symbols: options.symbol ? [options.symbol] : [],
      kind: options.kind,
      layer: options.layer,
      means: `Observed codebase concept associated with ${evidence}. Confirm the product meaning before treating it as approved Project Language.`,
      score: options.score,
    });
  }

  for (const file of inventory.files) {
    if (file.kind === "source") {
      addCandidate(conceptTitleFromIdentifier(path.basename(file.path)), file.path, {
        kind: "module",
        layer: "system",
        score: 1,
      });
    }
    for (const symbol of file.symbols) {
      if (!isStableConceptSymbol(symbol)) {
        continue;
      }
      addCandidate(conceptTitleFromIdentifier(symbol), file.path, {
        symbol,
        kind: "interface",
        layer: "system",
        score: 3,
      });
    }
  }

  return [...byKey.values()]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, maxProposedConcepts)
    .map(({ score: _score, ...candidate }) => candidate);
}

function cleanAnchorTarget(value: string): string {
  return value
    .replace(/^[A-Za-z ]+:\s*/, "")
    .replace(/^`|`$/g, "")
    .trim();
}

function pathishAnchor(value: string): string | undefined {
  const cleaned = cleanAnchorTarget(value);
  const match = cleaned.match(/((?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?)/);
  return match?.[1];
}

function brokenAnchors(rootDir: string, conceptMaps: ReturnType<typeof loadConceptMaps>): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const conceptMap of conceptMaps) {
    for (const anchor of conceptMap.codeAnchors) {
      const target = pathishAnchor(anchor);
      if (!target) {
        continue;
      }
      if (existsSync(path.resolve(rootDir, target))) {
        continue;
      }
      findings.push({
        kind: "broken-anchor",
        severity: "warning",
        message: `Concept Map ${conceptMap.key} points to a missing code anchor: ${target}`,
        refs: [conceptMap.ref, target],
      });
    }
  }
  return findings;
}

function uncoveredExamples(rootDir: string, inventory: CodeInventory): CheckFinding[] {
  const documents = scanKrowDocuments(rootDir);
  const exampleIds = unique(
    documents.all.flatMap((document) => document.traceLinks.filter((link) => link.kind === "example").map((link) => link.id)),
  );
  if (exampleIds.length === 0) {
    return [];
  }

  const testFiles = inventory.files.filter((file) => file.kind === "test");
  const testContent = testFiles
    .filter((file) => file.size <= maxReadableBytes)
    .map((file) => readFileSync(path.join(rootDir, file.path), "utf8"))
    .join("\n");

  return exampleIds
    .filter((exampleId) => !testContent.includes(exampleId))
    .map((exampleId) => ({
      kind: "uncovered-example" as const,
      severity: "warning" as const,
      message: `Example ${exampleId} was found in krow documents, but no test file references it.`,
      refs: [exampleId],
    }));
}

function proposalMarkdown(candidate: CandidateConcept, status: "proposed" | "approved"): string {
  const anchors = candidate.evidence.map((item) => `- Code: \`${item}\``);
  return [
    `# ${candidate.title}`,
    "",
    `Key: ${candidate.key}`,
    `Kind: ${candidate.kind}`,
    `Layer: ${candidate.layer}`,
    `Status: ${status}`,
    "",
    "Means:",
    candidate.means,
    "",
    "Related Concepts:",
    "- (none)",
    "",
    "Code Anchors:",
    ...anchors,
    "",
    "Boundaries:",
    "- Confirm the boundary before approving this concept for product-facing work.",
    "",
    "Open Questions:",
    "- Is this a stable Project Language concept or only local implementation detail?",
    "",
  ].join("\n");
}

function proposedLanguageMarkdown(proposal: CheckProposal): string {
  return [
    "# Proposed Project Language Entries",
    "",
    `Check ID: ${proposal.checkId}`,
    `Generated At: ${proposal.generatedAt}`,
    "",
    "These rows are not approved Project Language. `$check` applies only explicit user decisions.",
    "",
    "| ID | Term | Aliases | Evidence |",
    "|----|------|---------|----------|",
    ...proposal.concepts.map(
      (concept) =>
        `| project:${concept.key} | ${concept.title} | ${concept.aliases.join(", ") || "-"} | ${concept.evidence.join(", ")} |`,
    ),
    "",
  ].join("\n");
}

function conceptDecisionPrompts(proposal: CheckProposal): DecisionPrompt[] {
  return proposal.concepts.slice(0, 8).map((concept) => ({
    id: `concept:${concept.key}`,
    kind: "approval" as const,
    target: {
      kind: "language" as const,
      ref: `${checkRunDirPath(proposal.checkId)}/proposed-concepts/${concept.key}.md`,
      status: "proposed",
    },
    question: `Approve "${concept.title}" (${concept.key}) as a Project Language concept?`,
    context: [
      `Evidence: ${concept.evidence.join(", ")}`,
      `Proposed meaning: ${concept.means}`,
      "Approve applies the proposed entry. Revise should provide a precise replacement meaning or JSON fields for term/key/means.",
    ].join("\n"),
    options: [
      { id: "approve", label: "Approve", description: "Apply this proposed concept to .krow/language.md and .krow/concepts." },
      { id: "revise", label: "Revise", description: "Apply with explicit user-provided corrections." },
      { id: "reject", label: "Reject", description: "Do not add this concept." },
    ],
  }));
}

function reportMarkdown(result: Omit<ProjectCheckResult, "reportRef" | "generatedRefs" | "proposalRefs" | "questionRefs">, refs: {
  generatedRefs: string[];
  proposalRefs: string[];
  questionRefs: string[];
}): string {
  return [
    "# Krow Check Report",
    "",
    `Check ID: ${result.checkId}`,
    `Status: ${result.status}`,
    "",
    "## Write Boundary",
    "",
    "- Read: repository workspace",
    "- Write: configured krow workspace (`.krow`) only",
    "- Source code changes: none",
    "",
    "## Summary",
    "",
    `- Scanned files: ${result.summary.scannedFileCount}`,
    `- Proposed concepts: ${result.summary.proposedConceptCount}`,
    `- Findings: ${result.summary.findingCount}`,
    "",
    "## Generated Evidence",
    "",
    ...markdownList(refs.generatedRefs),
    "",
    "## Proposed Krow Files",
    "",
    ...markdownList(refs.proposalRefs),
    "",
    "## Questions",
    "",
    ...markdownList(refs.questionRefs),
    "",
    "## Findings",
    "",
    ...(result.findings.length > 0
      ? result.findings.map((finding) => `- ${finding.severity}: ${finding.kind}: ${finding.message}`)
      : ["- none"]),
    "",
    "## Next Step",
    "",
    result.decisions.length > 0
      ? "Use the `$check` skill to ask the bundled questions and apply only approved decisions."
      : "No approval questions were generated.",
    "",
  ].join("\n");
}

function markdownList(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- none"];
}

function ensureKrowDirectory(ref: string, rootDir: string): void {
  const absolute = absolutePath(ref, rootDir);
  if (!path.relative(absolutePath(".krow", rootDir), absolute).startsWith("..")) {
    mkdirSync(absolute, { recursive: true });
    return;
  }
  throw new Error(`refusing to write outside .krow: ${ref}`);
}

function writeKrowFile(ref: string, content: string, rootDir: string): void {
  const absolute = absolutePath(ref, rootDir);
  const krowRoot = absolutePath(".krow", rootDir);
  const relative = path.relative(krowRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`refusing to write outside .krow: ${ref}`);
  }
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

export function runProjectCheck(input: { scope?: string; rootDir?: string }): ProjectCheckResult {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const checkId = `check-${nowCompact()}`;
  const checkDir = checkRunDirPath(checkId);
  const generatedRef = `${GENERATED_DIR}/code-inventory.json`;
  const proposalRef = `${checkDir}/proposal.json`;
  const proposedLanguageRef = `${checkDir}/proposed-language.md`;
  const proposedConceptDir = `${checkDir}/proposed-concepts`;
  const questionsRef = `${checkDir}/questions.json`;
  const reportRef = `${checkDir}/report.md`;

  ensureKrowDirectory(GENERATED_DIR, rootDir);
  ensureKrowDirectory(checkDir, rootDir);
  ensureKrowDirectory(proposedConceptDir, rootDir);

  const inventory = buildCodeInventory(rootDir, input.scope);
  writeKrowFile(generatedRef, `${JSON.stringify(inventory, null, 2)}\n`, rootDir);

  const conceptMaps = loadConceptMaps(rootDir);
  const language = loadLanguageText(rootDir);
  const concepts = candidateConcepts(
    inventory,
    languageTerms(language),
    conceptMaps.flatMap((conceptMap) => [conceptMap.key, conceptMap.title]),
  );
  const proposal: CheckProposal = {
    checkId,
    generatedAt: nowIso(),
    concepts,
  };

  writeKrowFile(proposalRef, `${JSON.stringify(proposal, null, 2)}\n`, rootDir);
  writeKrowFile(proposedLanguageRef, proposedLanguageMarkdown(proposal), rootDir);

  const conceptRefs = concepts.map((concept) => `${proposedConceptDir}/${concept.key}.md`);
  concepts.forEach((concept, index) => {
    writeKrowFile(conceptRefs[index], proposalMarkdown(concept, "proposed"), rootDir);
  });

  const decisions = conceptDecisionPrompts(proposal);
  writeKrowFile(questionsRef, `${JSON.stringify(decisions, null, 2)}\n`, rootDir);

  const findings: CheckFinding[] = [
    ...(language.trim() ? [] : [{
      kind: "empty-language" as const,
      severity: "info" as const,
      message: `${PROJECT_LANGUAGE_FILE} is missing or empty.`,
      refs: [PROJECT_LANGUAGE_FILE],
    }]),
    ...(conceptMaps.length > 0 ? [] : [{
      kind: "empty-concepts" as const,
      severity: "info" as const,
      message: "No Project Concept Maps were found.",
      refs: [CONCEPTS_DIR],
    }]),
    ...concepts.map((concept) => ({
      kind: "missing-concept" as const,
      severity: "info" as const,
      message: `Candidate Project Language concept found from code: ${concept.title} (${concept.key})`,
      refs: concept.evidence,
    })),
    ...brokenAnchors(rootDir, conceptMaps),
    ...uncoveredExamples(rootDir, inventory),
  ];
  const status: ProjectCheckResult["status"] = findings.length > 0 || decisions.length > 0 ? "needs-review" : "clean";
  const generatedRefs = [generatedRef];
  const proposalRefs = [proposalRef, proposedLanguageRef, ...conceptRefs];
  const questionRefs = [questionsRef];
  const resultWithoutRefs = {
    checkId,
    status,
    findings,
    decisions,
    summary: {
      scannedFileCount: inventory.fileCount,
      proposedConceptCount: concepts.length,
      findingCount: findings.length,
      writesOutsideKrow: false as const,
    },
  };

  writeKrowFile(reportRef, reportMarkdown(resultWithoutRefs, { generatedRefs, proposalRefs, questionRefs }), rootDir);

  return {
    ...resultWithoutRefs,
    reportRef,
    generatedRefs,
    proposalRefs,
    questionRefs,
  };
}

function normalizeCheckId(value: string): string {
  const basename = path.basename(value.replace(/\/$/, ""));
  if (!/^check-[A-Za-z0-9TZ]+$/.test(basename)) {
    throw new Error(`invalid check id: ${value}`);
  }
  return basename;
}

function loadProposal(checkId: string, rootDir: string): CheckProposal {
  const ref = `${checkRunDirPath(checkId)}/proposal.json`;
  const filePath = absolutePath(ref, rootDir);
  if (!existsSync(filePath)) {
    throw new Error(`missing check proposal: ${ref}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as CheckProposal;
}

function conceptFromDecision(candidate: CandidateConcept, answer: DecisionAnswer): CandidateConcept | undefined {
  if (answer.selectedOptionId === "reject") {
    return undefined;
  }
  if (answer.selectedOptionId === "approve") {
    return candidate;
  }
  if (answer.selectedOptionId !== "revise") {
    return undefined;
  }

  const input = answer.customInput?.trim();
  if (!input) {
    return undefined;
  }

  if (input.startsWith("{")) {
    const parsed = JSON.parse(input) as Partial<CandidateConcept> & { term?: string };
    const title = parsed.title ?? parsed.term ?? candidate.title;
    const key = parsed.key ? slugify(parsed.key) : slugify(title);
    return {
      ...candidate,
      ...parsed,
      key,
      title,
      aliases: parsed.aliases ?? candidate.aliases,
      evidence: parsed.evidence ?? candidate.evidence,
      symbols: parsed.symbols ?? candidate.symbols,
      kind: parsed.kind ?? candidate.kind,
      layer: parsed.layer ?? candidate.layer,
      means: parsed.means ?? candidate.means,
    };
  }

  return {
    ...candidate,
    means: input,
  };
}

function appendLanguageRows(language: string, concepts: CandidateConcept[]): string {
  if (concepts.length === 0) {
    return language;
  }

  let content = language.trimEnd();
  if (!content.includes("## Project Terms")) {
    content += [
      "",
      "## Project Terms",
      "",
      "| ID | Term | Aliases | Evidence |",
      "|----|------|---------|----------|",
    ].join("\n");
  }

  const existing = new Set(languageTerms(content));
  const rows = concepts
    .filter((concept) => !existing.has(normalizeSearchText(`project:${concept.key}`)) && !existing.has(normalizeSearchText(concept.title)))
    .map(
      (concept) =>
        `| project:${concept.key} | ${concept.title} | ${concept.aliases.join(", ") || "-"} | ${concept.evidence.join(", ")} |`,
    );

  if (rows.length === 0) {
    return `${content}\n`;
  }

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## project terms");
  if (start < 0) {
    return `${content}\n${rows.join("\n")}\n`;
  }

  let insertAt = lines.length;
  const tableSeparator = lines.findIndex((line, index) => index > start && /^\s*\|?\s*-{3,}/.test(line));
  if (tableSeparator >= 0) {
    insertAt = tableSeparator + 1;
    while (insertAt < lines.length && lines[insertAt].trim().startsWith("|")) {
      insertAt += 1;
    }
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      insertAt = Math.min(insertAt, index);
      break;
    }
  }
  lines.splice(insertAt, 0, ...rows);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function updateConceptIndex(indexText: string, concepts: CandidateConcept[]): string {
  let content = indexText.trimEnd();
  if (!content) {
    content = [
      "# Project Concept Maps",
      "",
      "## Concepts",
      "",
      "| Key | Concept | Kind | Layer | Status | Ref | Aliases |",
      "|-----|---------|------|-------|--------|-----|---------|",
    ].join("\n");
  }

  const rows = concepts
    .filter((concept) => !content.includes(`| ${concept.key} |`))
    .map(
      (concept) =>
        `| ${concept.key} | ${concept.title} | ${concept.kind} | ${concept.layer} | approved | ${CONCEPTS_DIR}/${concept.key}.md | ${concept.aliases.join(", ") || "-"} |`,
    );

  if (rows.length === 0) {
    return `${content}\n`;
  }

  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## concepts");
  if (start < 0) {
    return `${content}\n\n## Concepts\n\n| Key | Concept | Kind | Layer | Status | Ref | Aliases |\n|-----|---------|------|-------|--------|-----|---------|\n${rows.join("\n")}\n`;
  }
  let insertAt = lines.length;
  const tableSeparator = lines.findIndex((line, index) => index > start && /^\s*\|?\s*-{3,}/.test(line));
  if (tableSeparator >= 0) {
    insertAt = tableSeparator + 1;
    while (insertAt < lines.length && lines[insertAt].trim().startsWith("|")) {
      insertAt += 1;
    }
  }
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      insertAt = Math.min(insertAt, index);
      break;
    }
  }
  lines.splice(insertAt, 0, ...rows);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

export function applyProjectCheckDecisions(input: {
  checkId: string;
  answers: DecisionAnswer[];
  rootDir?: string;
}): CheckApplyResult {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const checkId = normalizeCheckId(input.checkId);
  const proposal = loadProposal(checkId, rootDir);
  const candidates = new Map(proposal.concepts.map((concept) => [`concept:${concept.key}`, concept]));
  const approved: CandidateConcept[] = [];
  const skipped: string[] = [];

  for (const answer of input.answers) {
    const candidate = candidates.get(answer.decisionId);
    if (!candidate) {
      skipped.push(`${answer.decisionId}: unknown decision id`);
      continue;
    }
    const concept = conceptFromDecision(candidate, answer);
    if (!concept) {
      skipped.push(`${answer.decisionId}: ${answer.selectedOptionId}`);
      continue;
    }
    approved.push(concept);
  }

  const appliedRefs: string[] = [];
  if (approved.length > 0) {
    const language = loadLanguageText(rootDir);
    writeKrowFile(PROJECT_LANGUAGE_FILE, appendLanguageRows(language, approved), rootDir);
    appliedRefs.push(PROJECT_LANGUAGE_FILE);

    const indexPath = absolutePath(CONCEPT_INDEX_FILE, rootDir);
    const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
    writeKrowFile(CONCEPT_INDEX_FILE, updateConceptIndex(indexText, approved), rootDir);
    appliedRefs.push(CONCEPT_INDEX_FILE);

    for (const concept of approved) {
      const ref = `${CONCEPTS_DIR}/${concept.key}.md`;
      if (existsSync(absolutePath(ref, rootDir))) {
        skipped.push(`${ref}: already exists`);
        continue;
      }
      writeKrowFile(ref, proposalMarkdown(concept, "approved"), rootDir);
      appliedRefs.push(ref);
    }
  }

  const checkDir = checkRunDirPath(checkId);
  const decisionsRef = `${checkDir}/decisions.json`;
  const reportRef = `${checkDir}/apply-report.md`;
  writeKrowFile(decisionsRef, `${JSON.stringify(input.answers, null, 2)}\n`, rootDir);
  writeKrowFile(
    reportRef,
    [
      "# Krow Check Apply Report",
      "",
      `Check ID: ${checkId}`,
      `Applied At: ${nowIso()}`,
      "",
      "## Applied Refs",
      "",
      ...markdownList(appliedRefs),
      "",
      "## Skipped",
      "",
      ...markdownList(skipped),
      "",
    ].join("\n"),
    rootDir,
  );

  return {
    checkId,
    appliedRefs,
    skipped,
    reportRef,
  };
}
