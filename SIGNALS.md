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

Suggested schema:

```json
{
  "type": "run",
  "workflow_id": "wf-123",
  "unit_id": "unit-02",
  "phase": "execute",
  "prompt_ref": "or task packet reference",
  "required_schema": "schemas/payloads/execute-output.schema.json",
  "state_ref": ".orchestrator/state/workflows/wf-123.json",
  "context": {},
  "on_complete": { "kind": "phase_output", "phase": "execute" },
  "instructions": "human-readable execution guidance"
}
```

### `gate`

Use when explicit human or lead input is required.

Suggested schema:

```json
{
  "type": "gate",
  "gate": "approve",
  "workflow_id": "wf-123",
  "unit_id": "unit-02",
  "options": ["approve", "revise", "stop"],
  "state_ref": ".orchestrator/state/workflows/wf-123.json",
  "on_complete": {},
  "instructions": "what to present and how to continue"
}
```

### `done`

Use when the workflow reaches terminal success.

Suggested schema:

```json
{
  "type": "done",
  "workflow_id": "wf-123",
  "status": "completed",
  "state_ref": ".orchestrator/state/workflows/wf-123.json",
  "outputs": ["path1", "path2"],
  "message": "workflow completed"
}
```

### `fault`

Use when the engine cannot continue because the state is invalid or the failure is unrecoverable.

Suggested schema:

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

The engine should not know how prompts are executed, how approvals are collected, or how files are rendered in a given UI.

## 8. Filesystem Bindings

Control state should bind directly to:

- `.orchestrator/state/*.json`
- `.orchestrator/plans/*.md`
- `.orchestrator/tasks/*`
- `.orchestrator/relays/*.md`
- `.orchestrator/knowledge/*.md`

## 9. Payload Shapes

The minimum runtime should validate:

- `clarify` output
- `execute` output
- `verify` output
- optional `capture` output
- any decision answers returned from a gate

## 10. Gate Discipline

Emit a `gate` only when the next move truly depends on outside input.

Do not use gates for:

- routine retries
- internal uncertainty that can be resolved by another `clarify` pass
- normal verify failures that still have a clear recovery path
