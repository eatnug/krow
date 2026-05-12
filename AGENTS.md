# Execution Contract

Use this as the always-loaded instruction surface for `AGENTS.md`, `CLAUDE.md`, or an equivalent runtime instruction file.

## North Star

krow exists to keep coding-agent work aligned with a repository's approved language and current system description.

Quality comes from:

- agreed Glossary terms
- System Documents grounded in code references
- Work Docs that state the requested change with the same language
- small task-local execution
- evidence-backed verification before completion

## Runtime Rules

1. Read available Glossary, System Model, and relevant Work Docs before broad execution.
2. Use repository evidence before making factual claims about behavior, structure, or tests.
3. Resolve ambiguity when meaning affects implementation, verification, or project language.
4. Keep each worker focused on one task with one clear output boundary.
5. Give workers only the context needed for the current step.
6. Use filesystem artifacts as durable handoff between phases, workers, and resumed sessions.
7. Let the runner own workflow order. Agents execute the current step and submit the required output.
8. If verification fails or new ambiguity appears, return to clarify with evidence.
9. Keep diffs small, reviewable, and reversible.
10. Verify before claiming completion.

## Request Routing

Use `$check` when the request is to initialize, refresh, or audit krow's understanding of a repository.

`$check` collects repository evidence, prepares reading-plan and understanding artifacts, lets the agent draft project-language proposals from evidence, and asks for approval before writing durable project understanding. It writes only inside `.krow`.

Use `$work` when the request should create or change code, tests, config, documents, or other project artifacts.

`$work` creates a Work Doc folder and moves through PRD, Spec, Plan, Task, Review, and System Model update as needed.

Work directly only when the task is narrow, local, and verifiable without workflow state.

## Anchor Gate

Start broad implementation after the task has at least one concrete anchor such as:

- file path
- symbol or identifier
- issue or ticket
- numbered deliverables
- acceptance criteria
- failing test or error target

If the request is still broad, create or refine the Work Docs first.

## Filesystem Contract

krow uses this durable workspace:

```text
.krow/
  system/
    glossary.md
    map.md
    docs/
  work/
  check/
  state/
    workflows/
```

`glossary.md` defines approved project terms.

`map.md` is the current high-level System Model index.

`system/docs/*.md` describes current software behavior and responsibilities with System Statements and References.

`work/<work-id>/` records PRD, Spec, Plan, Tasks, and Review for a requested change.

`state/workflows/` stores deterministic runner state and step artifacts.

## Signal Contract

The runner exposes explicit machine-readable signals:

- `run`: execute the current autonomous unit
- `gate`: user or lead input is required
- `done`: workflow reached a terminal state
- `fault`: runtime state or submitted payload is invalid

Every runnable step should identify:

- needed input
- available context
- missing context
- context action
- required output
- submit command or next action

## Worker Rules

- Stay inside the assigned scope.
- Do not split work recursively unless the task packet asks for it.
- Record facts, decisions, blockers, and verification in the assigned artifact path.
- Leave enough durable context for another worker to resume.

## Verification Rules

- Identify what would prove the claim before making the change.
- Run proportionate checks based on change size and risk.
- Report evidence, not guesses.
- If checks cannot run, state exactly what was skipped and why.

## Completion Rules

Completion requires:

- relevant checks passed or concrete blockers recorded
- Work Docs or task artifacts updated when the workflow uses them
- System Model updates proposed or applied when code meaning changed
- concise final report with outputs, evidence, and remaining risks

For the current design notes, read [docs/README.md](docs/README.md).
