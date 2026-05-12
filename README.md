# krow

`krow` lets coding agents build software from repo-local documents: shared language, system description, work plan, code, and tests.

## Use

The npm package is `krow-cli`. It installs `krow-cli` and `krow`.

```bash
# 1. bootstrap krow in a repo
npx --yes krow-cli@latest init
```

Then open your coding agent and ask for work:

```text
# in your coding agent

$work I want to build a habit tracking app.
$work Add login and paid subscription gating.
$work Fix the dashboard loading bug.
```

## Work

`$work <request>` starts a new app, feature, fix, or refactor.

Example:

```text
$work I want to build a habit tracking app.
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

## Brownfield Check

Use `$check` later when krow is added to an existing codebase.

```text
$check about: React app. Free and paid subscription states control feature access.
```

It runs a repository understanding session: collect evidence, write a reading plan, trace code, draft understanding, identify gaps, and apply only approved Glossary/System Model updates.

## Document Shape

Glossary terms define the words:

```md
## Free User

ID: TERM:free-user
Kind: Noun

Meaning:
A User without an active paid Subscription.

Boundary:
Does not include trial or paid users.
```

System Documents describe the software with those words:

```md
# Daily Recommendation Access

ID: DOC:daily-recommendation-access
Kind: Capability

## Statements

### Free User Access

ID: STMT:daily-recommendation-access.free-user

Statement:
Free User is blocked from Daily Recommendation when Subscription is inactive.

Terms:
- TERM:free-user
- TERM:daily-recommendation
- TERM:subscription

References:
- source: src/recommendations/access.ts
- test: src/recommendations/access.test.ts
```

## What It Creates

```text
.krow/system/glossary.md
  agreed project words and meanings

.krow/system/map.md
  current map of the software

.krow/system/docs/*.md
  behavior, rules, structures, and responsibilities

.krow/work/<work-id>/
  PRD, Spec, Plan, Task, and Review for a change

.krow/check/<check-id>/
  evidence, reading plan, understanding drafts, decisions, and report
```

Design notes live in [docs/](docs/).

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
krow check-decisions <checkId> [--root <dir>]
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
