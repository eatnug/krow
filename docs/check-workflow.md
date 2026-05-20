# Check Workflow

Previous: [Templates](templates.md). Next: [Work Workflow](work-workflow.md).

`$check` is a repository understanding workflow.

It aligns three things:

```text
Documented Understanding
  Approved Glossary, System Map, and System Documents.

Observed Evidence
  Repository files, package metadata, entrypoints, source code, tests, existing docs, and prior krow artifacts.

Agent Understanding
  The agent's evidence-backed natural-language explanation of what the software is, how to read it, and what current system meaning should be proposed.
```

The purpose of `$check` is not to let code decide project meaning. The purpose is to make the understanding process deterministic enough to resume, review, approve, and repeat.

## Role Boundary

```text
Code
  controls workflow order, collects objective evidence, stores artifacts, validates schemas and references, and applies approved updates.

AI
  reads the evidence, decides what context is still needed, follows code flow, writes the reading plan, drafts project-language proposals, and explains gaps.

User
  approves names, meanings, boundaries, ownership, product intent, and other decisions that repository evidence cannot settle.
```

Code owns process truth.
AI owns interpretation.
User owns meaning approval.

## Durable Outputs

`$check` writes per-run artifacts under:

```text
.krow/check/<check-id>/
  evidence.json
  reading-plan.md
  understanding.md
  proposals.json
  questions.json
  decisions.json
  result.md
```

`$check` updates durable project understanding only through approved or validated outputs:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/*.md
```

`map.md` stores the current reading model:

```text
what this repository appears to be
where to start reading
which flows or areas are currently important
which System Documents define current understanding
which gaps remain
```

This keeps future checks from starting cold. A later `$check` reads the current System Map first, then confirms, revises, or extends it from fresh evidence.

Initial `$check` output uses `needs-agent-draft` when code has collected evidence and created the artifact refs, but the AI-authored reading plan, understanding, proposals, and questions have not been completed yet.

`clean` is reserved for a completed check state with no findings or pending draft work.

## User Input

`$check` may receive user-provided context.

User context can describe project purpose, relevant areas, or current concerns. It guides attention, but it is not project truth by itself.

Terms and System Documents become durable only after they are backed by evidence and approved through the workflow.

## State Flow

```text
collect-evidence
  -> orient-repository
  -> write-reading-plan
  -> trace-code
  -> draft-understanding
  -> review-gaps
  -> ask-user when meaning needs approval
  -> apply-approved-understanding
  -> report
```

## Step Contracts

### collect-evidence

Owner: Code.

Input:

```text
repository root
optional user context
current .krow documents
```

Operation:

```text
collect file inventory
collect package metadata
collect source and test candidates
collect existing Glossary, System Map, System Documents, Work Docs, and prior check artifacts
record reference targets and file existence
```

Output:

```text
.krow/check/<check-id>/evidence.json
```

This step records evidence. It does not decide software meaning.

### orient-repository

Owner: AI.

Input:

```text
evidence.json
user context
current System Map if present
```

Operation:

```text
identify what kind of repository this appears to be
identify likely reading starting points
identify existing project language and documented understanding
identify missing context that can be gathered from code
```

Output:

```text
orientation section in understanding.md
```

### write-reading-plan

Owner: AI, validated and stored by Code.

Input:

```text
orientation
evidence refs
current System Map
```

Operation:

```text
state which files or areas should be read first
state why each reading step matters
state what evidence should confirm or change the plan
state when user clarification is needed
```

Output:

```text
.krow/check/<check-id>/reading-plan.md
updated Reading Plan section in .krow/system/map.md
```

The reading plan is a durable route through the codebase, not an approved product meaning claim.

### trace-code

Owner: AI.

Input:

```text
reading-plan.md
evidence refs
repository files
```

Operation:

```text
read from selected starting points
follow imports, calls, commands, routes, handlers, data structures, tests, and docs as needed
record what was read
record what was not read and why
```

Output:

```text
trace section in understanding.md
```

### draft-understanding

Owner: AI, validated by Code.

Input:

```text
trace section
current Glossary
current System Map
current System Documents
```

Operation:

```text
draft Glossary candidates
draft System Document candidates
draft System Statements
attach references to the evidence that supports each claim
```

Output:

```text
.krow/check/<check-id>/proposals.json
proposal section in understanding.md
```

`proposals.json` should keep Glossary term drafts and System Document drafts as separate first-class proposal lists. Proposals are draft understanding. They are not approved project meaning.

### review-gaps

Owner: AI.

Input:

```text
understanding.md
proposals.json
current .krow documents
```

Operation:

```text
find unclear names
find unclear boundaries
find missing product intent
find stale or missing references
find conflicts between code evidence and current documents
```

Output:

```text
.krow/check/<check-id>/questions.json
gap section in result.md
```

### ask-user

Owner: User, prompted by AI and recorded by Code.

Input:

```text
bundled questions
evidence references
proposal context
```

Operation:

```text
run check-decisions after proposals are ready
approve, revise, reject, or answer meaning questions
```

Output:

```text
.krow/check/<check-id>/decisions.json
decision prompts stored under the check run
```

Meaning questions and approval prompts are separate bundles. `questions.json` records unresolved product, ownership, and boundary questions. `decisions.json` records approve, revise, or reject prompts for draft terms and System Documents.

Blocking meaning questions should be resolved before approval prompts are generated. A question can be marked nonblocking only when the proposal remains valid without that answer.

System Statement References should prove current behavior from source, tests, config, or runtime templates. README, docs, AGENTS, and similar Markdown files are context for product intent, planned direction, and ambiguity; they are not primary References for implemented behavior.

Reading plan and understanding artifacts should be marked `Status: Complete` before `check-decisions` runs. This keeps stale `Draft` handoff files from looking approval-ready.

Agent messages should report refs and concise counts instead of restating large bundles.

### apply-approved-understanding

Owner: Code.

Input:

```text
approved decisions
validated proposals
```

Operation:

```text
write approved Glossary entries
write approved System Documents
update System Map routes, reading plan, references, and remaining gaps
```

Output:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/*.md
.krow/check/<check-id>/apply.md
```

### report

Owner: Code and AI.

Input:

```text
all check artifacts
approved updates
remaining gaps
```

Operation:

```text
report what was read
report what was proposed
report what was approved or skipped
report what remains unclear
```

Output:

```text
.krow/check/<check-id>/result.md
```

## Gap And Drift Detection

`$check` detects gaps by comparing approved documented understanding against fresh evidence and agent understanding.

Gap types:

```text
Missing System Document
  Evidence-backed behavior, responsibility, rule, structure, or user-facing surface has no approved System Document.

Missing Glossary Term
  A recurring important word appears in proposed understanding without an approved term.

Stale Reference
  A documented reference no longer points to existing project material.

Missing Verification
  A System Statement needs test or verification evidence that is absent or unread.

Possible Duplicate
  Two terms or documents appear to describe the same meaning.

Meaning Conflict
  Code evidence, tests, docs, or user language point to incompatible meanings.

Reading Gap
  The current System Map does not explain where future agents should start reading or which areas remain uninspected.
```

## Approval

Approved System changes are runner-owned.

Agents draft or revise proposals. Code applies only explicit approvals.

If review exposes a missing first-class term or document, the next move is a refined proposal or a new decision so the runner records the proposal, decision, apply result, and audit report.

## Ambiguity Resolution

krow resolves ambiguity when unresolved meaning would affect implementation, verification, or project language.

An ambiguity request includes:

```text
what is ambiguous
why the decision matters
evidence already checked
concrete options when available
the requested decision
where the decision will be recorded
```

As Glossary, System Documents, Work Docs, and References accumulate, repeated ambiguity should decrease because prior decisions are retrievable.

Next: [Work Workflow](work-workflow.md).
