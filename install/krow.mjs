#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "Managed by krow init";
const KROW_COMMAND_PLACEHOLDER = "__KROW_COMMAND__";
const BOOTSTRAP_RELATIVE_PATH = [".krow", "bin", "krow-bootstrap.mjs"];
const RUNTIME_DIST_RELATIVE_PATH = [".krow", "runtime", "dist"];
const PROJECT_LANGUAGE_RELATIVE_PATH = [".krow", "language.md"];

const PROJECT_LANGUAGE = `# Project Language

This file defines the approved local language for this codebase.
`;

const KROW_BOOTSTRAP = `#!/usr/bin/env node

// ${MANAGED_MARKER}

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bootstrapDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeCliPath = path.resolve(bootstrapDir, "../runtime/dist/cli.js");

const result = spawnSync(process.execPath, [runtimeCliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error && result.error.code === "ENOENT") {
  process.stderr.write(
    "krow runtime is missing. Re-run 'npx krow-cli init --force' to refresh the local install.\\n",
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
`;

function shellQuote(value) {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bootstrapPath(home) {
  return path.join(home, ...BOOTSTRAP_RELATIVE_PATH);
}

function runtimeDistTargetPath(home) {
  return path.join(home, ...RUNTIME_DIST_RELATIVE_PATH);
}

function krowCommand(home) {
  return `node ${shellQuote(bootstrapPath(home))}`;
}

function renderManagedContent(template, home) {
  return template.split(KROW_COMMAND_PLACEHOLDER).join(krowCommand(home));
}

const CODEX_KROW_SKILL = `---
name: krow
description: Primary krow entry skill for actionable engineering work. Use only when the user explicitly invokes \`$krow\` to request code, files, tests, config, or other artifacts to be created, fixed, refactored, removed, investigated, or verified.
---

<!-- ${MANAGED_MARKER} -->

# krow

Treat the current user message as explicit work intent.

## Startup

Run: \`${KROW_COMMAND_PLACEHOLDER} intake --intent work "$ARGUMENTS"\`

If $ARGUMENTS is empty, ask the user what they want to do first.

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "<refined request>"\`

If intake is not blocked, run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "$ARGUMENTS"\`

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
- Run this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, then run:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is the approved local language for the target codebase. Read it when wording, domain terms, or module names matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
`;

const CODEX_WORK_SKILL = `---
name: work
description: Explicit work-intake skill for actionable engineering tasks. Use only when the user explicitly invokes \`$work\` to request code, files, tests, config, or other artifacts to be created, fixed, refactored, removed, investigated, or verified.
---

<!-- ${MANAGED_MARKER} -->

# Work

Treat the current user message as explicit work intent.

## Startup

Run: \`${KROW_COMMAND_PLACEHOLDER} intake --intent work "$ARGUMENTS"\`

If $ARGUMENTS is empty, ask the user what they want to do first.

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "<refined request>"\`

If intake is not blocked, run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "$ARGUMENTS"\`

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
- Wait for the agent to return its result.
- Extract the JSON output from the agent's response.
- Run this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, then run:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is the approved local language for the target codebase. Read it when wording, domain terms, or module names matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
`;

const CODEX_LANGUAGE_MAP_SKILL = `---
name: language-map
description: Map the current codebase or requested scope into the project's approved local language, then report missing glossary terms, naming drift, and language gaps. Use only when the user explicitly invokes \`$language-map\` or asks to map/sync/describe code in the project language.
---

<!-- ${MANAGED_MARKER} -->

# Language Map

Describe the target codebase or requested scope using the project's approved local language.

## Startup

If $ARGUMENTS is empty, map from the repository's likely app entrypoints and major module surfaces.

First read \`.krow/language.md\` if it exists.

Build this normalized request:

\`\`\`text
Map the requested codebase or scope into the approved project-local language.

Scope:
<ARGUMENTS, or repository entrypoints and major module surfaces if empty>

Acceptance criteria:
- Read .krow/language.md first when it exists.
- Inspect concrete code evidence before naming a term, module role, or flow.
- Describe the codebase in controlled project-language sentences grouped by flow or module chunk.
- Identify language gaps: missing canonical terms, duplicate names for the same concept, one name used for conflicting concepts, important flows not represented in .krow/language.md, and local architecture patterns worth naming.
- Do not bulk-fill .krow/language.md.
- Add to .krow/language.md only durable, evidence-backed terms that are clearly reusable.
- Keep uncertain proposals and drift findings in the task packet/result instead of promoting them.
- Do not make unrelated code changes.
\`\`\`

Run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "<normalized request>"\`

Then continue using the same Loop and Rules from the installed \`$krow\` skill. If those instructions are not already in context, read \`.codex/skills/krow/SKILL.md\` and follow its Loop section exactly.
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

Otherwise, run: \`${KROW_COMMAND_PLACEHOLDER} intake --intent work "$request"\`

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "<refined request>"\`

If intake is not blocked, run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "$request"\`

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
- Run this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, then run:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is the approved local language for the target codebase. Read it when wording, domain terms, or module names matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
`;

const GEMINI_KROW_COMMAND = `# ${MANAGED_MARKER}

description = "Run actionable engineering work through the krow harness."

prompt = """
Treat {{args}} as explicit work intent.

## Startup

If no arguments were supplied, ask the user what they want to do first.

Otherwise, run via run_shell_command: \`${KROW_COMMAND_PLACEHOLDER} intake --intent work "{{args}}"\`

Parse the JSON response.

If \`blockedByQuestions\` is true or \`intake.questions\` is non-empty:
- Ask the user for the full bundled question set in one message.
- When the user answers, fold the original request plus their answers into one refined request.
- Run via run_shell_command: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "<refined request>"\`

If intake is not blocked, run via run_shell_command: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "{{args}}"\`

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
- Run via run_shell_command using this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": read \`state_ref\` and \`task_status_ref\`, present the bundled question set to the user in one message, collect the answers as one JSON object, then run via run_shell_command:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` via run_shell_command when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is the approved local language for the target codebase. Read it when wording, domain terms, or module names matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
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

async function writeSeedFile(targetPath, content) {
  const exists = await pathExists(targetPath);

  if (exists) {
    const existing = await fs.readFile(targetPath, "utf8");
    return existing === content ? "unchanged" : "skipped (already exists)";
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return "created";
}

async function installRuntime(packageRoot, home) {
  const sourceDir = path.join(packageRoot, "dist");
  const sourceCli = path.join(sourceDir, "cli.js");
  const targetDir = runtimeDistTargetPath(home);
  const existed = await pathExists(targetDir);

  if (!(await pathExists(sourceCli))) {
    throw new Error(
      `Missing built runtime at ${sourceCli}. Run 'npm run build' before using init from a source checkout.`,
    );
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  return {
    label: "krow runtime",
    path: targetDir,
    status: existed ? "updated" : "created",
  };
}

async function removePathIfExists(targetPath) {
  const exists = await pathExists(targetPath);
  if (!exists) {
    return "skipped (not found)";
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  return "removed";
}

export async function runInit({ force, global: isGlobal, home }) {
  if (home == null) {
    home = isGlobal ? os.homedir() : process.cwd();
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const results = [];
  const projectLanguagePath = path.join(home, ...PROJECT_LANGUAGE_RELATIVE_PATH);

  results.push(await installRuntime(packageRoot, home));
  results.push({
    label: "project language",
    path: projectLanguagePath,
    status: await writeSeedFile(projectLanguagePath, PROJECT_LANGUAGE),
  });

  const targets = [
    {
      label: "krow bootstrap launcher",
      path: bootstrapPath(home),
      content: KROW_BOOTSTRAP,
    },
    {
      label: "Codex $krow skill",
      path: path.join(home, ".codex", "skills", "krow", "SKILL.md"),
      content: renderManagedContent(CODEX_KROW_SKILL, home),
    },
    {
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
      content: renderManagedContent(CODEX_WORK_SKILL, home),
    },
    {
      label: "Codex $language-map skill",
      path: path.join(home, ".codex", "skills", "language-map", "SKILL.md"),
      content: renderManagedContent(CODEX_LANGUAGE_MAP_SKILL, home),
    },
    {
      label: "Claude Code /krow command",
      path: path.join(home, ".claude", "commands", "krow.md"),
      content: renderManagedContent(CLAUDE_KROW_COMMAND, home),
    },
    {
      label: "Gemini CLI /krow command",
      path: path.join(home, ".gemini", "commands", "krow.toml"),
      content: renderManagedContent(GEMINI_KROW_COMMAND, home),
    },
  ];

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

  const results = [
    {
      label: "krow runtime",
      path: runtimeDistTargetPath(home),
      status: await removePathIfExists(runtimeDistTargetPath(home)),
    },
  ];

  const targets = [
    {
      label: "krow bootstrap launcher",
      path: bootstrapPath(home),
    },
    {
      label: "Codex $krow skill",
      path: path.join(home, ".codex", "skills", "krow", "SKILL.md"),
    },
    {
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
    },
    {
      label: "Codex $language-map skill",
      path: path.join(home, ".codex", "skills", "language-map", "SKILL.md"),
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
