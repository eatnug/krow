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
type EvidenceTier = "strong" | "artifact" | "weak";
type FileRole = "runtime" | "artifact" | "support" | "document" | "other";

export interface CodeInventoryFile {
  path: string;
  kind: CodeFileKind;
  role: FileRole;
  entrypoint: boolean;
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
  evidenceTier: EvidenceTier;
  evidenceKinds: string[];
  means: string;
}

interface CheckProposal {
  checkId: string;
  generatedAt: string;
  about?: string;
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
    approvalQuestionCount: number;
    strongCandidateCount: number;
    artifactCandidateCount: number;
    weakCandidateCount: number;
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
const maxProposedConcepts = 16;
const maxApprovalQuestions = 8;

const supportPathPrefixes = [".codex/", ".claude/", ".gemini/"];
const artifactPathFragments = [
  "template",
  "templates",
  "example",
  "examples",
  "fixture",
  "fixtures",
  "sample",
  "samples",
  "generated",
];
const primaryDocumentNames = new Set([
  "readme.md",
  "readme.mdx",
  "agents.md",
  "claude.md",
  "codex.md",
  "gemini.md",
]);
const productDocPrefixes = ["docs/"];
const genericHeadingStopWords = new Set([
  "architecture",
  "artifact",
  "commands",
  "candidate tiers",
  "command authority",
  "configuration",
  "conceptual layers",
  "core concepts",
  "development",
  "decision loop",
  "examples",
  "findings",
  "getting started",
  "generated evidence",
  "how it works",
  "installation",
  "local development",
  "next step",
  "overview",
  "publishing",
  "questions",
  "quick start",
  "reference",
  "repository layout",
  "rules",
  "roadmap",
  "setup",
  "startup",
  "strong",
  "summary",
  "testing",
  "usage",
  "weak",
  "write boundary",
]);
const importExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
const knownAcronyms = new Set(["ai", "api", "cli", "css", "ddd", "html", "http", "json", "prd", "sql", "ui", "url", "ux"]);

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
  "layer",
  "lib",
  "main",
  "model",
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
  return words.map((word) => {
    const lower = word.toLowerCase();
    if (knownAcronyms.has(lower)) {
      return lower.toUpperCase();
    }
    return word.slice(0, 1).toUpperCase() + word.slice(1);
  }).join(" ");
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
    throw new Error(`check scope does not exist inside repository: ${scope}`);
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

function packageJson(rootDir: string): Record<string, unknown> | undefined {
  const packagePath = path.join(rootDir, "package.json");
  if (!existsSync(packagePath)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function collectExportTargets(value: unknown, targets: string[] = []): string[] {
  if (typeof value === "string") {
    targets.push(value);
    return targets;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExportTargets(item, targets);
    }
    return targets;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectExportTargets(item, targets);
    }
  }
  return targets;
}

function resolveRepoFile(rootDir: string, candidate: string): string | undefined {
  const stripped = candidate.replace(/^\.\//, "");
  const attempts = [
    stripped,
    ...importExtensions.map((extension) => `${stripped}${extension}`),
    ...importExtensions.map((extension) => path.posix.join(stripped, `index${extension}`)),
  ];

  for (const attempt of attempts) {
    const normalized = attempt.replace(/\\/g, "/");
    const absolute = path.resolve(rootDir, normalized);
    const relative = path.relative(rootDir, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(absolute)) {
      continue;
    }
    if (statSync(absolute).isFile() && shouldReadFile(normalized)) {
      return normalized;
    }
  }
  return undefined;
}

function sourceFallbackForEntrypoint(rootDir: string, relativePath: string): string | undefined {
  if (!relativePath.startsWith("dist/")) {
    return undefined;
  }
  const withoutDist = relativePath.replace(/^dist\//, "");
  const withoutExtension = withoutDist.replace(/\.[A-Za-z0-9]+$/, "");
  return resolveRepoFile(rootDir, path.posix.join("src", withoutExtension));
}

function packageEntrypoints(rootDir: string): Set<string> {
  const pkg = packageJson(rootDir);
  const entrypoints = new Set<string>();
  if (!pkg) {
    return entrypoints;
  }

  const candidates: string[] = [];
  if (typeof pkg.main === "string") {
    candidates.push(pkg.main);
  }
  if (typeof pkg.module === "string") {
    candidates.push(pkg.module);
  }
  if (typeof pkg.bin === "string") {
    candidates.push(pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    for (const value of Object.values(pkg.bin as Record<string, unknown>)) {
      if (typeof value === "string") {
        candidates.push(value);
      }
    }
  }
  collectExportTargets(pkg.exports, candidates);

  for (const candidate of candidates) {
    const resolved = resolveRepoFile(rootDir, candidate);
    if (resolved) {
      entrypoints.add(resolved);
      continue;
    }
    const fallback = sourceFallbackForEntrypoint(rootDir, candidate.replace(/^\.\//, ""));
    if (fallback) {
      entrypoints.add(fallback);
    }
  }

  return entrypoints;
}

function extractRelativeImports(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /\bimport\s+(?:[^"']+\s+from\s*)?["'](\.{1,2}\/[^"']+)["']/g,
    /\bexport\s+[^"']+\s+from\s*["'](\.{1,2}\/[^"']+)["']/g,
    /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
    /\brequire\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
  }
  return unique(imports);
}

function resolveImport(rootDir: string, fromFile: string, importPath: string): string | undefined {
  const baseDir = path.posix.dirname(fromFile);
  const candidate = path.posix.normalize(path.posix.join(baseDir, importPath));
  return resolveRepoFile(rootDir, candidate);
}

function runtimeReachableFiles(rootDir: string, files: string[], entrypoints: Set<string>): Set<string> {
  const fileSet = new Set(files);
  const reachable = new Set<string>();
  const queue = [...entrypoints].filter((entrypoint) => fileSet.has(entrypoint));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) {
      continue;
    }
    reachable.add(current);

    const absolute = path.join(rootDir, current);
    if (!existsSync(absolute) || statSync(absolute).size > maxReadableBytes) {
      continue;
    }
    const content = readFileSync(absolute, "utf8");
    for (const importPath of extractRelativeImports(content)) {
      const resolved = resolveImport(rootDir, current, importPath);
      if (resolved && fileSet.has(resolved) && !reachable.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return reachable;
}

function pathHasFragment(relativePath: string, fragments: string[]): boolean {
  const parts = relativePath.toLowerCase().split("/");
  return parts.some((part) => fragments.some((fragment) => part === fragment || part.includes(`.${fragment}.`)));
}

function classifyFileRole(
  relativePath: string,
  kind: CodeFileKind,
  entrypoints: Set<string>,
  runtimeReachable: Set<string>,
): FileRole {
  const lowerPath = relativePath.toLowerCase();
  if (supportPathPrefixes.some((prefix) => lowerPath.startsWith(prefix))) {
    return "support";
  }
  if (pathHasFragment(relativePath, artifactPathFragments)) {
    return "artifact";
  }
  if (kind === "doc") {
    return "document";
  }
  if (entrypoints.has(relativePath) || runtimeReachable.has(relativePath)) {
    return "runtime";
  }
  if (kind === "config") {
    return "support";
  }
  return "other";
}

function buildCodeInventory(rootDir: string, scope?: string): CodeInventory {
  const root = path.resolve(rootDir);
  const scopedFiles = scopeFiles(root, scope);
  const entrypoints = packageEntrypoints(root);
  const runtimeReachable = runtimeReachableFiles(root, scopedFiles, entrypoints);
  const files = scopedFiles.map((relativePath): CodeInventoryFile => {
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
      role: classifyFileRole(relativePath, fileKind(relativePath), entrypoints, runtimeReachable),
      entrypoint: entrypoints.has(relativePath),
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

function humanizePhrase(value: string): string {
  return value
    .replace(/[`*_#>\[\](){}]/g, " ")
    .replace(/[:：-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function conceptTitleFromPhrase(value: string): string | undefined {
  const phrase = humanizePhrase(value);
  if (!phrase) {
    return undefined;
  }
  const normalized = normalizeSearchText(phrase);
  if (!normalized || genericHeadingStopWords.has(normalized)) {
    return undefined;
  }
  const words = normalized
    .split(" ")
    .filter((word) => word.length > 1 && !conceptStopWords.has(word) && !/^\d+$/.test(word));
  if (words.length === 0 || words.length > 5) {
    return undefined;
  }
  if (!words.some((word) => word.length >= 4 || /[가-힣]/.test(word))) {
    return undefined;
  }
  return titleFromWords(words);
}

function docPriority(relativePath: string): number {
  const lower = relativePath.toLowerCase();
  if (primaryDocumentNames.has(lower)) {
    return 0;
  }
  if (productDocPrefixes.some((prefix) => lower.startsWith(prefix))) {
    return 1;
  }
  return 2;
}

function documentEvidenceFiles(inventory: CodeInventory): CodeInventoryFile[] {
  return inventory.files
    .filter((file) => file.kind === "doc" && file.role === "document" && file.size <= maxReadableBytes)
    .sort((left, right) => docPriority(left.path) - docPriority(right.path) || left.path.localeCompare(right.path))
    .slice(0, 24);
}

function addTermsFromText(
  text: string,
  evidence: string,
  addCandidate: (title: string | undefined, evidence: string, options: {
    kind: CandidateConcept["kind"];
    layer: CandidateConcept["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
    symbol?: string;
  }) => void,
): void {
  const seen = new Set<string>();
  const push = (raw: string, score: number, evidenceKind: string): void => {
    const title = conceptTitleFromPhrase(raw);
    if (!title) {
      return;
    }
    const key = slugify(title);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    addCandidate(title, evidence, {
      kind: "concept",
      layer: "product",
      score,
      tier: "strong",
      evidenceKind,
      means: `Project-facing concept evidenced by ${evidence}. Confirm its boundary and wording before approving it as Project Language.`,
    });
  };

  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) {
    if (match[1]) {
      push(match[1], 6, "document-heading");
    }
  }

  for (const match of text.matchAll(/`([A-Za-z][A-Za-z0-9가-힣 _./-]{2,60})`/g)) {
    if (match[1] && !/[./][A-Za-z0-9]+$/.test(match[1])) {
      push(match[1], 4, "document-term");
    }
  }

  for (const chunk of text.split(/[,;]|\band\b/gi)) {
    const trimmed = chunk
      .replace(/^.*\b(?:into|includes?|contains?|covers?|coordinates?|manages?)\s+/i, "")
      .replace(/^\s*(?:and|or|with|for|to)\s+/i, "")
      .trim();
    if (/^[A-Za-z가-힣][A-Za-z0-9가-힣 -]{2,40}$/.test(trimmed)) {
      push(trimmed, 3, "document-list");
    }
  }

  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/g)) {
    if (match[1]) {
      push(match[1], 2, "document-phrase");
    }
  }
}

function addPackageTerms(
  rootDir: string,
  addCandidate: (title: string | undefined, evidence: string, options: {
    kind: CandidateConcept["kind"];
    layer: CandidateConcept["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
    symbol?: string;
  }) => void,
): void {
  const pkg = packageJson(rootDir);
  if (!pkg) {
    return;
  }
  const name = typeof pkg.name === "string" ? pkg.name : undefined;
  const description = typeof pkg.description === "string" ? pkg.description : undefined;
  if (name) {
    addCandidate(conceptTitleFromIdentifier(name), "package.json:name", {
      kind: "concept",
      layer: "product",
      score: 7,
      tier: "strong",
      evidenceKind: "package-name",
      means: "Project-facing package or product name evidenced by package.json. Confirm the exact product boundary before approving it as Project Language.",
    });
  }
  if (description) {
    addTermsFromText(description, "package.json:description", addCandidate);
  }
  if (pkg.bin && typeof pkg.bin === "object") {
    for (const key of Object.keys(pkg.bin as Record<string, unknown>)) {
      addCandidate(conceptTitleFromIdentifier(key), "package.json:bin", {
        kind: "interface",
        layer: "product",
        score: 5,
        tier: "strong",
        evidenceKind: "package-bin",
        means: "User-facing command evidenced by package.json. Confirm whether it belongs in Project Language before approving it.",
      });
    }
  }
}

function candidateKeyVariants(key: string): string[] {
  const variants = [canonicalCandidateKey(key), key];
  if (key.endsWith("ies") && key.length > 4) {
    variants.push(`${key.slice(0, -3)}y`);
  }
  if (key.endsWith("s") && key.length > 3 && !/(ss|us|is)$/.test(key)) {
    variants.push(key.slice(0, -1));
  } else {
    variants.push(`${key}s`);
  }
  return unique(variants);
}

function canonicalCandidateKey(key: string): string {
  if (key.endsWith("ies") && key.length > 4) {
    return `${key.slice(0, -3)}y`;
  }
  if (key.endsWith("s") && key.length > 3 && !/(ss|us|is)$/.test(key)) {
    return key.slice(0, -1);
  }
  return key;
}

function candidateConcepts(
  inventory: CodeInventory,
  existingTerms: string[],
  existingConceptKeys: string[],
  about?: string,
): CandidateConcept[] {
  const byKey = new Map<string, CandidateConcept & { score: number }>();
  const existing = new Set([...existingTerms, ...existingConceptKeys.map(normalizeSearchText)]);

  function addCandidate(title: string | undefined, evidence: string, options: {
    symbol?: string;
    kind: CandidateConcept["kind"];
    layer: CandidateConcept["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
  }): void {
    if (!title) {
      return;
    }
    const rawKey = slugify(title);
    const key = candidateKeyVariants(rawKey).find((variant) => byKey.has(variant)) ?? canonicalCandidateKey(rawKey);
    const candidateTitle = key !== rawKey ? conceptTitleFromIdentifier(key) ?? title : title;
    if (existing.has(normalizeSearchText(title)) || candidateKeyVariants(rawKey).some((variant) => existing.has(normalizeSearchText(variant)))) {
      return;
    }
    const current = byKey.get(key);
    if (current) {
      current.score += options.score;
      if (candidateTitle.length < current.title.length) {
        current.title = candidateTitle;
      }
      current.evidence = unique([...current.evidence, evidence]).slice(0, 6);
      current.symbols = unique([...current.symbols, ...(options.symbol ? [options.symbol] : [])]).slice(0, 8);
      current.evidenceKinds = unique([...current.evidenceKinds, options.evidenceKind]).slice(0, 6);
      if (tierRank(options.tier) < tierRank(current.evidenceTier)) {
        current.evidenceTier = options.tier;
        current.means = options.means;
      }
      return;
    }

    byKey.set(key, {
      key,
      title: candidateTitle,
      aliases: [],
      evidence: [evidence],
      symbols: options.symbol ? [options.symbol] : [],
      kind: options.kind,
      layer: options.layer,
      evidenceTier: options.tier,
      evidenceKinds: [options.evidenceKind],
      means: options.means,
      score: options.score,
    });
  }

  if (about?.trim()) {
    addTermsFromText(about, "input:about", addCandidate);
  }

  addPackageTerms(inventory.root, addCandidate);

  for (const file of documentEvidenceFiles(inventory)) {
    const content = readFileSync(path.join(inventory.root, file.path), "utf8");
    addTermsFromText(content, file.path, addCandidate);
  }

  for (const file of inventory.files) {
    if (file.kind === "source" && file.role !== "support") {
      const tier = file.role === "runtime" ? "strong" : file.role === "artifact" ? "artifact" : "weak";
      const layer = tier === "strong" ? "product" : "system";
      const evidenceKind = file.role === "runtime" ? "runtime-file" : file.role === "artifact" ? "artifact-file" : "code-file";
      const means =
        tier === "strong"
          ? `Runtime-reachable code concept associated with ${file.path}. Confirm the product meaning before approving it as Project Language.`
          : tier === "artifact"
            ? `Artifact-scoped code concept associated with ${file.path}. Treat it as supporting evidence unless the user says this artifact reflects product language.`
            : `Weak code-only candidate associated with ${file.path}. Use it for retrieval context before promoting it to Project Language.`;
      addCandidate(conceptTitleFromIdentifier(path.basename(file.path)), file.path, {
        kind: "module",
        layer,
        score: tier === "strong" ? 3 : tier === "artifact" ? 1 : 0.5,
        tier,
        evidenceKind,
        means,
      });
    }
    for (const symbol of file.symbols) {
      if (!isStableConceptSymbol(symbol) || file.role === "support") {
        continue;
      }
      const tier = file.role === "runtime" ? "strong" : file.role === "artifact" ? "artifact" : "weak";
      const layer = tier === "strong" ? "product" : "system";
      const evidenceKind = file.role === "runtime" ? "runtime-symbol" : file.role === "artifact" ? "artifact-symbol" : "code-symbol";
      const means =
        tier === "strong"
          ? `Runtime-reachable exported symbol associated with ${file.path}. Confirm the product meaning before approving it as Project Language.`
          : tier === "artifact"
            ? `Artifact-scoped exported symbol associated with ${file.path}. Keep it as evidence unless the user confirms it is product language.`
            : `Weak exported-symbol candidate associated with ${file.path}. Use it for retrieval context before promoting it to Project Language.`;
      addCandidate(conceptTitleFromIdentifier(symbol), file.path, {
        symbol,
        kind: "interface",
        layer,
        score: tier === "strong" ? 5 : tier === "artifact" ? 2 : 1,
        tier,
        evidenceKind,
        means,
      });
    }
  }

  return [...byKey.values()]
    .sort(
      (left, right) =>
        tierRank(left.evidenceTier) - tierRank(right.evidenceTier) ||
        right.score - left.score ||
        left.title.localeCompare(right.title),
    )
    .slice(0, maxProposedConcepts)
    .map(({ score: _score, ...candidate }) => candidate);
}

function tierRank(tier: EvidenceTier): number {
  if (tier === "strong") {
    return 0;
  }
  if (tier === "artifact") {
    return 1;
  }
  return 2;
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
  const anchors = candidate.evidence.map((item) => `- Evidence: \`${item}\``);
  return [
    `# ${candidate.title}`,
    "",
    `Key: ${candidate.key}`,
    `Kind: ${candidate.kind}`,
    `Layer: ${candidate.layer}`,
    `Status: ${status}`,
    `Evidence Tier: ${candidate.evidenceTier}`,
    `Evidence Kinds: ${candidate.evidenceKinds.join(", ") || "-"}`,
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
    ...(proposal.about ? [`About: ${proposal.about}`, ""] : []),
    "",
    "These rows are not approved Project Language. `$check` applies only explicit user decisions.",
    "",
    "| ID | Term | Tier | Aliases | Evidence |",
    "|----|------|------|---------|----------|",
    ...proposal.concepts.map(
      (concept) =>
        `| project:${concept.key} | ${concept.title} | ${concept.evidenceTier} | ${concept.aliases.join(", ") || "-"} | ${concept.evidence.join(", ")} |`,
    ),
    "",
  ].join("\n");
}

function conceptDecisionPrompts(proposal: CheckProposal): DecisionPrompt[] {
  return proposal.concepts.filter((concept) => concept.evidenceTier === "strong").slice(0, maxApprovalQuestions).map((concept) => ({
    id: `concept:${concept.key}`,
    kind: "approval" as const,
    target: {
      kind: "language" as const,
      ref: `${checkRunDirPath(proposal.checkId)}/proposed-concepts/${concept.key}.md`,
      status: "proposed",
    },
    question: `Approve "${concept.title}" (${concept.key}) as a Project Language concept?`,
    context: [
      `Evidence tier: ${concept.evidenceTier}`,
      `Evidence kinds: ${concept.evidenceKinds.join(", ") || "-"}`,
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
  proposal: CheckProposal;
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
    `- Approval questions: ${result.summary.approvalQuestionCount}`,
    `- Strong candidates: ${result.summary.strongCandidateCount}`,
    `- Artifact candidates: ${result.summary.artifactCandidateCount}`,
    `- Weak candidates: ${result.summary.weakCandidateCount}`,
    `- Findings: ${result.summary.findingCount}`,
    ...(refs.proposal.about ? [`- About: ${refs.proposal.about}`] : []),
    "",
    "## Candidate Tiers",
    "",
    "### Strong",
    "",
    ...candidateTierList(refs.proposal, "strong"),
    "",
    "### Artifact",
    "",
    ...candidateTierList(refs.proposal, "artifact"),
    "",
    "### Weak",
    "",
    ...candidateTierList(refs.proposal, "weak"),
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

function candidateTierList(proposal: CheckProposal, tier: EvidenceTier): string[] {
  const concepts = proposal.concepts.filter((concept) => concept.evidenceTier === tier);
  return concepts.length > 0
    ? concepts.map((concept) => `- ${concept.title} (${concept.key}): ${concept.evidence.join(", ")}`)
    : ["- none"];
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

export function runProjectCheck(input: { about?: string; scope?: string; rootDir?: string }): ProjectCheckResult {
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
    input.about,
  );
  const proposal: CheckProposal = {
    checkId,
    generatedAt: nowIso(),
    about: input.about,
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
      message: `Candidate Project Language concept found from ${concept.evidenceTier} evidence: ${concept.title} (${concept.key})`,
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
      approvalQuestionCount: decisions.length,
      strongCandidateCount: concepts.filter((concept) => concept.evidenceTier === "strong").length,
      artifactCandidateCount: concepts.filter((concept) => concept.evidenceTier === "artifact").length,
      weakCandidateCount: concepts.filter((concept) => concept.evidenceTier === "weak").length,
      findingCount: findings.length,
      writesOutsideKrow: false as const,
    },
  };

  writeKrowFile(reportRef, reportMarkdown(resultWithoutRefs, { generatedRefs, proposalRefs, questionRefs, proposal }), rootDir);

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
