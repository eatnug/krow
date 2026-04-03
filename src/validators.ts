import type {
  ClarifyOutput,
  PlanOutput,
  ExecuteOutput,
  VerifyOutput,
  WorkItem,
  DecisionAnswer,
  WorkflowState,
  ValidationResult,
} from "./types.js";

// ============================================================================
// Helpers
// ============================================================================

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function fail<T>(issues: string[]): ValidationResult<T> {
  return { ok: false, issues };
}

function pass<T>(value: T): ValidationResult<T> {
  return { ok: true, issues: [], value };
}

// ============================================================================
// Work Items Validator
// ============================================================================

export function validateWorkItems(input: unknown): ValidationResult<WorkItem[]> {
  if (!isArray(input)) return fail(["work items must be an array"]);
  if (input.length === 0) return fail(["work items must not be empty"]);

  const issues: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    if (!isObject(item)) { issues.push(`items[${i}] must be an object`); continue; }
    if (!isString(item.id)) issues.push(`items[${i}].id must be a string`);
    if (!isString(item.role)) issues.push(`items[${i}].role must be a string`);
    if (!isString(item.task)) issues.push(`items[${i}].task must be a string`);
  }

  if (issues.length > 0) return fail(issues);
  return pass(input as unknown as WorkItem[]);
}

/** Check if work items are all completed inline (have results) */
export function allItemsHaveResults(items: WorkItem[]): boolean {
  return items.every((item) => item.result !== undefined);
}

// ============================================================================
// Phase Output Validators (for final/synthesized outputs)
// ============================================================================

export function validateClarifyOutput(input: unknown): ValidationResult<ClarifyOutput> {
  const issues: string[] = [];
  if (!isObject(input)) return fail(["clarify output must be an object"]);

  if (typeof input.ready !== "boolean") issues.push("ready must be a boolean");
  if (!isString(input.summary) || input.summary.length === 0) issues.push("summary must be a non-empty string");
  if (!isArray(input.assumptions)) issues.push("assumptions must be an array");
  if (!isArray(input.decisions)) issues.push("decisions must be an array");

  if (!input.ready && isArray(input.decisions) && input.decisions.length === 0) {
    issues.push("ready=false requires at least one decision");
  }

  if (isArray(input.decisions)) {
    for (let i = 0; i < input.decisions.length; i++) {
      const d = input.decisions[i];
      if (!isObject(d)) { issues.push(`decisions[${i}] must be an object`); continue; }
      if (!isString(d.id)) issues.push(`decisions[${i}].id must be a string`);
      if (!isString(d.question)) issues.push(`decisions[${i}].question must be a string`);
      if (!isArray(d.options) || d.options.length === 0) issues.push(`decisions[${i}].options must be a non-empty array`);
    }
  }

  if (issues.length > 0) return fail(issues);
  return pass(input as unknown as ClarifyOutput);
}

export function validatePlanOutput(input: unknown): ValidationResult<PlanOutput> {
  const issues: string[] = [];
  if (!isObject(input)) return fail(["plan output must be an object"]);

  if (!isArray(input.tasks) || input.tasks.length === 0) {
    issues.push("tasks must be a non-empty array");
  } else {
    for (let i = 0; i < input.tasks.length; i++) {
      const t = input.tasks[i];
      if (!isObject(t)) { issues.push(`tasks[${i}] must be an object`); continue; }
      if (!isString(t.id)) issues.push(`tasks[${i}].id must be a string`);
      if (!isString(t.title)) issues.push(`tasks[${i}].title must be a string`);
      if (!isArray(t.scope) && !isString(t.scope)) issues.push(`tasks[${i}].scope must be an array or string`);
    }
  }

  if (!isString(input.approach) || input.approach.length === 0) issues.push("approach must be a non-empty string");
  if (!isArray(input.risks)) issues.push("risks must be an array");

  if (issues.length > 0) return fail(issues);
  return pass(input as unknown as PlanOutput);
}

export function validateExecuteOutput(input: unknown): ValidationResult<ExecuteOutput> {
  const issues: string[] = [];
  if (!isObject(input)) return fail(["execute output must be an object"]);

  if (!isString(input.summary) || input.summary.length === 0) issues.push("summary must be a non-empty string");
  if (!isArray(input.changedFiles)) issues.push("changedFiles must be an array");
  if (!isArray(input.notes)) issues.push("notes must be an array");

  if (issues.length > 0) return fail(issues);
  return pass(input as unknown as ExecuteOutput);
}

export function validateVerifyOutput(input: unknown): ValidationResult<VerifyOutput> {
  const issues: string[] = [];
  if (!isObject(input)) return fail(["verify output must be an object"]);

  if (typeof input.passed !== "boolean") issues.push("passed must be a boolean");
  if (!isArray(input.issues)) issues.push("issues must be an array");
  if (!isString(input.summary) || input.summary.length === 0) issues.push("summary must be a non-empty string");

  if (isArray(input.issues)) {
    for (let i = 0; i < input.issues.length; i++) {
      const issue = input.issues[i];
      if (!isObject(issue)) { issues.push(`issues[${i}] must be an object`); continue; }
      if (!isString(issue.severity) || !["error", "warning"].includes(issue.severity as string)) {
        issues.push(`issues[${i}].severity must be "error" or "warning"`);
      }
      if (!isString(issue.description)) issues.push(`issues[${i}].description must be a string`);
    }
  }

  if (issues.length > 0) return fail(issues);
  return pass(input as unknown as VerifyOutput);
}

export function validateDecisionAnswers(input: unknown): ValidationResult<DecisionAnswer[]> {
  if (!isArray(input)) return fail(["decision answers must be an array"]);

  const issues: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!isObject(a)) { issues.push(`answers[${i}] must be an object`); continue; }
    if (!isString(a.decisionId)) issues.push(`answers[${i}].decisionId must be a string`);
    if (!isString(a.selectedOptionId)) issues.push(`answers[${i}].selectedOptionId must be a string`);
  }

  if (issues.length > 0) return fail(issues);
  return pass(input as unknown as DecisionAnswer[]);
}

export function validateWorkflowState(state: unknown): ValidationResult<WorkflowState> {
  const issues: string[] = [];
  if (!isObject(state)) return fail(["state must be an object"]);

  if (!isString(state.schemaVersion)) issues.push("schemaVersion required");
  if (!isString(state.workflowId)) issues.push("workflowId required");
  if (!isString(state.description)) issues.push("description required");
  if (!isString(state.status)) issues.push("status required");
  if (!isString(state.phase)) issues.push("phase required");
  if (!isArray(state.pendingDecisions)) issues.push("pendingDecisions must be an array");
  if (!isArray(state.decisionHistory)) issues.push("decisionHistory must be an array");
  if (!isArray(state.tasks)) issues.push("tasks must be an array");
  if (typeof state.escalateAfter !== "number") issues.push("escalateAfter must be a number");
  if (!isString(state.createdAt)) issues.push("createdAt required");
  if (!isString(state.updatedAt)) issues.push("updatedAt required");

  if (issues.length > 0) return fail(issues);
  return pass(state as unknown as WorkflowState);
}
