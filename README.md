# krow

`krow` gives a codebase a shared language, describes the software with that language, and makes coding agents work from those documents.

## Basic Flow

The npm package is `krow-cli`. The installed command is `krow`.

```bash
# bootstrap krow in a repo
npx --yes krow-cli@latest init

# install agent commands too
npx --yes krow-cli@latest init --agents codex,claude,gemini
```

For an existing codebase:

```text
$check about: React app. Free and paid subscription states control feature access.
```

For a new project or a new change:

```text
$work Build the first version of the dashboard.
$work Free users should see an Upgrade Prompt when Daily Recommendation access is blocked.
```

Agent surfaces:

- Codex: `$check`, `$work <request>`
- Claude Code: `/check`, `/work <request>`
- Gemini CLI: `/check`, `/work <request>`

The agent surface is the normal user entrypoint. The CLI is the deterministic runtime underneath it.

## Files

```text
.krow/system/glossary.md
  agreed project words

.krow/system/map.md
  current software map

.krow/system/docs/*.md
  current behavior, rules, structures, and responsibilities

.krow/work/<work-id>/
  PRD, Spec, Plan, Task, and Review docs for a change

.krow/check/<check-id>/
  observed evidence, drafts, decisions, and check report
```

## Project Understanding

The core project documents live under `.krow/system`.

```text
.krow/system/glossary.md
  Approved vocabulary. Defines what important project words mean.

.krow/system/map.md
  The current high-level System Model and route into System Documents.

.krow/system/docs/*.md
  System Documents. Each document describes a current capability, rule, structure, or responsibility area.
```

A System Document is made of System Statements and References.

```text
System Statement
  A current fact about the software, written with Glossary terms.

Reference
  A typed link from a term, statement, document, Work Doc, or Review to concrete project material.
```

## Check

`$check` initializes or refreshes krow's understanding of a codebase.

Example:

```text
$check about: React app. Free and paid subscription states control feature access.
```

The `about` text is a seed. It guides scope and wording, but it is not treated as project truth. `$check` still grounds drafts in repository evidence.

`$check` reads the repository, finds entrypoints and runtime flows, drafts System Documents and System Statements, and asks for approval before writing durable project understanding.

Check output:

```text
.krow/check/<check-id>/observed.json
.krow/check/<check-id>/draft.json
.krow/check/<check-id>/decisions.json
.krow/check/<check-id>/result.md
```

Approval applies selected drafts into:

```text
.krow/system/glossary.md
.krow/system/map.md
.krow/system/docs/*.md
```

Direct CLI equivalent:

```bash
krow check --about "React app. Free and paid subscription states control feature access."
krow check-apply <check-id> <answers.json>
```

## Work

`$work <request>` starts a change using the current Glossary and System Model.

Example:

```text
$work Free users should see an Upgrade Prompt when Daily Recommendation access is blocked.
```

Work Docs are stored under:

```text
.krow/work/<work-id>/
  index.md
  prd.md
  spec.md
  plan.md
  tasks/
  review.md
```

The intended loop is:

```text
Glossary + System Model
  -> Work Docs
  -> Tasks update Code / Tests
  -> Review
  -> proposed Glossary/System Model updates when meaning changed
```

## Runtime

krow uses a deterministic runner with machine-readable signals:

- `run`: execute the current autonomous unit
- `gate`: user or lead input is required
- `done`: workflow reached a terminal state
- `fault`: runtime state or submitted payload is invalid

Agents do not choose the global workflow order. The runner emits the current step, the agent performs that step, and the runner validates submitted output before state advances.

## Commands

```bash
krow init [--agents <all|none|codex|claude|gemini>] [--root <dir>] [--force]
krow check [description] [--about <text>] [--scope <path>] [--root <dir>]
krow check-apply <checkId> <json|path|-> [--root <dir>]
krow work <request> [--root <dir>] [--work-id <id>]
krow documents [message] [--root <dir>]
krow review <workflowId> [unitId] [--root <dir>]
krow start <message> [--intent <work|chat>] [--root <dir>]
krow status <workflowId> [--root <dir>]
krow next <workflowId> [--root <dir>]
krow resume <workflowId> [--root <dir>]
krow submit-phase <workflowId> <phase> <json|path|-> [--root <dir>]
krow submit-decisions <workflowId> <json|path|-> [--root <dir>]
krow stop <workflowId> [reason] [--root <dir>]
```

## Development

```bash
npm install
npm run typecheck
npm run build
npm run smoke:v2
```

`prepublishOnly` runs `npm run build`.

## Publishing

```bash
npm version <patch|minor|major>
npm publish
```

## License

MIT
