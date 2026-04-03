import { LocalControlCommandName, LocalControlCommandSpec } from "./types";
import { resolveControlPolicy } from "./tool-policy";

const localControlDescriptions: Record<LocalControlCommandName, string> = {
  route: "Classify a message as chat or work without creating workflow state.",
  intake: "Produce an intake plan and missing-context analysis without creating workflow state.",
  start: "Create workflow state from a message and emit the first control signal.",
  status: "Read workflow state and return a local summary.",
  next: "Read workflow state and emit the next control signal.",
  resume: "Alias of next for host surfaces that prefer resume wording.",
  "submit-phase": "Submit a structured phase payload and advance the workflow if valid.",
  "submit-decisions": "Submit answers to pending clarify decisions.",
  stop: "Stop a workflow locally and persist the terminal state.",
};

export const localControlCommands: LocalControlCommandSpec[] = (
  Object.keys(localControlDescriptions) as LocalControlCommandName[]
).map((name) => ({
  name,
  localOnly: true,
  description: localControlDescriptions[name],
  capabilityPolicy: resolveControlPolicy(name),
}));

export function getLocalControlCommand(name: LocalControlCommandName): LocalControlCommandSpec {
  return (
    localControlCommands.find((command) => command.name === name) ?? {
      name,
      localOnly: true,
      description: "Unknown local control command.",
      capabilityPolicy: resolveControlPolicy(name),
    }
  );
}
