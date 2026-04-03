#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "Managed by krow init";

const CODEX_WORK_SKILL = `---
name: work
description: Explicit work-intake skill for actionable engineering tasks. Use only when the user explicitly invokes \`$work\` to request code, files, tests, config, or other artifacts to be created, fixed, refactored, removed, investigated, or verified.
---

<!-- ${MANAGED_MARKER} -->

# Work

Treat the current user message as explicit work intent.

## Startup

Run: \`npx krow start "$ARGUMENTS"\`

If $ARGUMENTS is empty, ask the user what they want to do first.

## Loop

1. Parse the JSON response from the last krow command.
2. Check the \`type\` field and act accordingly:

### type = "phase"
- Spawn an Agent for this phase. DO NOT execute the prompt yourself — always delegate to a subagent.
- Agent prompt: the \`prompt\` field.
- Agent tools based on \`capability\`:
  - "read": Read, Grep, Glob, Bash(git *), Bash(ls *), Bash(cat *)
  - "write": Read, Grep, Glob, Edit, Write, Bash
  - "full": all tools
- Wait for the agent to return its result.
- Extract the JSON output from the agent's response.
- Run the command in \`onComplete\`, replacing \`'<JSON>'\` with the minified JSON (single-quoted).

### type = "batch"
- Spawn ALL agents in parallel (send multiple Agent tool calls in a single message).
- Each entry in \`responses\` is a phase response — spawn one agent per entry.
- Apply the same capability-based tool restrictions to each agent.
- As each agent completes, run its \`onComplete\` command with the JSON result.

### type = "gate"
- If \`gate\` = "clarify": Present each decision in \`decisions\` to the user. Collect their answers. Run \`onComplete\` with the answers JSON.
- If \`gate\` = "plan": Present \`tasks\`, \`approach\`, and \`risks\` to the user. If they approve, run the approve command in \`onComplete\`. If they want changes, run the adjust command mentioned in \`instructions\`.
- If \`gate\` = "verify": A task has failed verification multiple times. Present \`lastIssues\` and \`verifyAttempts\` to the user. Follow the \`instructions\` field — it contains the continue and stop commands.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review the \`issues\` and retry.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- NEVER execute phase prompts yourself. ALWAYS spawn an Agent.
- NEVER skip the orchestrator commands. Every phase transition goes through krow.
- Always pass JSON as a single-quoted string in commands.
- Minify JSON before passing to commands (no newlines).
- For batch responses, spawn all agents in a SINGLE message to maximize parallelism.
`;

const CLAUDE_WORK_COMMAND = `---
description: Run explicit engineering work through a structured 4-phase harness.
argument-hint: "<request>"
arguments:
  - request
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent
---

<!-- ${MANAGED_MARKER} -->

# Work

Treat \`$request\` as explicit work intent.

## Startup

If no request was supplied, ask the user what they want to do first.

Otherwise, run: \`npx krow start "$request"\`

## Loop

1. Parse the JSON response from the last krow command.
2. Check the \`type\` field and act accordingly:

### type = "phase"
- Spawn an Agent for this phase. DO NOT execute the prompt yourself — always delegate to a subagent.
- Agent prompt: the \`prompt\` field.
- Agent tools based on \`capability\`:
  - "read": Read, Grep, Glob, Bash(git *), Bash(ls *), Bash(cat *)
  - "write": Read, Grep, Glob, Edit, Write, Bash
  - "full": all tools
- Wait for the agent to return its result.
- Extract the JSON output from the agent's response.
- Run the command in \`onComplete\`, replacing \`'<JSON>'\` with the minified JSON (single-quoted).

### type = "batch"
- Spawn ALL agents in parallel (send multiple Agent tool calls in a single message).
- Each entry in \`responses\` is a phase response — spawn one agent per entry.
- Apply the same capability-based tool restrictions to each agent.
- As each agent completes, run its \`onComplete\` command with the JSON result.

### type = "gate"
- If \`gate\` = "clarify": Present each decision in \`decisions\` to the user. Collect their answers. Run \`onComplete\` with the answers JSON.
- If \`gate\` = "plan": Present \`tasks\`, \`approach\`, and \`risks\` to the user. If they approve, run the approve command in \`onComplete\`. If they want changes, run the adjust command mentioned in \`instructions\`.
- If \`gate\` = "verify": A task has failed verification multiple times. Present \`lastIssues\` and \`verifyAttempts\` to the user. Follow the \`instructions\` field — it contains the continue and stop commands.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review the \`issues\` and retry.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- NEVER execute phase prompts yourself. ALWAYS spawn an Agent.
- NEVER skip the orchestrator commands. Every phase transition goes through krow.
- Always pass JSON as a single-quoted string in commands.
- Minify JSON before passing to commands (no newlines).
- For batch responses, spawn all agents in a SINGLE message to maximize parallelism.
`;

const GEMINI_WORK_COMMAND = `# ${MANAGED_MARKER}

description = "Run explicit engineering work through a structured 4-phase harness."

prompt = """
Treat {{args}} as explicit work intent.

## Startup

If no arguments were supplied, ask the user what they want to do first.

Otherwise, run via run_shell_command: \`npx krow start "{{args}}"\`

## Loop

1. Parse the JSON response from the last krow command.
2. Check the \`type\` field and act accordingly:

### type = "phase"
- Execute the phase yourself, but restrict the tools you use based on the \`capability\` field:
  - "read": only use read_file, grep_search, list_directory, and run_shell_command (limited to git and ls commands only)
  - "write": use read_file, grep_search, list_directory, edit_file, write_file, and run_shell_command
  - "full": use all available tools without restriction
- Follow the instructions in the \`prompt\` field.
- When the phase work is complete, collect your result as JSON.
- Run the command in \`onComplete\` via run_shell_command, replacing \`'<JSON>'\` with the minified JSON result (single-quoted).

### type = "batch"
- Process ALL entries in \`responses\` — each is a phase response.
- For each entry, apply the same capability-based tool restrictions described above.
- Execute each phase following its \`prompt\` field.
- As each phase completes, run its \`onComplete\` command via run_shell_command with the minified JSON result.

### type = "gate"
- If \`gate\` = "clarify": Present each decision in \`decisions\` to the user. Collect their answers. Run \`onComplete\` via run_shell_command with the answers JSON.
- If \`gate\` = "plan": Present \`tasks\`, \`approach\`, and \`risks\` to the user. If they approve, run the approve command in \`onComplete\` via run_shell_command. If they want changes, run the adjust command mentioned in \`instructions\`.
- If \`gate\` = "verify": A task has failed verification multiple times. Present \`lastIssues\` and \`verifyAttempts\` to the user. Follow the \`instructions\` field — it contains the continue and stop commands.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review the \`issues\` and retry.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- NEVER skip the orchestrator commands. Every phase transition goes through krow.
- Always pass JSON as a single-quoted string in commands.
- Minify JSON before passing to commands (no newlines).
- Respect capability-based tool restrictions strictly — do not use disallowed tools for a phase.
"""
`;

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  krow init [--force] [--home <dir>]",
      "",
      "Commands:",
      "  init    Install Codex $work, Claude Code /work, and Gemini CLI /work wrappers",
    ].join("\n") + "\n",
  );
}

function parseArgs(argv) {
  const command = argv[0];
  let force = false;
  let home = os.homedir();

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") {
      force = true;
      continue;
    }
    if (value === "--home" && argv[index + 1]) {
      home = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return { command, force, home };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeManagedFile(targetPath, content, force) {
  const exists = await pathExists(targetPath);

  if (exists) {
    const existing = await fs.readFile(targetPath, "utf8");
    if (existing === content) {
      return "unchanged";
    }
    if (!force && !existing.includes(MANAGED_MARKER)) {
      throw new Error(`Refusing to overwrite unmanaged file: ${targetPath}`);
    }
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return exists ? "updated" : "created";
}

async function runInit({ force, home }) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");

  const targets = [
    {
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
      content: CODEX_WORK_SKILL,
    },
    {
      label: "Claude Code /work command",
      path: path.join(home, ".claude", "commands", "work.md"),
      content: CLAUDE_WORK_COMMAND,
    },
    {
      label: "Gemini CLI /work command",
      path: path.join(home, ".gemini", "commands", "work.toml"),
      content: GEMINI_WORK_COMMAND,
    },
  ];

  const results = [];
  for (const target of targets) {
    const status = await writeManagedFile(target.path, target.content, force);
    results.push({ ...target, status });
  }

  process.stdout.write(
    [
      `Installed from ${packageRoot}`,
      ...results.map((result) => `${result.status}: ${result.label} -> ${result.path}`),
      "Restart Codex, Claude Code, and Gemini CLI, or reload skills/commands if they are already running.",
    ].join("\n") + "\n",
  );
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command !== "init") {
    printUsage();
    process.exitCode = parsed.command ? 1 : 0;
    return;
  }

  await runInit(parsed);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
