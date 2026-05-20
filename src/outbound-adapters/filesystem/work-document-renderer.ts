import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DocumentTemplateName, TemplateReader } from "../../outbound-ports/template-reader.js";
import { absolutePath, workDirPath } from "./krow-paths.js";

export type TemplateName = DocumentTemplateName;

export interface WorkDocResult {
  workId: string;
  workDir: string;
  createdRefs: string[];
  skippedRefs: string[];
}

function replaceAll(value: string, replacements: Record<string, string>): string {
  let rendered = value;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    rendered = rendered.split(placeholder).join(replacement);
  }
  return rendered;
}

function replaceCommonPlaceholders(value: string, replacements: Record<string, string>): string {
  const { "<id>": _id, ...common } = replacements;
  return replaceAll(value, common);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "work";
}

function compactId(value: string): string {
  return slugify(value).replace(/-/g, ".");
}

function normalizeTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  return title.length <= 90 ? title : `${title.slice(0, 87)}...`;
}

function writeIfMissing(rootDir: string, ref: string, content: string): "created" | "skipped" {
  const filePath = absolutePath(ref, rootDir);
  if (existsSync(filePath)) {
    return "skipped";
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
  return "created";
}

export function createWorkDocuments(
  input: {
    request: string;
    rootDir?: string;
    workId?: string;
    title?: string;
  },
  templateReader: TemplateReader,
): WorkDocResult {
  const rootDir = path.resolve(input.rootDir ?? process.cwd());
  const title = normalizeTitle(input.title ?? input.request);
  const workId = input.workId ?? `${new Date().toISOString().slice(0, 10)}-${slugify(title).slice(0, 48)}`;
  const id = compactId(workId);
  const workDir = `${workDirPath()}/${workId}`;
  const createdRefs: string[] = [];
  const skippedRefs: string[] = [];
  const replacements = {
    "<Work Title>": title,
    "<Task Title>": title,
    "<summary>": input.request,
    "<problem>": input.request,
    "<goal>": "Define the desired product behavior and update the software to match it.",
    "<desired behavior>": input.request,
    "<approach>": "Read the affected system documents, then implement the approved task plan.",
    "<purpose>": input.request,
    "<decision>": "(none)",
    "<scope>": "(none)",
    "<result>": "(not completed)",
    "<notes>": "(none)",
    "<rule>": "<rule>",
    "<criterion>": "<criterion>",
    "<example>": "<example>",
    "<user story>": "<user story>",
    "<path-or-area>": "<path-or-area>",
    "<verification>": "<verification>",
    "<file-or-responsibility>": "<file-or-responsibility>",
    "<path-or-doc-id>": "<path-or-doc-id>",
    "<change>": "<change>",
    "<issue>": "(none)",
  };

  const files: Array<{ ref: string; template: TemplateName; content: string }> = [
    {
      ref: `${workDir}/index.md`,
      template: "work-index.md",
      content: renderWorkTemplate("work-index.md", id, replacements, templateReader),
    },
    {
      ref: `${workDir}/goal.md`,
      template: "goal.md",
      content: renderWorkTemplate("goal.md", id, replacements, templateReader),
    },
    {
      ref: `${workDir}/spec.md`,
      template: "spec.md",
      content: renderWorkTemplate("spec.md", id, replacements, templateReader),
    },
    {
      ref: `${workDir}/plan.md`,
      template: "plan.md",
      content: renderWorkTemplate("plan.md", id, replacements, templateReader),
    },
    {
      ref: `${workDir}/review.md`,
      template: "review.md",
      content: renderWorkTemplate("review.md", id, replacements, templateReader),
    },
  ];

  for (const file of files) {
    const status = writeIfMissing(rootDir, file.ref, file.content);
    if (status === "created") {
      createdRefs.push(file.ref);
    } else {
      skippedRefs.push(file.ref);
    }
  }

  return { workId, workDir, createdRefs, skippedRefs };
}

function renderWorkTemplate(
  template: TemplateName,
  id: string,
  replacements: Record<string, string>,
  templateReader: TemplateReader,
): string {
  const taskId = `${id}.001`;
  let content = replaceCommonPlaceholders(templateReader.readDocumentTemplate(template), replacements);
  content = content
    .replace(/ID: WORK:<id>/g, `ID: WORK:${id}`)
    .replace(/ID: GOAL:<id>/g, `ID: GOAL:${id}`)
    .replace(/ID: SPEC:<id>/g, `ID: SPEC:${id}`)
    .replace(/ID: PLAN:<id>/g, `ID: PLAN:${id}`)
    .replace(/ID: TASK:<id>/g, `ID: TASK:${taskId}`)
    .replace(/ID: REVIEW:<id>/g, `ID: REVIEW:${id}`)
    .replace(/Work: WORK:<id>/g, `Work: WORK:${id}`)
    .replace(/Spec: SPEC:<id>/g, `Spec: SPEC:${id}`)
    .replace(/Plan: PLAN:<id>/g, `Plan: PLAN:${id}`);

  content = content.replace(/- TASK:<id>/g, "- (none)");

  if (template === "work-index.md") {
    content = content
      .replace("Status: <Proposed|Approved|In Progress|Completed|Blocked>", "Status: Proposed")
      .replace("Tasks:\n- tasks/<task-id>.md", "Tasks:\n- (none)");
  }
  if (template === "goal.md" || template === "spec.md" || template === "plan.md") {
    content = content.replace("Status: <Proposed|Approved|Deprecated>", "Status: Proposed");
  }
  if (template === "task.md") {
    content = content.replace("Status: <Proposed|Ready|In Progress|Completed|Blocked>", "Status: Proposed");
  }
  if (template === "review.md") {
    content = content.replace("Status: <Pending|Passed|Needs Work|Needs Decision|Blocked>", "Status: Pending");
  }

  return content
    .replace(/- TERM:<id>/g, "- (none)")
    .replace(/- DOC:<id>/g, "- (none)")
    .replace(/(Related Terms:\n- \(none\)\n\n)/g, "")
    .replace(/(Related System Documents:\n- \(none\)\n\n)/g, "")
    .replace(/(Affected System Documents:\n- \(none\)\n\n)/g, "")
    .replace(/(Updated System Documents:\n- \(none\)\n\n)/g, "")
    .replace(/(Updated Glossary Terms:\n- \(none\)\n\n)/g, "");
}
