# Runtime And Agents

Previous: [Work Workflow](work-workflow.md). Next: [Implementation Plan](implementation-plan.md).

krow uses a deterministic runner plus thin agent adapters.

## Init

`krow init` is deterministic bootstrap only.

It creates:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/
.krow/work/
.krow/state/workflows/
.codex/skills/check/SKILL.md
.codex/skills/work/SKILL.md
.claude/commands/check.md
.claude/commands/work.md
.gemini/commands/check.toml
.gemini/commands/work.toml
```

It does not analyze code, interview the user, create project meaning, or edit root always-loaded instruction files such as `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

`krow init` does not create project-local `.krow/templates/` by default. Canonical document templates live inside the installed krow package and are rendered by commands when needed. A future export or override command can expose templates for advanced customization without making every project manage template version drift.

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

`krow init` should not prompt by default. Interactive setup can be added later, but the default command remains scriptable and deterministic.

After init, the CLI prints next steps:

```text
Open your coding agent.
Run $check to create or refresh project understanding.
Run $work <request> when you want to change code using krow.
```

`$work` reports whether approved Glossary terms and System Documents already exist. Missing understanding does not block Work Doc creation; it makes the first clarify step responsible for proposing or approving the needed project language before implementation depends on it.

## Workflow State

Workflow state is filesystem-backed:

```text
.krow/state/workflows/<workflow-id>/
  state.json
  steps/
    <step-id>.json
  artifacts/
```

`state.json` is the small current-state pointer.

`steps/<step-id>.json` records step-local inputs, outputs, validation status, and artifact refs.

Large scan results, reports, proposed updates, and logs live under `artifacts/`.

Agents should read `state.json`, the current step file, and only the referenced artifacts needed for the current step.

## Internal CLI

```text
krow work <request>
  Create Work Docs, create workflow state, and emit the first signal.

krow start <message> --intent work
  Create workflow state directly when Work Docs already exist or an adapter needs the lower-level control surface.

krow status <workflow-id>
  Read current workflow state.

krow next <workflow-id>
  Emit the next run/gate/done/fault signal from current state.

krow submit-phase <workflow-id> <phase> <payload>
  Submit structured output for the current step.

krow submit-decisions <workflow-id> <decision-payload>
  Submit user decisions for a gate.

krow stop <workflow-id> [reason]
  Mark workflow stopped.

krow resume <workflow-id>
  Alias for reading state and emitting next.
```

The runner emits four signal types:

```text
run
  Agent can perform the next deterministic step.

gate
  User decision is required.

done
  Workflow reached terminal success or blocked state.

fault
  Runtime state or submitted payload is invalid.
```

Deterministic execution rule:

```text
The agent never chooses the next step.
The runner emits the current step.
The agent reads the required context and writes the required output.
The runner validates the submitted payload.
Only valid payloads advance state.
```

## Step Contract

Each workflow step has:

```text
Purpose
Inputs
Agent Focus
Outputs
Gate Conditions
```

Step Contracts should give the agent only what it needs for the current step. They should avoid unrelated background, broad history, and unnecessary prohibition lists.

## Step Input Contract

Every agent-facing skill should make the current step contract clear.

```text
Needed Input
  Information required before the step can be done correctly.

Available Context
  Files, refs, state, user seed, task packet, code evidence, or prior decisions already available.

Missing Context
  Facts, scope, decisions, evidence, or verification surfaces still needed.

Context Action
  Read existing refs, inspect the repository, run a safe check, or ask the user.

Output
  The structured payload, file, or command submission that moves the workflow forward.
```

The agent should fill missing context when it can do so from repository evidence. It should ask the user when the missing context is a product meaning decision, approval, or externally unknowable fact.

## Code AI User Boundary

Agent workflows split ownership this way:

```text
Code
  Runs the deterministic state machine, gathers objective evidence, validates output shape, stores artifacts, and applies approved updates.

AI
  Reads evidence, interprets software meaning, plans what to inspect next, drafts project-language documents, and explains gaps.

User
  Approves names, meanings, boundaries, ownership, product intent, and other decisions that repository evidence cannot settle.
```

For `$check`, this means the runner can collect repository material and store artifacts, while the agent writes the reading plan and understanding from the evidence it actually reads.

This shape applies to `$check`, `$work`, and future skills. The specific inputs differ, but the loop stays the same:

```text
know what is needed
  -> gather or ask for what is missing
  -> produce the required output
  -> submit through the runner
```

## Agent Invocation Contract

The runner turns each runnable step into a minimal file-based invocation:

```text
id
purpose
context
output
submit
```

Example:

```json
{
  "id": "invoke-task-001",
  "purpose": "Implement Task TASK:free-user-access.001.",
  "context": [
    ".krow/work/free-user-access/spec.md",
    ".krow/work/free-user-access/tasks/task-001.md",
    ".krow/system/glossary.md",
    ".krow/system/docs/daily-recommendation-access.md"
  ],
  "output": ".krow/state/workflows/work-20260512-001/artifacts/task-001-result.json",
  "submit": "krow submit-phase work-20260512-001 execute .krow/state/workflows/work-20260512-001/artifacts/task-001-result.json"
}
```

Scope, ownership, acceptance criteria, and verification details live in referenced context documents instead of being duplicated into every invocation.

## Agent Adapters

krow standardizes the file-based Agent Invocation Contract, not native tool calling.

Codex, Claude, and Gemini adapters translate the same invocation into the best supported surface for each coding agent.

Agent command surfaces should be generated from shared adapter templates so the behavior stays aligned across coding agents. Agent-specific files contain invocation mechanics, not workflow logic.

Adapters may change:

```text
prompt formatting
command entrypoint
tool-use instructions
subagent or worker strategy
result submission mechanics
```

Adapters should not change:

```text
workflow step order
step purpose
context refs
output path
submit command
meaning decisions
```

If an agent runtime supports parallel workers, the adapter may execute ready independent invocations in parallel. If it does not, it should execute the same ready invocations serially in deterministic order.

Parallelism is an execution optimization, not a different workflow. The runner still owns task readiness, dependency order, output collection, validation, and integration.

Next: [Implementation Plan](implementation-plan.md).
