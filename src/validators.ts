import type {
  CaptureOutput,
  ClarifyOutput,
  DecisionAnswer,
  DecisionPrompt,
  ExecuteOutput,
  RuntimePhase,
  ValidationResult,
  VerifyOutput,
  VerifyIssue,
  WorkflowState,
  WorkflowStatus,
} from "./types.js";
import { inferGraphStrategy, unitDependencies } from "./workflow-graph.js";

const validStatuses: WorkflowStatus[] = [
  "phase_clarify",
  "clarify_pending",
  "phase_execute",
  "phase_verify",
  "phase_capture",
  "completed",
  "blocked",
  "stopped",
];

const validPhases: RuntimePhase[] = ["clarify", "execute", "verify", "capture"];
const validScoreKeys = ["accuracy", "completeness", "consistency"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function validateWorkflowUnits(value: unknown): string[] {
  const issues: string[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    return ["units must be a non-empty array"];
  }

  const unitIds: string[] = [];

  value.forEach((unit, index) => {
    const path = `units[${index}]`;
    if (!isRecord(unit)) {
      issues.push(`${path} must be an object`);
      return;
    }

    if (!isNonEmptyString(unit.id)) {
      issues.push(`${path}.id must be a non-empty string`);
    } else {
      unitIds.push(unit.id);
    }

    if (!isNonEmptyString(unit.title)) {
      issues.push(`${path}.title must be a non-empty string`);
    }

    if (unit.kind !== undefined && unit.kind !== "work" && unit.kind !== "integration") {
      issues.push(`${path}.kind must be 'work' or 'integration' when present`);
    }

    if (unit.request !== undefined && !isNonEmptyString(unit.request)) {
      issues.push(`${path}.request must be a non-empty string when present`);
    }

    if (unit.scope !== undefined && !isStringArray(unit.scope)) {
      issues.push(`${path}.scope must be an array of non-empty strings when present`);
    }

    if (unit.ownership !== undefined && !isStringArray(unit.ownership)) {
      issues.push(`${path}.ownership must be an array of non-empty strings when present`);
    }

    if (unit.priority !== undefined && unit.priority !== "high" && unit.priority !== "medium" && unit.priority !== "low") {
      issues.push(`${path}.priority must be 'high', 'medium', or 'low' when present`);
    }

    if (
      unit.estimatedEffort !== undefined &&
      unit.estimatedEffort !== "small" &&
      unit.estimatedEffort !== "medium" &&
      unit.estimatedEffort !== "large"
    ) {
      issues.push(`${path}.estimatedEffort must be 'small', 'medium', or 'large' when present`);
    }

    if (unit.mergeRequired !== undefined && typeof unit.mergeRequired !== "boolean") {
      issues.push(`${path}.mergeRequired must be a boolean when present`);
    }

    if (unit.sharedRisks !== undefined && !isStringArray(unit.sharedRisks)) {
      issues.push(`${path}.sharedRisks must be an array of non-empty strings when present`);
    }

    if (unit.acceptanceCriteria !== undefined && !isStringArray(unit.acceptanceCriteria)) {
      issues.push(`${path}.acceptanceCriteria must be an array of non-empty strings when present`);
    }

    if (unit.verifyFocus !== undefined && !isStringArray(unit.verifyFocus)) {
      issues.push(`${path}.verifyFocus must be an array of non-empty strings when present`);
    }

    if (unit.dependsOn !== undefined && !isStringArray(unit.dependsOn)) {
      issues.push(`${path}.dependsOn must be an array of non-empty strings when present`);
    }

    if (unit.parallelizable !== undefined && typeof unit.parallelizable !== "boolean") {
      issues.push(`${path}.parallelizable must be a boolean when present`);
    }
  });

  const duplicates = unitIds.filter((id, index) => unitIds.indexOf(id) !== index);
  duplicates.forEach((id) => issues.push(`duplicate unit id: ${id}`));

  const uniqueIds = new Set(unitIds);
  value.forEach((unit, index) => {
    if (!isRecord(unit) || !isNonEmptyString(unit.id)) {
      return;
    }

    const path = `units[${index}]`;
    const dependencies = unitDependencies(unit as unknown as { dependsOn?: string[] });
    dependencies.forEach((dependencyId) => {
      if (!uniqueIds.has(dependencyId)) {
        issues.push(`${path}.dependsOn references unknown unit: ${dependencyId}`);
      }
      if (dependencyId === unit.id) {
        issues.push(`${path}.dependsOn cannot include the unit itself`);
      }
    });
  });

  if (issues.length > 0) {
    return issues;
  }

  const units = value as Array<{ id: string; dependsOn?: string[] }>;
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));

  function visit(unitId: string): void {
    if (visited.has(unitId) || issues.length > 0) {
      return;
    }
    if (visiting.has(unitId)) {
      issues.push(`unit dependency cycle detected at ${unitId}`);
      return;
    }

    visiting.add(unitId);
    const unit = unitMap.get(unitId);
    if (unit) {
      for (const dependencyId of unitDependencies(unit as unknown as { dependsOn?: string[] })) {
        visit(dependencyId);
      }
    }
    visiting.delete(unitId);
    visited.add(unitId);
  }

  unitIds.forEach(visit);
  return issues;
}

function validateDecisionPrompts(value: unknown, path: string): string[] {
  const issues: string[] = [];
  if (!Array.isArray(value)) {
    return [`${path} must be an array`];
  }

  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${itemPath} must be an object`);
      return;
    }
    if (!isNonEmptyString(item.id)) {
      issues.push(`${itemPath}.id must be a non-empty string`);
    }
    if (!isNonEmptyString(item.question)) {
      issues.push(`${itemPath}.question must be a non-empty string`);
    }
    if (!Array.isArray(item.options) || item.options.length === 0) {
      issues.push(`${itemPath}.options must be a non-empty array`);
      return;
    }
    item.options.forEach((option, optionIndex) => {
      const optionPath = `${itemPath}.options[${optionIndex}]`;
      if (!isRecord(option)) {
        issues.push(`${optionPath} must be an object`);
        return;
      }
      if (!isNonEmptyString(option.id)) {
        issues.push(`${optionPath}.id must be a non-empty string`);
      }
      if (!isNonEmptyString(option.label)) {
        issues.push(`${optionPath}.label must be a non-empty string`);
      }
      if (option.description !== undefined && !isNonEmptyString(option.description)) {
        issues.push(`${optionPath}.description must be a non-empty string when present`);
      }
    });
  });

  return issues;
}

function validateVerifyIssues(value: unknown, path: string): string[] {
  const issues: string[] = [];
  if (!Array.isArray(value)) {
    return [`${path} must be an array`];
  }

  value.forEach((issue, index) => {
    const issuePath = `${path}[${index}]`;
    if (!isRecord(issue)) {
      issues.push(`${issuePath} must be an object`);
      return;
    }
    if (issue.severity !== "error" && issue.severity !== "warning") {
      issues.push(`${issuePath}.severity must be 'error' or 'warning'`);
    }
    if (!isNonEmptyString(issue.category)) {
      issues.push(`${issuePath}.category must be a non-empty string`);
    }
    if (!isNonEmptyString(issue.description)) {
      issues.push(`${issuePath}.description must be a non-empty string`);
    }
    if (issue.suggestion !== undefined && !isNonEmptyString(issue.suggestion)) {
      issues.push(`${issuePath}.suggestion must be a non-empty string when present`);
    }
  });

  return issues;
}

export function validateClarifyOutput(value: unknown): ValidationResult<ClarifyOutput> {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["clarify output must be an object"] };
  }
  if (typeof value.ready !== "boolean") {
    issues.push("ready must be a boolean");
  }
  if (!isNonEmptyString(value.summary)) {
    issues.push("summary must be a non-empty string");
  }
  if (!isStringArray(value.assumptions)) {
    issues.push("assumptions must be an array of non-empty strings");
  }
  if (!isStringArray(value.evidence)) {
    issues.push("evidence must be an array of non-empty strings");
  }
  if (!isStringArray(value.acceptanceCriteria)) {
    issues.push("acceptanceCriteria must be an array of non-empty strings");
  }
  if (value.verifyFocus !== undefined && !isStringArray(value.verifyFocus)) {
    issues.push("verifyFocus must be an array of non-empty strings when present");
  }
  issues.push(...validateDecisionPrompts(value.decisions, "decisions"));
  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as ClarifyOutput }
    : { ok: false, issues };
}

export function validateDecisionAnswers(value: unknown): ValidationResult<DecisionAnswer[]> {
  const issues: string[] = [];
  if (!Array.isArray(value)) {
    return { ok: false, issues: ["decision answers must be an array"] };
  }
  value.forEach((item, index) => {
    const path = `decisionAnswers[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} must be an object`);
      return;
    }
    if (!isNonEmptyString(item.decisionId)) {
      issues.push(`${path}.decisionId must be a non-empty string`);
    }
    if (!isNonEmptyString(item.selectedOptionId)) {
      issues.push(`${path}.selectedOptionId must be a non-empty string`);
    }
    if (item.customInput !== undefined && !isNonEmptyString(item.customInput)) {
      issues.push(`${path}.customInput must be a non-empty string when present`);
    }
  });
  return issues.length === 0
    ? { ok: true, issues: [], value: value as DecisionAnswer[] }
    : { ok: false, issues };
}

export function validateExecuteOutput(value: unknown): ValidationResult<ExecuteOutput> {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["execute output must be an object"] };
  }
  if (!isNonEmptyString(value.summary)) {
    issues.push("summary must be a non-empty string");
  }
  if (value.changedFiles !== undefined && !isStringArray(value.changedFiles)) {
    issues.push("changedFiles must be an array of non-empty strings when present");
  }
  if (value.outputFiles !== undefined && !isStringArray(value.outputFiles)) {
    issues.push("outputFiles must be an array of non-empty strings when present");
  }
  if (value.artifacts !== undefined && !isStringArray(value.artifacts)) {
    issues.push("artifacts must be an array of non-empty strings when present");
  }
  if (value.checks !== undefined && !isStringArray(value.checks)) {
    issues.push("checks must be an array of non-empty strings when present");
  }
  if (value.handoffNotes !== undefined && !isStringArray(value.handoffNotes)) {
    issues.push("handoffNotes must be an array of non-empty strings when present");
  }
  if (value.notes !== undefined && !isStringArray(value.notes)) {
    issues.push("notes must be an array of non-empty strings when present");
  }

  const hasPayload =
    (Array.isArray(value.changedFiles) && value.changedFiles.length > 0) ||
    (Array.isArray(value.outputFiles) && value.outputFiles.length > 0) ||
    (Array.isArray(value.artifacts) && value.artifacts.length > 0);

  if (!hasPayload) {
    issues.push("execute output must include changedFiles, outputFiles, or artifacts");
  }

  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as ExecuteOutput }
    : { ok: false, issues };
}

export function validateVerifyOutput(value: unknown): ValidationResult<VerifyOutput> {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["verify output must be an object"] };
  }
  if (typeof value.passed !== "boolean") {
    issues.push("passed must be a boolean");
  }
  if (!Array.isArray(value.checks)) {
    issues.push("checks must be an array");
  } else {
    value.checks.forEach((check, index) => {
      const path = `checks[${index}]`;
      if (!isRecord(check)) {
        issues.push(`${path} must be an object`);
        return;
      }
      if (!isNonEmptyString(check.name)) {
        issues.push(`${path}.name must be a non-empty string`);
      }
      if (check.status !== "passed" && check.status !== "failed" && check.status !== "skipped") {
        issues.push(`${path}.status must be 'passed', 'failed', or 'skipped'`);
      }
      if (check.command !== undefined && !isNonEmptyString(check.command)) {
        issues.push(`${path}.command must be a non-empty string when present`);
      }
      if (!isNonEmptyString(check.evidence)) {
        issues.push(`${path}.evidence must be a non-empty string`);
      }
    });
  }
  if (!isStringArray(value.evidence)) {
    issues.push("evidence must be an array of non-empty strings");
  }
  issues.push(...validateVerifyIssues(value.issues, "issues"));
  if (!isNonEmptyString(value.summary)) {
    issues.push("summary must be a non-empty string");
  }
  if (value.score !== undefined) {
    if (!isRecord(value.score)) {
      issues.push("score must be an object when present");
    } else {
      validScoreKeys.forEach((key) => {
        const scoreMap = value.score as Record<string, unknown>;
        const score = scoreMap[key];
        if (typeof score !== "number" || score < 0 || score > 100) {
          issues.push(`score.${key} must be a number between 0 and 100`);
        }
      });
    }
  }
  if (value.needsHuman !== undefined && typeof value.needsHuman !== "boolean") {
    issues.push("needsHuman must be a boolean when present");
  }
  if (value.retryHint !== undefined && !isNonEmptyString(value.retryHint)) {
    issues.push("retryHint must be a non-empty string when present");
  }
  if (value.unverifiedClaims !== undefined && !isStringArray(value.unverifiedClaims)) {
    issues.push("unverifiedClaims must be an array of non-empty strings when present");
  }
  if (value.decisions !== undefined) {
    issues.push(...validateDecisionPrompts(value.decisions, "decisions"));
  }

  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as VerifyOutput }
    : { ok: false, issues };
}

export function validateCaptureOutput(value: unknown): ValidationResult<CaptureOutput> {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["capture output must be an object"] };
  }
  if (!Array.isArray(value.entries)) {
    issues.push("entries must be an array");
  } else {
    value.entries.forEach((entry, index) => {
      const path = `entries[${index}]`;
      if (!isRecord(entry)) {
        issues.push(`${path} must be an object`);
        return;
      }
      if (!isNonEmptyString(entry.filename)) {
        issues.push(`${path}.filename must be a non-empty string`);
      }
      if (!isNonEmptyString(entry.content)) {
        issues.push(`${path}.content must be a non-empty string`);
      }
      if (!isNonEmptyString(entry.reason)) {
        issues.push(`${path}.reason must be a non-empty string`);
      }
      if (entry.action !== undefined && entry.action !== "create" && entry.action !== "update") {
        issues.push(`${path}.action must be 'create' or 'update' when present`);
      }
    });
  }
  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as CaptureOutput }
    : { ok: false, issues };
}

export function validateWorkflowState(value: unknown): ValidationResult<WorkflowState> {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: ["workflow state must be an object"] };
  }

  const stringFields = [
    "schemaVersion",
    "workflowId",
    "mode",
    "description",
    "status",
    "phase",
    "taskRoot",
    "relayRoot",
    "createdAt",
    "updatedAt",
  ] as const;

  stringFields.forEach((field) => {
    if (!isNonEmptyString(value[field])) {
      issues.push(`${field} must be a non-empty string`);
    }
  });

  issues.push(...validateWorkflowUnits(value.units));

  if (typeof value.currentUnitIndex !== "number" || value.currentUnitIndex < 0) {
    issues.push("currentUnitIndex must be a non-negative number");
  } else if (Array.isArray(value.units) && value.currentUnitIndex >= value.units.length) {
    issues.push("currentUnitIndex must point to an existing unit");
  }

  if (typeof value.captureEnabled !== "boolean") {
    issues.push("captureEnabled must be a boolean");
  }
  if (typeof value.maxVerifyAttempts !== "number" || value.maxVerifyAttempts < 1) {
    issues.push("maxVerifyAttempts must be a positive number");
  }
  if (typeof value.verifyAttempts !== "number" || value.verifyAttempts < 0) {
    issues.push("verifyAttempts must be a non-negative number");
  }
  if (!Array.isArray(value.pendingDecisions)) {
    issues.push("pendingDecisions must be an array");
  } else {
    issues.push(...validateDecisionPrompts(value.pendingDecisions, "pendingDecisions"));
  }

  if (!Array.isArray(value.decisionHistory)) {
    issues.push("decisionHistory must be an array");
  } else {
    value.decisionHistory.forEach((item, index) => {
      const path = `decisionHistory[${index}]`;
      if (!isRecord(item)) {
        issues.push(`${path} must be an object`);
        return;
      }
      if (!isNonEmptyString(item.decisionId)) {
        issues.push(`${path}.decisionId must be a non-empty string`);
      }
      if (!isNonEmptyString(item.selectedOptionId)) {
        issues.push(`${path}.selectedOptionId must be a non-empty string`);
      }
      if (item.customInput !== undefined && !isNonEmptyString(item.customInput)) {
        issues.push(`${path}.customInput must be a non-empty string when present`);
      }
    });
  }

  if (!isRecord(value.outputs)) {
    issues.push("outputs must be an object");
  }

  if (
    value.graphStrategy !== undefined &&
    value.graphStrategy !== "single" &&
    value.graphStrategy !== "serial" &&
    value.graphStrategy !== "parallel_fanout"
  ) {
    issues.push("graphStrategy must be 'single', 'serial', or 'parallel_fanout' when present");
  }

  if (value.graphNotes !== undefined && !isStringArray(value.graphNotes)) {
    issues.push("graphNotes must be an array of non-empty strings when present");
  }

  if (value.lastVerifyIssues !== undefined) {
    issues.push(...validateVerifyIssues(value.lastVerifyIssues, "lastVerifyIssues"));
  }

  if (!validStatuses.includes(value.status as WorkflowStatus)) {
    issues.push("status must be one of the canonical workflow statuses");
  }

  if (!validPhases.includes(value.phase as RuntimePhase)) {
    issues.push("phase must be one of the canonical workflow phases");
  }

  if (Array.isArray(value.units) && value.graphStrategy === undefined) {
    const inferredStrategy = inferGraphStrategy(value.units as WorkflowState["units"]);
    if (inferredStrategy === "parallel_fanout" && Array.isArray(value.units) && value.units.length < 2) {
      issues.push("parallel_fanout requires multiple workflow units");
    }
  }

  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as WorkflowState }
    : { ok: false, issues };
}

export function validateDecisionPromptArray(value: unknown): ValidationResult<DecisionPrompt[]> {
  const issues = validateDecisionPrompts(value, "decisions");
  return issues.length === 0
    ? { ok: true, issues: [], value: value as DecisionPrompt[] }
    : { ok: false, issues };
}

export function validateVerifyIssueArray(value: unknown): ValidationResult<VerifyIssue[]> {
  const issues = validateVerifyIssues(value, "issues");
  return issues.length === 0
    ? { ok: true, issues: [], value: value as VerifyIssue[] }
    : { ok: false, issues };
}
