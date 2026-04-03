# krow

`krow` is a host-agnostic agent harness for coding work.

It packages three things:
- a lean execution contract
- a runtime-agnostic state and signal model
- host wrappers that expose explicit work intent without polluting the core prompts

## Install

From this repo:

```bash
npx krow init
```

That installs:
- Codex `$work`
- Claude Code `/work`

## Core stance

- model capability is already good enough for many engineering tasks
- quality comes from orchestration, not prompt bloat
- do not guess; gather evidence first
- when clarification is needed, ask for the full current bundle at once
- one worker owns one task with one clear output boundary
- use the filesystem for baton passing, resume, and durable state

## Layout

- `AGENTS.md`: always-loaded execution contract
- `HARNESS.md`: full system blueprint
- `FOUNDATIONS.md`: philosophy and design lineage
- `skills/`: reusable workflow surfaces
- `prompts/`: narrow role prompts
- `schemas/`: payload, signal, and state schemas
- `reference-runtime/`: strict state-machine reference implementation
- `install/`: host wrapper installer

## Usage

- In Codex, invoke `$work ...`
- In Claude Code, invoke `/work ...`

The host wrapper is only an entry mechanism. The core system operates on explicit work intent, evidence-backed clarification, and `clarify -> execute -> verify`.
