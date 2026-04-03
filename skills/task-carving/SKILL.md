---
name: task-carving
description: Split a large task into clean, self-contained task packets with explicit ownership, dependencies, and validation. Use when one agent would accumulate mixed context or when independent work can run in parallel.
---

# Task Carving

Use this skill when a task is too broad for one clean worker.

## Goal

Convert one messy task into a small set of sharp task packets that can be executed directly or delegated safely.

## Rules

- Split by deliverable, write scope, validation scope, or dependency stage.
- Do not split by vague specialty labels alone.
- Prefer 2-5 tasks. Only create more when the boundaries are genuinely clear.
- Parallelize only when ownership is disjoint.
- If two tasks would edit the same surface, sequence them instead.

## Output

Create or update:

- `.orchestrator/index.md`
- `.orchestrator/tasks/<task-id>/brief.md`
- `.orchestrator/tasks/<task-id>/context.md`

## Task Packet Template

Each `brief.md` should contain:

- objective
- scope
- non-goals
- assigned ownership
- dependencies
- expected output
- done criteria

Each `context.md` should contain only:

- exact files, references, or artifacts needed
- constraints or decisions that affect this task
- open questions that block this task

## Decision Rules

- Keep related evidence with the task that needs it.
- Do not duplicate large context across tasks.
- If a task can be expressed as "change these files and prove this behavior," it is probably small enough.
- If a task needs unrelated knowledge to proceed, split it again.
