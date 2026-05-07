import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  ClarifyOutput,
  ExecuteOutput,
  LanguageGrounding,
  RuntimePhase,
  UnitReviewReport,
  VerifyOutput,
  WorkflowState,
  WorkflowUnit,
} from "./types.js";
import type { DocumentRetrieval } from "./document-contracts.js";
import {
  absolutePath,
  absoluteRoot,
  absoluteWorkflowStatePath,
  unitArtifactsDirPath,
  unitBatonPath,
  unitBriefPath,
  unitContextPath,
  unitRelayPath,
  unitReviewReportPath,
  unitResultPath,
  unitStatusPath,
  conceptIndexPath,
  conceptsDirPath,
  conceptMapPath,
  projectLanguagePath,
  templatesDirPath,
  workflowRelayRootPath,
  workflowStatePath,
  workflowTaskIndexPath,
  workflowTaskRootPath,
} from "./workflow-files.js";
import { completedUnitIds, readyUnits, unitDependencies } from "./workflow-graph.js";

function currentUnit(state: WorkflowState): WorkflowUnit | undefined {
  return state.units[state.currentUnitIndex];
}

function hydrateWorkflowState(state: WorkflowState): WorkflowState {
  if (!state.taskRoot) {
    state.taskRoot = workflowTaskRootPath(state.workflowId);
  }
  if (!state.relayRoot) {
    state.relayRoot = workflowRelayRootPath(state.workflowId);
  }
  return state;
}

function asClarifyOutput(value: unknown): ClarifyOutput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as ClarifyOutput;
}

function asExecuteOutput(value: unknown): ExecuteOutput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as ExecuteOutput;
}

function asVerifyOutput(value: unknown): VerifyOutput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as VerifyOutput;
}

function unitOutputs(state: WorkflowState, unitId: string) {
  return state.outputs[unitId] ?? {};
}

function asReviewReport(value: unknown): UnitReviewReport | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as UnitReviewReport;
}

function writeTextFile(relativePath: string, content: string, rootDir = process.cwd()): void {
  const filePath = absolutePath(relativePath, rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function markdownList(items: string[], empty = "(none)"): string[] {
  if (items.length === 0) {
    return [`- ${empty}`];
  }
  return items.map((item) => `- ${item}`);
}

function asLanguageGrounding(value: unknown): LanguageGrounding | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as LanguageGrounding;
}

function formatLanguageGrounding(value: unknown): string[] {
  const grounding = asLanguageGrounding(value);
  if (!grounding) {
    return ["- (none)"];
  }

  const lines = [
    `- Language ref: ${grounding.summary.languageRef}`,
    `- Concept index ref: ${grounding.summary.conceptIndexRef ?? "(missing)"}`,
    `- Vocabulary status: ${grounding.summary.vocabularyStatus}`,
    `- Requires clarification: ${grounding.summary.requiresClarification ? "yes" : "no"}`,
    `- Matched terms: ${grounding.summary.matchedTermCount}`,
    `- Proposed terms: ${grounding.summary.proposedTermCount}`,
    `- Related Concept Maps: ${grounding.summary.relatedConceptMapCount ?? grounding.relatedConceptMaps?.length ?? 0}`,
    `- Unresolved relations: ${grounding.summary.unresolvedRelationCount}`,
    "",
    "### Matched Terms",
    ...markdownList(
      grounding.matchedTerms.map((term) => `${term.id} (${term.namespace}) = ${term.canonical} [matched: ${term.matchedText}]`),
    ),
    "",
    "### Proposed Terms",
    ...markdownList(grounding.proposedTerms.map((term) => `${term.id} = ${term.canonical}`)),
    "",
    "### Related Concept Maps",
    ...markdownList(
      (grounding.relatedConceptMaps ?? []).map((conceptMap) => {
        const anchors = conceptMap.codeAnchors.length > 0 ? ` anchors=${conceptMap.codeAnchors.join(", ")}` : "";
        return `${conceptMap.key} -> ${conceptMap.ref} [matched: ${conceptMap.matchedText}; fields: ${conceptMap.matchFields.join(", ")}]${anchors}`;
      }),
    ),
    "",
    "### Statements",
    ...markdownList(
      grounding.statements.map(
        (statement) =>
          `${statement.subject} ${statement.relation} ${statement.object} [${statement.status}, ${statement.confidence}]`,
      ),
    ),
    "",
    "### Language Questions",
    ...markdownList(grounding.questions),
  ];

  return lines;
}

function asDocumentRetrieval(value: unknown): DocumentRetrieval | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as DocumentRetrieval;
}

function formatDocumentRetrieval(value: unknown): string[] {
  const retrieval = asDocumentRetrieval(value);
  if (!retrieval) {
    return ["- (none)"];
  }

  return [
    `- Related documents: ${retrieval.related.length}`,
    `- Approval gaps: ${retrieval.approvalGaps.length}`,
    "",
    "### Related Documents",
    ...markdownList(
      retrieval.related.map((document) => {
        const ids = document.traceLinks.map((link) => link.id).slice(0, 6);
        const idText = ids.length > 0 ? ` ids=${ids.join(", ")}` : "";
        return `${document.kind.toUpperCase()} ${document.ref} status=${document.approval.status}${idText}`;
      }),
    ),
    "",
    "### Approval Gaps",
    ...markdownList(retrieval.approvalGaps.map((document) => `${document.kind.toUpperCase()} ${document.ref} status=${document.approval.status}`)),
  ];
}

function formatUnitRuntimeStatus(state: WorkflowState, unit: WorkflowUnit): string {
  if (completedUnitIds(state).includes(unit.id)) {
    return "completed";
  }
  if (currentUnit(state)?.id === unit.id && state.status.startsWith("phase_")) {
    return "current";
  }
  if (readyUnits(state).some((candidate) => candidate.id === unit.id)) {
    return "ready";
  }
  return "pending";
}

function buildWorkflowIndex(state: WorkflowState): string {
  const lines = [
    `# Workflow ${state.workflowId}`,
    "",
    `- Description: ${state.description}`,
    `- Status: ${state.status}`,
    `- Phase: ${state.phase}`,
    `- Graph strategy: ${state.graphStrategy ?? "single"}`,
    `- State ref: ${workflowStatePath(state.workflowId)}`,
    `- Relay root: ${state.relayRoot}`,
    "",
    "## Units",
  ];

  for (const unit of state.units) {
    lines.push(`### ${unit.id} · ${unit.title}`);
    lines.push(`- Runtime status: ${formatUnitRuntimeStatus(state, unit)}`);
    lines.push(`- Kind: ${unit.kind ?? "work"}`);
    lines.push(`- Priority: ${unit.priority ?? "medium"}`);
    lines.push(`- Estimated effort: ${unit.estimatedEffort ?? "medium"}`);
    lines.push(`- Brief: ${unitBriefPath(state.workflowId, unit.id)}`);
    lines.push(`- Context: ${unitContextPath(state.workflowId, unit.id)}`);
    lines.push(`- Status: ${unitStatusPath(state.workflowId, unit.id)}`);
    lines.push(`- Result: ${unitResultPath(state.workflowId, unit.id)}`);
    lines.push(`- Baton: ${unitBatonPath(state.workflowId, unit.id)}`);
    lines.push(`- Relay: ${unitRelayPath(state.workflowId, unit.id)}`);
    if ((unit.dependsOn?.length ?? 0) > 0) {
      lines.push(`- Depends on: ${unit.dependsOn!.join(", ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function buildUnitBrief(state: WorkflowState, unit: WorkflowUnit): string {
  const lines = [
    `# ${unit.id} · ${unit.title}`,
    "",
    `- Workflow: ${state.workflowId}`,
    `- Workflow index: ${workflowTaskIndexPath(state.workflowId)}`,
    `- State ref: ${workflowStatePath(state.workflowId)}`,
    `- Kind: ${unit.kind ?? "work"}`,
    `- Priority: ${unit.priority ?? "medium"}`,
    `- Estimated effort: ${unit.estimatedEffort ?? "medium"}`,
    `- Parallelizable: ${unit.parallelizable === true ? "yes" : "no"}`,
    `- Merge required: ${unit.mergeRequired === true ? "yes" : "no"}`,
    `- Status ref: ${unitStatusPath(state.workflowId, unit.id)}`,
    `- Result ref: ${unitResultPath(state.workflowId, unit.id)}`,
    `- Baton ref: ${unitBatonPath(state.workflowId, unit.id)}`,
    `- Relay ref: ${unitRelayPath(state.workflowId, unit.id)}`,
    "",
    "## Request",
    unit.request ?? state.description,
    "",
    "## Language Grounding",
    ...formatLanguageGrounding(unit.languageGrounding),
    "",
    "## Document Context",
    ...formatDocumentRetrieval(unit.documentContext),
    "",
    "## Scope",
    ...markdownList(unit.scope ?? []),
    "",
    "## Ownership",
    ...markdownList(unit.ownership ?? []),
    "",
    "## Acceptance Criteria",
    ...markdownList(unit.acceptanceCriteria ?? []),
    "",
    "## Shared Risks",
    ...markdownList(unit.sharedRisks ?? []),
    "",
    "## Dependencies",
    ...markdownList(unitDependencies(unit).map((dependencyId) => `${dependencyId} -> ${unitRelayPath(state.workflowId, dependencyId)}`)),
  ];

  return `${lines.join("\n")}\n`;
}

function buildUnitContext(state: WorkflowState, unit: WorkflowUnit, rootDir = process.cwd()): string {
  const languagePath = projectLanguagePath();
  const languageExists = existsSync(absolutePath(languagePath, rootDir));
  const lines = [
    `# Context for ${unit.id}`,
    "",
    "## Project Language",
    `- Ref: ${languagePath}`,
    `- Status: ${languageExists ? "present" : "missing"}`,
    "- Use: read this file when wording, domain terms, module names, or local architectural language matter.",
    "- Rule: treat this as controlled vocabulary plus evidence, not a layer-by-layer translation map.",
    "- Rule: keep temporary language proposals in this task packet; only promote durable approved terms to the project language file.",
    "",
    "## Grounding Snapshot",
    ...formatLanguageGrounding(unit.languageGrounding),
    "",
    "## Document Context",
    ...formatDocumentRetrieval(unit.documentContext),
    "",
    "## Anchors",
    `- Files: ${(unit.anchors?.filePaths ?? []).join(", ") || "(none)"}`,
    `- Symbols: ${(unit.anchors?.symbols ?? []).join(", ") || "(none)"}`,
    `- Errors: ${(unit.anchors?.errors ?? []).join(", ") || "(none)"}`,
    `- Tests: ${(unit.anchors?.tests ?? []).join(", ") || "(none)"}`,
    `- Verification surfaces: ${(unit.anchors?.verificationSurfaces ?? []).join(", ") || "(none)"}`,
    `- Tickets: ${(unit.anchors?.tickets ?? []).join(", ") || "(none)"}`,
    "",
    "## Intake Notes",
    ...markdownList(unit.intakeNotes ?? []),
    "",
    "## Intake Intents",
    ...markdownList(
      (unit.intakeIntents ?? []).map((intent) => {
        const targets = intent.targets?.length ? ` targets=${intent.targets.join(", ")}` : "";
        const query = intent.query ? ` query=${intent.query}` : "";
        return `${intent.kind} [${intent.priority}]${targets}${query} :: ${intent.reason}`;
      }),
    ),
    "",
    "## Decision History",
    ...markdownList(
      state.decisionHistory.map((answer) =>
        `${answer.decisionId} -> ${answer.selectedOptionId}${answer.customInput ? ` :: ${answer.customInput}` : ""}`,
      ),
    ),
    "",
    "## Upstream Relays",
    ...markdownList(unitDependencies(unit).map((dependencyId) => unitRelayPath(state.workflowId, dependencyId))),
  ];

  if ((state.graphNotes?.length ?? 0) > 0) {
    lines.push("", "## Graph Notes", ...markdownList(state.graphNotes ?? []));
  }

  return `${lines.join("\n")}\n`;
}

function buildUnitStatus(state: WorkflowState, unit: WorkflowUnit): string {
  const readySiblingIds = readyUnits(state)
    .filter((candidate) => candidate.id !== unit.id)
    .map((candidate) => candidate.id);

  const lines = [
    `# Status for ${unit.id}`,
    "",
    `- Runtime status: ${formatUnitRuntimeStatus(state, unit)}`,
    `- Workflow status: ${state.status}`,
    `- Phase: ${state.phase}`,
    `- Updated at: ${state.updatedAt}`,
    `- Verify attempts: ${state.verifyAttempts} / ${state.maxVerifyAttempts}`,
    `- Current unit: ${currentUnit(state)?.id === unit.id ? "yes" : "no"}`,
    "",
    "## Ready Siblings",
    ...markdownList(readySiblingIds),
    "",
    "## Pending Decisions",
    ...markdownList(
      state.pendingDecisions.map((decision) =>
        `${decision.id}: ${decision.question}${decision.context ? ` :: ${decision.context}` : ""}`,
      ),
    ),
    "",
    "## Decision History",
    ...markdownList(
      state.decisionHistory.map((answer) =>
        `${answer.decisionId} -> ${answer.selectedOptionId}${answer.customInput ? ` :: ${answer.customInput}` : ""}`,
      ),
    ),
  ];

  if (state.blockedReason) {
    lines.push("", "## Blocked Reason", state.blockedReason);
  }

  if ((state.lastVerifyIssues?.length ?? 0) > 0 && currentUnit(state)?.id === unit.id) {
    lines.push("", "## Last Verify Issues", ...markdownList(state.lastVerifyIssues!.map((issue) => `${issue.severity} ${issue.category}: ${issue.description}`)));
  }

  return `${lines.join("\n")}\n`;
}

function buildUnitResult(state: WorkflowState, unit: WorkflowUnit): string {
  const outputs = unitOutputs(state, unit.id);
  const clarify = asClarifyOutput(outputs.clarify);
  const execute = asExecuteOutput(outputs.execute);
  const verify = asVerifyOutput(outputs.verify);
  const reviewReport = asReviewReport(outputs.reviewReport);

  const lines = [`# Result for ${unit.id}`, ""];

  if (clarify) {
    lines.push("## Clarify");
    lines.push(clarify.summary, "");
    lines.push("### Evidence", ...markdownList(clarify.evidence), "");
    lines.push("### Acceptance Criteria", ...markdownList(clarify.acceptanceCriteria), "");
    lines.push("### Assumptions", ...markdownList(clarify.assumptions), "");
  } else {
    lines.push("## Clarify", "(not completed yet)", "");
  }

  if (execute) {
    lines.push("## Execute");
    lines.push(execute.summary, "");
    lines.push("### Changed Files", ...markdownList(execute.changedFiles ?? []), "");
    lines.push("### Output Files", ...markdownList(execute.outputFiles ?? []), "");
    lines.push("### Artifacts", ...markdownList(execute.artifacts ?? []), "");
    lines.push("### Checks", ...markdownList(execute.checks ?? []), "");
    lines.push(
      "### Execution Steps",
      ...markdownList((execute.executionSteps ?? []).map((step) => `${step.id}: ${step.status} - ${step.evidence}`)),
      "",
    );
    lines.push(
      "### Example Tests",
      ...markdownList(
        (execute.exampleTests ?? []).map((trace) =>
          `${trace.exampleId} -> ${trace.status}; files=${trace.testFiles.join(", ")}${trace.testNames?.length ? `; names=${trace.testNames.join(", ")}` : ""}`,
        ),
      ),
      "",
    );
    lines.push(
      "### Implementation Links",
      ...markdownList(
        (execute.implementationLinks ?? []).map((link) =>
          `${(link.exampleIds ?? []).join(", ") || "(examples unspecified)"} -> ${link.codeFiles.join(", ")}${link.planIds?.length ? `; plans=${link.planIds.join(", ")}` : ""}${link.notes ? `; ${link.notes}` : ""}`,
        ),
      ),
      "",
    );
    lines.push("### Handoff Notes", ...markdownList(execute.handoffNotes ?? []), "");
    lines.push("### Notes", ...markdownList(execute.notes ?? []), "");
  } else {
    lines.push("## Execute", "(not completed yet)", "");
  }

  if (verify) {
    lines.push("## Verify");
    lines.push(`- Passed: ${verify.passed ? "yes" : "no"}`);
    lines.push(`- Summary: ${verify.summary}`);
    if (verify.score) {
      lines.push(
        `- Score: accuracy=${verify.score.accuracy}, completeness=${verify.score.completeness}, consistency=${verify.score.consistency}`,
      );
    }
    lines.push("", "### Checks", ...markdownList(
      verify.checks.map((check) =>
        `${check.status.toUpperCase()} ${check.name}${check.command ? ` [${check.command}]` : ""}: ${check.evidence}`,
      ),
    ), "");
    lines.push("### Evidence", ...markdownList(verify.evidence), "");
    lines.push("### Issues", ...markdownList(verify.issues.map((issue) => `${issue.severity} ${issue.category}: ${issue.description}`)), "");
    lines.push("### Unverified Claims", ...markdownList(verify.unverifiedClaims ?? []), "");
  } else {
    lines.push("## Verify", "(not completed yet)", "");
  }

  if (reviewReport) {
    lines.push("## Review Report");
    lines.push(`- Ref: ${reviewReport.ref}`);
    lines.push(`- Review ID: ${reviewReport.reviewId}`);
    lines.push(`- Generated at: ${reviewReport.generatedAt}`);
    lines.push("", "### Gaps", ...markdownList(reviewReport.gaps), "");
  } else {
    lines.push("## Review Report", "(not generated yet)", "");
  }

  return `${lines.join("\n")}\n`;
}

function buildUnitBaton(state: WorkflowState, unit: WorkflowUnit): string {
  const outputs = unitOutputs(state, unit.id);
  const clarify = asClarifyOutput(outputs.clarify);
  const execute = asExecuteOutput(outputs.execute);
  const verify = asVerifyOutput(outputs.verify);
  const downstreamUnits = state.units.filter((candidate) => unitDependencies(candidate).includes(unit.id));

  const lines = [
    `# Baton for ${unit.id}`,
    "",
    `- Title: ${unit.title}`,
    `- Workflow: ${state.workflowId}`,
    `- Status: ${formatUnitRuntimeStatus(state, unit)}`,
    `- Result ref: ${unitResultPath(state.workflowId, unit.id)}`,
    "",
    "## Carry Forward",
    ...markdownList([
      clarify?.summary ?? "clarify not completed",
      execute?.summary ?? "execute not completed",
      verify?.summary ?? "verify not completed",
    ]),
    "",
    "## Changed Files",
    ...markdownList(execute?.changedFiles ?? []),
    "",
    "## Acceptance Criteria",
    ...markdownList(clarify?.acceptanceCriteria ?? unit.acceptanceCriteria ?? []),
    "",
    "## Handoff Notes",
    ...markdownList(execute?.handoffNotes ?? []),
    "",
    "## Review Report",
    asReviewReport(outputs.reviewReport)?.ref ?? "(not generated yet)",
    "",
    "## Downstream Units",
    ...markdownList(downstreamUnits.map((candidate) => `${candidate.id} -> ${unitBriefPath(state.workflowId, candidate.id)}`)),
  ];

  return `${lines.join("\n")}\n`;
}

function syncWorkflowTaskPackets(state: WorkflowState, rootDir = process.cwd()): void {
  writeTextFile(workflowTaskIndexPath(state.workflowId), buildWorkflowIndex(state), rootDir);

  for (const unit of state.units) {
    mkdirSync(absolutePath(unitArtifactsDirPath(state.workflowId, unit.id), rootDir), { recursive: true });
    writeTextFile(unitBriefPath(state.workflowId, unit.id), buildUnitBrief(state, unit), rootDir);
    writeTextFile(unitContextPath(state.workflowId, unit.id), buildUnitContext(state, unit, rootDir), rootDir);
    writeTextFile(unitStatusPath(state.workflowId, unit.id), buildUnitStatus(state, unit), rootDir);
    writeTextFile(unitResultPath(state.workflowId, unit.id), buildUnitResult(state, unit), rootDir);

    const baton = buildUnitBaton(state, unit);
    writeTextFile(unitBatonPath(state.workflowId, unit.id), baton, rootDir);
    writeTextFile(unitRelayPath(state.workflowId, unit.id), baton, rootDir);
  }
}

export function touchUpdatedAt(timestamp: string): string {
  return timestamp;
}

export function saveWorkflowState(state: WorkflowState, rootDir = process.cwd()): string {
  state.taskRoot = workflowTaskRootPath(state.workflowId);
  state.relayRoot = workflowRelayRootPath(state.workflowId);

  const filePath = absoluteWorkflowStatePath(state.workflowId, rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2));
  syncWorkflowTaskPackets(state, rootDir);
  return filePath;
}

export function loadWorkflowState(workflowId: string, rootDir = process.cwd()): WorkflowState {
  const filePath = absoluteWorkflowStatePath(workflowId, rootDir);
  return hydrateWorkflowState(JSON.parse(readFileSync(filePath, "utf8")) as WorkflowState);
}

export function saveState(state: WorkflowState, rootDir = process.cwd()): void {
  state.updatedAt = new Date().toISOString();
  saveWorkflowState(state, rootDir);
}

export function loadState(workflowId: string, rootDir = process.cwd()): WorkflowState | null {
  const filePath = absoluteWorkflowStatePath(workflowId, rootDir);
  if (!existsSync(filePath)) {
    return null;
  }
  return hydrateWorkflowState(JSON.parse(readFileSync(filePath, "utf8")) as WorkflowState);
}

export function listStates(rootDir = process.cwd()): WorkflowState[] {
  const dir = path.join(absoluteRoot(rootDir), path.dirname(workflowStatePath("placeholder")));
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => {
      try {
        return hydrateWorkflowState(JSON.parse(readFileSync(path.join(dir, entry), "utf8")) as WorkflowState);
      } catch {
        return null;
      }
    })
    .filter((state): state is WorkflowState => state !== null)
    .filter((state) => state.status !== "completed" && state.status !== "stopped")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export {
  absoluteRoot,
  absoluteWorkflowStatePath,
  workflowStatePath,
  workflowTaskRootPath,
  workflowTaskIndexPath,
  workflowRelayRootPath,
  unitBriefPath,
  unitContextPath,
  unitStatusPath,
  unitResultPath,
  unitBatonPath,
  unitRelayPath,
  unitReviewReportPath,
  projectLanguagePath,
  conceptIndexPath,
  conceptsDirPath,
  conceptMapPath,
  templatesDirPath,
};
