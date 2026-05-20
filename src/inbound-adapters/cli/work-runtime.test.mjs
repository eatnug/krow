import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const cliPath = path.join(repoRoot, "dist", "cli.js");

function runCli(args, options = {}) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      KROW_SUBMIT_COMMAND_PREFIX: `node ${cliPath}`,
      ...options.env,
    },
  });
}

function runJson(args) {
  return JSON.parse(runCli(args));
}

function writeJson(rootDir, ref, value) {
  const filePath = path.join(rootDir, ref);
  writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("work runtime advances plan -> implement -> review -> done", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "krow-work-runtime-"));

  runCli(["init", "--agents", "none", "--root", rootDir]);

  const planAction = runJson([
    "work",
    "start",
    "Add test behavior",
    "--work-id",
    "runtime-test",
    "--root",
    rootDir,
    "--json",
  ]);

  assert.equal(planAction.type, "run");
  assert.equal(planAction.output.kind, "plan_output");
  assert.ok(planAction.context.includes(".krow/work/runtime-test/goal.md"));
  assert.ok(planAction.context.includes(".krow/system/glossary.md"));
  assert.ok(existsSync(path.join(rootDir, ".krow/work/runtime-test/index.md")));
  assert.ok(existsSync(path.join(rootDir, ".krow/work/runtime-test/goal.md")));
  assert.ok(existsSync(path.join(rootDir, ".krow/work/runtime-test/spec.md")));
  assert.ok(existsSync(path.join(rootDir, ".krow/work/runtime-test/plan.md")));
  assert.ok(existsSync(path.join(rootDir, ".krow/work/runtime-test/review.md")));
  assert.deepEqual(
    readdirSync(path.join(rootDir, ".krow/work/runtime-test")).sort(),
    ["goal.md", "index.md", "plan.md", "review.md", "spec.md"],
  );

  writeJson(rootDir, planAction.output.path, {
    ready: true,
    docs: {
      goal: ".krow/work/runtime-test/goal.md",
      spec: ".krow/work/runtime-test/spec.md",
      plan: ".krow/work/runtime-test/plan.md",
    },
    summary: "Plan is ready.",
    evidence: ["test"],
    tasks: [],
    questions: [],
  });

  const implementAction = runJson([
    "work",
    "submit",
    "runtime-test",
    "--input",
    planAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(implementAction.type, "run");
  assert.equal(implementAction.output.kind, "implement_output");

  writeJson(rootDir, implementAction.output.path, {
    summary: "Implementation completed.",
    changed_files: [],
    evidence: ["test"],
    questions: [],
  });

  const reviewAction = runJson([
    "work",
    "submit",
    "runtime-test",
    "--input",
    implementAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(reviewAction.type, "run");
  assert.equal(reviewAction.output.kind, "review_output");

  writeJson(rootDir, reviewAction.output.path, {
    passed: true,
    summary: "Review passed.",
    evidence: ["test"],
    issues: [],
    language_updates: [],
    questions: [],
  });

  const doneAction = runJson([
    "work",
    "submit",
    "runtime-test",
    "--input",
    reviewAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(doneAction.type, "done");
  assert.equal(doneAction.status, "completed");

  const state = JSON.parse(readFileSync(path.join(rootDir, ".krow/state/workflows/runtime-test/state.json"), "utf8"));
  assert.equal(state.phase, "review");
  assert.equal(state.status, "completed");
  assert.deepEqual(state.language_context.refs, [".krow/system/glossary.md", ".krow/system/map.md"]);
});

test("review language updates require approval before durable system writes", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "krow-language-approval-"));

  runCli(["init", "--agents", "none", "--root", rootDir]);

  const planAction = runJson([
    "work",
    "start",
    "Name payment retry behavior",
    "--work-id",
    "language-approval",
    "--root",
    rootDir,
    "--json",
  ]);

  writeJson(rootDir, planAction.output.path, {
    ready: true,
    docs: {
      goal: ".krow/work/language-approval/goal.md",
      spec: ".krow/work/language-approval/spec.md",
      plan: ".krow/work/language-approval/plan.md",
    },
    summary: "Plan is ready.",
    evidence: ["src/payment.ts"],
    tasks: [],
    questions: [],
  });

  const implementAction = runJson([
    "work",
    "submit",
    "language-approval",
    "--input",
    planAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);

  writeJson(rootDir, implementAction.output.path, {
    summary: "Implementation completed.",
    changed_files: ["src/payment.ts"],
    evidence: ["src/payment.ts"],
    questions: [],
  });

  const reviewAction = runJson([
    "work",
    "submit",
    "language-approval",
    "--input",
    implementAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);

  writeJson(rootDir, reviewAction.output.path, {
    passed: true,
    summary: "Review passed.",
    evidence: ["npm test"],
    issues: [],
    language_updates: [{
      kind: "term",
      title: "Payment Retry",
      summary: "Payment Retry is the approved project term for retrying failed payment attempts.",
      evidence: ["src/payment.ts"],
    }],
    questions: [],
  });

  const approvalAction = runJson([
    "work",
    "submit",
    "language-approval",
    "--input",
    reviewAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(approvalAction.type, "ask");
  assert.equal(approvalAction.questions[0].id, "language-update-1");
  assert.ok(existsSync(path.join(rootDir, ".krow/work/language-approval/language-updates.md")));
  assert.ok(existsSync(path.join(rootDir, ".krow/system/language-update-proposals.md")));
  assert.doesNotMatch(readFileSync(path.join(rootDir, ".krow/system/glossary.md"), "utf8"), /Payment Retry/);

  writeJson(rootDir, approvalAction.output.path, {
    answers: [{
      question_id: "language-update-1",
      answer: "approve",
    }],
  });

  const doneAction = runJson([
    "work",
    "submit",
    "language-approval",
    "--input",
    approvalAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(doneAction.type, "done");
  assert.equal(doneAction.status, "completed");

  const glossary = readFileSync(path.join(rootDir, ".krow/system/glossary.md"), "utf8");
  assert.match(glossary, /## Payment Retry/);
  assert.match(glossary, /Status: Approved/);
  assert.match(glossary, /src\/payment\.ts/);

  const state = JSON.parse(readFileSync(path.join(rootDir, ".krow/state/workflows/language-approval/state.json"), "utf8"));
  assert.deepEqual(state.language_update_refs, [".krow/system/glossary.md"]);
});

test("task graph validation enforces ownership and exposes ready task docs", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "krow-task-graph-"));

  runCli(["init", "--agents", "none", "--root", rootDir]);

  const planAction = runJson([
    "work",
    "start",
    "Split large work",
    "--work-id",
    "task-graph",
    "--root",
    rootDir,
    "--json",
  ]);

  writeJson(rootDir, planAction.output.path, {
    ready: true,
    docs: {
      goal: ".krow/work/task-graph/goal.md",
      spec: ".krow/work/task-graph/spec.md",
      plan: ".krow/work/task-graph/plan.md",
    },
    summary: "Invalid overlapping plan.",
    evidence: ["plan"],
    tasks: [
      {
        id: "api",
        title: "API",
        scope: "Update API",
        files: ["src/shared.ts"],
        expected_output: "API change",
      },
      {
        id: "web",
        title: "Web",
        scope: "Update web",
        files: ["src/shared.ts"],
        expected_output: "Web change",
      },
    ],
    questions: [],
  });

  const faultAction = runJson([
    "work",
    "submit",
    "task-graph",
    "--input",
    planAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(faultAction.type, "fault");
  assert.match(faultAction.issues.join("\n"), /both own src\/shared\.ts without a merge_plan/);

  writeJson(rootDir, planAction.output.path, {
    ready: true,
    docs: {
      goal: ".krow/work/task-graph/goal.md",
      spec: ".krow/work/task-graph/spec.md",
      plan: ".krow/work/task-graph/plan.md",
      tasks: ".krow/work/task-graph/tasks/index.md",
    },
    summary: "Valid split plan.",
    evidence: ["plan"],
    tasks: [
      {
        id: "api",
        title: "API",
        scope: "Update API",
        files: ["src/api.ts"],
        expected_output: "API change",
      },
      {
        id: "web",
        title: "Web",
        scope: "Update web",
        files: ["src/web.ts"],
        expected_output: "Web change",
      },
    ],
    questions: [],
  });

  const implementAction = runJson([
    "work",
    "submit",
    "task-graph",
    "--input",
    planAction.output.path,
    "--root",
    rootDir,
    "--json",
  ]);
  assert.equal(implementAction.type, "run");
  assert.equal(implementAction.output.kind, "implement_output");
  assert.match(implementAction.instruction, /Ready task ids: api, web/);
  assert.ok(implementAction.context.includes(".krow/work/task-graph/tasks/index.md"));
  assert.ok(implementAction.context.includes(".krow/work/task-graph/tasks/api.md"));
  assert.ok(implementAction.context.includes(".krow/work/task-graph/tasks/web.md"));

  const apiTask = readFileSync(path.join(rootDir, ".krow/work/task-graph/tasks/api.md"), "utf8");
  assert.match(apiTask, /Expected Output:\nAPI change/);

  const state = JSON.parse(readFileSync(path.join(rootDir, ".krow/state/workflows/task-graph/state.json"), "utf8"));
  assert.deepEqual(state.tasks.map((task) => [task.id, task.status]), [["api", "ready"], ["web", "ready"]]);
});
