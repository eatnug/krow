import {
  CapabilityKind,
  CapabilityPolicy,
  LocalControlCommandName,
  Phase,
  RouteDecision,
} from "./types";

function uniqueCapabilities(values: CapabilityKind[]): CapabilityKind[] {
  return [...new Set(values)];
}

function createPolicy(
  id: string,
  surface: CapabilityPolicy["surface"],
  allowed: CapabilityKind[],
  notes: string[],
): CapabilityPolicy {
  return {
    id,
    surface,
    mode: "allow-list",
    allowed: uniqueCapabilities(allowed),
    notes,
  };
}

export function resolveEntryPolicy(route: RouteDecision): CapabilityPolicy {
  if (route.kind === "chat") {
    return createPolicy(
      "entry:chat",
      "entry",
      [],
      ["chat entry does not grant workflow capabilities"],
    );
  }

  return createPolicy(
    "entry:work",
    "entry",
    [
      "repo_scan",
      "search_code",
      "read_targets",
      "read_files",
      "inspect_tests",
      "inspect_logs",
      "inspect_config",
      "inspect_docs",
      "ask_user",
      "read_state",
      "write_state",
    ],
    [
      "entry routing may gather local context and persist workflow state",
      "entry routing should not edit files or run verification checks yet",
      "entry routing should gather all currently required missing evidence before asking the user",
    ],
  );
}

export function resolvePhasePolicy(phase: Phase): CapabilityPolicy {
  switch (phase) {
    case "clarify":
      return createPolicy(
        "phase:clarify",
        "phase",
        [
          "repo_scan",
          "search_code",
          "read_targets",
          "read_files",
          "inspect_tests",
          "inspect_logs",
          "inspect_config",
          "inspect_docs",
          "ask_user",
          "read_state",
          "write_state",
          "write_relay",
          "emit_gate",
        ],
        [
          "clarify can gather evidence and raise explicit questions",
          "clarify should not change project files",
        ],
      );
    case "execute":
      return createPolicy(
        "phase:execute",
        "phase",
        [
          "read_files",
          "edit_files",
          "run_checks",
          "read_state",
          "write_state",
          "write_relay",
          "spawn_worker",
        ],
        [
          "execute can modify files and run scoped checks",
          "execute may fork bounded worker tasks when ownership is clean",
        ],
      );
    case "verify":
      return createPolicy(
        "phase:verify",
        "phase",
        [
          "read_files",
          "inspect_tests",
          "inspect_logs",
          "run_checks",
          "read_state",
          "write_state",
          "write_relay",
          "emit_gate",
        ],
        [
          "verify should focus on disproving the claimed result",
          "verify should not silently edit project files",
        ],
      );
    case "capture":
      return createPolicy(
        "phase:capture",
        "phase",
        ["read_files", "inspect_docs", "read_state", "write_state", "write_relay"],
        [
          "capture writes distilled knowledge, not implementation changes",
        ],
      );
    default:
      return createPolicy("phase:unknown", "phase", [], ["unknown phase"]);
  }
}

export function resolveControlPolicy(commandName: LocalControlCommandName): CapabilityPolicy {
  switch (commandName) {
    case "route":
    case "intake":
      return createPolicy(
        `control:${commandName}`,
        "control",
        ["repo_scan", "search_code"],
        ["local control command only", "does not advance workflow state"],
      );
    case "start":
      return createPolicy(
        "control:start",
        "control",
        ["read_state", "write_state"],
        ["local control command only", "creates workflow state without invoking a model"],
      );
    case "status":
    case "next":
    case "resume":
      return createPolicy(
        `control:${commandName}`,
        "control",
        ["read_state"],
        ["local control command only", "reads existing workflow state"],
      );
    case "submit-phase":
    case "submit-decisions":
    case "stop":
      return createPolicy(
        `control:${commandName}`,
        "control",
        ["read_state", "write_state"],
        ["local control command only", "mutates workflow state without invoking a model"],
      );
    default:
      return createPolicy(`control:${commandName}`, "control", [], ["unknown control command"]);
  }
}

export function mergeCapabilityPolicies(
  id: string,
  surface: CapabilityPolicy["surface"],
  ...policies: CapabilityPolicy[]
): CapabilityPolicy {
  return createPolicy(
    id,
    surface,
    policies.flatMap((policy) => policy.allowed),
    policies.flatMap((policy) => policy.notes),
  );
}
