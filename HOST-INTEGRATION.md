# Host Integration

This document defines how a host should attach its own command, skill, or plugin surface to the core runtime.

## Separation of Concerns

Keep these layers separate:

- core contract: execution philosophy, clarify rules, verify rules, baton rules
- runtime: state machine, signals, validators, capability policies
- host wrapper: registration syntax, installation format, command or skill entrypoint, tool-permission mapping

The core contract should not care whether a host uses `/work`, `$work`, a button, a command palette action, or a plugin-defined entry.

## Wrapper Responsibilities

Each host wrapper should:

1. register one broad explicit work trigger using the host's native mechanism
2. strip any host-specific syntax before handing the request to the runtime
3. pass `explicitIntent: "work"` to the runtime
4. map runtime capability policies onto the host's tool-permission system
5. map runtime signals onto the host's own worker, tool, and user-interaction primitives

## What Does Not Belong in Core Prompts

Do not encode these in `AGENTS.md`, `CLAUDE.md`, or core role prompts:

- slash-command syntax
- skill-invocation syntax
- plugin manifest details
- installation paths
- host-specific registration instructions

Those are wrapper concerns, not execution concerns.

## Host Examples

Examples of valid wrapper choices:

- Claude Code wrapper registers a native `/work` command and forwards the normalized request as explicit work intent
- Codex wrapper registers a native `$work` skill or plugin entry and forwards the normalized request as explicit work intent

Both wrappers should feed the same core runtime and the same `work` intake behavior.
