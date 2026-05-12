#!/usr/bin/env node

import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(path.join(tmpdir(), "krow-v2-smoke-"));
const cli = path.resolve("dist/cli.js");

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

const check = readJson(run(["check", "--root", root, "--about", "Smoke project with story and plugin concepts"]));
assertExists(check.check.reportRef);
assertExists(check.check.observedRef);
assertExists(check.check.draftRef);
assertExists(check.check.decisionsRef);
const checkDraft = JSON.parse(readFileSync(path.join(root, check.check.draftRef), "utf8"));
if (!checkDraft.understanding || !Array.isArray(checkDraft.understanding.entrypoints)) {
  throw new Error("check draft should include repository understanding before System Document drafts");
}
if (!Array.isArray(checkDraft.systemDocuments) || checkDraft.systemDocuments.length === 0) {
  throw new Error("check draft should include System Document drafts");
}
const draftIds = new Set(checkDraft.systemDocuments.map((document) => document.id));
if (!draftIds.has("DOC:story") || !draftIds.has("DOC:plugin")) {
  throw new Error("check should promote user-seeded terms with repository evidence into explicit decisions");
}
const unsafeDecision = check.check.decisions[0];
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
const approveAnswers = check.check.decisions.map((decision) => ({
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
const approvedDocRef = checkDraft.systemDocuments[0].id.replace(/^DOC:/, "");
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
  throw new Error("glossary seed is invalid");
}

process.stdout.write(`v2 smoke passed: ${root}\n`);
