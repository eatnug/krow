# Implementation Plan

Previous: [Runtime And Agents](runtime-and-agents.md).

This plan defines the concrete build target for the current krow revamp.

The goal is to make `$work` the primary compounding engineering workflow:

```text
User request
  -> Coding Agent follows installed agent surface
  -> krow WorkAction loop
  -> plan
  -> implement
  -> review
  -> approved Language System updates
```

## Current Source Shape

The revamp implementation follows the architecture blueprint directly.

Runtime files:

```text
src/inbound-adapters/cli/cli.ts
  CLI adapter for argv, stdin/file payloads, JSON output, and exit behavior.

src/inbound-adapters/cli/main.ts
  Package bin entrypoint.

src/inbound-ports/work-use-cases.ts
  WorkUseCases port.

src/application/work-application-service.ts
  Coordinates Work state, Language context, Work Docs, state persistence, and WorkAction assembly.

src/domains/work/*
  Owns plan -> implement -> review state transitions, WorkAction contracts, questions, and task graph rules.

src/domains/language/*
  Owns Glossary, System Map, System Document, Reference, term proposal, code compatibility, and language alignment concepts.

src/outbound-ports/*
  Defines WorkflowStateStore, WorkDocStore, LanguageStore, Clock, and IdGenerator.

src/outbound-adapters/filesystem/*
  Implements concrete .krow filesystem persistence.

src/infrastructure/composition/container.ts
  Wires concrete adapters to application services.

src/outbound-ports/template-reader.ts
  Defines access to package-owned document templates.

src/outbound-adapters/filesystem/template-reader.ts
  Reads package-owned document templates from infrastructure/templates.

src/outbound-adapters/filesystem/work-document-renderer.ts
  Renders Work Docs from templates supplied by TemplateReader.

src/domains/language/project-grounding.ts
src/domains/documents/document-contracts.ts
  Project-language and document retrieval helpers used by check/documents paths.

src/inbound-adapters/cli/*.test.mjs
  Co-located black-box runtime tests against the built CLI.

install/krow.mjs
  Runs init and installs agent surfaces that call the public krow CLI.
```

Current bundled templates:

```text
src/infrastructure/templates/documents/glossary.md
src/infrastructure/templates/documents/system-map.md
src/infrastructure/templates/documents/system-doc.md
src/infrastructure/templates/documents/work-index.md
src/infrastructure/templates/documents/goal.md
src/infrastructure/templates/documents/spec.md
src/infrastructure/templates/documents/plan.md
src/infrastructure/templates/documents/task.md
src/infrastructure/templates/documents/review.md
src/infrastructure/templates/agent-surfaces/shared/work-loop.md
src/infrastructure/templates/agent-surfaces/shared/check-loop.md
src/infrastructure/templates/agent-surfaces/codex/work.SKILL.md
src/infrastructure/templates/agent-surfaces/codex/check.SKILL.md
src/infrastructure/templates/agent-surfaces/claude/work.md
src/infrastructure/templates/agent-surfaces/claude/check.md
src/infrastructure/templates/agent-surfaces/gemini/work.toml
src/infrastructure/templates/agent-surfaces/gemini/check.toml
```

## Target Runtime Contract

The target `$work` runtime uses these public commands:

```text
krow work start "<request>" --json
krow work submit <workflow-id> --input <payload.json> --json
krow work next <workflow-id> --json
krow work status <workflow-id> --json
krow work stop <workflow-id> [reason] --json
```

The installed agent surface starts new workflows with:

```text
npx --yes krow-cli@latest work start "<request>" --json
```

Each returned `WorkAction.submit` command pins the resolved runtime version for that workflow.

Canonical WorkAction types:

```text
RunAction
AskAction
DoneAction
FaultAction
```

Canonical work outputs:

```text
plan_output
implement_output
review_output
answers
```

Canonical workflow order:

```text
plan -> implement -> review
```

## Target Workspace

`krow init` creates or maintains:

```text
.krow/
  system/
    glossary.md
    map.md
    docs/
  work/
  state/
    workflows/
```

Each Work Item creates:

```text
.krow/work/<work-id>/
  index.md
  goal.md
  spec.md
  plan.md
  review.md
```

Optional files:

```text
tasks/index.md
tasks/<task-id>.md
language-updates.md
```

## Milestone 1: Document And Template Alignment

Purpose:

```text
Make generated files match the target document model before changing the runtime.
```

Implement:

```text
src/infrastructure/templates/documents/system-map.md
src/infrastructure/templates/documents/goal.md
src/infrastructure/templates/documents/work-index.md
src/infrastructure/templates/documents/spec.md
src/infrastructure/templates/documents/plan.md
src/infrastructure/templates/documents/task.md
src/infrastructure/templates/documents/review.md
src/outbound-adapters/filesystem/work-document-renderer.ts
src/outbound-ports/template-reader.ts
src/outbound-adapters/filesystem/template-reader.ts
install/krow.mjs seed files
```

Required changes:

```text
Add system-map.md template.
Add goal.md template.
Update work-index.md to list Goal, Spec, Plan, Review.
Update createWorkDocuments to create goal.md.
Create task docs only when the caller supplies a task graph.
Keep review.md able to record Glossary, System Map, and System Document updates.
```

Done when:

```text
krow work start creates index.md, goal.md, spec.md, plan.md, review.md for a new Work Item.
npm run typecheck passes.
```

## Milestone 2: WorkAction Types And Validators

Purpose:

```text
Replace the old runtime vocabulary with the target WorkAction protocol.
```

Implement:

```text
src/domains/work/work-action.ts
src/domains/work/work-output-contracts.ts
src/domains/work/questions.ts
src/domains/work/workflow-state.ts
src/validators.ts
src/types.ts migration exports
```

Target types:

```text
WorkAction = RunAction | AskAction | DoneAction | FaultAction
Question
Answer
PlanOutput
ImplementOutput
ReviewOutput
WorkflowState
PendingActionState
OutputRecord
TaskState
RuntimeSession
```

Required changes:

```text
Expose WorkAction as the canonical runtime response.
Use AskAction and Question/Answer for durable user conversation.
Use plan_output, implement_output, review_output, and answers as accepted payload kinds.
Keep compatibility wrappers for old command payloads only where a migration path needs them.
```

Done when:

```text
validators accept the target payloads.
validators reject payloads that do not match the current pending action.
typecheck passes with WorkAction as the public runtime type.
```

## Milestone 3: Work State Machine

Purpose:

```text
Move runtime order to plan -> implement -> review.
```

Implement:

```text
src/domains/work/work-state-machine.ts
src/domains/work/state-handlers/plan-handler.ts
src/domains/work/state-handlers/implement-handler.ts
src/domains/work/state-handlers/review-handler.ts
src/application/work-action-assembler.ts
src/application/work-application-service.ts
```

Required behavior:

```text
startWork creates WorkflowState and first RunAction for plan_output.
submit plan_output stores payload and returns AskAction when questions exist.
submit answers stores Answer artifacts and returns the next RunAction.
ready plan_output must include planned project language and asks for user language/plan review before implement.
approved language/plan review advances to implement.
submit implement_output advances to review.
review_output.passed true advances to DoneAction.
review_output.passed false returns RunAction for implement when retry is useful.
invalid state or invalid payload returns FaultAction.
```

Done when:

```text
A full synthetic workflow can run start -> submit plan -> submit implement -> submit review -> done.
AskAction can interrupt the workflow and resume after answers are submitted.
WorkflowState remains the only state mutation authority.
```

## Milestone 4: Language Domain Integration

Purpose:

```text
Make language alignment part of normal work rather than a separate setup phase.
```

Implement:

```text
src/domains/language/glossary.ts
src/domains/language/system-map.ts
src/domains/language/system-document.ts
src/domains/language/references.ts
src/domains/language/term-proposal.ts
src/domains/language/code-compatibility.ts
src/domains/language/language-alignment-service.ts
src/outbound-ports/language-store.ts
src/outbound-adapters/filesystem/language-store.ts
```

Required behavior:

```text
plan loads relevant Glossary, System Map, System Document, and repo evidence refs.
plan can emit Questions for missing terms, aliases, boundaries, use cases, or acceptance criteria.
implement can record code compatibility issues discovered while changing files.
review can propose Glossary, System Map, and System Document updates.
review can ask for approval before durable language writes.
approved durable language updates write through LanguageStore.
```

Repository modes:

```text
greenfield initialize
  init creates empty or seed language files.
  first work proposes initial terms and map entries from request plus evidence.

greenfield compounding
  later work reuses approved terms and commits reusable new meaning during review.

brownfield initialize
  first work reads repository evidence and proposes only language needed for the current work.

brownfield compounding
  existing .krow/system is the approved language contract.
  touched reusable meaning can update Glossary, System Map, and System Documents.
```

Done when:

```text
plan WorkAction.context includes only relevant language refs.
review_output.language_updates can produce a language-updates.md artifact.
approved updates can be applied to .krow/system files.
```

## Milestone 5: CLI And Agent Surface

Purpose:

```text
Expose the target runtime through stable commands and small installed surfaces.
```

Implement:

```text
src/inbound-adapters/cli/cli.ts
src/inbound-adapters/cli/commands/work-command.ts
src/inbound-adapters/cli/commands/init-command.ts
src/inbound-ports/work-use-cases.ts
src/inbound-ports/repository-setup-use-cases.ts
src/inbound-ports/install-agent-surface-use-cases.ts
install/krow.mjs
```

Required changes:

```text
Support krow work start.
Support krow work submit.
Support krow work next.
Support krow work status.
Support krow work stop.
Generate agent surfaces that call npx --yes krow-cli@latest work start.
Keep old flat commands as compatibility aliases only while migration needs them.
```

Done when:

```text
Codex, Claude, and Gemini generated surfaces all describe the same WorkAction loop.
Installed surfaces contain only start command plus loop rule.
The workflow can be driven entirely through the target work subcommands.
```

## Milestone 6: Task Graph And Parallel Execution Support

Purpose:

```text
Support large work without adding another public workflow phase.
```

Implement:

```text
src/domains/work/task-graph.ts
task graph validation in plan_output
task state in WorkflowState
task docs under .krow/work/<work-id>/tasks/
```

Required behavior:

```text
PlanOutput.tasks defines optional PlannedTask entries.
Each task declares id, title, scope, dependencies, owned files or responsibility boundary, and expected output.
Implement can consume ready tasks serially.
Agent adapters can run independent ready tasks in parallel when the runtime supports workers.
Integration review runs after dependent tasks complete.
```

Done when:

```text
Single-task work stays simple.
Multi-task work has deterministic readiness.
Parallel-ready tasks require disjoint ownership or explicit merge plan.
```

## Milestone 7: Verification And Migration

Purpose:

```text
Prove the new runtime works and remove stale vocabulary from public surfaces.
```

Verification commands:

```text
npm run typecheck
npm run build
npm test
```

Synthetic workflow smoke:

```text
create plan_output JSON at returned output.path
run returned submit command
create implement_output JSON at returned output.path
run returned submit command
create review_output JSON at returned output.path
run returned submit command
expect DoneAction
```

Migration cleanup:

```text
Public docs use WorkAction, AskAction, Goal, Language System, and plan -> implement -> review.
New generated files use goal.md.
Old command names remain only as documented compatibility aliases.
Old phase names remain only in migration notes or removed code.
```
