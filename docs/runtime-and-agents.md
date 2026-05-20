# Runtime And Agents

Previous: [Work Workflow](work-workflow.md). Next: [Implementation Plan](implementation-plan.md).

krow uses a deterministic CLI runtime plus thin installed agent surfaces.

The user talks to a coding agent. The coding agent talks to krow through CLI commands. krow owns workflow state and returns `WorkAction` values that tell the coding agent the next valid move.

```text
User
  -> Coding Agent
  -> Installed Agent Surface
  -> krow CLI Runtime
  -> WorkAction
  -> Coding Agent
  -> User or repository tools
```

## Init

`krow init` is deterministic setup.

It creates or maintains:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/
.krow/work/
.krow/state/workflows/
.codex/skills/work/SKILL.md
.claude/commands/work.md
.gemini/commands/work.toml
```

It does not analyze code, interview the user, invent project meaning, or edit root always-loaded instruction files such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

`krow init` does not create project-local `.krow/templates/` by default. Canonical document and agent-surface templates live inside the installed krow package and are rendered by commands when needed.

Agent surface selection:

```text
krow init
  Equivalent to `krow init --agents all`.

krow init --agents all
krow init --agents codex
krow init --agents claude
krow init --agents gemini
krow init --agents codex,claude
krow init --agents none
```

After init, the CLI prints next steps:

```text
Open your coding agent.
Run $work <request> when you want krow to guide a change.
```

## Installed Agent Surface

The installed agent surface is a small generated instruction file for each coding agent.

It should say, in agent-native form:

```text
When the user invokes $work, start krow:

  npx --yes krow-cli@latest work start "<request>" --json

Then follow each returned WorkAction until done or fault.
Run WorkAction.submit exactly as provided.
```

The installed surface contains mechanics, not workflow policy. Workflow order, state transitions, output validation, and Language System updates live in the krow runtime.

## Runtime Protocol Commands

The installed surface drives these commands:

```text
krow work start "<request>" --json
  Create or load Work Docs and WorkflowState, then return the first WorkAction.

krow work submit <workflow-id> --input <payload.json> --json
  Submit the payload expected by the current WorkflowState and return the next WorkAction.

krow work next <workflow-id> --json
  Return the current WorkAction without changing state.

krow work status <workflow-id> --json
  Return a read-only status view.

krow work stop <workflow-id> [reason] --json
  Mark the workflow stopped and return a terminal WorkAction.
```

The command printed in `WorkAction.submit` is authoritative. The coding agent follows it instead of reconstructing a command.

## WorkAction Loop

krow returns four action types:

```text
run
  Coding agent performs one autonomous unit and writes the requested output payload.

ask
  Coding agent asks the user the bundled questions and writes an answer payload.

done
  Workflow reached completed, blocked, or stopped status.

fault
  Runtime state or submitted payload is invalid.
```

Loop:

```text
krow returns WorkAction
coding agent performs that action
coding agent writes payload when required
coding agent runs WorkAction.submit
krow validates payload against current WorkflowState
krow advances state
krow returns next WorkAction
```

The coding agent never chooses the next state. It can gather evidence, implement code, run checks, ask the user through `ask`, and report results, but krow owns the workflow transition.

## Workflow State

Workflow state is filesystem-backed:

```text
.krow/state/workflows/<workflow-id>/
  state.json
  artifacts/
```

`state.json` is the small current-state pointer. Large scan results, payloads, reports, answer bundles, and logs live under `artifacts/`.

The coding agent can read state refs when a `WorkAction` includes them, but it advances the workflow only by submitting the required payload.

## Code AI User Boundary

Workflow ownership:

```text
krow runtime
  Owns deterministic state, current action selection, payload validation, artifact storage, and approved Language System writes.

Coding agent
  Reads evidence, interprets software meaning, plans inspections, drafts Work Docs, edits code/tests/docs, runs checks, and writes required payloads.

User
  Provides product intent, accepts names and meanings, resolves scope, approves choices that code cannot settle, and judges unresolved tradeoffs.
```

Conversation that affects workflow state enters through `AskAction`:

```text
krow returns AskAction
coding agent asks the user
user answers in chat
coding agent writes Answer payload
coding agent submits it
krow stores the answers
next RunAction folds accepted answers into Work Docs or review
```

Normal progress updates and final reports can remain plain chat. Product meaning, language approval, acceptance criteria, and externally unknowable decisions should become `Question` and `Answer` artifacts.

## Language Runtime Behavior

The Language System is loaded and changed through the same WorkAction loop.

```text
plan RunAction
  includes relevant Glossary, System Map, System Document, and repository refs.
  may return questions for missing or conflicting meaning.

ask AskAction
  collects user answers for names, boundaries, use cases, acceptance criteria, or approval.

implement RunAction
  uses agreed language and records compatibility issues discovered while changing code.

review RunAction
  verifies code against Work Docs and proposes durable Language System updates.

review AskAction
  asks for approval when durable language updates require user judgment.

done DoneAction
  reports changed files, evidence, language updates, and remaining risks.
```

This keeps language compounding inside normal work instead of requiring a separate setup phase.

## Agent Adapters

Codex, Claude, and Gemini surfaces render the same runtime protocol into each agent's supported skill or command shape.

Adapters may vary:

```text
prompt formatting
agent-native command trigger
tool-use wording
subagent or worker strategy
result submission mechanics
```

Adapters keep the same:

```text
runtime command
WorkAction loop
context refs
output path
submit command
workflow order
meaning decisions
```

If an agent runtime supports parallel workers, the adapter may execute ready independent tasks in parallel when the Plan and task graph establish disjoint ownership. If it does not, the same tasks run serially in deterministic order.

Parallelism is an execution optimization. The runner still owns readiness, dependency order, output collection, validation, and integration.

Next: [Implementation Plan](implementation-plan.md).
