export function workflowStatePath(workflowId: string): string {
  return `.orchestrator/state/workflows/${workflowId}.json`;
}

export function touchUpdatedAt(timestamp: string): string {
  return timestamp;
}
