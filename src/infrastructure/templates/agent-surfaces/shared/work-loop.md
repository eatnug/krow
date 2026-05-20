## Startup

If the request is empty, ask the user what they want to change.

Run with the current request in place of `<request>`:
`{{KROW_COMMAND}} work start "<request>" --json`

Parse the JSON response.

Each work step is WorkAction -> agent work -> submitted output.

Read the returned context refs and the current instruction. Gather repository evidence when it is needed for the requested output. Ask the user when the missing context is a product meaning decision, approval, scope decision, or externally unknowable fact.

When work changes project language, plans, specs, glossary, maps, or other durable project documents, edit the actual target refs directly. Use the existing files such as `goal.md`, `spec.md`, `plan.md`, `.krow/system/glossary.md`, and `.krow/system/map.md` as the review surface. The user-facing loop is: update the actual document, ask for review, continue on approval, revise the same document on rejection or redirection.

Treat proposal-shaped runner terms as internal compatibility words. Do not create separate user-facing documents such as `plan_proposal`, `glossary_proposal`, or language-update approval bundles when the actual target document exists.

## Loop

For each response:

- `run`: perform the requested autonomous unit, write the required JSON payload to `output.path`, then run `submit` exactly as provided.
- `ask`: ask the bundled questions in one message, write `{"answers":[...]}` to `output.path`, then run `submit` exactly as provided.
- `done`: report the result, evidence refs, and remaining risks.
- `fault`: report the concrete invalid state or blocker.

krow owns workflow order, dependency order, readiness, and state mutation. The agent does the current action and returns the requested evidence.
