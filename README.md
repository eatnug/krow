# krow

`krow` is a host-agnostic workflow harness for coding agents.

It gives Codex, Claude Code, and Gemini CLI the same durable work loop:

- start from one explicit work entrypoint
- gather evidence before changing code
- bundle clarification instead of asking one question at a time
- persist workflow state, task packets, and handoff files on disk
- move every unit through `clarify -> execute -> verify -> capture`

## Why krow

Most agent failures are orchestration failures, not model failures.

`krow` keeps the runtime contract small and opinionated:

- one worker owns one bounded task
- ambiguous work should be clarified before broad execution
- verification is required before claiming completion
- the filesystem is shared memory for resume, relay, and auditability

If you want your host prompts to stay lean while the workflow stays explicit, this is the layer.

## What you get

`krow init` installs host-facing wrappers and seeds repo-local workflow files.

Today it installs:

- Codex `$work`
- Codex `$language-map`
- Claude Code `/work`
- Gemini CLI `/work`
- `.krow/language.md` for project vocabulary and language grounding

The published package name is `krow-cli`. The installed command remains `krow`.

Do not run `npx krow ...`. That resolves a different npm package.

## Install

Use npm:

```bash
npx --yes krow-cli@latest init
```

That creates local wrappers which call a bootstrap launcher under the user's home directory. After `init`, host-driven runs no longer depend on npm cache state or package-name resolution.

`init` creates `.krow/language.md` when it is missing and upgrades the old placeholder seed. Once a repository starts using that file for durable vocabulary, later `init` runs leave it alone.

## Quick start

1. Run `npx --yes krow-cli@latest init` inside the repository.
2. Open your host and use its work entrypoint:
   - Codex: `$work fix the failing release script`
   - Claude Code: `/work fix the failing release script`
   - Gemini CLI: `/work fix the failing release script`
3. Let the host drive the returned signals until the workflow reaches `done`.

For direct CLI use:

```bash
npx --yes krow-cli@latest start --intent work "fix the failing release script"
```

## How it works

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

## Language grounding

`krow` treats language as grounding, not as mandatory translation.

It separates:

- core terms: general software concepts like `Module`, `State`, `Workflow`, `Config`, `Permission`, `Test`
- tech terms: stack-specific concepts like `React`, `Rust`, `FastAPI`, `Postgres`, `npm`
- project terms: product or domain vocabulary specific to the repository

During intake, `krow` reads `.krow/language.md`, matches approved vocabulary, marks request-only terms as proposed, and records unresolved language gaps. Clarify should resolve those gaps from repository evidence first. Only durable approved terms should be promoted back into `.krow/language.md`.

In Codex, `$language-map ...` runs a focused mapping workflow for this exact problem: it describes the requested codebase scope in the repository's approved language and reports glossary gaps, naming drift, and missing canonical terms.

## Repository layout

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
