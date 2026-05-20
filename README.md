# krow

`krow` is a harness for coding agents.

It gives agents:

- a shared language system
- documents that compound across work
- a state machine that drives the work deterministically

The state machine keeps agents moving through the workflow we want instead of letting each session invent its own process.

## Start

Initialize krow in a repository:

```bash
npx --yes krow-cli@latest init
```

Start the first session in your coding agent:

```text
$work Add paid subscription gating to daily recommendations.
```

krow starts a work item. The agent reads the current language and code evidence, then may ask:

```text
Should "Free User" mean no active subscription, or also an expired trial?
When access is blocked, should the user see an Upgrade Prompt or a disabled state?
```

After the user answers, the agent writes:

```text
.krow/work/<work-id>/goal.md
.krow/work/<work-id>/spec.md
.krow/work/<work-id>/plan.md
```

Then it implements, verifies, writes `review.md`, and proposes reusable terms or system updates for approval.

Use the same surface for later work:

```text
$work Build a habit tracking app.
$work Fix the dashboard loading bug.
```

## What Happens

`krow init` creates `.krow/` and installs small agent command files.

`$work <request>` runs:

```text
plan -> implement -> review
```

The runner owns state and step order. The agent does the current step and submits evidence back to krow.

When language is missing or unclear, the agent uses repository evidence or asks the user. Approved reusable meaning goes back into `.krow/system`.

## Files

```text
.krow/
  system/
    glossary.md
    map.md
    docs/
  work/
    <work-id>/
      goal.md
      spec.md
      plan.md
      review.md
  state/
    workflows/
```

## More

Design notes and implementation details live in [docs/](docs/).

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT
