---
name: relay-run
description: Coordinated multi-task execution using a unit-level clarify/execute/verify loop with durable relays and explicit state for resume or cancellation.
---

# Relay Run

Use this skill when the task has multiple bounded subtasks, clear ownership splits, or a meaningful internal retry loop.

## Canonical Loop

Run each unit through:

```text
clarify -> execute -> verify
```

If verification fails and the path is still recoverable, loop back into `clarify` with the verification evidence attached.

## Filesystem State

Maintain:

- `.krow/state/workflows/<workflow-id>.json`
- `.krow/relays/*.md`
- `.krow/tasks/<task-id>/...`

## Rules

- The lead coordinates. Workers execute.
- Parallelize read-heavy work freely.
- Parallelize write work only with disjoint ownership.
- Every handoff writes a relay before the next worker begins.
- Preserve relays and task packets on cancel or resume.
- Do not introduce a visible failure state for ordinary internal retries.

## Flow State

Track at least:

- active
- current unit
- current phase
- unit history
- verify-loop count
- terminal state when finished

## Stop Conditions

Stop only when:

- verification passes with evidence
- the work is explicitly blocked with recorded reasons
- the user cancels
- max verify retries are exceeded
