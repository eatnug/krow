---
name: finish-loop
description: Completion-oriented loop that keeps cycling through clarify, execute, and verify until the work is actually done, blocked, cancelled, or hits a hard attempt limit.
---

# Finish Loop

Use this skill when the user wants completion, not a single implementation pass.

## Goal

Do not stop at "I made a change." Stop only at verified completion or a concrete terminal blocker.

## Loop

1. confirm the task is clarified enough to execute
2. execute the current slice
3. verify the result
4. if verification fails, feed the exact issues back into `clarify`
5. re-execute the narrowed fix
6. re-verify
7. repeat until done, blocked, cancelled, or max attempts reached

## State

Maintain `.krow/state/completion.json` with:

- active
- current iteration
- current phase
- max iterations
- last failure summary

## Rules

- Never declare done with unchecked gates.
- If a blocker appears, try a narrower alternative before giving up.
- Escalate only when the remaining ambiguity is material.
- Keep the retry loop scoped to evidence from verification.
- Do not expose every retry as a user-visible failure.
