---
name: merge-brief
description: Synthesize outputs from multiple workers into a clean next-step decision. Use when several task results exist and the coordinator must integrate them before continuing or spawning more work.
---

# Merge Brief

Use this skill after worker results arrive.

## Goal

Turn multiple task outputs into one coherent understanding and one clean next step.

## Inputs

Read only the relevant task outputs:

- `.krow/index.md`
- `.krow/tasks/<task-id>/result.md`
- `.krow/tasks/<task-id>/status.md`
- any referenced artifacts

## Rules

- Extract facts, decisions, risks, and open questions.
- Resolve conflicts explicitly.
- Update the coordinator view before spawning new work.
- Never tell the next worker to proceed "based on previous findings."
- Write the synthesized understanding into a new or updated task packet.

## Decision Rules

- Continue an existing task only if the objective is unchanged.
- Spawn a fresh task if the work shifts to a new objective, new evidence set, or new ownership boundary.
- If outputs disagree, do not average them. Create a resolving task with explicit evidence targets.

## Output

Update:

- `.krow/index.md`
- the next task's `brief.md`
- the next task's `context.md`

The result should be a self-contained next step, not a pile of worker transcripts.
