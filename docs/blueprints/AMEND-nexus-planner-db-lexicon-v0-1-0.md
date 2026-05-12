# Amendment — Planner DB Lexicon Transformer V1 (JSON fixture)
# Version: v0.1.0 (DRAFT — pending owner ratification)
# Date: 2026-05-12
# Status: DRAFT — Phase A (Law resolution). No code. Spec-only.
# Amends:
#   AMEND-nexus-blueprint-orch-v1-1-1.md §11.4 (Planner socket law) — registers a new pluggable PlannerFactory under the existing socket
#   AMEND-spec-nexus-orch §2 (Planner Socket Interface) — names the new plannerType
# References:
#   /mnt/c/Users/AdLibitumVita/Downloads/nexus-db-lexicon-transformer-outline-v0-1-0.md (owner outline)
#   AMEND-nexus-mailbox-pit-v0-2-1.md (planner output flows through the per-actor pit)
# Author: Claude (deterministic build agent), under owner direction
# Owner: James Huson / Lake Area LLC
# HEAD pin at draft time: fdc6734 (mailbox-pit V1 closure complete)

---

## §0 Canonical Law Alignment

This amendment introduces a new pluggable planner implementation under the
existing Planner socket. It does NOT amend the Planner interface contract
itself (no changes to `Planner`, `PlannerRequest`, `ExecutionPlan`,
`PlannerFactory` — those remain authoritative per AMEND-spec-nexus-orch §2).
It DOES introduce a new `plannerType` value (`db-lexicon-transformer-v0`)
and the V1 data-layer + algorithm law that implementation must obey.

### §0.1 Preserved from AMEND-nexus-blueprint-orch-v1-1-1.md §11.4 (planner authority bounds)

These laws remain unchanged under the lexicon planner:

- Planner MAY reject for orchestration feasibility reasons.
- Planner MUST NOT perform authorization, risk adjudication, policy
  denial, OCT enforcement, or substitute for NXS/NVG decisions.
- Planner uses identity-provider capability ceiling as catalog
  visibility filter only — never as authorization.
- Coordinator validates planner output BEFORE plan_created, delegation,
  mailbox allocation, or dispatch.
- Anti-recursion law: governance denials on planner output do NOT
  re-trigger replan.

### §0.2 Preserved from AMEND-spec-nexus-orch §2 (Planner socket)

- `Planner.plan(request, context): Promise<ExecutionPlan | PlanRejection>`
  is the only entry point.
- `PlannerFactory` is registered with `plannerType: NonEmpty` and
  resolves the active planner from the orchestrator manifest.
- `PlannerRequest` is a visibility-safe union (`normal | metadata |
  oct_secure`); the lexicon planner MUST honor visibility (no OCT-secure
  prompt content is ever stored in or queried against the lexicon DB).

### §0.3 NOT superseded

Nothing is superseded. The reference deterministic planner
(`plannerType: 'ref-deterministic'`) remains the default. The lexicon
planner is an optional sibling.

---

## §0.4 What this spec DOES build

A **PlannerFactory** registered under `plannerType: 'db-lexicon-transformer-v0'`
that:

1. Loads its lexicon tables from signed JSON fixtures at bootstrap.
2. Implements the `Planner` interface.
3. Transforms a `NormalPlannerRequest` (with `prompt`) into a multi-node
   `ExecutionPlan` (via the existing `planFromSubTasks` shape — same
   `SubTaskDecl[]` + `SubTaskEdgeHint[]` the ref planner already accepts).
4. Records an audit `planner_plan_trace` record (Run Ledger event) per
   plan, capturing the lexical-match → capability-mapping →
   workflow-template chain that produced the plan.
5. Falls back to `PlanRejection` (NOT to LLM, NOT to ref-deterministic)
   when ambiguous.

V1 is **JSON-fixture-only** per owner outline §8.2. The 10 tables are
loaded as in-memory read-only structures at bootstrap. No SQLite, no
runtime mutation, no admin write path. SQLite + admin path are V2/V3.

---

## Scope Statement

The DB Lexicon Transformer V1 occupies the existing Planner socket as
a plug-in alternative to the reference deterministic planner. Same
interface, same output type, same coordinator-validation handoff. The
only difference is HOW it decomposes a prompt into sub-tasks: via the
lexicon tables, not via the ref planner's selectedAgentIds /
requiredCapabilities shortcuts.

**In scope (V1):**
- 10-table JSON-fixture data model (per outline §9.1)
- Layer A–E mapping algorithm (per outline §5)
- Planner implementation in `packages/planners/db-lexicon/`
- `PlannerFactory` registered for `plannerType: 'db-lexicon-transformer-v0'`
- Bootstrap fixture loader with signature verification (Ed25519, same
  signing chain as compile-ref templates + governed-verb-lexicon)
- `planner_plan_trace` Run Ledger event for explainability
- Unit tests + one integration test exercising the warehouse worked
  example end-to-end through `RefRunCoordinator` with this planner
  selected

**Out of scope (V1):**
- SQLite read model (V2)
- Admin-managed lexicon apply path (V3)
- Learning / feedback (V4 — not approved)
- Replacing Gate 02 lexicon (Gate 02 remains authoritative for verb
  risk classification; the planner lexicon is advisory at plan-time)
- LLM-assisted planning (separate amendment: on-prem-llm-planner-v0)
- Full inference DB, safetensor ingestion, model recomposition, etc.
  (owner outline §8.6)

---

## §1 Problem Statement

### §1.1 The current planner's gap

`RefDeterministicPlanner` in `packages/orch-ref/src/ref-deterministic-planner.ts`
accepts two request shapes:

1. **Legacy single-prompt**: `(selectedAgentIds, requiredCapabilities,
   edgeHints)` — workspace pre-resolves which agents + capabilities.
   Planner produces one node per resolved agent.
2. **Multi-node sub-task**: `(subTasks, subTaskEdges)` — caller supplies
   the full DAG decomposition. Planner just stamps the right nodeType
   per `kind: 'nvg' | 'nxs' | 'secure_handoff'`.

Neither path decomposes a NATURAL-LANGUAGE prompt. The workspace must
hand the planner one of:
- An agent the user pre-selected (legacy path), OR
- A fully-resolved sub-task DAG (multi-node path).

Today nothing in the runtime can produce a sub-task DAG from a
sentence. The previously-discovered drift (Memory:
`project_orch_planner_drift_2026_05.md`) was the ref planner falling
back to `nvg_dispatch` with LLM tool descriptors. Mailbox-pit V1
closed the symptom; the lexicon planner closes the root cause by
producing real `subTasks + subTaskEdges` from the prompt.

### §1.2 Where the lexicon planner fits

```
workspace prompt
    ↓
RefRunCoordinator.handleRun
    ↓
buildPlannerRequest → NormalPlannerRequest { prompt, ... }
    ↓
deps.planner.plan(request, context)         ← CURRENTLY: RefDeterministicPlanner
                                              FUTURE:     DbLexiconTransformerPlanner
    ↓
ExecutionPlan { nodes, edges, ... }
    ↓
validateExecutionPlan (14 checks + Check 15 slotBindings)
    ↓
mailbox-pit allocation (per-actor mailboxes)
    ↓
delegation_issued + dispatchToGovernance per node
```

The lexicon planner slots in at the same boundary. Coordinator validation
is unchanged. Mailbox-pit allocation is unchanged. Every governance
check downstream is unchanged.

---

## §2 Architecture

### §2.1 The 10 tables (per outline §9.1)

Each table is a JSON array of records loaded from a signed fixture at
bootstrap. The on-disk shape is `JSON Lines` (one JSON record per line)
inside a signed envelope, same convention as `governed-verb-lexicon.v1.json`.

| Table | Purpose | Record shape (V1) |
|---|---|---|
| `planner_lexical_term` | Raw term → canonical term + phrase class | `{ rawTerm, canonicalTerm, phraseClass: 'verb' \| 'noun' \| 'business_phrase', source }` |
| `planner_alias_rule` | Mapping decisions (approved / blocked / review-required) | `{ rawTerm, canonicalTerm, status: 'approved' \| 'blocked' \| 'review_required', reason }` |
| `planner_task_intent` | Canonical task intent identifiers | `{ intentId, name, description }` |
| `planner_task_capability` | Intent → required capability set | `{ intentId, requiredCapabilities: string[] }` |
| `planner_target_catalog` | Business term → target system/resource | `{ businessTerm, system, resourceType, resourceScope }` |
| `planner_agent_capability` | Agent capability index (projection over actor-registry) | `{ agentId, capabilities: string[], octTier, environment, enabled }` |
| `planner_workflow_template` | Named workflow templates | `{ templateId, name, description, intentId, nodeIds: string[] }` |
| `planner_workflow_node` | Template node definition | `{ templateId, nodeKey, capability, kind: 'nxs' \| 'nvg' \| 'secure_handoff', expectedOutputSlots: string[] }` |
| `planner_workflow_edge` | Template edge | `{ templateId, sourceNodeKey, targetNodeKey, edgeType, outputSlotRef? }` |
| `planner_plan_trace` | Explainability log (NOT loaded; written at plan time as a Run Ledger event) | (see §3.4.5) |

`planner_plan_trace` is the only "table" that isn't a fixture — it's
ledger-event output. Naming preserved to match the outline's
table-shaped vocabulary.

### §2.2 Canonical fixture format

One file per table under `fixtures/planner/db-lexicon/`:

```
fixtures/planner/db-lexicon/
├── planner-lexical-term.v1.jsonl
├── planner-alias-rule.v1.jsonl
├── planner-task-intent.v1.jsonl
├── planner-task-capability.v1.jsonl
├── planner-target-catalog.v1.jsonl
├── planner-agent-capability.v1.jsonl      (projection — see §2.3)
├── planner-workflow-template.v1.jsonl
├── planner-workflow-node.v1.jsonl
└── planner-workflow-edge.v1.jsonl
```

Each file's first line is a signed header: `{ schemaVersion, signedAt,
recordCount, contentDigest, signature }`. Subsequent lines are records.
Bootstrap validator + signature verifier mirror the pattern used by
`governed-verb-lexicon.v1.json` + the compile-ref signed fixtures.

Owner decision §10.3 confirmed below: V1 path is `fixtures/planner/db-lexicon/`,
NOT `config/planner/` (which is for V2+ signed config under the admin
apply path).

### §2.3 Agent capability projection — read-time, not fixture-time

`planner_agent_capability` is the one "table" that DOES NOT have a
standalone fixture in V1. It's projected at plan-time from the live
`ActorRegistry` (`packages/contracts/src/interfaces/index.ts` →
`Actor.allowedCapabilities + allowedSystems + octLevel + environment +
enabled`). The lexicon planner reads the registry via `PlannerContext.registry`
(the existing `AgentRegistryReader`) and constructs the index in
memory.

This avoids drift: there is no separate "agent registry for planner"
file that could disagree with the live registry. The lexicon table
naming preserves the outline's shape; the implementation reads through
the existing socket.

### §2.4 Consumes Gate 02 lexicon, does NOT duplicate

The existing Gate 02 governed verb lexicon
(`fixtures/lexicon/governed-verb-lexicon.v1.json`) is the canonical
verb taxonomy for risk classification. The planner lexicon's
`planner_lexical_term` records that classify as `phraseClass: 'verb'`
MUST reference canonical verbs from the Gate 02 lexicon — they are NOT
free to define their own verb canonical forms.

Build-time validation (§9.1 test): for every record in
`planner-lexical-term.v1.jsonl` with `phraseClass: 'verb'`, the
`canonicalTerm` MUST appear in `governed-verb-lexicon.v1.json`. The
planner lexicon may add NEW verbs only if the corresponding governed
verb fixture also adds them (cross-fixture invariant).

Capability IDs in `planner_task_capability.requiredCapabilities` and
`planner_workflow_node.capability` MUST match a known capability in
the canonical capability registry
(`packages/core/src/classification/capability-registry.ts`). Same
validation principle.

---

## §3 Surface

### §3.1 Planner factory registration

A new `PlannerFactory` implementation lives in
`packages/planners/db-lexicon/src/db-lexicon-planner.factory.ts`:

```typescript
export class DbLexiconTransformerPlannerFactory implements PlannerFactory {
  readonly plannerType: NonEmpty = 'db-lexicon-transformer-v0' as NonEmpty;
  readonly plannerVersion: NonEmpty = '0.1.0' as NonEmpty;
  create(config: PlannerConfiguration): Planner;
}
```

The factory is registered with the existing `PlannerFactoryRegistry`
at bootstrap (alongside the ref-deterministic factory). Activation is
governed by `OrchestratorManifestRecord.plannerType` — the runtime
selects the active planner from the manifest, so changing planners is
a manifest decision, not a code decision.

### §3.2 Planner implementation surface

```typescript
export class DbLexiconTransformerPlanner implements Planner {
  readonly plannerType: NonEmpty = 'db-lexicon-transformer-v0' as NonEmpty;
  readonly plannerVersion: NonEmpty = '0.1.0' as NonEmpty;

  constructor(
    private readonly lexiconTables: LexiconTablesV1,
    private readonly computeDigest: (obj: unknown) => Sha256Hex,
    private readonly orchestratorActorId: Uuid,
    private readonly ledgerWriter: RunLedgerWriter
  ) {}

  async plan(request: PlannerRequest, context: PlannerContext): Promise<ExecutionPlan | PlanRejection> {
    // 1. Tier dispatch (normal / metadata / oct_secure) — same shape as ref planner
    // 2. For normal: run §3.3 algorithm against request.prompt
    // 3. For metadata: skip the prompt path; use request.requiredCapabilities
    //    + request.taskShape to look up a workflow template
    // 4. For oct_secure: produce single-node secure_handoff (same as ref planner)
    // 5. Emit planner_plan_trace event with the lexical chain
    // 6. Return ExecutionPlan or PlanRejection
  }
}
```

### §3.3 Mapping algorithm (Layer A–E, owner outline §5)

For a NormalPlannerRequest with `prompt`:

**Layer A — Governed inputs (read-only):**
- `request.prompt`, `request.principalId`
- `context.registry` (AgentRegistryReader — live registry)
- `context.capabilityCeiling` (catalog visibility filter)
- `context.maxSplitDepth`
- The 10 lexicon tables (in-memory)

**Layer B — Lexical resolver:**
- Tokenize prompt; lemmatize using existing `LexicalNormalizer`
- For each token / business phrase, look up `planner_lexical_term`
- For ambiguous mappings, consult `planner_alias_rule` (approved /
  blocked / review-required)
- Output: a set of `(canonicalTerm, phraseClass)` candidates

**Layer C — Capability transformer:**
- From canonical terms, identify `planner_task_intent` candidates
- For each intent, look up required capabilities via
  `planner_task_capability`
- For each target term (noun / business phrase), look up
  `planner_target_catalog` to get `(system, resourceType, resourceScope)`

**Layer D — Workflow / DAG expander:**
- Match the intent to a `planner_workflow_template` (or compose nodes
  from `planner_workflow_node` if no template matches the full intent)
- For each template node, find a candidate agent via
  `AgentRegistryReader.findByCapability` (capability is the join key)
- Filter agents by `context.capabilityCeiling` (catalog visibility)
- Build `SubTaskDecl[]` from template nodes:
  - `kind: 'nxs'` if the node's `capability` resolves to a system
    action (write to target, read from target)
  - `kind: 'nvg'` if the node summarizes / transforms (no target system)
  - `kind: 'secure_handoff'` for cross-OCT redaction nodes
- Build `SubTaskEdgeHint[]` from template edges

**Layer E — Plan scorer + emit:**
- Score the candidate DAG against:
  - All required capabilities have at least one visible candidate agent
  - No `planSize > context.maxSplitDepth`
  - No nodes with both `requiresNvg` and `requiresNxs` (handled by
    SubTaskDecl kind)
  - Plan validates structurally
- If valid: emit ExecutionPlan
- If ambiguous (multiple workflow templates match equally well, or
  required capability has no visible agent, or alias rule says
  `review_required`): emit `PlanRejection` with `reason: 'no_capable_agent'`
  or `'ambiguous_intent'`, plus `suggestedAlternatives` from the
  candidate set

### §3.4 New Run Ledger event — `planner_plan_trace`

Fires once per plan attempt (success OR rejection). Records the
lexical chain so audit can reconstruct WHY the planner chose this
plan.

Detail shape:

```typescript
{
  runId: Uuid,
  plannerType: 'db-lexicon-transformer-v0',
  plannerVersion: '0.1.0',
  promptDigest: Sha256Hex,           // promptDigest, not raw prompt
  lexicalMatches: ReadonlyArray<{
    rawTerm: string,
    canonicalTerm: string,
    phraseClass: 'verb' | 'noun' | 'business_phrase',
    aliasRule?: 'approved' | 'blocked' | 'review_required',
  }>,
  candidateIntents: NonEmpty[],
  selectedIntent: NonEmpty | null,
  candidateTemplates: NonEmpty[],
  selectedTemplate: NonEmpty | null,
  requiredCapabilities: NonEmpty[],
  candidateAgents: ReadonlyArray<{
    capability: NonEmpty,
    agentIds: Uuid[],
  }>,
  planOutcome: 'plan_created' | 'plan_rejected_ambiguous' | 'plan_rejected_no_capable_agent' | 'plan_rejected_capability_outside_ceiling',
  rejectionReason: string | null,
  emittedAt: IsoTimestamp,
}
```

The event MUST NOT contain raw prompt text — only `promptDigest` for
correlation with the workspace-level `run_opened` event (which holds
the prompt digest, NOT the prompt itself, per blueprint §11.5.1).

`planner_plan_trace` is added to `RunEventType` in contracts as
ADD-PLANNER-LEXICON-001.

### §3.5 Manifest changes

`OrchestratorManifestRecord.plannerType` (existing field) supports the
new value `'db-lexicon-transformer-v0'`. To enable, an operator changes
the manifest from `plannerType: 'ref-deterministic'` to
`plannerType: 'db-lexicon-transformer-v0'` and re-signs.

`OrchestratorManifestRecord.plannerConfiguration` (existing object
field) gains optional V1 fields:

```typescript
plannerConfiguration: {
  // db-lexicon-transformer-v0 specific (all optional; defaults sensible)
  lexiconFixtureRoot?: NonEmpty;           // default: 'fixtures/planner/db-lexicon/'
  defaultRejectionMode?: 'ambiguous' | 'strict_first_match';  // default: 'ambiguous'
  // ... other planners ignore these fields
}
```

V1 does NOT mutate the manifest type itself — `plannerConfiguration:
Record<string, unknown>` already accepts arbitrary keys per planner. The
field names are pinned by this spec.

---

## §4 Lifecycle

### §4.1 Bootstrap (offline fixture load)

Insertion point: between Step 18 (signed manifest validation) and Step
20 (output collector wiring) in `nexus-bootstrap.ts`. The factory
registry is constructed earlier; the lexicon tables are loaded once
when the db-lexicon planner is selected by the manifest.

```
Step 18a (NEW): if manifest.plannerType === 'db-lexicon-transformer-v0':
                load + verify lexicon fixtures from
                manifest.plannerConfiguration.lexiconFixtureRoot
                (or default path). Verify each file's signed header.
                Validate cross-fixture invariants (§2.4).
                Construct in-memory LexiconTablesV1 record.
                Stash on bootstrap context for the factory.
```

Fixture load failure (missing file, invalid signature, schema
violation, cross-fixture invariant violation) is FAIL-CLOSED at
bootstrap — the server does not start with a broken planner.

### §4.2 Runtime (per plan call)

The Planner.plan call is purely a read against the in-memory tables +
the registry. No I/O at plan time (the fixture is loaded once).
`planner_plan_trace` is the only write — it goes to the Run Ledger
via the injected `RunLedgerWriter`.

### §4.3 Shutdown / hot-reload

V1 has no hot-reload. To change the fixture, restart the server. V3
(admin-managed) introduces signed apply paths; not in V1.

---

## §5 Mapping from request to plan — worked example

Input (warehouse worked example from prior session):

> "Pull the warehouse inventory for product A, adjust it +2 from receiving today."

Step-by-step trace:

| Stage | Lookup | Result |
|---|---|---|
| Lexical match — verb | `pull`, `adjust` | `read.target`, `update.target` (canonical) |
| Lexical match — noun | `inventory`, `product A` | `inventory_row` (target), `product_id=A` (filter param) |
| Lexical match — business phrase | `from receiving today` | `receiving_delta` (intent operand) |
| Task intent | `read.target + update.target + receiving_delta` | `inventory.adjust_from_receiving` |
| Required capabilities | `inventory.adjust_from_receiving` | `[read:warehouse:inventory, write:warehouse:inventory]` |
| Target catalog | `inventory_row` | `system: warehouse, resourceType: inventory, resourceScope: product_a` |
| Workflow template | `inventory.adjust_from_receiving` | `workflow_inventory_adjust_from_receiving_v1` |
| Template nodes | (3 nodes) | `read_inventory (nxs)`, `compute_adjusted_units (nvg)`, `write_inventory (nxs)` |
| Template edges | data_dependency chain | read → adjust, adjust → write |
| Agent assignment | each node's capability vs registry | warehouse-agent matches all three (single-agent multi-node) |
| Plan output | (full DAG) | 3-node ExecutionPlan |

The output plan is what the user's earlier session sketched
informally: `[nxs_read → nvg_adjust → nxs_write]`. The slot-binding
contract from mailbox-pit V1 allows the third node's `actionTemplate`
to reference the second node's output slot. The mailbox-pit
allocation step gives each (run, agent) pair its mailbox. The compile
pass-through (or templated) emits the final response.

---

## §6 Migration & Coexistence

### §6.1 Coexistence with ref-deterministic

Both planners ship in V1. The active planner is selected by the
manifest's `plannerType` field — exactly the same mechanism that
already selects compile mode, mailbox backend, etc. No ripple to other
contracts.

### §6.2 Defaulting

V1 default: `plannerType: 'ref-deterministic'`. The lexicon planner is
OPT-IN per orchestrator manifest. Owner can flip the default in V2 or
when fixture coverage is broad enough.

### §6.3 Fallback law (HARD — owner outline §12 rule 9)

The lexicon planner MUST NOT fall back to LLM planning. If it cannot
resolve the prompt, it returns `PlanRejection` and the run is closed
by the coordinator. NO hidden LLM call. NO silent ref-deterministic
fallback. The operator can manually switch the manifest if they want
ref-deterministic for a class of prompts.

---

## §7 What Stays Unchanged

- The `Planner`, `PlannerRequest`, `PlannerFactory`, `PlannerContext`
  contracts. (Stable since AMEND-spec-nexus-orch §2.)
- The `ExecutionPlan` shape (V1 emits the SAME `subTasks` + `subTaskEdges`
  decomposition the ref planner accepts on its multi-node path).
- `validateExecutionPlan` (14 + 1 checks). The lexicon planner produces
  plans that pass these — same coordinator trust boundary.
- The reference deterministic planner. Untouched.
- Gate 02 governed-verb-lexicon (the planner lexicon REFERENCES it but
  does not duplicate or override).
- Capability registry (the planner lexicon REFERENCES it).
- The mailbox-pit allocation step. The new planner produces plans with
  unique agentIds the same way ref-deterministic does; coordinator
  step 3.6 allocates per-actor mailboxes identically.

---

## §8 Out of Scope (Future Amendments)

Per owner outline §8.3–§8.6 + §13:

- **V2** — SQLite read model with same data shape, signed fixture load.
  Same `plannerType` value (`db-lexicon-transformer-v0`); only the
  storage substrate changes. Out of V1.
- **V3** — Admin-managed lexicon (signed admin apply path; dashboard
  proposes changes; signed audit events). Out of V1.
- **V4** — Learning from run outcomes. NOT APPROVED until owner
  ratification (outline §8.5).
- LLM-assisted planning (on-prem-llm-planner-v0): separate amendment.
- Replacing NVG/NXS/Gate 02: explicitly forbidden by outline §8.6 + §12.
- Direct planner write to its own DB at runtime: forbidden by outline
  §12 rule 3. V1 is offline-loaded only.
- Self-training: outline §12 rule 13.

---

## §9 Test Plan

### §9.1 New unit tests (`packages/planners/db-lexicon/src/*.test.ts`)

- Fixture loader — happy path, missing file, invalid signature, schema
  violation, cross-fixture invariant (planner verb not in Gate 02
  lexicon), empty fixture set.
- Lexical resolver — exact match, alias-mapped match, blocked alias,
  review-required alias, unmatched term.
- Capability transformer — intent → capabilities, target catalog
  lookup, multi-intent disambiguation.
- Workflow expander — single-template match, multi-template ambiguity
  (returns PlanRejection ambiguous_intent), no-template-match (returns
  PlanRejection no_capable_agent).
- Agent assignment — single-agent multi-node, multi-agent multi-node,
  capability outside ceiling (rejection with suggestedAlternatives).
- Plan emission — well-formed `ExecutionPlan` that passes
  `validateExecutionPlan` 14+1 checks.
- `planner_plan_trace` event — fires on every plan attempt (success
  AND rejection); detail shape complete; promptDigest correct.

### §9.2 New integration test (`packages/planners/db-lexicon/src/db-lexicon-planner.integration.test.ts`)

- Construct `RefRunCoordinator` with `DbLexiconTransformerPlanner` as
  the planner.
- Feed the warehouse worked-example prompt as a `NormalPlannerRequest`.
- Assert: `ExecutionPlan` emitted with 3 nodes (nxs_read, nvg_adjust,
  nxs_write).
- Assert: coordinator step 3.6 allocates per-actor mailbox for
  warehouse-agent.
- Mock connector + LLM transport. Run end-to-end.
- Assert: `run_closed completed`. `planner_plan_trace` event present.

### §9.3 Cross-fixture invariant test (`tests/lexicon/`)

- Validate every `phraseClass: 'verb'` canonicalTerm in
  `planner-lexical-term.v1.jsonl` exists in
  `governed-verb-lexicon.v1.json`.
- Validate every `requiredCapabilities` ID in
  `planner-task-capability.v1.jsonl` exists in the canonical capability
  registry.
- Validate every `system` in `planner-target-catalog.v1.jsonl` exists
  in the connector manifest.

### §9.4 Acceptance criteria

- `pnpm ci:gate` 80/80 green (the new planner package adds no
  ci:gate step in V1 — covered by general typecheck + tests).
- `pnpm vitest run` all green.
- `pnpm vitest -c vitest.integration.config.ts` all green.
- Live serve with `plannerType: 'db-lexicon-transformer-v0'` in the
  orchestrator manifest produces a valid plan for the warehouse worked
  example.

---

## §10 Owner Decisions Needed

1. **Confirm `plannerType` string** = `db-lexicon-transformer-v0`. (Outline §14.1 — owner asked.)
2. **Confirm V1 fixture-only**, not SQLite-first. (Outline §14.2 — proposed V1 per §8.2.)
3. **Confirm fixture path** = `fixtures/planner/db-lexicon/`. (Outline §14.3 — three options.) Recommend `fixtures/planner/db-lexicon/` — keeps V1 next to existing `fixtures/lexicon/` (Gate 02) and `fixtures/compile-ref/`.
4. **Confirm package location** = `packages/planners/db-lexicon/`. (Outline §14.4 — orch-ref vs separate package.) Recommend separate package — keeps planner pluggable + cleaner imports + matches outline §15 "long-term safe shape."
5. **Dashboard "draft fixture export"** = NO for V1. (Outline §14.5.) Defer to V3 admin apply path.
6. **V4 learning ban until ratification** = YES. (Outline §14.6.) Already captured in outline §8.5 + §12 rule 13.
7. **`planner_plan_trace` Run Ledger event name** = `planner_plan_trace`. Approve naming.

---

## §11 Risks

- **Fixture content correctness.** V1 is only as useful as the
  fixtures. A sparse fixture → most prompts return `PlanRejection`,
  which is correct but unhelpful. Mitigation: V1 ships with fixtures
  covering the warehouse worked example end-to-end + 2-3 other shapes.
  Coverage expansion is a fixture-author task, not a code task.
- **Cross-fixture drift between planner lexicon and Gate 02 lexicon /
  capability registry.** Mitigated by §2.4 build-time invariants + §9.3
  ci-gate test.
- **Agent registry projection staleness.** If the live `ActorRegistry`
  has agents the planner doesn't see (race during registry mutation),
  the planner might emit `no_capable_agent` falsely. Mitigated by
  reading the registry through the existing `AgentRegistryReader`
  interface (same projection ref-deterministic uses).
- **Ambiguity surface.** Multiple workflow templates matching the same
  prompt cause `ambiguous_intent` rejection. V1 ships with
  `defaultRejectionMode: 'ambiguous'` (fail-closed). Operators can
  switch to `strict_first_match` per manifest if they want a "first
  template wins" fallback — but this is opt-in, NOT a default.
- **promptDigest exposure.** The `planner_plan_trace` event carries
  promptDigest, which links the trace to the raw prompt held only in
  the workspace session. Audit consumers should treat the trace as
  metadata-tier, not prompt-tier.
- **Planner exhausts maxSplitDepth.** Long workflows could exceed the
  manifest's `maxSplitDepth`. Mitigated by §3.3 Layer E validation —
  plans that exceed depth return `PlanRejection: max_split_exceeded`.

---

## §12 Logs to open at build time

```
ADD-PLANNER-LEXICON-001 | spec: §3.4 | RunEventType union | New event `planner_plan_trace` — fires once per plan attempt (success or rejection) for explainability audit | required for outline §12 rule 14 (no claim that DB planner is a certified authority — trace IS the proof) | downstream: ledger viewer UI, run-timeline | pending build phase

ADD-PLANNER-LEXICON-002 | spec: §3.1 | PlannerFactoryRegistry | New PlannerFactory implementation for plannerType 'db-lexicon-transformer-v0' | required for opt-in via manifest | bootstrap step 18a addition | pending build phase

ADD-PLANNER-LEXICON-003 | spec: §2.2 | New fixture directory structure | fixtures/planner/db-lexicon/*.v1.jsonl signed by control-plane key | required for V1 lexicon load | requires signing script (sign-planner-lexicon-fixtures.sh) | pending build phase

DIFF-PLANNER-LEXICON-001 | spec: §6.3 | outline §12 rule 9 (no hidden fallback) | The planner MUST NOT fall back to LLM or ref-deterministic on rejection. Coordinator surfaces PlanRejection to the workspace as a user-facing error | owner-clarified pattern: rejections are surfaces, not recoveries | open, V1-accepted

HOLE-PLANNER-LEXICON-001 (potential) | spec: §3.3 Layer B | Tokenization + lemmatization quality | V1 uses the existing `LexicalNormalizer`. If real-world prompts exhibit casing / synonym / multi-word-phrase patterns LexicalNormalizer doesn't handle, planner coverage suffers. Build phase will validate against the warehouse worked example + 2-3 others; broader coverage is fixture-author work | open, monitor during V1 fixture authoring
```

---

## §13 What this spec does NOT change

- No new contract types beyond `planner_plan_trace` event detail.
- No changes to the `Planner` interface.
- No changes to `ExecutionPlan` or any of its sub-types.
- No changes to `validateExecutionPlan`.
- No changes to mailbox-pit V1.
- No changes to compile or its bypass partials.
- No changes to NVG / NXS / Gate 02 / OCT enforcement.

The lexicon planner is a STRICTLY ADDITIVE plug-in. It can be enabled
or disabled by the manifest with zero ripple to the rest of the stack.
