# Workflow State Model

This file defines the persisted state shape for the reference runtime.

The engine owns state and writes it after every transition.

## Common Fields

All workflows persist:

- `schemaVersion`
- `workflowId`
- `mode`
- `description`
- `status`
- `phase`
- `units`
- `currentUnitIndex`
- `captureEnabled`
- `maxVerifyAttempts`
- `verifyAttempts`
- `pendingDecisions`
- `decisionHistory`
- `outputs`
- `createdAt`
- `updatedAt`

## Canonical Statuses

- `phase_clarify`
- `clarify_pending`
- `phase_execute`
- `phase_verify`
- `phase_capture`
- `completed`
- `blocked`
- `stopped`

## Canonical Phases

- `clarify`
- `execute`
- `verify`
- `capture`

## Units

The runtime is unit-agnostic.

Each unit should carry at least:

- `id`
- `title`

Optional fields are runtime-defined. The engine does not interpret them.

## Retry Counters

The runtime tracks:

- `verifyAttempts`
- `maxVerifyAttempts`

Every failed verify path that loops back into `clarify` must update the counter first.

## Output Storage

State keeps structured outputs by unit and phase under `outputs`.

Example shape:

```json
{
  "unit-01": {
    "clarify": {},
    "execute": {},
    "verify": {}
  }
}
```

## Gate Data

The runtime may persist:

- `pendingDecisions` during `clarify_pending`
- `lastVerifyIssues` after a failed verify
- `blockedReason` when the workflow cannot continue

## Persistence Location

The reference runtime writes workflow files to:

```text
.orchestrator/state/workflows/<workflowId>.json
```
