# Work Workflow

Part 4 of the v2 plan. Previous: [Check Workflow](check-workflow.md). Next: [Runtime And Agents](runtime-and-agents.md).

`$work` executes code and test changes using Glossary and System Model as starting context.

## Project Understanding During Work

`$work` can start even when the project understanding is incomplete.

## Input Contract

`$work` is a change function:

```text
input
  user request, current project understanding, relevant Work Docs, and repository evidence available to inspect

operation
  clarify the exact execution edge, update Work Docs as needed, change code/tests, and verify the result

output
  updated Work Docs, source/test changes, verification evidence, and proposed Glossary/System Model updates when meaning changed
```

Each step declares what output it must produce. The agent decides which context is needed for that output, reads the existing refs first, and gathers additional source, tests, config, logs, errors, routes, commands, symbols, or prior Work Docs when needed.

When needed context is missing, the agent first tries to obtain it from repository evidence. It asks the user when the missing context is a product meaning decision, approval, acceptance criterion, ownership decision, or external fact that cannot be known from code.

The first runnable step is still clarification. During that step, the agent should identify whether the request depends on:

```text
new Glossary terms
new aliases or boundaries
new System Documents
changed System Statements
unclear references
```

When meaning is missing or ambiguous, `$work` records proposed language or system-model updates and asks for approval before implementation depends on them.

`$check` is the broader alignment route. It is useful before work starts, but it is not required before every `$work` request.

Work Docs can reference Glossary terms or System Documents when that relationship is known. They should not contain placeholder relationships.

## Work Doc Structure

Every work item is a folder:

```text
.krow/work/<work-id>/
  index.md
  prd.md
  spec.md
  plan.md
  tasks/
    task-001.md
  review.md
```

Small work uses the same shape but keeps unnecessary files short.

## Work Docs

```text
PRD
  Why the change matters.

Spec
  What must be true after the change.

Plan
  How the Spec will be implemented.

Task
  One narrow code/test execution unit.

Review
  Verification record after Tasks are complete.
```

PRD may include User Stories when user-facing intent needs a narrative. User Stories are PRD content, not a separate artifact family.

Spec should define desired behavior, rules, state changes, acceptance criteria, and test-shaped examples. Implementation belongs in Plan.

Plan should define implementation approach, affected System Documents, task split, and verification strategy. Plan does not change Spec behavior.

## Splitting

Large work should split by meaning and behavior first, then by executable Tasks.

Default relationship:

```text
PRD slice : Spec = 1:1
Spec : Plan = 1:1
Plan : Task = 1:N
```

Split flow:

```text
large product intent
  -> one PRD or PRD slices
  -> one Spec per PRD slice
  -> one Plan per Spec
  -> executable Tasks
  -> Review
```

If a Plan becomes large, split it into Tasks first. Split the Plan only when implementation judgment itself becomes unclear.

Split into multiple PRDs only when:

```text
the product goals are different
the approvers are different
the release timing is different
the success criteria are independent
reading them together makes judgment less clear
```

If one PRD slice seems to need multiple Specs, first check whether the PRD slice is still too large.

Split Specs when:

```text
behavior rules can be verified independently
user flows or system flows are different
different System Documents are central
test strategy differs
one Spec has too many acceptance criteria
```

Split Plans when:

```text
implementation areas are independent
work order or release order differs
risk and verification differ
one Plan makes implementation review less clear
```

Good Tasks:

```text
have one narrow goal
have clear code/test scope
can be verified independently
can be reviewed independently
```

Task documents should carry enough execution context for one worker:

```text
task id
purpose
related Spec or Plan
dependencies
owned files or responsibility boundary
required context documents
expected code/test changes
verification criteria
result location
```

## Task Scheduling

The runner can parallelize ready Tasks only when the Plan establishes that it is safe.

Deterministic task scheduling rules:

```text
each Task has a stable id
each Task declares dependencies
each Task declares owned files or responsibility boundaries
each Task declares required context documents
each Task declares expected output documents and code/test changes
the runner computes ready Tasks from dependencies
parallel Tasks must have disjoint ownership or an explicit merge plan
integration Tasks run after their dependencies complete
```

If parallel workers are unavailable, the same ready Tasks run serially in deterministic order.

## Default Work Flow

```text
intake
  -> load-glossary-and-system-docs
  -> write-or-update-work-docs
  -> clarify-terms-or-scope when needed
  -> plan-tasks
  -> execute-task
  -> verify-task
  -> review-work
  -> update-system-model
  -> report
```

Code and tests are changed inside `execute-task`. `review-work` checks completed task results against Work Docs, Glossary, System Model, and verification evidence.

## Review

Review checks:

```text
Spec or compact expected behavior was satisfied
tests passed or skipped checks are explained
changed code still maps to Glossary terms
related System Documents are current
new terms, aliases, or boundaries were recorded when needed
remaining gaps or risks are explicit
```

Review is not the coding step. It is the verification record the next worker can trust.

Next: [Runtime And Agents](runtime-and-agents.md).
