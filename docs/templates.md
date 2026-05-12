# Templates

Previous: [Document Model](document-model.md). Next: [Check Workflow](check-workflow.md).

krow uses bundled canonical templates to generate project documents.

## Source Location

Canonical template source files live in the krow codebase:

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

These files are packaged with krow.

`krow init` does not create project-local `.krow/templates/` by default. This avoids template version drift across projects.

Commands render bundled templates into actual project documents when needed:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/<doc-id>.md
.krow/work/<work-id>/index.md
.krow/work/<work-id>/prd.md
.krow/work/<work-id>/spec.md
.krow/work/<work-id>/plan.md
.krow/work/<work-id>/tasks/<task-id>.md
.krow/work/<work-id>/review.md
```

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
- PRD: prd.md
- Spec: spec.md
- Plan: plan.md
- Review: review.md

Tasks:
- tasks/<task-id>.md
```

## prd.md

```md
# PRD: <Work Title>

ID: PRD:<id>
Work: WORK:<id>
Status: <Proposed|Approved|Deprecated>

Problem:
<problem>

Goal:
<goal>

User Stories:
- <user story>

Related Terms:
- TERM:<id>

Related System Documents:
- DOC:<id>

Notes:
<notes>
```

## spec.md

```md
# Spec: <Work Title>

ID: SPEC:<id>
Work: WORK:<id>
Status: <Proposed|Approved|Deprecated>

Desired Behavior:
<desired behavior>

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

Updated Glossary Terms:
- TERM:<id>

Issues:
- <issue>
```

Next: [Check Workflow](check-workflow.md).
