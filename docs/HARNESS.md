# System Blueprint

This document defines a product-agnostic, codebase-agnostic, architecture-agnostic flow system for agentic work.

The system is built around your philosophy:

- model capability is already good enough
- quality comes from routing and clean context
- one worker should own one task
- large work should be split into bounded tasks
- the filesystem should carry shared memory and relays

## 1. Design Goals

The system should:

- keep every worker focused on exactly one task
- keep worker context clean and task-local
- split large work into bounded subtasks
- use the filesystem as shared memory and relay surface
- support verification, resume, cancellation, and recovery
- keep the always-loaded instruction lean and move workflows into skills and role prompts
- keep the engine step-agnostic

## 2. System Layers

The system has six layers.

### Layer A: Always-Loaded Contract

This is the content of `AGENTS.md`, `CLAUDE.md`, or an equivalent always-loaded instruction file.

It stays small and stable. It defines:

- the north star
- routing rules
- the anchor gate
- the filesystem contract
- role boundaries
- verification and learning rules

It should not contain long workflows, large examples, or role-by-role detail.

### Layer B: Role Prompts

Role prompts are narrow execution surfaces for spawned workers. They inherit the global contract but sharpen it for one job.

Core loop roles:

- `clarify`
- `executor`
- `verifier`

Optional helpers:

- `explore`
- `planner`
- `architect`
- `debugger`
- `critic`
- domain specialists as needed

Role prompts are injected only when that role is actually used.

### Layer C: Skills

Skills hold repeatable workflows that do not belong in every session.

Primary intake skill:

- `work`

Internal subflows:

- `anchor-pass`
- `task-carving`
- `relay-run`
- `signal-gates`
- `baton-files`
- `merge-brief`
- `finish-loop`
- `pattern-capture`

The intended structure is:

- the host exposes one broad explicit work trigger using its own registration mechanism
- that trigger maps into the `work` intake
- `work` routes internally to the narrower subflows

### Layer D: Signal Layer

The engine should be runtime-agnostic. It should not assume any particular assistant surface or tool stack. It should emit machine-readable signals that a runtime can execute.

Canonical response kinds:

- `run`
- `gate`
- `done`
- `fault`

Canonical phases:

- `clarify`
- `execute`
- `verify`
- optional `capture`

The engine does not own any fixed domain-specific step ladder such as plan, spec, fix, or review. Runtimes may define arbitrary workflow units, but every unit moves through the same phase loop.

### Layer D2: Coded Rails

The engine should not depend on prompts alone for control.

Borrow the strongest execution-frame ideas from command-driven systems:

- intercept explicit entry surfaces in code
- apply scoped capability allowlists per entry or phase
- support forked worker execution with isolated context
- keep control commands local when they only mutate or inspect workflow state

This keeps the model inside coded rails rather than asking the prompt to self-police every turn.

### Layer E: Filesystem Runtime

The filesystem is the durable cross-worker memory surface.

Recommended layout:

```text
.krow/
  index.md
  state/
    session.json
    workflow.json
    completion.json
  plans/
    prd-<slug>.md
    test-spec-<slug>.md
  tasks/
    task-001/
      brief.md
      context.md
      status.md
      result.md
      artifacts/
  relays/
    01-anchor-to-work.md
    02-work-to-check.md
    03-check-to-next.md
  knowledge/
    pattern--*.md
    rule--*.md
    pref--*.md
  logs/
  artifacts/
```

`index.md` is the lead's live overview of the workflow: active tasks, dependencies, and next actions.

### Layer F: Resume and Learning

State files capture progress and pending decisions.

Knowledge files capture reusable learnings discovered from hard work.

If the chat compacts or a session restarts, the system recovers from:

- the index
- state files
- plan files
- task packets
- relay files
- knowledge files

## 3. Core Operating Principles

### A. Evidence First

Never claim behavior, architecture, or side effects without reading, searching, or testing.

### B. Delegate Execution, Not Understanding

Workers produce outputs. The lead reads those outputs, extracts meaning, and creates the next task packet.

Never tell a downstream worker to proceed "based on previous findings" unless those findings have already been written into its task packet.

### C. One Worker, One Task

Each worker should have:

- one objective
- one owner
- one output contract
- one validation path

If a worker needs unrelated context, the task is too large and should be split.

### D. Use the Lightest-Weight Path

The preferred order is:

1. direct work
2. specialized tool or narrow helper
3. spawned worker
4. coordinated multi-task flow

### E. Filesystem Over Chat

Cross-worker memory should live in structured files, not in long conversation history.

## 4. Request Classification

Route each request into one of four modes.

In practice, the broad intake concept should be `work`.

`work` performs the first routing decision and then chooses one of the modes below.

### Mode 1: Direct

Use when the task is narrow, local, and verifiable by one worker without context pollution.

### Mode 2: Anchored

Use when the task is broad, underspecified, high-risk, or has unclear acceptance criteria.

This mode runs `anchor-pass`.

### Mode 3: Relay Run

Use when the task has multiple file or module surfaces, parallelizable subtasks, or a meaningful internal retry loop.

This mode runs `relay-run`.

### Mode 4: Finish Loop

Use when the user's intent is "keep going until it is actually done."

This mode runs `finish-loop`.

## 4A. Entry Surface

To keep the system easy to adopt, expose only one broad intake surface by default:

- `work`

Everything else should usually remain internal.

Registration syntax belongs to host wrappers, not to the core contract.

## 5. Workflow Units

The engine is unit-agnostic.

A workflow may contain:

- one unit
- multiple named units
- units produced dynamically during execution

The engine does not care whether a unit is "plan a rollout", "edit one module", or "write a brief." It only needs:

- a unit id
- a unit title
- the current phase
- the state and outputs for that unit

This keeps the control plane reusable across very different kinds of work.

## 6. Canonical Phase Loop

Every unit runs through the same loop:

```text
clarify -> execute -> verify
```

Optional:

```text
capture
```

### Clarify

This phase answers:

- what exactly is the target
- what is in scope
- what proof will count
- what assumptions are being made
- what external decisions are still missing

Clarify is not a long planning ritual. It is the minimum tightening required to execute safely.

If external information is still required, `clarify` should bundle all currently known missing requirements into one gate instead of drip-feeding questions.

### Execute

This phase performs the current unit of work using the clarified scope.

### Verify

This phase tries to disprove the claimed outcome using appropriate checks and evidence.

### Capture

Optional final extraction of reusable patterns or rules.

## 7. Retry Policy

If anything goes wrong, the flow returns to `clarify`.

That includes:

- verification failures
- newly discovered ambiguity
- scope drift
- conflicting evidence
- broken assumptions

The engine should not jump directly from a failed `verify` into a blind `fix` phase. It should first restate the problem precisely, tighten the scope again, and then re-enter `execute`.

This keeps recovery explicit and prevents the system from compounding mistakes.

## 8. User-Facing Behavior

Internal loopbacks should be quiet.

The user should not see every retry as a separate failure unless:

- a true decision is required from them
- an approval policy requires a gate
- the work is blocked
- the runtime hits a hard retry limit

Ordinary `verify -> clarify -> execute -> verify` churn should stay inside the engine. User-facing status can remain "in progress" until the system has something meaningful to ask or report.

## 9. Gates

Gates are explicit states, not vague conversational suggestions.

Use a gate only when:

- the user must choose between real options
- an approval policy requires confirmation
- the work is blocked on external input
- the workflow is stopping or being rejected

Do not emit a gate for routine internal retries.

## 10. Anchor Pass

Broad requests should pass an anchor gate before heavy implementation.

Use `anchor-pass` when the request lacks:

- a concrete file or symbol target
- clear acceptance criteria
- a narrow execution edge

The output of `anchor-pass` is not a fixed step ladder. It is simply enough structure for the first real unit to enter `clarify`.

## 11. Relay Run

Use `relay-run` when work spans multiple bounded tasks.

Rules:

- the lead coordinates
- each worker gets one task packet
- write-heavy work is parallelized only with disjoint ownership
- every handoff becomes a relay file
- relays summarize facts, outputs, and next edges

## 12. Finish Loop

`finish-loop` is a completion posture, not a separate pipeline.

It keeps the unit loop running until one of these is true:

- verification passes
- the work is blocked with recorded reasons
- the user cancels
- a retry limit is reached

## 13. Lead Responsibilities

The lead should:

- choose the right mode
- keep the task graph clean
- create sharp task packets
- synthesize worker outputs
- manage relays and state
- keep internal retry loops quiet unless a gate is required
- require evidence for missing facts instead of allowing guesses

The lead should not:

- offload core understanding to workers
- let workers recursively split work unless intended
- let multiple workers edit the same surface without a clear boundary

## 14. Worker Responsibilities

Workers should:

- stay inside scope
- record facts and outputs in files
- avoid speculative redesign
- stop and return to `clarify` when new ambiguity appears

## 15. Verification Depth

Match verification effort to risk:

- small local changes: local checks and direct inspection
- multi-file or behavior-sensitive changes: broader tests and independent checks
- architectural or security changes: deeper proof and explicit review

## 16. Learning Capture

Only extract durable knowledge when it is:

- hard-won
- reusable
- specific
- likely to change future decisions

Capture should not pollute the always-loaded instruction.

## 17. Minimal Implementation Surface

If you implement a runtime from this blueprint, the minimum pieces are:

- a persisted workflow state file
- schemas for `clarify`, `execute`, `verify`, and optional `capture`
- schemas for `run`, `gate`, `done`, and `fault`
- a transition table
- a runtime that validates outputs before state advances

Useful additions:

- entry-scoped capability policy
- phase-scoped capability policy
- forked worker launch interface
- local control commands for route/start/status/next/stop

The core guarantee is simple:

- the engine decides state
- the runtime executes the current signal
- invalid output does not advance the workflow
