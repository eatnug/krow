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

The initial `check.decisions` array is normally empty. It becomes populated after proposals are written and `check-decisions` runs.

When `check.status` is `needs-agent-draft`, the check has started but the agent-owned draft is not complete. Continue the Check Work below before reporting completion.

When `check.status` is `needs-review`, inspect the refs and continue until the current missing artifact, proposal revision, or user-facing decision bundle is produced.

Report `clean` only when the check artifacts are complete and no draft work, review issue, or approval step remains.

## Responsibility Boundary

Code controls the workflow, records objective repository evidence, validates artifact shape, creates approval prompts, and applies approved updates.

AI reads repository evidence, writes the reading plan, traces the code it actually reads, explains the software in project language, drafts proposals, and identifies gaps.

User approves names, meanings, boundaries, ownership, product intent, and decisions that repository evidence cannot settle.

## Check Work

Use the returned refs, user context, current `.krow` documents, and repository files as available input.

Treat the whole repository as the target system. Start with a full-repository orientation, then read the entrypoints, flows, design notes, document contracts, templates, tests, and core modules deeply enough to explain current meaning. Peripheral files can be read shallowly when their role is clear, but record that boundary in the reading trace.

The goal is whole-system understanding with explicit reading coverage, not a line-by-line translation of every file.

Work in this order:

1. Read `evidenceRef` and `reportRef`.
2. Write `readingPlanRef` with the repository orientation, reading order, reading boundary, and refresh conditions.
3. Read repository files according to the reading plan.
4. Write `understandingRef` with what was read, what the software appears to mean, proposed terms/documents, and gaps.
5. Write `proposalsRef` with first-class Glossary term proposals and System Document proposals. Use source, test, config, and runtime-template references for current behavior statements. Keep README/docs/AGENTS-style Markdown as context in the reading plan or understanding, not as System Statement References, unless the statement is explicitly about planned direction or documentation.
6. Write `questionsRef` with bundled user questions when meaning, ownership, boundary, or product intent remains unresolved.

Write each artifact as soon as its step is complete. The refs are durable workflow handoff, so do not hold all reading, understanding, proposals, and questions until the end of the run.

Keep code/runtime entrypoints and flows separate from Markdown context documents in the proposed repository understanding. Markdown docs can guide interpretation, but they should not be mixed into the runtime reading order.

Every System Statement should cite at least one source, test, config, or runtime-template reference. Current behavior statements should not cite README/docs/AGENTS-style Markdown as References; use those documents only to explain product intent, planned direction, or ambiguity in `understandingRef` and `questionsRef`.

Mark the reading plan and understanding artifacts `Status: Complete` before running `check-decisions`. Leave them as `Draft` while they are still handoff work.

Questions in `questionsRef` block approval prompts by default. Mark a question with `"blocksApproval": false` only when the proposal is still valid without that answer.

When proposals are ready for user approval, set `proposals.json` stage to `ready-for-approval` and run:

`{{KROW_COMMAND}} check-decisions <check_id>`

Report the decision count and refs. The full decision bundle is already written to `decisionsRef`; do not restate it in the message.

Apply explicit approve, revise, or reject decisions:

`{{KROW_COMMAND}} check-apply <check_id> <json|path|->`

During `$check`, durable System changes go through the runner only:

- create evidence and empty proposal artifacts with `{{KROW_COMMAND}} check "<user seed>"`
- create approval prompts with `{{KROW_COMMAND}} check-decisions <check_id>`
- apply approved proposals with `{{KROW_COMMAND}} check-apply <check_id> <json|path|->`
- when repository reading shows that proposals are too shallow, revise the proposals before approval
- when the user names a missing first-class term or document after review, add it to proposals with evidence and run `check-decisions` again

Keep all `$check` writes inside `.krow`. Treat generated apply reports as runner-owned audit output.
