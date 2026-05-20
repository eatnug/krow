import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const cliPath = path.join(repoRoot, "dist", "cli.js");

function runCli(args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function read(rootDir, ref) {
  return readFileSync(path.join(rootDir, ref), "utf8");
}

test("init renders packaged agent surface templates", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "krow-agent-surfaces-"));

  runCli(["init", "--agents", "codex,claude,gemini", "--root", rootDir]);

  const refs = [
    ".codex/skills/work/SKILL.md",
    ".codex/skills/check/SKILL.md",
    ".claude/commands/work.md",
    ".claude/commands/check.md",
    ".gemini/commands/work.toml",
    ".gemini/commands/check.toml",
  ];

  for (const ref of refs) {
    assert.ok(existsSync(path.join(rootDir, ref)), `${ref} should exist`);
    const content = read(rootDir, ref);
    assert.match(content, /Managed by krow init/);
    assert.match(content, /npx --yes krow-cli@latest/);
    assert.doesNotMatch(content, /\{\{WORK_LOOP\}\}/);
    assert.doesNotMatch(content, /\{\{CHECK_LOOP\}\}/);
    assert.doesNotMatch(content, /\{\{KROW_COMMAND\}\}/);
    assert.doesNotMatch(content, /\{\{MANAGED_MARKER\}\}/);
  }
});
