# krow Design Notes

This is the entry point for the current design notes.

krow focuses on one product goal:

```text
Describe software in agreed natural language and keep that description aligned with code, tests, and work.
```

krow is a document-driven workflow for coding agents.

## Core Model

```text
Glossary
  The official vocabulary contract.

System Map
  The current repository-wide software map written with Glossary terms.

Work Docs
  Change intent, implementation plan, task records, and review.

Code / Tests
  Implementation and verification.
```

## Design Principles

```text
Use natural language for meaning.
Use fixed Markdown labels for parsing.
Use stable ids for important units.
Use references, not a separate proof system.
Resolve ambiguity only when unresolved meaning affects implementation, verification, or project language.
Give agents only the context needed for the current step.
Keep workflow logic in krow, not in agent-specific prompts.
```

## Core Loop

```text
Glossary + System Map
  -> Work Docs
  -> Tasks change Code / Tests
  -> Review
  -> update Glossary + System Map + System Documents
  -> loop
```

## Read In This Order

1. [Document Model](document-model.md)
   Defines Glossary, System Documents, System Statements, and References.

2. [Templates](templates.md)
   Defines bundled canonical template source files used to generate krow documents.

3. [Check Workflow](check-workflow.md)
   Explains how `$check` runs a repository understanding workflow.

4. [Work Workflow](work-workflow.md)
   Explains how `$work` turns a request into Work Docs, Tasks, code/tests, Review, and Language System updates.

5. [Runtime And Agents](runtime-and-agents.md)
   Defines workflow state, Step Contracts, Agent Invocation Contract, and Codex/Claude/Gemini adapters.

6. [krow Architecture Blueprint](krow-architecture-blueprint.md)
   Defines the target directory-first architecture, layers, generated workspace, and `$work` software walkthrough.

7. [Work Runtime Decisions](work-runtime-decisions.md)
   Defines the implementation decisions needed before building the small agent surface and WorkAction runtime protocol.

8. [Implementation Plan](implementation-plan.md)
   Turns the v2 design into implementation tracks.

## Product Surface

```text
krow init
  Deterministic setup. Creates `.krow` structure and selected agent command surfaces.

$check
  Aligns documented understanding with observed understanding.

$work <request>
  Executes a change through Work Docs, Tasks, code/tests, Review, and Language System updates.
```

## Source Of Truth

This file is the design overview and index. The linked documents are the detailed notes.

For the big-bang `$work` revamp, use this source-of-truth order:

```text
1. implementation-plan.md
   Concrete build order, current baseline, target modules, and done conditions.

2. krow-architecture-blueprint.md
   Target source tree, layer boundaries, ports, adapters, domains, and operation matrix.

3. work-runtime-decisions.md
   WorkAction protocol, payload schemas, submit behavior, workflow state, and naming.

4. work-workflow.md
   Product workflow, Language System lifecycle, greenfield/brownfield behavior, and task scheduling.

5. runtime-and-agents.md
   User -> Coding Agent -> krow runtime loop and installed agent surface behavior.

6. document-model.md and templates.md
   Markdown document shapes, Language System files, Work Docs, and generated template targets.
```

Verification source:

```text
src/inbound-adapters/cli/*.test.mjs
  Co-located black-box tests for packaged agent surface installation and the WorkAction runtime loop.
```

Conflict rule:

```text
implementation-plan.md wins for implementation order.
work-runtime-decisions.md wins for runtime protocol and names.
krow-architecture-blueprint.md wins for module boundaries.
work-workflow.md wins for product and language behavior.
document-model.md and templates.md win for file formats.
```

Big-bang revamp boundary:

```text
Replace old CLI/runtime behavior directly with the target WorkAction runtime.
Use check-workflow.md only when implementing or redesigning $check; it is not the source of truth for the $work revamp.
Treat scratch Excalidraw files as diagram drafts only when a task explicitly asks for diagrams.
```
