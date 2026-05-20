## Startup

Treat the argument as user-provided context for this check.

Run with the user seed in place of `<user seed>`:
`{{KROW_COMMAND}} check "<user seed>"`

Parse the JSON response and read these refs when present:

- `check.evidenceRef`
- `check.readingPlanRef`
- `check.understandingRef`
- `check.proposalsRef`
- `check.questionsRef`
- `check.reportRef`
- `check.decisionsRef`

The initial `check.decisions` array is normally empty. Use runner decision artifacts only as compatibility metadata; the user-facing review surface is the actual changed `.krow` document.

When `check.status` is `needs-agent-draft`, the check has started but the agent-owned draft is not complete. Continue the Check Work below before reporting completion.

When `check.status` is `needs-review`, inspect the refs and continue until the current missing artifact or actual document revision is ready for user review.

Report `clean` only when the check artifacts are complete and no draft work, review issue, or approval step remains.

## Responsibility Boundary

Code controls the workflow, records objective repository evidence, and validates artifact shape.

AI reads repository evidence, writes the reading plan, traces the code it actually reads, explains the software in project language, updates the actual project language documents, and identifies gaps.

User reviews and approves names, meanings, boundaries, ownership, product intent, and decisions that repository evidence cannot settle.

## Check Work

Use the returned refs, user context, current `.krow` documents, and repository files as available input.

Treat the whole repository as the target system. Start with a full-repository orientation, then read the entrypoints, flows, design notes, document contracts, templates, tests, and core modules deeply enough to explain current meaning. Peripheral files can be read shallowly when their role is clear, but record that boundary in the reading trace.

The goal is whole-system understanding with explicit reading coverage, not a line-by-line translation of every file.

Work in this order:

1. Read `evidenceRef` and `reportRef`.
2. Write `readingPlanRef` with the repository orientation, reading order, reading boundary, and refresh conditions.
3. Read repository files according to the reading plan.
4. Write `understandingRef` with what was read, what the software appears to mean, document updates made or needed, and gaps.
5. Update the actual `.krow/system/glossary.md`, `.krow/system/map.md`, or relevant system document refs with first-class terms and current behavior statements. Use source, test, config, and runtime-template references for current behavior statements. Keep README/docs/AGENTS-style Markdown as context in the reading plan or understanding, not as System Statement References, unless the statement is explicitly about planned direction or documentation.
6. Write `questionsRef` with bundled user questions when meaning, ownership, boundary, or product intent remains unresolved.

Write each artifact as soon as its step is complete. The refs are durable workflow handoff, so do not hold all reading, understanding, proposals, and questions until the end of the run.

Keep code/runtime entrypoints and flows separate from Markdown context documents in the repository understanding. Markdown docs can guide interpretation, but they should not be mixed into the runtime reading order.

Every System Statement should cite at least one source, test, config, or runtime-template reference. Current behavior statements should not cite README/docs/AGENTS-style Markdown as References; use those documents only to explain product intent, planned direction, or ambiguity in `understandingRef` and `questionsRef`.

Mark the reading plan and understanding artifacts `Status: Complete` before asking the user to review changed documents. Leave them as `Draft` while they are still handoff work.

Questions in `questionsRef` block document approval by default. Mark a question with `"blocksApproval": false` only when the document update is still valid without that answer.

When a runner requires proposal artifacts, keep them as compatibility metadata for the runner. The user-facing review still points at the actual changed documents.

`{{KROW_COMMAND}} check-decisions <check_id>`

Report the changed document refs and any runner decision refs only when they are relevant.

Apply explicit approve, revise, or reject decisions when the runner requires them:

`{{KROW_COMMAND}} check-apply <check_id> <json|path|->`

During `$check`, durable System changes are reviewed through the actual docs:

- create evidence and empty proposal artifacts with `{{KROW_COMMAND}} check "<user seed>"`
- update `.krow/system/glossary.md`, `.krow/system/map.md`, and relevant system documents directly
- ask the user to review those changed documents
- when repository reading shows that document updates are too shallow, revise the same documents before approval
- when the user names a missing first-class term or document after review, add it directly to the relevant document with evidence

Keep all `$check` writes inside `.krow`. Treat generated runner artifacts as audit output, not the primary user-facing review surface.
