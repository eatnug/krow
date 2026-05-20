import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  SYSTEM_DOCS_DIR,
  WORK_DIR,
  absolutePath,
  glossaryPath,
} from "../../outbound-adapters/filesystem/krow-paths.js";
import type { DecisionAnswer, DecisionPrompt } from "../../inbound-ports/public-types.js";

export type ApprovalStatus = "draft" | "needs-revision" | "approved" | "missing";
export type KrowDocumentKind = "glossary" | "system" | "goal" | "spec" | "plan" | "task" | "review";

export interface ApprovalSection {
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  decisions: string[];
}

export interface TraceLink {
  id: string;
  kind: "goal" | "spec" | "plan" | "task" | "user-story" | "acceptance-criteria" | "example" | "review";
  ref: string;
  label?: string;
}

export interface KrowDocumentSummary {
  kind: KrowDocumentKind;
  ref: string;
  title: string;
  approval: ApprovalSection;
  terms: string[];
  traceLinks: TraceLink[];
  searchText: string;
}

export interface KrowDocumentSet {
  glossary: KrowDocumentSummary[];
  systemDocuments: KrowDocumentSummary[];
  goals: KrowDocumentSummary[];
  specs: KrowDocumentSummary[];
  plans: KrowDocumentSummary[];
  tasks: KrowDocumentSummary[];
  reviews: KrowDocumentSummary[];
  all: KrowDocumentSummary[];
}

export interface DocumentRetrieval {
  related: KrowDocumentSummary[];
  approvalGaps: KrowDocumentSummary[];
}

export type ApprovalTargetDocument = Pick<KrowDocumentSummary, "kind" | "ref" | "title" | "approval" | "traceLinks">;

export interface TraceOverviewRow {
  id: string;
  kind: TraceLink["kind"];
  refs: string[];
}

function normalizeStatus(value: string | undefined): ApprovalStatus {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "approved") {
    return "approved";
  }
  if (normalized === "needs-revision" || normalized === "needs work" || normalized === "needs decision") {
    return "needs-revision";
  }
  if (normalized === "draft" || normalized === "proposed" || normalized === "in progress" || normalized === "pending") {
    return "draft";
  }
  return "missing";
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstHeading(content: string, fallback: string): string {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function sectionContent(content: string, heading: string): string | undefined {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (startIndex < 0) {
    return undefined;
  }

  const sectionLines: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    sectionLines.push(lines[index]);
  }
  return sectionLines.join("\n").trim();
}

function labelValue(content: string, label: string): string | undefined {
  const target = label.toLowerCase();
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.toLowerCase().startsWith(`${target}:`));
  const value = line?.slice(line.indexOf(":") + 1).trim();
  return value || undefined;
}

function listItems(content: string | undefined): string[] {
  if (!content) {
    return [];
  }
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

export function parseApprovalSection(content: string): ApprovalSection {
  const approval = sectionContent(content, "Approval");
  if (!approval) {
    return { status: normalizeStatus(labelValue(content, "Status")), decisions: [] };
  }

  return {
    status: normalizeStatus(labelValue(approval, "Status")),
    approvedBy: labelValue(approval, "Approved By"),
    approvedAt: labelValue(approval, "Approved At"),
    decisions: listItems(approval.match(/^Decisions:\s*([\s\S]*)$/im)?.[1] ?? ""),
  };
}

function termList(content: string): string[] {
  return [
    ...listItems(sectionContent(content, "Related Terms")),
    ...listItems(sectionContent(content, "Terms")),
  ];
}

function pushTraceLink(links: TraceLink[], id: string, kind: TraceLink["kind"], ref: string, label?: string): void {
  if (links.some((link) => link.id === id && link.kind === kind)) {
    return;
  }
  links.push({ id, kind, ref, label });
}

function traceLinks(content: string, ref: string, kind: KrowDocumentKind): TraceLink[] {
  const links: TraceLink[] = [];

  for (const match of content.matchAll(/^Plan ID:\s*(PLAN-\d+)\s*$/gim)) {
    pushTraceLink(links, match[1], "plan", ref);
  }
  for (const match of content.matchAll(/^ID:\s*(GOAL:[^\s]+)\s*$/gim)) {
    pushTraceLink(links, match[1], "goal", ref);
  }
  for (const match of content.matchAll(/^ID:\s*(SPEC:[^\s]+)\s*$/gim)) {
    pushTraceLink(links, match[1], "spec", ref);
  }
  for (const match of content.matchAll(/^ID:\s*(PLAN:[^\s]+)\s*$/gim)) {
    pushTraceLink(links, match[1], "plan", ref);
  }
  for (const match of content.matchAll(/^ID:\s*(TASK:[^\s]+)\s*$/gim)) {
    pushTraceLink(links, match[1], "task", ref);
  }
  for (const match of content.matchAll(/^Example ID:\s*(EX-\d+)\s*$/gim)) {
    pushTraceLink(links, match[1], "example", ref);
  }
  for (const match of content.matchAll(/^Review ID:\s*(REVIEW-\d+)\s*$/gim)) {
    pushTraceLink(links, match[1], "review", ref);
  }
  for (const match of content.matchAll(/^###\s+(US-\d+):?\s*(.*)$/gim)) {
    pushTraceLink(links, match[1], "user-story", ref, match[2]?.trim());
  }
  for (const match of content.matchAll(/\b(AC-\d+):?[ \t]*([^\n]*)/gim)) {
    pushTraceLink(links, match[1], "acceptance-criteria", ref, match[2]?.trim());
  }
  for (const match of content.matchAll(/\b(EX-\d+):?[ \t]*([^\n]*)/gim)) {
    pushTraceLink(links, match[1], "example", ref, match[2]?.trim());
  }

  if (links.length === 0 && (kind === "goal" || kind === "spec" || kind === "plan" || kind === "task")) {
    const fallbackId = path.basename(ref, ".md").toUpperCase();
    const linkKind = kind === "task" ? "task" : kind;
    pushTraceLink(links, fallbackId, linkKind, ref);
  }

  return links;
}

export function parseKrowDocument(kind: KrowDocumentKind, ref: string, content: string): KrowDocumentSummary {
  return {
    kind,
    ref,
    title: firstHeading(content, path.basename(ref, ".md")),
    approval: parseApprovalSection(content),
    terms: termList(content),
    traceLinks: traceLinks(content, ref, kind),
    searchText: normalizeSearchText(content),
  };
}

function scanDirectory(rootDir: string, kind: KrowDocumentKind, dir: string): KrowDocumentSummary[] {
  const absoluteDir = absolutePath(dir, rootDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const ref = `${dir}/${entry.name}`;
      return parseKrowDocument(kind, ref, readFileSync(absolutePath(ref, rootDir), "utf8"));
    });
}

function scanWorkDocuments(rootDir: string, target: KrowDocumentKind): KrowDocumentSummary[] {
  const absoluteDir = absolutePath(WORK_DIR, rootDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  const summaries: KrowDocumentSummary[] = [];
  const workDirs = readdirSync(absoluteDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const workDir of workDirs) {
    const baseRef = `${WORK_DIR}/${workDir.name}`;
    const basePath = absolutePath(baseRef, rootDir);
    const directFile =
      target === "goal" ? "goal.md" :
      target === "spec" ? "spec.md" :
      target === "plan" ? "plan.md" :
      target === "review" ? "review.md" :
      undefined;

    if (directFile) {
      const ref = `${baseRef}/${directFile}`;
      const filePath = absolutePath(ref, rootDir);
      if (existsSync(filePath)) {
        summaries.push(parseKrowDocument(target, ref, readFileSync(filePath, "utf8")));
      }
      continue;
    }

    if (target === "task") {
      const taskDir = path.join(basePath, "tasks");
      if (!existsSync(taskDir)) {
        continue;
      }
      for (const taskFile of readdirSync(taskDir, { withFileTypes: true })) {
        if (!taskFile.isFile() || !taskFile.name.endsWith(".md")) {
          continue;
        }
        const ref = `${baseRef}/tasks/${taskFile.name}`;
        summaries.push(parseKrowDocument("task", ref, readFileSync(absolutePath(ref, rootDir), "utf8")));
      }
    }
  }
  return summaries;
}

export function scanKrowDocuments(rootDir = process.cwd()): KrowDocumentSet {
  const glossaryRef = glossaryPath();
  const glossaryFilePath = absolutePath(glossaryRef, rootDir);
  const glossary = existsSync(glossaryFilePath)
    ? [parseKrowDocument("glossary", glossaryRef, readFileSync(glossaryFilePath, "utf8"))]
    : [];
  const systemDocuments = scanDirectory(rootDir, "system", SYSTEM_DOCS_DIR);
  const goals = scanWorkDocuments(rootDir, "goal");
  const specs = scanWorkDocuments(rootDir, "spec");
  const plans = scanWorkDocuments(rootDir, "plan");
  const tasks = scanWorkDocuments(rootDir, "task");
  const reviews = scanWorkDocuments(rootDir, "review");
  return {
    glossary,
    systemDocuments,
    goals,
    specs,
    plans,
    tasks,
    reviews,
    all: [...glossary, ...systemDocuments, ...goals, ...specs, ...plans, ...tasks, ...reviews],
  };
}

export function findRelatedDocuments(
  documents: KrowDocumentSet,
  request: string,
  termIds: string[],
): DocumentRetrieval {
  const normalizedRequest = normalizeSearchText(request);
  const normalizedTerms = termIds.map(normalizeSearchText).filter(Boolean);
  const related = documents.all.filter((doc) => {
    if (normalizedTerms.some((term) => doc.terms.map(normalizeSearchText).includes(term))) {
      return true;
    }
    return normalizedRequest
      .split(" ")
      .filter((token) => token.length > 2)
      .some((token) => doc.searchText.includes(token));
  });

  return {
    related,
    approvalGaps: related.filter((doc) => (doc.kind === "goal" || doc.kind === "plan") && doc.approval.status !== "approved"),
  };
}

export function deriveTraceOverview(documents: KrowDocumentSet): TraceOverviewRow[] {
  const rows = new Map<string, TraceOverviewRow>();

  for (const document of documents.all) {
    for (const link of document.traceLinks) {
      const key = `${link.kind}:${link.id}`;
      const existing = rows.get(key);
      if (existing) {
        existing.refs = [...new Set([...existing.refs, link.ref])];
        continue;
      }
      rows.set(key, {
        id: link.id,
        kind: link.kind,
        refs: [link.ref],
      });
    }
  }

  return [...rows.values()].sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

export function approvalDecisionId(document: ApprovalTargetDocument): string {
  return `approve:${document.kind}:${document.ref}`;
}

export function approvalPromptsForDocuments(documents: ApprovalTargetDocument[]): DecisionPrompt[] {
  return documents
    .filter((document) => document.kind === "goal" || document.kind === "plan")
    .map((document) => {
      const kind = document.kind as "goal" | "plan";
      return {
        id: approvalDecisionId(document),
        kind: "approval" as const,
        target: {
          kind,
          ref: document.ref,
          status: document.approval.status,
        },
        question: `Approve or revise ${kind.toUpperCase()} ${document.ref} before implementation.`,
        context: [
          `Document: ${document.title}`,
          `Current status: ${document.approval.status}`,
          `Trace ids: ${document.traceLinks.map((link) => link.id).join(", ") || "(none)"}`,
        ].join("\n"),
        options: [
          {
            id: "approve",
            label: "Approve",
            description: "Record approval in workflow decision history and continue toward implementation.",
          },
          {
            id: "revise",
            label: "Revise",
            description: "Return to planning so the document or plan can be revised before implementation.",
          },
          {
            id: "stop",
            label: "Stop",
            description: "Stop the workflow instead of implementing from this document state.",
          },
        ],
      };
    });
}

export function approvalSatisfiedByDecisionHistory(document: ApprovalTargetDocument, history: DecisionAnswer[]): boolean {
  const decisionId = approvalDecisionId(document);
  return history.some((answer) => answer.decisionId === decisionId && answer.selectedOptionId === "approve");
}

export function unsatisfiedApprovalDocuments(
  documents: ApprovalTargetDocument[],
  history: DecisionAnswer[],
): ApprovalTargetDocument[] {
  return documents.filter(
    (document) =>
      (document.kind === "goal" || document.kind === "plan") &&
      document.approval.status !== "approved" &&
      !approvalSatisfiedByDecisionHistory(document, history),
  );
}
