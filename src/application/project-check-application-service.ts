import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  SYSTEM_MAP_FILE,
  SYSTEM_DOCS_DIR,
  GLOSSARY_FILE,
  absolutePath,
  checkRunDirPath,
} from "../outbound-adapters/filesystem/krow-paths.js";
import { scanKrowDocuments } from "../domains/documents/document-contracts.js";
import type { DecisionAnswer, DecisionPrompt } from "../inbound-ports/public-types.js";

type CodeFileKind = "source" | "test" | "doc" | "config";
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
  sourceEntrypointCandidates: string[];
  runtimeFiles: string[];
  supportFiles: string[];
  flows: RepositoryFlow[];
  sourceFlowCandidates: RepositoryFlow[];
  readingOrder: string[];
  contextDocuments?: string[];
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

interface GlossaryTermDraft {
  id: string;
  title: string;
  kind: "Noun" | "Verb" | "State" | "Rule";
  status: "proposed" | "approved";
  meaning: string;
  boundary?: string;
  aliases: string[];
  references: string[];
  sourceSubjectKey?: string;
}

interface CheckProposal {
  checkId: string;
  generatedAt: string;
  about?: string;
  stage: "agent-draft-required" | "ready-for-approval";
  understanding: RepositoryUnderstanding;
  subjects: ObservedSystemSubject[];
  terms: GlossaryTermDraft[];
  systemDocuments: SystemDocumentDraft[];
}

interface CheckQuestion {
  id?: string;
  kind?: string;
  question?: string;
  status?: string | null;
  blocksApproval?: boolean;
  context?: string[];
  whyItMatters?: string;
}

interface ProposalReferenceIssue {
  targetId: string;
  reference: string;
  message: string;
}

interface ProposalContextReference {
  targetId: string;
  reference: string;
}

interface ProposalReferenceReview {
  issues: ProposalReferenceIssue[];
  contextReferences: ProposalContextReference[];
}

interface CheckEvidenceBundle {
  checkId: string;
  generatedAt: string;
  about?: string;
  inventory: CodeInventory;
  existing: {
    glossaryRef: string;
    systemMapRef: string;
    systemDocumentRefs: string[];
  };
}

export interface ProjectCheckResult {
  checkId: string;
  status: "needs-agent-draft" | "needs-review" | "clean";
  reportRef: string;
  observedRef: string;
  evidenceRef: string;
  readingPlanRef: string;
  understandingRef: string;
  proposalsRef: string;
  questionsRef: string;
  draftRef: string;
  decisionsRef: string;
  findings: CheckFinding[];
  decisions: DecisionPrompt[];
  summary: {
    scannedFileCount: number;
    draftSystemDocumentCount: number;
    draftGlossaryTermCount: number;
    approvalQuestionCount: number;
    approvalPromptCount: number;
    meaningQuestionCount: number;
    blockingMeaningQuestionCount: number;
    artifactIssueCount: number;
    referenceIssueCount: number;
    contextReferenceCount: number;
    observedSubjectCount: number;
    findingCount: number;
    writesOutsideKrow: false;
  };
}

export interface ProjectCheckDecisionResult {
  checkId: string;
  proposalsRef: string;
  decisionsRef: string;
  decisions: DecisionPrompt[];
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
const maxApprovalPromptsPerKind = 8;

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
const importExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json"];
const knownAcronyms = new Set(["ai", "api", "cli", "css", "ddd", "html", "http", "json", "sql", "ui", "url", "ux"]);

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

function sourceEntrypointCandidates(packageEntrypoints: Set<string>, files: string[]): string[] {
  const candidates = new Set<string>();
  for (const packageEntrypoint of packageEntrypoints) {
    for (const candidate of sourceEntrypointCounterparts(packageEntrypoint, files)) {
      candidates.add(candidate);
    }
  }
  return [...candidates].sort();
}

function sourceEntrypointCounterparts(packageEntrypoint: string, files: string[]): string[] {
  const entryWithoutExtension = packageEntrypoint.replace(/\.[^.]+$/, "");
  const entryBasename = path.posix.basename(entryWithoutExtension);
  if (!entryBasename) {
    return [];
  }

  return files.filter((file) => {
    const extension = path.extname(file);
    if (!sourceExtensions.has(extension)) {
      return false;
    }
    const withoutExtension = file.replace(/\.[^.]+$/, "");
    return file !== packageEntrypoint && path.posix.basename(withoutExtension) === entryBasename;
  });
}

function packageEntrypointDeclarations(rootDir: string): string[] {
  const pkg = packageJson(rootDir);
  if (!pkg) {
    return [];
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

  return unique(candidates);
}

function packageEntrypoints(rootDir: string): Set<string> {
  const entrypoints = new Set<string>();

  for (const candidate of packageEntrypointDeclarations(rootDir)) {
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

function commandCaseBlocks(content: string): Array<{ command: string; body: string; handler?: string }> {
  const switchMatch = content.match(/switch\s*\(\s*command\s*\)\s*{([\s\S]*?)\n\s*default\s*:/);
  const switchBody = switchMatch?.[1];
  if (!switchBody) {
    return [];
  }
  const blocks: Array<{ command: string; body: string; handler?: string }> = [];
  const pattern = /\bcase\s+["']([^"']+)["']\s*:\s*([\s\S]*?)(?=\n\s*case\s+["']|$)/g;
  for (const match of switchBody.matchAll(pattern)) {
    if (match[1]) {
      const body = match[2] ?? "";
      blocks.push({ command: match[1], body, handler: firstFunctionCall(body) });
    }
  }
  return blocks;
}

function commandIfBlocks(content: string): Array<{ command: string; body: string; handler?: string }> {
  const blocks: Array<{ command: string; body: string; handler?: string }> = [];
  const pattern = /if\s*\(([^)]*\bcommand\s*===\s*["'][^"']+["'][^)]*)\)\s*return\s+([^;\n]+);/g;
  for (const match of content.matchAll(pattern)) {
    const condition = match[1] ?? "";
    const body = match[2] ?? "";
    const commands = [...condition.matchAll(/\bcommand\s*===\s*["']([^"']+)["']/g)]
      .map((item) => item[1])
      .filter((command): command is string => Boolean(command) && !command.startsWith("-"));
    const handler = firstFunctionCall(body);
    for (const command of commands) {
      blocks.push({ command, body, handler });
    }
  }
  return blocks;
}

function commandDispatchBlocks(content: string): Array<{ command: string; body: string; handler?: string }> {
  const byCommand = new Map<string, { command: string; body: string; handler?: string }>();
  for (const block of [...commandCaseBlocks(content), ...commandIfBlocks(content)]) {
    if (!byCommand.has(block.command)) {
      byCommand.set(block.command, block);
    }
  }
  return [...byCommand.values()];
}

function firstFunctionCall(body: string): string | undefined {
  return body.match(/\b([A-Za-z_$][\w$]*)\s*\(/)?.[1];
}

function localFunctionCalls(body: string): string[] {
  const blocked = new Set(["if", "for", "while", "switch", "catch", "return", "function"]);
  return unique(
    [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name) && !blocked.has(name)),
  );
}

function reachableLocalFunctionBodies(content: string, seedBodies: string[], maxDepth = 12): string[] {
  const bodies: string[] = [];
  const seen = new Set<string>();
  const queue = seedBodies.flatMap(localFunctionCalls);

  while (queue.length > 0 && seen.size < maxDepth) {
    const functionName = queue.shift();
    if (!functionName || seen.has(functionName)) {
      continue;
    }
    seen.add(functionName);

    const body = extractFunctionBody(content, functionName);
    if (!body) {
      continue;
    }
    bodies.push(body);
    queue.push(...localFunctionCalls(body).filter((name) => !seen.has(name)));
  }

  return bodies;
}

function repoFileReferenceLiterals(rootDir: string, fromFile: string, body: string): string[] {
  const refs: string[] = [];
  for (const match of body.matchAll(/["'`]([^"'`\n]+)["'`]/g)) {
    const literal = match[1]?.trim();
    if (!literal || !literal.includes("/")) {
      continue;
    }
    const resolved = literal.startsWith("./") || literal.startsWith("../")
      ? resolveImport(rootDir, fromFile, literal)
      : resolveRepoFile(rootDir, literal);
    if (resolved) {
      refs.push(resolved);
    }
  }
  return unique(refs);
}

function titleFromCommand(command: string): string {
  return titleFromWords(command.split("-").filter(Boolean));
}

function commandFlows(rootDir: string, entrypoint: string): RepositoryFlow[] {
  const absolute = path.join(rootDir, entrypoint);
  if (!existsSync(absolute) || statSync(absolute).size > maxReadableBytes) {
    return [];
  }
  const content = readFileSync(absolute, "utf8");
  const imports = namedImportTargets(rootDir, entrypoint, content);
  const flows: RepositoryFlow[] = [];

  for (const block of commandDispatchBlocks(content)) {
    const handler = block.handler;
    const handlerBody = handler ? extractFunctionBody(content, handler) : block.body;
    const files = new Set<string>([entrypoint]);

    for (const [symbol, ref] of imports.entries()) {
      const symbolIndex = handlerBody.indexOf(symbol);
      const blockIndex = block.body.indexOf(symbol);
      const index = symbolIndex >= 0 ? symbolIndex : blockIndex;
      if (index < 0) {
        continue;
      }
      files.add(ref);
    }

    for (const body of [block.body, handlerBody, ...reachableLocalFunctionBodies(content, [block.body, handlerBody])]) {
      for (const ref of repoFileReferenceLiterals(rootDir, entrypoint, body)) {
        files.add(ref);
      }
    }

    if (files.size <= 1 && !handler) {
      continue;
    }

    const title = `${titleFromCommand(block.command)} Command`;
    flows.push({
      id: slugify(`${block.command}-${title}`),
      title,
      entrypoint,
      files: [...files],
      summary: `${title} is dispatched by ${entrypoint}.`,
    });
  }

  return flows;
}

function buildRepositoryUnderstanding(
  rootDir: string,
  files: CodeInventoryFile[],
  entrypoints: Set<string>,
  sourceEntrypoints: string[],
  runtimeFileOrder: string[],
): RepositoryUnderstanding {
  const fileSet = new Set(files.map((file) => file.path));
  const runtimeFiles = files.filter((file) => file.role === "runtime").map((file) => file.path);
  const supportFiles = files.filter((file) => file.role === "support").map((file) => file.path);
  const flows = entrypoints.size > 0
    ? [...entrypoints].filter((entrypoint) => fileSet.has(entrypoint)).flatMap((entrypoint) => commandFlows(rootDir, entrypoint))
    : [];
  const uniqueFlows = dedupeRepositoryFlows(flows);
  const sourceFlowCandidates = dedupeRepositoryFlows(sourceEntrypoints.flatMap((entrypoint) => commandFlows(rootDir, entrypoint)));
  const readingOrder = unique([
    ...[...entrypoints],
    ...sourceEntrypoints,
    ...uniqueFlows.flatMap((flow) => flow.files),
    ...sourceFlowCandidates.flatMap((flow) => flow.files),
    ...runtimeFileOrder,
  ]).filter((ref) => files.some((file) => file.path === ref && file.kind !== "doc"));

  const notes: string[] = [];
  if (entrypoints.size === 0) {
    notes.push("No package or export entrypoint was detected; runtime flow candidates are limited.");
  }
  if (uniqueFlows.length === 0 && sourceFlowCandidates.length > 0) {
    notes.push("No command or route flow was detected from package entrypoints; source flow candidates were recorded separately.");
  } else if (uniqueFlows.length === 0) {
    notes.push("No command or route flow was detected from the entrypoint.");
  }

  return {
    productName: packageName(rootDir),
    productPurpose: packageDescription(rootDir),
    repositoryKind: inferRepositoryKind(rootDir, files),
    sourceRoots: topLevelRoots(files, (file) => file.kind === "source"),
    testRoots: topLevelRoots(files, (file) => file.kind === "test"),
    entrypoints: [...entrypoints],
    sourceEntrypointCandidates: sourceEntrypoints,
    runtimeFiles,
    supportFiles,
    flows: uniqueFlows,
    sourceFlowCandidates,
    readingOrder,
    contextDocuments: contextDocumentOrder(files),
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

function isContextDocumentRef(ref: string): boolean {
  return docExtensions.has(path.extname(ref));
}

function contextDocumentOrder(files: CodeInventoryFile[]): string[] {
  const priority = (file: CodeInventoryFile): number => {
    if (/^README\.md$/i.test(file.path)) {
      return 0;
    }
    if (/^docs\/README\.md$/i.test(file.path)) {
      return 1;
    }
    if (file.path.startsWith("docs/")) {
      return 2;
    }
    if (/^(AGENTS|CLAUDE|CODEX|GEMINI)\.md$/i.test(file.path)) {
      return 3;
    }
    return 4;
  };

  return files
    .filter((file) => file.kind === "doc")
    .sort((left, right) => priority(left) - priority(right) || left.path.localeCompare(right.path))
    .map((file) => file.path);
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
  const declaredEntrypoints = packageEntrypointDeclarations(root);
  const entrypoints = packageEntrypoints(root);
  const sourceEntrypoints = sourceEntrypointCandidates(new Set([...entrypoints, ...declaredEntrypoints]), scopedFiles);
  const runtimeEntryPoints = new Set([...entrypoints, ...sourceEntrypoints]);
  const runtimeFileOrder = runtimeReachableFileOrder(root, scopedFiles, runtimeEntryPoints);
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
    understanding: buildRepositoryUnderstanding(root, files, entrypoints, sourceEntrypoints, runtimeFileOrder),
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

function rootFileReference(value: string): string | undefined {
  const cleaned = cleanReferenceTarget(value);
  const match = cleaned.match(/\b((?:README|AGENTS|CLAUDE|CODEX|GEMINI|CHANGELOG)(?:\.[A-Za-z0-9_.-]+)?|(?:package(?:-lock)?|tsconfig|vite\.config|vitest\.config|jest\.config)\.[A-Za-z0-9_.-]+|Cargo\.toml|Makefile|Dockerfile)\b/);
  return match?.[1];
}

function referencePath(value: string): string | undefined {
  return pathishReference(value) ?? rootFileReference(value);
}

function isMarkdownContextReference(value: string): boolean {
  const target = referencePath(value);
  if (!target) {
    return false;
  }
  const lower = target.toLowerCase();
  if (!lower.endsWith(".md") && !lower.endsWith(".mdx")) {
    return false;
  }
  if (lower.startsWith("templates/") || lower.startsWith("src/infrastructure/templates/") || lower.startsWith("adapters/")) {
    return false;
  }
  return lower === "readme.md"
    || lower.startsWith("docs/")
    || /^(agents|claude|codex|gemini)\.md$/i.test(target);
}

function isSourceEvidenceReference(value: string): boolean {
  const target = referencePath(value);
  if (!target) {
    return false;
  }
  const lower = target.toLowerCase();
  if (lower.startsWith(".krow/check/")) {
    return false;
  }
  if (lower.startsWith("src/") || lower.startsWith("bin/") || lower.startsWith("install/")) {
    return true;
  }
  if (/(^|\/)(test|tests|__tests__)\//.test(lower) || /\.(test|spec)\.[a-z0-9]+$/.test(lower)) {
    return true;
  }
  if (lower.startsWith("templates/") || lower.startsWith("adapters/")) {
    return true;
  }
  return /(^|\/)(package\.json|tsconfig\.json|cargo\.toml|makefile|dockerfile)$/.test(lower);
}

function allowsContextReference(statement: SystemStatementDraft, document: SystemDocumentDraft): boolean {
  const text = normalizeSearchText(`${document.title} ${document.summary} ${statement.statement} ${statement.notes.join(" ")}`);
  return /\b(future|planned|plan|direction|roadmap|design|documentation|readme|docs|context|framing)\b/.test(text);
}

function proposalReferenceReview(proposal: CheckProposal): ProposalReferenceReview {
  const issues: ProposalReferenceIssue[] = [];
  const contextReferences: ProposalContextReference[] = [];

  for (const document of proposal.systemDocuments ?? []) {
    for (const statement of document.statements ?? []) {
      const sourceRefs = statement.references.filter(isSourceEvidenceReference);
      if (sourceRefs.length === 0) {
        issues.push({
          targetId: statement.id,
          reference: "(none)",
          message: "System Statement needs at least one source, test, config, or template reference.",
        });
      }

      const allowContext = allowsContextReference(statement, document);
      for (const reference of statement.references.filter(isMarkdownContextReference)) {
        contextReferences.push({ targetId: statement.id, reference });
        if (!allowContext) {
          issues.push({
            targetId: statement.id,
            reference,
            message: "Move Markdown context out of System Statement References; current behavior references should point to code, tests, config, or runtime templates.",
          });
        }
      }
    }
  }

  return { issues, contextReferences };
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

function currentCheckFindings(rootDir: string, inventory: CodeInventory): CheckFinding[] {
  const existingSystemDocuments = loadSystemDocuments(rootDir);
  const glossary = loadGlossaryText(rootDir);
  return [
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
    ...brokenReferences(rootDir, existingSystemDocuments),
    ...uncoveredExamples(rootDir, inventory),
  ];
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
  return proposal.systemDocuments.slice(0, maxApprovalPromptsPerKind).map((document) => ({
    id: `doc:${document.sourceSubjectKey}`,
    kind: "approval" as const,
    target: {
      kind: "system-document" as const,
      ref: `${checkRunDirPath(proposal.checkId)}/proposals.json#${document.id}`,
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
      "Approve applies this System Document, its System Statements, and the System Map entry. Revise should provide precise replacement wording or JSON fields.",
    ].join("\n"),
    options: [
      { id: "approve", label: "Approve", description: "Apply this System Document draft to .krow/system." },
      { id: "revise", label: "Revise", description: "Apply with explicit user-provided corrections." },
      { id: "reject", label: "Reject", description: "Do not add this System Document." },
    ],
  }));
}

function termDecisionId(term: GlossaryTermDraft): string {
  return `term:${term.sourceSubjectKey ?? term.id.replace(/^TERM:/, "")}`;
}

function glossaryTermDecisionPrompts(proposal: CheckProposal): DecisionPrompt[] {
  return (proposal.terms ?? []).slice(0, maxApprovalPromptsPerKind).map((term) => ({
    id: termDecisionId(term),
    kind: "approval" as const,
    target: {
      kind: "glossary" as const,
      ref: `${checkRunDirPath(proposal.checkId)}/proposals.json#${term.id}`,
      status: "proposed",
    },
    question: `Approve ${term.id} as a Glossary term?`,
    context: [
      `Title: ${term.title}`,
      `Kind: ${term.kind}`,
      `Meaning: ${term.meaning}`,
      ...(term.boundary ? [`Boundary: ${term.boundary}`] : []),
      `Aliases: ${term.aliases.join(", ") || "(none)"}`,
      `References: ${term.references.join(", ")}`,
      "Approve applies this term to .krow/system/glossary.md. Revise should provide precise replacement wording or JSON fields.",
    ].join("\n"),
    options: [
      { id: "approve", label: "Approve", description: "Apply this Glossary term draft to .krow/system/glossary.md." },
      { id: "revise", label: "Revise", description: "Apply with explicit user-provided corrections." },
      { id: "reject", label: "Reject", description: "Do not add this Glossary term." },
    ],
  }));
}

function readingPlanMarkdownTemplate(input: {
  checkId: string;
  evidenceRef: string;
  existingSystemMapRef: string;
}): string {
  return [
    "# Reading Plan",
    "",
    `Check ID: ${input.checkId}`,
    `Evidence: ${input.evidenceRef}`,
    `Current System Map: ${input.existingSystemMapRef}`,
    "",
    "Status: Draft",
    "",
    "## Repository Orientation",
    "",
    "## Read In This Order",
    "",
    "## Reading Boundary",
    "",
    "## Refresh Conditions",
    "",
  ].join("\n");
}

function understandingMarkdownTemplate(input: {
  checkId: string;
  evidenceRef: string;
  readingPlanRef: string;
}): string {
  return [
    "# Check Understanding",
    "",
    `Check ID: ${input.checkId}`,
    `Evidence: ${input.evidenceRef}`,
    `Reading Plan: ${input.readingPlanRef}`,
    "",
    "Status: Draft",
    "",
    "## What Was Read",
    "",
    "## System Understanding",
    "",
    "## Proposed Glossary Terms",
    "",
    "## Proposed System Documents",
    "",
    "## Gaps",
    "",
  ].join("\n");
}

function emptyQuestionsJson(checkId: string): string {
  return `${JSON.stringify({ checkId, questions: [] }, null, 2)}\n`;
}

interface CheckArtifactStatus {
  label: string;
  ref: string;
  status: string;
  ready: boolean;
  issue?: string;
}

function markdownStatus(ref: string, rootDir: string): string {
  const absolute = absolutePath(ref, rootDir);
  if (!existsSync(absolute)) {
    return "Missing";
  }
  const content = readFileSync(absolute, "utf8");
  return content.match(/^Status:\s*(.+)$/mi)?.[1]?.trim() ?? "Missing";
}

function artifactStatus(label: string, ref: string, rootDir: string): CheckArtifactStatus {
  const status = markdownStatus(ref, rootDir);
  const normalized = normalizeSearchText(status);
  const ready = ["complete", "completed", "ready", "ready for approval"].includes(normalized);
  return {
    label,
    ref,
    status,
    ready,
    issue: ready ? undefined : `${label} is ${status}; mark it Complete before approval prompts are generated.`,
  };
}

function checkArtifactStatuses(rootDir: string, refs: {
  readingPlanRef: string;
  understandingRef: string;
}): CheckArtifactStatus[] {
  return [
    artifactStatus("Reading Plan", refs.readingPlanRef, rootDir),
    artifactStatus("Understanding", refs.understandingRef, rootDir),
  ];
}

function loadCheckQuestions(ref: string, rootDir: string): CheckQuestion[] {
  const absolute = absolutePath(ref, rootDir);
  if (!existsSync(absolute)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(absolute, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { questions?: unknown }).questions)) {
    return [];
  }
  return (parsed as { questions: unknown[] }).questions
    .filter((question): question is CheckQuestion => Boolean(question) && typeof question === "object");
}

function isBlockingQuestion(question: CheckQuestion): boolean {
  if (question.blocksApproval === false) {
    return false;
  }
  const status = normalizeSearchText(String(question.status ?? "open"));
  return !["answered", "resolved", "closed", "complete", "completed", "nonblocking"].includes(status);
}

function blockingQuestions(questions: CheckQuestion[]): CheckQuestion[] {
  return questions.filter(isBlockingQuestion);
}

function emptyProposal(input: {
  checkId: string;
  generatedAt: string;
  about?: string;
  understanding: RepositoryUnderstanding;
}): CheckProposal {
  return {
    checkId: input.checkId,
    generatedAt: input.generatedAt,
    about: input.about,
    stage: "agent-draft-required",
    understanding: input.understanding,
    subjects: [],
    terms: [],
    systemDocuments: [],
  };
}

function reportMarkdown(result: Omit<ProjectCheckResult, "reportRef" | "observedRef" | "evidenceRef" | "readingPlanRef" | "understandingRef" | "proposalsRef" | "questionsRef" | "draftRef" | "decisionsRef">, refs: {
  observedRef: string;
  evidenceRef: string;
  readingPlanRef: string;
  understandingRef: string;
  proposalsRef: string;
  questionsRef: string;
  draftRef: string;
  decisionsRef: string;
  proposal: CheckProposal;
  artifactStatuses: CheckArtifactStatus[];
  referenceReview: ProposalReferenceReview;
  questions: CheckQuestion[];
}): string {
  const blockers = [
    ...refs.artifactStatuses.filter((status) => !status.ready).map((status) => status.issue ?? `${status.label} is not complete.`),
    ...refs.referenceReview.issues.map((issue) => `${issue.targetId}: ${issue.message}${issue.reference === "(none)" ? "" : ` (${issue.reference})`}`),
    ...blockingQuestions(refs.questions).map((question) => `${question.id ?? "question"}: ${question.question ?? "(missing question text)"}`),
  ];
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
    `- Draft Glossary Terms: ${result.summary.draftGlossaryTermCount}`,
    `- Draft System Documents: ${result.summary.draftSystemDocumentCount}`,
    `- Approval prompts: ${result.summary.approvalPromptCount}`,
    `- Meaning questions: ${result.summary.blockingMeaningQuestionCount} blocking / ${result.summary.meaningQuestionCount} total`,
    `- Artifact issues: ${result.summary.artifactIssueCount}`,
    `- Reference issues: ${result.summary.referenceIssueCount}`,
    `- Markdown context refs in statements: ${result.summary.contextReferenceCount}`,
    `- Findings: ${result.summary.findingCount}`,
    ...(refs.proposal.about ? [`- About: ${refs.proposal.about}`] : []),
    "",
    "## Readiness",
    "",
    ...refs.artifactStatuses.map((status) => `- ${status.label}: ${status.status} (${status.ref})`),
    `- Approval prompts: ${result.decisions.length > 0 ? `${result.decisions.length} generated` : "not generated"}`,
    `- Blocking meaning questions: ${result.summary.blockingMeaningQuestionCount}`,
    `- Reference issues: ${result.summary.referenceIssueCount}`,
    "",
    "## Meaning Questions",
    "",
    ...meaningQuestionList(refs.questions),
    "",
    "## Reference Review",
    "",
    ...referenceReviewList(refs.referenceReview),
    "",
    "## Repository Understanding",
    "",
    ...repositoryUnderstandingMarkdown(refs.proposal.understanding),
    "",
    "## Draft Glossary Terms",
    "",
    ...glossaryTermDraftList(refs.proposal.terms),
    "",
    "## Draft System Documents",
    "",
    ...systemDocumentDraftList(refs.proposal.systemDocuments),
    "",
    "## Agent Work",
    "",
    "- Read the evidence bundle.",
    "- Fill the reading plan with the files or areas actually worth reading.",
    "- Trace code according to that plan.",
    "- Write understanding and proposals only from evidence that was read.",
    "- Run `check-decisions` after proposals are ready for approval.",
    "",
    "## Files",
    "",
    `- Evidence: ${refs.evidenceRef}`,
    `- Reading Plan: ${refs.readingPlanRef}`,
    `- Understanding: ${refs.understandingRef}`,
    `- Proposals: ${refs.proposalsRef}`,
    `- Questions: ${refs.questionsRef}`,
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
    blockers.length > 0
      ? `Resolve readiness blockers before approval prompts: ${blockers.join("; ")}`
      : result.decisions.length > 0
        ? "Use the `$check` skill to ask the bundled approval prompts and apply only approved decisions."
        : "Fill the reading plan, understanding, proposals, and questions artifacts. Then run `check-decisions` for approval prompts.",
    "",
  ].join("\n");
}

function repositoryUnderstandingMarkdown(understanding: RepositoryUnderstanding): string[] {
  const contextDocuments = unique([
    ...(understanding.contextDocuments ?? []),
    ...understanding.readingOrder.filter(isContextDocumentRef),
  ]);
  const runtimeReadingOrder = understanding.readingOrder.filter((ref) => !isContextDocumentRef(ref));
  return [
    `- Product name: ${understanding.productName ?? "(unknown)"}`,
    `- Product purpose: ${understanding.productPurpose ?? "(unknown)"}`,
    `- Repository kind: ${understanding.repositoryKind.join(", ") || "(unknown)"}`,
    `- Entrypoints: ${understanding.entrypoints.join(", ") || "(none detected)"}`,
    `- Source entrypoint candidates: ${understanding.sourceEntrypointCandidates.join(", ") || "(none detected)"}`,
    `- Source roots: ${understanding.sourceRoots.join(", ") || "(none detected)"}`,
    `- Test roots: ${understanding.testRoots.join(", ") || "(none detected)"}`,
    "",
    "### Runtime Flows",
    "",
    ...(understanding.flows.length > 0
      ? understanding.flows.map((flow) => `- ${flow.title}: ${flow.files.join(" -> ")}`)
      : ["- none detected"]),
    "",
    "### Source Flow Candidates",
    "",
    ...(understanding.sourceFlowCandidates.length > 0
      ? understanding.sourceFlowCandidates.map((flow) => `- ${flow.title}: ${flow.files.join(" -> ")}`)
      : ["- none detected"]),
    "",
    "### Runtime Reading Order",
    "",
    ...markdownList(runtimeReadingOrder),
    "",
    "### Context Documents",
    "",
    ...markdownList(contextDocuments),
    "",
    "### Notes",
    "",
    ...markdownList(understanding.notes),
  ];
}

function meaningQuestionList(questions: CheckQuestion[]): string[] {
  if (questions.length === 0) {
    return ["- none"];
  }
  return questions.map((question) => {
    const status = question.status ?? "open";
    const blocking = isBlockingQuestion(question) ? "blocking" : "nonblocking";
    return `- ${question.id ?? "(no id)"} [${blocking}, ${status}]: ${question.question ?? "(missing question text)"}`;
  });
}

function referenceReviewList(review: ProposalReferenceReview): string[] {
  if (review.issues.length === 0 && review.contextReferences.length === 0) {
    return ["- none"];
  }

  const lines: string[] = [];
  if (review.issues.length > 0) {
    lines.push("Issues:");
    lines.push(...review.issues.map((issue) => `- ${issue.targetId}: ${issue.message}${issue.reference === "(none)" ? "" : ` (${issue.reference})`}`));
  }
  if (review.contextReferences.length > 0) {
    lines.push("Markdown context references found in System Statements:");
    lines.push(...review.contextReferences.map((item) => `- ${item.targetId}: ${item.reference}`));
  }
  return lines;
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

function glossaryTermDraftList(terms: GlossaryTermDraft[] = []): string[] {
  if (terms.length === 0) {
    return ["- none"];
  }
  return terms.flatMap((term) => [
    `- ${term.id}: ${term.title} (${term.kind})`,
    `  Meaning: ${term.meaning}`,
    ...(term.boundary ? [`  Boundary: ${term.boundary}`] : []),
    `  References: ${term.references.join(", ")}`,
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
  const evidenceRef = `${checkDir}/evidence.json`;
  const readingPlanRef = `${checkDir}/reading-plan.md`;
  const understandingRef = `${checkDir}/understanding.md`;
  const proposalsRef = `${checkDir}/proposals.json`;
  const questionsRef = `${checkDir}/questions.json`;
  const draftRef = `${checkDir}/draft.json`;
  const decisionsRef = `${checkDir}/decisions.json`;
  const reportRef = `${checkDir}/result.md`;

  ensureKrowDirectory(checkDir, rootDir);

  const inventory = buildCodeInventory(rootDir, input.scope);
  writeKrowFile(observedRef, `${JSON.stringify(inventory, null, 2)}\n`, rootDir);

  const existingSystemDocuments = loadSystemDocuments(rootDir);
  const glossary = loadGlossaryText(rootDir);
  const generatedAt = nowIso();
  const evidence: CheckEvidenceBundle = {
    checkId,
    generatedAt,
    about: input.about,
    inventory,
    existing: {
      glossaryRef: GLOSSARY_FILE,
      systemMapRef: SYSTEM_MAP_FILE,
      systemDocumentRefs: existingSystemDocuments.map((systemDocument) => systemDocument.ref),
    },
  };
  const proposal = emptyProposal({
    checkId,
    generatedAt,
    about: input.about,
    understanding: inventory.understanding,
  });

  writeKrowFile(evidenceRef, `${JSON.stringify(evidence, null, 2)}\n`, rootDir);
  writeKrowFile(readingPlanRef, readingPlanMarkdownTemplate({
    checkId,
    evidenceRef,
    existingSystemMapRef: SYSTEM_MAP_FILE,
  }), rootDir);
  writeKrowFile(understandingRef, understandingMarkdownTemplate({
    checkId,
    evidenceRef,
    readingPlanRef,
  }), rootDir);
  writeKrowFile(proposalsRef, `${JSON.stringify(proposal, null, 2)}\n`, rootDir);
  writeKrowFile(questionsRef, emptyQuestionsJson(checkId), rootDir);
  writeKrowFile(draftRef, `${JSON.stringify(proposal, null, 2)}\n`, rootDir);

  const decisions: DecisionPrompt[] = [];
  writeKrowFile(decisionsRef, `${JSON.stringify(decisions, null, 2)}\n`, rootDir);

  const findings = currentCheckFindings(rootDir, inventory);
  const questions = loadCheckQuestions(questionsRef, rootDir);
  const artifactStatuses = checkArtifactStatuses(rootDir, { readingPlanRef, understandingRef });
  const artifactIssueCount = artifactStatuses.filter((artifact) => !artifact.ready).length;
  const referenceReview = proposalReferenceReview(proposal);
  const blockingMeaningQuestionCount = blockingQuestions(questions).length;
  const status: ProjectCheckResult["status"] = proposal.stage === "agent-draft-required"
    ? "needs-agent-draft"
    : findings.length > 0 || artifactIssueCount > 0 || referenceReview.issues.length > 0 || blockingMeaningQuestionCount > 0 ? "needs-review" : "clean";
  const resultWithoutRefs = {
    checkId,
    status,
    findings,
    decisions,
    summary: {
      scannedFileCount: inventory.fileCount,
      draftGlossaryTermCount: proposal.terms.length,
      draftSystemDocumentCount: proposal.systemDocuments.length,
      approvalQuestionCount: decisions.length,
      approvalPromptCount: decisions.length,
      meaningQuestionCount: questions.length,
      blockingMeaningQuestionCount,
      artifactIssueCount,
      referenceIssueCount: referenceReview.issues.length,
      contextReferenceCount: referenceReview.contextReferences.length,
      observedSubjectCount: proposal.subjects.length,
      findingCount: findings.length,
      writesOutsideKrow: false as const,
    },
  };

  writeKrowFile(reportRef, reportMarkdown(resultWithoutRefs, {
    observedRef,
    evidenceRef,
    readingPlanRef,
    understandingRef,
    proposalsRef,
    questionsRef,
    draftRef,
    decisionsRef,
    proposal,
    artifactStatuses,
    referenceReview,
    questions,
  }), rootDir);

  return {
    ...resultWithoutRefs,
    reportRef,
    observedRef,
    evidenceRef,
    readingPlanRef,
    understandingRef,
    proposalsRef,
    questionsRef,
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
  const primaryRef = `${checkRunDirPath(checkId)}/proposals.json`;
  const legacyRef = `${checkRunDirPath(checkId)}/draft.json`;
  const primaryPath = absolutePath(primaryRef, rootDir);
  const legacyPath = absolutePath(legacyRef, rootDir);
  const filePath = existsSync(primaryPath) ? primaryPath : legacyPath;
  if (!existsSync(filePath)) {
    throw new Error(`missing check proposal: ${primaryRef}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as CheckProposal;
}

export function buildProjectCheckDecisions(input: {
  checkId: string;
  rootDir?: string;
}): ProjectCheckDecisionResult {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const checkId = normalizeCheckId(input.checkId);
  const checkDir = checkRunDirPath(checkId);
  const observedRef = `${checkDir}/observed.json`;
  const evidenceRef = `${checkDir}/evidence.json`;
  const readingPlanRef = `${checkDir}/reading-plan.md`;
  const understandingRef = `${checkDir}/understanding.md`;
  const proposalsRef = `${checkRunDirPath(checkId)}/proposals.json`;
  const questionsRef = `${checkDir}/questions.json`;
  const draftRef = `${checkDir}/draft.json`;
  const decisionsRef = `${checkRunDirPath(checkId)}/decisions.json`;
  const reportRef = `${checkDir}/result.md`;
  const proposal = loadProposal(checkId, rootDir);
  const evidence = JSON.parse(readFileSync(absolutePath(evidenceRef, rootDir), "utf8")) as CheckEvidenceBundle;
  const questions = loadCheckQuestions(questionsRef, rootDir);
  const artifactStatuses = checkArtifactStatuses(rootDir, { readingPlanRef, understandingRef });
  const artifactIssueCount = artifactStatuses.filter((artifact) => !artifact.ready).length;
  const referenceReview = proposalReferenceReview(proposal);
  const blockingMeaningQuestionCount = blockingQuestions(questions).length;

  if (proposal.stage !== "ready-for-approval") {
    throw new Error(`${proposalsRef} must set stage to "ready-for-approval" before check-decisions`);
  }
  if (
    (!Array.isArray(proposal.terms) || proposal.terms.length === 0)
    && (!Array.isArray(proposal.systemDocuments) || proposal.systemDocuments.length === 0)
  ) {
    throw new Error(`${proposalsRef} must contain at least one Glossary term or System Document proposal before check-decisions`);
  }

  const findings = currentCheckFindings(rootDir, evidence.inventory);
  const readinessBlockers = [
    ...artifactStatuses.filter((artifact) => !artifact.ready).map((artifact) => artifact.issue ?? `${artifact.label} is not complete.`),
    ...referenceReview.issues.map((issue) => `${issue.targetId}: ${issue.message}${issue.reference === "(none)" ? "" : ` (${issue.reference})`}`),
    ...blockingQuestions(questions).map((question) => `${question.id ?? "question"}: ${question.question ?? "(missing question text)"}`),
  ];
  if (readinessBlockers.length > 0) {
    const decisions: DecisionPrompt[] = [];
    writeKrowFile(decisionsRef, `${JSON.stringify(decisions, null, 2)}\n`, rootDir);
    writeKrowFile(reportRef, reportMarkdown({
      checkId,
      status: "needs-review",
      findings,
      decisions,
      summary: {
        scannedFileCount: evidence.inventory.fileCount,
        draftGlossaryTermCount: proposal.terms?.length ?? 0,
        draftSystemDocumentCount: proposal.systemDocuments.length,
        approvalQuestionCount: decisions.length,
        approvalPromptCount: decisions.length,
        meaningQuestionCount: questions.length,
        blockingMeaningQuestionCount,
        artifactIssueCount,
        referenceIssueCount: referenceReview.issues.length,
        contextReferenceCount: referenceReview.contextReferences.length,
        observedSubjectCount: proposal.subjects.length,
        findingCount: findings.length,
        writesOutsideKrow: false as const,
      },
    }, {
      observedRef,
      evidenceRef,
      readingPlanRef,
      understandingRef,
      proposalsRef,
      questionsRef,
      draftRef,
      decisionsRef,
      proposal,
      artifactStatuses,
      referenceReview,
      questions,
    }), rootDir);
    throw new Error(`check is not ready for approval prompts: ${readinessBlockers.join("; ")}`);
  }

  const decisions = [
    ...glossaryTermDecisionPrompts(proposal),
    ...systemDocumentDecisionPrompts(proposal),
  ];
  writeKrowFile(decisionsRef, `${JSON.stringify(decisions, null, 2)}\n`, rootDir);
  writeKrowFile(reportRef, reportMarkdown({
    checkId,
    status: "needs-review",
    findings,
    decisions,
    summary: {
      scannedFileCount: evidence.inventory.fileCount,
      draftGlossaryTermCount: proposal.terms?.length ?? 0,
      draftSystemDocumentCount: proposal.systemDocuments.length,
      approvalQuestionCount: decisions.length,
      approvalPromptCount: decisions.length,
      meaningQuestionCount: questions.length,
      blockingMeaningQuestionCount,
      artifactIssueCount,
      referenceIssueCount: referenceReview.issues.length,
      contextReferenceCount: referenceReview.contextReferences.length,
      observedSubjectCount: proposal.subjects.length,
      findingCount: findings.length,
      writesOutsideKrow: false as const,
    },
  }, {
    observedRef,
    evidenceRef,
    readingPlanRef,
    understandingRef,
    proposalsRef,
    questionsRef,
    draftRef,
    decisionsRef,
    proposal,
    artifactStatuses,
    referenceReview,
    questions,
  }), rootDir);

  return {
    checkId,
    proposalsRef,
    decisionsRef,
    decisions,
  };
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
      throw new Error("revise cannot change decision identity; reject this decision and run check again with refined input");
    }
    if (parsed.id && parsed.id !== document.id) {
      throw new Error("revise cannot change System Document ID; reject this decision and run check again with refined input");
    }
    if (parsed.sourceSubjectKey && parsed.sourceSubjectKey !== document.sourceSubjectKey) {
      throw new Error("revise cannot change source subject key; reject this decision and run check again with refined input");
    }
    if (parsed.terms?.[0] && parsed.terms[0] !== `TERM:${document.sourceSubjectKey}`) {
      throw new Error("revise cannot change primary Glossary term ID; reject this decision and run check again with refined input");
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

function glossaryTermFromDecision(term: GlossaryTermDraft, answer: DecisionAnswer): GlossaryTermDraft | undefined {
  if (answer.selectedOptionId === "reject") {
    return undefined;
  }
  if (answer.selectedOptionId === "approve") {
    return term;
  }
  if (answer.selectedOptionId !== "revise") {
    return undefined;
  }

  const input = answer.customInput?.trim();
  if (!input) {
    return undefined;
  }

  if (input.startsWith("{")) {
    const parsed = JSON.parse(input) as Partial<GlossaryTermDraft> & { means?: string };
    if (parsed.id && parsed.id !== term.id) {
      throw new Error("revise cannot change Glossary term ID; reject this decision and run check again with refined input");
    }
    if (parsed.sourceSubjectKey && parsed.sourceSubjectKey !== term.sourceSubjectKey) {
      throw new Error("revise cannot change term source subject key; reject this decision and run check again with refined input");
    }
    return {
      ...term,
      ...parsed,
      id: term.id,
      status: "proposed",
      title: parsed.title ?? term.title,
      kind: parsed.kind ?? term.kind,
      meaning: parsed.meaning ?? parsed.means ?? term.meaning,
      aliases: parsed.aliases ?? term.aliases,
      references: parsed.references ?? term.references,
      sourceSubjectKey: term.sourceSubjectKey,
    };
  }

  return {
    ...term,
    meaning: input,
  };
}

function appendGlossaryTermRows(glossary: string, terms: GlossaryTermDraft[]): string {
  if (terms.length === 0) {
    return glossary;
  }

  let content = glossary.trimEnd() || "# Glossary";
  const existing = new Set(glossaryTerms(content));
  const sections = terms
    .filter((term) => !existing.has(normalizeSearchText(term.id)) && !existing.has(normalizeSearchText(term.title)))
    .map((term) => [
      `## ${term.title}`,
      "",
      `ID: ${term.id}`,
      `Kind: ${term.kind}`,
      "Status: Approved",
      "",
      "Meaning:",
      term.meaning,
      "",
      "Boundary:",
      term.boundary ?? "Defined by approved System Documents and System Statements.",
      "",
      "Aliases:",
      ...(term.aliases.length > 0 ? term.aliases.map((alias) => `- ${alias}`) : ["- (none)"]),
      "",
      "References:",
      ...(term.references.length > 0 ? term.references.map((item) => `- ${item}`) : ["- (none)"]),
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

function removeEmptyMarkdownSection(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\n?## ${escapedHeading}\\n\\s*(?=\\n## |$)`, "m");
  return content.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
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

  content = removeEmptyMarkdownSection(content, "Documents");
  content = replaceMarkdownSection(content, "Repository", [
    `Product: ${understanding.productName ?? "(unknown)"}`,
    `Purpose: ${understanding.productPurpose ?? "(unknown)"}`,
    "Kind:",
    ...markdownList(understanding.repositoryKind),
  ]);
  content = replaceMarkdownSection(content, "Entrypoints", markdownList(understanding.entrypoints));
  content = removeEmptyMarkdownSection(content, "Reading Order");
  content = replaceMarkdownSection(content, "Runtime Reading Order", markdownList(understanding.readingOrder.filter((ref) => !isContextDocumentRef(ref))));
  content = replaceMarkdownSection(content, "Context Documents", markdownList(unique([
    ...(understanding.contextDocuments ?? []),
    ...understanding.readingOrder.filter(isContextDocumentRef),
  ])));
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
  const termCandidates = new Map<string, GlossaryTermDraft>();
  for (const term of proposal.terms ?? []) {
    termCandidates.set(termDecisionId(term), term);
    termCandidates.set(term.id, term);
  }
  const documentCandidates = new Map<string, SystemDocumentDraft>();
  for (const document of proposal.systemDocuments) {
    documentCandidates.set(`doc:${document.sourceSubjectKey}`, document);
    documentCandidates.set(document.id, document);
  }
  const approvedTerms: GlossaryTermDraft[] = [];
  const approvedDocuments: SystemDocumentDraft[] = [];
  const skipped: string[] = [];

  for (const answer of input.answers) {
    const termCandidate = termCandidates.get(answer.decisionId);
    if (termCandidate) {
      let term: GlossaryTermDraft | undefined;
      try {
        term = glossaryTermFromDecision(termCandidate, answer);
      } catch (error) {
        skipped.push(`${answer.decisionId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (!term) {
        skipped.push(`${answer.decisionId}: ${answer.selectedOptionId}`);
        continue;
      }
      approvedTerms.push(term);
      continue;
    }

    const documentCandidate = documentCandidates.get(answer.decisionId);
    if (!documentCandidate) {
      skipped.push(`${answer.decisionId}: unknown decision id`);
      continue;
    }
    let document: SystemDocumentDraft | undefined;
    try {
      document = systemDocumentFromDecision(documentCandidate, answer);
    } catch (error) {
      skipped.push(`${answer.decisionId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!document) {
      skipped.push(`${answer.decisionId}: ${answer.selectedOptionId}`);
      continue;
    }
    approvedDocuments.push(document);
  }

  const appliedRefs: string[] = [];
  if (approvedTerms.length > 0 || approvedDocuments.length > 0) {
    const glossary = loadGlossaryText(rootDir);
    if (approvedTerms.length > 0) {
      writeKrowFile(GLOSSARY_FILE, appendGlossaryTermRows(glossary, approvedTerms), rootDir);
      appliedRefs.push(GLOSSARY_FILE);
    } else if (!proposal.terms && approvedDocuments.length > 0) {
      writeKrowFile(GLOSSARY_FILE, appendGlossaryRows(glossary, approvedDocuments), rootDir);
      appliedRefs.push(GLOSSARY_FILE);
    }

    if (approvedDocuments.length > 0) {
      const indexPath = absolutePath(SYSTEM_MAP_FILE, rootDir);
      const indexText = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
      writeKrowFile(SYSTEM_MAP_FILE, updateSystemMap(indexText, proposal.understanding, approvedDocuments), rootDir);
      appliedRefs.push(SYSTEM_MAP_FILE);

      for (const document of approvedDocuments) {
        const ref = systemDocumentRef(document);
        if (existsSync(absolutePath(ref, rootDir))) {
          skipped.push(`${ref}: already exists`);
          continue;
        }
        writeKrowFile(ref, systemDocumentMarkdown(document, "approved"), rootDir);
        appliedRefs.push(ref);
      }
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
