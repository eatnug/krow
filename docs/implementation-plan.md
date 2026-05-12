# Implementation Plan

Previous: [Runtime And Agents](runtime-and-agents.md).

Implement krow in small end-to-end slices.

## Track 1: Document Model

Define bundled canonical templates and parsers for:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/*.md
.krow/work/<work-id>/index.md
.krow/work/<work-id>/prd.md
.krow/work/<work-id>/spec.md
.krow/work/<work-id>/plan.md
.krow/work/<work-id>/tasks/*.md
.krow/work/<work-id>/review.md
```

Bundled template source files live in the krow codebase:

```text
templates/glossary.md
templates/system-doc.md
templates/work-index.md
templates/prd.md
templates/spec.md
templates/plan.md
templates/task.md
templates/review.md
```

`krow init` does not create `.krow/templates/` by default. Project-local template export or override is deferred.

Parser should recover:

```text
terms
aliases
boundaries
document kind
statements
references
work relationships
task criteria
review results
```

## Track 2: User-Facing Commands

Implement:

```text
krow init
$check
$work
```

`krow init` creates structure and selected agent command surfaces.

`$check` aligns documented understanding with observed understanding.

`$work` executes changes through Work Docs and Tasks.

## Track 3: Deterministic Runner

Build the runner around:

```text
workflow state
step state
artifacts
Step Contract
Agent Invocation Contract
validation
gates
resume
```

The agent never chooses the next step. The runner emits the current step, the agent performs that step, and the runner validates submitted output before advancing.

## Track 4: Agent Adapters

Generate thin command surfaces for:

```text
Codex
Claude
Gemini
```

Adapters render the same file-based invocation into each agent's supported surface.

## Track 5: References And Consistency

Build check as a repository understanding workflow, not a direct document generator.

Code-owned inputs:

```text
user-provided context
file inventory
package metadata
existing .krow documents
reference targets and file existence
source and test candidates
```

AI-owned outputs:

```text
orientation
reading plan
code trace
draft understanding
gap review
proposal wording
user questions
```

Code-owned checks:

```text
undefined terms in Work Docs or System Documents
missing System Documents for observed features or responsibilities
missing System Statements for observed behavior or test intent
missing referenced files
System Statements without verification references where tests are expected
possible duplicate terms or statements
possible term meaning conflicts
stale System Documents after code changes
Work Docs completed without Review verification
```

Reference candidates and agent proposals are not project truth. Project meaning is approved through Glossary and System Model documents.
