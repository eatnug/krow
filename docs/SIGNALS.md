# Control Signals

This document defines the runtime-agnostic contract between:

- the flow engine
- the AI runtime
- the user or approval surface
- the filesystem state

The engine is the single source of truth. Runtimes merely execute the next instruction and return structured output.

## 1. Goals

- explicit, machine-readable workflow state
- no hidden chat-only transitions
- resumable execution
- portable across runtimes
- step-agnostic workflow control

## 2. Response Types

### `run`

Use when the next action is autonomous.

Suggested shape:

```json
{
  "type": "run",
  "workflow_id": "wf-123",
  "unit_id": "unit-02",
  "phase": "execute",
  "instruction_ref": "krow://phase/clarify",
  "output_contract": "krow://contract/execute-output",
  "state_ref": ".krow/state/workflows/wf-123.json",
  "workflow_task_index_ref": ".krow/tasks/wf-123/index.md",
  "task_packet_ref": ".krow/tasks/wf-123/unit-02/brief.md",
  "task_status_ref": ".krow/tasks/wf-123/unit-02/status.md",
  "task_result_ref": ".krow/tasks/wf-123/unit-02/result.md",
  "relay_refs": [".krow/relays/wf-123/unit-01.md"],
  "context": {
    "graphStrategy": "parallel_fanout",
    "currentUnit": {},
    "readyUnits": []
  },
  "on_complete": { "kind": "phase_output", "phase": "execute" },
  "instructions": "human-readable execution guidance"
}
```

### `gate`

Use when explicit human or lead input is required.

Suggested shape:

```json
{
  "type": "gate",
  "gate": "approve",
  "workflow_id": "wf-123",
  "unit_id": "unit-02",
  "options": ["approve", "revise", "stop"],
  "state_ref": ".krow/state/workflows/wf-123.json",
  "on_complete": {},
  "instructions": "what to present and how to continue"
}
```

### `done`

Use when the workflow reaches terminal success.

Suggested shape:

```json
{
  "type": "done",
  "workflow_id": "wf-123",
  "status": "completed",
  "state_ref": ".krow/state/workflows/wf-123.json",
  "outputs": ["path1", "path2"],
  "message": "workflow completed"
}
```

### `fault`

Use when the engine cannot continue because the state is invalid or the failure is unrecoverable.

Suggested shape:

```json
{
  "type": "fault",
  "workflow_id": "wf-123",
  "phase": "verify",
  "error": "message",
  "recoverable": false
}
```

## 3. Canonical Phase Loop

Every workflow unit runs through:

```text
clarify -> execute -> verify
```

Optional:

```text
capture
```

The engine does not care what the unit represents. It only cares about the unit id, the current phase, and the validated output for that phase.

When several units are ready at once, the `run.context` payload should expose that ready batch so the host can choose serial or parallel execution. The signal still represents one current unit; siblings are scheduler metadata, not permission to collapse units into one payload. Hosts should read the referenced task packet and upstream relay files before acting.

## 4. Quiet Recovery

If `verify` fails, the engine should usually transition back to `clarify`.

This transition is internal. Do not emit a user-facing failure unless:

- a real decision is required
- policy requires an approval gate
- the workflow is blocked
- the retry limit is exceeded

## 5. State Model

The engine owns canonical workflow state.

Suggested fields:

- `workflowId`
- `description`
- `mode`
- `units`
- `currentUnitIndex`
- `status`
- `phase`
- `verifyAttempts`
- `maxVerifyAttempts`
- `pendingDecisions`
- `decisionHistory`
- `outputs`
- `createdAt`
- `updatedAt`

State should be persisted after every transition.

## 6. Transition Rules

- Every phase completion writes state.
- Every gate entry writes state.
- Every terminal transition writes state.
- Resume reads state first and rebuilds the next response from it.
- Invalid payloads do not advance state.
- Verification failure routes back to `clarify` unless the workflow is blocked or gated.

## 7. Adapter Boundaries

The runtime should be split into:

- `AIAdapter`
- `IOAdapter`
- `SystemAdapter`

The engine should not know how phase instructions are executed, how approvals are collected, or how files are rendered in a given UI.

## 8. Filesystem Bindings

Control state should bind directly to:

- `.krow/state/*.json`
- `.krow/state/workflows/*.json`
- `.krow/plans/*.md`
- `.krow/tasks/*`
- `.krow/relays/*.md`
- `.krow/knowledge/*.md`

## 9. Payload Shapes

The minimum runtime should validate:

- `clarify` output
- `execute` output
- `verify` output
- optional `capture` output
- any decision answers returned from a gate

The clarify payload should include evidence and acceptance criteria. For Example-backed work, the execute payload should include Example-test links, implementation links, and ordered execution steps. The verify payload should include concrete checks, evidence, and any unverified claims.

## 10. Gate Discipline

Emit a `gate` only when the next move truly depends on outside input.

Do not use gates for:

- routine retries
- internal uncertainty that can be resolved by another `clarify` pass
- normal verify failures that still have a clear recovery path
