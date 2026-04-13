#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "Managed by krow init";

const CODEX_KROW_SKILL = `---
name: krow
description: Primary krow entry skill for actionable engineering work. Use only when the user explicitly invokes \`$krow\` to request code, files, tests, config, or other artifacts to be created, fixed, refactored, removed, investigated, or verified.
---

<!-- ${MANAGED_MARKER} -->

# krow

Treat the current user message as explicit work intent.

## Startup

Run: \`npx krow intake --intent work "$ARGUMENTS"\`

If $ARGUMENTS is empty, ask the user what they want to do first.

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run: \`npx krow start --intent work "<refined request>"\`

If intake is not blocked, run: \`npx krow start --intent work "$ARGUMENTS"\`

## Loop

1. Parse the JSON response from the last krow command.
2. If the response is an intake result with \`blockedByQuestions\`, gather the bundled answers and rerun \`start --intent work\` with a refined request.
3. Otherwise, check the \`type\` field and act accordingly:

### type = "run"
- Read \`state_ref\` before acting.
- Read \`workflow_task_index_ref\`, \`task_packet_ref\`, and any \`relay_refs\` before acting.
- Use \`phase\`, \`prompt_ref\`, \`required_schema\`, and \`instructions\` as the contract.
- Spawn an Agent for this phase. DO NOT execute the phase yourself.
- Tool policy by phase:
  - \`clarify\`: Read, Grep, Glob, Bash(git *), Bash(ls *), Bash(cat *), Bash(rg *), Agent
  - \`execute\`: Read, Grep, Glob, Edit, Write, Bash, Agent
  - \`verify\`: Read, Grep, Glob, Bash, Agent
  - \`capture\`: Read, Grep, Glob, Edit, Write, Bash, Agent
- In \`clarify\`, gather evidence first, list the concrete evidence you used, and turn the success condition into explicit acceptance criteria for the unit before returning ready=true.
- In \`execute\`, complete only the current unit. If the workflow state shows multiple ready sibling units with disjoint ownership, use that as host-level scheduling metadata for bounded subagents or parallel runs; do not silently merge sibling units into one payload.
- In \`verify\`, try to disprove the claimed result. Do not silently edit files during verification. Always include concrete checks, evidence, and any unverified claims in the payload.
- In \`capture\`, write only durable reusable learnings.
- Wait for the Agent result.
- Extract the JSON output from the Agent response.
- Run: \`npx krow submit-phase <workflow_id> <phase> '<JSON>'\`, replacing placeholders from the signal and minifying JSON first.

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, run \`npx krow submit-decisions <workflow_id> '<JSON>'\`, then run \`npx krow resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`npx krow next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Always pass JSON as a single-quoted string in commands.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
`;

const CLAUDE_KROW_COMMAND = `---
description: Run actionable engineering work through the krow harness.
argument-hint: "<request>"
arguments:
  - request
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent
---

<!-- ${MANAGED_MARKER} -->

# krow

Treat \`$request\` as explicit work intent.

## Startup

If no request was supplied, ask the user what they want to do first.

Otherwise, run: \`npx krow intake --intent work "$request"\`

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run: \`npx krow start --intent work "<refined request>"\`

If intake is not blocked, run: \`npx krow start --intent work "$request"\`

## Loop

1. Parse the JSON response from the last krow command.
2. If the response is an intake result with \`blockedByQuestions\`, gather the bundled answers and rerun \`start --intent work\` with a refined request.
3. Otherwise, check the \`type\` field and act accordingly:

### type = "run"
- Read \`state_ref\` before acting.
- Read \`workflow_task_index_ref\`, \`task_packet_ref\`, and any \`relay_refs\` before acting.
- Use \`phase\`, \`prompt_ref\`, \`required_schema\`, and \`instructions\` as the contract.
- Spawn an Agent for this phase. DO NOT execute the phase yourself.
- Tool policy by phase:
  - \`clarify\`: Read, Grep, Glob, Bash(git *), Bash(ls *), Bash(cat *), Bash(rg *), Agent
  - \`execute\`: Read, Grep, Glob, Edit, Write, Bash, Agent
  - \`verify\`: Read, Grep, Glob, Bash, Agent
  - \`capture\`: Read, Grep, Glob, Edit, Write, Bash, Agent
- In \`clarify\`, gather evidence first, list the concrete evidence you used, and turn the success condition into explicit acceptance criteria for the unit before returning ready=true.
- In \`execute\`, complete only the current unit. If the workflow state shows multiple ready sibling units with disjoint ownership, use that as host-level scheduling metadata for bounded subagents or parallel runs; do not silently merge sibling units into one payload.
- In \`verify\`, try to disprove the claimed result. Do not silently edit files during verification. Always include concrete checks, evidence, and any unverified claims in the payload.
- In \`capture\`, write only durable reusable learnings.
- Wait for the Agent result.
- Extract the JSON output from the Agent response.
- Run: \`npx krow submit-phase <workflow_id> <phase> '<JSON>'\`, replacing placeholders from the signal and minifying JSON first.

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, run \`npx krow submit-decisions <workflow_id> '<JSON>'\`, then run \`npx krow resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`npx krow next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Always pass JSON as a single-quoted string in commands.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
`;

const GEMINI_KROW_COMMAND = `# ${MANAGED_MARKER}

description = "Run actionable engineering work through the krow harness."

prompt = """
Treat {{args}} as explicit work intent.

## Startup

If no arguments were supplied, ask the user what they want to do first.

Otherwise, run via run_shell_command: \`npx krow intake --intent work "{{args}}"\`

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run via run_shell_command: \`npx krow start --intent work "<refined request>"\`

If intake is not blocked, run via run_shell_command: \`npx krow start --intent work "{{args}}"\`

## Loop

1. Parse the JSON response from the last krow command.
2. If the response is an intake result with \`blockedByQuestions\`, gather the bundled answers and rerun \`start --intent work\` with a refined request.
3. Otherwise, check the \`type\` field and act accordingly:

### type = "run"
- Read \`state_ref\` before acting.
- Read \`workflow_task_index_ref\`, \`task_packet_ref\`, and any \`relay_refs\` before acting.
- Use \`phase\`, \`prompt_ref\`, \`required_schema\`, and \`instructions\` as the contract.
- Tool policy by phase:
  - \`clarify\`: use read_file, grep_search, list_directory, and run_shell_command only for read-only inspection
  - \`execute\`: use read_file, grep_search, list_directory, edit_file, write_file, and run_shell_command
  - \`verify\`: use read_file, grep_search, list_directory, and run_shell_command; do not silently edit files
  - \`capture\`: use read_file, grep_search, list_directory, edit_file, write_file, and run_shell_command only for durable knowledge capture
- In \`clarify\`, gather evidence first, list the concrete evidence you used, and turn the success condition into explicit acceptance criteria for the unit before returning ready=true.
- In \`execute\`, complete only the current unit. If the workflow state shows other ready sibling units, use that graph metadata for host scheduling; if the host cannot parallelize them, process the ready units step by step without skipping transitions.
- In \`verify\`, try to disprove the claimed result before accepting it. Always include concrete checks, evidence, and any unverified claims.
- When the phase work is complete, collect your result as one JSON object matching \`required_schema\`.
- Run via run_shell_command: \`npx krow submit-phase <workflow_id> <phase> '<JSON>'\`, replacing placeholders from the signal and minifying JSON first.

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, run \`npx krow submit-decisions <workflow_id> '<JSON>'\` via run_shell_command, then run \`npx krow resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`npx krow next <workflow_id>\` via run_shell_command when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Always pass JSON as a single-quoted string in commands.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
"""
`;

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  krow init [--force] [-g | --global] [--home <dir>]",
      "  krow remove [-g | --global] [--home <dir>]",
      "",
      "Commands:",
      "  init      Install Codex $krow, Claude Code /krow, and Gemini CLI /krow wrappers",
      "  remove    Remove installed Codex, Claude Code, and Gemini CLI wrappers",
      "",
      "Flags:",
      "  --force         Overwrite managed files even if they already exist",
      "  -g, --global    Install to / remove from home directory (global)",
      "  --home <dir>    Target directory override",
    ].join("\n") + "\n",
  );
}

function parseArgs(argv) {
  const command = argv[0];
  let force = false;
  let global = false;
  let home = null;

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force") {
      force = true;
      continue;
    }
    if (value === "--global" || value === "-g") {
      global = true;
      continue;
    }
    if (value === "--home" && argv[index + 1]) {
      home = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return { command, force, global, home };
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

export async function runInit({ force, global: isGlobal, home }) {
  if (home == null) {
    home = isGlobal ? os.homedir() : process.cwd();
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");

  const targets = [
    {
      label: "Codex $krow skill",
      path: path.join(home, ".codex", "skills", "krow", "SKILL.md"),
      content: CODEX_KROW_SKILL,
    },
    {
      label: "Claude Code /krow command",
      path: path.join(home, ".claude", "commands", "krow.md"),
      content: CLAUDE_KROW_COMMAND,
    },
    {
      label: "Gemini CLI /krow command",
      path: path.join(home, ".gemini", "commands", "krow.toml"),
      content: GEMINI_KROW_COMMAND,
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

export async function runRemove({ global: isGlobal, home }) {
  if (home == null) {
    home = isGlobal ? os.homedir() : process.cwd();
  }

  const targets = [
    {
      label: "Codex $krow skill",
      path: path.join(home, ".codex", "skills", "krow", "SKILL.md"),
    },
    {
      label: "Claude Code /krow command",
      path: path.join(home, ".claude", "commands", "krow.md"),
    },
    {
      label: "Gemini CLI /krow command",
      path: path.join(home, ".gemini", "commands", "krow.toml"),
    },
  ];

  const results = [];
  for (const target of targets) {
    const exists = await pathExists(target.path);
    if (!exists) {
      results.push({ ...target, status: "skipped (not found)" });
      continue;
    }

    const content = await fs.readFile(target.path, "utf8");
    if (!content.includes(MANAGED_MARKER)) {
      results.push({ ...target, status: "skipped (not managed by krow)" });
      continue;
    }

    await fs.unlink(target.path);
    results.push({ ...target, status: "removed" });

    // Try to remove empty parent directories
    let dir = path.dirname(target.path);
    while (dir !== home && dir !== path.dirname(dir)) {
      try {
        await fs.rmdir(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
  }

  process.stdout.write(
    [
      `Remove targets in ${home}`,
      ...results.map((result) => `${result.status}: ${result.label} -> ${result.path}`),
    ].join("\n") + "\n",
  );
}

export async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "init") {
    await runInit(parsed);
    return;
  }
  if (parsed.command === "remove") {
    await runRemove(parsed);
    return;
  }

  printUsage();
  process.exitCode = parsed.command ? 1 : 0;
}

const isDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
