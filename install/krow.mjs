#!/usr/bin/env node

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANAGED_MARKER = "Managed by krow init";
const KROW_COMMAND_PLACEHOLDER = "__KROW_COMMAND__";
const BOOTSTRAP_RELATIVE_PATH = [".krow", "bin", "krow-bootstrap.mjs"];
const RUNTIME_DIST_RELATIVE_PATH = [".krow", "runtime", "dist"];
const PROJECT_LANGUAGE_RELATIVE_PATH = [".krow", "language.md"];
const CONCEPT_INDEX_RELATIVE_PATH = [".krow", "concepts", "index.md"];
const RUNTIME_DIRECTORY_RELATIVE_PATHS = [
  [".krow", "state", "workflows"],
  [".krow", "tasks"],
  [".krow", "relays"],
  [".krow", "concepts"],
  [".krow", "prds"],
  [".krow", "plans"],
  [".krow", "examples"],
  [".krow", "reviews"],
  [".krow", "generated"],
  [".krow", "checks"],
  [".krow", "artifacts"],
  [".krow", "logs"],
  [".krow", "knowledge"],
  [".krow", "templates"],
];

const PROJECT_LANGUAGE = `# Project Language

This file defines the approved local language for this codebase.

krow treats this as controlled vocabulary plus grounding evidence, not as a
layer-by-layer translation map. Core terms name general software concepts, tech
terms name stack-specific concepts, and project terms name this product's domain
language.

## Grounding Rules

- Use approved terms when they exist.
- Keep proposed terms in task packets until they are durable and evidence-backed.
- Do not translate every core term into a project term.
- Add tech bindings only when implementation evidence exists.
- Record deprecated words so agents can avoid naming drift.

## Core Software Terms

Core/software terms are built into krow. Add rows here only when this repository
has a durable local convention for a general software concept.

| ID | Term | Aliases | Evidence |
|----|------|---------|----------|

## Tech Terms

Use this section for stack, framework, runtime, deployment, or tooling terms that
matter to implementation.

| ID | Term | Aliases | Evidence |
|----|------|---------|----------|

## Project Terms

Use this section for product/domain terms that should stay stable across specs,
code review, commits, and task packets.

| ID | Term | Aliases | Evidence |
|----|------|---------|----------|

## Deprecated Terms

| Term | Use Instead | Reason |
|------|-------------|--------|

## Open Language Questions

- (none)
`;

const CONCEPT_INDEX = `# Project Concept Maps

This file routes agents to concept-level maps.

Project Concept Maps are optional retrieval aids. The source of truth remains
Project Language, PRDs, Implementation Plans, Examples, tests, and code.

## Concepts

| Key | Concept | Kind | Layer | Status | Ref | Aliases |
|-----|---------|------|-------|--------|-----|---------|

## Rules

- Create a Concept Map when a Project Language concept needs hierarchy, boundaries, code anchors, or implementation responsibility beyond a glossary entry.
- Do not create Concept Maps for private helpers, generated code, tiny UI atoms, or local framework glue.
- Keep this index small. Put details in each concept file.
`;

const PROJECT_LANGUAGE_ENTRY_TEMPLATE = `# Project Language Entry

## TERM-001: <Term Name>

Key: <concept-key>
Kind: actor | concept | rule | interface | data | process | module
Layer: product | system
Status: proposed | approved | deprecated

Means:
<One short definition.>

Boundary:
- Includes <included meaning>.
- Excludes <excluded or nearby meaning>.

Used In:
- PRD: <prd-id or name>
- Code: <story-facing code anchor>
- Tests: <test anchor>

Related:
- <related-concept-key>

Open Questions:
- (none)
`;

const CONCEPT_MAP_TEMPLATE = `# <Concept Name>

Key: <concept-key>
Kind: actor | concept | rule | interface | data | process | module
Layer: product | system
Status: proposed | approved | deprecated

Means:
<What this concept means in the project language.>

Hierarchy:
- <child-concept-key>

Related Concepts:
- <related-concept-key>

Business Use Cases:
- <use-case-key>

Code Anchors:
- Model: \`<path-or-symbol>\`
- Repository: \`<path-or-symbol>\`
- API: \`<path-or-symbol>\`
- UI: \`<path-or-symbol>\`
- Tests: \`<path-or-symbol>\`

Boundaries:
- <What this concept owns.>
- <What this concept does not own.>

Notes:
- (none)
`;

const PRD_TEMPLATE = `# PRD: <Product Change>

PRD ID: PRD-001
Status: draft

## Product Goal

<What product behavior should exist and why it matters.>

## Concepts

- <concept-key>

## User Stories

### US-001: <Story Name>

As a <Project Language actor>, I want <behavior> so that <reason>.

Acceptance Criteria:

- AC-001: <Rule that must hold.>

Examples:

- EX-001: Given <state>, when <action>, then <expected result>.

## Out Of Scope

- <Explicit non-goal.>

## Approval

Status: draft
Approved By:
Approved At:

Decisions:
- (none)
`;

const IMPLEMENTATION_PLAN_TEMPLATE = `# Implementation Plan: <Plan Name>

Plan ID: PLAN-001
Status: draft
PRD: <prd-ref>

## Concepts

- <concept-key>

## Work Units

### WU-001: <Work Unit Name>

User Stories:
- US-001

Examples:
- EX-001

Scope:
- <file, symbol, module, or document surface>

Expected Tests:
- EX-001 -> <test file or test name containing EX-001>

Code Anchors:
- <path or symbol>

Verification:
- <command or manual check>

## Approval

Status: draft
Approved By:
Approved At:

Decisions:
- (none)
`;

const EXAMPLE_TEMPLATE = `# Example: <Example Name>

Example ID: EX-001
Acceptance Criteria:
- AC-001

Concepts:
- <concept-key>

## Scenario

Given <state>
When <action>
Then <expected result>

## Expected Test Link

- Test: <test name or path containing EX-001>
`;

const REVIEW_REPORT_TEMPLATE = `# Review Report: <Change Name>

Review ID: REVIEW-001
Plan: <plan-ref>
PRD: <prd-ref>

## Derived Links

| PRD | User Story | Acceptance Criteria | Example | Test | Code Anchor | Status |
|-----|------------|---------------------|---------|------|-------------|--------|

## Execution Trace

- Tests from Examples:
- Code implementation:
- Verification after code:

## Alignment Findings

- <Missing link, naming drift, or scope drift.>

## Verification

- <Check and result.>

## Remaining Risks

- (none)
`;

const KROW_BOOTSTRAP = `#!/usr/bin/env node

// ${MANAGED_MARKER}

import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bootstrapDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeCliPath = path.resolve(bootstrapDir, "../runtime/dist/cli.js");

if (!existsSync(runtimeCliPath)) {
  process.stderr.write(
    "krow runtime is missing. Re-run 'npx --yes krow-cli@latest init --force' to refresh the local install.\\n",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [runtimeCliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error && result.error.code === "ENOENT") {
  process.stderr.write(
    "krow runtime is missing. Re-run 'npx --yes krow-cli@latest init --force' to refresh the local install.\\n",
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
`;

function shellQuote(value) {
  if (process.platform === "win32") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function bootstrapPath(home) {
  return path.join(home, ...BOOTSTRAP_RELATIVE_PATH);
}

function runtimeDistTargetPath(home) {
  return path.join(home, ...RUNTIME_DIST_RELATIVE_PATH);
}

function krowCommand(home) {
  return `node ${shellQuote(bootstrapPath(home))}`;
}

function renderManagedContent(template, home) {
  return template.split(KROW_COMMAND_PLACEHOLDER).join(krowCommand(home));
}

const CODEX_WORK_SKILL = `---
name: work
description: Explicit work-intake skill for actionable engineering tasks. Use only when the user explicitly invokes \`$work\` to request code, files, tests, config, or other artifacts to be created, fixed, refactored, removed, investigated, or verified.
---

<!-- ${MANAGED_MARKER} -->

# Work

Treat the current user message as explicit work intent.

## Command Authority

Use only the exact bootstrap command rendered in this file for krow control operations.
Do not replace it with \`npx\`, \`npm exec\`, or a bare \`krow\` command.

## Startup

Run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "$ARGUMENTS"\`

If $ARGUMENTS is empty, ask the user what they want to do first.

Parse the JSON response.

## Loop

1. Parse the JSON response from the last krow command.
2. Check the \`type\` field and act accordingly:

### type = "run"
- Read \`state_ref\` before acting.
- Read \`workflow_task_index_ref\`, \`task_packet_ref\`, and any \`relay_refs\` before acting.
- Use \`phase\`, \`instruction_ref\`, \`output_contract\`, and \`instructions\` as the contract.
- Spawn an Agent for this phase. DO NOT execute the phase yourself.
- Tool policy by phase:
  - \`clarify\`: Read, Grep, Glob, Bash(git *), Bash(ls *), Bash(cat *), Bash(rg *), Agent
  - \`execute\`: Read, Grep, Glob, Edit, Write, Bash, Agent
  - \`verify\`: Read, Grep, Glob, Bash, Agent
  - \`capture\`: Read, Grep, Glob, Edit, Write, Bash, Agent
- In \`clarify\`, gather evidence first, list the concrete evidence you used, and turn the success condition into explicit acceptance criteria for the unit before returning ready=true.
- In \`execute\`, complete only the current unit. When the task packet includes Examples, create or update tests for those Examples before changing implementation code, then implement code, rerun the scoped checks, and return \`executionSteps\`, \`exampleTests\`, and \`implementationLinks\`. If the workflow state shows multiple ready sibling units with disjoint ownership, use that as host-level scheduling metadata for bounded subagents or parallel runs; do not silently merge sibling units into one payload.
- In \`verify\`, try to disprove the claimed result. Do not silently edit files during verification. Always include concrete checks, evidence, and any unverified claims in the payload.
- In \`capture\`, write only durable reusable learnings.
- Wait for the agent to return its result.
- Extract the JSON output from the agent's response.
- Run this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": use \`signal.decisions\` when present; otherwise read \`state_ref\` and \`task_status_ref\`. Present the bundled decision set to the user in one message. Collect one answer object per decision using the matching \`decisionId\`, \`selectedOptionId: "answer"\`, and the user's exact answer in \`customInput\`. Submit those answers as one JSON array even when there is only one decision. Example:
\`\`\`json
[{"decisionId":"intent-lock","selectedOptionId":"answer","customInput":"confirmed"}]
\`\`\`
Then run:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`documents\`, \`review\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is controlled vocabulary plus grounding evidence for the target codebase. It is not a layer-by-layer translation map. Read it when wording, domain terms, module names, or local architectural language matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
`;

const CODEX_CHECK_SKILL = `---
name: check
description: Check whether the repository's code, krow Project Language, Concept Maps, and intent documents are aligned. Use only when the user explicitly invokes \`$check\` or asks to run the krow sanity/alignment check.
---

<!-- ${MANAGED_MARKER} -->

# Check

Run the krow alignment check for the current repository.

## Command Authority

Use only the exact bootstrap command rendered in this file for krow control operations.
Do not replace it with \`npx\`, \`npm exec\`, or a bare \`krow\` command.

## Write Boundary

- Read the repository workspace as evidence.
- Let krow write only inside the configured krow workspace, which is \`.krow\` by default.
- Do not edit source code, tests, app files, package source, or business logic during \`$check\`.
- Code changes belong in \`$work\`, not \`$check\`.

## Startup

Treat \`$ARGUMENTS\` as an optional service or product description, not as a path. Use it to help krow separate product language from incidental code names.

Run: \`${KROW_COMMAND_PLACEHOLDER} check "$ARGUMENTS"\`

Parse the JSON response.

Read \`check.reportRef\`, \`check.questionRefs\`, and proposed files when present.

## Decision Loop

If \`check.decisions\` is empty:
- Report the summary and \`check.reportRef\`.
- Stop.

If \`check.decisions\` is non-empty:
- Present the full bundled decision set to the user in one message.
- For each decision, collect one answer object using the matching \`decisionId\`.
- Use \`selectedOptionId: "approve"\` only when the user clearly approves the proposed entry as written.
- Use \`selectedOptionId: "revise"\` when the user gives a correction. Put the corrected meaning in \`customInput\`. If the user gives structured fields, put minified JSON in \`customInput\`.
- Use \`selectedOptionId: "reject"\` when the user declines the entry.
- Submit all answers as one JSON array.

Run this exact safe pattern:

\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} check-apply <check_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

Then parse the result and report:

- check report ref
- apply report ref
- applied refs
- skipped decisions

## Rules

- The local check control surface is: \`check\`, \`check-apply\`.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\`.
- Minify JSON before passing it to \`check-apply\`.
- Apply only explicit user decisions. Do not silently approve ambiguous terms.
`;

const CLAUDE_WORK_COMMAND = `---
description: Run actionable engineering work through the work intake.
argument-hint: "<request>"
arguments:
  - request
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Agent
---

<!-- ${MANAGED_MARKER} -->

# work

Treat \`$request\` as explicit work intent.

## Command Authority

Use only the exact bootstrap command rendered in this file for krow control operations.
Do not replace it with \`npx\`, \`npm exec\`, or a bare \`krow\` command.

## Startup

If no request was supplied, ask the user what they want to do first.

Otherwise, run: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "$request"\`

Parse the JSON response.

## Loop

1. Parse the JSON response from the last krow command.
2. Check the \`type\` field and act accordingly:

### type = "run"
- Read \`state_ref\` before acting.
- Read \`workflow_task_index_ref\`, \`task_packet_ref\`, and any \`relay_refs\` before acting.
- Use \`phase\`, \`instruction_ref\`, \`output_contract\`, and \`instructions\` as the contract.
- Spawn an Agent for this phase. DO NOT execute the phase yourself.
- Tool policy by phase:
  - \`clarify\`: Read, Grep, Glob, Bash(git *), Bash(ls *), Bash(cat *), Bash(rg *), Agent
  - \`execute\`: Read, Grep, Glob, Edit, Write, Bash, Agent
  - \`verify\`: Read, Grep, Glob, Bash, Agent
  - \`capture\`: Read, Grep, Glob, Edit, Write, Bash, Agent
- In \`clarify\`, gather evidence first, list the concrete evidence you used, and turn the success condition into explicit acceptance criteria for the unit before returning ready=true.
- In \`execute\`, complete only the current unit. When the task packet includes Examples, create or update tests for those Examples before changing implementation code, then implement code, rerun the scoped checks, and return \`executionSteps\`, \`exampleTests\`, and \`implementationLinks\`. If the workflow state shows multiple ready sibling units with disjoint ownership, use that as host-level scheduling metadata for bounded subagents or parallel runs; do not silently merge sibling units into one payload.
- In \`verify\`, try to disprove the claimed result. Do not silently edit files during verification. Always include concrete checks, evidence, and any unverified claims in the payload.
- In \`capture\`, write only durable reusable learnings.
- Wait for the Agent result.
- Extract the JSON output from the Agent response.
- Run this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": use \`signal.decisions\` when present; otherwise read \`state_ref\` and \`task_status_ref\`. Present the bundled decision set to the user in one message. Collect one answer object per decision using the matching \`decisionId\`, \`selectedOptionId: "answer"\`, and the user's exact answer in \`customInput\`. Submit those answers as one JSON array even when there is only one decision. Example:
\`\`\`json
[{"decisionId":"intent-lock","selectedOptionId":"answer","customInput":"confirmed"}]
\`\`\`
Then run:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`documents\`, \`review\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is controlled vocabulary plus grounding evidence for the target codebase. It is not a layer-by-layer translation map. Read it when wording, domain terms, module names, or local architectural language matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
`;

const CLAUDE_CHECK_COMMAND = `---
description: Run the krow alignment check without editing source code.
argument-hint: "[service or product description]"
arguments:
  - description
allowed-tools: Bash, Read, Grep, Glob
---

<!-- ${MANAGED_MARKER} -->

# check

Run krow's repository alignment check.

Use only the exact bootstrap command rendered in this file for krow control operations.
Do not replace it with \`npx\`, \`npm exec\`, or a bare \`krow\` command.

Treat the argument as an optional service or product description, not as a path. Read the repository as evidence, but do not edit source code, tests, app files, package source, or business logic. The check flow may write only inside \`.krow\`.

Run: \`${KROW_COMMAND_PLACEHOLDER} check "$description"\`

Parse the JSON response. Read the report and question refs.

If decisions are present, ask the user the full bundled decision set in one message. Submit explicit approve/revise/reject answers with:

\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} check-apply <check_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

Report the check report, apply report, applied refs, and skipped decisions.
`;

const GEMINI_WORK_COMMAND = `# ${MANAGED_MARKER}

description = "Run actionable engineering work through the work intake."

prompt = """
Treat {{args}} as explicit work intent.

## Command Authority

Use only the exact bootstrap command rendered in this file for krow control operations.
Do not replace it with \`npx\`, \`npm exec\`, or a bare \`krow\` command.

## Startup

If no arguments were supplied, ask the user what they want to do first.

Otherwise, run via run_shell_command: \`${KROW_COMMAND_PLACEHOLDER} start --intent work "{{args}}"\`

Parse the JSON response.

## Loop

1. Parse the JSON response from the last krow command.
2. Check the \`type\` field and act accordingly:

### type = "run"
- Read \`state_ref\` before acting.
- Read \`workflow_task_index_ref\`, \`task_packet_ref\`, and any \`relay_refs\` before acting.
- Use \`phase\`, \`instruction_ref\`, \`output_contract\`, and \`instructions\` as the contract.
- Tool policy by phase:
  - \`clarify\`: use read_file, grep_search, list_directory, and run_shell_command only for read-only inspection
  - \`execute\`: use read_file, grep_search, list_directory, edit_file, write_file, and run_shell_command
  - \`verify\`: use read_file, grep_search, list_directory, and run_shell_command; do not silently edit files
  - \`capture\`: use read_file, grep_search, list_directory, edit_file, write_file, and run_shell_command only for durable knowledge capture
- In \`clarify\`, gather evidence first, list the concrete evidence you used, and turn the success condition into explicit acceptance criteria for the unit before returning ready=true.
- In \`execute\`, complete only the current unit. When the task packet includes Examples, create or update tests for those Examples before changing implementation code, then implement code, rerun the scoped checks, and return \`executionSteps\`, \`exampleTests\`, and \`implementationLinks\`. If the workflow state shows other ready sibling units, use that graph metadata for host scheduling; if the host cannot parallelize them, process the ready units step by step without skipping transitions.
- In \`verify\`, try to disprove the claimed result before accepting it. Always include concrete checks, evidence, and any unverified claims.
- When the phase work is complete, collect your result as one JSON object matching \`output_contract\`.
- Run via run_shell_command using this exact safe pattern, replacing the \`<JSON>\` line with minified JSON:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-phase <workflow_id> <phase> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

### type = "gate"
- If \`gate\` = "clarify": use \`signal.decisions\` when present; otherwise read \`state_ref\` and \`task_status_ref\`. Present the bundled decision set to the user in one message. Collect one answer object per decision using the matching \`decisionId\`, \`selectedOptionId: "answer"\`, and the user's exact answer in \`customInput\`. Submit those answers as one JSON array even when there is only one decision. Example:
\`\`\`json
[{"decisionId":"intent-lock","selectedOptionId":"answer","customInput":"confirmed"}]
\`\`\`
Then run via run_shell_command:
\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} submit-decisions <workflow_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`
Then run \`${KROW_COMMAND_PLACEHOLDER} resume <workflow_id>\`.
- For any other gate, follow \`instructions\` exactly and only stop for real external input.

### type = "done"
- Report the \`message\` to the user. Stop.

### type = "fault"
- If \`recoverable\` = true, review \`error\` and \`issues\`, fix the input or state problem, then continue with \`${KROW_COMMAND_PLACEHOLDER} next <workflow_id>\` via run_shell_command when a workflow id is present.
- If \`recoverable\` = false, report the \`error\` to the user and stop.

## Rules

- The local control surface is: \`route\`, \`intake\`, \`documents\`, \`review\`, \`start\`, \`status\`, \`next\`, \`resume\`, \`submit-phase\`, \`submit-decisions\`, \`stop\`.
- NEVER skip the local control commands. Every transition goes through krow.
- Never inline JSON as a quoted shell argument. Use stdin heredocs with \`-\` so apostrophes in model output do not break the shell.
- Minify JSON before passing to commands (no newlines).
- State lives under \`.krow/state/workflows/<workflowId>.json\`. Task packets live under \`.krow/tasks/<workflowId>/\` and relays live under \`.krow/relays/<workflowId>/\`. Read the referenced files instead of guessing.
- \`.krow/language.md\` is controlled vocabulary plus grounding evidence for the target codebase. It is not a layer-by-layer translation map. Read it when wording, domain terms, module names, or local architectural language matter. Keep temporary language proposals in the task packet; only promote durable approved terms to \`.krow/language.md\`.
"""
`;

const GEMINI_CHECK_COMMAND = `# ${MANAGED_MARKER}

description = "Run the krow alignment check without editing source code."

prompt = """
Run krow's repository alignment check for {{args}}.

Use only the exact bootstrap command rendered in this file for krow control operations.
Do not replace it with \`npx\`, \`npm exec\`, or a bare \`krow\` command.

Treat {{args}} as an optional service or product description, not as a path. Read the repository as evidence, but do not edit source code, tests, app files, package source, or business logic. The check flow may write only inside \`.krow\`.

Run via run_shell_command: \`${KROW_COMMAND_PLACEHOLDER} check "{{args}}"\`

Parse the JSON response. Read the report and question refs.

If decisions are present, ask the user the full bundled decision set in one message. Submit explicit approve/revise/reject answers using:

\`\`\`bash
${KROW_COMMAND_PLACEHOLDER} check-apply <check_id> - <<'KROW_JSON'
<JSON>
KROW_JSON
\`\`\`

Report the check report, apply report, applied refs, and skipped decisions.
"""
`;

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  krow init [-f | --force] [-g | --global] [--home <dir>]",
      "  krow remove [-g | --global] [--home <dir>]",
      "",
      "Commands:",
      "  init      Install Codex $work/$check, Claude Code /work and /check, and Gemini CLI /work and /check wrappers",
      "  remove    Remove installed Codex, Claude Code, and Gemini CLI wrappers",
      "",
      "Flags:",
      "  -f, --force    Overwrite managed files even if they already exist",
      "  -g, --global    Install to / remove from home directory (global)",
      "  --home <dir>    Target directory override",
    ].join("\n") + "\n",
  );
}

function parseArgs(argv) {
  const command = argv[0];
  let force = false;
  let global = false;
  let home = null;

  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--force" || value === "-f") {
      force = true;
      continue;
    }
    if (value === "--global" || value === "-g") {
      global = true;
      continue;
    }
    if (value === "--home" && argv[index + 1]) {
      home = argv[index + 1];
      index += 1;
      continue;
    }
  }

  return { command, force, global, home };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeManagedFile(targetPath, content, force) {
  const exists = await pathExists(targetPath);

  if (exists) {
    const existing = await fs.readFile(targetPath, "utf8");
    if (existing === content) {
      return "unchanged";
    }
    if (!force && !existing.includes(MANAGED_MARKER)) {
      throw new Error(`Refusing to overwrite unmanaged file: ${targetPath}`);
    }
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return exists ? "updated" : "created";
}

async function writeSeedFile(targetPath, content) {
  const exists = await pathExists(targetPath);

  if (exists) {
    const existing = await fs.readFile(targetPath, "utf8");
    if (existing === content) {
      return "unchanged";
    }
    return "skipped (already exists)";
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
  return "created";
}

async function ensureDirectory(targetPath) {
  const exists = await pathExists(targetPath);
  await fs.mkdir(targetPath, { recursive: true });
  return exists ? "unchanged" : "created";
}

async function installRuntime(packageRoot, home) {
  const sourceDir = path.join(packageRoot, "dist");
  const sourceCli = path.join(sourceDir, "cli.js");
  const targetDir = runtimeDistTargetPath(home);
  const existed = await pathExists(targetDir);

  if (!(await pathExists(sourceCli))) {
    throw new Error(
      `Missing built runtime at ${sourceCli}. Run 'npm run build' before using init from a source checkout.`,
    );
  }

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`, "utf8");
  return {
    label: "krow runtime",
    path: targetDir,
    status: existed ? "updated" : "created",
  };
}

async function removePathIfExists(targetPath) {
  const exists = await pathExists(targetPath);
  if (!exists) {
    return "skipped (not found)";
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  return "removed";
}

export async function runInit({ force, global: isGlobal, home }) {
  if (home == null) {
    home = isGlobal ? os.homedir() : process.cwd();
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(scriptDir, "..");
  const results = [];
  const projectLanguagePath = path.join(home, ...PROJECT_LANGUAGE_RELATIVE_PATH);

  results.push(await installRuntime(packageRoot, home));

  for (const relativePath of RUNTIME_DIRECTORY_RELATIVE_PATHS) {
    const targetPath = path.join(home, ...relativePath);
    results.push({
      label: `runtime directory ${relativePath.join("/")}`,
      path: targetPath,
      status: await ensureDirectory(targetPath),
    });
  }

  results.push({
    label: "project language",
    path: projectLanguagePath,
    status: await writeSeedFile(projectLanguagePath, PROJECT_LANGUAGE),
  });

  const seedFiles = [
    {
      label: "concept index",
      path: path.join(home, ...CONCEPT_INDEX_RELATIVE_PATH),
      content: CONCEPT_INDEX,
    },
    {
      label: "Project Language entry template",
      path: path.join(home, ".krow", "templates", "project-language-entry.md"),
      content: PROJECT_LANGUAGE_ENTRY_TEMPLATE,
    },
    {
      label: "Project Concept Map template",
      path: path.join(home, ".krow", "templates", "concept-map.md"),
      content: CONCEPT_MAP_TEMPLATE,
    },
    {
      label: "PRD template",
      path: path.join(home, ".krow", "templates", "prd.md"),
      content: PRD_TEMPLATE,
    },
    {
      label: "Implementation Plan template",
      path: path.join(home, ".krow", "templates", "implementation-plan.md"),
      content: IMPLEMENTATION_PLAN_TEMPLATE,
    },
    {
      label: "Example template",
      path: path.join(home, ".krow", "templates", "example.md"),
      content: EXAMPLE_TEMPLATE,
    },
    {
      label: "Review Report template",
      path: path.join(home, ".krow", "templates", "review-report.md"),
      content: REVIEW_REPORT_TEMPLATE,
    },
  ];

  for (const seedFile of seedFiles) {
    results.push({
      label: seedFile.label,
      path: seedFile.path,
      status: await writeSeedFile(seedFile.path, seedFile.content),
    });
  }

  const targets = [
    {
      label: "krow bootstrap launcher",
      path: bootstrapPath(home),
      content: KROW_BOOTSTRAP,
    },
    {
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
      content: renderManagedContent(CODEX_WORK_SKILL, home),
    },
    {
      label: "Codex $check skill",
      path: path.join(home, ".codex", "skills", "check", "SKILL.md"),
      content: renderManagedContent(CODEX_CHECK_SKILL, home),
    },
    {
      label: "Claude Code /work command",
      path: path.join(home, ".claude", "commands", "work.md"),
      content: renderManagedContent(CLAUDE_WORK_COMMAND, home),
    },
    {
      label: "Claude Code /check command",
      path: path.join(home, ".claude", "commands", "check.md"),
      content: renderManagedContent(CLAUDE_CHECK_COMMAND, home),
    },
    {
      label: "Gemini CLI /work command",
      path: path.join(home, ".gemini", "commands", "work.toml"),
      content: renderManagedContent(GEMINI_WORK_COMMAND, home),
    },
    {
      label: "Gemini CLI /check command",
      path: path.join(home, ".gemini", "commands", "check.toml"),
      content: renderManagedContent(GEMINI_CHECK_COMMAND, home),
    },
  ];

  for (const target of targets) {
    const status = await writeManagedFile(target.path, target.content, force);
    results.push({ ...target, status });
  }

  process.stdout.write(
    [
      `Installed from ${packageRoot}`,
      ...results.map((result) => `${result.status}: ${result.label} -> ${result.path}`),
      "Restart Codex, Claude Code, and Gemini CLI, or reload skills/commands if they are already running.",
    ].join("\n") + "\n",
  );
}

export async function runRemove({ global: isGlobal, home }) {
  if (home == null) {
    home = isGlobal ? os.homedir() : process.cwd();
  }

  const results = [
    {
      label: "krow runtime",
      path: runtimeDistTargetPath(home),
      status: await removePathIfExists(runtimeDistTargetPath(home)),
    },
  ];

  const targets = [
    {
      label: "krow bootstrap launcher",
      path: bootstrapPath(home),
    },
    {
      label: "Codex $work skill",
      path: path.join(home, ".codex", "skills", "work", "SKILL.md"),
    },
    {
      label: "Codex $check skill",
      path: path.join(home, ".codex", "skills", "check", "SKILL.md"),
    },
    {
      label: "Claude Code /work command",
      path: path.join(home, ".claude", "commands", "work.md"),
    },
    {
      label: "Claude Code /check command",
      path: path.join(home, ".claude", "commands", "check.md"),
    },
    {
      label: "Gemini CLI /work command",
      path: path.join(home, ".gemini", "commands", "work.toml"),
    },
    {
      label: "Gemini CLI /check command",
      path: path.join(home, ".gemini", "commands", "check.toml"),
    },
  ];

  for (const target of targets) {
    const exists = await pathExists(target.path);
    if (!exists) {
      results.push({ ...target, status: "skipped (not found)" });
      continue;
    }

    const content = await fs.readFile(target.path, "utf8");
    if (!content.includes(MANAGED_MARKER)) {
      results.push({ ...target, status: "skipped (not managed by krow)" });
      continue;
    }

    await fs.unlink(target.path);
    results.push({ ...target, status: "removed" });

    // Try to remove empty parent directories
    let dir = path.dirname(target.path);
    while (dir !== home && dir !== path.dirname(dir)) {
      try {
        await fs.rmdir(dir);
        dir = path.dirname(dir);
      } catch {
        break;
      }
    }
  }

  process.stdout.write(
    [
      `Remove targets in ${home}`,
      ...results.map((result) => `${result.status}: ${result.label} -> ${result.path}`),
    ].join("\n") + "\n",
  );
}

export async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "init") {
    await runInit(parsed);
    return;
  }
  if (parsed.command === "remove") {
    await runRemove(parsed);
    return;
  }

  printUsage();
  process.exitCode = parsed.command ? 1 : 0;
}

const isDirectExecution = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
