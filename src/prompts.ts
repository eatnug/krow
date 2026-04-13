import type {
  ClarifyOutput,
  ExecuteOutput,
  RuntimePhase,
  VerifyOutput,
  WorkflowState,
  WorkflowUnit,
} from "./types.js";

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
    "- Surface only the current missing information bundle. If external input is required, ask for all known decisions at once.",
    "- Keep the response scoped to clarify for the current unit.",
    "- If the unit is ready, make `ready` true and leave `decisions` empty.",
    "",
  ];

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
    verifyFocus: ["Evidence that verification should check."],
    decisions: [],
  }));

  return formatLines(lines);
}

export function buildExecutePrompt(state: WorkflowState): string {
  const unit = currentUnit(state);
  const outputs = unitOutputs(state, unit?.id);
  const clarify = asClarifyOutput(outputs.clarify);

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
    "- Make concrete code or artifact changes and return one execute payload.",
    "- Report exactly what changed and any checks you ran.",
    "",
  ];

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
    notes: ["Checks run, constraints, or follow-up notes."],
  }));

  return formatLines(lines);
}

export function buildVerifyPrompt(state: WorkflowState): string {
  const unit = currentUnit(state);
  const outputs = unitOutputs(state, unit?.id);
  const clarify = asClarifyOutput(outputs.clarify);
  const execute = asExecuteOutput(outputs.execute);

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
    "- Report recoverable issues precisely enough to drive the next clarify pass.",
    "- Use `needsHuman` only when the workflow truly requires an external decision.",
    "- Stay inside the verify payload contract for the current unit.",
    "",
  ];

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
    issues: [],
    decisions: [],
    needsHuman: false,
    retryHint: "",
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
