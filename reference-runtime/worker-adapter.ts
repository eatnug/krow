import { CapabilityPolicy, RunSignal, WorkerExecutionMode, WorkerLaunchRequest } from "./types";

export function createWorkerLaunchRequest(input: {
  signal: RunSignal;
  capabilityPolicy: CapabilityPolicy;
  executionMode?: WorkerExecutionMode;
  contextRefs?: string[];
  metadata?: Record<string, unknown>;
}): WorkerLaunchRequest {
  return {
    workflowId: input.signal.workflow_id,
    unitId: input.signal.unit_id ?? "unknown-unit",
    phase: input.signal.phase,
    promptRef: input.signal.prompt_ref,
    requiredSchema: input.signal.required_schema,
    instructions: input.signal.instructions,
    capabilityPolicy: input.capabilityPolicy,
    executionMode: input.executionMode ?? "fork",
    contextRefs: input.contextRefs ?? [],
    metadata: input.metadata,
  };
}
