# krow

`krow` is a state-machine workflow harness for coding agents.

It makes agent work more deterministic: requests enter through explicit control surfaces, move through a small set of named phases, emit machine-readable signals, and persist durable state on disk. It also treats repository language as a first-class input, so broad work is grounded in the project's own terms instead of whatever wording happened to appear in the prompt.

## Quick Start

```bash
npx --yes krow-cli@latest init
```

The published package name is `krow-cli`. The installed command remains `krow`.

Do not run `npx krow ...`. That resolves a different npm package.

`init` installs host-facing wrappers and seeds repo-local workflow files, including `.krow/language.md`.

Then use the installed `work` entrypoint from your host:

- Codex: `$work fix the failing release script`
- Claude Code: `/work fix the failing release script`
- Gemini CLI: `/work fix the failing release script`

`init` also installs:

- Codex `$language-map`
- `.krow/language.md` for project vocabulary and language grounding

## Philosophy

Most agent failures are orchestration failures, not model failures.

`krow` keeps the workflow contract small and opinionated:

- run the workflow as an explicit state machine, not as hidden prompt convention
- one worker owns one bounded task
- use repository language as grounding for the work
- gather evidence before changing code
- bundle clarification instead of asking one question at a time
- persist workflow state, task packets, and handoff files on disk
- verification is required before claiming completion

Host coverage matters, but it is not the point. The point is to make coding work traceable, resumable, and less dependent on agent improvisation.

## How It Works

The installed wrappers are thin adapters over the same local control surface:

- `route`: classify a message as chat or work without creating workflow state
- `intake`: extract anchors, missing evidence, clarification questions, and a proposed unit graph
- `start`: persist workflow state immediately and emit the first `run` or `gate` signal
- `status`, `next`, `resume`: inspect or continue persisted workflow state
- `submit-phase`, `submit-decisions`, `stop`: advance or terminate local workflow state

Runtime signals are explicit:

- `run`: execute one bounded phase for one workflow unit
- `gate`: stop for bundled external input only
- `done`: terminal completed, blocked, or stopped state
- `fault`: recoverable or unrecoverable runtime problem

`start --intent work` is the normal entrypoint. It reuses intake analysis internally, but it creates workflow state up front. If the request still needs clarification, `krow` emits a `gate` with an intent-lock plus a bundled decision set instead of forcing the host to restart the workflow from scratch.

Workflow data is persisted under `.krow/`:

- `.krow/state/workflows/<workflowId>.json`
- `.krow/tasks/<workflowId>/`
- `.krow/relays/<workflowId>/`

## Language Grounding

`krow` treats language as grounding, not as mandatory translation.

It separates:

- core terms: general software concepts like `Module`, `State`, `Workflow`, `Config`, `Permission`, `Test`
- tech terms: stack-specific concepts like `React`, `Rust`, `FastAPI`, `Postgres`, `npm`
- project terms: product or domain vocabulary specific to the repository

During intake, `krow` reads `.krow/language.md`, matches approved vocabulary, marks request-only terms as proposed, and records unresolved language gaps. Clarify should resolve those gaps from repository evidence first. Only durable approved terms should be promoted back into `.krow/language.md`.

In Codex, `$language-map ...` runs a focused mapping workflow for this exact problem: it describes the requested codebase scope in the repository's approved language and reports glossary gaps, naming drift, and missing canonical terms.

## Repository Layout

- `AGENTS.md`: always-loaded execution contract
- `docs/HARNESS.md`: full system blueprint
- `docs/FOUNDATIONS.md`: design rationale
- `docs/skills/`: reusable workflow surfaces
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
