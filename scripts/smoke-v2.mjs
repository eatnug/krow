#!/usr/bin/env node

import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(path.join(tmpdir(), "krow-v2-smoke-"));
const cli = path.resolve("dist/cli.js");
const packageMetadata = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));

if (packageMetadata.bin?.["krow-cli"] !== "dist/cli.js") {
  throw new Error("package should expose a krow-cli bin alias for reliable npx execution");
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`command failed: krow ${args.join(" ")}`);
  }
  return result.stdout;
}

function readJson(stdout) {
  return JSON.parse(stdout);
}

function assertExists(relativePath) {
  const target = path.join(root, relativePath);
  if (!existsSync(target)) {
    throw new Error(`missing expected path: ${relativePath}`);
  }
}

function assertMissing(relativePath) {
  const target = path.join(root, relativePath);
  if (existsSync(target)) {
    throw new Error(`unexpected path exists: ${relativePath}`);
  }
}

run(["init", "--agents", "none", "--root", root]);
assertExists(".krow/system/glossary.md");
assertExists(".krow/system/map.md");
assertExists(".krow/system/docs");
assertExists(".krow/work");
assertExists(".krow/state/workflows");
assertMissing(".krow/templates");

mkdirSync(path.join(root, "src"), { recursive: true });
writeFileSync(
  path.join(root, "package.json"),
  `${JSON.stringify({
    name: "smoke-krow",
    type: "module",
    bin: {
      smoke: "dist/cli.js",
    },
  }, null, 2)}\n`,
);
writeFileSync(
  path.join(root, "src", "cli.ts"),
  [
    "export const DEFAULT_PATHS = { stories: 'stories', plugins: '.slice/plugins' };",
    "",
    "export function main(): void {",
    "  process.stdout.write('smoke');",
    "}",
    "",
    "export const reviewLanguage = 'The Behavior Record should which open update durable extract policy';",
    "export const agentSurfaceLanguage = 'Use Work Doc Codex Claude Gemini';",
    "",
  ].join("\n"),
);
writeFileSync(
  path.join(root, "README.md"),
  [
    "# smoke-krow",
    "",
    "Stories are collected views over captured records.",
    "Plugins are lifecycle extensions that use stored context.",
    "",
  ].join("\n"),
);

const agentRoot = mkdtempSync(path.join(tmpdir(), "krow-v2-agents-"));
run(["init", "--agents", "codex,claude,gemini", "--root", agentRoot]);
for (const relativePath of [
  ".codex/skills/work/SKILL.md",
  ".codex/skills/check/SKILL.md",
  ".claude/commands/work.md",
  ".claude/commands/check.md",
  ".gemini/commands/work.toml",
  ".gemini/commands/check.toml",
]) {
  if (!existsSync(path.join(agentRoot, relativePath))) {
    throw new Error(`missing agent surface: ${relativePath}`);
  }
}

const check = readJson(run(["check", "--root", root, "--about", [
  "Smoke project with Story and Plugin concepts.",
  "Behavior and Record are not first-class System Documents.",
  "Revision words like should, which, open, source, update, durable, extract, and policy are not concept names.",
  "Use source code as evidence, create Work Doc artifacts, and support Codex, Claude, and Gemini agent surfaces.",
].join(" ")]));
assertExists(check.check.reportRef);
assertExists(check.check.observedRef);
assertExists(check.check.evidenceRef);
assertExists(check.check.readingPlanRef);
assertExists(check.check.understandingRef);
assertExists(check.check.proposalsRef);
assertExists(check.check.questionsRef);
assertExists(check.check.draftRef);
assertExists(check.check.decisionsRef);
const checkProposal = JSON.parse(readFileSync(path.join(root, check.check.proposalsRef), "utf8"));
if (!checkProposal.understanding || !Array.isArray(checkProposal.understanding.entrypoints)) {
  throw new Error("check proposals should include repository understanding before agent drafting");
}
if (checkProposal.stage !== "agent-draft-required") {
  throw new Error("check should wait for an agent-authored proposal before approval");
}
if (!Array.isArray(checkProposal.systemDocuments) || checkProposal.systemDocuments.length !== 0) {
  throw new Error("check should not synthesize System Document drafts from raw strings");
}
const draftIds = new Set(checkProposal.systemDocuments.map((document) => document.id));
for (const noisyId of [
  "DOC:story",
  "DOC:plugin",
  "DOC:behavior",
  "DOC:record",
  "DOC:should",
  "DOC:which",
  "DOC:open",
  "DOC:source",
  "DOC:update",
  "DOC:durable",
  "DOC:extract",
  "DOC:policy",
  "DOC:the",
  "DOC:use",
  "DOC:doc",
  "DOC:codex",
  "DOC:claude",
  "DOC:gemini",
]) {
  if (draftIds.has(noisyId)) {
    throw new Error(`check should not promote revision guidance into ${noisyId}`);
  }
}
const agentProposal = {
  ...checkProposal,
  stage: "ready-for-approval",
  subjects: [{
    key: "smoke-krow",
    title: "Smoke Krow",
    aliases: [],
    evidence: ["package.json", "src/cli.ts"],
    symbols: ["main"],
    kind: "subject",
    layer: "product",
    evidenceKinds: ["agent-read"],
    means: "The smoke repository exposes a small CLI package used by the test.",
  }],
  systemDocuments: [{
    id: "DOC:smoke-krow",
    title: "Smoke Krow",
    kind: "Responsibility Area",
    status: "proposed",
    summary: "The smoke repository exposes a small CLI package used by the test.",
    terms: ["TERM:smoke-krow"],
    references: ["Source: package.json", "Source: src/cli.ts"],
    sourceSubjectKey: "smoke-krow",
    statements: [{
      id: "STMT:smoke-krow.summary",
      title: "Smoke Krow Summary",
      status: "proposed",
      statement: "The smoke repository exposes a small CLI package used by the test.",
      terms: ["TERM:smoke-krow"],
      references: ["Source: package.json", "Source: src/cli.ts"],
      notes: ["Drafted by the smoke test as an agent-authored proposal."],
    }],
  }],
};
writeFileSync(path.join(root, check.check.proposalsRef), `${JSON.stringify(agentProposal, null, 2)}\n`);
const decisionBuild = readJson(run(["check-decisions", check.check.checkId, "--root", root]));
if (!Array.isArray(decisionBuild.checkDecisions.decisions) || decisionBuild.checkDecisions.decisions.length === 0) {
  throw new Error("check-decisions should turn completed proposals into approval prompts");
}
assertExists(decisionBuild.checkDecisions.decisionsRef);
const unsafeDecision = decisionBuild.checkDecisions.decisions[0];
const unsafeApply = readJson(run(["check-apply", check.check.checkId, JSON.stringify([{
  decisionId: unsafeDecision.id,
  selectedOptionId: "revise",
  customInput: JSON.stringify({
    key: "manual-extra-doc",
    summary: "This tries to create a new durable document through an existing decision.",
  }),
}]), "--root", root]));
if (!unsafeApply.applied.skipped.some((item) => item.includes("revise cannot change decision identity"))) {
  throw new Error("check-apply should reject revisions that create a new System Document identity");
}
assertMissing(".krow/system/docs/manual-extra-doc.md");
const approveAnswers = decisionBuild.checkDecisions.decisions.map((decision) => ({
  decisionId: decision.id,
  selectedOptionId: "approve",
}));
const applied = readJson(run(["check-apply", check.check.checkId, JSON.stringify(approveAnswers), "--root", root]));
assertExists(applied.applied.reportRef);
const systemMap = readFileSync(path.join(root, ".krow/system/map.md"), "utf8");
if (!systemMap.includes("## System Documents") || !systemMap.includes("DOC:")) {
  throw new Error("check-apply should update the System Map with approved System Documents");
}
if (systemMap.includes("Smoke project with story and plugin concepts")) {
  throw new Error("System Map should not promote check about input into repository purpose");
}
const approvedDocRef = agentProposal.systemDocuments[0].id.replace(/^DOC:/, "");
assertExists(`.krow/system/docs/${approvedDocRef}.md`);

const work = readJson(run(["work", "Add smoke behavior", "--root", root, "--work-id", "smoke-work"]));
assertExists(".krow/work/smoke-work/index.md");
assertExists(".krow/work/smoke-work/prd.md");
assertExists(".krow/work/smoke-work/spec.md");
assertExists(".krow/work/smoke-work/plan.md");
assertExists(".krow/work/smoke-work/tasks/task-001.md");
assertExists(".krow/work/smoke-work/review.md");
if (!work.statePath || !existsSync(work.statePath)) {
  throw new Error("work command did not create workflow state");
}
if (work.projectUnderstanding.ready !== true) {
  throw new Error("work command should report approved project understanding after check-apply");
}
const workIndex = readFileSync(path.join(root, ".krow/work/smoke-work/index.md"), "utf8");
if (workIndex.includes("TERM:<id>") || workIndex.includes("DOC:<id>") || workIndex.includes("Related Terms")) {
  throw new Error("generated Work Docs should not include ungrounded related-term placeholders");
}

const glossary = readFileSync(path.join(root, ".krow/system/glossary.md"), "utf8");
if (!glossary.startsWith("# Glossary")) {
  throw new Error("initial glossary file is invalid");
}

process.stdout.write(`v2 smoke passed: ${root}\n`);
