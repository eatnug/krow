# Reference Runtime

This is a small runtime-agnostic TypeScript reference for the flow described in the kit.

It enforces three things:

1. state is the source of truth
2. every phase payload is validated before state advances
3. failed verification routes back to `clarify` unless a gate or blocker is truly required

The runtime does not execute prompts. It only:

- issue the next control signal
- validate returned payloads
- mutate workflow state through the allowed transitions

The reference package is split into:

- core: pure state machine and validators
- policy: explicit work routing and intake planning
- coded rails: scoped capability policies, isolated worker launch requests, and local control commands
- node entrypoint: a small CLI example for explicit work-intent startup

Files:

- `types.ts`: shared types for state, payloads, and signals
- `validators.ts`: shape validation for workflow state and payloads
- `orchestrator.ts`: transition logic and next-signal generation
- `router.ts`: `chat` vs `work` routing
- `policies.ts`: proactive intake planning and missing-context questions
- `tool-policy.ts`: command-scoped and phase-scoped capability allowlists
- `worker-adapter.ts`: host-agnostic forked worker request shape
- `local-control.ts`: model-free control command registry
- `session.ts`: turn a user message into a workflow start decision
- `file-store.ts`: Node filesystem persistence helpers
- `state-store.ts`: small path helpers shared by the runtime
- `cli.ts`: Node example CLI
- `index.ts`: public exports

Minimal CLI flow:

```text
intake --intent work "fix the login redirect bug"
start --intent work "fix the login redirect bug"
status <workflowId>
next <workflowId>
submit-phase <workflowId> clarify <clarify-output.json>
submit-phase <workflowId> execute <execute-output.json>
submit-phase <workflowId> verify <verify-output.json>
```

The reference CLI commands are local-only control surfaces. They do not ask the model to decide the next control action.

Claude-style coded rails in this package:

- entry-scoped capability policy: the broad `work` intake can gather context but not edit files yet
- phase-scoped capability policy: `clarify`, `execute`, `verify`, and `capture` each expose a narrower allowlist
- forked worker request: worker runs receive isolated context refs plus scoped capabilities
- local control commands: `route`, `intake`, `start`, `status`, `next`, `resume`, `submit-phase`, `submit-decisions`, `stop`
- bundled clarify gate: if external input is required, ask for the full current missing-information set at once

The CLI is only a reference entrypoint. The important boundary is:

- the engine stays runtime-agnostic
- routing and intake stay policy-driven
- any host can replace the Node CLI with its own adapter layer
- a host wrapper can map capability policies to its own tool permission system
- host-specific registration syntax belongs in that wrapper, not in the core prompts
