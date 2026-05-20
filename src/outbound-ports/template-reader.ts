export type DocumentTemplateName =
  | "glossary.md"
  | "system-map.md"
  | "system-doc.md"
  | "work-index.md"
  | "goal.md"
  | "spec.md"
  | "plan.md"
  | "task.md"
  | "review.md";

export interface TemplateReader {
  readDocumentTemplate(name: DocumentTemplateName): string;
}
