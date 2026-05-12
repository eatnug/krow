import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  SYSTEM_MAP_FILE,
  SYSTEM_DOCS_DIR,
  GLOSSARY_FILE,
  absolutePath,
  checkRunDirPath,
} from "./workflow-files.js";
import { scanKrowDocuments } from "./document-contracts.js";
import type { DecisionAnswer, DecisionPrompt } from "./types.js";

type CodeFileKind = "source" | "test" | "doc" | "config";
type EvidenceTier = "strong" | "artifact" | "weak";
type FileRole = "runtime" | "artifact" | "support" | "document" | "other";

interface RepositoryFlow {
  id: string;
  title: string;
  entrypoint: string;
  files: string[];
  summary: string;
}

interface RepositoryUnderstanding {
  productName?: string;
  productPurpose?: string;
  repositoryKind: string[];
  sourceRoots: string[];
  testRoots: string[];
  entrypoints: string[];
  runtimeFiles: string[];
  supportFiles: string[];
  flows: RepositoryFlow[];
  readingOrder: string[];
  notes: string[];
}

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
  understanding: RepositoryUnderstanding;
  files: CodeInventoryFile[];
}

export interface CheckFinding {
  kind: "missing-system-document" | "broken-reference" | "uncovered-example" | "empty-glossary" | "empty-system-docs";
  severity: "info" | "warning";
  message: string;
  refs: string[];
}

interface ObservedSystemSubject {
  key: string;
  title: string;
  aliases: string[];
  evidence: string[];
  symbols: string[];
  kind: "subject" | "interface" | "module";
  layer: "product" | "system";
  evidenceTier: EvidenceTier;
  evidenceKinds: string[];
  means: string;
}

interface SystemStatementDraft {
  id: string;
  title: string;
  status: "proposed" | "approved";
  statement: string;
  terms: string[];
  references: string[];
  notes: string[];
}

interface SystemDocumentDraft {
  id: string;
  title: string;
  kind: "Capability" | "Shared Rule" | "Shared Structure" | "Responsibility Area";
  status: "proposed" | "approved";
  summary: string;
  terms: string[];
  references: string[];
  statements: SystemStatementDraft[];
  sourceSubjectKey: string;
}

interface CheckProposal {
  checkId: string;
  generatedAt: string;
  about?: string;
  understanding: RepositoryUnderstanding;
  subjects: ObservedSystemSubject[];
  systemDocuments: SystemDocumentDraft[];
}

export interface ProjectCheckResult {
  checkId: string;
  status: "clean" | "needs-review";
  reportRef: string;
  observedRef: string;
  draftRef: string;
  decisionsRef: string;
  findings: CheckFinding[];
  decisions: DecisionPrompt[];
  summary: {
    scannedFileCount: number;
    draftSystemDocumentCount: number;
    approvalQuestionCount: number;
    strongSubjectCount: number;
    artifactSubjectCount: number;
    weakSubjectCount: number;
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
const maxDraftSubjects = 16;
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
  "command authority",
  "configuration",
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

const subjectStopWords = new Set([
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

const seedTermStopWords = new Set([
  "about",
  "agent",
  "agents",
  "atomic",
  "based",
  "build",
  "captures",
  "chat",
  "code",
  "codebase",
  "command",
  "commands",
  "context",
  "current",
  "data",
  "file",
  "files",
  "first",
  "from",
  "into",
  "local",
  "make",
  "makes",
  "memory",
  "partner",
  "project",
  "repo",
  "repository",
  "runtime",
  "store",
  "stores",
  "stored",
  "system",
  "that",
  "this",
  "thought",
  "turn",
  "user",
  "using",
  "with",
  "work",
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
  return slug || "subject";
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

function subjectTitleFromIdentifier(value: string): string | undefined {
  const words = splitIdentifier(value).filter((word) => {
    const normalized = word.toLowerCase();
    return word.length > 1 && !subjectStopWords.has(normalized) && !/^\d+$/.test(word);
  });
  if (words.length === 0 || words.length > 5) {
    return undefined;
  }
  if (!words.some((word) => word.length >= 4 || /[가-힣]/.test(word))) {
    return undefined;
  }
  return titleFromWords(words);
}

function isStableSystemSymbol(symbol: string): boolean {
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

function gitTrackedOrIntentionalFiles(rootDir: string): string[] | undefined {
  const probe = spawnSync("git", ["-C", rootDir, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8",
  });
  if (probe.status !== 0 || probe.stdout.trim() !== "true") {
    return undefined;
  }

  const result = spawnSync("git", ["-C", rootDir, "ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return undefined;
  }

  return unique(
    result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim().replace(/\\/g, "/"))
      .filter(Boolean)
      .filter((relativePath) => shouldReadFile(relativePath))
      .filter((relativePath) => {
        const absolute = path.resolve(rootDir, relativePath);
        const relative = path.relative(rootDir, absolute);
        return !relative.startsWith("..") && !path.isAbsolute(relative) && existsSync(absolute) && statSync(absolute).isFile();
      }),
  ).slice(0, maxFiles);
}

function scopeFiles(rootDir: string, scope?: string): string[] {
  if (!scope) {
    return gitTrackedOrIntentionalFiles(rootDir) ?? walkFiles(rootDir);
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
    const scopedPath = path.relative(rootDir, target).replace(/\\/g, "/");
    const gitFiles = gitTrackedOrIntentionalFiles(rootDir);
    if (gitFiles && scopedPath) {
      const prefix = `${scopedPath.replace(/\/$/, "")}/`;
      const files = gitFiles.filter((file) => file.startsWith(prefix));
      if (files.length > 0) {
        return files;
      }
    }
    if (gitFiles && !scopedPath) {
      return gitFiles;
    }
    return walkFiles(rootDir, target);
  }
  return gitTrackedOrIntentionalFiles(rootDir) ?? walkFiles(rootDir);
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
  const withoutRuntimeExtension = stripped.replace(/\.(?:js|mjs|cjs)$/i, "");
  const attempts = [
    stripped,
    ...importExtensions.map((extension) => `${withoutRuntimeExtension}${extension}`),
    ...importExtensions.map((extension) => path.posix.join(withoutRuntimeExtension, `index${extension}`)),
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
    const stripped = candidate.replace(/^\.\//, "");
    const fallback = sourceFallbackForEntrypoint(rootDir, stripped);
    if (fallback) {
      entrypoints.add(fallback);
      continue;
    }
    const resolved = resolveRepoFile(rootDir, candidate);
    if (resolved) {
      entrypoints.add(resolved);
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

function runtimeReachableFileOrder(rootDir: string, files: string[], entrypoints: Set<string>): string[] {
  const fileSet = new Set(files);
  const reachable = new Set<string>();
  const order: string[] = [];
  const queue = [...entrypoints].filter((entrypoint) => fileSet.has(entrypoint));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    order.push(current);

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

  return order;
}

function runtimeReachableFiles(rootDir: string, files: string[], entrypoints: Set<string>): Set<string> {
  return new Set(runtimeReachableFileOrder(rootDir, files, entrypoints));
}

function packageName(rootDir: string): string | undefined {
  const pkg = packageJson(rootDir);
  return typeof pkg?.name === "string" ? pkg.name : undefined;
}

function packageDescription(rootDir: string): string | undefined {
  const pkg = packageJson(rootDir);
  return typeof pkg?.description === "string" ? pkg.description : undefined;
}

function inferRepositoryKind(rootDir: string, files: CodeInventoryFile[]): string[] {
  const kinds: string[] = [];
  const pkg = packageJson(rootDir);
  if (pkg) {
    kinds.push("Node.js package");
    if (pkg.bin) {
      kinds.push("CLI package");
    }
  }
  if (files.some((file) => [".ts", ".tsx", ".mts", ".cts"].includes(file.extension))) {
    kinds.push("TypeScript project");
  }
  if (files.some((file) => file.kind === "test")) {
    kinds.push("test-backed repository");
  }
  return unique(kinds);
}

function topLevelRoots(files: CodeInventoryFile[], predicate: (file: CodeInventoryFile) => boolean): string[] {
  return unique(
    files
      .filter(predicate)
      .map((file) => file.path.split("/")[0])
      .filter(Boolean),
  ).sort();
}

function namedImportTargets(rootDir: string, fromFile: string, content: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of content.matchAll(/\bimport\s+{([^}]+)}\s+from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    const importPath = match[2];
    const resolved = importPath ? resolveImport(rootDir, fromFile, importPath) : undefined;
    if (!resolved || !match[1]) {
      continue;
    }
    for (const rawPart of match[1].split(",")) {
      const part = rawPart.trim();
      if (!part) {
        continue;
      }
      const alias = part.match(/\bas\s+([A-Za-z_$][\w$]*)$/)?.[1];
      const name = alias ?? part.replace(/\bas\s+[A-Za-z_$][\w$]*$/, "").trim();
      if (name) {
        targets.set(name, resolved);
      }
    }
  }
  return targets;
}

function extractFunctionBody(content: string, functionName: string): string {
  const declaration = new RegExp(`\\bfunction\\s+${functionName}\\s*\\(`).exec(content);
  if (!declaration) {
    return "";
  }
  const openIndex = content.indexOf("{", declaration.index);
  if (openIndex < 0) {
    return "";
  }
  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return content.slice(openIndex + 1, index);
      }
    }
  }
  return "";
}

function commandCaseBlocks(content: string): Array<{ command: string; body: string }> {
  const switchMatch = content.match(/switch\s*\(\s*command\s*\)\s*{([\s\S]*?)\n\s*default\s*:/);
  const switchBody = switchMatch?.[1];
  if (!switchBody) {
    return [];
  }
  const blocks: Array<{ command: string; body: string }> = [];
  const pattern = /\bcase\s+["']([^"']+)["']\s*:\s*([\s\S]*?)(?=\n\s*case\s+["']|$)/g;
  for (const match of switchBody.matchAll(pattern)) {
    if (match[1]) {
      blocks.push({ command: match[1], body: match[2] ?? "" });
    }
  }
  return blocks;
}

function titleFromCommand(command: string): string {
  return titleFromWords(command.split("-").filter(Boolean));
}

function titleFromActionSymbol(symbol: string): string | undefined {
  const title = subjectTitleFromIdentifier(symbol);
  return title?.replace(/^(Apply|Build|Create|Derive|Find|Ground|Handle|Load|Read|Run|Save|Scan|Start|Stop|Submit|Update|Validate|Write)\s+/, "");
}

function commandFlows(rootDir: string, entrypoint: string): RepositoryFlow[] {
  const absolute = path.join(rootDir, entrypoint);
  if (!existsSync(absolute) || statSync(absolute).size > maxReadableBytes) {
    return [];
  }
  const content = readFileSync(absolute, "utf8");
  const imports = namedImportTargets(rootDir, entrypoint, content);
  const flows: RepositoryFlow[] = [];

  for (const block of commandCaseBlocks(content)) {
    const handler = block.body.match(/\b(handle[A-Z][A-Za-z0-9_]*)\s*\(/)?.[1];
    const handlerBody = handler ? extractFunctionBody(content, handler) : block.body;
    const files = new Set<string>([entrypoint]);
    const titleHits: Array<{ index: number; title: string }> = [];

    for (const [symbol, ref] of imports.entries()) {
      const symbolIndex = handlerBody.indexOf(symbol);
      const blockIndex = block.body.indexOf(symbol);
      const index = symbolIndex >= 0 ? symbolIndex : blockIndex;
      if (index < 0) {
        continue;
      }
      files.add(ref);
      const title = titleFromActionSymbol(symbol);
      if (title) {
        titleHits.push({ index, title });
      }
    }

    if (/delegateInstaller\s*\(/.test(block.body) || /delegateInstaller\s*\(/.test(handlerBody)) {
      const installRef = resolveRepoFile(rootDir, "install/krow.mjs");
      if (installRef) {
        files.add(installRef);
        titleHits.push({ index: 0, title: `${titleFromCommand(block.command)} Command` });
      }
    }

    if (files.size <= 1) {
      continue;
    }

    const title = titleHits.sort((left, right) => left.index - right.index)[0]?.title ?? `${titleFromCommand(block.command)} Command`;
    flows.push({
      id: slugify(`${block.command}-${title}`),
      title,
      entrypoint,
      files: [...files],
      summary: `The ${block.command} command starts at ${entrypoint} and reaches ${[...files].slice(1).join(", ")}.`,
    });
  }

  return flows;
}

function buildRepositoryUnderstanding(
  rootDir: string,
  files: CodeInventoryFile[],
  entrypoints: Set<string>,
  runtimeFileOrder: string[],
  about?: string,
): RepositoryUnderstanding {
  const runtimeFiles = files.filter((file) => file.role === "runtime").map((file) => file.path);
  const supportFiles = files.filter((file) => file.role === "support").map((file) => file.path);
  const flows = entrypoints.size > 0
    ? [...entrypoints].flatMap((entrypoint) => commandFlows(rootDir, entrypoint))
    : [];
  const uniqueFlows = dedupeRepositoryFlows(flows);
  const readingOrder = unique([
    ...[...entrypoints],
    ...uniqueFlows.flatMap((flow) => flow.files),
    ...runtimeFileOrder,
  ]).filter((ref) => files.some((file) => file.path === ref));

  const notes: string[] = [];
  if (entrypoints.size === 0) {
    notes.push("No package or export entrypoint was detected; runtime flow candidates are limited.");
  }
  if (uniqueFlows.length === 0) {
    notes.push("No command or route flow was detected from the entrypoint; candidates fall back to runtime-reachable code.");
  }

  return {
    productName: packageName(rootDir),
    productPurpose: about ?? packageDescription(rootDir),
    repositoryKind: inferRepositoryKind(rootDir, files),
    sourceRoots: topLevelRoots(files, (file) => file.kind === "source"),
    testRoots: topLevelRoots(files, (file) => file.kind === "test"),
    entrypoints: [...entrypoints],
    runtimeFiles,
    supportFiles,
    flows: uniqueFlows,
    readingOrder,
    notes,
  };
}

function dedupeRepositoryFlows(flows: RepositoryFlow[]): RepositoryFlow[] {
  const seen = new Set<string>();
  const deduped: RepositoryFlow[] = [];
  for (const flow of flows) {
    const key = `${flow.title}:${flow.files.join(">")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(flow);
  }
  return deduped;
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

function buildCodeInventory(rootDir: string, scope?: string, about?: string): CodeInventory {
  const root = path.resolve(rootDir);
  const scopedFiles = scopeFiles(root, scope);
  const entrypoints = packageEntrypoints(root);
  const runtimeFileOrder = runtimeReachableFileOrder(root, scopedFiles, entrypoints);
  const runtimeReachable = new Set(runtimeFileOrder);
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
    understanding: buildRepositoryUnderstanding(root, files, entrypoints, runtimeFileOrder, about),
    files,
  };
}

function loadSystemDocuments(rootDir: string): Array<{ key: string; title: string; ref: string; references: string[] }> {
  const dir = absolutePath(SYSTEM_DOCS_DIR, rootDir);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
    .map((entry) => {
      const ref = `${SYSTEM_DOCS_DIR}/${entry.name}`;
      const content = readFileSync(absolutePath(ref, rootDir), "utf8");
      const key = content.match(/^Key:\s*(.+)$/m)?.[1]?.trim()
        || content.match(/^ID:\s*DOC:([^\s]+)\s*$/m)?.[1]?.trim()
        || entry.name.replace(/\.md$/i, "");
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || key;
      const references = labelList(content, "References")
        .map((item) => cleanReferenceTarget(item))
        .filter((value): value is string => Boolean(value) && !value.startsWith("<"));
      return { key, title, ref, references };
    });
}

function loadGlossaryText(rootDir: string): string {
  const ref = absolutePath(GLOSSARY_FILE, rootDir);
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

function glossaryTerms(content: string): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/gm)) {
    const first = match[1]?.trim();
    const second = match[2]?.trim();
    if (!first || !second || first === "ID" || /^-+$/.test(first)) {
      continue;
    }
    values.push(first, second);
  }
  for (const match of content.matchAll(/^##\s+(.+)$/gm)) {
    if (match[1] && !match[1].startsWith("<")) {
      values.push(match[1]);
    }
  }
  for (const match of content.matchAll(/^ID:\s*(TERM:[^\s]+)\s*$/gm)) {
    if (match[1]) {
      values.push(match[1], match[1].replace(/^TERM:/, ""));
    }
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

function subjectTitleFromPhrase(value: string): string | undefined {
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
    .filter((word) => word.length > 1 && !subjectStopWords.has(word) && !/^\d+$/.test(word));
  if (words.length === 0 || words.length > 5) {
    return undefined;
  }
  if (!words.some((word) => word.length >= 4 || /[가-힣]/.test(word))) {
    return undefined;
  }
  return titleFromWords(words);
}

function seedTitleFromPhrase(value: string): string | undefined {
  const phrase = humanizePhrase(value);
  if (!phrase) {
    return undefined;
  }
  const words = normalizeSearchText(phrase)
    .split(" ")
    .filter((word) => word.length > 1 && !seedTermStopWords.has(word) && !subjectStopWords.has(word) && !/^\d+$/.test(word));
  if (words.length === 0 || words.length > 4) {
    return undefined;
  }
  return titleFromWords(words);
}

function singularizeWord(value: string): string {
  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("s") && value.length > 3 && !/(ss|us|is)$/.test(value)) {
    return value.slice(0, -1);
  }
  return value;
}

function extractSeedTerms(text?: string): string[] {
  if (!text) {
    return [];
  }

  const terms: string[] = [];
  const push = (raw: string | undefined): void => {
    if (!raw) {
      return;
    }
    const title = seedTitleFromPhrase(raw);
    if (title) {
      terms.push(title);
    }
  };

  for (const match of text.matchAll(/`([^`\n]{2,80})`/g)) {
    push(match[1]);
  }

  const englishWords = normalizeSearchText(text)
    .split(" ")
    .filter((word) => /^[a-z][a-z0-9-]*$/.test(word))
    .filter((word) => word.length >= 4 && !seedTermStopWords.has(word) && !subjectStopWords.has(word));

  for (const word of englishWords) {
    push(singularizeWord(word));
  }

  return unique(terms);
}

function evidencePriority(file: CodeInventoryFile): number {
  if (file.role === "runtime" && file.kind === "source") {
    return 0;
  }
  if (file.entrypoint) {
    return 1;
  }
  if (file.kind === "source") {
    return 2;
  }
  if (file.kind === "config") {
    return 3;
  }
  if (file.kind === "test") {
    return 4;
  }
  if (file.kind === "doc") {
    return 5;
  }
  return 6;
}

function searchFormsForTerm(term: string): string[] {
  const base = normalizeSearchText(term);
  const forms = new Set<string>([base]);
  for (const word of base.split(" ").filter(Boolean)) {
    forms.add(word);
    forms.add(singularizeWord(word));
    if (word.endsWith("y")) {
      forms.add(`${word.slice(0, -1)}ies`);
    } else if (!word.endsWith("s")) {
      forms.add(`${word}s`);
    }
  }
  return [...forms].filter((form) => form.length >= 3 && !seedTermStopWords.has(form));
}

function normalizedTextContainsForm(text: string, form: string): boolean {
  const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i").test(text);
}

function seedEvidenceForTerm(inventory: CodeInventory, term: string): Array<{ ref: string; kind: "source" | "doc" }> {
  const forms = searchFormsForTerm(term);
  if (forms.length === 0) {
    return [];
  }

  return inventory.files
    .filter((file) => file.size <= maxReadableBytes && file.role !== "support" && file.role !== "artifact")
    .map((file) => {
      const pathText = normalizeSearchText(file.path);
      const symbolText = normalizeSearchText(file.symbols.join(" "));
      const absolute = path.join(inventory.root, file.path);
      const contentText = existsSync(absolute) ? normalizeSearchText(readFileSync(absolute, "utf8")) : "";
      const matches = forms.some((form) =>
        normalizedTextContainsForm(pathText, form)
        || normalizedTextContainsForm(symbolText, form)
        || normalizedTextContainsForm(contentText, form),
      );
      if (!matches) {
        return undefined;
      }
      return {
        ref: file.path,
        kind: file.kind === "doc" ? "doc" as const : "source" as const,
        priority: evidencePriority(file),
      };
    })
    .filter((item): item is { ref: string; kind: "source" | "doc"; priority: number } => Boolean(item))
    .sort((left, right) => left.priority - right.priority || left.ref.localeCompare(right.ref))
    .slice(0, 6)
    .map(({ ref, kind }) => ({ ref, kind }));
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
    kind: ObservedSystemSubject["kind"];
    layer: ObservedSystemSubject["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
    symbol?: string;
  }) => void,
): void {
  const seen = new Set<string>();
  const push = (raw: string, score: number, evidenceKind: string): void => {
    const title = subjectTitleFromPhrase(raw);
    if (!title) {
      return;
    }
    const key = slugify(title);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    addCandidate(title, evidence, {
      kind: "subject",
      layer: "product",
      score,
      tier: "strong",
      evidenceKind,
      means: `Project-facing term evidenced by ${evidence}. Confirm its boundary and wording before approving it into the Glossary/System Model.`,
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

  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,3})\b/g)) {
    if (match[1]) {
      push(match[1], 2, "document-phrase");
    }
  }
}

function addPackageTerms(
  rootDir: string,
  addCandidate: (title: string | undefined, evidence: string, options: {
    kind: ObservedSystemSubject["kind"];
    layer: ObservedSystemSubject["layer"];
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
    addCandidate(subjectTitleFromIdentifier(name), "package.json:name", {
      kind: "subject",
      layer: "product",
      score: 7,
      tier: "strong",
      evidenceKind: "package-name",
      means: "Project-facing package or product name evidenced by package.json. Confirm the exact product boundary before approving it into the Glossary/System Model.",
    });
  }
  if (description) {
    addTermsFromText(description, "package.json:description", addCandidate);
  }
  if (pkg.bin && typeof pkg.bin === "object") {
    for (const key of Object.keys(pkg.bin as Record<string, unknown>)) {
      addCandidate(subjectTitleFromIdentifier(key), "package.json:bin", {
        kind: "interface",
        layer: "product",
      score: 5,
      tier: "strong",
      evidenceKind: "package-bin",
      means: "User-facing command evidenced by package.json. Confirm whether it belongs in the Glossary/System Model before approving it.",
      });
    }
  }
}

function inventoryHas(inventory: CodeInventory, ref: string): boolean {
  return inventory.files.some((file) => file.path === ref);
}

function existingInventoryRefs(inventory: CodeInventory, refs: string[]): string[] {
  return refs.filter((ref) => inventoryHas(inventory, ref));
}

function addCandidateWithEvidence(
  title: string,
  evidence: string[],
  addCandidate: (title: string | undefined, evidence: string, options: {
    kind: ObservedSystemSubject["kind"];
    layer: ObservedSystemSubject["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
    symbol?: string;
  }) => void,
  options: {
    kind: ObservedSystemSubject["kind"];
    score: number;
    evidenceKind: string;
    means: string;
  },
): void {
  evidence.forEach((ref, index) => {
    addCandidate(title, ref, {
      kind: options.kind,
      layer: "product",
      score: index === 0 ? options.score : Math.max(1, options.score * 0.2),
      tier: "strong",
      evidenceKind: options.evidenceKind,
      means: options.means,
    });
  });
}

function addRepositoryUnderstandingCandidates(
  understanding: RepositoryUnderstanding,
  addCandidate: (title: string | undefined, evidence: string, options: {
    kind: ObservedSystemSubject["kind"];
    layer: ObservedSystemSubject["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
    symbol?: string;
  }) => void,
): void {
  if (understanding.entrypoints.length > 0 && understanding.repositoryKind.includes("CLI package")) {
    for (const ref of ["package.json", ...understanding.entrypoints]) {
      addCandidate("CLI Surface", ref, {
        kind: "interface",
        layer: "product",
        score: ref === "package.json" ? 7 : 3,
        tier: "strong",
        evidenceKind: "entrypoint-flow",
        means: "The CLI Surface is the user-facing command entrypoint and routes commands into repository runtime flows.",
      });
    }
  }

  const nonGlossaryFlowTitles = new Set([
    "Decision Answers",
    "Next Signal",
    "Phase",
    "Route",
    "Status",
    "Workflow",
    "Workflow State",
    "Project Check Decisions",
    "Remove Command",
  ]);
  for (const flow of understanding.flows) {
    if (nonGlossaryFlowTitles.has(flow.title)) {
      continue;
    }
    for (const [index, ref] of flow.files.entries()) {
      addCandidate(flow.title, ref, {
        kind: "module",
        layer: "product",
        score: index === 0 ? 7 : 4,
        tier: "strong",
        evidenceKind: "entrypoint-flow",
        means: flow.summary,
      });
    }
  }
}

function addUserSeedCandidates(
  about: string | undefined,
  inventory: CodeInventory,
  addCandidate: (title: string | undefined, evidence: string, options: {
    kind: ObservedSystemSubject["kind"];
    layer: ObservedSystemSubject["layer"];
    score: number;
    tier: EvidenceTier;
    evidenceKind: string;
    means: string;
    symbol?: string;
  }) => void,
): void {
  for (const term of extractSeedTerms(about)) {
    const evidence = seedEvidenceForTerm(inventory, term);
    const hasSourceEvidence = evidence.some((item) => item.kind === "source");
    if (!hasSourceEvidence) {
      continue;
    }
    evidence.forEach((item, index) => {
      addCandidate(term, item.ref, {
        kind: "subject",
        layer: "product",
        score: index === 0 ? 9 : 2,
        tier: "strong",
        evidenceKind: item.kind === "source" ? "user-seed-source-match" : "user-seed-doc-match",
        means: `User-seeded project concept matched against repository evidence. Confirm the exact boundary before approving ${term} into the Glossary/System Model.`,
      });
    });
  }
}

function groundedCandidate(candidate: ObservedSystemSubject): ObservedSystemSubject {
  if (candidate.evidenceTier !== "strong") {
    return candidate;
  }
  const strongEvidenceKinds = new Set([
    "entrypoint-flow",
    "runtime-file",
    "runtime-symbol",
    "package-name",
    "package-bin",
    "user-seed-source-match",
  ]);
  if (candidate.evidenceKinds.some((kind) => strongEvidenceKinds.has(kind))) {
    return candidate;
  }
  return {
    ...candidate,
    evidenceTier: "weak",
    means: `${candidate.means} This candidate needs entrypoint, package, or runtime evidence before approval.`,
  };
}

function removeDocumentOnlyEvidence(candidate: ObservedSystemSubject): ObservedSystemSubject {
  const nonDocumentEvidence = candidate.evidence.filter((ref) => !/\.(md|mdx|txt|rst)$/i.test(ref));
  return {
    ...candidate,
    evidence: nonDocumentEvidence.length > 0 ? nonDocumentEvidence : candidate.evidence,
    evidenceKinds: candidate.evidenceKinds.filter((kind) => !kind.startsWith("document")),
  };
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
  if (key.includes("-")) {
    return key;
  }
  if (key.endsWith("ies") && key.length > 4) {
    return `${key.slice(0, -3)}y`;
  }
  if (key.endsWith("s") && key.length > 3 && !/(ss|us|is)$/.test(key)) {
    return key.slice(0, -1);
  }
  return key;
}

function observedSystemSubjects(
  inventory: CodeInventory,
  existingTerms: string[],
  existingSystemDocumentKeys: string[],
  about?: string,
): ObservedSystemSubject[] {
  const byKey = new Map<string, ObservedSystemSubject & { score: number }>();
  const existing = new Set([...existingTerms, ...existingSystemDocumentKeys.map(normalizeSearchText)]);

  function addCandidate(title: string | undefined, evidence: string, options: {
    symbol?: string;
    kind: ObservedSystemSubject["kind"];
    layer: ObservedSystemSubject["layer"];
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
    const candidateTitle = key !== rawKey ? subjectTitleFromIdentifier(key) ?? title : title;
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

  addUserSeedCandidates(about, inventory, addCandidate);
  addPackageTerms(inventory.root, addCandidate);
  addRepositoryUnderstandingCandidates(inventory.understanding, addCandidate);

  for (const file of inventory.files) {
    if (file.kind === "source" && file.role !== "support") {
      const tier = file.role === "artifact" ? "artifact" : "weak";
      const layer = "system";
      const evidenceKind = file.role === "runtime" ? "runtime-file" : file.role === "artifact" ? "artifact-file" : "code-file";
      const means =
        tier === "artifact"
            ? `Artifact-scoped code surface associated with ${file.path}. Treat it as supporting evidence unless the user says this artifact reflects project meaning.`
            : `Weak code-only candidate associated with ${file.path}. Use it for retrieval context before promoting it into the Glossary/System Model.`;
      addCandidate(subjectTitleFromIdentifier(path.basename(file.path)), file.path, {
        kind: "module",
        layer,
        score: tier === "artifact" ? 1 : 0.5,
        tier,
        evidenceKind,
        means,
      });
    }
    for (const symbol of file.symbols) {
      if (!isStableSystemSymbol(symbol) || file.role === "support") {
        continue;
      }
      const tier = file.role === "artifact" ? "artifact" : "weak";
      const layer = "system";
      const evidenceKind = file.role === "runtime" ? "runtime-symbol" : file.role === "artifact" ? "artifact-symbol" : "code-symbol";
      const means =
        tier === "artifact"
            ? `Artifact-scoped exported symbol associated with ${file.path}. Keep it as evidence unless the user confirms it reflects project meaning.`
            : `Weak exported-symbol candidate associated with ${file.path}. Use it for retrieval context before promoting it into the Glossary/System Model.`;
      addCandidate(subjectTitleFromIdentifier(symbol), file.path, {
        symbol,
        kind: "interface",
        layer,
        score: tier === "artifact" ? 2 : 0.5,
        tier,
        evidenceKind,
        means,
      });
    }
  }

  return [...byKey.values()]
    .map(({ score, ...candidate }) => ({
      ...removeDocumentOnlyEvidence(groundedCandidate(candidate)),
      score,
    }))
    .sort(
      (left, right) =>
        tierRank(left.evidenceTier) - tierRank(right.evidenceTier) ||
        right.score - left.score ||
        left.title.localeCompare(right.title),
    )
    .slice(0, maxDraftSubjects)
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

function cleanReferenceTarget(value: string): string {
  return value
    .replace(/^[A-Za-z ]+:\s*/, "")
    .replace(/^`|`$/g, "")
    .trim();
}

function pathishReference(value: string): string | undefined {
  const cleaned = cleanReferenceTarget(value);
  const match = cleaned.match(/((?:\.{1,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?)/);
  return match?.[1];
}

function brokenReferences(rootDir: string, systemDocuments: ReturnType<typeof loadSystemDocuments>): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const systemDocument of systemDocuments) {
    for (const reference of systemDocument.references) {
      const target = pathishReference(reference);
      if (!target) {
        continue;
      }
      if (existsSync(path.resolve(rootDir, target))) {
        continue;
      }
      findings.push({
        kind: "broken-reference",
        severity: "warning",
        message: `System Document ${systemDocument.key} points to a missing reference: ${target}`,
        refs: [systemDocument.ref, target],
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

function documentKindForCandidate(candidate: ObservedSystemSubject): SystemDocumentDraft["kind"] {
  if (candidate.key === "cli-surface" || candidate.evidenceKinds.includes("entrypoint-flow")) {
    return "Capability";
  }
  if (candidate.kind === "interface") {
    return "Shared Structure";
  }
  return "Responsibility Area";
}

function termId(candidate: Pick<ObservedSystemSubject, "key">): string {
  return `TERM:${candidate.key}`;
}

function docId(candidate: Pick<ObservedSystemSubject, "key">): string {
  return `DOC:${candidate.key}`;
}

function statementId(candidate: Pick<ObservedSystemSubject, "key">, suffix: string): string {
  return `STMT:${candidate.key}.${suffix}`;
}

function sourceReferences(refs: string[]): string[] {
  return unique(refs).map((ref) => {
    if (ref.startsWith("package.json")) {
      return `Package: ${ref}`;
    }
    return `Source: ${ref}`;
  });
}

function systemDocumentSummary(candidate: ObservedSystemSubject): string {
  if (candidate.key === "cli-surface") {
    return "CLI Surface is the command entrypoint that receives local krow commands and routes them into runtime flows.";
  }
  if (candidate.key === "krow") {
    return "Krow is the CLI product exposed by package metadata and installed runtime surfaces.";
  }
  if (candidate.key === "project-check") {
    return "Project Check reads repository evidence and drafts System Documents, System Statements, References, and approval decisions.";
  }
  if (candidate.key === "work-documents") {
    return "Work Documents record a requested change as structured PRD, Spec, Plan, Task, and Review documents.";
  }
  if (candidate.key === "krow-documents") {
    return "Krow Documents reads approved Glossary, System Documents, and Work Docs so agents can retrieve project understanding.";
  }
  if (candidate.key === "unit-review-report") {
    return "Unit Review Report records review findings for a workflow unit using stored task, execution, and verification evidence.";
  }
  if (candidate.key === "init-command") {
    return "Init Command creates the local krow workspace, runtime bootstrap, templates, and selected agent command surfaces.";
  }
  if (candidate.evidenceKinds.includes("entrypoint-flow")) {
    return `${candidate.title} is a capability reached from CLI Surface and grounded by the referenced source files.`;
  }
  return `${candidate.title} is a system area grounded by the referenced source files.`;
}

function systemStatementDrafts(candidate: ObservedSystemSubject, summary: string): SystemStatementDraft[] {
  const terms = [termId(candidate)];
  const references = sourceReferences(candidate.evidence);
  const statements: SystemStatementDraft[] = [
    {
      id: statementId(candidate, "summary"),
      title: `${candidate.title} Summary`,
      status: "proposed",
      statement: summary,
      terms,
      references,
      notes: ["Generated from repository evidence by krow check."],
    },
  ];

  if (candidate.evidenceKinds.includes("entrypoint-flow") && candidate.key !== "cli-surface") {
    statements.push({
      id: statementId(candidate, "entrypoint"),
      title: `${candidate.title} Entrypoint`,
      status: "proposed",
      statement: `${candidate.title} is reached through CLI Surface.`,
      terms: unique([...terms, "TERM:cli-surface"]),
      references,
      notes: ["Generated from entrypoint flow evidence."],
    });
  }

  return statements;
}

function systemDocumentDraft(candidate: ObservedSystemSubject): SystemDocumentDraft {
  const summary = systemDocumentSummary(candidate);
  return {
    id: docId(candidate),
    title: candidate.title,
    kind: documentKindForCandidate(candidate),
    status: "proposed",
    summary,
    terms: [termId(candidate)],
    references: sourceReferences(candidate.evidence),
    statements: systemStatementDrafts(candidate, summary),
    sourceSubjectKey: candidate.key,
  };
}

function systemDocumentDrafts(subjects: ObservedSystemSubject[]): SystemDocumentDraft[] {
  return subjects
    .filter((subject) => subject.evidenceTier === "strong")
    .map(systemDocumentDraft);
}

function systemDocumentMarkdown(document: SystemDocumentDraft, status: "proposed" | "approved"): string {
  const documentStatus = status === "approved" ? "Approved" : "Proposed";
  return [
    `# ${document.title}`,
    "",
    `ID: ${document.id}`,
    `Kind: ${document.kind}`,
    `Status: ${documentStatus}`,
    "",
    "Summary:",
    document.summary,
    "",
    "Notes:",
    status === "approved"
      ? "Approved through krow check decision."
      : "Review before approving this as durable project understanding.",
    "",
    "## Statements",
    "",
    ...document.statements.flatMap((statement) => [
      `### ${statement.title}`,
      "",
      `ID: ${statement.id}`,
      `Status: ${documentStatus}`,
      "",
      "Statement:",
      statement.statement,
      "",
      "Terms:",
      ...statement.terms.map((term) => `- ${term}`),
      "",
      "References:",
      ...statement.references.map((reference) => `- ${reference}`),
      "",
      "Notes:",
      ...statement.notes.map((note) => `- ${note}`),
      "",
    ]),
    "",
  ].join("\n");
}

function systemDocumentDecisionPrompts(proposal: CheckProposal): DecisionPrompt[] {
  return proposal.systemDocuments.slice(0, maxApprovalQuestions).map((document) => ({
    id: `doc:${document.sourceSubjectKey}`,
    kind: "approval" as const,
    target: {
      kind: "system-document" as const,
      ref: `${checkRunDirPath(proposal.checkId)}/draft.json#${document.id}`,
      status: "proposed",
    },
    question: `Approve ${document.id} as a System Document draft?`,
    context: [
      `Title: ${document.title}`,
      `Kind: ${document.kind}`,
      `Summary: ${document.summary}`,
      `Terms: ${document.terms.join(", ")}`,
      `References: ${document.references.join(", ")}`,
      "Statements:",
      ...document.statements.map((statement) => `- ${statement.id}: ${statement.statement}`),
      "Approve applies the Glossary term, System Document, System Statements, and System Map entry. Revise should provide precise replacement wording or JSON fields.",
    ].join("\n"),
    options: [
      { id: "approve", label: "Approve", description: "Apply this System Document draft to .krow/system." },
      { id: "revise", label: "Revise", description: "Apply with explicit user-provided corrections." },
      { id: "reject", label: "Reject", description: "Do not add this System Document." },
    ],
  }));
}

function reportMarkdown(result: Omit<ProjectCheckResult, "reportRef" | "observedRef" | "draftRef" | "decisionsRef">, refs: {
  observedRef: string;
  draftRef: string;
  decisionsRef: string;
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
    `- Draft System Documents: ${result.summary.draftSystemDocumentCount}`,
    `- Approval questions: ${result.summary.approvalQuestionCount}`,
    `- Findings: ${result.summary.findingCount}`,
    ...(refs.proposal.about ? [`- About: ${refs.proposal.about}`] : []),
    "",
    "## Repository Understanding",
    "",
    ...repositoryUnderstandingMarkdown(refs.proposal.understanding),
    "",
    "## Draft System Documents",
    "",
    ...systemDocumentDraftList(refs.proposal.systemDocuments),
    "",
    "## Files",
    "",
    `- Observed: ${refs.observedRef}`,
    `- Draft: ${refs.draftRef}`,
    `- Decisions: ${refs.decisionsRef}`,
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

function repositoryUnderstandingMarkdown(understanding: RepositoryUnderstanding): string[] {
  return [
    `- Product name: ${understanding.productName ?? "(unknown)"}`,
    `- Product purpose: ${understanding.productPurpose ?? "(unknown)"}`,
    `- Repository kind: ${understanding.repositoryKind.join(", ") || "(unknown)"}`,
    `- Entrypoints: ${understanding.entrypoints.join(", ") || "(none detected)"}`,
    `- Source roots: ${understanding.sourceRoots.join(", ") || "(none detected)"}`,
    `- Test roots: ${understanding.testRoots.join(", ") || "(none detected)"}`,
    "",
    "### Runtime Flows",
    "",
    ...(understanding.flows.length > 0
      ? understanding.flows.map((flow) => `- ${flow.title}: ${flow.files.join(" -> ")}`)
      : ["- none detected"]),
    "",
    "### Reading Order",
    "",
    ...markdownList(understanding.readingOrder),
    "",
    "### Notes",
    "",
    ...markdownList(understanding.notes),
  ];
}

function systemDocumentDraftList(documents: SystemDocumentDraft[]): string[] {
  if (documents.length === 0) {
    return ["- none"];
  }
  return documents.flatMap((document) => [
    `- ${document.id}: ${document.title} (${document.kind})`,
    `  Summary: ${document.summary}`,
    `  Terms: ${document.terms.join(", ")}`,
    `  References: ${document.references.join(", ")}`,
    "  Statements:",
    ...document.statements.map((statement) => `  - ${statement.id}: ${statement.statement}`),
  ]);
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
  const observedRef = `${checkDir}/observed.json`;
  const draftRef = `${checkDir}/draft.json`;
  const decisionsRef = `${checkDir}/decisions.json`;
  const reportRef = `${checkDir}/result.md`;

  ensureKrowDirectory(checkDir, rootDir);

  const inventory = buildCodeInventory(rootDir, input.scope, input.about);
  writeKrowFile(observedRef, `${JSON.stringify(inventory, null, 2)}\n`, rootDir);

  const existingSystemDocuments = loadSystemDocuments(rootDir);
  const glossary = loadGlossaryText(rootDir);
  const observedSubjects = observedSystemSubjects(
    inventory,
    glossaryTerms(glossary),
    existingSystemDocuments.flatMap((systemDocument) => [systemDocument.key, systemDocument.title]),
    input.about,
  );
  const strongSubjects = observedSubjects.filter((subject) => subject.evidenceTier !== "weak");
  const draftSystemDocuments = systemDocumentDrafts(strongSubjects);
  const proposal: CheckProposal = {
    checkId,
    generatedAt: nowIso(),
    about: input.about,
    understanding: inventory.understanding,
    subjects: observedSubjects,
    systemDocuments: draftSystemDocuments,
  };

  writeKrowFile(draftRef, `${JSON.stringify(proposal, null, 2)}\n`, rootDir);

  const decisions = systemDocumentDecisionPrompts(proposal);
  writeKrowFile(decisionsRef, `${JSON.stringify(decisions, null, 2)}\n`, rootDir);

  const findings: CheckFinding[] = [
    ...(glossary.trim() ? [] : [{
      kind: "empty-glossary" as const,
      severity: "info" as const,
      message: `${GLOSSARY_FILE} is missing or empty.`,
      refs: [GLOSSARY_FILE],
    }]),
    ...(existingSystemDocuments.length > 0 ? [] : [{
      kind: "empty-system-docs" as const,
      severity: "info" as const,
      message: "No System Documents were found.",
      refs: [SYSTEM_DOCS_DIR],
    }]),
    ...draftSystemDocuments.map((document) => ({
      kind: "missing-system-document" as const,
      severity: "info" as const,
      message: `Draft System Document found from repository evidence: ${document.title} (${document.id})`,
      refs: document.references,
    })),
    ...brokenReferences(rootDir, existingSystemDocuments),
    ...uncoveredExamples(rootDir, inventory),
  ];
  const status: ProjectCheckResult["status"] = findings.length > 0 || decisions.length > 0 ? "needs-review" : "clean";
  const resultWithoutRefs = {
    checkId,
    status,
    findings,
    decisions,
    summary: {
      scannedFileCount: inventory.fileCount,
      draftSystemDocumentCount: draftSystemDocuments.length,
      approvalQuestionCount: decisions.length,
      strongSubjectCount: observedSubjects.filter((subject) => subject.evidenceTier === "strong").length,
      artifactSubjectCount: observedSubjects.filter((subject) => subject.evidenceTier === "artifact").length,
      weakSubjectCount: observedSubjects.filter((subject) => subject.evidenceTier === "weak").length,
      findingCount: findings.length,
      writesOutsideKrow: false as const,
    },
  };

  writeKrowFile(reportRef, reportMarkdown(resultWithoutRefs, { observedRef, draftRef, decisionsRef, proposal }), rootDir);

  return {
    ...resultWithoutRefs,
    reportRef,
    observedRef,
    draftRef,
    decisionsRef,
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
  const ref = `${checkRunDirPath(checkId)}/draft.json`;
  const filePath = absolutePath(ref, rootDir);
  if (!existsSync(filePath)) {
    throw new Error(`missing check proposal: ${ref}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as CheckProposal;
}

function systemDocumentFromDecision(document: SystemDocumentDraft, answer: DecisionAnswer): SystemDocumentDraft | undefined {
  if (answer.selectedOptionId === "reject") {
    return undefined;
  }
  if (answer.selectedOptionId === "approve") {
    return document;
  }
  if (answer.selectedOptionId !== "revise") {
    return undefined;
  }

  const input = answer.customInput?.trim();
  if (!input) {
    return undefined;
  }

  if (input.startsWith("{")) {
    const parsed = JSON.parse(input) as Partial<SystemDocumentDraft> & { term?: string; key?: string; means?: string };
    const revisedKey = parsed.key ? slugify(parsed.key) : document.sourceSubjectKey;
    if (revisedKey !== document.sourceSubjectKey) {
      throw new Error("revise cannot change decision identity; reject this decision and run check again with the refined seed");
    }
    if (parsed.id && parsed.id !== document.id) {
      throw new Error("revise cannot change System Document ID; reject this decision and run check again with the refined seed");
    }
    if (parsed.sourceSubjectKey && parsed.sourceSubjectKey !== document.sourceSubjectKey) {
      throw new Error("revise cannot change source subject key; reject this decision and run check again with the refined seed");
    }
    if (parsed.terms?.[0] && parsed.terms[0] !== `TERM:${document.sourceSubjectKey}`) {
      throw new Error("revise cannot change primary Glossary term ID; reject this decision and run check again with the refined seed");
    }
    const title = parsed.title ?? parsed.term ?? document.title;
    const key = document.sourceSubjectKey;
    const id = parsed.id ?? `DOC:${key}`;
    const summary = parsed.summary ?? parsed.means ?? document.summary;
    return {
      ...document,
      ...parsed,
      id,
      title,
      status: "proposed",
      summary,
      terms: parsed.terms ?? [`TERM:${key}`],
      references: parsed.references ?? document.references,
      statements: parsed.statements ?? document.statements.map((statement, index) => index === 0
        ? { ...statement, statement: summary, terms: parsed.terms ?? statement.terms }
        : statement),
      sourceSubjectKey: key,
    };
  }

  return {
    ...document,
    summary: input,
    statements: document.statements.map((statement, index) => index === 0 ? { ...statement, statement: input } : statement),
  };
}

function appendGlossaryRows(glossary: string, documents: SystemDocumentDraft[]): string {
  if (documents.length === 0) {
    return glossary;
  }

  let content = glossary.trimEnd() || "# Glossary";
  const existing = new Set(glossaryTerms(content));
  const sections = documents
    .filter((document) => {
      const primaryTerm = document.terms[0] ?? `TERM:${document.sourceSubjectKey}`;
      return !existing.has(normalizeSearchText(primaryTerm)) && !existing.has(normalizeSearchText(document.title));
    })
    .map((document) => [
      `## ${document.title}`,
      "",
      `ID: ${document.terms[0] ?? `TERM:${document.sourceSubjectKey}`}`,
      "Kind: Noun",
      "Status: Approved",
      "",
      "Meaning:",
      document.summary,
      "",
      "Boundary:",
      "Defined by the approved System Document and its System Statements.",
      "",
      "Aliases:",
      "- (none)",
      "",
      "References:",
      ...document.references.map((item) => `- ${item}`),
      `- System Document: ${systemDocumentRef(document)}`,
    ].join("\n"));

  if (sections.length === 0) {
    return `${content}\n`;
  }
  return `${content}\n\n${sections.join("\n\n")}\n`;
}

function systemDocumentRef(document: SystemDocumentDraft): string {
  return `${SYSTEM_DOCS_DIR}/${document.sourceSubjectKey}.md`;
}

function replaceMarkdownSection(content: string, heading: string, lines: string[]): string {
  const section = [`## ${heading}`, "", ...lines, ""].join("\n");
  const pattern = new RegExp(`(^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?)(?=\\n## |$)`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, section.trimEnd());
  }
  return `${content.trimEnd()}\n\n${section}`.trimEnd();
}

function updateSystemMap(indexText: string, understanding: RepositoryUnderstanding, documents: SystemDocumentDraft[]): string {
  let content = indexText.trimEnd();
  if (!content) {
    content = [
      "# System Map",
      "",
      "This file routes agents to System Documents that describe the software with approved Glossary terms.",
    ].join("\n");
  }

  content = replaceMarkdownSection(content, "Repository", [
    `Product: ${understanding.productName ?? "(unknown)"}`,
    `Purpose: ${understanding.productPurpose ?? "(unknown)"}`,
    "Kind:",
    ...markdownList(understanding.repositoryKind),
  ]);
  content = replaceMarkdownSection(content, "Entrypoints", markdownList(understanding.entrypoints));
  content = replaceMarkdownSection(content, "Reading Order", markdownList(understanding.readingOrder));
  content = replaceMarkdownSection(content, "System Documents", documents.map((document) => `- ${document.id}: ${systemDocumentRef(document)}`));
  content = replaceMarkdownSection(content, "Runtime Flows", understanding.flows.map((flow) => `- ${flow.title}: ${flow.files.join(" -> ")}`));

  return `${content.trimEnd()}\n`;
}

export function applyProjectCheckDecisions(input: {
  checkId: string;
  answers: DecisionAnswer[];
  rootDir?: string;
}): CheckApplyResult {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const checkId = normalizeCheckId(input.checkId);
  const proposal = loadProposal(checkId, rootDir);
  const candidates = new Map<string, SystemDocumentDraft>();
  for (const document of proposal.systemDocuments) {
    candidates.set(`doc:${document.sourceSubjectKey}`, document);
    candidates.set(document.id, document);
    candidates.set(`term:${document.sourceSubjectKey}`, document);
  }
  const approved: SystemDocumentDraft[] = [];
  const skipped: string[] = [];

  for (const answer of input.answers) {
    const candidate = candidates.get(answer.decisionId);
    if (!candidate) {
      skipped.push(`${answer.decisionId}: unknown decision id`);
      continue;
    }
    let document: SystemDocumentDraft | undefined;
    try {
      document = systemDocumentFromDecision(candidate, answer);
    } catch (error) {
      skipped.push(`${answer.decisionId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!document) {
      skipped.push(`${answer.decisionId}: ${answer.selectedOptionId}`);
      continue;
    }
    approved.push(document);
  }

  const appliedRefs: string[] = [];
  if (approved.length > 0) {
    const glossary = loadGlossaryText(rootDir);
    writeKrowFile(GLOSSARY_FILE, appendGlossaryRows(glossary, approved), rootDir);
    appliedRefs.push(GLOSSARY_FILE);

    const indexPath = absolutePath(SYSTEM_MAP_FILE, rootDir);
    const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
    writeKrowFile(SYSTEM_MAP_FILE, updateSystemMap(indexText, proposal.understanding, approved), rootDir);
    appliedRefs.push(SYSTEM_MAP_FILE);

    for (const document of approved) {
      const ref = systemDocumentRef(document);
      if (existsSync(absolutePath(ref, rootDir))) {
        skipped.push(`${ref}: already exists`);
        continue;
      }
      writeKrowFile(ref, systemDocumentMarkdown(document, "approved"), rootDir);
      appliedRefs.push(ref);
    }
  }

  const checkDir = checkRunDirPath(checkId);
  const answersRef = `${checkDir}/answers.json`;
  const reportRef = `${checkDir}/apply.md`;
  writeKrowFile(answersRef, `${JSON.stringify(input.answers, null, 2)}\n`, rootDir);
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
