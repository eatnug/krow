# krow v2 Master Plan

This is the entry point for the v2 plan.

v2 focuses on one product goal:

```text
Describe software in agreed natural language and keep that description aligned with code, tests, and work.
```

krow is a document-driven workflow for coding agents.

## Core Model

```text
Glossary
  The official vocabulary contract.

System Model
  The current software description written with Glossary terms.

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
Glossary + System Model
  -> Work Docs
  -> Tasks change Code / Tests
  -> Review
  -> update Glossary + System Model
  -> loop
```

## Read In This Order

1. [Document Model](document-model.md)
   Defines Glossary, System Documents, System Statements, and References.

2. [Templates](templates.md)
   Defines bundled canonical template source files used to generate krow documents.

3. [Check Workflow](check-workflow.md)
   Explains how `$check` aligns documented understanding with observed understanding.

4. [Work Workflow](work-workflow.md)
   Explains how `$work` turns a request into Work Docs, Tasks, code/tests, Review, and System Model updates.

5. [Runtime And Agents](runtime-and-agents.md)
   Defines workflow state, Step Contracts, Agent Invocation Contract, and Codex/Claude/Gemini adapters.

6. [Implementation Plan](implementation-plan.md)
   Turns the v2 design into implementation tracks.

## Product Surface

```text
krow init
  Deterministic bootstrap. Creates `.krow` structure and selected agent command surfaces.

$check
  Aligns documented understanding with observed understanding.

$work <request>
  Executes a change through Work Docs, Tasks, code/tests, Review, and System Model updates.
```

## Source Of Truth

This file is the v2 overview and index. The linked documents are the detailed plans.
