---
name: signal-gates
description: Use explicit run, gate, done, and fault responses to drive the flow through a machine-readable control model instead of implicit chat-only control flow.
---

# Signal Gates

Use this skill when a workflow should be resumable, reviewable, and runtime-agnostic.

## Goal

Drive the flow through explicit signal responses rather than hidden conversation state.

## Response Types

- `run` for autonomous work
- `gate` for human or lead input
- `done` for terminal success
- `fault` for unrecoverable or invalid state

## When To Emit a Gate

Emit a gate when:

- user input is needed to resolve a real decision
- approval is required before advancing
- stop or reject routing must be explicit
- capture/save decisions should be confirmed

Do not emit a gate for ordinary `verify -> clarify` retries.

## Rules

- Write state before emitting the next response.
- Keep the response self-contained.
- Include the exact next action or callback token.
- Do not rely on the runtime to infer state transitions from conversation alone.
- Quietly loop back into `clarify` when verification fails but recovery is still possible.
