#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "Managed by krow init";
const KROW_COMMAND_PLACEHOLDER = "__KROW_COMMAND__";
const BOOTSTRAP_RELATIVE_PATH = [".krow", "bin", "krow-bootstrap.mjs"];
const RUNTIME_DIST_RELATIVE_PATH = [".krow", "runtime", "dist"];
const RUNTIME_TEMPLATES_RELATIVE_PATH = [".krow", "runtime", "templates"];
const SUPPORTED_AGENTS = new Set(["codex", "claude", "gemini"]);

const KROW_DIRECTORIES = [
  [".krow", "system", "docs"],
  [".krow", "work"],
  [".krow", "state", "workflows"],
  [".krow", "state", "artifacts"],
  [".krow", "logs"],
  [".krow", "knowledge"],
];

const GLOSSARY_SEED = `# Glossary

`;

const SYSTEM_MAP_SEED = `# System Map

This file routes agents to system documents that describe the software in the approved project language.

`;

const KROW_BOOTSTRAP = `#!/usr/bin/env node

// ${MANAGED_MARKER}

import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bootstrapDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeCliPath = path.resolve(bootstrapDir, "../runtime/dist/cli.js");

if (!existsSync(runtimeCliPath)) {
  process.stderr.write("krow runtime is missing. Re-run 'krow init --force' to refresh the local install.\\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, [runtimeCliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
`;

const SHARED_WORK_LOOP = `## Startup

If the request is empty, ask the user what they want to change.

Run with the current request in place of \`<request>\`:
\`${KROW_COMMAND_PLACEHOLDER} work "<request>"\`

Parse the JSON response.

Each work step is input -> operation -> output.

Use signal refs as available input. Decide what context is needed for the current step output. If context is missing, gather it from the repository when possible. Ask the user when the missing context is a product meaning decision, approval, or externally unknowable fact.

## Loop

For each response:

- \`run\`: read the referenced state, task packet, context, and Work Docs. Execute only the current unit. Submit the required structured output through the command named by the signal.
- \`gate\`: ask the user for the bundled missing information in one message, then submit the answer payload.
- \`done\`: report the result and evidence refs.
- \`fault\`: report the concrete invalid state or blocker.

The runner owns step order, dependency order, and readiness. The agent does the current step and returns evidence.
`;

const SHARED_CHECK_LOOP = `## Startup

Treat the argument as user-provided context for this check.

Run with the user seed in place of \`<user seed>\`:
\`${KROW_COMMAND_PLACEHOLDER} check "<user seed>"\`

Parse the JSON response and read these refs when present:

- \`check.evidenceRef\`
- \`check.readingPlanRef\`
- \`check.understandingRef\`
- \`check.proposalsRef\`
- \`check.questionsRef\`
- \`check.reportRef\`
- \`check.decisionsRef\`

The initial \`check.decisions\` array is normally empty. It becomes populated after proposals are written and \`check-decisions\` runs.

When \`check.status\` is \`needs-agent-draft\`, the check has started but the agent-owned draft is not complete. Continue the Check Work below before reporting completion.

When \`check.status\` is \`needs-review\`, inspect the refs and continue until the current missing artifact, proposal revision, or user-facing decision bundle is produced.

Report \`clean\` only when the check artifacts are complete and no draft work, review issue, or approval step remains.

## Responsibility Boundary

Code controls the workflow, records objective repository evidence, validates artifact shape, creates approval prompts, and applies approved updates.

AI reads repository evidence, writes the reading plan, traces the code it actually reads, explains the software in project language, drafts proposals, and identifies gaps.

User approves names, meanings, boundaries, ownership, product intent, and decisions that repository evidence cannot settle.

## Check Work

Use the returned refs, user context, current \`.krow\` documents, and repository files as available input.

Treat the whole repository as the target system. Start with a full-repository orientation, then read the entrypoints, flows, design notes, document contracts, templates, tests, and core modules deeply enough to explain current meaning. Peripheral files can be read shallowly when their role is clear, but record that boundary in the reading trace.

The goal is whole-system understanding with explicit reading coverage, not a line-by-line translation of every file.

Work in this order:

1. Read \`evidenceRef\` and \`reportRef\`.
2. Write \`readingPlanRef\` with the repository orientation, reading order, reading boundary, and refresh conditions.
3. Read repository files according to the reading plan.
4. Write \`understandingRef\` with what was read, what the software appears to mean, proposed terms/documents, and gaps.
5. Write \`proposalsRef\` with first-class Glossary term proposals and System Document proposals. Use only names, meanings, statements, and references sourced from user context, repository evidence, or existing project documents.
6. Write \`questionsRef\` with bundled user questions when meaning, ownership, boundary, or product intent remains unresolved.

Write each artifact as soon as its step is complete. The refs are durable workflow handoff, so do not hold all reading, understanding, proposals, and questions until the end of the run.

Keep code/runtime entrypoints and flows separate from Markdown context documents in the proposed repository understanding. Markdown docs can guide interpretation, but they should not be mixed into the runtime reading order.

Mark the reading plan and understanding artifacts \`Status: Complete\` before running \`check-decisions\`. Leave them as \`Draft\` while they are still handoff work.

Questions in \`questionsRef\` block approval prompts by default. Mark a question with \`"blocksApproval": false\` only when the proposal is still valid without that answer.

When proposals are ready for user approval, set \`proposals.json\` stage to \`ready-for-approval\` and run:

\`${KROW_COMMAND_PLACEHOLDER} check-decisions <check_id>\`

Report the decision count and refs. The full decision bundle is already written to \`decisionsRef\`; do not restate it in the message.

Apply explicit approve, revise, or reject decisions:

\`${KROW_COMMAND_PLACEHOLDER} check-apply <check_id> <json|path|->\`

During \`$check\`, durable System changes go through the runner only:

- create evidence and empty proposal artifacts with \`${KROW_COMMAND_PLACEHOLDER} check "<user seed>"\`
- create approval prompts with \`${KROW_COMMAND_PLACEHOLDER} check-decisions <check_id>\`
- apply approved proposals with \`${KROW_COMMAND_PLACEHOLDER} check-apply <check_id> <json|path|->\`
- when repository reading shows that proposals are too shallow, revise the proposals before approval
- when the user names a missing first-class term or document after review, add it to proposals with evidence and run \`check-decisions\` again

Keep all \`$check\` writes inside \`.krow\`. Treat generated apply reports as runner-owned audit output.
`;

const CODEX_WORK_SKILL = `---
name: work
description: Create Work Docs and run actionable engineering work through krow. Use only when the user explicitly invokes \`$work\`.
---

<!-- ${MANAGED_MARKER} -->

# Work

${SHARED_WORK_LOOP}
`;

const CODEX_CHECK_SKILL = `---
name: check
description: Check whether repository evidence and krow's project understanding are aligned. Use only when the user explicitly invokes \`$check\`.
---

<!-- ${MANAGED_MARKER} -->

# Check

${SHARED_CHECK_LOOP}
`;

const CLAUDE_WORK_COMMAND = `---
description: Create Work Docs and run actionable engineering work through krow.
argument-hint: "<request>"
arguments:
  - request
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent
---

<!-- ${MANAGED_MARKER} -->

# work

Use \`$request\` as the request.

${SHARED_WORK_LOOP}
`;

const CLAUDE_CHECK_COMMAND = `---
description: Check repository evidence against krow project understanding.
argument-hint: "[seed]"
arguments:
  - seed
allowed-tools: Bash, Read, Grep, Glob
---

<!-- ${MANAGED_MARKER} -->

# check

Use \`$seed\` as the user seed.

${SHARED_CHECK_LOOP}
`;

const GEMINI_WORK_COMMAND = `# ${MANAGED_MARKER}

description = "Create Work Docs and run actionable engineering work through krow."

prompt = """
Use {{args}} as the request.

${SHARED_WORK_LOOP}
"""
`;

const GEMINI_CHECK_COMMAND = `# ${MANAGED_MARKER}

description = "Check repository evidence against krow project understanding."

prompt = """
Use {{args}} as the user seed.

${SHARED_CHECK_LOOP}
"""
`;

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  krow init [--agents <all|none|codex|claude|gemini|list>] [--root <dir>] [--force]",
      "  krow remove [--root <dir>]",
      "",
      "Examples:",
      "  krow init",
      "  krow init --agents codex,claude",
      "  krow init --agents none --root /path/to/repo",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0],
    force: false,
    global: false,
    home: null,
    root: null,
    agents: "all",
  };

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force" || value === "-f") {
      parsed.force = true;
      continue;
    }
    if (value === "--global" || value === "-g") {
      parsed.global = true;
      continue;
    }
    if ((value === "--home" || value === "--root") && argv[index + 1]) {
      const target = argv[index + 1];
      if (value === "--home") {
        parsed.home = target;
      } else {
        parsed.root = target;
      }
      index += 1;
      continue;
    }
    if (value === "--agents" && argv[index + 1]) {
      parsed.agents = argv[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function targetHome({ global, home, root }) {
  if (root) {
    return path.resolve(root);
  }
  if (home) {
    return path.resolve(home);
  }
  return global ? os.homedir() : process.cwd();
}

function parseAgents(value) {
  if (!value || value === "all") {
    return [...SUPPORTED_AGENTS];
  }
  if (value === "none") {
    return [];
  }
  const agents = value.split(",").map((item) => item.trim()).filter(Boolean);
  const invalid = agents.filter((agent) => !SUPPORTED_AGENTS.has(agent));
  if (invalid.length > 0) {
    throw new Error(`unsupported agents: ${invalid.join(", ")}`);
  }
  return [...new Set(agents)];
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
    return "skipped (already exists)";
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return "created";
}

async function ensureDirectory(targetPath) {
  const exists = await pathExists(targetPath);
  await fs.mkdir(targetPath, { recursive: true });
  return exists ? "unchanged" : "created";
}

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

function runtimeTemplatesTargetPath(home) {
  return path.join(home, ...RUNTIME_TEMPLATES_RELATIVE_PATH);
}

function krowCommand(home) {
  return `node ${shellQuote(bootstrapPath(home))}`;
}

function renderManagedContent(template, home) {
  return template.split(KROW_COMMAND_PLACEHOLDER).join(krowCommand(home));
}

async function installRuntime(packageRoot, home) {
  const sourceDist = path.join(packageRoot, "dist");
  const sourceCli = path.join(sourceDist, "cli.js");
  const sourceTemplates = path.join(packageRoot, "templates");
  const targetDist = runtimeDistTargetPath(home);
  const targetTemplates = runtimeTemplatesTargetPath(home);
  const existed = await pathExists(targetDist);

  if (!(await pathExists(sourceCli))) {
    throw new Error(`Missing built runtime at ${sourceCli}. Run 'npm run build' before init from a source checkout.`);
  }
  if (!(await pathExists(sourceTemplates))) {
    throw new Error(`Missing bundled templates at ${sourceTemplates}.`);
  }

  await fs.mkdir(path.dirname(targetDist), { recursive: true });
  await fs.rm(targetDist, { recursive: true, force: true });
  await fs.cp(sourceDist, targetDist, { recursive: true });
  await fs.writeFile(path.join(targetDist, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");

  await fs.rm(targetTemplates, { recursive: true, force: true });
  await fs.cp(sourceTemplates, targetTemplates, { recursive: true });

  return {
    label: "krow runtime",
    path: path.dirname(targetDist),
    status: existed ? "updated" : "created",
  };
}

function agentTargets(home, agents) {
  const selected = new Set(agents);
  const targets = [
    {
      agent: "codex",
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
      content: renderManagedContent(CODEX_WORK_SKILL, home),
    },
    {
      agent: "codex",
      label: "Codex $check skill",
      path: path.join(home, ".codex", "skills", "check", "SKILL.md"),
      content: renderManagedContent(CODEX_CHECK_SKILL, home),
    },
    {
      agent: "claude",
      label: "Claude /work command",
      path: path.join(home, ".claude", "commands", "work.md"),
      content: renderManagedContent(CLAUDE_WORK_COMMAND, home),
    },
    {
      agent: "claude",
      label: "Claude /check command",
      path: path.join(home, ".claude", "commands", "check.md"),
      content: renderManagedContent(CLAUDE_CHECK_COMMAND, home),
    },
    {
      agent: "gemini",
      label: "Gemini /work command",
      path: path.join(home, ".gemini", "commands", "work.toml"),
      content: renderManagedContent(GEMINI_WORK_COMMAND, home),
    },
    {
      agent: "gemini",
      label: "Gemini /check command",
      path: path.join(home, ".gemini", "commands", "check.toml"),
      content: renderManagedContent(GEMINI_CHECK_COMMAND, home),
    },
  ];
  return targets.filter((target) => selected.has(target.agent));
}

export async function runInit(options) {
  const home = targetHome(options);
  const agents = parseAgents(options.agents);
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const results = [];

  results.push(await installRuntime(packageRoot, home));

  for (const relativePath of KROW_DIRECTORIES) {
    const targetPath = path.join(home, ...relativePath);
    results.push({
      label: relativePath.join("/"),
      path: targetPath,
      status: await ensureDirectory(targetPath),
    });
  }

  results.push({
    label: "system glossary",
    path: path.join(home, ".krow", "system", "glossary.md"),
    status: await writeSeedFile(path.join(home, ".krow", "system", "glossary.md"), GLOSSARY_SEED),
  });
  results.push({
    label: "system map",
    path: path.join(home, ".krow", "system", "map.md"),
    status: await writeSeedFile(path.join(home, ".krow", "system", "map.md"), SYSTEM_MAP_SEED),
  });

  results.push({
    label: "krow bootstrap launcher",
    path: bootstrapPath(home),
    status: await writeManagedFile(bootstrapPath(home), KROW_BOOTSTRAP, options.force),
  });

  for (const target of agentTargets(home, agents)) {
    results.push({
      label: target.label,
      path: target.path,
      status: await writeManagedFile(target.path, target.content, options.force),
    });
  }

  process.stdout.write(
    [
      `Installed from ${packageRoot}`,
      `Target root: ${home}`,
      `Agent surfaces: ${agents.length > 0 ? agents.join(", ") : "none"}`,
      ...results.map((result) => `${result.status}: ${result.label} -> ${result.path}`),
      "",
      "Next:",
      "  Open your coding agent.",
      "  Run $check to create or refresh project understanding.",
      "  Run $work <request> when you want to change code using krow.",
    ].join("\n") + "\n",
  );
}

async function removePathIfExists(targetPath) {
  const exists = await pathExists(targetPath);
  if (!exists) {
    return "skipped (not found)";
  }
  await fs.rm(targetPath, { recursive: true, force: true });
  return "removed";
}

export async function runRemove(options) {
  const home = targetHome(options);
  const results = [
    {
      label: "krow runtime",
      path: path.join(home, ".krow", "runtime"),
      status: await removePathIfExists(path.join(home, ".krow", "runtime")),
    },
  ];

  const targets = [
    { label: "krow bootstrap launcher", path: bootstrapPath(home) },
    ...agentTargets(home, [...SUPPORTED_AGENTS]).map((target) => ({ label: target.label, path: target.path })),
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
