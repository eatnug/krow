# Work Runtime Decisions

This document defines the runtime contract between the installed agent surface, krow CLI runtime, workflow state, and AI-produced payloads.

The target operating model is:

```text
installed agent surface starts krow
krow returns a WorkAction
coding agent performs the requested action
coding agent submits the required payload
krow advances workflow state
loop continues until done or fault
```

This is not the source architecture document and not an implementation plan. It records the protocol decisions that the architecture and implementation should satisfy.

## 1. Agent Surface Start Contract

The installed agent surface is the small instruction file that `krow init` writes for Codex, Claude, Gemini, or another coding agent. It gives the coding agent one start command and one loop rule.

Installed Work Skill target:

```text
Run krow for this request and follow its WorkActions until completion.

Start:
  npx --yes krow-cli@latest work start "<request>" --json

For every JSON response:
  run:
    perform the requested unit
    write required output
    submit using the provided command

  ask:
    ask the user the bundled questions
    write answer payload
    submit using the provided command

  done:
    report result, evidence refs, and remaining risks
    stop

  fault:
    report the blocker
    stop unless the action gives a recoverable retry command

krow owns workflow order.
You execute the current action.
```

Runner target behavior:

```text
start latest krow runtime through npx
return JSON WorkAction after the runtime starts
if the runtime cannot start, report the command failure to the user and stop
let the user fix permissions, network, auth, cache, package-manager, or install issues
```

This makes the package name, runner, and start command shape part of the installed surface contract. Routine runtime, domain, state-machine, and protocol behavior ships through `krow-cli@latest`. If the start command contract changes, `krow init` or a future surface update command refreshes the installed agent surfaces.

At workflow start, the resolved runtime records the runtime session:

```ts
interface RuntimeSession {
  started_at: string;
  runner: "npx";
  package: "krow-cli";
  requested: "latest";
  resolved_version: string;
  command_prefix: string;
}
```

After start, returned submit commands pin the resolved exact runtime version:

```text
npx --yes krow-cli@0.5.1 work submit <workflow-id> --input <payload.json> --json
```

That keeps a workflow stable even if `latest` changes while the agent is working.

The resolved workflow state stores the authoritative `command_prefix`. Every returned `WorkAction.submit` command for that workflow is assembled from that stored prefix so submit commands stay stable across later CLI invocations.

Runtime compatibility is checked at the point where it matters:

```text
work start creates or loads the required .krow workspace files
work next loads the workflow state it needs
work submit validates the current state and expected payload kind
state/schema/contract mismatch returns ask or fault with a concrete recovery action
```

Compatibility warnings appear in normal agent context only when they require action through `ask` or `fault`. The happy path should not spend agent context on version checks.

Decision:

```text
Keep the installed agent surface small.
Use latest only when starting a new workflow.
Store the resolved runtime version in workflow state.
Pin all commands returned inside that workflow to the resolved exact version.
Validate state and payload contracts when the workflow step needs them.
Refresh installed agent surfaces only when the start command contract changes.
Treat startup failure as outside the WorkAction loop because the runtime has not started.
```

Responsibility split:

```text
Installed Agent Surface
  Gives the coding agent the start command and the loop rule.
  Contains no workflow state machine and no project-specific planning policy.

Coding Agent
  Runs the command from the installed surface.
  Reads each WorkAction.
  Performs repository work, user conversation, or final reporting as requested.
  Writes the required payload file.
  Runs WorkAction.submit exactly as provided.

krow CLI Runtime
  Creates and loads workflow state.
  Chooses the next WorkAction.
  Validates submitted payloads against the current pending action.
  Persists Work Docs, state artifacts, and approved Language System updates.
  Returns the next WorkAction or terminal result.
```

## 2. WorkAction Contract

`WorkAction` is the runtime response that tells the coding agent which next action is valid.

The action should expose only what the coding agent needs for the next move. `workflow_id` is kept as the public workflow handle. Internal state positions stay in `WorkflowState` and in the provided `submit` command.

Union:

```ts
type WorkAction = RunAction | AskAction | DoneAction | FaultAction;

interface ActionBase {
  type: "run" | "ask" | "done" | "fault";
  workflow_id: string;
}
```

### RunAction

`run` asks the coding agent to perform one autonomous unit.

```ts
interface RunAction extends ActionBase {
  type: "run";
  instruction: string;
  context?: string[];
  output: {
    kind: "plan_output" | "implement_output" | "review_output";
    path: string;
  };
  submit: string;
}
```

Required action content:

```text
instruction
  Current turn instruction written for the coding agent.

context
  Optional Work Docs, language docs, task docs, evidence refs, or repo refs needed for this turn.

output
  The payload kind and file path the coding agent should write.

submit
  The exact command the agent should run after writing the output.
```

### AskAction

`ask` asks the coding agent to collect user answers.

```ts
interface AskAction extends ActionBase {
  type: "ask";
  questions: Question[];
  output: {
    path: string;
  };
  submit: string;
}
```

Required action content:

```text
questions
  Bundled questions the coding agent should ask in one user-facing message.

output
  The answer payload path.

submit
  The exact command to submit user answers.
```

### DoneAction

`done` tells the coding agent to report the terminal state.

```ts
interface DoneAction extends ActionBase {
  type: "done";
  status: "completed" | "blocked" | "stopped";
  summary: string;
  refs?: string[];
  risks?: string[];
}
```

### FaultAction

`fault` tells the coding agent that runtime state or submitted payload is invalid.

```ts
interface FaultAction extends ActionBase {
  type: "fault";
  error: string;
  issues?: string[];
  recoverable: boolean;
  retry?: {
    command: string;
    reason: string;
  };
}
```

Decision:

```text
WorkAction is owned by Work Domain.
The CLI adapter serializes it.
The installed agent surface follows it.
Keep action fields compact and agent-facing.
Keep workflow_id because it is the public workflow handle.
Keep internal state refs out of the action unless the agent needs them.
```

## 3. Submit Protocol

`submit` completes the current pending action of a workflow.

The command target is the workflow. The validation target is that workflow's current state.

Recommended command:

```text
krow work submit <workflow-id> --input <payload.json> --json
```

The actual command shown to the coding agent comes from the current `WorkAction.submit` field:

```text
npx --yes krow-cli@0.5.1 work submit <workflow-id> --input <payload.json> --json
```

The returned `submit` command is authoritative. The coding agent should run it as provided instead of reconstructing a command from `workflow_id` or payload kind.

Reasons:

```text
workflow-id
  Selects the workflow that is waiting for a payload.

input
  Keeps large output out of argv and makes payload durable.

--json
  Keeps the agent loop machine-readable.
```

Target behavior:

```text
WorkAction provides submit command
agent writes payload to output.path
agent runs submit command as provided
submit receives workflow_id + payload
runtime loads the selected workflow state
current WorkflowState defines which payload kind is accepted
runtime validates payload against the current pending action
runtime stores payload as the result of that action
runtime advances the workflow state
runtime returns next WorkAction
submit does not let the agent choose a state
```

Decision:

```text
Use one canonical submit command.
Let workflow_id select the workflow.
Let current WorkflowState select the accepted payload kind.
Treat WorkAction.submit as the authoritative command for the agent.
Keep older submit commands only as compatibility wrappers if needed.
```

## 4. Payload Schemas

Each `run` action requires one compact work output.

Payloads are not full reports. They give krow enough structured information to store the result, decide whether to ask, and advance the workflow. Detailed notes can live in Work Docs or artifacts referenced by `evidence`.

Optional arrays default to empty.

### plan_output

```ts
interface PlanOutput {
  ready: boolean;
  docs: {
    goal?: string;
    spec?: string;
    plan?: string;
    tasks?: string;
  };
  summary: string;
  tasks?: PlannedTask[];
  evidence?: string[];
  questions?: Question[];
}

interface PlannedTask {
  id: string;
  title: string;
  scope: string;
  depends_on?: string[];
  files?: string[];
  responsibility?: string;
  parallel_group?: string;
  expected_output: string;
  merge_plan?: string;
}
```

Meaning:

```text
ready
  true when goal, product behavior, use cases, and plan are clear enough to implement.

docs
  Paths to Work Docs created or updated during planning.

tasks
  Optional task graph for larger work. Each task declares owned files or a responsibility boundary, expected output, and dependencies. Parallel-ready tasks need disjoint ownership or an explicit merge plan.

summary
  Goal language, use cases, implementation plan, and remaining uncertainty.

evidence
  Glossary, System Map, repository, code, test, or Work Doc refs that support the plan.

questions
  Product, language, use-case, or technical questions that need user input before implementation.
```

### implement_output

```ts
interface ImplementOutput {
  summary: string;
  changed_files?: string[];
  evidence?: string[];
  questions?: Question[];
}
```

Meaning:

```text
summary
  What the agent implemented or changed.

changed_files
  Source, test, config, or docs files changed by the agent when known.

evidence
  File refs, diff refs, command refs, or artifact refs.

questions
  New product, language, or implementation questions discovered during implementation.
```

### review_output

```ts
interface ReviewOutput {
  passed: boolean;
  doc?: string;
  summary: string;
  evidence?: string[];
  issues?: string[];
  language_updates?: LanguageUpdateProposal[];
  questions?: Question[];
}
```

Meaning:

```text
passed
  true when the result is verified enough to advance.

doc
  Optional path to the review document.

summary
  Verification result against the specified use cases.

evidence
  Test commands, manual checks, review refs, or artifacts.

issues
  Concrete problems that should drive retry, ask, block, or final risk.

questions
  User questions raised by unresolved product meaning, approval needs, or review judgment.

language_updates
  Proposed Glossary, System Map, or System Document updates. Passing review with language updates returns an approval AskAction before durable `.krow/system` writes.
```

Decision:

```text
The AI produces work outputs.
krow validates the output shape, stores the output, and uses it to choose next state.
Keep payloads compact.
Keep detailed reports in Work Docs or referenced artifacts.
Use plan/implement/review as the runtime flow.
```

## 5. Ask/Answer Schema

AskAction turns user conversation into durable workflow state.

```ts
interface Question {
  id: string;
  question: string;
  context?: string;
  options?: string[];
}

interface Answer {
  question_id: string;
  answer: string;
  rationale?: string;
}
```

`options` are suggested answers, not a separate command path. The user's answer is stored as text.

Ask loop:

```text
AI submits a work output with questions.
krow validates questions and returns AskAction.
AI asks the user the bundled questions.
User answers in the coding agent conversation.
AI writes Answer payload.
AI submits answers through the provided submit command.
krow stores answer payloads in state artifacts and returns next WorkAction.
The next run folds accepted answers into goal.md, spec.md, plan.md, or review.md.
```

Decision:

```text
Workflow-affecting user conversation goes through AskAction.
Normal progress/final explanation can remain plain chat.
Keep ask payloads as questions and answers.
Let current WorkflowState explain why the ask exists.
```

## 6. Workflow State Shape

State lives in:

```text
.krow/state/workflows/<workflow-id>/state.json
```

Minimum target shape:

```ts
interface WorkflowState {
  schema_version: string;
  workflow_id: string;
  status: "running" | "waiting" | "completed" | "blocked" | "stopped";
  current?: PendingActionState;
  pending_questions?: Question[];
  tasks?: TaskState[];
  outputs: OutputRecord[];
  runtime_session: RuntimeSession;
  refs: {
    work_root: string;
    artifact_root: string;
  };
  created_at: string;
  updated_at: string;
  blocked_reason?: string;
}

interface PendingActionState {
  type: "run" | "ask";
  expects: "plan_output" | "implement_output" | "review_output" | "answers";
  output_path: string;
}

interface OutputRecord {
  kind: string;
  path: string;
  created_at: string;
}

interface TaskState {
  id: string;
  status: "planned" | "running" | "done" | "blocked";
  depends_on?: string[];
  owner?: string;
  output_path?: string;
}
```

Decision:

```text
AI can read state refs.
AI submits payloads.
krow owns state mutation.
Keep state as the durable current position, not a full execution report.
Store detailed outputs as artifact files and reference them from outputs.
Use tasks only when plan_output defines them.
Allow independent tasks to run in parallel when their dependencies and file scopes do not conflict.
```

## 7. Work State Machine

The state machine keeps the product development flow compact:

```text
plan -> implement -> review -> done
```

Each state returns either `run`, `ask`, `done`, or `fault`.

```text
plan
  run plan_output
  ask when goal language, product behavior, use cases, or plan need user answer
  next implement when plan_output.ready is true

implement
  run implement_output
  use planned tasks when they exist
  run independent tasks in parallel when the agent runtime supports it
  ask when implementation discovers product, language, or technical questions
  next review after implement output is accepted

review
  run review_output
  ask when review needs user judgment or language update approval
  next implement when review fails and retry is useful
  next done when review passes
  next blocked when review cannot proceed
```

Decision:

```text
Use plan/implement/review as the canonical workflow order.
Use ask after plan only for questions that affect product meaning, project language, implementation choice, or verification judgment.
Let the state machine decide the next action from the current state and submitted work output.
Keep retry behavior explicit in review and fault handling.
Let plan define task boundaries for large work.
Let implement consume the task graph without adding a new runtime phase.
```

## 8. Work Docs Boundary

Work Docs should be durable but proportional.

Minimum target:

```text
.krow/work/<work-id>/
  index.md
  goal.md
  spec.md
  plan.md
  review.md
```

Expandable docs:

```text
tasks/
  <task-id>.md
tasks/index.md
language-updates.md
```

Decision:

```text
Create goal.md, spec.md, plan.md, and review.md as separate files for every work item.
Keep each file short when the work is small.
Create task docs only when plan defines multiple implementation tasks.
Create language-updates.md only when review proposes durable language changes.
Express Work Docs in the approved project language.
```

Template targets:

```text
goal.md
  Statement
  Terms
  Decisions

spec.md
  Use Cases
  Expected Behavior
  Out Of Scope

plan.md
  Implementation
  Tests
  Tasks

review.md
  Result
  Evidence
  Issues
  Language Updates

tasks/<task-id>.md
  Scope
  Dependencies
  Files
  Output
```

`Decisions` sections contain accepted decisions for that document. Pending questions live in `Question` payloads, and submitted answers live in workflow state artifacts.

## 9. Language System Contract

The Language System is the repository's durable agreement about product and software meaning.

It has three durable parts:

```text
Glossary
  Approved project vocabulary for meaningful software concepts.

System Map
  Current map of the software in the approved project language.

System Documents
  Focused descriptions of important behavior, responsibilities, and boundaries with code references.
```

The Language Domain owns:

```text
term lookup
term proposal
term relationship lookup
meaning conflict detection
System Map update proposal
System Document update proposal
code compatibility notes
approval state for proposed language changes
```

Glossary scope:

```text
include
  product/domain objects
  system objects
  states and transitions
  user-visible or runtime actions
  work artifacts
  agent/runtime roles
  boundaries and reusable concepts
  names that should naturally carry into use cases, tests, docs, or code

exclude
  ordinary natural-language words
  one-off explanatory phrases
  local variable names and private implementation details
  speculative future ideas that are not part of current agreed meaning
```

Glossary entries stay short. Detailed behavior, responsibility, boundaries, and code references belong in System Documents.

Primary integration points:

```text
startWork
  load language summary refs and expose them in early actions.

plan
  express the user request in approved project language.
  express product behavior and use cases with the same language.
  map use cases to plan, tests, and verification.

review
  AI proposes System Map, System Document, or Glossary updates after work changes code meaning.

ask
  krow asks user to approve names, meanings, use cases, or technical choices when needed.
```

Language System use cases:

```text
Load Language Context
  runs at work start and plan start
  reads glossary.md, map.md, and relevant system docs
  adds only relevant language refs to WorkAction.context

Interpret User Request
  runs during plan
  identifies meaningful objects, actions, states, artifacts, roles, and boundaries in the user request
  matches them to existing Glossary terms and System Map areas
  uses repository evidence when the current Language System is missing or uncertain

Propose Language During Plan
  runs when planning needs meaning that is missing, conflicting, or unnamed
  emits Question values through PlanOutput.questions
  records accepted meaning in goal.md, spec.md, or plan.md
  does not directly write durable .krow/system updates

Apply User Language Answers
  runs after answers are submitted
  stores answer payloads in state artifacts
  folds accepted answers into the next plan run

Check Code Compatibility
  runs during review
  compares implemented code, tests, and docs with the planned language
  reports naming drift, missing system docs, changed responsibilities, or changed reusable meaning

Commit Language Updates
  runs after review approval
  applies approved term, System Map, or System Document updates through LanguageStore
```

Language proposal triggers:

```text
missing term
  a meaningful object, action, state, artifact, role, or boundary has no approved term.

meaning conflict
  a user phrase appears to conflict with an approved term.

alias conflict
  multiple names appear to refer to the same project meaning.

code compatibility gap
  code, tests, or docs use names that drift from approved language.

system map gap
  an entry point, area, workflow, convention, or document index is missing or stale.

system document gap
  a responsibility, behavior, boundary, or code reference needs durable explanation.
```

Greenfield behavior:

```text
Start from an empty or seed Language System.
Use user request, repository evidence, README files, manifests, entry points, tests, and visible application structure to propose initial terms and system map entries.
Ask when meaning affects implementation or verification.
Commit only approved durable language updates during review.
```

Brownfield behavior:

```text
Use existing Glossary, System Map, and System Documents as the default language.
Interpret the user request through approved terms first.
Ask only for missing meaning, conflicts, aliases, or code compatibility gaps.
Commit only changed or newly clarified reusable meaning during review.
```

Language proposal shape:

```ts
interface LanguageUpdateProposal {
  kind: "term" | "system-map" | "system-document";
  title?: string;
  summary: string;
  target?: string;
  evidence?: string[];
  refs?: string[];
}
```

Decision:

```text
AI identifies language gaps and drafts proposals.
krow stores proposals, asks for approval when needed, and applies approved updates through LanguageStore.
Language Domain remains a peer of Work Domain.
Language alignment is part of plan and review rather than a separate first phase.
Use the Language System to express Goal, Spec, Plan, Tasks, Review, and user-facing questions.
Treat code compatibility as an explicit proposal or review issue when code names and approved language diverge.
Read language during plan, ask language questions through AskAction, and commit durable language updates during review.
```

## 10. Error And Recoverability Rules

Fault classes:

```text
invalid_payload
  recoverable
  AI can fix payload and resubmit for the current workflow state.

stale_action
  recoverable
  AI should call next/status and follow the current action.

missing_required_file
  usually recoverable
  AI or runtime can recreate/read expected refs depending on file kind.

corrupt_state
  non-recoverable by agent
  user/developer action required.

unsupported_transition
  usually non-recoverable
  runtime bug or incompatible state.

tool_failure
  recoverability depends on current state and retry hint.
```

Decision:

```text
FaultAction must include recoverable boolean.
Recoverable faults should include a retry command or next command.
Non-recoverable faults should include concrete refs and issues for debugging.
```

## 11. Naming

These are krow implementation terms. They are not a repository's project Glossary, but they can seed krow's own Glossary.

Runtime terms:

```text
WorkAction
  Runtime response that tells the coding agent the next valid action.

RunAction
  WorkAction asking the agent to perform one autonomous unit.

AskAction
  WorkAction asking the agent to collect user answers.

DoneAction
  Terminal WorkAction for completed, blocked, or stopped workflow.

FaultAction
  WorkAction for invalid runtime state or invalid submitted payload.

WorkOutput
  Structured payload produced by the coding agent for plan, implement, or review.

Workflow
  Runtime execution of one Work Item.

WorkflowState
  Durable machine state used for submit, validation, resume, and next action selection.

Question
  User-facing question krow asks through the coding agent.

Answer
  Structured user answer submitted by the coding agent.
```

Work terms:

```text
Work Item
  User-requested unit of work.

Work Docs
  Human-readable documents for one Work Item.

Goal
  Project-language statement of what the user wants and why.

Spec
  Use cases and expected behavior for the Work Item.

Plan
  Implementation, test, and task plan for the Work Item.

Review
  Verification result, evidence, issues, and language update proposals.

Task Graph
  Optional dependency graph for larger implementation work.
```

Language terms:

```text
Language System
  Durable agreement about product and software meaning for a repository.

Glossary
  Approved project vocabulary for meaningful software concepts.

Term
  One approved Glossary entry.

System Map
  Repository-wide map of entry points, areas, workflows, conventions, and system documents.

System Document
  Focused description of behavior, responsibilities, boundaries, and code references.

Language Update
  Proposed or approved change to Glossary, System Map, or System Document.

Code Compatibility
  Alignment between approved project language and code, tests, or docs.
```

Integration and storage terms:

```text
Installed Agent Surface
  Generated repo-local skill or command file read by the coding agent.

Coding Agent
  Codex, Claude, Gemini, or another agent that reads the installed agent surface and performs work.

Krow Workspace
  Repository-local `.krow/` directory.

Work Root
  `.krow/work/<work-id>/` human-readable Work Docs root.

Workflow State Root
  `.krow/state/workflows/<workflow-id>/` machine-readable workflow state root.

State Artifact
  Machine-readable payload or intermediate artifact stored under a Workflow State Root.

Runtime Protocol Command
  Agent-facing command such as work start, work submit, work next, or work status.
```

Decision:

```text
Use WorkAction as the canonical term.
Use WorkflowState plus WorkAction for runtime handoff language.
Use installed agent surface for generated skills/commands.
Keep WorkflowState for machine state and Work Docs for human-readable work records.
```
