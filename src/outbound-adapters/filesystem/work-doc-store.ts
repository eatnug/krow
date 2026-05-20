import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkDocStore } from "../../outbound-ports/work-doc-store.js";
import type { TemplateReader } from "../../outbound-ports/template-reader.js";
import type { PlannedTask } from "../../domains/work/task-graph.js";
import { createWorkDocuments } from "./work-document-renderer.js";
import { absolutePath } from "./krow-paths.js";
function markdownList(items: string[], empty = "(none)"): string[] {
  return items.length === 0 ? [`- ${empty}`] : items.map((item) => `- ${item}`);
}

function writeText(ref: string, content: string, rootDir = process.cwd()): void {
  const filePath = absolutePath(ref, rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

export class FilesystemWorkDocStore implements WorkDocStore {
  constructor(private readonly templateReader: TemplateReader) {}

  createWorkDocuments(input: Parameters<WorkDocStore["createWorkDocuments"]>[0]) {
    return createWorkDocuments(input, this.templateReader);
  }

  writeTaskDocs(workRoot: string, tasks: PlannedTask[], rootDir = process.cwd()): void {
    if (tasks.length === 0) {
      return;
    }

    writeText(
      `${workRoot}/tasks/index.md`,
      [
        "# Tasks",
        "",
        "Tasks are created from plan_output.tasks when a work item needs explicit dependency or ownership boundaries.",
        "",
        ...tasks.map((task) => `- ${task.id}: tasks/${task.id}.md`),
        "",
      ].join("\n"),
      rootDir,
    );

    for (const task of tasks) {
      writeText(
        `${workRoot}/tasks/${task.id}.md`,
        [
          `# Task: ${task.title}`,
          "",
          `ID: TASK:${task.id}`,
          "Status: Planned",
          "",
          "Scope:",
          task.scope,
          "",
          "Dependencies:",
          ...markdownList(task.depends_on ?? []),
          "",
          "Files:",
          ...markdownList(task.files ?? []),
          "",
          "Responsibility:",
          task.responsibility ?? "(none)",
          "",
          "Parallel Group:",
          task.parallel_group ?? "(none)",
          "",
          "Expected Output:",
          task.expected_output,
          "",
          "Merge Plan:",
          task.merge_plan ?? "(none)",
          "",
          "Output:",
          "(not completed)",
          "",
        ].join("\n"),
        rootDir,
      );
    }
  }

}
