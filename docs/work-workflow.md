# Work Workflow

Previous: [Check Workflow](check-workflow.md). Next: [Runtime And Agents](runtime-and-agents.md).

`$work` turns a user request into project-language documents, code/test changes, verification evidence, and approved Language System updates.

The workflow has three runtime states:

```text
plan -> implement -> review
```

`plan` is where most user conversation happens. `implement` and `review` should usually run with less conversation because the meaning, expected behavior, and technical plan are already captured.

## Input Contract

`$work` is a change function:

```text
input
  user request, Language System, relevant Work Docs, and repository evidence available to inspect

operation
  express the request in project language, define expected behavior, plan implementation, change code/tests, and verify

output
  Work Docs, source/test/config/docs changes, verification evidence, and approved Language System updates when meaning changed
```

The coding agent reads the provided context first, then gathers only the repository evidence needed for the current action. Evidence can include source, tests, config, manifests, logs, routes, commands, symbols, docs, prior Work Docs, and existing `.krow/system` files.

When context is missing, the agent first tries to resolve it from repository evidence. It asks the user when the missing context is product meaning, accepted terminology, scope, acceptance criteria, ownership, approval, or an external fact that code cannot settle.

## Work Docs

Every Work Item gets the same document shape:

```text
.krow/work/<work-id>/
  index.md
  goal.md
  spec.md
  plan.md
  review.md
```

Optional documents appear only when needed:

```text
tasks/
  index.md
  <task-id>.md
```

Document roles:

```text
Goal
  Project-language statement of what the user wants and why.

Spec
  Use cases, expected behavior, boundaries, and acceptance criteria.

Plan
  Implementation approach, affected areas, task split, and verification strategy.

Task
  One narrow execution unit with dependencies, scope, ownership, and expected output.

Review
  Verification result, evidence, issues, and changed language refs when relevant.
```

Small work keeps the same files short. Large work adds tasks only when the implementation needs explicit dependency or ownership boundaries.

## Language System During Work

Language alignment is not a separate workflow phase. It is a domain capability used by `plan`, `implement`, and `review`.

### plan

`plan` loads relevant Language System refs and repository evidence.

It should:

```text
interpret the user request through approved Glossary terms
identify meaningful objects, actions, states, artifacts, roles, and boundaries
match request language to System Map areas and System Documents
inspect repository evidence when the Language System is empty, missing, or uncertain
resolve ambiguity before depending on Goal, Spec, or Plan wording
draft Goal, Spec, and Plan using approved project language and direct updates to actual Language System docs when new terms or map entries are needed
include approved terms and changed language refs in ready `plan_output`
include a clarification review that separates confirmed requirements, confirmed language, and Goal/Spec/Plan document agreement from open questions or missing premises
emit questions when accepted meaning affects implementation or verification
send a ready plan through project-language and scope review before implementation starts
```

When new reusable meaning is needed for the current work, `plan` updates the actual `.krow/system` docs before implementation depends on it. The plan-review AskAction points the user at those changed docs; rejection sends the workflow back to planning so the same docs can be revised.

`plan` can organize repository evidence and propose concrete language, scope, acceptance criteria, and task boundaries. It does not approve its own interpretation. A ready plan means the language and plan are reviewable, confirmed requirements are explicit, Goal/Spec/Plan wording has a confirmation basis, and open questions or missing premises have already been turned into user questions. Implementation begins only after the user approves the planned project language and scope or sends revisions back into planning.

### implement

`implement` consumes Goal, Spec, Plan, Language System refs, and task docs.

It should:

```text
use the planned project language while editing code, tests, config, and docs
keep task-local changes aligned with the assigned scope
record new questions when implementation reveals a real meaning gap
record code compatibility issues when code names and approved language diverge
```

Implementation can discover language issues, but it should not invent durable project language silently. It records the issue and lets the workflow ask or review.

### review

`review` checks the result against the agreed language and behavior.

It should:

```text
verify that Spec use cases and acceptance criteria are satisfied
verify that code/tests/docs still map to the Goal and Glossary terms
identify changed responsibilities, entry points, states, or workflows
verify that relevant Glossary, System Map, and System Document refs are already current or listed as remaining issues
ask questions when review discovers language meaning that cannot be settled from evidence
```

Review records whether the approved language and implementation still match. New language meaning discovered during review returns to questions or follow-up planning instead of creating a separate language-update approval bundle.

## Language Lifecycle By Repository State

The same workflow works across repository states because krow stores language as evidence-backed project documents rather than framework-specific rules.

### Greenfield initialize

`krow init` creates an empty or seed Language System:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/
```

It also installs agent surfaces. It does not invent product meaning during init.

The first `$work` run reads the user request and any existing repository files, then writes the initial project language into Goal, Spec, Plan, and the actual Language System docs needed for the work. Those docs are reviewed before implementation.

### Greenfield compounding

Later `$work` runs read the accumulated Glossary, System Map, System Documents, and prior Work Docs.

The workflow should:

```text
reuse approved terms before proposing new ones
extend the System Map when new entry points, areas, workflows, or conventions appear
create System Documents when behavior or responsibility becomes reusable
keep one-off implementation notes inside the Work Item
keep only reusable reviewed meaning in `.krow/system`
```

This makes each completed work item improve the next one without requiring a separate language setup phase.

### Brownfield initialize

In an existing repository with no `.krow/system`, `krow init` still only creates the workspace and agent surfaces.

The first `$work` plan treats the repository as evidence:

```text
read manifests, package layout, entry points, tests, README files, config, routes, commands, and visible app structure
infer candidate responsibility areas and entry points from code evidence
use external documentation only when repository evidence shows a framework or tool whose behavior affects the work
ask the user when product meaning, accepted naming, ownership, or compatibility cannot be settled from code
```

The initial Language System is built from the first useful work instead of from a broad upfront audit.

### Brownfield compounding

When a brownfield repository already has `.krow/system`, `$work` treats it as the approved language contract.

The workflow should:

```text
prefer existing Glossary terms and System Map entries
record aliases when user language and code language refer to the same accepted meaning
surface conflicts when code, docs, and approved language disagree
update targeted System Documents when touched behavior or responsibilities changed
leave unrelated stale areas alone unless they affect the current work
```

## Task Scheduling

Large work can split into a task graph during `plan`.

Good tasks:

```text
have one narrow goal
declare dependencies
declare owned files or responsibility boundaries
carry required context refs
define expected output and verification
can be reviewed independently
```

The runner can parallelize ready tasks when dependencies and ownership boundaries show that the tasks are independent. If parallel workers are unavailable, the same ready tasks run serially in deterministic order.

Parallelism is an execution optimization. It does not change `plan -> implement -> review`.

## Review

Review checks:

```text
Goal is still represented by the result
Spec use cases and expected behavior are satisfied
planned tests or proportionate checks passed
skipped checks are explained
changed code still maps to approved or proposed project language
related System Map and System Documents are current enough for the changed meaning
remaining issues and risks are explicit
```

Review is not the coding step. It is the verification record and language-compounding point the next worker can trust.

Next: [Runtime And Agents](runtime-and-agents.md).
