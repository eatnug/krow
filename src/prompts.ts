import type {
  ClarifyOutput,
  ExecuteOutput,
  RuntimePhase,
  VerifyOutput,
  WorkflowState,
  WorkflowUnit,
} from "./types.js";
import { workflowTaskIndexPath } from "./state-store.js";
import { executionContractForUnit } from "./execution-contracts.js";
import { buildRunContext, completedUnitIds } from "./workflow-graph.js";

function currentUnit(state: WorkflowState): WorkflowUnit | undefined {
  return state.units[state.currentUnitIndex];
}

function unitOutputs(state: WorkflowState, unitId?: string): Partial<Record<RuntimePhase, unknown>> {
  if (!unitId) {
    return {};
  }
  return state.outputs[unitId] ?? {};
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

function formatLines(lines: string[]): string {
  return lines.join("\n");
}

function graphContextBlock(state: WorkflowState, unit: WorkflowUnit | undefined): string[] {
  const context = buildRunContext(state);
  const currentUnit =
    context.currentUnit && typeof context.currentUnit === "object"
      ? (context.currentUnit as Record<string, unknown>)
      : undefined;
  const readySiblingUnitIds = Array.isArray(context.readySiblingUnitIds)
    ? context.readySiblingUnitIds.filter((value): value is string => typeof value === "string")
    : [];
  const blockedUnitIds = Array.isArray(context.blockedUnitIds)
    ? context.blockedUnitIds.filter((value): value is string => typeof value === "string")
    : [];
  const completed = completedUnitIds(state);

  const lines = ["Graph context:"];
  lines.push(`- Strategy: ${state.graphStrategy ?? "single"}`);
  lines.push(`- Completed units: ${completed.length} of ${state.units.length}`);
  lines.push(`- Workflow task index: ${workflowTaskIndexPath(state.workflowId)}`);

  if (currentUnit?.kind && typeof currentUnit.kind === "string") {
    lines.push(`- Current unit kind: ${currentUnit.kind}`);
  }

  if (currentUnit?.packetRef && typeof currentUnit.packetRef === "string") {
    lines.push(`- Task packet: ${currentUnit.packetRef}`);
  }
  if (currentUnit?.statusRef && typeof currentUnit.statusRef === "string") {
    lines.push(`- Task status: ${currentUnit.statusRef}`);
  }
  if (currentUnit?.resultRef && typeof currentUnit.resultRef === "string") {
    lines.push(`- Task result: ${currentUnit.resultRef}`);
  }

  if (Array.isArray(unit?.dependsOn) && unit.dependsOn.length > 0) {
    lines.push(`- Depends on: ${unit.dependsOn.join(", ")}`);
  }

  if (Array.isArray(unit?.scope) && unit.scope.length > 0) {
    lines.push(`- Scoped surfaces: ${unit.scope.join(", ")}`);
  }

  if (Array.isArray(unit?.ownership) && unit.ownership.length > 0) {
    lines.push(`- Ownership boundary: ${unit.ownership.join(", ")}`);
  }

  if (Array.isArray(unit?.acceptanceCriteria) && unit.acceptanceCriteria.length > 0) {
    lines.push(`- Acceptance criteria: ${unit.acceptanceCriteria.join(" | ")}`);
  }

  if (Array.isArray(unit?.anchors?.verificationSurfaces) && unit.anchors.verificationSurfaces.length > 0) {
    lines.push(`- Verification surfaces: ${unit.anchors.verificationSurfaces.join(" | ")}`);
  }

  if (Array.isArray(unit?.sharedRisks) && unit.sharedRisks.length > 0) {
    lines.push(`- Shared risks: ${unit.sharedRisks.join(" | ")}`);
  }

  if (readySiblingUnitIds.length > 0) {
    lines.push(`- Other ready units: ${readySiblingUnitIds.join(", ")}`);
  }

  if (blockedUnitIds.length > 0) {
    lines.push(`- Blocked units: ${blockedUnitIds.join(", ")}`);
  }

  lines.push("");
  return lines;
}

function payloadBlock(title: string, payload: unknown): string[] {
  return [title, "```json", JSON.stringify(payload, null, 2), "```", ""];
}

const PHASE_PROMPT_REFS: Record<RuntimePhase, string> = {
  clarify: "prompts/clarify.md",
  execute: "prompts/executor.md",
  verify: "prompts/verifier.md",
  capture: "prompts/capture.md",
};

const PHASE_SCHEMA_REFS: Record<RuntimePhase, string> = {
  clarify: "schemas/payloads/clarify-output.schema.json",
  execute: "schemas/payloads/execute-output.schema.json",
  verify: "schemas/payloads/verify-output.schema.json",
  capture: "schemas/payloads/capture-output.schema.json",
};

export function promptRefForPhase(phase: RuntimePhase): string {
  return PHASE_PROMPT_REFS[phase];
}

export function schemaRefForPhase(phase: RuntimePhase): string {
  return PHASE_SCHEMA_REFS[phase];
}

export function buildClarifyPrompt(state: WorkflowState): string {
  const unit = currentUnit(state);
  const outputs = unitOutputs(state, unit?.id);

  const lines = [
    "# Clarify",
    "",
    "Tighten the current unit until execution is safe and verification is concrete.",
    "",
    `User request: ${state.description}`,
    `Current unit: ${unit?.title ?? "unknown"}${unit?.id ? ` (${unit.id})` : ""}`,
    "",
    "Requirements:",
    "- Read the relevant code and gather evidence before making factual claims.",
    "- Read related Project Concept Maps and Code Anchors from the task packet when present.",
    "- List the concrete evidence you actually used: files, symbols, tests, logs, or docs.",
    "- Turn the user's success condition into explicit acceptance criteria for this unit.",
    "- Surface only the current missing information bundle. If external input is required, ask for all known decisions at once.",
    "- Keep the response scoped to clarify for the current unit.",
    "- Do not pull blocked or not-yet-ready units into this clarify pass.",
    "- If the unit is ready, make `ready` true and leave `decisions` empty.",
    "",
  ];

  lines.push(...graphContextBlock(state, unit));

  if (state.decisionHistory.length > 0) {
    lines.push("Decision history:");
    for (const decision of state.decisionHistory) {
      lines.push(
        `- ${decision.decisionId}: ${decision.selectedOptionId}${decision.customInput ? ` (${decision.customInput})` : ""}`,
      );
    }
    lines.push("");
  }

  const priorClarify = asClarifyOutput(outputs.clarify);
  if (priorClarify) {
    lines.push("Previous clarify output:");
    lines.push(priorClarify.summary);
    lines.push("");
  }

  lines.push(...payloadBlock("Return JSON matching the clarify schema:", {
    ready: true,
    summary: "Concrete scope, evidence, and execution edge for the current unit.",
    assumptions: ["Explicit assumptions that still shape execution."],
    evidence: ["src/example.ts::TargetFunction", "tests/example.test.ts"],
    acceptanceCriteria: ["The changed behavior is observable on the scoped surface.", "The intended verification surface is clear."],
    verifyFocus: ["Evidence that verification should check."],
    decisions: [],
  }));

  return formatLines(lines);
}

export function buildExecutePrompt(state: WorkflowState): string {
  const unit = currentUnit(state);
  const outputs = unitOutputs(state, unit?.id);
  const clarify = asClarifyOutput(outputs.clarify);
  const executionContract = executionContractForUnit(unit);

  const lines = [
    "# Execute",
    "",
    "Perform only the clarified unit of work and leave evidence that verification can audit.",
    "",
    `User request: ${state.description}`,
    `Current unit: ${unit?.title ?? "unknown"}${unit?.id ? ` (${unit.id})` : ""}`,
    "",
    "Requirements:",
    "- Stay inside the current unit boundary.",
    "- Use evidence gathered during clarify rather than re-expanding scope.",
    "- Inspect related Project Concept Map Code Anchors before changing story-facing code.",
    "- When Examples are present, create or update tests for those Examples before changing implementation code.",
    "- After Example tests exist, implement the code and rerun scoped checks.",
    "- Return `executionSteps`, `exampleTests`, and `implementationLinks` when Examples are present.",
    "- Treat sibling ready units as scheduler context. This run still owns only the current unit.",
    "- Make concrete code or artifact changes and return one execute payload.",
    "- Report exactly what changed and any checks you ran.",
    "- Leave downstream workers a usable handoff trail when this unit is part of a larger graph.",
    "",
  ];

  lines.push(...graphContextBlock(state, unit));

  if (executionContract && executionContract.exampleIds.length > 0) {
    lines.push("Execution contract:");
    lines.push(`- Examples: ${executionContract.exampleIds.join(", ")}`);
    lines.push(`- Plan ids: ${executionContract.planIds.join(", ") || "(none)"}`);
    lines.push(`- Required stage order: ${executionContract.requiredStages.join(" -> ")}`);
    lines.push("");
  }

  if (clarify) {
    lines.push("Clarify summary:");
    lines.push(clarify.summary);
    lines.push("");

    if (clarify.assumptions.length > 0) {
      lines.push("Assumptions:");
      for (const assumption of clarify.assumptions) {
        lines.push(`- ${assumption}`);
      }
      lines.push("");
    }
  }

  lines.push(...payloadBlock("Return JSON matching the execute schema:", {
    summary: "What changed for this unit and why.",
    changedFiles: ["relative/path.ts"],
    outputFiles: [],
    artifacts: [],
    checks: ["npm run typecheck"],
    executionSteps: [
      { id: "tests-from-examples", status: "completed", evidence: "Added or updated tests that reference EX-001." },
      { id: "run-tests-before-code", status: "completed", evidence: "Scoped test failed or exposed the missing behavior before code." },
      { id: "implement-code", status: "completed", evidence: "Changed implementation files linked below." },
      { id: "run-tests-after-code", status: "completed", evidence: "Scoped tests passed after implementation." },
    ],
    exampleTests: [
      { exampleId: "EX-001", testFiles: ["tests/example.test.ts"], testNames: ["EX-001 blocks free users"], status: "created" },
    ],
    implementationLinks: [
      {
        codeFiles: ["src/example.ts"],
        exampleIds: ["EX-001"],
        planIds: ["PLAN-001"],
        notes: "Implements the behavior asserted by EX-001.",
      },
    ],
    handoffNotes: ["Integration unit should re-check shared interfaces after sibling units finish."],
    notes: ["Checks run, constraints, or follow-up notes."],
  }));

  return formatLines(lines);
}

export function buildVerifyPrompt(state: WorkflowState): string {
  const unit = currentUnit(state);
  const outputs = unitOutputs(state, unit?.id);
  const clarify = asClarifyOutput(outputs.clarify);
  const execute = asExecuteOutput(outputs.execute);
  const executionContract = executionContractForUnit(unit);

  const lines = [
    "# Verify",
    "",
    "Try to disprove the claimed result. Report precise, evidence-backed issues.",
    "",
    `User request: ${state.description}`,
    `Current unit: ${unit?.title ?? "unknown"}${unit?.id ? ` (${unit.id})` : ""}`,
    `Verify attempt: ${state.verifyAttempts + 1} of ${state.maxVerifyAttempts}`,
    "",
    "Requirements:",
    "- Read the changed files and run proportionate checks when possible.",
    "- Check related Project Concept Maps and Code Anchors when the task packet lists them.",
    "- When Examples are present, verify Example ids appear in tests and implementation links cover changed code.",
    "- Report the concrete checks you ran, their status, and what evidence each one produced.",
    "- Record any claims that still remain unverified instead of implying they passed.",
    "- Report recoverable issues precisely enough to drive the next clarify pass.",
    "- Use `needsHuman` only when the workflow truly requires an external decision.",
    "- Verify only the current unit and any explicitly declared integration surface.",
    "- Stay inside the verify payload contract for the current unit.",
    "",
  ];

  lines.push(...graphContextBlock(state, unit));

  if (executionContract && executionContract.exampleIds.length > 0) {
    lines.push("Execution contract under review:");
    lines.push(`- Examples: ${executionContract.exampleIds.join(", ")}`);
    lines.push(`- Required stage order: ${executionContract.requiredStages.join(" -> ")}`);
    lines.push("");
  }

  if (clarify?.verifyFocus?.length) {
    lines.push("Verify focus:");
    for (const focus of clarify.verifyFocus) {
      lines.push(`- ${focus}`);
    }
    lines.push("");
  }

  if (execute) {
    lines.push("Executor summary:");
    lines.push(execute.summary);
    lines.push("");

    if (execute.changedFiles?.length) {
      lines.push("Changed files:");
      for (const file of execute.changedFiles) {
        lines.push(`- ${file}`);
      }
      lines.push("");
    }
  }

  lines.push(...payloadBlock("Return JSON matching the verify schema:", {
    passed: true,
    score: { accuracy: 100, completeness: 100, consistency: 100 },
    checks: [
      { name: "Typecheck", status: "passed", command: "npm run typecheck", evidence: "Command exited 0." },
    ],
    evidence: ["src/example.ts matches the clarified scope.", "npm run typecheck exited 0."],
    issues: [],
    decisions: [],
    needsHuman: false,
    retryHint: "",
    unverifiedClaims: [],
    summary: "Verification result with evidence-backed conclusions.",
  }));

  return formatLines(lines);
}

export function buildCapturePrompt(state: WorkflowState): string {
  const lines = [
    "# Capture",
    "",
    "Capture only durable, reusable patterns worth storing after execution is complete.",
    "",
    `User request: ${state.description}`,
    "",
    "Requirements:",
    "- Record only hard-won, reusable knowledge.",
    "- Skip generic advice, obvious conclusions, and task-local chatter.",
    "- If nothing meets the threshold, return an empty `entries` array.",
    "",
  ];

  const completedUnits = Object.entries(state.outputs);
  if (completedUnits.length > 0) {
    lines.push("Completed unit outputs:");
    for (const [unitId, output] of completedUnits) {
      const verify = asVerifyOutput((output as Partial<Record<RuntimePhase, unknown>>).verify);
      lines.push(`- ${unitId}${verify?.summary ? `: ${verify.summary}` : ""}`);
    }
    lines.push("");
  }

  lines.push(...payloadBlock("Return JSON matching the capture schema:", {
    entries: [
      {
        filename: ".krow/knowledge/example.md",
        content: "Reusable pattern captured from this workflow.",
        reason: "Why this is durable and worth preserving.",
        action: "create",
      },
    ],
  }));

  return formatLines(lines);
}

export function buildPromptForPhase(state: WorkflowState, phase: RuntimePhase): string {
  switch (phase) {
    case "clarify":
      return buildClarifyPrompt(state);
    case "execute":
      return buildExecutePrompt(state);
    case "verify":
      return buildVerifyPrompt(state);
    case "capture":
      return buildCapturePrompt(state);
  }
}
