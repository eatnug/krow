import type { VerifyOutput, WorkflowGraphStrategy, WorkflowState, WorkflowUnit } from "./types.js";
import {
  unitBatonPath,
  unitBriefPath,
  unitContextPath,
  unitRelayPath,
  unitResultPath,
  unitStatusPath,
  workflowTaskIndexPath,
} from "./workflow-files.js";

function asVerifyOutput(value: unknown): VerifyOutput | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as VerifyOutput;
}

export function unitDependencies(unit: { dependsOn?: unknown }): string[] {
  if (!Array.isArray(unit.dependsOn)) {
    return [];
  }
  return unit.dependsOn.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function inferGraphStrategy(units: WorkflowUnit[]): WorkflowGraphStrategy {
  if (units.length <= 1) {
    return "single";
  }

  const hasDependencies = units.some((unit) => unitDependencies(unit).length > 0);
  const hasParallelRoots =
    units.filter((unit) => unit.kind !== "integration" && unit.parallelizable !== false).length > 1;

  if (hasParallelRoots) {
    return "parallel_fanout";
  }

  return hasDependencies ? "serial" : "single";
}

export function isUnitCompleted(state: WorkflowState, unitId: string): boolean {
  const verify = asVerifyOutput(state.outputs[unitId]?.verify);
  return verify?.passed === true;
}

export function completedUnitIds(state: WorkflowState): string[] {
  return state.units.filter((unit) => isUnitCompleted(state, unit.id)).map((unit) => unit.id);
}

export function pendingUnits(state: WorkflowState): WorkflowUnit[] {
  return state.units.filter((unit) => !isUnitCompleted(state, unit.id));
}

export function readyUnits(state: WorkflowState): WorkflowUnit[] {
  const completed = new Set(completedUnitIds(state));
  return state.units.filter(
    (unit) => !completed.has(unit.id) && unitDependencies(unit).every((dependencyId) => completed.has(dependencyId)),
  );
}

export function nextReadyUnitIndex(state: WorkflowState): number | undefined {
  const readyIds = new Set(readyUnits(state).map((unit) => unit.id));
  const index = state.units.findIndex((unit) => readyIds.has(unit.id));
  return index >= 0 ? index : undefined;
}

function compactUnit(unit: WorkflowUnit): Record<string, unknown> {
  return {
    id: unit.id,
    title: unit.title,
    kind: unit.kind ?? "work",
    dependsOn: unitDependencies(unit),
    parallelizable: unit.parallelizable === true,
    scope: Array.isArray(unit.scope) ? unit.scope : [],
    ownership: Array.isArray(unit.ownership) ? unit.ownership : [],
    priority: unit.priority ?? "medium",
    estimatedEffort: unit.estimatedEffort ?? "medium",
    mergeRequired: unit.mergeRequired === true,
    sharedRisks: Array.isArray(unit.sharedRisks) ? unit.sharedRisks : [],
    acceptanceCriteria: Array.isArray(unit.acceptanceCriteria) ? unit.acceptanceCriteria : [],
  };
}

function buildDownstreamDepths(units: WorkflowUnit[]): Map<string, number> {
  const dependents = new Map<string, string[]>();
  for (const unit of units) {
    for (const dependencyId of unitDependencies(unit)) {
      dependents.set(dependencyId, [...(dependents.get(dependencyId) ?? []), unit.id]);
    }
  }

  const memo = new Map<string, number>();
  function visit(unitId: string): number {
    if (memo.has(unitId)) {
      return memo.get(unitId)!;
    }

    const childIds = dependents.get(unitId) ?? [];
    const depth = childIds.length === 0 ? 1 : 1 + Math.max(...childIds.map(visit));
    memo.set(unitId, depth);
    return depth;
  }

  for (const unit of units) {
    visit(unit.id);
  }

  return memo;
}

export function buildRunContext(state: WorkflowState): Record<string, unknown> {
  const currentUnit = state.units[state.currentUnitIndex];
  const ready = readyUnits(state);
  const completed = completedUnitIds(state);
  const pending = pendingUnits(state);
  const downstreamDepths = buildDownstreamDepths(state.units);

  function enrichUnit(unit: WorkflowUnit): Record<string, unknown> {
    return {
      ...compactUnit(unit),
      criticalPathLength: downstreamDepths.get(unit.id) ?? 1,
      packetRef: unitBriefPath(state.workflowId, unit.id),
      statusRef: unitStatusPath(state.workflowId, unit.id),
      resultRef: unitResultPath(state.workflowId, unit.id),
      batonRef: unitBatonPath(state.workflowId, unit.id),
      relayRef: unitRelayPath(state.workflowId, unit.id),
    };
  }

  return {
    graphStrategy: state.graphStrategy ?? inferGraphStrategy(state.units),
    workflowTaskIndexRef: workflowTaskIndexPath(state.workflowId),
    currentUnit: currentUnit ? enrichUnit(currentUnit) : undefined,
    readyUnits: ready.map(enrichUnit),
    readySiblingUnitIds: ready.filter((unit) => unit.id !== currentUnit?.id).map((unit) => unit.id),
    completedUnitIds: completed,
    blockedUnitIds: pending
      .filter((unit) => !ready.some((readyUnit) => readyUnit.id === unit.id))
      .map((unit) => unit.id),
    dependencyRelayRefs: currentUnit
      ? unitDependencies(currentUnit).map((dependencyId) => unitRelayPath(state.workflowId, dependencyId))
      : [],
    pendingUnitIds: pending.map((unit) => unit.id),
    remainingUnitCount: pending.length,
  };
}
