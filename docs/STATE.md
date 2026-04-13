# Workflow State Model

This file defines the persisted state shape for the reference runtime.

The engine owns state and writes it after every transition.

## Common Fields

All workflows persist:

- `schemaVersion`
- `workflowId`
- `mode`
- `description`
- `graphStrategy`
- `graphNotes`
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
- `taskRoot`
- `relayRoot`
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

Common optional fields now include:

- `kind`
- `request`
- `scope`
- `dependsOn`
- `parallelizable`
- `ownership`
- `priority`
- `estimatedEffort`
- `mergeRequired`
- `sharedRisks`
- `acceptanceCriteria`

The runtime uses `dependsOn` to decide when a unit becomes ready. Independent root units may exist in parallel; an integration unit can fan in after they complete.

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

## Task Packets

In addition to workflow state, the runtime mirrors each workflow into durable task packet files:

```text
.krow/tasks/<workflowId>/
  index.md
  <unitId>/
    brief.md
    context.md
    status.md
    result.md
    baton.md
    artifacts/
```

Relay copies for downstream units live under:

```text
.krow/relays/<workflowId>/<unitId>.md
```

## Persistence Location

The reference runtime writes workflow files to:

```text
.krow/state/workflows/<workflowId>.json
```
