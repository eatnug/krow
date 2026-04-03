---
name: pattern-capture
description: Extract durable knowledge or reusable workflow patterns from hard-won work and save them into the filesystem without polluting the always-loaded instruction.
---

# Pattern Capture

Use this skill after solving something non-obvious that should improve future runs.

## Goal

Capture reusable knowledge without saving noise.

## Save To

Write into `.orchestrator/knowledge/` using these prefixes:

- `pref--` for stable preferences
- `rule--` for mandatory rules
- `pattern--` for reusable patterns

## Quality Gate

Save only when all of these are true:

- the insight was hard-won
- it is not obvious or generic
- it is reusable
- it is specific enough to change future decisions

## Do Not Save

- generic programming advice
- one-off task details
- raw transcripts
- things easily found in standard docs

## File Writing Rules

- lead with the core insight
- keep the file short
- name files by the actual decision pattern, not by the ticket or chat
- prefer principles and heuristics over copy-paste code fragments
