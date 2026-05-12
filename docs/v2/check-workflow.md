# Check Workflow

Part 3 of the v2 plan. Previous: [Templates](templates.md). Next: [Work Workflow](work-workflow.md).

`$check` aligns documented understanding with observed understanding.

## Understanding

`Documented Understanding` is what current krow documents say:

```text
Glossary
System Documents
Work Docs
References
```

`Observed Understanding` is what the repository appears to contain:

```text
source files
tests
routes
commands
package structure
story-facing names
other inspectable project evidence
```

If no approved krow documents exist, `$check` proposes an initial Documented Understanding from Observed Understanding.

If krow documents already exist, `$check` finds gaps, stale references, drift, missing terms, and possible updates.

If older krow artifacts exist, `$check` treats migration as an internal alignment mode.

Internal modes:

```text
initial modeling
  No approved Glossary or System Model exists yet. Propose initial documents from observed repository evidence.

migration
  Older krow artifacts exist and need conversion into the current document model.

consistency check
  Documented Understanding exists and should be checked against Observed Understanding.

refresh
  The repository changed and references or System Statements may be stale.
```

## About Input

`$check` may accept optional `about` input from the user.

`about` is a user seed. It can describe what the project is, which parts matter, and which areas should be inspected first.

Only approved structured document changes become project meaning.

`$check` does not edit source code or tests. It writes observed evidence, draft decisions, reports, and approved document updates inside `.krow`.

## Input Contract

`$check` is a repository-understanding function:

```text
input
  optional user seed, current `.krow` documents, and repository evidence available to inspect

operation
  identify the repository profile, find entrypoints, trace runtime flows, gather supporting context, and isolate meaning decisions that only the user can make

output
  check report, observed understanding, draft System Documents, draft System Statements, references, and bundled user questions when needed
```

The runner should tell the agent what the current step must produce and which refs are already available. The agent may inspect package metadata, entrypoints, source roots, tests, commands, schemas, exported symbols, current `.krow` documents, or other relevant evidence as the step requires.

Repository understanding is ordered:

```text
repository profile
  -> entrypoints
  -> runtime flows
  -> draft System Documents and Statements
```

Approval drafts are grounded in package metadata, entrypoints, runtime flows, source evidence, or test evidence. The user seed guides scope and wording but is not document evidence.

When needed context is missing, the agent first tries to obtain it from repository evidence. It asks the user only for meaning, scope, ownership, approval, or external facts that the repository cannot decide.

The user seed guides scope selection, but it is not promoted directly into Glossary or System Documents.

## Observed Understanding v0 Inputs

```text
optional about hint
file inventory
package metadata
source filenames
test filenames
cheap test names
cheap exported symbols
cheap routes or commands
reference target existence
story-facing names
```

Later extensions:

```text
AST analysis
language-specific scanners
test execution
runtime introspection
UI exploration
DB schema introspection
```

Observed Understanding v0 outputs:

```text
draft System Documents
draft System Statements
statement references
missing or stale references
unknowns and ambiguities
```

## Gap And Drift Detection

`compare-understanding` v0 should detect:

```text
Missing System Doc
  An observed feature, flow, rule, structure, or responsibility has no System Document.

Missing Statement
  Important observed behavior or test intent has no System Statement.

Stale Reference
  A referenced file, route, command, test, or target no longer appears valid.

Missing Verification
  A System Statement exists without a verification reference where one is expected.

Possible Duplicate
  Similar terms or statements appear to describe the same meaning.

Meaning Conflict
  One term appears to be used with conflicting meanings.
```

## State Flow

```text
detect-state
  -> build-documented-understanding
  -> build-observed-understanding
  -> compare-understanding
  -> propose-alignment
  -> resolve-ambiguity when meaning changes
  -> apply-approved-updates
  -> report
```

## Approval

`$check` can create proposals, ask bundled questions, and apply approved user decisions.

It should not silently approve project meaning.

Generated scans are draft understanding, not project truth.

## Ambiguity Resolution

krow resolves ambiguity when unresolved meaning would affect implementation, verification, or project language.

An Ambiguity Resolution request should include:

```text
what is ambiguous
why the decision matters
concrete options
a recommendation when possible
the requested decision
where the decision will be recorded
```

krow does not ask because a workflow is early. It asks when unresolved meaning or execution-critical uncertainty blocks a correct next step.

As Glossary, System Documents, Work Docs, and References accumulate, repeated ambiguity should decrease because prior decisions are retrievable.

Questions should be bundled. The system should gather the current set of missing decisions and ask together instead of interrupting the user one question at a time.

Next: [Work Workflow](work-workflow.md).
