# krow

`krow` is a state-machine workflow harness for coding agents.

It turns "please work on this repo" into an explicit workflow: classify the request, gather evidence, split bounded units, emit machine-readable run/gate/done signals, and persist state on disk so the work can be resumed or audited.

`krow` is built for people who use Codex, Claude Code, Gemini CLI, or other coding agents as serious development tools and want less improvisation in the loop.

## Why it exists

Most coding-agent failures are orchestration failures, not model failures:

- the agent starts editing before it has evidence
- scope expands without a named owner
- clarification happens one question at a time
- project vocabulary drifts from the codebase
- state disappears into chat history
- completion is claimed before verification

`krow` keeps the contract small and visible. Work moves through a local state machine, each phase produces structured output, and the repository's own language becomes part of the workflow.

## Quick Start

```bash
npx --yes krow-cli@latest init
```

The published package name is `krow-cli`. The installed command remains `krow`.

Do not run `npx krow ...`. That resolves a different npm package.

`init` installs host-facing wrappers and seeds repo-local workflow files, including `.krow/language.md`.

Then use the installed work entrypoint from your host:

- Codex: `$work fix the failing release script`
- Claude Code: `/work fix the failing release script`
- Gemini CLI: `/work fix the failing release script`

`init` also installs:

- Codex `$language-map`
- `.krow/language.md` for project vocabulary and language grounding

## What it gives you

### Explicit workflow state

Workflow data is persisted under `.krow/`:

```text
.krow/state/workflows/<workflowId>.json
.krow/tasks/<workflowId>/
.krow/relays/<workflowId>/
```

This makes agent work resumable instead of trapped in a single chat session.

### Machine-readable signals

The harness emits a small set of runtime signals:

- `run`: execute one bounded phase for one workflow unit
- `gate`: stop for bundled external input
- `done`: terminal completed, blocked, or stopped state
- `fault`: recoverable or unrecoverable runtime problem

Hosts can wire those signals into their own UI, prompts, or automation.

### Repository language grounding

`krow` treats language as grounding, not mandatory translation. It reads `.krow/language.md`, matches approved vocabulary, marks request-only terms as proposed, and records unresolved gaps.

For Codex, `$language-map` runs a focused mapping workflow that describes a requested codebase scope in the repository's approved language and reports glossary gaps, naming drift, and missing canonical terms.

### Bounded execution

Broad work is decomposed into named units. Each unit has a task packet, an owner, expected evidence, and a verification path.

## How it works

`krow` keeps the workflow contract small and opinionated:

- run the workflow as an explicit state machine, not as hidden prompt convention
- one worker owns one bounded task
- use repository language as grounding for the work
- gather evidence before changing code
- bundle clarification instead of asking one question at a time
- persist workflow state, task packets, and handoff files on disk
- verification is required before claiming completion

Host coverage matters, but it is not the point. The point is to make coding work traceable, resumable, and less dependent on agent improvisation.

The installed wrappers are thin adapters over the same local control surface:

- `route`: classify a message as chat or work without creating workflow state
- `intake`: extract anchors, missing evidence, clarification questions, and a proposed unit graph
- `start`: persist workflow state immediately and emit the first `run` or `gate` signal
- `status`, `next`, `resume`: inspect or continue persisted workflow state
- `submit-phase`, `submit-decisions`, `stop`: advance or terminate local workflow state

Runtime signals are intentionally small:

- `run`: execute one bounded phase for one workflow unit
- `gate`: stop for bundled external input only
- `done`: terminal completed, blocked, or stopped state
- `fault`: recoverable or unrecoverable runtime problem

`start --intent work` is the normal entrypoint. It reuses intake analysis internally, but it creates workflow state up front. If the request still needs clarification, `krow` emits a `gate` with an intent-lock plus a bundled decision set instead of forcing the host to restart the workflow from scratch.

Workflow data is persisted under `.krow/`:

- `.krow/state/workflows/<workflowId>.json`
- `.krow/tasks/<workflowId>/`
- `.krow/relays/<workflowId>/`

## Commands

```bash
krow route "fix the release script"
krow intake "fix the release script"
krow start --intent work "fix the release script"
krow status <workflowId>
krow next <workflowId>
krow resume <workflowId>
krow submit-phase <workflowId> <phase> <payload>
krow submit-decisions <workflowId> <payload>
krow stop <workflowId>
```

## Repository Layout

- `AGENTS.md`: always-loaded execution contract
- `docs/FOUNDATIONS.md`: design rationale
- `docs/HARNESS.md`: full system blueprint
- `docs/HOST-INTEGRATION.md`: host integration notes
- `docs/SIGNALS.md`: runtime signal contract
- `docs/STATE.md`: persisted state model
- `docs/TRANSITIONS.md`: state transition notes
- `prompts/`: narrow role prompts
- `schemas/`: payload, signal, and state schemas
- `install/`: host wrapper installer

## Development

```bash
npm install
npm run typecheck
npm run build
```

`prepublishOnly` runs `npm run build`.

## Publishing

The npm package is published as `krow-cli`.

Typical release flow:

```bash
npm version <patch|minor|major>
npm publish
```

## License

MIT
