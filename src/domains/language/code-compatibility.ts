import type { Reference } from "./references.js";

export type CodeCompatibilityIssueKind = "missing-code-name" | "conflicting-code-name" | "missing-system-document";

export interface CodeCompatibilityIssue {
  kind: CodeCompatibilityIssueKind;
  language: string;
  code?: Reference;
  summary: string;
}
