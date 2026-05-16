# Amendment — Planner DB Lexicon Transformer V1 (JSON fixture)
# Version: v0.2.1 (post-audit-pass-3 revision; supersedes v0.2.0)
# Date: 2026-05-13
# Status: SHIPPED — Phase D complete across commits bc9485f..d8ff27d. Frontmatter updated 2026-05-15.
# Supersedes: docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-0.md
# Amends:
#   AMEND-nexus-blueprint-orch-v1-1-1.md §11.4 (Planner socket law) — registers a new PlannerFactory under the existing socket
#   AMEND-spec-nexus-orch §2 (Planner Socket Interface) — names the new plannerType
#   AMEND-spec-nexus-orch §4.3, §4.4 — builds the real PlannerFactoryRegistry
#   AMEND-nexus-spec-orch-v1-1-1.md (parent orch spec) — 9 references updated in same arc (Commit 7)
#   AMEND-spec-nexus-infra-externals-v0-2-5.md — maxSplitDepth ≤ 1 V1 law updated to plannertype-scoped (Commit 7)
#   AMEND-blueprint-nexus-infra-externals-v1-0-0.md — example maxSplitDepth value updated (Commit 7)
# References:
#   /mnt/c/Users/AdLibitumVita/Downloads/nexus-db-lexicon-transformer-outline-v0-1-0.md (owner outline)
#   AMEND-nexus-mailbox-pit-v0-2-1.md (planner output flows through the per-actor pit)
# Author: Claude (deterministic build agent), under owner direction
# Owner: James Huson / Lake Area LLC
# HEAD pin at draft time: 098b20a

---

## §0 Canonical Law Alignment

This amendment introduces a new `Planner` implementation under the
existing Planner socket and **REPLACES** the in-tree
`RefDeterministicPlanner` scaffolding. It does NOT amend the `Planner`,
`PlannerRequest`, or `ExecutionPlan` contract interfaces. It DOES
admit two ADDITIVE, BACKWARD-COMPATIBLE contract additions — one new
optional field on `OrchestratorPlanPreview`, one new optional field on
`WorkspaceRunRequest`, plus the new `RejectionCheckbackPayload` interface
that the new field carries (see §13). It introduces a new `plannerType`
value (`db-lexicon-transformer-v0`), the V1 data-layer + algorithm law
that implementation must obey, the four-branch tier dispatch the new
planner must implement to subsume the existing class's production
paths, and the preflight/checkback feasibility loop that turns operator
preferences into validated plans (or rejection + counter-suggestion).

### §0.1 Preserved from AMEND-nexus-blueprint-orch-v1-1-1.md §11.4

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

### §0.2 Preserved from AMEND-spec-nexus-orch §2

- `Planner.plan(request, context): Promise<ExecutionPlan | PlanRejection>`
  is the only entry point. **Return type is UNCHANGED in v0.2.1**
  (per audit pass 3 Condition 1 / F01 resolution — trace is exposed
  via a separate `PlannerTraceReader` interface on the planner instance,
  not via the return wrapper; §3.2).
- `PlannerFactory` is registered with `plannerType: NonEmpty` and
  resolves the active planner from the orchestrator manifest.
- `PlannerRequest` is a visibility-safe union (`normal | metadata |
  oct_secure`); the lexicon planner MUST honor visibility.

### §0.3 The lexicon planner IS the reference planner

V1 ships **one** Planner implementation, registered under
`plannerType: 'db-lexicon-transformer-v0'`. The previous
`RefDeterministicPlanner` was scaffolding so downstream work (mailbox-pit,
compile, slot-binding) could proceed; the production cut replaces it.
This amendment:

- Deletes `RefDeterministicPlanner` class + dedicated tests after the
  lexicon planner proves parity (§6.2 Commit 6).
- Extracts ~70% of the old class — plan-assembly machinery, digest
  computation, `evaluateCondition` / `determineNodeType`, validation
  helpers — into shared modules consumed by the new planner.
- Folds the four production request paths the old class served into
  the new planner's tier dispatch (§3.3). No operator capability lost.
- Closes the orchestrator production gap end-to-end: lexicon actually
  lexicons (no stub), checkback actually calls back (with payload
  the UI can drive — see §0.4 contract additions), factory registry
  actually wires.

### §0.4 What this spec DOES build

A **PlannerFactory** registered under `plannerType: 'db-lexicon-transformer-v0'`
that:

1. Loads its lexicon tables from signed JSON-Lines fixtures at bootstrap
   (one-time load — see §4.1; factory does NOT re-load).
2. Implements the `Planner` interface (return type UNCHANGED) with
   **four-branch tier dispatch** (§3.3) — oct_secure / pre-resolved
   subTasks / preferred-agents preflight / lexical decomposition.
3. Implements an additional `PlannerTraceReader` interface (new V1
   contract addition) exposing `getLastTrace()` for the coordinator to
   read the trace payload after each `plan()` call. Planner has zero
   `RunLedgerWriter` references.
4. Transforms a `NormalPlannerRequest` with prompt-only into a
   multi-node `ExecutionPlan` via Layer A–E lexical decomposition.
5. Transforms a `NormalPlannerRequest` with `selectedAgentIds` populated
   into either a validated plan using operator preferences OR a
   `PlanRejection` paired with a `RejectionCheckbackPayload` (new V1
   contract addition) populated from what the lexicon would have picked.
6. Adjudicates ONLY agent/capability feasibility — NOT model/endpoint
   selection (NVG's authority per existing architecture).
   `preferredEndpointId` flows through the trace but planner does not
   reject on it.
7. Has no fallback to LLM, no second factory, no cross-branch silent
   override (§6.3).

A concrete **`PlannerFactoryRegistry`** implementation in
`packages/core/src/manifest/planners/planner-factory-registry.ts` —
the contract interface in `packages/contracts/src/externals/factory-registries.ts`
has existed unused; V1 builds the real one.

**Three additive contract additions** (V1 contract surface):

- `OrchestratorPlanPreview.rejection?: RejectionCheckbackPayload | null`
  (optional new field; null on success paths, populated on rejection-
  with-suggestions paths).
- `WorkspaceRunRequest.checkbackSourceRunId?: Uuid | null` (optional
  new field; non-null when a run is re-issued via Accept-Suggestions
  flow correlating back to the original run).
- New interface `RejectionCheckbackPayload` carrying the executable
  counter-suggestion data the UI needs to drive Accept/Cancel.

All three are backward-compatible — existing consumers ignore the new
optional fields.

A new ledger event `planner_plan_trace` on `RunEventType` — coordinator-
written via the trace reader path (§3.6).

A minimal UI additive: `plan-checkback-modal.tsx` consuming
`OrchestratorPlanPreview.rejection` and dispatching Accept-Suggestions
(re-issue new run with corrected `selectedAgentIds`) or Cancel-Run.

A **package layer law** for `packages/planners/*` enforced by a new
ci:gate step (§6.5).

A parent-orch-spec amendment + an infra-externals spec/blueprint
amendment in the same arc (Commit 7).

V1 is **JSON-fixture-only**. SQLite + admin path are V2/V3.

### §0.5 Scope Statement

**In scope (V1):**
- 10-conceptual-table data model; 8 on-disk JSONL fixtures (per §2.2);
  `planner_agent_capability` is a runtime projection (§2.3)
- Layer A–E lexical decomposition (§3.3.4)
- Four-branch tier dispatch (§3.3)
- Preflight + checkback feasibility loop using new `RejectionCheckbackPayload`
  (§3.3.3, §3.7) — 2-way Accept/Cancel
- Planner implementation in `packages/planners/db-lexicon/`
- Package layer law enforced by ci:gate (§6.5, gate PLANNER-LEXICON-05)
- `DbLexiconTransformerPlannerFactory` registered under
  `plannerType: 'db-lexicon-transformer-v0'`
- Concrete `PlannerFactoryRegistry` implementation
- Bootstrap step 17b factory registry + factory registration
- Bootstrap step 18a fixture load + signature verification ONCE; factory
  constructor consumes pre-loaded `LexiconTablesV1`
- `planner_plan_trace` Run Ledger event (coordinator-written via
  `PlannerTraceReader.getLastTrace()`)
- `OrchestratorPlanPreview.rejection` additive field
- `WorkspaceRunRequest.checkbackSourceRunId` additive field
- `RejectionCheckbackPayload` interface
- Workspace UI minimal additive — Accept/Cancel modal
- Manifest update + re-sign: `orchestrators.v1.yaml` switches
  `plannerType`, `maxSplitDepth: 3`
- Loader policy amendment: `orchestrator-manifest-loader.ts` allows
  `maxSplitDepth ≤ 3` for `plannerType === 'db-lexicon-transformer-v0'`
- Parent orch spec amendment (9 references)
- Infra-externals spec amendment (maxSplitDepth law)
- Infra-externals blueprint amendment (example value)
- Deletion of `RefDeterministicPlanner` class + test file after parity
- Extraction of shared utilities to `condition-evaluator.ts` and
  `plan-assembly.ts` in `@nexus/orch-ref`
- **5 new ci:gate steps** with named IDs (PLANNER-LEXICON-01..05);
  numbering appended dynamically — no hard-coded step numbers in spec
- Unit + integration tests covering all four tier branches + the
  warehouse worked example

**Out of scope (V1):**
- SQLite read model (V2)
- Admin-managed lexicon apply path (V3)
- Learning / feedback (V4 — not approved)
- Replacing Gate 02 lexicon
- LLM-assisted planning (separate amendment)
- Three-way checkback ("Accept / Try anyway / Restart") — V2; requires
  new `bypassFeasibilityCheck` field
- Same-run resume on Accept-Suggestions — V2; V1 closes original run +
  opens new run with `checkbackSourceRunId`
- Multi-agent multi-model preferences in workspace UI (V2+)
- Capability-first metadata-tier planning (metadata-tier without
  `subTasks` AND without `selectedAgentIds` → `malformed_request`
  rejection in V1) — V2 may add
- Preferred model/endpoint adjudication by planner — NVG owns this
- Splitting orch-ref shared primitives to a dedicated `@nexus/orch-primitives`
  package or renaming `orch-ref` → `orch-runtime` — V2 logged as
  `THREAT-ORCH-REF-LAYER-001`
- Retro-signing `governed-verb-lexicon.v1.json` — V2 logged as
  `THREAT-LEXICON-SIGNING-001`

### §0.6 Changes from v0.2.0 (audit pass 3 ratifications)

Audit pass 3 delivered two audits (audit-5 with F01-F08 + M09-M12;
audit-6 with COND-1/2/3). 14 best-solve rows ratified by owner.
Specific spec text changes:

| Section | v0.2.0 said | v0.2.1 says | Audit-ratification |
|---|---|---|---|
| §0.2, §3.2 | Planner return type `Promise<ExecutionPlanWithTrace \| PlanRejectionWithTrace>` | Return type UNCHANGED `Promise<ExecutionPlan \| PlanRejection>`. Trace stashed on planner instance via new `PlannerTraceReader.getLastTrace()` interface; coordinator reads after `plan()` returns | Row 1 (F01 + COND-1) |
| §0.4, §3.3.3, §3.7, §13 | "No contract changes" (claim) | Two ADDITIVE backward-compatible contract additions: `OrchestratorPlanPreview.rejection?: RejectionCheckbackPayload \| null`; `WorkspaceRunRequest.checkbackSourceRunId?: Uuid \| null`; new `RejectionCheckbackPayload` interface | Row 2 (F03+F05) |
| §0.4, §6.5, §9.4 | (no package layer law existed) | NEW §6.5 — `packages/planners/*` MAY import `@nexus/contracts`, `@nexus/runtime-utils`, `@nexus/orch-ref` (V1 compromise); MUST NOT import core/vanguard/identity-ref/adapters/connectors/interfaces. Enforced by new ci:gate step PLANNER-LEXICON-05 | Row 3 (F02) |
| §3.7, §5.3 | "Workspace re-issues `WorkspaceRunRequest` with `selectedAgentIds` replaced" (same-run flow implied) | V1: workspace CLOSES original run with `run_closed { reason: 'user_accepted_checkback_reissued' }`; OPENS NEW run with `selectedAgentIds = preview.rejection.recommendedSelectedAgentIds` + new `checkbackSourceRunId = originalRunId` field. Same-run resume → V2 | Row 4 (F04) |
| §1.3, §3.3.3 | "frontier LLM for an on-prem task" mentioned as a preflight-catchable scenario | NARROWED — planner adjudicates **agent/capability feasibility only**. `preferredEndpointId` traced but not adjudicated. NVG owns endpoint selection per existing architecture memory | Row 5 (F06) |
| Frontmatter, §6.4, §6.2 Commit 7 | parent orch spec only | parent orch spec + `AMEND-spec-nexus-infra-externals-v0-2-5.md` + `AMEND-blueprint-nexus-infra-externals-v1-0-0.md` — all amended in same arc (option α) | Row 6 (F07) |
| §9.4 | "Step 81 ... Step 84"; "80 → 84/84" | Named gate IDs: `PLANNER-LEXICON-01` (fixture signature) ... `PLANNER-LEXICON-05` (package layer law). Spec does NOT hard-code step numbers; ci-gate script appends dynamically. Total step count is implementation detail of the script | Row 7 (F08) |
| §2.2 | "JSON.stringify with sorted keys" (incorrect — JSON.stringify doesn't sort) | Use `canonicalize()` from `@nexus/runtime-utils/canonicalize.ts` (already exists). `contentDigest = sha256(records.map(canonicalize).join('\n'))`. Record order preserved AS AUTHORED (part of signed payload; meaningful for readability + diff stability) | Row 8 (M09) |
| §4.1 | Bootstrap step 18a loads; factory `create()` "loads or re-verifies" (split ownership) | Bootstrap step 18a loads + verifies ONCE. Factory constructor takes pre-loaded `LexiconTablesV1`. Factory `create()` ONLY constructs the planner; does NOT load or re-verify | Row 9 (M10) |
| §6.2 Commit 1 | Extracted helpers as broad `@nexus/orch-ref` exports | V1 compromise: helpers exported from `@nexus/orch-ref` barrel; planner package allowed to import. Future cleanup (V2): extract to `@nexus/orch-primitives` package OR rename `@nexus/orch-ref` → `@nexus/orch-runtime`. Logged as `THREAT-ORCH-REF-LAYER-001` | Row 10 (M11) |
| §3.3 dispatch pseudocode | "MetadataPlannerRequest with no subTasks and no selectedAgentIds is malformed" (implied) | EXPLICIT: V1 metadata-tier requires either `subTasks` non-empty OR `selectedAgentIds` non-empty. Both empty → `PlanRejection: malformed_request`. Capability-first metadata planning (requiredCapabilities-only entry) → V2 | Row 11 (M12) |
| §2.4 | "canonicalTerm MUST appear in `governed-verb-lexicon.v1.json` as either a canonical verb or an approved alias's target" | **`ACTION_VERB` const is the canonical taxonomy.** Cross-fixture invariant targets `ACTION_VERB` membership directly (the canonical 13 verbs in `packages/contracts/src/constants/index.ts:26-40`). The lexicon fixture maps aliases → ACTION_VERB members (and the 13 ACTION_VERBs ALL appear as alias targets in the fixture — verified). ci:gate PLANNER-LEXICON-02 checks against ACTION_VERB | Row 12 (COND-2 with auditor correction) |
| §6.2 Commit 2 | "pnpm-workspace.yaml glob" | Explicit path: `'packages/planners/db-lexicon'`. Matches existing convention | Row 13 (COND-3) |
| §13 | "No contract changes" | Acknowledges the two additive optional fields + the new interface from row 2; otherwise unchanged | Row 14 |

Audit-6 COND-2 specific claim about `admin, import` being in the
governed-verb-lexicon fixture was found WRONG on verification (only
`invoke` is present, as an alias source mapping to `execute`; `admin`
and `import` do not appear in the file). The corrected position
preserves the audit's underlying concern (clarify which set is
authority) by naming ACTION_VERB as the canonical taxonomy.

---

## §1 Problem Statement

### §1.1 The current planner's gap

`RefDeterministicPlanner` in `packages/orch-ref/src/ref-deterministic-planner.ts`
(827 lines) accepts three request shapes today:

1. **Legacy single-prompt + selectedAgentIds**: workspace UI
   pre-resolves agents via dropdowns. Wired through
   `packages/interfaces/api/src/routes/workspace.ts:553,825` +
   `packages/interfaces/api/src/routes/orchestrator.ts:137`. This is
   the **primary production path** today.
2. **Multi-node sub-task DAG**: `(subTasks, subTaskEdges)`.
3. **OCT-secure single-node**: `tier === 'oct_secure'`.

What is missing today: nothing in the runtime can produce a sub-task
DAG from a natural-language sentence alone. The lexicon planner closes
the root cause by producing real `subTasks + subTaskEdges` from the
prompt **AND** continuing to honor the other two production paths via
tier dispatch.

### §1.2 Where the lexicon planner fits — four-branch tier dispatch

```
workspace prompt + (optional) operator preferences
    ↓
RefRunCoordinator.handleRun
    ↓
buildPlannerRequest → PlannerRequest
    ↓
deps.planner.plan(request, context)         ← DbLexiconTransformerPlanner
                                              (implements Planner + PlannerTraceReader)
    ↓
                       ┌──────────────────────────────┐
                       │     TIER DISPATCH (§3.3)     │
                       │                              │
   request.tier === 'oct_secure' ─────────────→ Branch 1: single-node secure_handoff
                       │                              │
   request.subTasks non-empty ──────────────────→ Branch 2: pre-resolved DAG
                       │                              │
   request.selectedAgentIds non-empty ─────────→ Branch 3: PREFLIGHT
                       │                              │           agents have required caps?
                       │                              │           PASS → emit plan
                       │                              │           FAIL → PlanRejection +
                       │                              │                  RejectionCheckbackPayload
                       │                              │
   normal tier, prompt only ────────────────────→ Branch 4: LEXICAL DECOMPOSITION
                       │                              │
                       │                              metadata tier here → malformed
                       │                              │
                       └──────────────────────────────┘
    ↓
ExecutionPlan | PlanRejection (contract-typed)
    ↓
coordinator.getLastTrace() ← PlannerTraceReader interface
    ↓
plan_created / plan_rejected event (coordinator writes)
planner_plan_trace event (coordinator writes; only if trace present)
    ↓
if rejection has RejectionCheckbackPayload:
   plan_checkback_sent event (coordinator writes)
   OrchestratorPlanPreview returned with .rejection set
        → workspace UI consumes; Accept-Suggestions or Cancel
    ↓
validateExecutionPlan (14 + 1 checks)
    ↓
mailbox-pit allocation (per-actor mailboxes)
    ↓
delegation_issued + dispatchToGovernance per node
```

### §1.3 The preflight + checkback pattern

Workspace UI today lets the operator pick a preferred agent via a
dropdown (preferred model dropdown also exists; that's NVG's domain
per §6 below). The owner-described flow:

> Operator picks preference agent → orch preflight validates feasibility
> against the lexicon → if mismatch, orch counter-suggests via checkback
> ("the agents you preferred can't do this; I suggest X — confirm or
> cancel?") → operator confirms (workspace closes current run, opens new
> run with corrected agents) OR cancels (current run closes).

Why: a human operator (or future autonomous operator) might pick the
wrong agent or not enough agents. Orch's job in preflight is to catch
this BEFORE dispatching a helpless run that has no chance to succeed.
This is **orchestration feasibility**, not governance — planner's
authority bound (`packages/contracts/src/externals/planner.ts:5-7`)
explicitly permits rejection for feasibility reasons.

**Scope of feasibility V1 — agent/capability ONLY.** Planner does NOT
adjudicate model/endpoint feasibility ("frontier LLM for on-prem
task"). Model and endpoint authority belongs to NVG per existing
architecture memory. The `preferredEndpointId` field on
`NormalPlannerRequest` flows through the trace as a record of operator
intent but is not adjudicated by planner.

V1 implements the **2-way** form: Accept-suggestions / Cancel-run.
V2 adds 3-way (Accept / Try-anyway / Restart) — requires new
`bypassFeasibilityCheck` contract field + threat modeling.

The 2-way V1 form uses new additive contract surfaces (§13):
- `OrchestratorPlanPreview.rejection?: RejectionCheckbackPayload | null`
  — populated by coordinator when planner returns a rejection-with-
  suggestions.
- `WorkspaceRunRequest.checkbackSourceRunId?: Uuid | null` — set by
  workspace on the new run when operator accepts suggestions; null on
  fresh runs.
- `RejectionCheckbackPayload` — the executable counter-suggestion
  payload carrying `recommendedSelectedAgentIds` (executable set) +
  `alternativesByCapability` (display detail).

These are additive optional fields. Existing consumers ignore them.

---

## §2 Architecture

### §2.1 The 10 tables

(unchanged from v0.2.0 — fixture list and projection note identical)

Each table is a JSON-Lines fixture loaded into in-memory read-only
structures at bootstrap. One table — `planner_agent_capability` — is a
runtime projection, NOT a fixture file (§2.3).

| Table | Purpose | Record shape (V1) | On disk in V1? |
|---|---|---|---|
| `planner_lexical_term` | Raw term → canonical term + phrase class | `{ rawTerm, canonicalTerm, phraseClass: 'verb' \| 'noun' \| 'business_phrase', source }` | YES |
| `planner_alias_rule` | Mapping decisions | `{ rawTerm, canonicalTerm, status: 'approved' \| 'blocked' \| 'review_required', reason }` | YES |
| `planner_task_intent` | Canonical task intent identifiers | `{ intentId, name, description }` | YES |
| `planner_task_capability` | Intent → required capability set | `{ intentId, requiredCapabilities: NonEmpty[] }` | YES |
| `planner_target_catalog` | Business term → target system/resource | `{ businessTerm, system, resourceType, resourceScope: 'single' \| 'bulk' \| 'collection' \| 'system' }` | YES |
| `planner_agent_capability` | Agent capability index | (runtime projection over ActorRegistry — §2.3) | **NO** |
| `planner_workflow_template` | Named workflow templates | `{ templateId, name, description, intentId, nodeIds: NonEmpty[] }` | YES |
| `planner_workflow_node` | Template node definition | `{ templateId, nodeKey, capability, kind: 'nxs' \| 'nvg' \| 'secure_handoff', expectedOutputSlots: NonEmpty[] }` | YES |
| `planner_workflow_edge` | Template edge | `{ templateId, sourceNodeKey, targetNodeKey, edgeType, outputSlotRef? }` | YES |
| `planner_plan_trace` | Explainability log | (ledger event, NOT fixture — §3.6) | NO |

### §2.2 Canonical fixture format

One file per fixture-backed table under `fixtures/planner/db-lexicon/`:

```
fixtures/planner/db-lexicon/
├── planner-lexical-term.v1.jsonl
├── planner-alias-rule.v1.jsonl
├── planner-task-intent.v1.jsonl
├── planner-task-capability.v1.jsonl
├── planner-target-catalog.v1.jsonl
├── planner-workflow-template.v1.jsonl
├── planner-workflow-node.v1.jsonl
└── planner-workflow-edge.v1.jsonl
```

`planner-agent-capability.v1.jsonl` is **NOT** on disk — runtime
projection (§2.3).

Each file's first line is a signed header. Subsequent lines are
records. Signing precedent is `fixtures/compile-ref/template-*.json`
(verified: `template-single-agent.json:30-33` carries `templateDigest`
+ `signature`).

**Exact canonicalization law (uses existing `@nexus/runtime-utils`):**

```typescript
import { canonicalize } from '@nexus/runtime-utils';

// Per record canonicalization
const recordCanonical = canonicalize(record);  // produces canonical JSON string
                                               // (sorted keys, no whitespace, UTF-8)

// File content digest (header excluded)
const contentDigest = sha256(records.map(canonicalize).join('\n'));
// where records are AUTHORED ORDER (preserved; not re-sorted)
// the '\n' separator matches one record per line in the JSONL file

// Signed header payload — note: signedAt is part of the payload, then
// the result of canonicalize() goes through Ed25519
const headerPayload = {
  schemaVersion,    // 'v1' for V1
  recordCount,
  contentDigest,
  signedAt          // ISO timestamp
};
const signature = Ed25519(canonicalize(headerPayload));

// On-disk first line
const headerLine = canonicalize({ ...headerPayload, signature });
// remaining lines are the records, one per line, in authored order
```

**Record order policy:** records are signed in **authored order**
(NOT re-sorted). Order is part of the signed payload and meaningful
for fixture readability + diff stability over time. Bootstrap loader
preserves order during in-memory table construction; lookup operations
treat the order as semantically neutral (a single canonical term has
one mapping regardless of where the record sits in the file).

Bootstrap validator at step 18a:
1. Reads file, splits at first newline → header line + records.
2. Parses header line; verifies `signature` over `canonicalize({
   schemaVersion, recordCount, contentDigest, signedAt })`.
3. Recomputes `contentDigest = sha256(records.map(canonicalize).join('\n'))`;
   asserts equality with header `contentDigest`.
4. Asserts `recordCount === records.length`.
5. Validates each record's schema.
6. Asserts cross-fixture invariants (§2.4).
7. Constructs `LexiconTablesV1` and hands to factory.

Fail-closed at any step.

Signing script: new `scripts/sign-planner-lexicon-fixtures.sh` mirrors
existing `sign-compile-ref-fixtures.sh` pattern. Same Ed25519 control-
plane key used for compile-ref + manifest signing.

### §2.3 Agent capability projection — read-time, not fixture-time

(unchanged from v0.2.0)

`planner_agent_capability` is projected at plan-time from the live
`ActorRegistry` via `PlannerContext.registry.getById()` (preflight) or
`.findByCapability()` (lexical). No separate "agent registry for
planner" file.

### §2.4 Consumes Gate 02 lexicon, does NOT duplicate — INVARIANT

The canonical verb taxonomy is the **`ACTION_VERB` const** at
`packages/contracts/src/constants/index.ts:26-40`:

```typescript
export const ACTION_VERB = {
  READ: 'read', WRITE: 'write', CREATE: 'create', UPDATE: 'update',
  DELETE: 'delete', EXECUTE: 'execute', QUERY: 'query', SEARCH: 'search',
  PUBLISH: 'publish', EXPORT: 'export', SEND: 'send',
  SYNTHESIZE: 'synthesize', TRANSMIT: 'transmit',
} as const;
```

That is the source of truth — 13 canonical verbs. The
`governed-verb-lexicon.v1.json` fixture is the **alias mapping** from
raw words to ACTION_VERB members; it does NOT define a different
taxonomy. Verification: all 13 ACTION_VERB members appear as alias
targets in the fixture (`grep -oE ': "[a-z_]+"' fixtures/lexicon/governed-
verb-lexicon.v1.json | sort -u` yields exactly those 13 values).

**Cross-fixture invariant (ci:gate PLANNER-LEXICON-02):**
- For every record in `planner-lexical-term.v1.jsonl` with
  `phraseClass: 'verb'`, the `canonicalTerm` MUST be a member of
  `ACTION_VERB` (the const).
- For every `capability` in `planner-task-capability.v1.jsonl` and
  `planner-workflow-node.v1.jsonl`, MUST be a member of
  `CAPABILITY_IDS` (the const in
  `packages/contracts/src/types/index.ts`).
- For every `system` in `planner-target-catalog.v1.jsonl`, MUST appear
  in the connector manifest.

**Why this invariant is LAW (not weakenable):** if planner verb
canonical forms diverge from the ACTION_VERB taxonomy that Gate 02 +
the rest of the runtime use, planner-side intent decisions drift from
governance reality. Audit-1 DIFF-05 proposed loosening this invariant;
that proposal was **REJECTED** (CONTRA-PLANNER-LEXICON-001). If a
planner intent needs a richer verb, add it to ACTION_VERB FIRST (which
also requires updating Gate 02 risk classification), THEN the planner
is free to use it.

---

## §3 Surface

### §3.1 PlannerFactory + PlannerFactoryRegistry

**Factory (in new package):**

```typescript
// packages/planners/db-lexicon/src/db-lexicon-planner.factory.ts
export class DbLexiconTransformerPlannerFactory implements PlannerFactory {
  readonly plannerType: NonEmpty = 'db-lexicon-transformer-v0' as NonEmpty;
  readonly factoryVersion: NonEmpty = '0.1.0' as NonEmpty;

  // Pre-loaded tables passed in at factory construction (per §4.1 + row 9 ratification)
  constructor(
    private readonly lexiconTables: LexiconTablesV1,
    private readonly computeDigest: (obj: unknown) => Sha256Hex
  ) {}

  async create(record: OrchestratorManifestRecord): Promise<Planner> {
    // Construct the planner with pre-loaded tables.
    // Does NOT load or re-verify fixtures — bootstrap step 18a owns that.
    return new DbLexiconTransformerPlanner(
      this.lexiconTables,
      this.computeDigest,
      record.orchestratorActorId
    );
  }
}
```

Contract conformance: matches
`packages/contracts/src/externals/factories.ts:51-55` exactly.

**Factory registry (in core):**

```typescript
// packages/core/src/manifest/planners/planner-factory-registry.ts
export class PlannerFactoryRegistryImpl implements PlannerFactoryRegistry {
  private readonly factories: Map<string, PlannerFactory> = new Map();

  register(factory: PlannerFactory): void {
    if (this.factories.has(factory.plannerType)) {
      throw new Error(`PlannerFactory already registered for plannerType '${factory.plannerType}'`);
    }
    this.factories.set(factory.plannerType, factory);
  }

  get(plannerType: string): PlannerFactory | null {
    return this.factories.get(plannerType) ?? null;
  }

  list(): PlannerFactory[] {
    return [...this.factories.values()];
  }
}
```

Matches `packages/contracts/src/externals/factory-registries.ts:37-40`.

### §3.2 Planner implementation surface — trace via separate interface

Per audit pass 3 Condition 1 / F01 resolution: the `Planner` contract
return type is **UNCHANGED**. Trace exposure happens through a new
co-implemented interface, `PlannerTraceReader`, that the coordinator
reads after `plan()` returns.

**New interface — additive, NOT part of `Planner`:**

```typescript
// Lives in packages/contracts/src/externals/planner.ts alongside Planner
export interface PlannerTraceReader {
  /**
   * Returns the trace payload from the most recent `plan()` call.
   * Returns null if no plan has been issued yet (planner just constructed).
   * Coordinator reads this immediately after `plan()` returns; the
   * planner instance must not have another plan() call interleaved.
   *
   * Implementations that don't produce traces (legacy planners) can
   * choose to NOT implement this interface; the coordinator checks
   * via duck-type ('getLastTrace' in planner).
   */
  getLastTrace(): PlannerPlanTrace | null;
}
```

**Planner implementation:**

```typescript
// packages/planners/db-lexicon/src/db-lexicon-planner.ts
export class DbLexiconTransformerPlanner implements Planner, PlannerTraceReader {
  readonly plannerType: NonEmpty = 'db-lexicon-transformer-v0' as NonEmpty;
  readonly plannerVersion: NonEmpty = '0.1.0' as NonEmpty;

  private lastTrace: PlannerPlanTrace | null = null;

  constructor(
    private readonly lexiconTables: LexiconTablesV1,
    private readonly computeDigest: (obj: unknown) => Sha256Hex,
    private readonly orchestratorActorId: Uuid
  ) {}

  async plan(
    request: PlannerRequest,
    context: PlannerContext
  ): Promise<ExecutionPlan | PlanRejection> {
    // Tier dispatch — four branches (§3.3).
    // Each branch:
    //   1. Builds its result (plan or rejection)
    //   2. Builds its trace
    //   3. Stashes trace on this.lastTrace
    //   4. Returns the plan/rejection (contract return type — UNCHANGED)
    const { result, trace } = await this.dispatch(request, context);
    this.lastTrace = trace;
    return result;
  }

  getLastTrace(): PlannerPlanTrace | null {
    return this.lastTrace;
  }
}
```

**Coordinator integration (run-coordinator.ts patch):**

```typescript
// After planner.plan() call:
const planResult = await this.deps.planner.plan(plannerRequest, plannerContext);

// Extract trace if planner is a PlannerTraceReader
if ('getLastTrace' in this.deps.planner && typeof (this.deps.planner as PlannerTraceReader).getLastTrace === 'function') {
  const trace = (this.deps.planner as PlannerTraceReader).getLastTrace();
  if (trace) {
    await this.writeLedger(request.runId, 'planner_plan_trace', trace);
  }
}

// Continue with planResult (ExecutionPlan or PlanRejection) as before
```

**No `RunLedgerWriter` injection on planner.** ci:gate
PLANNER-LEXICON-04 (no-learning-write-path) enforces structurally.

### §3.3 Four-branch tier dispatch

Pseudocode for the planner's `dispatch()` helper:

```typescript
private async dispatch(
  request: PlannerRequest,
  context: PlannerContext
): Promise<{ result: ExecutionPlan | PlanRejection; trace: PlannerPlanTrace }> {

  // ── Branch 1: oct_secure tier ──
  if (request.tier === 'oct_secure') {
    return this.planOctSecureBranch(request, context);
  }

  // request is NormalPlannerRequest or MetadataPlannerRequest now
  const reqNM = request as NormalPlannerRequest | MetadataPlannerRequest;

  // ── Branch 2: pre-resolved subTasks DAG ──
  if (reqNM.subTasks && reqNM.subTasks.length > 0) {
    return this.planFromSubTasksBranch(reqNM, context);
  }

  // ── Branch 3: preferred-agents preflight ──
  if (reqNM.selectedAgentIds && reqNM.selectedAgentIds.length > 0) {
    return this.preflightBranch(reqNM, context);
  }

  // ── Branch 4: lexical decomposition (normal tier with prompt only) ──
  if (reqNM.tier === 'normal' && reqNM.prompt) {
    return this.lexicalDecompositionBranch(reqNM as NormalPlannerRequest, context);
  }

  // Metadata tier with no subTasks AND no selectedAgentIds — V1 malformed
  // (V2 may add capability-first metadata planning path)
  return this.buildRejectionWithTrace(
    'malformed_request',
    'metadata-tier request without subTasks or selectedAgentIds is malformed in V1',
    [],
    request,
    null   // no RejectionCheckbackPayload — malformed doesn't carry suggestions
  );
}
```

**Branches are mutually exclusive by request shape.** No fallthrough,
no chain. Preflight failure → returns rejection-with-suggestions, NOT
silent lexical override.

#### §3.3.1 Branch 1 — oct_secure single-node

Input: `OctSecurePlannerRequest`. Output: single-node `ExecutionPlan`
with one `secure_handoff` node assigned to `request.secureAgentId`.
Reuses extracted `plan-assembly.buildOctSecurePlan(...)` helper.

Trace: `branch: 'oct_secure'`, `planOutcome: 'plan_created'`, no
prompt content in trace (oct_secure tier carries no prompt).

#### §3.3.2 Branch 2 — pre-resolved subTasks

Input: `NormalPlannerRequest | MetadataPlannerRequest` with non-empty
`subTasks` + `subTaskEdges`. Reuses extracted
`plan-assembly.planFromSubTasks(...)` helper.

Trace: `branch: 'pre_resolved_sub_tasks'`,
`planOutcome: 'plan_created' | 'plan_rejected_malformed'`.

#### §3.3.3 Branch 3 — preferred-agents preflight

Input: `NormalPlannerRequest | MetadataPlannerRequest` with non-empty
`selectedAgentIds`. (Normal tier carries a `prompt`; metadata tier
carries `requiredCapabilities` directly.)

Algorithm:

1. **Determine required capabilities.**
   - If `request.requiredCapabilities` is non-empty: use them.
   - If empty (request only has `selectedAgentIds + prompt`, normal
     tier): run truncated Layer A→C of the lexical algorithm to infer
     required capabilities from the prompt. Agent side stays bound to
     operator's selection; only capability set is inferred.
   - If empty AND no prompt (metadata tier with empty
     `requiredCapabilities`): `malformed_request` rejection.

2. **Project agent capabilities.**
   - For each `agentId` in `selectedAgentIds`: lookup via
     `PlannerContext.registry.getById(agentId)`.
   - Build `agentCapabilities: Map<Uuid, NonEmpty[]>`.

3. **Check feasibility.**
   - For each required capability: verify at least one selected agent
     possesses it.
   - All covered → step 4. One or more uncovered → step 5.

4. **Emit plan with operator's preferred agents.**
   - Build SubTaskDecl[] via the agent-to-capability mapping. Reuses
     extracted `plan-assembly.buildPlanFromPreferredAgents(...)` helper.
   - Validate against `context.maxSplitDepth`. Exceeded →
     `PlanRejection { reason: 'max_split_exceeded' }`.
   - `ExecutionPlan` via `plan-assembly.buildPlan(...)`.
   - Trace: `branch: 'preflight_preferred_agents'`,
     `preflightOutcome: 'preferred_agents_satisfy'`,
     `planOutcome: 'plan_created'`.

5. **Emit rejection with counter-suggestion (the new `RejectionCheckbackPayload`).**
   - Run full Layer A→D lexical decomposition to determine which
     agents the lexicon would have picked for the uncovered capabilities.
   - Filter by `context.capabilityCeiling`.
   - Build `RejectionCheckbackPayload`:
     ```typescript
     {
       reason: 'no_capable_agent',
       reasonDetail: 'preflight_preferred_agents_insufficient: <uncovered caps>',
       missingCapabilities: NonEmpty[],          // uncovered set
       rejectedSelectedAgentIds: Uuid[],          // operator's original picks
       recommendedSelectedAgentIds: Uuid[],       // EXECUTABLE replacement set
       alternativesByCapability: Record<NonEmpty, SuggestedAgent[]>  // display detail
     }
     ```
   - Return `PlanRejection { reason: 'no_capable_agent', reasonDetail,
     suggestedAlternatives: <flattened from alternativesByCapability> }`.
   - **`RejectionCheckbackPayload` returned via separate channel** —
     the planner returns `PlanRejection` (contract), but ALSO stashes
     the `RejectionCheckbackPayload` on the planner instance via a
     mechanism parallel to trace. Coordinator reads after plan() via:
     ```typescript
     ('getLastRejectionCheckback' in planner) ? planner.getLastRejectionCheckback() : null
     ```
     and attaches to the `OrchestratorPlanPreview.rejection` field on
     the way back to workspace.
   - Trace: `branch: 'preflight_preferred_agents'`,
     `preflightOutcome: 'preferred_agents_insufficient_alternatives_suggested'`,
     `planOutcome: 'plan_rejected_no_capable_agent'`.

**preferredEndpointId NOT adjudicated by planner.** The field flows
through `PlannerPlanTrace.operatorPreference.preferredEndpointId` for
audit but does not cause rejection.

**Coordinator flow on rejection-with-suggestions:**
1. Write `plan_rejected` ledger event.
2. Write `planner_plan_trace` ledger event from `getLastTrace()`.
3. Write `plan_checkback_sent` ledger event with the rejection payload
   in detail.
4. Return `OrchestratorPlanPreview { plan: null, selectedAgents: [],
   rejection: <RejectionCheckbackPayload>, ...other fields }`.

Workspace UI receives the preview, sees `rejection != null`, opens the
modal (§3.7).

#### §3.3.4 Branch 4 — lexical decomposition (NEW path)

Layer A→E per owner outline §5.

**Layer A — Governed inputs:** request.prompt, request.principalId,
context.registry, context.capabilityCeiling, context.maxSplitDepth,
10 in-memory lexicon tables.

**Layer B — Lexical resolver (planner's own internal module):**

Lives at `packages/planners/db-lexicon/src/internal/lexical-resolver.ts`.
NOT `LexicalNormalizer` (Gate-02-subordinate, scope-restricted).

Operations:
- Tokenization: split on whitespace + punctuation; preserve multi-word
  phrases by greedy longest-match against `planner_lexical_term.rawTerm`.
- Per-token/phrase lookup: `planner_lexical_term`.
- Alias resolution: `planner_alias_rule` (approved/blocked/review_required).
  Applied AFTER a `planner_lexical_term` match to remap canonical (for
  approved/review_required) OR suppress the match (for blocked).
- **Second-pass blocked-alias scan (defense-in-depth, ratified Commit 8):**
  after the lex-term greedy match misses at a given position, the
  resolver runs a second greedy match against `planner_alias_rule.rawTerm`
  values with `status: 'blocked'`. A hit sets `hasBlockedAlias = true`
  and consumes the matched tokens. This catches blocked phrases that
  have no corresponding lex-term entry — explicit prohibitions fire
  regardless of fixture-author completeness on the lex-term side.
  Approved / review_required aliases without a lex-term are inert
  (nothing to remap).
- Verb canonical check: against `ACTION_VERB` const (§2.4 invariant).
- Tuple split: outputs (verb / target / operand) as three distinct
  streams. No dotted compound canonicals like `read.target`.

Example output for "pull the warehouse inventory for product A, adjust
it +2 from receiving today":
```
verbs:    [{ rawTerm: 'pull',   canonicalVerb: 'read'   },
           { rawTerm: 'adjust', canonicalVerb: 'update' }]
targets:  [{ rawTerm: 'inventory', targetTerm: 'inventory_row' },
           { rawTerm: 'product A', targetTerm: 'product_id', value: 'A' }]
operands: [{ rawTerm: 'from receiving today', operand: 'receiving_delta' }]
```

**Layer C — Capability transformer:**
- (verb, target, operand) → `planner_task_intent` candidates.
- intent → `planner_task_capability.requiredCapabilities`.
- target term → `planner_target_catalog` → (system, resourceType, resourceScope).

**Layer D — Workflow / DAG expander:**
- intent → `planner_workflow_template` candidates.
- template → `planner_workflow_node` records → `SubTaskDecl[]`.
- node capability → `AgentRegistryReader.findByCapability(capability)`.
- Filter by `context.capabilityCeiling`.
- Edges from `planner_workflow_edge` records.

**Layer E — Plan scorer + emit:**
- All required capabilities have visible candidate agent.
- `subTasks.length <= context.maxSplitDepth`.
- Plan validates via plan-assembly's pre-emit helpers.
- If valid → `ExecutionPlan` via `plan-assembly.buildPlan(...)`. Trace:
  `branch: 'lexical_decomposition'`, `planOutcome: 'plan_created'`.
- Ambiguous (multi-template tie, no tiebreak) → `PlanRejection {
  reason: 'unmappable_request', reasonDetail: 'ambiguous_intent: ...' }`.
  Trace: `planOutcome: 'plan_rejected_ambiguous'`.
- No capable visible agent → `PlanRejection { reason:
  'no_capable_agent' }` plus `RejectionCheckbackPayload` populated from
  partial workflow context (best-effort — may be sparse).
- Outside ceiling → `PlanRejection { reason:
  'capability_outside_ceiling' }`.
- Depth exceeded → `PlanRejection { reason: 'max_split_exceeded' }`.

### §3.6 New Run Ledger event — `planner_plan_trace`

Coordinator-written (after `getLastTrace()` returns non-null).

Trace payload shape:

```typescript
export interface PlannerPlanTrace {
  runId: Uuid;
  plannerType: 'db-lexicon-transformer-v0';
  plannerVersion: '0.1.0';
  promptDigest: Sha256Hex | null;  // null for oct_secure
  branch: 'oct_secure' | 'pre_resolved_sub_tasks'
        | 'preflight_preferred_agents' | 'lexical_decomposition';
  operatorPreference: {
    selectedAgentIds: Uuid[];                 // empty unless preflight branch
    preferredEndpointId: NonEmpty | null;     // traced, NOT adjudicated
  } | null;
  preflightOutcome:
    'preferred_agents_satisfy'
  | 'preferred_agents_insufficient_alternatives_suggested'
  | 'not_applicable' | null;
  lexicalMatches: ReadonlyArray<{
    rawTerm: string;
    canonicalTerm: string;
    phraseClass: 'verb' | 'noun' | 'business_phrase';
    aliasRule?: 'approved' | 'blocked' | 'review_required';
  }>;
  candidateIntents: NonEmpty[];
  selectedIntent: NonEmpty | null;
  candidateTemplates: NonEmpty[];
  selectedTemplate: NonEmpty | null;
  requiredCapabilities: NonEmpty[];
  candidateAgents: ReadonlyArray<{ capability: NonEmpty; agentIds: Uuid[] }>;
  planOutcome:
    'plan_created'
  | 'plan_rejected_ambiguous'                   // ledger enum, richer than PlanRejectionReason
  | 'plan_rejected_no_capable_agent'
  | 'plan_rejected_capability_outside_ceiling'
  | 'plan_rejected_max_split_exceeded'
  | 'plan_rejected_malformed';
  rejectionReason: PlanRejectionReason | null;  // contract enum
  rejectionDetail: NonEmpty | null;
  emittedAt: IsoTimestamp;
}
```

**Two-enum distinction:** `PlanRejection.reason` is the contract enum
(6 values); `PlannerPlanTrace.planOutcome` is the ledger-internal enum
(richer; we own it). The contract emits the contract enum; trace event
carries the richer distinction.

No raw prompt text. promptDigest only.

`planner_plan_trace` added to `RunEventType` union
(`packages/contracts/src/interfaces/index.ts`).

### §3.7 Manifest + contract additions + UI minimal additive

**Manifest type:**

`OrchestratorManifestRecord.plannerConfiguration` (existing object
field) — V1 may carry optional `lexiconFixtureRoot?: NonEmpty` (default
`'fixtures/planner/db-lexicon/'`). `strict_first_match` REMOVED entirely.

**Signed manifest update (`config/orchestrators/orchestrators.v1.yaml`):**

| Field | Before | After |
|---|---|---|
| `plannerType` | `ref-deterministic` | `db-lexicon-transformer-v0` |
| `plannerVersion` | `1.0.0` | `0.1.0` |
| `maxSplitDepth` | `1` | `3` |

Re-sign via `scripts/sign-manifest.ts` after value updates.

**Loader policy amendment:** `orchestrator-manifest-loader.ts:75-78`
hard-rejects `maxSplitDepth > 1` today. New policy table:

```typescript
const MAX_SPLIT_DEPTH_BY_PLANNER: Record<string, number> = {
  'db-lexicon-transformer-v0': 3,
};

const allowedMax = MAX_SPLIT_DEPTH_BY_PLANNER[entry.plannerType] ?? 1;
if (entry.maxSplitDepth > allowedMax) {
  throw new Error(
    `orchestrator manifest: maxSplitDepth ${entry.maxSplitDepth} exceeds ` +
    `allowed maximum of ${allowedMax} for plannerType '${entry.plannerType}'`
  );
}
```

Other plannertypes (e.g., a future LLM-planner-v0) get their own row
in this table when they ship.

**Three additive contract additions (V1 contract surface):**

```typescript
// 1. New interface — packages/contracts/src/externals/orchestrator.ts
export interface RejectionCheckbackPayload {
  reason: PlanRejectionReason;
  reasonDetail: NonEmpty;
  /** Capabilities the rejected selection did not cover. */
  missingCapabilities: NonEmpty[];
  /** Agents the operator originally picked (echo for UI). */
  rejectedSelectedAgentIds: Uuid[];
  /**
   * EXECUTABLE replacement set — workspace passes this directly to
   * `selectedAgentIds` of the re-issued run on Accept-Suggestions.
   * MUST cover every entry in `missingCapabilities`.
   */
  recommendedSelectedAgentIds: Uuid[];
  /** Display detail per missing capability — one or more candidate agents. */
  alternativesByCapability: Record<NonEmpty, SuggestedAgent[]>;
}

// 2. Field addition — packages/contracts/src/externals/orchestrator.ts
//    OrchestratorPlanPreview interface gains:
//      rejection: RejectionCheckbackPayload | null;
//    (null on success paths; populated on rejection-with-suggestions paths)

// 3. Field addition — packages/contracts/src/externals/workspace.ts
//    WorkspaceRunRequest interface gains:
//      checkbackSourceRunId: Uuid | null;
//    (null on fresh runs; populated when this run was opened via Accept-
//     Suggestions on a prior rejected run — carries the prior runId for
//     audit correlation)
```

All three are ADDITIVE and OPTIONAL. Existing consumers ignore them.

The factory contract (`PlannerFactory`), the `Planner` interface, and
`PlanRejection` are UNCHANGED.

**Workspace UI minimal additive (V1):**

`packages/workspace-ref/src/client/components/plan-checkback-modal.tsx`
— modal triggered when `OrchestratorPlanPreview.rejection != null`.

Display:
- Header: "Your preferred selection cannot complete this run."
- Body: rejection.reasonDetail
- Missing capabilities list: rejection.missingCapabilities.map(c => display name)
- Alternatives table:
  ```
  Capability                    | Suggested Agent     | Reason
  read:record:single            | nexus-warehouse-agent | <reason>
  update:record:internal        | nexus-warehouse-agent | <reason>
  ```
- Buttons: **Accept Suggestions** | **Cancel Run**

Behavior:

- **Accept Suggestions:**
  - Workspace API: `POST /workspace/runs/{originalRunId}/close` with
    reason `user_accepted_checkback_reissued`.
  - Workspace API: `POST /workspace/runs` (new run) with:
    - `selectedAgentIds = preview.rejection.recommendedSelectedAgentIds`
    - `checkbackSourceRunId = originalRunId`
    - Other fields copied from original `WorkspaceRunRequest`.
  - New run goes through dispatch from scratch. Preflight passes
    (recommended agents satisfy by construction). Plan emitted. Run
    proceeds.

- **Cancel Run:**
  - Workspace API: `POST /workspace/runs/{originalRunId}/close` with
    reason `user_cancelled_after_checkback`.
  - Run terminal. No new run opened.

Wiring: extend `run-stage-reducer.ts` to detect the rejection on the
preview returned by the dispatch endpoint; surface the modal trigger.

V1 does NOT include the third option ("Try anyway"). V2 — requires
`bypassFeasibilityCheck` field + threat modeling.

**Admin placeholder update:** `placeholder-data.ts:320-321` →
`plannerType: 'db-lexicon-transformer-v0'`, `plannerVersion: '0.1.0'`.

---

## §4 Lifecycle

### §4.1 Bootstrap

```
Step 17  (existing)   : signed manifest validation begins
Step 17b (NEW)        : construct PlannerFactoryRegistryImpl
                        (factory NOT YET registered — fixtures must
                         load first per row 9 ratification)
Step 18  (existing)   : signed manifest validation completes
Step 18a (NEW)        : if manifest.plannerType === 'db-lexicon-transformer-v0':
                        - resolve fixture root
                        - load each fixture; verify signed header per §2.2;
                          recompute contentDigest; assert recordCount;
                          validate cross-fixture invariants
                        - construct in-memory LexiconTablesV1 (ONCE)
                        - construct DbLexiconTransformerPlannerFactory
                          with lexiconTables passed in
                        - register factory with registry
Step 22c (REWIRED)    : resolve active planner:
                        const factory = registry.get(orchManifest.plannerType);
                        if (!factory) throw — fail-closed
                        const planner = await factory.create(orchManifest);
                        // factory.create does NOT re-load fixtures (row 9)
```

Bootstrap fail-closed at every new step. Server does not start with a
missing factory, an unsigned fixture, an invalid signature, a schema
violation, a cross-fixture invariant violation, or a manifest pointing
to a plannertype with no registered factory.

### §4.2 Runtime (per plan call)

Pure read against in-memory tables + live registry. No I/O at plan
time. Trace built inline; stashed on planner instance via
`getLastTrace()`. RejectionCheckbackPayload (when applicable) stashed
via parallel `getLastRejectionCheckback()`. Coordinator reads both
post-plan().

### §4.3 Shutdown / hot-reload

V1: none. V3 adds signed admin apply paths.

---

## §5 Worked examples

### §5.1 Lexical decomposition (Branch 4)

Input (`NormalPlannerRequest`):
```
tier: 'normal'
prompt: "Pull the warehouse inventory for product A, adjust it +2 from receiving today."
selectedAgentIds: []
requiredCapabilities: []
subTasks: null
```

Branch 4 fires. Layer A→E:

| Stage | Lookup | Result |
|---|---|---|
| Layer B — tokenize | greedy multi-word | `['pull', 'the warehouse inventory', 'for product A', ',', 'adjust', 'it +2', 'from receiving today']` |
| Layer B — verb resolve | `pull`, `adjust` | `canonicalVerb: read` (ACTION_VERB member; via Gate 02 alias `pull → read`); `canonicalVerb: update` (via `adjust → update`) |
| Layer B — target resolve | `warehouse inventory`, `product A` | `targetTerm: inventory_row`; `targetTerm: product_id, value: A` |
| Layer B — operand resolve | `from receiving today` | `operand: receiving_delta` |
| Layer C — intent | (read + update) × inventory_row × receiving_delta | `intentId: inventory.adjust_from_receiving` |
| Layer C — required caps | intent.requiredCapabilities | `[read:record:single, update:record:internal]` |
| Layer C — target catalog | `inventory_row` | `{ system: 'warehouse', resourceType: 'inventory', resourceScope: 'single' }` |
| Layer D — workflow | match `inventory.adjust_from_receiving` | `workflow_inventory_adjust_from_receiving_v1` |
| Layer D — template nodes | 3 nodes | `read_inventory (nxs)`, `compute_adjusted_units (nvg)`, `write_inventory (nxs)` |
| Layer D — agent assignment | each node's capability vs registry | `nexus-warehouse-agent` matches all three (allowedCapabilities include `read:record:single` + `update:record:internal`) |
| Layer E — score | depth=3 ≤ maxSplitDepth=3, all caps covered | PASS |
| Layer E — emit | `plan-assembly.buildPlan(...)` | 3-node ExecutionPlan |

Output: `ExecutionPlan`. Trace stashed.
`branch: 'lexical_decomposition'`, `planOutcome: 'plan_created'`,
`selectedTemplate: 'workflow_inventory_adjust_from_receiving_v1'`.

Coordinator reads trace, writes `planner_plan_trace`. Writes
`plan_created`. Returns `OrchestratorPlanPreview { plan: <validated>,
rejection: null, ... }`.

### §5.2 Preferred-agents preflight PASS (Branch 3)

Input:
```
tier: 'normal'
prompt: "Pull the warehouse inventory for product A, adjust it +2 from receiving today."
selectedAgentIds: [WAREHOUSE_AGENT_ACTOR_ID]
requiredCapabilities: [read:record:single, update:record:internal]
subTasks: null
preferredEndpointId: 'qwen3.5-on-prem' (traced, not adjudicated)
```

Branch 3 fires. Preflight:
- Required caps: `[read:record:single, update:record:internal]`
- WAREHOUSE_AGENT capabilities: `[read:record:single, read:record:bulk,
  query:data, search:data, update:record:internal]`
- Coverage: PASS (both required caps present).

Output: 3-node `ExecutionPlan` assigned to nexus-warehouse-agent.
Trace: `branch: 'preflight_preferred_agents'`,
`preflightOutcome: 'preferred_agents_satisfy'`,
`planOutcome: 'plan_created'`,
`operatorPreference: { selectedAgentIds: [WAREHOUSE_AGENT_ACTOR_ID],
preferredEndpointId: 'qwen3.5-on-prem' }`.

`OrchestratorPlanPreview { plan: <validated>, rejection: null, ... }`.
No checkback. Run proceeds. NVG handles endpoint selection downstream
using `preferredEndpointId`.

### §5.3 Preferred-agents preflight REJECT + counter-suggest (Branch 3)

Input:
```
tier: 'normal'
prompt: "Pull the warehouse inventory for product A, adjust it +2 from receiving today."
selectedAgentIds: [SALES_AGENT_ACTOR_ID]   ← WRONG AGENT
requiredCapabilities: [read:record:single, update:record:internal]
subTasks: null
```

Branch 3 fires. Preflight:
- Required caps: `[read:record:single, update:record:internal]`
- SALES_AGENT capabilities: `[read:record:single, query:data, search:data]`
- Coverage: `read:record:single` covered; `update:record:internal`
  UNCOVERED.
- Run Layer A→D lexical decomposition to find lexicon's pick for
  uncovered capability → `nexus-warehouse-agent`.
- Build `RejectionCheckbackPayload`:
  ```
  {
    reason: 'no_capable_agent',
    reasonDetail: 'preflight_preferred_agents_insufficient: update:record:internal uncovered by selectedAgentIds [SALES_AGENT_ACTOR_ID]',
    missingCapabilities: ['update:record:internal'],
    rejectedSelectedAgentIds: [SALES_AGENT_ACTOR_ID],
    recommendedSelectedAgentIds: [WAREHOUSE_AGENT_ACTOR_ID],
    alternativesByCapability: {
      'update:record:internal': [
        { agentId: WAREHOUSE_AGENT_ACTOR_ID, capability: 'update:record:internal', reason: 'nexus-warehouse-agent has update:record:internal; canonical agent for inventory write per workflow_inventory_adjust_from_receiving_v1' }
      ]
    }
  }
  ```

Output: `PlanRejection { reason: 'no_capable_agent', reasonDetail, suggestedAlternatives: [...] }`.
RejectionCheckbackPayload stashed.

Coordinator:
1. Writes `plan_rejected` ledger event.
2. Reads `getLastTrace()`; writes `planner_plan_trace` event.
3. Reads `getLastRejectionCheckback()`; writes `plan_checkback_sent`
   event with the payload.
4. Returns `OrchestratorPlanPreview { plan: null, selectedAgents: [],
   rejection: <RejectionCheckbackPayload>, requiresUserApproval: true,
   ... }`.

Workspace UI:
1. Receives preview; sees `rejection != null`.
2. Opens `plan-checkback-modal.tsx`.
3. Operator clicks **Accept Suggestions**:
   - Workspace: `POST /workspace/runs/{originalRunId}/close` reason
     `user_accepted_checkback_reissued`.
   - Workspace: `POST /workspace/runs` new run with `selectedAgentIds:
     [WAREHOUSE_AGENT_ACTOR_ID]`, `checkbackSourceRunId: <originalRunId>`,
     other fields copied.
   - New run dispatches; Branch 3 preflight PASSES (per §5.2). Plan emits.
4. Or operator clicks **Cancel Run**:
   - Workspace: `POST /workspace/runs/{originalRunId}/close` reason
     `user_cancelled_after_checkback`.
   - Run terminal.

Complete preflight + checkback flow. Callback actually calls back
(coordinator emits `plan_checkback_sent` with executable payload). UI
modal actually drives Accept/Cancel decision. No stub anywhere.

---

## §6 Migration & Coexistence

### §6.1 Lexicon planner IS the reference planner

(unchanged from v0.2.0)

### §6.2 7-commit migration sequence

Per project_nexus_build_protocol patch discipline. Each commit
maintains ci:gate green + vitest green at the boundary.

**Commit 1 — Extract shared utilities + plan-assembly (no behavior change).**
- New file `packages/orch-ref/src/condition-evaluator.ts` — move
  `evaluateCondition`, `determineNodeType`, `ConditionEvalResult`,
  `NodeTypeResult` out of `ref-deterministic-planner.ts`.
- New file `packages/orch-ref/src/plan-assembly.ts` — move
  reusable helpers out of `ref-deterministic-planner.ts`:
  `hasCycle`, `compareEdges`, `buildNodeFromSubTask`, `buildPlan`,
  digest computation, validation helpers, OCT-secure builder,
  `planFromSubTasks` logic, agent-selection assembly.
- Update `packages/orch-ref/src/index.ts` to re-export from new files.
- Update `packages/orch-ref/src/run-coordinator.ts:39` to import
  `evaluateCondition` from `./condition-evaluator.js`.
- Update `packages/orch-ref/src/ref-deterministic-planner.ts` to
  import from extracted files.
- Logs: `MODULAR-CONDITION-EVALUATOR-001`, `MODULAR-PLAN-ASSEMBLY-001`.

**Commit 2 — Spec v0.2.1 + new package skeleton.**
- This file lands. Delete `AMEND-nexus-planner-db-lexicon-v0-1-0.md` +
  `-v0-2-0.md` (superseded).
- Create `packages/planners/db-lexicon/` skeleton: `package.json`,
  `tsconfig.json`, `src/index.ts`, `src/internal/`.
- Update `pnpm-workspace.yaml` — add `'packages/planners/db-lexicon'`
  EXPLICIT path (per row 13).
- Update `tsconfig.base.json` paths: `'@nexus/planner-db-lexicon':
  ['packages/planners/db-lexicon/src/index.ts']`.
- Update `vitest.config.ts` aliases + include glob.
- Logs: `ADD-PLANNER-LEXICON-004`.

**Commit 3 — Contracts + maxSplitDepth loader amendment.**
- Add `planner_plan_trace` to `RunEventType` union.
- Add the three additive contract additions (row 2):
  - `OrchestratorPlanPreview.rejection?: RejectionCheckbackPayload | null`
  - `WorkspaceRunRequest.checkbackSourceRunId?: Uuid | null`
  - new `RejectionCheckbackPayload` interface (alongside
    `SuggestedAgent` in `execution-plan.ts` or `orchestrator.ts`)
- Add new `PlannerTraceReader` interface in `planner.ts` (alongside
  `Planner` — both exported).
- Add the planner-type-scoped maxSplitDepth policy to
  `orchestrator-manifest-loader.ts:75-78`.
- Unit tests for the new RunEventType member + new contract types +
  the new loader policy.
- Logs: `ADD-PLANNER-LEXICON-001`, `ADD-PLANNER-LEXICON-005`,
  `DIFF-PLANNER-LEXICON-CONTRACT-001` (the three contract additions).

**Commit 4 — Lexicon planner + factory + concrete PlannerFactoryRegistry + fixtures + ci:gate.**
- New `packages/core/src/manifest/planners/planner-factory-registry.ts`
  — `PlannerFactoryRegistryImpl`.
- New files in `packages/planners/db-lexicon/src/`:
  - `db-lexicon-planner.factory.ts` — factory class.
  - `db-lexicon-planner.ts` — planner class implementing both
    `Planner` and `PlannerTraceReader`, with four-branch tier dispatch.
  - `internal/lexical-resolver.ts` — own tokenizer + (verb, target,
    operand) resolver.
  - `internal/preflight.ts` — preflight feasibility check.
  - `internal/lexical-decomposition.ts` — Layer A–E.
  - `internal/fixture-loader.ts` — signature verification + canonical
    table construction (called by bootstrap step 18a, NOT by factory
    `create()`).
- Fixtures: 8 files under `fixtures/planner/db-lexicon/` (per §2.2)
  covering the warehouse worked example + at least 2 other shapes.
  Signed via new `scripts/sign-planner-lexicon-fixtures.sh`.
- Unit tests for new planner covering all four branches.
- 5 new ci:gate steps added to `scripts/ci-gate.ts`, named:
  - `PLANNER-LEXICON-01` — fixture signature verification
  - `PLANNER-LEXICON-02` — cross-fixture invariant (ACTION_VERB,
    CAPABILITY_IDS, connector manifest)
  - `PLANNER-LEXICON-03` — no-runtime-wordnet (planner package
    imports no `wordnet` runtime)
  - `PLANNER-LEXICON-04` — no-learning-write-path (planner package
    has zero `RunLedgerWriter` references; no fixture write paths)
  - `PLANNER-LEXICON-05` — package layer law (per §6.5)
- ci:gate step numbering: appended to end of step list; total step
  count computed dynamically by the script's existing
  `totalSteps` calculation. No spec text hard-codes step numbers.
- Logs: `ADD-PLANNER-LEXICON-002`, `ADD-PLANNER-LEXICON-003`,
  `ADD-PLANNER-LEXICON-006`.

**Commit 5 — Bootstrap rewire + manifest re-sign + placeholder + UI additive.**
- Update `scripts/nexus-main.ts` bootstrap:
  - Step 17b construct registry (factory NOT yet registered).
  - Step 18a fixture load + factory construction + registry registration.
  - Step 22c (replaces line 439): registry resolution.
- Coordinator patch (`run-coordinator.ts`): after `planner.plan()`,
  read `getLastTrace()` via duck-type check; write
  `planner_plan_trace` event. On rejection paths with
  RejectionCheckbackPayload, write `plan_checkback_sent` and attach
  payload to `OrchestratorPlanPreview.rejection`.
- Update `config/orchestrators/orchestrators.v1.yaml` (plannerType,
  plannerVersion, maxSplitDepth); re-sign via `scripts/sign-manifest.ts`.
- Update `placeholder-data.ts:320-321`.
- Build `plan-checkback-modal.tsx` + wire into `run-stage-reducer.ts`.
- Update integration test fixture to expect
  `plannerType: 'db-lexicon-transformer-v0'` in `plan_created` event.
- Workspace API routes (`workspace.ts`): support
  `checkbackSourceRunId` field on `WorkspaceRunRequest`; pass through
  to coordinator.
- Logs: `ADD-PLANNER-WIRING-001`.

**Commit 5.5 — Parity test bridge (owner-approved additive, slippage remediation).**

Discovered during Commit 6 drift check: Commit 4 was supposed to deliver
the §9.5 parity proof (per spec line: "Parity proof delivered with
Commit 4; Commit 6 cannot land without it") but the dedicated
`condition-evaluator.test.ts` + `plan-assembly.test.ts` files were
never created — the corresponding tests still lived inside the
soon-to-be-deleted `ref-deterministic-planner.test.ts`. Hard-stopped
on the slippage; owner approved an additive Commit 5.5 to remediate
without rewriting Commit 4's history.

- Create `packages/orch-ref/src/condition-evaluator.test.ts` — migrate
  ORCH-13 (`determineNodeType` dispatch branching) + ORCH-14
  (`evaluateCondition` type-coercion law) tests verbatim from
  `ref-deterministic-planner.test.ts`. Import path changes from
  `./ref-deterministic-planner.js` → `./condition-evaluator.js`.
- Create `packages/orch-ref/src/plan-assembly.test.ts` — direct unit
  tests for the extracted primitives:
    - `hasCycle` (cycle detection on synthetic node + edge sets)
    - `compareEdges` (stable sort comparator)
    - `reject` (rejection helper shape)
    - `buildNodeFromSubTask` (kind → nodeType mapping for nvg / nxs /
      secure_handoff)
    - `validateConditionSpec` (EdgeHint normalization law)
    - `isVisible` (catalog ceiling filter)
    - `findAlternatives` (suggest-not-deny — covers ORCH-04 surface)
    - `buildEdges` (EdgeHint → PlanEdge construction)
    - `buildPlan` (digest computation + plan emission)
    - `planOctSecure` (OCT-secure single-node — covers ORCH-20 surface)
    - `planFromSubTasks` (multi-node sub-task DAG path, validation rules)
    - `planStandard` (legacy selectedAgentIds + requiredCapabilities path
      — covers ORCH-02 / ORCH-03 / ORCH-11 surfaces)
- No deletions in this commit. No behavior change. Tests pass on
  current repo state; after Commit 6 deletes the originating tests
  these become the sole proof for those code paths.
- Logs: `INFRA-PLANNER-PARITY-BRIDGE-001`.

**Commit 6 — Delete old class + tests + rewire dependent tests.**
- Delete `packages/orch-ref/src/ref-deterministic-planner.ts` (class
  portion — utilities extracted in Commit 1).
- Delete `packages/orch-ref/src/ref-deterministic-planner.test.ts`.
- Update barrel `packages/orch-ref/src/index.ts` — remove deleted
  exports.
- Update dependent tests (`orch-lifecycle.test.ts`,
  `dag-executor.test.ts`, `coordinator-amendment.test.ts`,
  `multi-node-slot-binding.test.ts`).
- Remove the transitional `RefDeterministicPlanner` fallback branch in
  `scripts/nexus-main.ts:439` (added in Commit 5 as a transitional
  safety net during the rewire; once the class is gone the branch can
  no longer compile so it must be removed to a fail-closed throw on
  missing factory).
- Parity check (§9.5) verified before commit — `condition-evaluator.test.ts`
  + `plan-assembly.test.ts` from Commit 5.5 deliver the proof.
- Logs: `INFRA-PLANNER-DELETE-001`.

**Commit 7 — Parent orch spec + infra-externals spec + infra-externals blueprint + doc amendments.**
- Update `docs/engineering-specs/AMEND-nexus-spec-orch-v1-1-1.md` — 9
  references.
- Update `docs/engineering-specs/AMEND-spec-nexus-infra-externals-v0-2-5.md`
  line 1086 — maxSplitDepth law revised to plannertype-scoped.
- Update `docs/blueprints/AMEND-blueprint-nexus-infra-externals-v1-0-0.md`
  line 312 — example value reflects new plannertype.
- Update `docs/STATUS-MULTI-NODE-PLANNER.md:21`.
- Spec-only commit. ci:gate green.
- Logs: `DIFF-ORCH-SPEC-PLANNER-IDENTITY-001` CLOSED,
  `DIFF-INFRA-EXTERNALS-SPEC-001` CLOSED,
  `DIFF-INFRA-EXTERNALS-BLUEPRINT-001` CLOSED.

**Commit 8 — UI flow + close endpoint + integration test + test coverage remediation (owner-approved additive after Commit 7 drift audit).**

Discovered during post-Commit-7 drift audit: the §3.7 UI Accept/Cancel
flows were structurally half-built. Accept-Suggestions passed an empty
prompt to `createRun()` (Zod schema would reject), skipped the
mandatory `POST /workspace/runs/:runId/close` of the source run, and
the `onAccepted` callback in run-display.tsx was a no-op (no
navigation). Cancel-Run was entirely no-op. The §9.2 integration test
covering 3 scenarios through real `RefRunCoordinator` was never built.
Reducer extractor + modal component had zero direct tests. Several
header comments in extracted files still claimed RefDeterministicPlanner
as a live consumer.

Net effect: §9.6 acceptance criterion ("Accept Suggestions re-issues
to a passing plan; Cancel Run closes the original run cleanly") was
unreachable despite green ci:gate + vitest. Owner triggered hard-stop;
owner approved this additive Commit 8 for remediation.

Work:

- Server: add `POST /workspace/runs/:runId/close` to
  `packages/interfaces/api/src/routes/workspace.ts`. Body accepts
  `{ reason: 'user_cancelled_after_checkback' | 'user_accepted_checkback_reissued' }`.
  Writes `run_cancelled` ledger event with reason + actor; idempotent
  (closing an already-closed run is a no-op with 200).
- Client: add `closeRun(runId, reason)` to
  `packages/workspace-ref/src/client/api.ts`.
- Modal `plan-checkback-modal.tsx`:
    - `acceptSuggestions` calls `closeRun(sourceRunId, 'user_accepted_checkback_reissued')`
      FIRST, then `createRun(...)` for the re-issued run. Fail-closed on
      close failure — does not re-issue if the source run can't close.
    - `cancel` calls `closeRun(sourceRunId, 'user_cancelled_after_checkback')`
      then `onDismiss()`. Modal closes regardless of API success (defense
      in depth — UI flips to dismissed; ledger captures the attempt).
- `run-display.tsx`: extract `prompt` + `preferredEndpointId` from the
  events array (looking up `run_opened.detail.prompt` and
  `.preferredEndpointId`). Pass to modal as real values. `onDismiss`
  flips a local component state flag suppressing re-render of the
  modal; `onAccepted` does the same (the new run takes over via its
  own event stream).
- Integration test
  `packages/planners/db-lexicon/src/db-lexicon-planner.integration.test.ts`
  covering three §9.2 scenarios through real `RefRunCoordinator` +
  `MailboxServiceImpl`:
    1. Lexical decomposition (Branch 4) — warehouse worked example.
    2. Preflight pass (Branch 3) — preferred-agents satisfy.
    3. Preflight reject + counter-suggest (Branch 3) — asserts
       `plan_rejected`, `planner_plan_trace`, `plan_checkback_sent`
       with `checkbackPayload` in detail,
       `OrchestratorPlanPreview.rejection` populated.
- `run-stage-reducer.test.ts`: add test cases for
  `extractPendingPlannerCheckback` — happy path (event with
  `checkbackPayload`), legacy NVG-tier event distinction (event
  without payload), clearing on `plan_created` / `run_closed` /
  `run_cancelled`.
- `plan-checkback-modal.test.tsx`: render test, Accept flow (mock
  `closeRun` + `createRun`), Cancel flow (mock `closeRun`), error
  state when `closeRun` fails, disabled state when
  `recommendedSelectedAgentIds` is empty.
- Doc-comment cleanup: update the headers in
  `packages/orch-ref/src/plan-assembly.ts`,
  `packages/orch-ref/src/condition-evaluator.ts`, and
  `tests/orchestration/multi-node-slot-binding.test.ts` to reflect the
  post-Commit-6 state.
- §3.3.4 Layer B amendment (this spec) — ratify the lexical resolver's
  second-pass blocked-alias scan: alias rules with `status: 'blocked'`
  fire `hasBlockedAlias = true` even when no lex-term matches the same
  phrase. Defense-in-depth — explicit prohibitions catch even orphan
  phrases. Tested in `lexical-resolver.test.ts`.

Logs (all CLOSED by green gates + landed work in this commit):
  `DRIFT-UI-CHECKBACK-001` — Cancel + Accept incomplete
  `DRIFT-API-CLOSE-ENDPOINT-001` — /close route missing
  `DRIFT-INTEGRATION-TEST-MISSING-001` — §9.2 integration test
  `DRIFT-TEST-COVERAGE-001` — reducer + modal coverage
  `DRIFT-LEXICAL-BLOCKED-ALIAS-INVENTION-001` — spec ratified

ci:gate boundary count: starts at 80; 81 with `NEXUS_RUN_INTEGRATION=1`.
After Commit 4: 80 + 5 = 85 (or 86 with integration). After Commit 5,
6, 7: maintained. Step numbering is script-managed; spec uses named
gate IDs only.

### §6.3 No hidden fallback law

Three sub-rules:

1. **No LLM fallback** at plan time. Unresolvable → `PlanRejection`.
2. **No fallback to a second factory.** V1 has one factory only.
3. **No cross-branch silent override.** Preflight failure → rejection
   with `RejectionCheckbackPayload`, NOT silent lexical override.
   Workspace must explicitly re-issue with new `selectedAgentIds` for
   the suggestion to take effect.

Four branches MUTUALLY EXCLUSIVE by request shape; selection happens
before any decomposition runs.

### §6.4 Three doc amendments in same arc

- `docs/engineering-specs/AMEND-nexus-spec-orch-v1-1-1.md` — 9 refs
  to `RefDeterministicPlanner` / `'ref-deterministic'` updated.
- `docs/engineering-specs/AMEND-spec-nexus-infra-externals-v0-2-5.md`
  — line 1086 `maxSplitDepth` law revised.
- `docs/blueprints/AMEND-blueprint-nexus-infra-externals-v1-0-0.md`
  — line 312 example value updated.

All three in Commit 7. Per option α — keep parent specs synchronous
with V1 production cut. No stale references for audit team to choose
between.

### §6.5 Package layer law — `packages/planners/*` (NEW)

**Layer position:** `packages/planners/*` is a NEW package layer.
Position in the dependency graph:

```
contracts ────────────────────────────────────┐
runtime-utils ───────────────────────────────┐│
orch-ref (shared primitives via barrel) ─────││──┐
                                              ↓↓  ↓
                                          planners/*
```

**Allowed imports for `packages/planners/*`:**
- `@nexus/contracts`
- `@nexus/runtime-utils`
- `@nexus/orch-ref` (V1 compromise — for the extracted plan-assembly
  + condition-evaluator primitives; cleanup logged as
  `THREAT-ORCH-REF-LAYER-001`)

**Forbidden imports for `packages/planners/*`:**
- `@nexus/core` (governance engine — planners must not couple)
- `@nexus/vanguard` (NVG — separate authority)
- `@nexus/identity-ref` (registries — proxied via `AgentRegistryReader`
  from contracts)
- `@nexus/adapters/*` (transport adapters)
- `@nexus/connectors/*` (data connectors)
- `@nexus/interfaces/*` (CLI, API)
- `@nexus/workspace-ref` (workspace)

**Enforcement:** ci:gate step `PLANNER-LEXICON-05` greps planner
package source files for forbidden import paths. Fail-closed on any
match.

**Future (V2 cleanup):** when `orch-ref` is renamed to `orch-runtime`
OR shared primitives are extracted to `@nexus/orch-primitives`, this
allowlist updates. Logged as `THREAT-ORCH-REF-LAYER-001`.

---

## §7 What Stays Unchanged

- The `Planner`, `PlannerRequest`, `PlannerFactory`, `PlannerFactoryRegistry`,
  `PlannerContext` contract INTERFACES (V1 builds the concrete registry
  implementation; interface is unchanged).
- The `Planner.plan()` return type — UNCHANGED (per row 1 ratification;
  trace exposed via separate `PlannerTraceReader` interface).
- The `ExecutionPlan` shape.
- `PlanRejection` and `PlanRejectionReason` — unchanged.
- `validateExecutionPlan` 14+1 checks.
- Gate 02 governed-verb-lexicon as the alias mapping; ACTION_VERB
  const as the canonical taxonomy.
- Capability registry.
- Mailbox-pit allocation.
- Existing `RunEventType` members (`plan_created`, `plan_rejected`,
  `plan_amended`, `plan_checkback_sent`, etc.). V1 ADDS
  `planner_plan_trace` only.
- Admin API routes displaying plannertype/plannerversion as opaque
  strings.

---

## §8 Out of Scope (Future Amendments)

(unchanged from v0.2.0)

- V2 — SQLite read model, 3-way checkback (Accept/Try-anyway/Restart)
  with `bypassFeasibilityCheck`, same-run resume on Accept-Suggestions,
  capability-first metadata-tier planning, orch-ref → orch-runtime
  rename OR extraction to `@nexus/orch-primitives` package.
- V2+ — Multi-agent multi-model preferences UI.
- V3 — Admin-managed lexicon apply path.
- V4 — Learning from run outcomes (NOT APPROVED).
- LLM-assisted planning (separate amendment).
- governed-verb-lexicon retro-signing (separate hygiene amendment).

---

## §9 Test Plan

### §9.1 Unit tests — `packages/planners/db-lexicon/src/*.test.ts`

(structure unchanged from v0.2.0; addition: tests for
`PlannerTraceReader.getLastTrace()` and `getLastRejectionCheckback()`
stash mechanism — verify the planner instance exposes both correctly
across multiple plan() calls)

Tier dispatch, lexical resolver, capability transformer, workflow
expander, agent assignment, plan emission, trace event, fixture
loader. All four branches covered. Both stash methods tested for
null-on-construct + correct-payload-after-plan().

### §9.2 Integration test — end-to-end

Three scenarios:
1. Lexical decomposition (Branch 4 — §5.1).
2. Preflight pass (Branch 3 — §5.2).
3. Preflight reject + counter-suggest (Branch 3 — §5.3):
   - Assert: `plan_rejected` event present.
   - Assert: `planner_plan_trace` event present.
   - Assert: `plan_checkback_sent` event present with
     `RejectionCheckbackPayload` as detail.
   - Assert: `OrchestratorPlanPreview.rejection` populated with
     `recommendedSelectedAgentIds.length > 0`.
   - Assert: simulated workspace re-issue with corrected agents →
     Branch 3 passes → run proceeds.

### §9.3 Cross-fixture invariant tests

PROMOTED to ci:gate step `PLANNER-LEXICON-02`. Validation content same
as before — for every planner verb canonicalTerm, MUST be in
`ACTION_VERB`; for every capability ID, MUST be in `CAPABILITY_IDS`;
for every system, MUST be in connector manifest.

### §9.4 ci:gate steps (named, NOT numbered)

| Gate ID | What |
|---|---|
| `PLANNER-LEXICON-01` | Fixture signature verification |
| `PLANNER-LEXICON-02` | Cross-fixture invariant (ACTION_VERB, CAPABILITY_IDS, connector manifest) |
| `PLANNER-LEXICON-03` | No-runtime-wordnet (planner package imports no `wordnet` runtime) |
| `PLANNER-LEXICON-04` | No-learning-write-path (planner package has zero `RunLedgerWriter` refs; no fixture write paths) |
| `PLANNER-LEXICON-05` | Package layer law (forbidden imports — §6.5) |

These get appended to the end of `scripts/ci-gate.ts` step list.
Numeric step indices are managed by the script's existing
`totalSteps` calculation (which is conditional on
`NEXUS_RUN_INTEGRATION`). Spec does NOT hard-code numbers.

### §9.5 Parity-with-old-class tests (Risk R2 mitigation)

| Old test concern | New test location |
|---|---|
| RefDeterministicPlanner implements Planner | `db-lexicon-planner.test.ts` |
| plannerType + plannerVersion correct | `db-lexicon-planner.test.ts` |
| Multi-node DAG construction | `db-lexicon-planner.test.ts` (Branches 2, 4) + `plan-assembly.test.ts` |
| Edge construction from edgeHints | `plan-assembly.test.ts` |
| OCT-secure single-node | `db-lexicon-planner.test.ts` (Branch 1) |
| `planFromSubTasks` correctness | `db-lexicon-planner.test.ts` (Branch 2) + `plan-assembly.test.ts` |
| Condition evaluation | `condition-evaluator.test.ts` (moves with extraction) |
| `determineNodeType` correctness | `condition-evaluator.test.ts` |
| Slot binding multi-node | `tests/orchestration/multi-node-slot-binding.test.ts` (updated) |
| maxSplitDepth enforcement | `db-lexicon-planner.test.ts` (Layer E) + loader policy unit |

Parity proof delivered with Commit 4; Commit 6 cannot land without it.

### §9.6 Acceptance criteria

- `pnpm ci:gate` total steps green (script-managed total; 5 named
  PLANNER-LEXICON gates pass).
- `pnpm vitest run` all green.
- `pnpm vitest -c vitest.integration.config.ts` all green.
- Live serve with re-signed manifest produces valid plan for warehouse
  worked example end-to-end (all three integration scenarios).
- UI: Accept Suggestions re-issues to a passing plan; Cancel Run
  closes the original run cleanly.
- Bootstrap fails closed on: missing factory, unsigned fixture,
  cross-fixture invariant violation, manifest pointing to unregistered
  plannertype.
- ci:gate `PLANNER-LEXICON-04` fails closed if any planner package
  file imports `RunLedgerWriter`.
- ci:gate `PLANNER-LEXICON-05` fails closed if any planner package
  file imports a forbidden package (per §6.5 allowlist).

---

## §10 Owner Decisions Needed

### §10.1 Resolved (ratified)

All decisions resolved across audit-and-revise cycle. 30 ratified
items spanning audit-ingest (6 DIFFs), audit-2 (8 issues), C-merge
disposition, preflight V1 scope, audit pass 3 (14 best-solve rows).

### §10.2 No open decisions

Spec is at build-clear point.

---

## §11 Risks (with mitigations)

| # | Risk | Mitigation |
|---|---|---|
| R1 | `evaluateCondition` colocation | Commit 1 extracts BEFORE Commit 6 deletion. Barrel preserves exports. |
| R2 | Deleting old test file removes ~50 proofs | §9.5 parity checklist enforces equivalent coverage before Commit 6. |
| R3 | Parent orch spec drift | §6.4 + Commit 7 amend in same arc. |
| R4 | Signed manifest signature invalidation | Re-sign in Commit 5 same change set. Bootstrap fail-closed on mismatch (loud). |
| R5 | Placeholder/admin UI drift | Updated in Commit 5 same family. |
| R6 | Factory ambiguity mid-amendment | One factory in V1. Bootstrap fail-closed on plannertype mismatch. |
| R7 | Fixture content correctness | V1 covers warehouse worked example + 2-3 others; coverage expansion is fixture-author V2 work. |
| R8 | Cross-fixture drift | ci:gate `PLANNER-LEXICON-02` enforces against ACTION_VERB + CAPABILITY_IDS + connector manifest. |
| R9 | Agent registry projection staleness | Reads through live `AgentRegistryReader` (same as old class). |
| R10 | promptDigest exposure | Trace carries digest only; documented as metadata-tier in §3.6. |
| R11 | maxSplitDepth exhaustion | §3.3.4 Layer E pre-emit check; §3.7.1 loader policy ceiling. |
| R12 | UI re-issue race (suggested agent unavailable between rejection and accept-suggestions) | New run runs preflight again; if stale, fresh rejection surfaces a new checkback. |
| R13 (NEW) | Coordinator duck-type check for `PlannerTraceReader` | Safe — duck-type check (`'getLastTrace' in planner`) returns false for any planner that doesn't implement; coordinator skips ledger emission. Existing Planner-only implementations work unchanged. |
| R14 (NEW) | `OrchestratorPlanPreview.rejection` field on existing callers | Additive optional field; existing serializers + consumers ignore unknown fields per TS structural typing + JSON-tolerant parsing. New code reads it; old code doesn't. |
| R15 (NEW) | Workspace re-issue races on `checkbackSourceRunId` field | Field is informational (audit correlation); no business logic depends on it being non-null. Existing routes pass through. |

---

## §12 Logs to open at build time

```
ADD-PLANNER-LEXICON-001 | spec: §3.6 | RunEventType union | New event `planner_plan_trace` — coordinator-written | downstream: ledger viewer UI, run-timeline | pending build phase | Commit 3
ADD-PLANNER-LEXICON-002 | spec: §3.1, §4.1 | PlannerFactoryRegistry concrete impl + factory class | Real PlannerFactoryRegistryImpl + DbLexiconTransformerPlannerFactory | required for opt-in via manifest | pending build phase | Commit 4
ADD-PLANNER-LEXICON-003 | spec: §2.2 | New fixture directory | fixtures/planner/db-lexicon/*.v1.jsonl signed per exact canonicalization law | requires sign-planner-lexicon-fixtures.sh | pending build phase | Commit 4
ADD-PLANNER-LEXICON-004 | spec: §0.4, §6.2 Commit 2 | New package wiring | packages/planners/db-lexicon/ + pnpm-workspace.yaml (explicit path) + tsconfig.base.json + vitest aliases | pending build phase | Commit 2
ADD-PLANNER-LEXICON-005 | spec: §3.7.1 | maxSplitDepth loader policy | plannertype-scoped allowance | pending build phase | Commit 3
ADD-PLANNER-LEXICON-006 | spec: §9.4 | 5 new ci:gate steps | PLANNER-LEXICON-01..05; appended dynamically | pending build phase | Commit 4
ADD-PLANNER-WIRING-001 | spec: §4.1, §3.7 | Bootstrap + manifest + placeholder + UI | step 17b/18a/22c + orchestrators.v1.yaml re-sign + placeholder-data.ts + plan-checkback-modal.tsx + run-stage-reducer + coordinator trace/checkback emission | pending build phase | Commit 5
INFRA-PLANNER-DELETE-001 | spec: §6.1, §6.2 Commit 6 | Delete RefDeterministicPlanner | class + dedicated test file removed; dependent tests updated | pending build phase | Commit 6
MODULAR-CONDITION-EVALUATOR-001 | spec: §6.2 Commit 1 | Extract shared utilities | evaluateCondition + determineNodeType + types moved | pre-amendment risk mitigation R1 | pending build phase | Commit 1
MODULAR-PLAN-ASSEMBLY-001 | spec: §6.2 Commit 1 | Extract plan-assembly machinery | hasCycle + compareEdges + buildNodeFromSubTask + buildPlan + digest + OCT-secure + planFromSubTasks + agent-selection assembly to plan-assembly.ts | pending build phase | Commit 1
DIFF-ORCH-SPEC-PLANNER-IDENTITY-001 | spec: §6.4 | parent orch spec | AMEND-nexus-spec-orch-v1-1-1.md updated in same arc | pending build phase | Commit 7
DIFF-INFRA-EXTERNALS-SPEC-001 | spec: §6.4 | infra-externals spec | AMEND-spec-nexus-infra-externals-v0-2-5.md line 1086 updated for plannertype-scoped maxSplitDepth | pending build phase | Commit 7
DIFF-INFRA-EXTERNALS-BLUEPRINT-001 | spec: §6.4 | infra-externals blueprint | AMEND-blueprint-nexus-infra-externals-v1-0-0.md line 312 updated | pending build phase | Commit 7
DIFF-PLANNER-LEXICON-001 | spec: §6.3 | no hidden fallback law | preserved + clarified | open, V1-accepted
DIFF-PLANNER-LEXICON-002 | spec: §3.1 | factory contract conformance | matches factories.ts:51-55 | resolved in spec text
DIFF-PLANNER-LEXICON-003 | spec: §3.3.4 Layer B, §9.1 | own tokenizer | LexicalNormalizer untouched | resolved in spec text
DIFF-PLANNER-LEXICON-004 | spec: §5.1 | worked example real capability IDs | matches CAPABILITY_IDS | resolved in spec text
DIFF-PLANNER-LEXICON-005 | spec: §3.2, §3.6 | trace write ownership | coordinator writes via PlannerTraceReader | resolved in spec text
DIFF-PLANNER-LEXICON-CONTRACT-001 | spec: §0.4, §3.7, §13 | three additive contract additions | OrchestratorPlanPreview.rejection field, WorkspaceRunRequest.checkbackSourceRunId field, RejectionCheckbackPayload interface, PlannerTraceReader interface | additive optional; backward-compatible | resolved in spec text | Commit 3
CONTRA-PLANNER-LEXICON-001 | spec: §2.4 | Audit-1 DIFF-05 | REJECTED. ACTION_VERB invariant is LAW. | owner-ratified rejection
CONTRA-PLANNER-LEXICON-002 | spec: §0.3, §3.1, §6 | Audit-2 Blocker #2 | REVERSED to (a) full factory + registry build. | resolved in spec text
BEST-PLANNER-LEXICON-001 | spec: §0.3, §3.3, §6 | C-merge final disposition | resolved in spec text
THREAT-LEXICON-SIGNING-001 | spec: §2.2 | governed-verb-lexicon unsigned | follow-up V2 hygiene
THREAT-ORCH-REF-LAYER-001 | spec: §6.5 | orch-ref shared primitives boundary | V2: extract to orch-primitives package OR rename orch-ref → orch-runtime | follow-up
DEFER-PLANNER-V2-001 | spec: §0.5 | 3-way checkback | requires bypassFeasibilityCheck contract field + threat model | deferred V2
DEFER-PLANNER-V2-002 | spec: §0.5 | multi-agent multi-model preferences | owner-noted | deferred V2+
DEFER-PLANNER-V2-003 | spec: §0.5 | same-run resume on Accept-Suggestions | V1 closes + opens new run instead | deferred V2
DEFER-PLANNER-V2-004 | spec: §0.5 | capability-first metadata-tier planning | V1 metadata + no subTasks + no selectedAgentIds → malformed | deferred V2
```

---

## §13 What this spec does NOT change (and the three additions that ARE made)

**UNCHANGED contracts (interface-level):**

- `Planner` interface — return type, signature, semantics all preserved.
- `PlannerRequest` (and all three sub-types: `Normal`, `Metadata`,
  `OctSecure`).
- `PlannerContext`.
- `PlannerFactory` (interface; the V1 build adds the concrete
  implementation but the interface contract is exactly as
  `packages/contracts/src/externals/factories.ts:51-55` defines).
- `PlannerFactoryRegistry` (interface — the V1 build adds the concrete
  implementation).
- `ExecutionPlan`, `PlanNode`, `PlanEdge`, `PlanRejection`,
  `PlanRejectionReason`, `SuggestedAgent`.
- `validateExecutionPlan`.
- `RunEventType` existing members.
- mailbox-pit V1.
- compile + bypass partials.
- NVG / NXS / Gate 02 / OCT enforcement.

**ADDED contracts (three additive, optional, backward-compatible additions):**

1. `OrchestratorPlanPreview.rejection?: RejectionCheckbackPayload | null`
   — new optional field. Null on success paths; populated on
   rejection-with-suggestions paths. Existing consumers ignore.

2. `WorkspaceRunRequest.checkbackSourceRunId?: Uuid | null` — new
   optional field. Null on fresh runs; populated when run is opened
   via Accept-Suggestions correlating back to the originally-rejected
   run. Existing routes pass through.

3. New interface `RejectionCheckbackPayload` carrying the executable
   counter-suggestion data: `{ reason, reasonDetail, missingCapabilities,
   rejectedSelectedAgentIds, recommendedSelectedAgentIds,
   alternativesByCapability }`.

4. New interface `PlannerTraceReader { getLastTrace(): PlannerPlanTrace | null }`
   — implementable independently of `Planner`. Coordinator detects via
   duck-type check (`'getLastTrace' in planner`). Planners that don't
   produce traces simply don't implement.

5. New `RunEventType` value `planner_plan_trace` (additive enum
   extension; not an interface change but an enum extension).

These five additions are minimal and backward-compatible. The §13
"no contract changes" claim of v0.2.0 was incorrect — v0.2.1 admits
the five additions and accounts for them.

---

## §14 Appendix A — Touched surfaces (upstream/downstream catalog)

(updated from v0.2.0 with contract additions)

### A.1 Surfaces that stay untouched

| Surface | Why safe |
|---|---|
| `RunEventType` existing members | Agnostic of plannertype value; payloads carry plannerType from plan instance. New `planner_plan_trace` member added. |
| `run-stage-reducer.ts` (except small UI wiring) | Consumes events by type name. |
| `admin-ledger.ts:121,124` + `workspace.ts:957` | Consume events by type. |
| `plan-amendment.ts` (5 `plan_amended` emissions) | No plannertype binding. |
| `RefRunCoordinator` class structure (interface-driven via `planner: Planner`) | Takes any `Planner`; reads `PlannerTraceReader` via duck-type. |
| `orchestrator-manifest-schema.ts:43` | Accepts any NonEmptyStringSchema. |
| `admin-setup.ts:615` + `orchestrator-setup-panel.tsx:29,30,42` | Display strings; pass through. |
| `scripts/ci-gate.ts` existing steps | No step bound to class name or plannertype string. 5 new gates appended. |

### A.2 Surfaces that change

| File | Change | Commit |
|---|---|---|
| `scripts/nexus-main.ts:87, :439` | Replace direct instantiation with registry resolution | 5 |
| `packages/orch-ref/src/run-coordinator.ts:39` | Re-point evaluateCondition import | 1 |
| `packages/orch-ref/src/run-coordinator.ts` (NEW logic) | After plan(): read trace via duck-type; emit `planner_plan_trace`; if rejection has checkback payload, emit `plan_checkback_sent`; attach to `OrchestratorPlanPreview.rejection` | 5 |
| `packages/orch-ref/src/index.ts` | Re-export from new files; remove `RefDeterministicPlanner` after Commit 6 | 1 + 6 |
| `packages/orch-ref/src/dag-executor.test.ts:30,77,125` | Re-point evaluateCondition import; update string constants | 1 + 6 |
| `packages/workspace-ref/src/client/components/admin/placeholder/placeholder-data.ts:320-321` | Update placeholder values | 5 |
| `config/orchestrators/orchestrators.v1.yaml:24-25` (signed) | plannerType, plannerVersion, maxSplitDepth; re-sign | 5 |
| `packages/core/src/manifest/orchestrators/orchestrator-manifest-loader.ts:75-78` | Plannertype-scoped max-split-depth policy | 3 |
| `packages/contracts/src/interfaces/index.ts:914-927` (RunEventType) | Add `planner_plan_trace` | 3 |
| `packages/contracts/src/externals/planner.ts` | Add `PlannerTraceReader` interface | 3 |
| `packages/contracts/src/externals/orchestrator.ts` | Add `rejection` field to `OrchestratorPlanPreview`; add `RejectionCheckbackPayload` interface | 3 |
| `packages/contracts/src/externals/workspace.ts` | Add `checkbackSourceRunId` field to `WorkspaceRunRequest` | 3 |
| `packages/orch-ref/src/orch-lifecycle.test.ts:39,58,72,138` | Update class import + string constants | 6 |
| `packages/orch-ref/src/coordinator-amendment.test.ts:81,115,129,791,896` | Update string constants | 6 |
| `tests/orchestration/multi-node-slot-binding.test.ts:4,52,116,130,266,492` | Replace class instantiation with new planner via factory | 6 |
| `docs/engineering-specs/AMEND-nexus-spec-orch-v1-1-1.md` (9 refs) | Update | 7 |
| `docs/engineering-specs/AMEND-spec-nexus-infra-externals-v0-2-5.md:1086` | Update maxSplitDepth law | 7 |
| `docs/blueprints/AMEND-blueprint-nexus-infra-externals-v1-0-0.md:312` | Update example value | 7 |
| `docs/STATUS-MULTI-NODE-PLANNER.md:21` | Update reference | 7 |
| `packages/interfaces/api/src/routes/workspace.ts` | Pass through `checkbackSourceRunId` field on request | 5 |

### A.3 Surfaces that get deleted

| File | Commit |
|---|---|
| `packages/orch-ref/src/ref-deterministic-planner.ts` (class portion) | 6 |
| `packages/orch-ref/src/ref-deterministic-planner.test.ts` | 6 |
| `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-1-0.md` | 2 |
| `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-0.md` | 2 |

### A.4 Surfaces that get added

| File | Commit |
|---|---|
| `packages/orch-ref/src/condition-evaluator.ts` | 1 |
| `packages/orch-ref/src/plan-assembly.ts` | 1 |
| `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-1.md` (this file) | 2 |
| `packages/planners/db-lexicon/` package | 2 (skeleton) + 4 (full) |
| `packages/core/src/manifest/planners/planner-factory-registry.ts` | 4 |
| `fixtures/planner/db-lexicon/*.v1.jsonl` (8 fixture files) | 4 |
| `scripts/sign-planner-lexicon-fixtures.sh` | 4 |
| 5 named ci:gate steps in `scripts/ci-gate.ts` | 4 |
| `packages/workspace-ref/src/client/components/plan-checkback-modal.tsx` | 5 |
| Re-signed `config/orchestrators/orchestrators.v1.yaml` | 5 |
| New `RejectionCheckbackPayload` interface in contracts | 3 |
| New `PlannerTraceReader` interface in contracts | 3 |
| New `OrchestratorPlanPreview.rejection` optional field in contracts | 3 |
| New `WorkspaceRunRequest.checkbackSourceRunId` optional field in contracts | 3 |

---

End of spec v0.2.1. **Build-clear.** Begin Phase D Commit 1.
