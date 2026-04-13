# krow

`krow` is a host-agnostic agent harness for coding work.

It packages three things:
- a lean execution contract
- a runtime-agnostic state and signal model
- host wrappers that expose explicit `krow` entrypoints without polluting the core prompts

## Install

From npm:

```bash
npx krow-cli init
```

The published package name is `krow-cli`. The installed command remains `krow`.

That installs:
- Codex `$krow`
- Claude Code `/krow`
- Gemini CLI `/krow`

## Core stance

- model capability is already good enough for many engineering tasks
- quality comes from orchestration, not prompt bloat
- do not guess; gather evidence first
- when clarification is needed, ask for the full current bundle at once
- one worker owns one task with one clear output boundary
- use the filesystem for baton passing, resume, and durable state

## Layout

- `AGENTS.md`: always-loaded execution contract
- `docs/`: non-runtime design docs and repo-local workflow skills
- `docs/HARNESS.md`: full system blueprint
- `docs/FOUNDATIONS.md`: philosophy and design lineage
- `docs/skills/`: reusable workflow surfaces
- `prompts/`: narrow role prompts
- `schemas/`: payload, signal, and state schemas
- `install/`: host wrapper installer

## Usage

- In Codex, invoke `$krow ...`
- In Claude Code, invoke `/krow ...`
- In Gemini CLI, invoke `/krow ...`

The installed wrappers are thin host adapters over the same local control surface:
- `route`: classify a message as chat or work without creating workflow state
- `intake`: extract anchors, missing evidence, bundled clarification questions, and a proposed unit graph
- `start`: create workflow state, carve ready units when strong split signals exist, and emit the first control signal
- `status`, `next`, `resume`: inspect or continue persisted workflow state
- `submit-phase`, `submit-decisions`, `stop`: advance or terminate local workflow state

Runtime signals are explicit:
- `run`: execute one bounded phase for one workflow unit
- `gate`: stop for bundled external input only
- `done`: terminal completed, blocked, or stopped state
- `fault`: recoverable or unrecoverable runtime problem

The wrappers use `intake --intent work` first so agents gather evidence, bundled questions, and a proposed unit graph before a workflow starts. After start, the runtime advances each unit through `clarify -> execute -> verify -> capture`, schedules the next ready unit from the dependency graph, and persists:

- workflow state under `.krow/state/workflows/<workflowId>.json`
- task packets under `.krow/tasks/<workflowId>/`
- relay and baton files under `.krow/relays/<workflowId>/`

The current contract is still host-assisted. `krow` does not spawn teammates itself, but it now gives the host richer scheduling metadata, durable task packets, and stricter clarify/verify payload contracts so parallel-capable hosts can behave more predictably.
