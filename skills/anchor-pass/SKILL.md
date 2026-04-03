---
name: anchor-pass
description: Plan-first workflow for broad, ambiguous, or high-risk requests. Produces a PRD, a test spec, and a task graph before heavy execution begins.
---

# Anchor Pass

Use this skill when the task is broad, underspecified, high-risk, or likely to waste execution effort without a plan.

## Goal

Create execution-ready planning artifacts before implementation starts.

## Planning Loop

Run this sequence:

1. `planner` drafts the plan
2. `architect` reviews boundaries and tradeoffs
3. `critic` challenges the plan
4. revise until acceptable or explicitly stopped

`architect` and `critic` must run sequentially, not in parallel.

## Completion Gate

Do not begin heavy implementation until these exist:

- `.orchestrator/plans/prd-<slug>.md`
- `.orchestrator/plans/test-spec-<slug>.md`
- a task index or task graph for execution

Unless the user explicitly bypasses the gate, missing artifacts mean planning is not complete.

## Required Outputs

The PRD should define:

- problem
- scope
- non-goals
- acceptance criteria
- major risks

The test spec should define:

- what must be proved
- which checks are required
- what would count as failure

The task graph should define:

- tasks
- dependencies
- ownership boundaries
- expected outputs
