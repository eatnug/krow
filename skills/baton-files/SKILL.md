---
name: baton-files
description: Use the filesystem as a durable relay layer between agents or phases. Writes concise task-state files so another agent can continue without inheriting noisy chat history.
---

# Baton Files

Use this skill whenever work must move between agents, between phases, or between sessions.

## Goal

Leave behind a relay file that is small, factual, and immediately usable by the next agent.

## Required Files

Within `.orchestrator/tasks/<task-id>/` maintain:

- `status.md`
- `result.md`
- `artifacts/` when needed

## File Rules

`status.md`
- current state
- last verified action
- blockers
- next recommended action

`result.md`
- completed work
- evidence
- unresolved risk
- explicit next consumer instruction

`artifacts/`
- logs
- diffs
- benchmark output
- screenshots
- generated notes

## Writing Rules

- Use file paths, command lines, identifiers, and facts.
- Link to evidence instead of pasting large transcripts.
- Record what was actually verified, not what is merely believed.
- If something is uncertain, label it explicitly.
- End with the next action another agent should take.

## Anti-Patterns

- Narrative diaries
- repeated chat summaries
- hidden assumptions not written to disk
- giant copied logs inside markdown files
