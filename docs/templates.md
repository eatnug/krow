# Templates

Previous: [Document Model](document-model.md). Next: [Check Workflow](check-workflow.md).

krow uses bundled canonical templates to generate project documents and install agent surfaces.

## Source Location

Canonical template source files live in the krow codebase:

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

Document templates are packaged with krow and read through the `TemplateReader` outbound port.

Agent surface templates are packaged with krow and rendered by `krow init`.

`krow init` does not create project-local `.krow/templates/` by default. This avoids template version drift across projects.

Commands render bundled templates into actual project documents when needed:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/<doc-id>.md
.krow/work/<work-id>/index.md
.krow/work/<work-id>/goal.md
.krow/work/<work-id>/spec.md
.krow/work/<work-id>/plan.md
.krow/work/<work-id>/review.md
```

Task documents are rendered after `plan_output.tasks` defines a task graph.

Project-local template export or override can be added later.

## Template Rules

```text
placeholder only
optional sections may be present
no examples
no guide text
no fake project meaning
```

## glossary.md

```md
# Glossary

## <Term>

ID: TERM:<id>
Kind: <Noun|Verb|State|Rule>
Status: <Proposed|Approved|Deprecated>

Meaning:
<meaning>

Boundary:
<boundary>

Aliases:
- <alias>

References:
- <role>: <target>
```

## system-map.md

```md
# System Map

## <Area>

ID: MAP:<id>
Status: <Proposed|Approved|Deprecated>

Summary:
<summary>

Entry Points:
- <path-or-command>

System Documents:
- DOC:<id>

Notes:
<notes>
```

## system-doc.md

```md
# <System Document Title>

ID: DOC:<id>
Kind: <Capability|Shared Rule|Shared Structure|Responsibility Area>
Status: <Proposed|Approved|Deprecated>

Summary:
<summary>

Notes:
<notes>

## Statements

### <Statement Title>

ID: STMT:<id>
Status: <Proposed|Approved|Deprecated>

Statement:
<statement>

Terms:
- TERM:<id>

References:
- <role>: <target>

Notes:
<notes>
```

## work-index.md

```md
# <Work Title>

ID: WORK:<id>
Status: <Proposed|Approved|In Progress|Completed|Blocked>

Summary:
<summary>

Related Terms:
- TERM:<id>

Related System Documents:
- DOC:<id>

Documents:
- Goal: goal.md
- Spec: spec.md
- Plan: plan.md
- Review: review.md

Tasks:
- (none)
```

## goal.md

```md
# Goal: <Work Title>

ID: GOAL:<id>
Work: WORK:<id>
Status: <Proposed|Approved|Deprecated>

Statement:
<summary>

Terms:
- TERM:<id>

Decisions:
- <decision>
```

## spec.md

```md
# Spec: <Work Title>

ID: SPEC:<id>
Work: WORK:<id>
Status: <Proposed|Approved|Deprecated>

Desired Behavior:
<desired behavior>

Use Cases:
- <user story>

Rules:
- <rule>

Acceptance Criteria:
- <criterion>

Examples:
- <example>

Related Terms:
- TERM:<id>

Related System Documents:
- DOC:<id>

Out Of Scope:
- <scope>
```

## plan.md

```md
# Plan: <Work Title>

ID: PLAN:<id>
Work: WORK:<id>
Spec: SPEC:<id>
Status: <Proposed|Approved|Deprecated>

Approach:
<approach>

Affected System Documents:
- DOC:<id>

Implementation Areas:
- <path-or-area>

Verification:
- <verification>

Tasks:
- TASK:<id>

Notes:
<notes>
```

## task.md

```md
# Task: <Task Title>

ID: TASK:<id>
Work: WORK:<id>
Plan: PLAN:<id>
Status: <Proposed|Ready|In Progress|Completed|Blocked>

Purpose:
<purpose>

Dependencies:
- TASK:<id>

Ownership:
- <file-or-responsibility>

Context:
- <path-or-doc-id>

Expected Changes:
- <change>

Verification:
- <verification>

Result:
<result>
```

## review.md

```md
# Review: <Work Title>

ID: REVIEW:<id>
Work: WORK:<id>
Status: <Pending|Passed|Needs Work|Needs Decision|Blocked>

Result:
<result>

Verified:
- <verification>

Updated System Documents:
- DOC:<id>

Updated System Map Entries:
- MAP:<id>

Updated Glossary Terms:
- TERM:<id>

Issues:
- <issue>
```

Next: [Check Workflow](check-workflow.md).
