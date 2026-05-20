# krow Architecture Blueprint

This is the working architecture blueprint for the next krow structure.

The explanation starts from directories because the directories should make the software model visible:

```text
src/
  inbound-adapters/
  inbound-ports/
  application/
  domains/
  outbound-ports/
  outbound-adapters/
  infrastructure/
```

Every request enters through an inbound adapter, crosses an inbound port, is coordinated by an application service, uses domain modules for meaning and rules, and reaches the outside world through outbound ports and adapters.

```text
Inbound Adapter
  -> Inbound Port
  -> Application Service
  -> Domain
  -> Outbound Port
  -> Outbound Adapter
```

## Target Source Tree

```text
src/
  inbound-adapters/
    cli/
      main.ts
      cli.ts
      commands/
        init-command.ts
        work-command.ts
        status-command.ts

  inbound-ports/
    repository-setup-use-cases.ts
    install-agent-surface-use-cases.ts
    work-use-cases.ts

  application/
    repository-setup-application-service.ts
    install-agent-surface-application-service.ts
    work-application-service.ts
    work-action-assembler.ts

  domains/
    work/
      workflow-state.ts
      workflow-unit.ts
      task-graph.ts
      work-state-machine.ts
      work-action.ts
      questions.ts
      work-output-contracts.ts
      state-handlers/
        plan-handler.ts
        implement-handler.ts
        review-handler.ts

    language/
      glossary.ts
      system-map.ts
      system-document.ts
      references.ts
      term-proposal.ts
      code-compatibility.ts
      language-alignment-service.ts

  outbound-ports/
    krow-workspace-store.ts
    workflow-state-store.ts
    work-doc-store.ts
    language-store.ts
    repo-evidence-reader.ts
    agent-surface-writer.ts
    template-reader.ts
    clock.ts
    id-generator.ts

  outbound-adapters/
    filesystem/
      krow-workspace-store.ts
      workflow-state-store.ts
      work-doc-store.ts
      language-store.ts
      repo-evidence-reader.ts
      agent-surface-writer.ts
      template-reader.ts

  infrastructure/
    composition/
      container.ts
    templates/
      agent-surfaces/
        codex/
          work.SKILL.md
        claude/
          work.md
        gemini/
          work.toml
      documents/
        glossary.md
        system-map.md
        system-doc.md
        work-index.md
        goal.md
        spec.md
        plan.md
        task.md
        review.md

src/inbound-adapters/cli/
  init-agent-surfaces.test.mjs
  work-runtime.test.mjs
```

## Directory Roles

### inbound-adapters

Inbound adapters translate an external calling form into a krow inbound port call.

The first adapter is the CLI:

```text
krow init
krow work ...
krow status ...
```

The CLI adapter owns argv parsing, reading payload files or stdin, printing JSON or text, and exit codes. It does not own workflow meaning.

### inbound-ports

Inbound ports define what krow can be asked to do.

Initial ports:

```text
RepositorySetupUseCases
  initializeRepository

InstallAgentSurfaceUseCases
  installAgentSurface
  inspectAgentSurface
  updateAgentSurface

WorkUseCases
  startWork
  next
  submit
  status
  stop
```

`InstallAgentSurfaceUseCases` prepares coding agents to understand `$work`.

`WorkUseCases` runs the `$work` workflow after the surface exists.

### application

Application services implement inbound ports and coordinate one requested operation.

They load state, call domains, call outbound ports, persist results, and return DTOs such as `WorkAction`.

Initial services:

```text
RepositorySetupApplicationService
  creates .krow workspace and seed files
  delegates requested agent surface installation

InstallAgentSurfaceApplicationService
  selects agent templates
  renders agent command instructions
  writes .codex/.claude/.gemini files through AgentSurfaceWriter

WorkApplicationService
  loads WorkflowState
  calls Work Domain state machine and handlers
  calls Language Domain when project language matters
  writes state, Work Docs, and language proposals through outbound ports
```

`WorkApplicationService` coordinates language this way:

```text
startWork
  creates Work Docs and WorkflowState
  asks Language Domain for relevant language context refs
  returns first RunAction with enough context for planning

submit plan_output
  stores Goal, Spec, Plan, planned language, and optional Task Graph refs
  converts unresolved language questions into AskAction
  requires ready plans to include approved or proposed project language
  asks the user to review ready project language and plan before implementation
  advances to implement only after plan review approval

submit answers
  stores Answer artifacts
  returns the next RunAction so the coding agent can fold answers into Work Docs

submit implement_output
  records changed files, evidence, and discovered language compatibility issues
  advances to review

submit review_output
  stores review evidence
  asks for approval when language updates require judgment
  applies approved language updates through LanguageStore
  returns DoneAction when verification and language handling are complete
```

### domains

Domains own meaning and rules.

`domains/work` owns workflow behavior:

```text
WorkflowState
WorkflowUnit
WorkStateMachine
StateHandlers
WorkAction
Question
Answer
WorkOutput contracts
TaskGraph
review retry policy
```

`domains/language` owns project language:

```text
Glossary
GlossaryTerm
SystemMap
SystemDocument
Reference
TermProposal
CodeCompatibility
LanguageAlignmentService
```

Language Domain operations:

```text
loadLanguageContext
  reads Glossary, System Map, and relevant System Documents for the current WorkAction.

interpretRequest
  maps user language to approved terms and known system areas.

detectLanguageGaps
  finds missing terms, alias conflicts, meaning conflicts, map gaps, document gaps, and code compatibility gaps.

draftLanguageQuestions
  turns unresolved meaning into Question values for AskAction.

proposeLanguageUpdates
  drafts Glossary, System Map, and System Document updates during review.

applyApprovedLanguageUpdates
  writes approved durable language updates through LanguageStore.
```

Agent surface installation starts as an application concern. It can become a domain later only if it gains durable product rules beyond rendering and installing agent files.

### outbound-ports

Outbound ports define the outside capabilities application and domain code need.

Initial ports:

```text
KrowWorkspaceStore
WorkflowStateStore
WorkDocStore
LanguageStore
RepoEvidenceReader
AgentSurfaceWriter
TemplateReader
Clock
IdGenerator
```

### outbound-adapters

Outbound adapters implement outbound ports against concrete systems.

The first concrete adapter family is filesystem:

```text
.krow/
repo files
.codex/
.claude/
.gemini/
bundled templates
```

### infrastructure

Infrastructure holds package-local assets and runtime wiring that are neither domain rules nor application use cases.

`infrastructure/templates` contains source material for generated files:

```text
agent surface templates
document templates
```

Agent surface templates generate repo-local instructions for coding agents. Document templates generate `.krow` work and system files.

`infrastructure/composition` wires concrete adapters to application services.

The CLI should depend on the composed inbound ports, not directly on filesystem implementations or domain internals.

## Operation Matrix

The architecture should be readable from the operations krow supports.

```text
krow init
  inbound port:
    RepositorySetupUseCases.initializeRepository
  application services:
    RepositorySetupApplicationService
    InstallAgentSurfaceApplicationService
  domains:
    no Work Domain state machine
    no Language Domain reasoning beyond seed file names/templates
  outbound ports:
    KrowWorkspaceStore
    TemplateReader
    AgentSurfaceWriter
  result:
    .krow workspace exists
    selected installed agent surfaces exist

krow work start
  inbound port:
    WorkUseCases.startWork
  application service:
    WorkApplicationService
  domains:
    Work Domain creates WorkflowState and first pending action
    Language Domain loads relevant Glossary, System Map, and System Document refs
  outbound ports:
    WorkflowStateStore
    WorkDocStore
    LanguageStore
    RepoEvidenceReader
  result:
    first WorkAction, usually RunAction for plan_output

krow work submit
  inbound port:
    WorkUseCases.submit
  application service:
    WorkApplicationService
  domains:
    Work Domain validates payload against current WorkflowState
    Work Domain advances plan -> implement -> review -> done
    Language Domain evaluates language questions or update proposals when the current state needs it
  outbound ports:
    WorkflowStateStore
    WorkDocStore
    LanguageStore
    RepoEvidenceReader
  result:
    next WorkAction

krow work next
  inbound port:
    WorkUseCases.next
  application service:
    WorkApplicationService
  domains:
    Work Domain rehydrates current pending action from WorkflowState
  outbound ports:
    WorkflowStateStore
  result:
    current WorkAction without changing state

krow work status
  inbound port:
    WorkUseCases.status
  application service:
    WorkApplicationService
  domains:
    no state transition
  outbound ports:
    WorkflowStateStore
    WorkDocStore
  result:
    read-only workflow status

krow work stop
  inbound port:
    WorkUseCases.stop
  application service:
    WorkApplicationService
  domains:
    Work Domain marks workflow stopped
  outbound ports:
    WorkflowStateStore
  result:
    DoneAction with stopped status
```

## Generated Repository Workspace

`krow init` creates or maintains project-local files.

```text
.krow/
  system/
    glossary.md
    map.md
    docs/
      <system-document>.md

  work/
    <work-id>/
      index.md
      goal.md
      spec.md
      plan.md
      tasks/
        index.md
        <task-id>.md
      review.md
      language-updates.md

  state/
    workflows/
      <workflow-id>/
        state.json
        artifacts/
```

Agent surfaces are generated beside each coding agent's expected local instruction path:

```text
.codex/
  skills/
    work/
      SKILL.md

.claude/
  commands/
    work.md

.gemini/
  commands/
    work.toml
```

## Software Walkthrough

### Initialize Repository

The first action in a repository is direct CLI setup.

```text
User
  -> shell
  -> krow init
```

Directory path:

```text
inbound-adapters/cli
  parses `krow init`

inbound-ports
  RepositorySetupUseCases.initializeRepository

application
  RepositorySetupApplicationService
  InstallAgentSurfaceApplicationService

outbound-ports
  KrowWorkspaceStore
  TemplateReader
  AgentSurfaceWriter

outbound-adapters/filesystem
  writes .krow/
  writes .codex/.claude/.gemini
```

After this, the coding agent can see `$work` through the installed agent surface.

### Run Work Through Coding Agent

Normal work starts in the coding agent after init.

```text
User
  -> Coding Agent Runtime
  -> $work "request"
```

The installed Work Skill is a generated adapter surface. It is not the workflow runtime and it is not a domain module. It tells the coding agent to call krow and follow returned `WorkAction` values.

Directory path for each krow call inside the loop:

```text
installed Work Skill
  asks coding agent to call krow CLI

inbound-adapters/cli
  parses runtime protocol command

inbound-ports
  WorkUseCases.startWork
  WorkUseCases.next
  WorkUseCases.submit

application
  WorkApplicationService

domains/work
  decides valid workflow transition
  returns run / ask / done / fault WorkAction

domains/language
  resolves project language when the current work depends on meaning

outbound-ports
  WorkflowStateStore
  WorkDocStore
  LanguageStore
  RepoEvidenceReader

outbound-adapters/filesystem
  persists .krow state/docs/system updates
  reads repository evidence
```

### Ask Through Agent

During `$work`, the coding agent remains the user-facing runtime and krow returns the user questions it needs as `AskAction`.

```text
WorkApplicationService
  -> AskAction
  -> CLI JSON
  -> Installed Work Skill
  -> Coding Agent asks user
  -> User answers
  -> Coding Agent submits answer payload
  -> WorkUseCases.submit
```

This keeps user interaction in the coding agent and workflow state in krow.

## Runtime Protocol

The user-facing surface is `$work`, but the installed Work Skill drives smaller protocol commands.

```text
work start
  start a workflow from a user request

work next
  read current workflow state and return current WorkAction

work submit
  submit the current expected payload for the workflow state

work status
  return a read-only workflow status view

work stop
  mark workflow stopped
```

These protocol commands are not separate domains. They are calls through `WorkUseCases`.

Older submit commands can exist as CLI compatibility aliases during migration, but the target application port is `WorkUseCases.submit`.

## Runner Boundary

The installed agent surface is intentionally small. It tells the coding agent to start the latest krow runtime and follow the returned `WorkAction`.

```text
Installed Work Skill
  -> npx --yes krow-cli@latest work start "<request>" --json
  -> runtime records resolved exact version in WorkflowState
  -> returned submit commands pin that exact version
```

Version handling stays small: latest is used only to start a new workflow, then returned commands pin the resolved exact version. State, schema, and payload compatibility are validated when each workflow step needs them.

## WorkAction

`WorkAction` is the Work Domain response that tells the coding agent which next action is valid.

```text
run
  The coding agent can perform one autonomous unit.

ask
  User input is required before the workflow can advance.

done
  The workflow reached a terminal state.

fault
  Runtime state or submitted payload is invalid.
```

The CLI adapter serializes `WorkAction`; it does not decide action meaning.

## Current Code Mapping

Current files should map to the target structure this way:

```text
src/inbound-adapters/cli/cli.ts
  -> inbound adapter

src/inbound-adapters/cli/main.ts
  -> package bin entrypoint

src/application/work-application-service.ts
  -> application service

src/domains/work/*
  -> domains/work/task-graph.ts
  -> domains/work/work-state-machine.ts
  -> domains/work/work-action.ts

src/domains/language/*
  -> language domain

src/outbound-adapters/filesystem/krow-paths.ts
  -> shared filesystem path helpers

src/domains/language/project-grounding.ts
  -> domains/language/language-alignment-service.ts
  -> outbound-adapters/filesystem/repo-evidence-reader.ts

src/outbound-adapters/filesystem/work-document-renderer.ts
  -> infrastructure/templates/*
  -> outbound-adapters/filesystem/template-reader.ts

src/inbound-adapters/cli/*.test.mjs
  -> co-located black-box verification of init and WorkAction runtime behavior
```
