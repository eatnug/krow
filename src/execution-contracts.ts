import type {
  ExecuteOutput,
  ExecutionStepId,
  WorkflowUnit,
} from "./types.js";
import type { DocumentRetrieval, KrowDocumentSummary, TraceLink } from "./document-contracts.js";

export interface ExecutionContract {
  sourceRefs: string[];
  conceptKeys: string[];
  prdIds: string[];
  planIds: string[];
  userStoryIds: string[];
  acceptanceCriteriaIds: string[];
  exampleIds: string[];
  requiredStages: ExecutionStepId[];
}

const orderedExecutionStages: ExecutionStepId[] = [
  "tests-from-examples",
  "run-tests-before-code",
  "implement-code",
  "run-tests-after-code",
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function linksOfKind(documents: KrowDocumentSummary[], kind: TraceLink["kind"]): string[] {
  return unique(documents.flatMap((document) => document.traceLinks.filter((link) => link.kind === kind).map((link) => link.id)));
}

export function executionContractFromDocuments(documents: KrowDocumentSummary[]): ExecutionContract {
  const exampleIds = linksOfKind(documents, "example");
  return {
    sourceRefs: unique(documents.map((document) => document.ref)),
    conceptKeys: unique(documents.flatMap((document) => document.concepts)),
    prdIds: linksOfKind(documents, "prd"),
    planIds: linksOfKind(documents, "plan"),
    userStoryIds: linksOfKind(documents, "user-story"),
    acceptanceCriteriaIds: linksOfKind(documents, "acceptance-criteria"),
    exampleIds,
    requiredStages: exampleIds.length > 0
      ? orderedExecutionStages
      : ["implement-code", "run-tests-after-code"],
  };
}

export function executionContractFromRetrieval(retrieval: DocumentRetrieval): ExecutionContract {
  return executionContractFromDocuments(retrieval.related);
}

function documentSummariesFromUnit(unit: WorkflowUnit): KrowDocumentSummary[] {
  const context = unit.documentContext;
  if (!context || typeof context !== "object") {
    return [];
  }

  const related = (context as { related?: unknown }).related;
  if (!Array.isArray(related)) {
    return [];
  }
  return related.filter((document): document is KrowDocumentSummary => {
    return Boolean(
      document &&
      typeof document === "object" &&
      typeof (document as { ref?: unknown }).ref === "string" &&
      Array.isArray((document as { traceLinks?: unknown }).traceLinks),
    );
  });
}

export function executionContractForUnit(unit: WorkflowUnit | undefined): ExecutionContract | undefined {
  if (!unit) {
    return undefined;
  }

  if (unit.executionContract && typeof unit.executionContract === "object") {
    return unit.executionContract as ExecutionContract;
  }

  const documents = documentSummariesFromUnit(unit);
  return documents.length > 0 ? executionContractFromDocuments(documents) : undefined;
}

export function requiredExampleIdsForUnit(unit: WorkflowUnit | undefined): string[] {
  return executionContractForUnit(unit)?.exampleIds ?? [];
}

function completedStageIndex(output: ExecuteOutput, stageId: ExecutionStepId): number {
  return (output.executionSteps ?? []).findIndex((step) => step.id === stageId && step.status === "completed");
}

export function validateExecuteOutputAgainstContract(unit: WorkflowUnit | undefined, output: ExecuteOutput): string[] {
  const contract = executionContractForUnit(unit);
  if (!contract || contract.exampleIds.length === 0) {
    return [];
  }

  const issues: string[] = [];
  const coveredExamples = new Set((output.exampleTests ?? []).map((trace) => trace.exampleId));
  const missingExamples = contract.exampleIds.filter((exampleId) => !coveredExamples.has(exampleId));
  if (missingExamples.length > 0) {
    issues.push(`execute output must link tests for Examples: ${missingExamples.join(", ")}`);
  }

  const missingTestFiles = (output.exampleTests ?? []).filter((trace) => trace.testFiles.length === 0).map((trace) => trace.exampleId);
  if (missingTestFiles.length > 0) {
    issues.push(`exampleTests must include testFiles for: ${missingTestFiles.join(", ")}`);
  }

  if ((output.implementationLinks ?? []).length === 0) {
    issues.push("execute output must include implementationLinks for code changed to satisfy the Examples");
  }

  const implementationExampleIds = new Set((output.implementationLinks ?? []).flatMap((link) => link.exampleIds ?? []));
  const missingImplementationExamples = contract.exampleIds.filter((exampleId) => !implementationExampleIds.has(exampleId));
  if (missingImplementationExamples.length > 0) {
    issues.push(`implementationLinks must reference Examples: ${missingImplementationExamples.join(", ")}`);
  }

  const testsIndex = completedStageIndex(output, "tests-from-examples");
  const codeIndex = completedStageIndex(output, "implement-code");
  const finalTestIndex = completedStageIndex(output, "run-tests-after-code");
  if (testsIndex < 0) {
    issues.push("executionSteps must include completed tests-from-examples before code implementation");
  }
  if (codeIndex < 0) {
    issues.push("executionSteps must include completed implement-code after tests are created or updated");
  }
  if (finalTestIndex < 0) {
    issues.push("executionSteps must include completed run-tests-after-code");
  }
  if (testsIndex >= 0 && codeIndex >= 0 && testsIndex > codeIndex) {
    issues.push("tests-from-examples must appear before implement-code");
  }
  if (codeIndex >= 0 && finalTestIndex >= 0 && codeIndex > finalTestIndex) {
    issues.push("run-tests-after-code must appear after implement-code");
  }

  return issues;
}
