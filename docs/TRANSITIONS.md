# Transition Rules

This file defines the authoritative transition rules for the reference runtime.

## Canonical Loop

The engine understands only this loop:

```text
clarify -> execute -> verify
```

Optional terminal-adjacent phase:

```text
capture
```

## Transition Table

| Current Status | Event | Required Validation | Next Status |
|---|---|---|---|
| `phase_clarify` | `phase_output(clarify)` with `ready=false` and decisions | `ClarifyOutput` | `clarify_pending` |
| `phase_clarify` | `phase_output(clarify)` with `ready=true` | `ClarifyOutput` | `phase_execute` |
| `clarify_pending` | `decision_answers` | `DecisionAnswer[]` | `phase_clarify` |
| `phase_execute` | `phase_output(execute)` | `ExecuteOutput` | `phase_verify` |
| `phase_verify` | `phase_output(verify)` and passed with more units remaining | `VerifyOutput` | `phase_clarify` of next unit |
| `phase_verify` | `phase_output(verify)` and passed on final unit with capture enabled | `VerifyOutput` | `phase_capture` |
| `phase_verify` | `phase_output(verify)` and passed on final unit without capture | `VerifyOutput` | `completed` |
| `phase_verify` | `phase_output(verify)` and failed but recoverable with retries left | `VerifyOutput` | `phase_clarify` |
| `phase_verify` | `phase_output(verify)` and failed with `needsHuman=true` | `VerifyOutput` | `clarify_pending` |
| `phase_verify` | `phase_output(verify)` and failed with no retries left | `VerifyOutput` | `blocked` |
| `phase_capture` | `phase_output(capture)` | `CaptureOutput` | `completed` |

For Example-backed work, `ExecuteOutput` validation includes the execution contract: tests from Examples must be linked before code implementation is accepted. After any accepted `phase_output(verify)`, the local CLI may derive or refresh `.krow/reviews/<workflowId>-<unitId>.md` from stored workflow evidence.

## Invalid Transition Policy

If an event does not match the current status:

1. do not mutate state
2. emit a `fault` response
3. mark the error as recoverable when the state itself is still valid

## Parse Failure Policy

If a phase payload fails validation:

1. do not mutate state
2. return a validation error with field-level issues
3. let the runtime retry with a repair prompt or escalate to a gate

## Quiet Retry Policy

Recoverable verify failures should not be surfaced as user-visible failures by default.

The runtime should:

1. persist the verify output and issues
2. update `verifyAttempts`
3. move back to `phase_clarify`
4. re-issue a `run` response for `clarify`

Only surface a gate or blocker when the workflow truly needs outside input or has exhausted policy.

## Resume Policy

Resume does not infer state from chat history.

Resume must:

1. load the persisted workflow file
2. validate it
3. rebuild the next signal response from the current status
