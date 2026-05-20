import type { Answer, AnswerPayload, Question } from "./questions.js";
import type { PlannedTask } from "./task-graph.js";

export interface LanguageUpdateProposal {
  kind: "term" | "system-map" | "system-document";
  title?: string;
  summary: string;
  target?: string;
  evidence?: string[];
  refs?: string[];
}

export interface PlanOutput {
  ready: boolean;
  docs: {
    goal?: string;
    spec?: string;
    plan?: string;
    tasks?: string;
  };
  summary: string;
  tasks?: PlannedTask[];
  evidence?: string[];
  questions?: Question[];
}

export interface ImplementOutput {
  summary: string;
  changed_files?: string[];
  evidence?: string[];
  questions?: Question[];
}

export interface ReviewOutput {
  passed: boolean;
  doc?: string;
  summary: string;
  evidence?: string[];
  issues?: string[];
  language_updates?: LanguageUpdateProposal[];
  questions?: Question[];
}

export type WorkOutput = PlanOutput | ImplementOutput | ReviewOutput | AnswerPayload;

export interface ContractValidationResult<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function validateQuestions(value: unknown, path: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [`${path} must be an array when present`];
  }

  const issues: string[] = [];
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
    if (item.context !== undefined && !isNonEmptyString(item.context)) {
      issues.push(`${itemPath}.context must be a non-empty string when present`);
    }
    if (item.options !== undefined && !isStringArray(item.options)) {
      issues.push(`${itemPath}.options must be an array of non-empty strings when present`);
    }
  });
  return issues;
}

function validatePlannedTasks(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return ["tasks must be an array when present"];
  }

  const issues: string[] = [];
  const ids: string[] = [];
  value.forEach((task, index) => {
    const path = `tasks[${index}]`;
    if (!isRecord(task)) {
      issues.push(`${path} must be an object`);
      return;
    }
    if (!isNonEmptyString(task.id)) {
      issues.push(`${path}.id must be a non-empty string`);
    } else {
      ids.push(task.id);
    }
    if (!isNonEmptyString(task.title)) {
      issues.push(`${path}.title must be a non-empty string`);
    }
    if (!isNonEmptyString(task.scope)) {
      issues.push(`${path}.scope must be a non-empty string`);
    }
    if (task.responsibility !== undefined && !isNonEmptyString(task.responsibility)) {
      issues.push(`${path}.responsibility must be a non-empty string when present`);
    }
    if (task.depends_on !== undefined && !isStringArray(task.depends_on)) {
      issues.push(`${path}.depends_on must be an array of non-empty strings when present`);
    }
    if (task.files !== undefined && !isStringArray(task.files)) {
      issues.push(`${path}.files must be an array of non-empty strings when present`);
    }
    if (
      (!Array.isArray(task.files) || task.files.length === 0) &&
      !isNonEmptyString(task.responsibility)
    ) {
      issues.push(`${path} must declare files or responsibility`);
    }
    if (task.parallel_group !== undefined && !isNonEmptyString(task.parallel_group)) {
      issues.push(`${path}.parallel_group must be a non-empty string when present`);
    }
    if (!isNonEmptyString(task.expected_output)) {
      issues.push(`${path}.expected_output must be a non-empty string`);
    }
    if (task.merge_plan !== undefined && !isNonEmptyString(task.merge_plan)) {
      issues.push(`${path}.merge_plan must be a non-empty string when present`);
    }
  });

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  duplicates.forEach((id) => issues.push(`duplicate task id: ${id}`));
  const idSet = new Set(ids);
  value.forEach((task, index) => {
    if (!isRecord(task) || !Array.isArray(task.depends_on)) {
      return;
    }
    task.depends_on.forEach((dependency) => {
      if (typeof dependency === "string" && !idSet.has(dependency)) {
        issues.push(`tasks[${index}].depends_on references unknown task: ${dependency}`);
      }
    });
  });

  const planned = value.filter(isRecord);
  for (let leftIndex = 0; leftIndex < planned.length; leftIndex += 1) {
    const left = planned[leftIndex];
    const leftId = typeof left.id === "string" ? left.id : `tasks[${leftIndex}]`;
    const leftFiles = Array.isArray(left.files) ? left.files.filter((file): file is string => typeof file === "string") : [];
    for (let rightIndex = leftIndex + 1; rightIndex < planned.length; rightIndex += 1) {
      const right = planned[rightIndex];
      const rightId = typeof right.id === "string" ? right.id : `tasks[${rightIndex}]`;
      const rightFiles = Array.isArray(right.files) ? right.files.filter((file): file is string => typeof file === "string") : [];
      const hasDependency =
        (Array.isArray(left.depends_on) && left.depends_on.includes(rightId)) ||
        (Array.isArray(right.depends_on) && right.depends_on.includes(leftId));
      if (hasDependency) {
        continue;
      }
      const overlap = leftFiles.filter((file) => rightFiles.includes(file));
      const hasMergePlan = isNonEmptyString(left.merge_plan) || isNonEmptyString(right.merge_plan);
      if (overlap.length > 0 && !hasMergePlan) {
        issues.push(`${leftId} and ${rightId} both own ${overlap.join(", ")} without a merge_plan`);
      }
    }
  }

  return issues;
}

export function validatePlanOutput(value: unknown): ContractValidationResult<PlanOutput> {
  if (!isRecord(value)) {
    return { ok: false, issues: ["plan_output must be an object"] };
  }

  const issues: string[] = [];
  if (typeof value.ready !== "boolean") {
    issues.push("ready must be a boolean");
  }
  if (!isRecord(value.docs)) {
    issues.push("docs must be an object");
  } else {
    ["goal", "spec", "plan", "tasks"].forEach((key) => {
      if (value.docs && isRecord(value.docs) && value.docs[key] !== undefined && !isNonEmptyString(value.docs[key])) {
        issues.push(`docs.${key} must be a non-empty string when present`);
      }
    });
  }
  if (!isNonEmptyString(value.summary)) {
    issues.push("summary must be a non-empty string");
  }
  if (value.evidence !== undefined && !isStringArray(value.evidence)) {
    issues.push("evidence must be an array of non-empty strings when present");
  }
  issues.push(...validateQuestions(value.questions, "questions"));
  issues.push(...validatePlannedTasks(value.tasks));

  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as PlanOutput }
    : { ok: false, issues };
}

export function validateImplementOutput(value: unknown): ContractValidationResult<ImplementOutput> {
  if (!isRecord(value)) {
    return { ok: false, issues: ["implement_output must be an object"] };
  }

  const issues: string[] = [];
  if (!isNonEmptyString(value.summary)) {
    issues.push("summary must be a non-empty string");
  }
  if (value.changed_files !== undefined && !isStringArray(value.changed_files)) {
    issues.push("changed_files must be an array of non-empty strings when present");
  }
  if (value.evidence !== undefined && !isStringArray(value.evidence)) {
    issues.push("evidence must be an array of non-empty strings when present");
  }
  issues.push(...validateQuestions(value.questions, "questions"));

  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as ImplementOutput }
    : { ok: false, issues };
}

export function validateReviewOutput(value: unknown): ContractValidationResult<ReviewOutput> {
  if (!isRecord(value)) {
    return { ok: false, issues: ["review_output must be an object"] };
  }

  const issues: string[] = [];
  if (typeof value.passed !== "boolean") {
    issues.push("passed must be a boolean");
  }
  if (value.doc !== undefined && !isNonEmptyString(value.doc)) {
    issues.push("doc must be a non-empty string when present");
  }
  if (!isNonEmptyString(value.summary)) {
    issues.push("summary must be a non-empty string");
  }
  if (value.evidence !== undefined && !isStringArray(value.evidence)) {
    issues.push("evidence must be an array of non-empty strings when present");
  }
  if (value.issues !== undefined && !isStringArray(value.issues)) {
    issues.push("issues must be an array of non-empty strings when present");
  }
  if (value.language_updates !== undefined) {
    if (!Array.isArray(value.language_updates)) {
      issues.push("language_updates must be an array when present");
    } else {
      value.language_updates.forEach((update, index) => {
        const path = `language_updates[${index}]`;
        if (!isRecord(update)) {
          issues.push(`${path} must be an object`);
          return;
        }
        if (update.kind !== "term" && update.kind !== "system-map" && update.kind !== "system-document") {
          issues.push(`${path}.kind must be term, system-map, or system-document`);
        }
        if (update.title !== undefined && !isNonEmptyString(update.title)) {
          issues.push(`${path}.title must be a non-empty string when present`);
        }
        if (!isNonEmptyString(update.summary)) {
          issues.push(`${path}.summary must be a non-empty string`);
        }
        if (update.target !== undefined && !isNonEmptyString(update.target)) {
          issues.push(`${path}.target must be a non-empty string when present`);
        }
        if (update.evidence !== undefined && !isStringArray(update.evidence)) {
          issues.push(`${path}.evidence must be an array of non-empty strings when present`);
        }
        if (update.refs !== undefined && !isStringArray(update.refs)) {
          issues.push(`${path}.refs must be an array of non-empty strings when present`);
        }
      });
    }
  }
  issues.push(...validateQuestions(value.questions, "questions"));

  return issues.length === 0
    ? { ok: true, issues: [], value: value as unknown as ReviewOutput }
    : { ok: false, issues };
}

export function validateAnswerPayload(value: unknown): ContractValidationResult<AnswerPayload> {
  const answersValue = Array.isArray(value) ? value : isRecord(value) ? value.answers : undefined;
  if (!Array.isArray(answersValue)) {
    return { ok: false, issues: ["answers payload must be an array or an object with an answers array"] };
  }

  const issues: string[] = [];
  answersValue.forEach((answer, index) => {
    const path = `answers[${index}]`;
    if (!isRecord(answer)) {
      issues.push(`${path} must be an object`);
      return;
    }
    if (!isNonEmptyString(answer.question_id)) {
      issues.push(`${path}.question_id must be a non-empty string`);
    }
    if (!isNonEmptyString(answer.answer)) {
      issues.push(`${path}.answer must be a non-empty string`);
    }
    if (answer.rationale !== undefined && !isNonEmptyString(answer.rationale)) {
      issues.push(`${path}.rationale must be a non-empty string when present`);
    }
  });

  return issues.length === 0
    ? { ok: true, issues: [], value: { answers: answersValue as Answer[] } }
    : { ok: false, issues };
}
