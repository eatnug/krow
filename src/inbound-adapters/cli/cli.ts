import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanKrowDocuments, deriveTraceOverview, findRelatedDocuments } from "../../domains/documents/document-contracts.js";
import { applyProjectCheckDecisions, buildProjectCheckDecisions, runProjectCheck } from "../../application/project-check-application-service.js";
import { createWorkUseCases } from "../../infrastructure/composition/container.js";
import type { DecisionAnswer, RuntimeSession } from "../../inbound-ports/public-types.js";
import type { WorkUseCases } from "../../inbound-ports/work-use-cases.js";

type FlagMap = Record<string, string | boolean>;

function outputJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function printUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  krow init [--agents <all|none|codex|claude|gemini>] [--root <dir>] [--force]",
      "  krow remove [--root <dir>]",
      "  krow check [description] [--about <text>] [--scope <path>] [--root <dir>]",
      "  krow check-decisions <checkId> [--root <dir>]",
      "  krow check-apply <checkId> <json|path|-> [--root <dir>]",
      "  krow work start <request> [--root <dir>] [--work-id <id>] [--json]",
      "  krow work submit <workflowId> --input <json|path|-> [--root <dir>] [--json]",
      "  krow work next <workflowId> [--root <dir>] [--json]",
      "  krow work status <workflowId> [--root <dir>] [--json]",
      "  krow work stop <workflowId> [reason] [--root <dir>] [--json]",
      "  krow documents [message] [--root <dir>]",
      "",
    ].join("\n"),
  );
}

function packageRoot(): string {
  const cliFile = fileURLToPath(import.meta.url);
  let current = path.dirname(cliFile);
  for (let depth = 0; depth < 6; depth += 1) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
      if (parsed.name === "krow-cli") {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(path.dirname(cliFile), "..");
}

function installerScriptPath(): string {
  return path.join(packageRoot(), "install/krow.mjs");
}

function delegateInstaller(command: "init" | "remove", args: string[]): never {
  const result = spawnSync(process.execPath, [installerScriptPath(), command, ...args], {
    stdio: "inherit",
  });

  process.exit(typeof result.status === "number" ? result.status : 1);
}

function parseFlags(args: string[]): { positionals: string[]; flags: FlagMap } {
  const positionals: string[] = [];
  const flags: FlagMap = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { positionals, flags };
}

function rootDir(flags: FlagMap): string {
  return typeof flags.root === "string" ? path.resolve(flags.root) : process.cwd();
}

function readJsonInput(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "-") {
    return JSON.parse(readFileSync(0, "utf8")) as unknown;
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as unknown;
  }
  return JSON.parse(readFileSync(path.resolve(trimmed), "utf8")) as unknown;
}

function readRootRelativeJsonInput(value: string, flags: FlagMap): unknown {
  const trimmed = value.trim();
  if (trimmed === "-" || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return readJsonInput(trimmed);
  }
  const filePath = path.isAbsolute(trimmed) ? trimmed : path.join(rootDir(flags), trimmed);
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function readDecisionAnswersInput(value: string): DecisionAnswer[] {
  const input = readJsonInput(value);
  if (Array.isArray(input)) {
    return input as DecisionAnswer[];
  }
  if (input && typeof input === "object" && Array.isArray((input as { answers?: unknown }).answers)) {
    return (input as { answers: DecisionAnswer[] }).answers;
  }
  throw new Error("check-apply input must be a JSON array or an object with an answers array");
}

function requireMessage(args: string[], commandName: string): string {
  const message = args.join(" ").trim();
  if (!message) {
    throw new Error(`${commandName} requires a message`);
  }
  return message;
}

function packageVersion(): string {
  const packagePath = path.join(packageRoot(), "package.json");
  if (!existsSync(packagePath)) {
    return "0.0.0-local";
  }
  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
  return typeof parsed.version === "string" ? parsed.version : "0.0.0-local";
}

function currentCliCommandPrefix(): string {
  const override = process.env.KROW_SUBMIT_COMMAND_PREFIX?.trim();
  return override || `npx --yes krow-cli@${packageVersion()}`;
}

function workRuntimeSession(): RuntimeSession {
  const commandPrefix = currentCliCommandPrefix();
  const usesNpx = commandPrefix.startsWith("npx ");
  return {
    started_at: new Date().toISOString(),
    runner: usesNpx ? "npx" : "node",
    package: "krow-cli",
    requested: usesNpx ? "latest" : "local",
    resolved_version: packageVersion(),
    command_prefix: commandPrefix,
  };
}

function visibleDocumentSummary(document: ReturnType<typeof scanKrowDocuments>["all"][number]) {
  return {
    kind: document.kind,
    ref: document.ref,
    title: document.title,
    approval: document.approval,
    terms: document.terms,
    traceLinks: document.traceLinks,
  };
}

function handleCheck(args: string[], flags: FlagMap): void {
  const positionalDescription = args.join(" ").trim() || undefined;
  const about = typeof flags.about === "string" ? flags.about : positionalDescription;
  const scope = typeof flags.scope === "string" ? flags.scope : undefined;
  outputJson({
    check: runProjectCheck({
      about,
      scope,
      rootDir: rootDir(flags),
    }),
  });
}

function handleCheckDecisions(args: string[], flags: FlagMap): void {
  const [checkId] = args;
  if (!checkId) {
    throw new Error("check-decisions requires <checkId>");
  }

  const result = buildProjectCheckDecisions({
    checkId,
    rootDir: rootDir(flags),
  });

  outputJson({
    checkDecisions: {
      checkId: result.checkId,
      proposalsRef: result.proposalsRef,
      decisionsRef: result.decisionsRef,
      decisionCount: result.decisions.length,
      decisionIds: result.decisions.map((decision) => decision.id),
    },
  });
}

function handleCheckApply(args: string[], flags: FlagMap): void {
  const [checkId, inputValue] = args;
  if (!checkId || !inputValue) {
    throw new Error("check-apply requires <checkId> <json|path|->");
  }

  outputJson({
    applied: applyProjectCheckDecisions({
      checkId,
      answers: readDecisionAnswersInput(inputValue),
      rootDir: rootDir(flags),
    }),
  });
}

function handleDocuments(args: string[], flags: FlagMap): void {
  const message = args.join(" ").trim();
  const documents = scanKrowDocuments(rootDir(flags));
  const retrieval = message ? findRelatedDocuments(documents, message, []) : undefined;

  outputJson({
    documents: {
      glossary: documents.glossary.map(visibleDocumentSummary),
      systemDocuments: documents.systemDocuments.map(visibleDocumentSummary),
      goals: documents.goals.map(visibleDocumentSummary),
      specs: documents.specs.map(visibleDocumentSummary),
      plans: documents.plans.map(visibleDocumentSummary),
      tasks: documents.tasks.map(visibleDocumentSummary),
      reviews: documents.reviews.map(visibleDocumentSummary),
      totalCount: documents.all.length,
    },
    traceOverview: deriveTraceOverview(documents),
    related: retrieval?.related.map(visibleDocumentSummary) ?? [],
    approvalGaps: retrieval?.approvalGaps.map(visibleDocumentSummary) ?? [],
  });
}

function handleWork(args: string[], flags: FlagMap, workUseCases: WorkUseCases): void {
  const [subcommand, ...rest] = args;
  const baseInput = {
    rootDir: rootDir(flags),
    submitCommandPrefix: currentCliCommandPrefix(),
  };

  switch (subcommand) {
    case "start": {
      outputJson(
        workUseCases.startWork({
          ...baseInput,
          request: requireMessage(rest, "work start"),
          workId: typeof flags["work-id"] === "string" ? flags["work-id"] : undefined,
          runtimeSession: workRuntimeSession(),
        }),
      );
      return;
    }
    case "submit": {
      const [workflowId, positionalInput] = rest;
      const inputValue = typeof flags.input === "string" ? flags.input : positionalInput;
      if (!workflowId || !inputValue) {
        throw new Error("work submit requires <workflowId> --input <json|path|->");
      }
      outputJson(
        workUseCases.submit({
          ...baseInput,
          workflowId,
          payload: readRootRelativeJsonInput(inputValue, flags),
        }),
      );
      return;
    }
    case "next": {
      const [workflowId] = rest;
      if (!workflowId) {
        throw new Error("work next requires <workflowId>");
      }
      outputJson(workUseCases.next({ ...baseInput, workflowId }));
      return;
    }
    case "status": {
      const [workflowId] = rest;
      if (!workflowId) {
        throw new Error("work status requires <workflowId>");
      }
      outputJson(workUseCases.status({ ...baseInput, workflowId }));
      return;
    }
    case "stop": {
      const [workflowId, ...reasonParts] = rest;
      if (!workflowId) {
        throw new Error("work stop requires <workflowId> [reason]");
      }
      outputJson(
        workUseCases.stop({
          ...baseInput,
          workflowId,
          reason: reasonParts.join(" ").trim() || undefined,
        }),
      );
      return;
    }
    default:
      throw new Error("work requires one of: start, submit, next, status, stop");
  }
}

export function main(argv = process.argv): void {
  const [command, ...rest] = argv.slice(2);
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { positionals, flags } = parseFlags(rest);

  switch (command) {
    case "init":
      delegateInstaller("init", rest);
      return;
    case "remove":
      delegateInstaller("remove", rest);
      return;
    case "check":
      handleCheck(positionals, flags);
      return;
    case "check-decisions":
      handleCheckDecisions(positionals, flags);
      return;
    case "check-apply":
      handleCheckApply(positionals, flags);
      return;
    case "work":
      handleWork(positionals, flags, createWorkUseCases());
      return;
    case "documents":
      handleDocuments(positionals, flags);
      return;
    default:
      printUsage();
      process.exitCode = 1;
  }
}
