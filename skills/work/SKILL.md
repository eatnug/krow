---
name: work
description: Primary entry skill for actionable engineering work. Use whenever the user wants code, files, tests, config, or other project artifacts to be created, fixed, refactored, removed, investigated, or verified rather than merely explained.
---

# Work

Use this as the broad work-intake skill.

Typical requests:

- fix a bug
- build a feature
- refactor a module
- remove code or files
- investigate a failure
- update tests or configuration

## Goal

Turn an actionable user request into the right execution mode with the minimum safe clarification.

## Entry Behavior

1. Decide whether the request is work or chat.
2. If it is work, proactively gather local context before asking the user.
3. If external information is still required, ask for all currently required missing information in one bundled clarify gate.
4. Choose the lightest route that preserves quality.

## Routing Rules

Use direct execution when the task is narrow and verifiable.

Use `anchor-pass` when the request is broad, ambiguous, or high-risk.

Use `task-carving` when one task should become multiple bounded tasks.

Use `relay-run` when multiple tasks or ownership boundaries must be coordinated.

Use `finish-loop` when the intent is clearly "keep going until this is actually done."

Use `signal-gates` when the host is driving the flow from machine-readable state.

## Missing Context Policy

Before asking the user, try to recover context from:

- repository structure
- named files or symbols
- tests
- logs and error text
- configuration
- external documentation or research when the task depends on facts not in the repo
- existing plans or relay files

Only ask the user when:

- the target is still too generic
- an external decision is required
- approval policy requires a gate

When asking, do not drip-feed one question at a time if several are already required.

Ask for the full current bundle of missing information at once.

Do not guess missing requirements. Clarify using evidence from code, research, or explicit user answers.

## Loop

Once the route is chosen, move the current unit through:

```text
clarify -> execute -> verify
```

If verification fails and recovery is still possible, loop quietly back into `clarify`.

## Visibility

Host wrappers decide how this skill is registered or invoked.

Treat the following as internal subflows rather than primary exposed entry points:

- `anchor-pass`
- `task-carving`
- `relay-run`
- `signal-gates`
- `baton-files`
- `merge-brief`
- `finish-loop`
- `pattern-capture`
