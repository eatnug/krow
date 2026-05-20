#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "Managed by krow init";
const KROW_COMMAND = "npx --yes krow-cli@latest";
const SUPPORTED_AGENTS = new Set(["codex", "claude", "gemini"]);

const KROW_DIRECTORIES = [
  [".krow", "system", "docs"],
  [".krow", "work"],
  [".krow", "state", "workflows"],
];

const GLOSSARY_SEED = `# Glossary

`;

const SYSTEM_MAP_SEED = `# System Map

This file routes agents to system documents that describe the software in the approved project language.

`;

function packageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function readInfrastructureTemplate(...segments) {
  return fs.readFile(path.join(packageRoot(), "src", "infrastructure", "templates", ...segments), "utf8");
}

function renderTemplate(value, replacements) {
  return Object.entries(replacements).reduce(
    (content, [key, replacement]) => content.split(`{{${key}}}`).join(replacement),
    value,
  );
}

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

async function renderAgentSurfaceTemplate(agent, fileName, sharedLoops) {
  const template = await readInfrastructureTemplate("agent-surfaces", agent, fileName);
  return renderTemplate(template, {
    MANAGED_MARKER,
    WORK_LOOP: sharedLoops.work,
    CHECK_LOOP: sharedLoops.check,
  });
}

async function agentTargets(home, agents) {
  const selected = new Set(agents);
  const sharedLoops = {
    work: renderTemplate(await readInfrastructureTemplate("agent-surfaces", "shared", "work-loop.md"), {
      KROW_COMMAND,
    }),
    check: renderTemplate(await readInfrastructureTemplate("agent-surfaces", "shared", "check-loop.md"), {
      KROW_COMMAND,
    }),
  };
  const targets = [
    {
      agent: "codex",
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
      content: await renderAgentSurfaceTemplate("codex", "work.SKILL.md", sharedLoops),
    },
    {
      agent: "codex",
      label: "Codex $check skill",
      path: path.join(home, ".codex", "skills", "check", "SKILL.md"),
      content: await renderAgentSurfaceTemplate("codex", "check.SKILL.md", sharedLoops),
    },
    {
      agent: "claude",
      label: "Claude /work command",
      path: path.join(home, ".claude", "commands", "work.md"),
      content: await renderAgentSurfaceTemplate("claude", "work.md", sharedLoops),
    },
    {
      agent: "claude",
      label: "Claude /check command",
      path: path.join(home, ".claude", "commands", "check.md"),
      content: await renderAgentSurfaceTemplate("claude", "check.md", sharedLoops),
    },
    {
      agent: "gemini",
      label: "Gemini /work command",
      path: path.join(home, ".gemini", "commands", "work.toml"),
      content: await renderAgentSurfaceTemplate("gemini", "work.toml", sharedLoops),
    },
    {
      agent: "gemini",
      label: "Gemini /check command",
      path: path.join(home, ".gemini", "commands", "check.toml"),
      content: await renderAgentSurfaceTemplate("gemini", "check.toml", sharedLoops),
    },
  ];
  return targets.filter((target) => selected.has(target.agent));
}

export async function runInit(options) {
  const home = targetHome(options);
  const agents = parseAgents(options.agents);
  const sourceRoot = packageRoot();
  const results = [];

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

  for (const target of await agentTargets(home, agents)) {
    results.push({
      label: target.label,
      path: target.path,
      status: await writeManagedFile(target.path, target.content, options.force),
    });
  }

  process.stdout.write(
    [
      `Installed from ${sourceRoot}`,
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

export async function runRemove(options) {
  const home = targetHome(options);
  const results = [];

  const targets = [
    ...(await agentTargets(home, [...SUPPORTED_AGENTS])).map((target) => ({ label: target.label, path: target.path })),
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
