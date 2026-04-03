import type { WorkflowState, Task } from "./types.js";

// ============================================================================
// Output format (appended to every phase prompt)
// ============================================================================

function workItemsOutputFormat(phaseOutputExample: string): string {
  return `
## Output Format

Always return a JSON array of work items:

\`\`\`json
[
  { "id": "string", "role": "string", "task": "string", "result": <phase output or omit> }
]
\`\`\`

**Simple case** — you do it yourself, return 1 item with result:
\`\`\`json
[{ "id": "main", "role": "main", "task": "did everything", "result": ${phaseOutputExample} }]
\`\`\`

**Complex case** — too big for one agent, return multiple items WITHOUT result:
\`\`\`json
[
  { "id": "s1", "role": "structure-analyst", "task": "analyze project structure and entry points" },
  { "id": "s2", "role": "dependency-analyst", "task": "analyze internal and external dependencies" }
]
\`\`\`
These will be executed in parallel by separate agents. Results will be synthesized afterward.

Choose based on complexity. Most tasks need just 1 item.`;
}

// ============================================================================
// Inner pattern: each prompt follows
//   Goal -> Your task -> Step 1: Understand -> Step 2: Assess ->
//   Step 3: Do -> Step 4: Report -> Output format
// ============================================================================

export function buildClarifyPrompt(state: WorkflowState): string {
  const parts: string[] = [];

  parts.push(`# Clarify Phase`);
  parts.push(``);
  parts.push(`## Goal`);
  parts.push(`User request: "${state.description}"`);
  parts.push(``);
  parts.push(`## Your task`);
  parts.push(`Make this request concrete enough to plan and execute safely.`);
  parts.push(``);

  // Include previous decision history if retrying
  if (state.decisionHistory.length > 0) {
    parts.push(`## Previous decisions`);
    for (const d of state.decisionHistory) {
      parts.push(`- ${d.decisionId}: ${d.selectedOptionId}${d.customInput ? ` (${d.customInput})` : ""}`);
    }
    parts.push(``);
  }

  parts.push(`## Step 1: Understand`);
  parts.push(`Restate what the user wants in your own words. Identify the core intent.`);
  parts.push(``);
  parts.push(`## Step 2: Assess`);
  parts.push(`Explore the codebase. Find relevant files, patterns, constraints, and dependencies.`);
  parts.push(``);
  parts.push(`## Step 3: Tighten`);
  parts.push(`Identify assumptions you're making. Surface any gaps or ambiguities.`);
  parts.push(`If information is missing and you cannot proceed safely, define decisions for the user.`);
  parts.push(`If everything is clear enough, mark as ready.`);
  parts.push(``);
  parts.push(`## Step 4: Report`);
  parts.push(workItemsOutputFormat(`{ready, summary, assumptions, verifyFocus, decisions}`));

  return parts.join("\n");
}

export function buildPlanPrompt(state: WorkflowState): string {
  const parts: string[] = [];

  parts.push(`# Plan Phase`);
  parts.push(``);
  parts.push(`## Goal`);
  parts.push(`User request: "${state.description}"`);
  parts.push(``);

  if (state.clarifyOutput) {
    parts.push(`## Clarify summary`);
    parts.push(state.clarifyOutput.summary);
    parts.push(``);
    if (state.clarifyOutput.assumptions.length > 0) {
      parts.push(`## Assumptions`);
      for (const a of state.clarifyOutput.assumptions) {
        parts.push(`- ${a}`);
      }
      parts.push(``);
    }
  }

  // Include plan adjustment feedback if any
  const adjustments = state.decisionHistory.filter((d) => d.decisionId === "plan-adjustment");
  if (adjustments.length > 0) {
    parts.push(`## Plan adjustment feedback`);
    for (const a of adjustments) {
      parts.push(`- ${a.customInput}`);
    }
    parts.push(``);
  }

  parts.push(`## Your task`);
  parts.push(`Design an approach and break it into concrete, ordered tasks.`);
  parts.push(``);
  parts.push(`## Step 1: Understand`);
  parts.push(`Review the clarify output and assumptions. Understand what needs to happen.`);
  parts.push(``);
  parts.push(`## Step 2: Assess`);
  parts.push(`Identify files, modules, and dependencies involved. Check feasibility.`);
  parts.push(``);
  parts.push(`## Step 3: Design`);
  parts.push(`Break the work into bounded tasks. Each task should:`);
  parts.push(`- Have a clear, narrow scope (specific files/modules)`);
  parts.push(`- Be independently verifiable`);
  parts.push(`- List what context it needs from earlier tasks`);
  parts.push(`- Declare dependencies on other tasks`);
  parts.push(``);
  parts.push(`## Step 4: Report`);
  parts.push(workItemsOutputFormat(`{approach, risks, tasks: [{id, title, scope, context, dependsOn}]}`));

  return parts.join("\n");
}

export function buildExecutePrompt(state: WorkflowState, task: Task): string {
  const parts: string[] = [];

  parts.push(`# Execute Phase — Task: ${task.title}`);
  parts.push(``);
  parts.push(`## Goal`);
  parts.push(`User request: "${state.description}"`);
  parts.push(``);
  parts.push(`## Task scope`);
  parts.push(`Files/modules to modify: ${task.scope.join(", ") || "as needed"}`);
  parts.push(``);
  parts.push(`## Task context`);
  parts.push(`Files/data to read: ${task.context.join(", ") || "as needed"}`);
  parts.push(``);

  if (state.clarifyOutput) {
    parts.push(`## Clarify summary`);
    parts.push(state.clarifyOutput.summary);
    parts.push(``);
  }

  if (state.planOutput) {
    parts.push(`## Approach`);
    parts.push(state.planOutput.approach);
    parts.push(``);
  }

  // Include retry feedback if this is a retry
  if (task.verifyOutput && !task.verifyOutput.passed) {
    parts.push(`## Previous verification feedback`);
    parts.push(task.verifyOutput.summary);
    if (task.verifyOutput.retryHint) {
      parts.push(`Retry hint: ${task.verifyOutput.retryHint}`);
    }
    for (const issue of task.verifyOutput.issues) {
      parts.push(`- [${issue.severity}] ${issue.description}${issue.suggestion ? ` → ${issue.suggestion}` : ""}`);
    }
    parts.push(``);
  }

  parts.push(`## Your task`);
  parts.push(`Implement the changes described in this task.`);
  parts.push(``);
  parts.push(`## Step 1: Understand`);
  parts.push(`Review what this task must produce. Check the scope and constraints.`);
  parts.push(``);
  parts.push(`## Step 2: Assess`);
  parts.push(`Read the target files. Understand the current state before making changes.`);
  parts.push(``);
  parts.push(`## Step 3: Implement`);
  parts.push(`Make the changes. Stay within scope.`);
  parts.push(``);
  parts.push(`## Step 4: Report`);
  parts.push(workItemsOutputFormat(`{summary, changedFiles, notes}`));

  return parts.join("\n");
}

export function buildVerifyPrompt(state: WorkflowState, task: Task): string {
  const parts: string[] = [];

  parts.push(`# Verify Phase — Task: ${task.title}`);
  parts.push(``);
  parts.push(`## Goal`);
  parts.push(`Determine if the task was completed correctly.`);
  parts.push(``);

  if (task.executeOutput) {
    parts.push(`## What was done`);
    parts.push(task.executeOutput.summary);
    parts.push(``);
    parts.push(`## Changed files`);
    for (const f of task.executeOutput.changedFiles) {
      parts.push(`- ${f}`);
    }
    parts.push(``);
    if (task.executeOutput.notes.length > 0) {
      parts.push(`## Notes from executor`);
      for (const n of task.executeOutput.notes) {
        parts.push(`- ${n}`);
      }
      parts.push(``);
    }
  }

  if (state.clarifyOutput?.verifyFocus && state.clarifyOutput.verifyFocus.length > 0) {
    parts.push(`## Verify focus`);
    for (const f of state.clarifyOutput.verifyFocus) {
      parts.push(`- ${f}`);
    }
    parts.push(``);
  }

  parts.push(`## Attempt ${task.verifyAttempts}`);
  parts.push(``);
  parts.push(`## Your task`);
  parts.push(`Try to disprove the claimed result. Report what you find.`);
  parts.push(``);
  parts.push(`## Step 1: Understand`);
  parts.push(`Review what was claimed to be done.`);
  parts.push(``);
  parts.push(`## Step 2: Assess`);
  parts.push(`Read the changed files. Run relevant checks or tests if applicable.`);
  parts.push(``);
  parts.push(`## Step 3: Validate`);
  parts.push(`Check each claim against evidence. Look for missing pieces, bugs, or regressions.`);
  parts.push(``);
  parts.push(`## Step 4: Report`);
  parts.push(workItemsOutputFormat(`{passed, issues: [{severity, description, suggestion?}], summary, retryHint?}`));

  return parts.join("\n");
}
