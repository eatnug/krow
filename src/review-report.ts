import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ExecuteOutput,
  UnitReviewReport,
  VerifyOutput,
  WorkflowState,
  WorkflowUnit,
} from "./types.js";
import type { KrowDocumentSummary } from "./document-contracts.js";
import { executionContractForUnit } from "./execution-contracts.js";
import { absolutePath, unitReviewReportPath } from "./workflow-files.js";

function nowIso(): string {
  return new Date().toISOString();
}

function markdownList(items: string[], empty = "(none)"): string[] {
  return items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${empty}`];
}

function asExecuteOutput(value: unknown): ExecuteOutput | undefined {
  return value && typeof value === "object" ? (value as ExecuteOutput) : undefined;
}

function asVerifyOutput(value: unknown): VerifyOutput | undefined {
  return value && typeof value === "object" ? (value as VerifyOutput) : undefined;
}

function relatedDocuments(unit: WorkflowUnit): KrowDocumentSummary[] {
  const context = unit.documentContext;
  if (!context || typeof context !== "object") {
    return [];
  }
  const related = (context as { related?: unknown }).related;
  return Array.isArray(related) ? (related as KrowDocumentSummary[]) : [];
}

function reviewIdForUnit(unitId: string): string {
  const numeric = unitId.match(/(\d+)$/)?.[1] ?? "001";
  return `REVIEW-${numeric.padStart(3, "0")}`;
}

function traceRows(documents: KrowDocumentSummary[]): string[] {
  const rows = documents.flatMap((document) =>
    document.traceLinks.map((link) => `| ${link.kind} | ${link.id} | ${document.ref} | ${link.label ?? ""} |`),
  );
  return rows.length > 0 ? rows : ["| (none) | (none) | (none) | (none) |"];
}

function testRows(execute: ExecuteOutput | undefined): string[] {
  const rows = (execute?.exampleTests ?? []).map((trace) =>
    `| ${trace.exampleId} | ${trace.status} | ${trace.testFiles.join(", ")} | ${(trace.testNames ?? []).join(", ")} |`,
  );
  return rows.length > 0 ? rows : ["| (none) | (none) | (none) | (none) |"];
}

function codeRows(execute: ExecuteOutput | undefined): string[] {
  const rows = (execute?.implementationLinks ?? []).map((link) =>
    `| ${(link.exampleIds ?? []).join(", ") || "(unspecified)"} | ${(link.planIds ?? []).join(", ") || "(unspecified)"} | ${link.codeFiles.join(", ")} | ${link.notes ?? ""} |`,
  );
  return rows.length > 0 ? rows : ["| (none) | (none) | (none) | (none) |"];
}

function approvalRows(state: WorkflowState, documents: KrowDocumentSummary[]): string[] {
  const rows = documents
    .filter((document) => document.kind === "prd" || document.kind === "plan")
    .map((document) => {
      const decisionId = `approve:${document.kind}:${document.ref}`;
      const workflowApproval = state.decisionHistory.some(
        (answer) => answer.decisionId === decisionId && answer.selectedOptionId === "approve",
      );
      return `| ${document.kind.toUpperCase()} | ${document.ref} | ${document.approval.status} | ${workflowApproval ? "approved" : "(none)"} |`;
    });
  return rows.length > 0 ? rows : ["| (none) | (none) | (none) | (none) |"];
}

function reviewGaps(unit: WorkflowUnit, execute: ExecuteOutput | undefined, verify: VerifyOutput | undefined): string[] {
  const contract = executionContractForUnit(unit);
  const gaps: string[] = [];

  if (contract && contract.exampleIds.length > 0) {
    const tested = new Set((execute?.exampleTests ?? []).map((trace) => trace.exampleId));
    const implemented = new Set((execute?.implementationLinks ?? []).flatMap((link) => link.exampleIds ?? []));
    const untested = contract.exampleIds.filter((exampleId) => !tested.has(exampleId));
    const unimplemented = contract.exampleIds.filter((exampleId) => !implemented.has(exampleId));
    if (untested.length > 0) {
      gaps.push(`Examples without test links: ${untested.join(", ")}`);
    }
    if (unimplemented.length > 0) {
      gaps.push(`Examples without implementation links: ${unimplemented.join(", ")}`);
    }
  }

  const failedChecks = (verify?.checks ?? []).filter((check) => check.status === "failed");
  if (failedChecks.length > 0) {
    gaps.push(`Failed checks: ${failedChecks.map((check) => check.name).join(", ")}`);
  }

  if ((verify?.unverifiedClaims?.length ?? 0) > 0) {
    gaps.push(`Unverified claims: ${verify!.unverifiedClaims!.join(", ")}`);
  }

  if (verify && !verify.passed) {
    gaps.push("Verification did not pass.");
  }

  return gaps;
}

export function writeUnitReviewReport(
  state: WorkflowState,
  unitId: string,
  rootDir = process.cwd(),
): UnitReviewReport {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit) {
    throw new Error(`cannot write review report for unknown unit: ${unitId}`);
  }

  const outputs = state.outputs[unitId] ?? {};
  const execute = asExecuteOutput(outputs.execute);
  const verify = asVerifyOutput(outputs.verify);
  const documents = relatedDocuments(unit);
  const contract = executionContractForUnit(unit);
  const generatedAt = nowIso();
  const reportRef = unitReviewReportPath(state.workflowId, unitId);
  const reviewId = reviewIdForUnit(unitId);
  const gaps = reviewGaps(unit, execute, verify);

  const content = [
    `# Review Report: ${unit.title}`,
    "",
    `Review ID: ${reviewId}`,
    `Workflow: ${state.workflowId}`,
    `Unit: ${unitId}`,
    `Generated At: ${generatedAt}`,
    "",
    "## Concepts",
    ...markdownList(contract?.conceptKeys ?? []),
    "",
    "## Source Documents",
    ...markdownList(documents.map((document) => `${document.kind.toUpperCase()} ${document.ref} [approval=${document.approval.status}]`)),
    "",
    "## Approval Evidence",
    "| Kind | Ref | Document Status | Workflow Decision |",
    "|------|-----|-----------------|-------------------|",
    ...approvalRows(state, documents),
    "",
    "## Document Trace",
    "| Kind | ID | Ref | Label |",
    "|------|----|-----|-------|",
    ...traceRows(documents),
    "",
    "## Example To Test Links",
    "| Example | Status | Test Files | Test Names |",
    "|---------|--------|------------|------------|",
    ...testRows(execute),
    "",
    "## Test To Code Links",
    "| Examples | Plans | Code Files | Notes |",
    "|----------|-------|------------|-------|",
    ...codeRows(execute),
    "",
    "## Execution Steps",
    ...markdownList(
      (execute?.executionSteps ?? []).map((step) => `${step.id}: ${step.status} - ${step.evidence}`),
    ),
    "",
    "## Verification",
    verify
      ? `- Passed: ${verify.passed ? "yes" : "no"}`
      : "- Passed: not verified",
    ...markdownList(
      (verify?.checks ?? []).map((check) =>
        `${check.status.toUpperCase()} ${check.name}${check.command ? ` [${check.command}]` : ""}: ${check.evidence}`,
      ),
    ),
    "",
    "## Alignment Gaps",
    ...markdownList(gaps),
    "",
    "## Summary",
    verify?.summary ?? execute?.summary ?? "No verification summary recorded.",
  ].join("\n");

  const absoluteReportPath = absolutePath(reportRef, rootDir);
  mkdirSync(path.dirname(absoluteReportPath), { recursive: true });
  writeFileSync(absoluteReportPath, `${content}\n`);

  const outputBucket = state.outputs[unitId] ?? {};
  outputBucket.reviewReport = {
    ref: reportRef,
    reviewId,
    generatedAt,
    gaps,
  };
  state.outputs[unitId] = outputBucket;
  return outputBucket.reviewReport;
}
