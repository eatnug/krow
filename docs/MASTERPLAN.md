# krow Master Plan: Natural Language and Code Synchronization

## 0. What We Are Building

`krow` should help natural-language product intent and code evolve together.

The core promise is:

> A team describes a system with an agreed Project Language. krow retrieves the current codebase, grounds the request in that language, helps the user approve a concrete PRD and implementation plan, then turns that plan into tests and code that remain traceable to the original intent.

The center is not a fixed workflow stage such as `clarify`, `execute`, or `verify`.

The center is synchronization:

```text
Project Language <-> PRD <-> User Stories <-> Acceptance Criteria <-> Examples <-> Tests <-> Code
```

## 1. Desired User Experience

A user opens an AI agent in a terminal and asks for work:

```text
$work Users with free subscription should now be blocked for Daily Recommendation Content
```

krow should help the agent:

1. retrieve current codebase behavior, Project Language, and related Project Concept Maps
2. identify existing terms and missing or ambiguous terms
3. ask bundled questions only where the codebase and Project Language cannot resolve ambiguity
4. restate the goal using agreed Project Language
5. draft or update a PRD and implementation plan
6. request user approval for the PRD and plan before significant implementation
7. implement in reviewable work units
8. produce tests and code that carry links back to the approved product intent
9. report whether the result matches the approved natural-language goal

The user should be able to inspect the natural-language artifacts and the code and keep confidence that they describe the same system.

## 2. Project Language as the Spine

The closest conceptual model is DDD's ubiquitous language, but krow needs a broader scope than business domain vocabulary.

Project Language should capture the agreed concepts used to describe the product and codebase.

That includes two broad classes of concepts:

- product concepts: users, subscriptions, recommendation content, access rules, user-facing flows
- system concepts: APIs, repositories, stores, sessions, adapters, background jobs, important UI pages, state containers

A React store, API controller, repository, or framework integration should be part of Project Language when it materially affects how the product behavior is implemented and changed. It does not need to be part of Project Language when it is only local framework glue or private implementation detail.

Keep the top-level classification small:

- actors
- concepts
- rules
- interfaces
- data
- processes
- modules

Specific details such as screens, buttons, APIs, repositories, tables, jobs, stores, and UI components should usually appear in `Used In`, `System Role`, or Project Concept Map documents, not as a long fixed `Kind` taxonomy.

This is not only a glossary. It is the language base for PRDs, user stories, acceptance criteria, examples, tests, plans, code review, and implementation naming.

The goal is not identical wording everywhere. PRDs, tests, and code can express ideas differently. The goal is that each expression is connected to the same agreed concepts.

## 3. Project Language Entry Shape

Start light. The entry shape should help retrieval and ambiguity reduction without becoming bureaucracy.

Recommended minimal shape:

```md
## TERM-001: Free Subscription User

Key: user.free
Kind: actor
Layer: product
Status: approved

Means:
A user whose current subscription tier is Free Subscription.

Boundary:
- Includes users actively on the free tier.
- Does not include expired paid users unless explicitly mapped.

Used In:
- PRD: Daily Recommendation Access
- UI: Upgrade Prompt
- Policy: Recommendation Content Access
- Tests: free users are blocked from daily recommendations

Related:
- Free Subscription
- Paid Subscription User
- Daily Recommendation Content

Open Questions:
- Are trial users treated as Free Subscription Users?
```

Useful fields:

- `Key`: human-readable concept key, such as `user.free` or `recommendation-content.daily`
- `Kind`: actor, concept, rule, interface, data, process, module
- `Layer`: product or system
- `Status`: proposed, approved, deprecated
- `Means`: short definition
- `Boundary`: includes, excludes, ambiguity, and split points
- `Used In`: PRDs, UI, code anchors, tests, APIs, jobs, tables
- `System Role`: optional implementation role, such as store, repository, api, adapter, page, job
- `Related`: nearby concepts
- `Open Questions`: unresolved naming or boundary decisions

Aliases, deprecated names, and evidence can be added when needed, but they do not need to be mandatory in the first version.

The first version should be Markdown, but not free-form Markdown. krow should define a narrow heading and label convention so agents cannot invent arbitrary structures.

Initial required fields:

- heading with stable id and term name
- `Key`
- `Kind`
- `Status`
- `Means`

Strongly encouraged fields:

- `Boundary`
- `Used In`
- `Related`
- `Open Questions`

The stable id is for durable links. The `Key` and term name are for human and agent retrieval.

## 4. PRD Structure

There should not be two PRD layers.

A PRD is a product document. It can be large if the product problem is large. krow should not invent "PRD slices" as a second layer.

The PRD should contain reviewable sections:

```text
PRD
  -> User Story
  -> Acceptance Criteria
  -> Example
```

Implementation work can then be split in the implementation plan.

### PRD

Answers:

- What product behavior should exist?
- Why does it matter?
- Which Project Language terms and concept keys are involved?
- Which user stories are in scope?
- Which behaviors are out of scope?
- What approval decisions were made?

PRD sections should use the same concept keys that appear in Project Language and Project Concept Maps.

Example:

```md
Concepts:
- user.free
- recommendation-content.daily
- content-access.subscription-rule
```

### User Story

A user-centered statement of intent.

Example:

> As a Free Subscription User, I should be blocked from Daily Recommendation Content so that paid recommendation content remains limited to eligible users.

User Story is preferable to Use Case for the initial product shape because it is familiar and product-facing.

### Acceptance Criteria

The rules that must hold for the story to be accepted.

Example:

- Free Subscription Users cannot view Daily Recommendation Content.
- Blocked users see the existing Upgrade Prompt.
- Paid Subscription Users can still view Daily Recommendation Content.
- Trial users are handled according to the approved subscription policy.

### Example

A concrete, test-shaped case.

Example:

> Given a Free Subscription User  
> When the user requests Daily Recommendation Content  
> Then the user sees the Upgrade Prompt and the content is not rendered.

Examples are the bridge from natural language to tests.

## 5. Embedded Trace Links

Do not maintain a separate hand-written Trace Map by default.

Traceability should live inside normal artifacts:

- PRD sections have stable ids such as `PRD-001`
- User Stories have stable ids such as `US-001` and reference PRD ids
- Acceptance Criteria have stable ids such as `AC-001` and reference User Story ids
- Examples have stable ids such as `EX-001` and reference Acceptance Criteria ids
- tests reference Example ids, preferably in test names
- implementation plans reference tests, Project Concept Maps, and code anchors
- review reports derive a trace overview from those links

A generated trace report can exist, but it should be derived, not manually maintained.

## 6. Product Loop

The user-visible loop should be:

```text
Retrieve current codebase and Project Language
  -> Ground the request in existing terms
  -> Load related Project Concept Maps
  -> Propose or clarify terms when needed
  -> Ask bundled questions for unresolved ambiguity
  -> Draft or update PRD
  -> Request PRD approval
  -> Draft Implementation Plan
  -> Request Plan approval
  -> Generate or update tests from Examples
  -> Implement approved work units
  -> Review behavior and language alignment
  -> Update Project Language only when approved
```

Internal runtime phases can exist, but they should serve this loop rather than define the product.

## 7. Approval Gates

krow should request approval before important commitment points.

### Project Language Approval

Required when:

- a new term is introduced
- an existing term is split
- a term is deprecated
- two terms appear to mean the same thing
- one term is used for conflicting concepts
- a code name may need to become an accepted alias

### PRD Approval

Required before implementation when:

- the request changes product behavior
- acceptance criteria are not already documented
- the work affects user-facing concepts
- the agent had to infer missing requirements

### Plan Approval

Required before implementation when:

- multiple implementation approaches are viable
- the change is broad
- the change affects shared architecture
- tests must be added or rewritten
- the agent proposes more than a narrow local edit

### Scope Expansion Approval

Required when implementation discovers that the approved plan is insufficient.

The agent should return with evidence rather than silently expanding scope.

Approval can start as a normal Markdown section instead of frontmatter:

```md
## Approval

Status: approved
Approved By: user
Approved At: 2026-05-07

Decisions:
- "Blocked" means showing the existing Upgrade Prompt.
- Trial users are out of scope.
```

Required approval statuses:

- `draft`
- `needs-revision`
- `approved`

## 8. Human-Sized Work Units

The system must prevent giant opaque work.

The overall revision does not need to be the smallest possible change. It should be proportional to the approved PRD.

But planning should split execution into work units a person can understand, approve, and review.

A work unit is probably too large if:

- it touches several unrelated Project Language concepts
- it modifies many disconnected files
- it changes behavior and architecture at the same time
- the reviewer cannot summarize the goal in one or two sentences
- tests cover several unrelated stories at once
- the diff needs multiple mental models to review

Practical first rule:

> One work unit should implement one User Story or a small set of tightly related Examples.

That does not mean krow must create one plan file for every User Story. The Implementation Plan should be one approved plan for the PRD work, and it can contain several numbered work units.

Create separate implementation plan files only when the PRD is too large for one human-readable plan. Do not create a second PRD layer.

Recommended structure:

```text
One PRD
  -> one or more Implementation Plans
    -> a small number of Work Units
```

Default:

- one PRD has one Implementation Plan
- one Implementation Plan should usually contain 3-7 Work Units
- if a plan needs more than 7 Work Units, recommend splitting the plan
- if a PRD needs more than 3 Implementation Plans, warn that the PRD may be too broad for one approval cycle

Suggested split warnings:

- PRD has more than 5 User Stories
- PRD has more than 10 Examples
- PRD has more than 12 Acceptance Criteria
- PRD significantly involves more than 10 Project Language concepts
- PRD touches more than 3 primary implementation concerns, such as UI, API, database, billing, notification, or background jobs
- planned work mixes behavior change and architecture refactor

Splitting should reduce cognitive load, not create bookkeeping overhead.

## 9. Naming Consistency

krow should prefer consistent names across natural language, tests, and code, but enforcement should be staged.

Initial rule:

- PRD, User Stories, Acceptance Criteria, and Examples must use approved or proposed Project Language terms.
- test names should preserve Project Language terms.
- public APIs, exported classes/functions, database models, routes, and UI components should use approved terms or record aliases.
- local variables can be warnings unless they create real ambiguity.

Example drift:

```text
Approved term: Daily Recommendation Content
Code uses: TodayPicks
```

krow should ask:

- Is `TodayPicks` an alias?
- Is it a UI label?
- Is it a different concept?
- Should the code be renamed?

The long-term preference is consistent naming for story-facing code.

Story-facing code means product or system elements that could naturally be named in a User Story, Acceptance Criteria, Example, PRD, or implementation plan.

Examples:

- screen/page
- button/form/menu/action
- API endpoint
- domain service
- policy/rule
- repository as a domain boundary
- database model/entity/table
- event/job/command
- exported type/class/function when it represents a product concept
- test suite/test case

Non-examples:

- private helper
- local variable
- formatting utility
- framework glue
- generated code
- low-level adapter unless it is part of a user-visible or system-facing boundary

Classes, methods, exported functions, routes, database models, UI components, and test names should be easy to discuss using Project Language when they are story-facing. Local implementation details can be looser at first.

## 10. Determinism Strategy

The process becomes more deterministic by constraining transformations.

Avoid:

```text
request text -> agent improvises -> code
```

Prefer:

```text
request
  -> retrieved current state
  -> agreed Project Language terms
  -> related Project Concept Maps
  -> approved PRD
  -> approved Implementation Plan
  -> Examples
  -> tests
  -> code
  -> derived review report
```

Each transformation should have:

- input shape
- output shape
- allowed Project Language terms
- validation checks
- approval policy
- embedded trace links

The AI still generates content, but it generates into constrained, reviewable forms.

## 11. Storage and Retrieval Design

krow needs a deterministic way to store and retrieve the Project Language, product intent, and codebase understanding.

The storage model should avoid one giant document and avoid scattering important meaning where retrieval cannot find it.

Do not start with hand-written mapping tables. The source of truth should be structured Markdown documents with stable ids and links. Any generated index should be an optional cache, not a maintained artifact.

Recommended structure:

```text
.krow/
  language.md
  concepts/
    index.md
    <concept-key>.md
  prds/
    <prd-id>.md
  plans/
    <plan-id>.md
  examples/
    <example-id>.md
  reviews/
    <review-id>.md
  generated/
    <derived-index>.json
```

The Markdown files are the human source of truth. They should contain the links needed for retrieval.

Optional generated indexes can be added later for speed, but they should always be derived from Markdown and code search.

### Project Concept Maps

The basic documentation unit is not a source file, module folder, or broad code area.

The basic documentation unit is a Project Language concept.

A Project Concept Map explains how one approved or proposed concept is understood across product language, user stories, code anchors, tests, and neighboring concepts.

This keeps the map aligned with the language users and agents use to ask for changes.

Example:

```md
# User

Key: user
Kind: actor
Layer: product
Status: approved

Means:
A person account using the product.

Hierarchy:
- user.free
- user.paid
- user.trial

Related Concepts:
- subscription
- content-access
- recommendation-content.daily

Business Use Cases:
- user.sign-up
- user.update-profile
- user.access-daily-recommendation-content

Code Anchors:
- Model: `src/users/user.ts`
- Repository: `src/users/user-repository.ts`
- Controller: `src/api/users/*`
- Tests: `src/users/*.test.ts`

Notes:
- Subscription state is related to User, but subscription eligibility rules are owned by content access policy.
```

System concept example:

```md
# Recommendation Store

Key: recommendation-store
Kind: module
Layer: system
System Role: store
Status: approved

Purpose:
Client-side state holder for recommendation content loading, blocked state, and refresh behavior.

Connected Product Concepts:
- recommendation-content.daily
- user.free
- content-access.subscription-rule

Code Anchors:
- Store: `src/stores/recommendation-store.ts`
- Hook: `src/hooks/useRecommendationContent.ts`
- UI: `src/pages/recommendations/*`
- Tests: `src/stores/recommendation-store.test.ts`

Responsibilities:
- tracks current recommendation content
- tracks loading and blocked states
- coordinates refresh requests

Boundaries:
- does not decide subscription eligibility
- does not fetch payment state directly
- access decisions come from server/API response
```

Project Concept Maps replace both giant map files and mandatory per-source-file `.md` files.

A Project Language entry can exist without a Project Concept Map.

Create or update the Project Language first when a new requirement, test, plan, or story-facing code introduces a concept that existing Project Language cannot describe precisely.

Create a Project Concept Map only when that concept needs structure beyond a glossary entry.

Create a Project Concept Map when the concept:

- appears as a core noun, rule, actor, or system object in PRDs, User Stories, Acceptance Criteria, Examples, plans, tests, or story-facing code
- has implementation responsibility, such as a repository, API, store, policy, model, page, adapter, or job
- has a useful hierarchy, such as `user.free`, `user.paid`, or `recommendation-content.daily`
- needs boundaries against nearby concepts
- connects product language to several code anchors
- cannot be explained well enough by its Project Language entry alone

Do not create one for:

- private helpers
- local utilities
- tiny UI atoms
- generated code
- framework glue that is not story-facing
- implementation details that are closed inside one small file
- concepts already explained well enough by a parent Project Concept Map

`concepts/index.md` should stay small. It is a router that lists major concept docs and aliases, not a place to append the whole codebase story.

### Code Anchors and Generated Evidence

Project Concept Maps may list code anchors, but code anchors are hints, not a manually maintained dependency graph.

Use code anchors for places an agent should inspect first:

- model/entity/table
- repository
- API route/controller/resolver
- domain rule/policy/service
- UI page/form/action
- store/state container
- external adapter
- background job/queue
- test suite

Generated evidence can later supplement the maps:

- text search bundles
- test indexes
- file and symbol indexes
- route and resolver indexes
- import and reference graphs
- dependency or call-flow summaries

Generated evidence should live under `.krow/generated/` and should be rebuildable. It helps retrieval and impact analysis, but it is not the human source of truth.

Initial priority:

1. text search bundle
2. test index
3. file and symbol index
4. route/API index
5. dependency graph
6. call-flow summary

Dependency graphs and call-flow summaries are useful later, but they should not block the first working loop.

### Retrieval Bundle

For any `$work` request, krow should build a retrieval bundle before drafting or editing:

- matched Project Language terms
- candidate unknown terms
- related Project Concept Maps
- related PRD sections
- related User Stories
- related Acceptance Criteria and Examples
- related tests
- related code anchors
- related code and test paths found by search or generated evidence
- open questions and unresolved naming gaps

The retrieval bundle is what the agent uses to ask focused questions and draft the PRD or plan.

Initial retrieval strategy:

1. read structured Markdown documents
2. match Project Language terms and aliases
3. load related Project Concept Maps by concept key, term name, alias, and hierarchy
4. follow embedded links from PRD, User Stories, Acceptance Criteria, Examples, plans, and concept maps
5. inspect code anchors suggested by Project Concept Maps
6. use `rg` search for terms, aliases, and code anchor names in code and tests
7. use generated indexes only as supplemental evidence

krow should act like a careful developer orienting in a codebase:

```text
request language
  -> project concepts
  -> concept maps
  -> likely code anchors
  -> actual code inspection
  -> tests and implementation plan
```

Language-aware parsing should not be required at first. It can become an optional detector later when the document-and-search workflow is proven.

### Initialization

`krow init` should set up the krow runtime surface for a project.

It should create the structure, templates, CLI connection points, and agent instruction surfaces needed for the loop. It should not pretend to understand or migrate the whole codebase on day one.

Initial output:

- `.krow/language.md`
- `.krow/concepts/index.md`
- template files for PRD, Implementation Plan, Project Concept Map, and Review Report
- `.krow/generated/` location for rebuildable indexes
- runtime state directories needed by the CLI
- agent-specific skill or instruction stubs when the host agent supports them
- the instruction surface that tells agents how to call the krow workflow

If the user provides a service or feature description, init can seed minimal proposed Project Language entries. Those entries should remain `proposed` until approved.

Existing-code connection belongs to `$check`, not `init`.

`$check` is both the brownfield first pass and the recurring sanity check. It accepts an optional service or product description, then scans routes, tests, exported symbols, package structure, runtime entrypoints, product documents, filenames, existing krow docs, and Concept Map anchors as evidence. It writes generated evidence, a check report, and proposed krow document updates under `.krow/`. It does not edit source code. Proposed Project Language and Concept Map changes become part of the krow baseline only after explicit user approval.

### Agent Runtime Boundary

The AI agent integration should be organized around explicit inputs and outputs:

- `DocumentStore`: reads and writes Markdown artifacts
- `Retriever`: builds the retrieval bundle from Project Language, Concept Maps, search, and generated evidence
- `Checker`: scans repository evidence and writes `.krow` check reports plus proposed language/concept updates
- `Clarifier`: asks bundled questions only for real ambiguity
- `PRDWriter`: drafts or updates the PRD using Project Language
- `PlanWriter`: creates reviewable work units from the approved PRD
- `Executor`: changes tests and code only from an approved plan
- `Verifier`: checks Examples, tests, code anchors, and naming links
- `ReviewReporter`: derives the final alignment report

The agent should not use hidden memory as the main coordination layer. Durable Markdown artifacts and generated evidence should be enough for a resumed session or a fresh worker to continue.

## 12. Enforcement

Early enforcement should be gentle.

Shadow enforcement:

- warn when a request uses undefined Project Language terms
- warn when a PRD uses undefined terms
- warn when a User Story has no Acceptance Criteria
- warn when Acceptance Criteria have no Examples
- warn when an Example has no test
- warn when code changes have no link back to an approved plan
- warn when the proposed work is too large to review

Strict enforcement later:

- block implementation without PRD approval when required
- block implementation without Plan approval when required
- block undefined terms unless proposed and approved
- block code changes without test or acceptance trace
- block silent scope expansion

## 13. What krow Should Not Overfit To

Do not make current internal phase names the product model.

Terms like `clarify`, `execute`, and `verify` can remain implementation mechanics, but users should experience:

- retrieve current state
- agree on language
- approve PRD
- approve plan
- implement reviewable work units
- review alignment

Do not force a separate Trace Map file if links can live naturally in PRD, User Story, Acceptance Criteria, Examples, tests, plans, and review output.

Do not assume every project needs the same document style. The stable chain is:

```text
Project Language (+ Project Concept Maps when useful) -> PRD -> User Story -> Acceptance Criteria -> Example -> Test -> Code
```

## 14. Roadmap

### Phase 0: Runtime Bootstrap

Define what `krow init` installs into a project.

Success:

- `.krow/` runtime directories are created
- default Markdown templates are created
- agent instruction surfaces or skills are connected where supported, including `$work` and `$check`
- CLI entry points know where to read and write workflow state
- init does not attempt brownfield concept extraction by default

### Phase 1: Define the Document Contract

Create the minimal Markdown conventions for:

- Project Language
- PRD
- User Story
- Acceptance Criteria
- Example
- Implementation Plan
- Review Report
- Project Concept Map

Success:

- a human can read and approve them
- an agent can validate completeness
- each artifact has stable ids where downstream links need them
- no extra PRD layer exists
- agents cannot invent new document shapes without recording a format gap
- retrieval can work from Project Language, Concept Maps, Markdown links, code anchors, and search without a hand-written mapping table

### Phase 2: Build a Concrete Reference Example

Create one complete example package that exercises the document contract:

- Project Language
- PRD
- User Stories
- Acceptance Criteria
- Examples
- Implementation Plan
- expected Review Report
- expected retrieval bundle
- Project Concept Maps when useful

Success:

- the example is small enough to inspect manually
- every Example can point to a future test
- the expected Review Report can be derived from embedded links
- the expected retrieval bundle can be derived from Project Language, Concept Maps, Markdown links, code anchors, and search

### Phase 3: Retrieve and Ground

Teach krow to retrieve current codebase state and Project Language before drafting or editing product intent.

Success:

- known terms are recognized from Project Language
- unknown terms are proposed or questioned
- ambiguous terms are bundled into one question set
- the agent can restate the user's request as a concrete goal using approved or proposed terms
- retrieval can use Project Language, Project Concept Maps, PRDs, plans, code anchors, and text search

### Phase 3.5: Check and Align

Add the user-facing `$check` surface for brownfield initialization and recurring drift checks.

Success:

- `$check` reads the repository and writes only under `.krow`
- `$check` treats positional text as product/service description; explicit path narrowing belongs to `--scope`
- generated evidence is rebuilt under `.krow/generated`
- check reports are written under `.krow/checks/<check-id>/report.md`
- proposed Project Language entries and Concept Maps are generated as reviewable `.krow` files
- ambiguous concepts are returned as bundled questions
- only explicit user decisions are applied to `.krow/language.md` and `.krow/concepts`
- source code changes remain out of scope for `$check`

### Phase 4: PRD and Plan Approval

Add explicit approval gates.

Success:

- user approves or revises the PRD
- user approves or revises the Implementation Plan
- implementation does not proceed past required gates
- scope expansion returns to approval with evidence
- approval sections are parseable from Markdown

### Phase 5: Examples to Tests

Generate tests from approved Examples.

Success:

- each test references the Example it proves
- missing testability is reported explicitly
- test names preserve Project Language where practical
- `EX-###` ids can be found by test scanning
- execution cannot claim Example-backed work without `exampleTests` links in the execute payload

### Phase 6: Plan to Code

Implement approved work units.

Success:

- code implementation happens after Example tests are created or updated
- execute payload records ordered `tests-from-examples -> implement-code -> run-tests-after-code` evidence
- implementation links point changed code files back to Example ids and Plan ids
- code changes are proportional to the approved plan
- public concepts use agreed Project Language or record a naming gap
- each work unit remains reviewable
- story-facing classes, functions, routes, models, and components are checked for naming drift

### Phase 7: Review Alignment

Generate a derived review report.

Success:

- PRD links to User Stories
- User Stories link to Acceptance Criteria
- Acceptance Criteria link to Examples
- Examples link to tests
- tests link to implementation code anchors
- missing links or scope drift are visible
- review reports are derived from artifact ids, Markdown links, tests, Project Concept Maps, and code anchors
- the local runtime can derive the report from workflow state after verification

### Phase 8: Stronger Enforcement

After the loop works, add strict rules.

Success:

- unapproved terms can block work
- missing PRD/Plan approval can block work
- trace gaps can block completion
- silent scope expansion is rejected

## 15. Resolved Defaults

Use these defaults until evidence forces a change:

- documents are Markdown with narrow heading and label conventions
- Project Language requires stable id, `Key`, `Kind`, `Status`, and `Means`
- `Kind` stays small: actor, concept, rule, interface, data, process, module
- `Layer` separates product concepts from system concepts
- detailed code anchors go in `Used In` or Project Concept Maps
- Project Concept Map Markdown uses parseable labels plus normal Markdown sections, not frontmatter by default
- a Project Language entry can exist without a Project Concept Map
- create a Concept Map when a concept needs implementation responsibility, hierarchy, boundaries, or code anchors beyond a glossary entry
- PRD is one document layer; do not create PRD slices
- Implementation Plan contains reviewable work units
- do not create one plan file per User Story by default
- Examples exist to keep Acceptance Criteria clean and tests concrete
- tests reference Example ids in test names
- approval uses a Markdown `## Approval` section
- Markdown files are source of truth
- no hand-written mapping tables by default
- generated indexes are optional caches only
- generated evidence starts with search, tests, symbols, and routes before dependency or call-flow analysis
- Project Concept Maps are optional retrieval aids, not mandatory per-file docs
- Project Concept Maps can cover product concepts and important system concepts such as stores, repositories, APIs, adapters, jobs, and shared UI pages
- `krow init` is runtime and workflow bootstrap, not brownfield codebase migration
- `$check` covers brownfield first connection and recurring language/code sanity checks
- `$check` may write `.krow` reports, generated evidence, and approved Project Language or Concept Map updates, but not source code
- language-aware parsing is not required initially
- naming consistency is enforced first on docs, tests, and story-facing code

## 16. Resolved From Open Questions

These decisions are settled for the current implementation direction:

- Project Concept Maps use Markdown labels and sections, with required fields `Key`, `Layer`, `Kind`, `Status`, and `Means` or `Purpose`.
- Concept Maps are created for concepts that need implementation responsibility, hierarchy, boundaries, or code anchors beyond a glossary entry.
- Generated evidence starts lightweight: text search, tests, symbols, and routes. Dependency graphs and call-flow summaries come later.
- `krow init` bootstraps runtime structure, agent instruction surfaces, CLI connection points, templates, and default files.
- Brownfield concept extraction starts through `$check`: check report plus proposed `.krow` updates, with explicit user approval before the krow baseline changes.

Deferred questions:

- When should optional dependency or call-flow evidence become strict enough to affect planning or review?

## 17. Implementation Roadmap

Implement the roadmap in order, keeping each shipped slice end-to-end and reviewable.

Current implementation focus:

1. define the runtime bootstrap contract for `krow init`
2. define the Markdown document contract
3. create the concrete reference example
4. validate that the expected Review Report can be derived from embedded links

Then extend runtime behavior until krow can:

1. initialize the runtime files and agent instruction surfaces
2. retrieve those documents
3. validate terminology
4. request PRD approval
5. request Plan approval
6. generate tests from Examples
7. report the derived links back to the user
