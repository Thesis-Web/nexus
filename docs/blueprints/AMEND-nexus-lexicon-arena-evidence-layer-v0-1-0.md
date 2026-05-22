# AMEND — Nexus Lexicon Arena Evidence & Path-Outcome Layer v0.1.0

**Status:** DRAFT — builder-ready, owner ratification required before implementation  
**Owner:** James Huson / Lake Area LLC  
**Prepared for:** Claude Code controlled builder  
**Prepared by:** ChatGPT audit/spec pass over `nexus-feat-beta1-admin-dashboard (21).zip` + Discord/SaltyPatron export  
**Date:** 2026-05-22  
**Canonical planner name to preserve:** `DbLexiconTransformerPlanner`  
**Canonical planner type to preserve:** `db-lexicon-transformer-v0`  
**Canonical package to preserve:** `@nexus/planner-db-lexicon`  

---

## 0. Audit disposition

### 0.1 What already exists

The current repo already contains a real lexicon/DAG/planner foundation:

- `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-1.md`
- `docs/blueprints/AMEND-nexus-lexicon-admin-ui-v0-2-0.md`
- `docs/blueprints/AMEND-nexus-lexicon-mini-substrate-v0-1-0.md`
- `packages/planners/db-lexicon/src/db-lexicon-planner.ts`
- `packages/planners/db-lexicon/src/internal/types.ts`
- `packages/planners/db-lexicon/src/internal/lexical-resolver.ts`
- `packages/planners/db-lexicon/src/internal/lexical-decomposition.ts`
- `packages/orch-ref/src/dag-executor.ts`
- `fixtures/planner/db-lexicon/*.jsonl`
- `fixtures/lexicon/governed-verb-lexicon.v1.json`
- `fixtures/lexicon/wordnet-candidate-aliases.v1.json`

The current planner data model already has these eight signed fixture-backed tables:

- `planner_lexical_term`
- `planner_alias_rule`
- `planner_task_intent`
- `planner_task_capability`
- `planner_target_catalog`
- `planner_workflow_template`
- `planner_workflow_node`
- `planner_workflow_edge`

The current implementation also has `PlannerPlanTrace`, `planner_plan_trace`, `unmapped_prompt`, `lexicon_signal`, and a checkback path, but those surfaces are not yet a full path-confidence/evidence/outcome substrate.

### 0.2 What is partial but not complete

`AMEND-nexus-lexicon-mini-substrate-v0-1-0.md` already names the beginning of the fourth layer:

- `lexicon_arena`
- `lexicon_confidence`
- arena-scoped A* search
- `lexicon_guard`
- `lexicon_mutation_log`

That is not enough for the Nexus orchestrator goal because it lacks explicit, queryable records for:

- path evidence/provenance;
- path assertions;
- path contradictions;
- path requirements/completeness;
- run outcomes tied back to planner paths;
- typed failure prediction;
- typed checkback template selection;
- coverage gates proving each E2E wall run maps through the lexicon.

### 0.3 Current record-count proof that coverage is still thin

Current `fixtures/planner/db-lexicon/*.jsonl` record counts in the inspected zip:

| Fixture | Records excluding signed header |
|---|---:|
| `planner-lexical-term.v1.jsonl` | 22 |
| `planner-alias-rule.v1.jsonl` | 3 |
| `planner-task-intent.v1.jsonl` | 3 |
| `planner-task-capability.v1.jsonl` | 3 |
| `planner-target-catalog.v1.jsonl` | 6 |
| `planner-workflow-template.v1.jsonl` | 3 |
| `planner-workflow-node.v1.jsonl` | 5 |
| `planner-workflow-edge.v1.jsonl` | 2 |

This is enough to prove mechanism; it is not enough to cover full Nexus orchestration.

### 0.4 Decision

A full production spec for the fourth layer does **not** exist in the current repo snapshot.

This amendment fills that missing spec while preserving existing naming and layering.

---

## 1. Purpose

Add the fourth level of the Nexus lexicon stack:

1. **Lexicon** — Nexus-specific words, aliases, verbs, targets, intents.
2. **WordNet seed** — offline candidate alias/source material; never runtime authority.
3. **DAG / workflow graph** — prompt-to-intent-to-template-to-node/edge/slot composition.
4. **Arena Evidence & Path-Outcome Layer** — confidence, evidence, contradiction, requirements, run outcomes, failure prediction, and checkback templates.

The fourth layer lets the orchestrator answer, before dispatch:

- Is this prompt path known?
- Is this path supported by evidence?
- Is this path contradicted by stronger evidence?
- Is this path complete enough to execute?
- Which slots/capabilities/connectors/agents/endpoints/mailboxes are required?
- Which requirements are missing?
- Is this likely to fail before NXS/NVG execution?
- Should the operator receive a typed checkback instead of a guessed plan?
- Which E2E wall category does this path cover?

This layer does **not** make the lexicon a full LLM. It makes the existing `DbLexiconTransformerPlanner` a safer, evidence-aware operating grammar for Nexus.

---

## 2. Non-negotiable laws

### 2.1 No hidden runtime learning

Runtime prompts may produce `unmapped_prompt`, `lexicon_signal`, `lexicon_path_outcome`, and review-queue records. Runtime prompts MUST NOT directly mutate lexicon truth/confidence/path tables.

All mutation of authoritative lexicon/path records goes through the existing `lexicon_mutation` SigningCouncil operation with 2 distinct admin signatures.

### 2.2 Planner authority remains bounded

The planner MAY reject for orchestration feasibility reasons.

The planner MUST NOT:

- authorize actions;
- deny on governance/policy grounds;
- replace NXS Gate 01-07;
- replace NVG routing/firewall classification;
- select final model endpoint;
- approve external transmission;
- mutate target systems;
- write ledger directly;
- skip mailbox/compile/return.

The fourth layer only supports feasibility and planning confidence.

### 2.3 Frequency is not truth

A phrase/path may be frequent and still false, unsafe, ambiguous, or forbidden.

Therefore the system MUST keep these concepts separate:

- frequency/compression usefulness;
- path confidence;
- truth/assertion confidence;
- operational utility;
- safety/governance classification;
- E2E coverage state.

### 2.4 WordNet is offline seed material only

`fixtures/lexicon/wordnet-candidate-aliases.v1.json` remains a candidate source. Runtime planner packages MUST NOT import WordNet libraries or generated WordNet data.

`pnpm ci:gate` already has a no-runtime-WordNet gate for `@nexus/planner-db-lexicon`; this amendment must preserve and extend that invariant.

### 2.5 Do not copy Hartonomous implementation details

The Discord/SaltyPatron material establishes high-level principles: substrate, ETL seeding, path scoring, truth clustering/lie scattering, graph traversal, and evidence/significance arenas.

This amendment does not clone his implementation. It adapts only the allowed high-level pattern into a small Nexus-specific orch lexicon layer.

---

## 3. Naming and existing surfaces to preserve

### 3.1 Canonical names

Builder MUST preserve these exact names:

- Package: `@nexus/planner-db-lexicon`
- Planner class: `DbLexiconTransformerPlanner`
- Factory class: `DbLexiconTransformerPlannerFactory`
- Planner type: `db-lexicon-transformer-v0`
- Fixture root: `fixtures/planner/db-lexicon/`
- Current fixture names:
  - `planner-lexical-term.v1.jsonl`
  - `planner-alias-rule.v1.jsonl`
  - `planner-task-intent.v1.jsonl`
  - `planner-task-capability.v1.jsonl`
  - `planner-target-catalog.v1.jsonl`
  - `planner-workflow-template.v1.jsonl`
  - `planner-workflow-node.v1.jsonl`
  - `planner-workflow-edge.v1.jsonl`
- Existing trace event: `planner_plan_trace`
- Existing mutation operation: `lexicon_mutation`
- Existing review events: `unmapped_prompt`, `lexicon_signal`

### 3.2 Known naming defect to check before build

`docs/blueprints/AMEND-nexus-admin-dashboard-full-buildout-v0-1-0.md` contains this stale/incorrect enum text:

```ts
plannerType: enum('nvg-deterministic', 'db-lexicon-transformer')
```

That is not the canonical planner type. Builder must not propagate `db-lexicon-transformer`.

Correct value:

```ts
plannerType: 'db-lexicon-transformer-v0'
```

If this stale name exists in executable code, fix it with tests. If it exists only in docs, log it as a documentation drift item unless this build scope explicitly includes doc cleanup.

---

## 4. Data model

### 4.1 Existing Phase 2 mini-substrate tables remain law

This amendment extends, but does not replace, the existing Phase 2 mini-substrate tables:

```sql
lexicon_entity
lexicon_edge
lexicon_arena
lexicon_confidence
workflow_template
lexicon_guard
lexicon_mutation_log
```

The existing mini-substrate spec is still valid. This amendment adds the missing operational evidence/path layer.

### 4.2 New table: `lexicon_path_profile`

Purpose: one normalized confidence/coverage/completeness row for every planner-relevant path or graph object.

```sql
CREATE TABLE lexicon_path_profile (
  path_id              TEXT PRIMARY KEY,
  path_kind            TEXT NOT NULL CHECK (path_kind IN (
    'lexical_term',
    'alias_rule',
    'task_intent',
    'task_capability',
    'target_catalog',
    'workflow_template',
    'workflow_node',
    'workflow_edge',
    'entity',
    'edge',
    'guard',
    'checkback_template'
  )),
  source_ref           TEXT NOT NULL,
  arena_id             TEXT NOT NULL,
  confidence_score     REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  completeness_score   REAL NOT NULL CHECK (completeness_score >= 0 AND completeness_score <= 1),
  failure_likelihood   REAL NOT NULL CHECK (failure_likelihood >= 0 AND failure_likelihood <= 1),
  promotion_status     TEXT NOT NULL CHECK (promotion_status IN (
    'candidate',
    'confirmed',
    'contradicted',
    'deprecated',
    'blocked'
  )),
  coverage_category    TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  mutation_id          TEXT NOT NULL,
  FOREIGN KEY (arena_id) REFERENCES lexicon_arena(arena_id)
);

CREATE INDEX idx_lexicon_path_profile_kind ON lexicon_path_profile(path_kind);
CREATE INDEX idx_lexicon_path_profile_arena_score ON lexicon_path_profile(arena_id, confidence_score DESC);
CREATE INDEX idx_lexicon_path_profile_status ON lexicon_path_profile(promotion_status);
CREATE INDEX idx_lexicon_path_profile_source_ref ON lexicon_path_profile(source_ref);
```

`source_ref` is the existing object id or deterministic fixture key. Examples:

- `planner_task_intent:inventory.adjust_from_receiving`
- `planner_workflow_template:workflow_inventory_adjust_from_receiving_v1`
- `planner_workflow_node:workflow_inventory_adjust_from_receiving_v1/read_inventory`
- `planner_alias_rule:drop table`
- `lexicon_entity:verb_pull`

### 4.3 New table: `lexicon_path_evidence`

Purpose: explicit provenance for why a path is trusted, blocked, deprecated, or ambiguous.

```sql
CREATE TABLE lexicon_path_evidence (
  evidence_id          TEXT PRIMARY KEY,
  path_id              TEXT NOT NULL,
  evidence_kind        TEXT NOT NULL CHECK (evidence_kind IN (
    'owner_ruling',
    'blueprint_pin',
    'engineering_spec_pin',
    'outline_pin',
    'signed_fixture',
    'unit_test',
    'integration_test',
    'e2e_test',
    'run_outcome',
    'admin_mutation',
    'wordnet_seed',
    'manual_seed'
  )),
  source_ref           TEXT NOT NULL,
  source_digest        TEXT NOT NULL,
  independence_group   TEXT NOT NULL,
  confidence_delta     REAL NOT NULL CHECK (confidence_delta >= -1 AND confidence_delta <= 1),
  evidence_summary     TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  mutation_id          TEXT NOT NULL,
  FOREIGN KEY (path_id) REFERENCES lexicon_path_profile(path_id)
);

CREATE INDEX idx_lexicon_path_evidence_path ON lexicon_path_evidence(path_id);
CREATE INDEX idx_lexicon_path_evidence_kind ON lexicon_path_evidence(evidence_kind);
CREATE INDEX idx_lexicon_path_evidence_independence ON lexicon_path_evidence(independence_group);
```

Rules:

- Multiple evidence rows from the same `independence_group` MUST NOT be counted as independent confirmations.
- Evidence can raise or lower confidence.
- Evidence summaries must never contain raw secrets or full raw prompt text.
- For prompt-derived evidence, store digest + safe summary only.

### 4.4 New table: `lexicon_path_contradiction`

Purpose: model conflict explicitly so bad/unsafe/false paths scatter rather than silently attach.

```sql
CREATE TABLE lexicon_path_contradiction (
  contradiction_id     TEXT PRIMARY KEY,
  path_id_a            TEXT NOT NULL,
  path_id_b            TEXT NOT NULL,
  contradiction_kind   TEXT NOT NULL CHECK (contradiction_kind IN (
    'semantic_conflict',
    'capability_conflict',
    'target_conflict',
    'slot_contract_conflict',
    'governance_class_conflict',
    'stale_superseded_path',
    'test_failure_conflict'
  )),
  severity             TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  resolver_status      TEXT NOT NULL CHECK (resolver_status IN (
    'open',
    'accepted_a',
    'accepted_b',
    'both_deprecated',
    'owner_ruling_required'
  )),
  summary              TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  resolved_at          TEXT,
  mutation_id          TEXT NOT NULL,
  FOREIGN KEY (path_id_a) REFERENCES lexicon_path_profile(path_id),
  FOREIGN KEY (path_id_b) REFERENCES lexicon_path_profile(path_id)
);

CREATE INDEX idx_lexicon_path_contradiction_a ON lexicon_path_contradiction(path_id_a);
CREATE INDEX idx_lexicon_path_contradiction_b ON lexicon_path_contradiction(path_id_b);
CREATE INDEX idx_lexicon_path_contradiction_status ON lexicon_path_contradiction(resolver_status);
```

### 4.5 New table: `lexicon_path_requirement`

Purpose: make missing pieces explicit before run dispatch.

```sql
CREATE TABLE lexicon_path_requirement (
  requirement_id       TEXT PRIMARY KEY,
  path_id              TEXT NOT NULL,
  requirement_kind     TEXT NOT NULL CHECK (requirement_kind IN (
    'capability',
    'agent',
    'target_system',
    'connector',
    'model_tier_hint',
    'mailbox',
    'compile_template',
    'slot_read',
    'slot_write',
    'approval_channel',
    'admin_signature',
    'policy_bundle',
    'identity_claim',
    'environment'
  )),
  requirement_ref      TEXT NOT NULL,
  required             INTEGER NOT NULL CHECK (required IN (0, 1)),
  checkback_if_missing INTEGER NOT NULL CHECK (checkback_if_missing IN (0, 1)),
  failure_code         TEXT,
  created_at           TEXT NOT NULL,
  mutation_id          TEXT NOT NULL,
  FOREIGN KEY (path_id) REFERENCES lexicon_path_profile(path_id)
);

CREATE INDEX idx_lexicon_path_requirement_path ON lexicon_path_requirement(path_id);
CREATE INDEX idx_lexicon_path_requirement_kind ON lexicon_path_requirement(requirement_kind);
```

### 4.6 New table: `lexicon_path_outcome`

Purpose: tie real run outcomes back to the path that produced the plan.

```sql
CREATE TABLE lexicon_path_outcome (
  outcome_id           TEXT PRIMARY KEY,
  path_id              TEXT NOT NULL,
  run_id               TEXT NOT NULL,
  plan_id              TEXT,
  outcome_kind         TEXT NOT NULL CHECK (outcome_kind IN (
    'planned',
    'executed',
    'checkback_sent',
    'checkback_accepted',
    'checkback_cancelled',
    'rejected_unmappable',
    'rejected_no_capable_agent',
    'rejected_capability_outside_ceiling',
    'rejected_structural_constraint',
    'rejected_malformed',
    'node_failed',
    'node_timed_out',
    'dag_failed',
    'dag_partial_complete',
    'compile_skipped',
    'final_response_emitted'
  )),
  failure_code         TEXT,
  failure_summary      TEXT,
  run_ledger_ref       TEXT,
  evidence_record_ref  TEXT,
  created_at           TEXT NOT NULL,
  FOREIGN KEY (path_id) REFERENCES lexicon_path_profile(path_id)
);

CREATE INDEX idx_lexicon_path_outcome_path ON lexicon_path_outcome(path_id);
CREATE INDEX idx_lexicon_path_outcome_run ON lexicon_path_outcome(run_id);
CREATE INDEX idx_lexicon_path_outcome_kind ON lexicon_path_outcome(outcome_kind);
```

Rules:

- `lexicon_path_outcome` is a projection/index of run results, not a replacement for the Run Ledger or Evidence Ledger.
- Raw evidence remains in existing ledgers.
- This table may contain references/digests only.

### 4.7 New table: `lexicon_checkback_template`

Purpose: deterministic typed checkback messages for known missing/ambiguous path states.

```sql
CREATE TABLE lexicon_checkback_template (
  template_id          TEXT PRIMARY KEY,
  checkback_kind       TEXT NOT NULL CHECK (checkback_kind IN (
    'ambiguous_intent',
    'missing_capability',
    'missing_agent',
    'missing_connector',
    'missing_target_system',
    'missing_slot',
    'missing_compile_template',
    'missing_mailbox',
    'approval_required',
    'admin_signature_required',
    'likely_run_failure',
    'unsupported_path'
  )),
  prompt_title         TEXT NOT NULL,
  operator_question    TEXT NOT NULL,
  safe_options_json    TEXT NOT NULL,
  default_action       TEXT NOT NULL CHECK (default_action IN (
    'cancel',
    'accept_suggestion',
    'choose_option',
    'open_admin_setup',
    'request_owner_ruling'
  )),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  mutation_id          TEXT NOT NULL
);

CREATE INDEX idx_lexicon_checkback_template_kind ON lexicon_checkback_template(checkback_kind);
```

### 4.8 Optional table: `lexicon_assertion`

Purpose: only for Nexus-operational claims, not general-world truth.

```sql
CREATE TABLE lexicon_assertion (
  assertion_id         TEXT PRIMARY KEY,
  subject_ref          TEXT NOT NULL,
  predicate            TEXT NOT NULL,
  object_ref           TEXT NOT NULL,
  arena_id             TEXT NOT NULL,
  assertion_status     TEXT NOT NULL CHECK (assertion_status IN (
    'candidate',
    'confirmed',
    'contradicted',
    'deprecated',
    'blocked'
  )),
  confidence_score     REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  evidence_count       INTEGER NOT NULL DEFAULT 0,
  contradiction_count  INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  mutation_id          TEXT NOT NULL,
  FOREIGN KEY (arena_id) REFERENCES lexicon_arena(arena_id)
);
```

V1 builder may defer this table if not needed for E2E lexicon-path coverage. Do not build a general fact database.

---

## 5. Runtime algorithm

### 5.1 Existing planner chain remains intact

`DbLexiconTransformerPlanner.plan()` continues to follow the existing four-branch dispatch:

1. chat tier;
2. pre-resolved `subTasks` DAG;
3. preflight preferred agents;
4. lexical decomposition.

This amendment modifies only the lexical/decomposition/preflight path by adding path scoring and requirement checks before a plan is returned.

### 5.2 Path scoring phase

After lexical resolution and before final template selection:

1. Resolve lexical matches.
2. Produce candidate intents.
3. Produce candidate workflow templates.
4. Build deterministic `path_id` candidates for each candidate intent/template/node/edge chain.
5. Query path profiles for the active arena.
6. Join requirements, contradictions, and evidence summaries.
7. Compute `PathFeasibilityResult`.

### 5.3 `PathFeasibilityResult`

Add a package-local type in `packages/planners/db-lexicon/src/internal/path-confidence.ts` or equivalent:

```ts
export type PathFeasibilityOutcome =
  | 'executable'
  | 'typed_checkback'
  | 'unsupported_path'
  | 'blocked_path'
  | 'contradicted_path'
  | 'likely_failure';

export interface PathFeasibilityResult {
  readonly pathId: NonEmpty;
  readonly outcome: PathFeasibilityOutcome;
  readonly confidenceScore: number;
  readonly completenessScore: number;
  readonly failureLikelihood: number;
  readonly missingRequirements: ReadonlyArray<{
    readonly requirementKind: NonEmpty;
    readonly requirementRef: NonEmpty;
    readonly failureCode: NonEmpty | null;
  }>;
  readonly openContradictions: ReadonlyArray<NonEmpty>;
  readonly checkbackTemplateId: NonEmpty | null;
  readonly evidenceRefs: ReadonlyArray<NonEmpty>;
}
```

### 5.4 Feasibility thresholds

Initial thresholds, to be constants in the planner package:

```ts
MIN_EXECUTABLE_CONFIDENCE = 0.75
MIN_EXECUTABLE_COMPLETENESS = 1.0
MAX_EXECUTABLE_FAILURE_LIKELIHOOD = 0.25
```

Rules:

- `promotion_status === 'blocked'` → reject with `structural_constraint` or `unmappable_request` depending current contract fit.
- open critical contradiction → typed checkback or owner-ruling-required; no executable plan.
- missing required capability/agent → existing `no_capable_agent` path with `RejectionCheckbackPayload` where possible.
- missing target connector/system/mailbox/compile template → typed checkback if a setup path exists, otherwise `unmappable_request` with explicit reason.
- low confidence but otherwise complete → typed checkback, not guessed execution.
- high failure likelihood → typed checkback with predicted failure reason.

### 5.5 Trace extension

Extend `PlannerPlanTrace` additively if needed, or add a sibling trace detail object, without breaking existing consumers.

Recommended additive fields:

```ts
pathConfidence?: {
  selectedPathId: NonEmpty | null;
  candidatePathIds: NonEmpty[];
  confidenceScore: number | null;
  completenessScore: number | null;
  failureLikelihood: number | null;
  missingRequirements: ReadonlyArray<{
    requirementKind: NonEmpty;
    requirementRef: NonEmpty;
    failureCode: NonEmpty | null;
  }>;
  openContradictionIds: NonEmpty[];
  checkbackTemplateId: NonEmpty | null;
} | null;
```

If adding fields to `PlannerPlanTrace` causes a wide contract break, create an internal `PathConfidenceTrace` and emit it inside `planner_plan_trace.detail.pathConfidence` only at the coordinator projection point. Do not rewrite all trace consumers unless necessary.

---

## 6. Mutation model

### 6.1 Extend `LexiconMutation`

Current `LexiconMutation` lives in `packages/contracts/src/interfaces/index.ts` in the inspected repo. The admin-ui spec says `packages/contracts/src/lexicon/`, but the repo state is the source of truth for this build.

Builder must inspect exports before editing. Do not move the type unless required and fully covered by exports/tests.

Add variants only if implementing mutation for the new fourth-layer tables:

```ts
type LexiconMutation =
  | existing variants
  | { kind: 'path_profile_add'; profile: LexiconPathProfile }
  | { kind: 'path_profile_update'; pathId: NonEmpty; patch: Partial<LexiconPathProfile> }
  | { kind: 'path_profile_disable'; pathId: NonEmpty }
  | { kind: 'path_evidence_add'; evidence: LexiconPathEvidence }
  | { kind: 'path_contradiction_add'; contradiction: LexiconPathContradiction }
  | { kind: 'path_contradiction_resolve'; contradictionId: NonEmpty; resolverStatus: NonEmpty }
  | { kind: 'path_requirement_add'; requirement: LexiconPathRequirement }
  | { kind: 'path_requirement_update'; requirementId: NonEmpty; patch: Partial<LexiconPathRequirement> }
  | { kind: 'checkback_template_add'; template: LexiconCheckbackTemplate }
  | { kind: 'checkback_template_update'; templateId: NonEmpty; patch: Partial<LexiconCheckbackTemplate> };
```

### 6.2 JSONL backend compatibility

Current Phase 1 executor is `JsonlLexiconMutationExecutor`.

If SQLite mini-substrate is not yet implemented, add JSONL targets first:

- `fixtures/lexicon/lexicon_path_profile.jsonl`
- `fixtures/lexicon/lexicon_path_evidence.jsonl`
- `fixtures/lexicon/lexicon_path_contradiction.jsonl`
- `fixtures/lexicon/lexicon_path_requirement.jsonl`
- `fixtures/lexicon/lexicon_checkback_template.jsonl`
- optional `fixtures/lexicon/lexicon_assertion.jsonl`

These are mutation-log append targets only. They do not replace signed planner fixtures.

### 6.3 SQLite backend compatibility

When Phase 2 SQLite exists, `SqliteLexiconMutationExecutor` must apply the same variants transactionally and write `lexicon_mutation_log`.

If SQLite is absent, do not pretend SQLite is implemented. Keep the JSONL apply path and log SQLite as a follow-on.

---

## 7. Admin dashboard scope

### 7.1 Admin UI may manage fourth-layer records

Admin dashboard may expose:

- path profile viewer/editor;
- path evidence viewer;
- contradiction queue;
- missing-requirement queue;
- checkback-template editor;
- run-outcome projection viewer;
- E2E coverage matrix for lexicon paths.

### 7.2 Admin UI must not become runtime data plane

Admin dashboard MUST NOT:

- execute target-system actions directly;
- call LLMs directly;
- append run/evidence ledger directly;
- bypass SigningCouncil for authoritative mutations;
- expose secrets to frontend;
- mark a path confirmed from a runtime prompt without 2-admin mutation;
- modify NXS/NVG policy decisions.

### 7.3 Review queues

Existing `unmapped_prompt` and `lexicon_signal` should feed review queues.

Add queue projections for:

- `path_likely_failure`;
- `path_missing_requirement`;
- `path_contradiction_open`;
- `path_e2e_coverage_gap`.

Do not add raw prompt text to queues unless existing privacy law allows it. Prefer prompt digest + safe preview.

---

## 8. E2E lexicon-specific acceptance wall

This amendment requires a focused 15-run lexicon wall in addition to the wider 120-test wall.

### 8.1 Location

Preferred location:

```text
tests/e2e/13-lexicon-path-confidence/lexicon-path-confidence.e2e.test.ts
```

If the current e2e folder shape differs, use the existing e2e convention and document the path in the build log.

### 8.2 Harness requirement

Tests must spin up the real runtime surfaces where feasible:

- server/composition root;
- workspace auth;
- orchestrator;
- planner `db-lexicon-transformer-v0`;
- mailbox;
- compile;
- configured deterministic/local test connectors where needed;
- Docker-backed services when already part of the repo/harness.

Do not fake green by directly calling planner internals for E2E. Unit tests may call internals; E2E must drive through workspace/API.

### 8.3 Required 15 lexicon E2E cases

| ID | Required behavior |
|---|---|
| LEX-E2E-01-chat-path-known | free-chat prompt maps through chat branch; trace shows no NXS target and no lexicon mutation |
| LEX-E2E-02-single-nxs-read | prompt maps to NXS read/search target; path profile selected; run executes or fails only at real gate/connector |
| LEX-E2E-03-read-nvg-summarize | NXS read result feeds NVG summarize through mailbox slot; selected path has slot requirements satisfied |
| LEX-E2E-04-nxs-nvg-nxs-update | known three-node workflow read → compute → write uses DAG edges and slot bindings; no direct target bypass |
| LEX-E2E-05-multi-agent-parallel | prompt maps to parallel multi-agent fanout; path profile records multi-node template confidence |
| LEX-E2E-06-multi-agent-sequential | prompt maps to sequential DAG with data dependency; downstream waits for upstream slot |
| LEX-E2E-07-conditional-branch | prompt maps to conditional edge; condition false skips downstream deterministically |
| LEX-E2E-08-multi-loop-callback | ambiguous prompt triggers typed checkback; user accepts suggestion; new run carries `checkbackSourceRunId` |
| LEX-E2E-09-missing-agent-checkback | required capability exists in path but no visible capable agent; typed checkback, no fake dispatch |
| LEX-E2E-10-missing-connector-checkback | target system requirement missing/disabled; typed setup/checkback, no direct connector call |
| LEX-E2E-11-blocked-alias | blocked alias such as `drop table` or `delete everything` scatters to blocked path; no action plan |
| LEX-E2E-12-review-required-alias | review-required alias produces checkback/review result, not executable plan |
| LEX-E2E-13-contradicted-path | seeded contradiction prevents executable plan and surfaces owner-ruling/checkback reason |
| LEX-E2E-14-likely-failure | seeded high `failure_likelihood` path returns typed likely-failure checkback before dispatch |
| LEX-E2E-15-runtime-signal-no-mutation | unmapped prompt emits review signal/outcome projection; lexicon authoritative files/tables unchanged |

### 8.4 Test standards

Forbidden tests:

- snapshot-only tests;
- tests that assert only “button exists”;
- tests that directly insert DB rows for the path under test unless testing the lower-level DAO only;
- tests that accept any 2xx response as success;
- tests that mark skipped E2Es as “green”;
- tests that mock NXS/NVG/mailbox/compile in E2E;
- tests that mutate lexicon from runtime prompt;
- tests that rely on console logs as proof.

Required assertions per E2E:

- authenticated user identity;
- planner type is `db-lexicon-transformer-v0`;
- `planner_plan_trace` exists where applicable;
- selected/candidate path confidence appears in trace/projection;
- final run outcome matches expected;
- mailbox/slot behavior is real when used;
- no unauthorized target-system bypass;
- lexicon mutation state unchanged unless test explicitly goes through SigningCouncil mutation flow.

---

## 9. Unit/integration tests

### 9.1 Unit tests

Add unit tests for:

- deterministic `path_id` construction;
- path profile lookup by source ref;
- evidence independence grouping;
- confidence threshold classification;
- contradiction blocks executable path;
- missing requirement maps to correct checkback template;
- run outcome projection does not write authoritative lexicon mutation;
- no runtime WordNet import;
- no planner import from core/vanguard/identity/adapters/connectors/interfaces beyond existing allowed law.

### 9.2 Integration tests

Add integration tests for:

- `LexiconMutationExecutor` handles new path mutation variants through SigningCouncil 2-of-2;
- below-threshold signer rejected;
- duplicate signer rejected;
- JSONL backend appends canonical line for path profile/evidence/contradiction/requirement/template;
- hot reload/reader sees path profile update if current architecture supports reload;
- path outcome projection writes from run ledger refs without mutating source path profile;
- path confidence trace appears in coordinator-written `planner_plan_trace`.

### 9.3 Static gates

Extend `scripts/ci-gate.ts` with named gates, not hard-coded step numbers:

- `PLANNER-PATH-01` — required fourth-layer fixture/table files exist when feature flag enabled.
- `PLANNER-PATH-02` — no runtime WordNet imports in `@nexus/planner-db-lexicon`.
- `PLANNER-PATH-03` — planner package import law remains intact.
- `PLANNER-PATH-04` — no runtime code path imports or invokes `LexiconMutationExecutor.apply`.
- `PLANNER-PATH-05` — no skipped tests under `tests/e2e/13-lexicon-path-confidence`.
- `PLANNER-PATH-06` — stale planner type `db-lexicon-transformer` not present in executable code/config.
- `PLANNER-PATH-07` — every path profile with `promotion_status='confirmed'` has at least one evidence row.
- `PLANNER-PATH-08` — every workflow template path has requirement rows for its declared capabilities and expected slots.

---

## 10. Implementation phases

### Phase 0 — verify current state before editing

Commands:

```bash
cd ~/repos/nexus || exit 1
pwd
git status --short
git log --oneline -12

pnpm gate:no-wildcard-authority || true
pnpm gate:no-e2e-skip || true
pnpm typecheck
pnpm format:check
pnpm test:e2e
```

If script names differ from this repo snapshot, inspect `package.json` and use the existing script names. Do not invent successful commands.

Create local-only build log:

```bash
cd ~/repos/nexus || exit 1
mkdir -p .local-ops
touch .git/info/exclude
grep -qxF ".local-ops/" .git/info/exclude || echo ".local-ops/" >> .git/info/exclude
cat > .local-ops/lexicon-arena-evidence-layer-log.md <<'LOG'
# Lexicon Arena Evidence Layer build log

LOG
```

### Phase 1 — inspect for existing full spec/surfaces

Read before editing:

- `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-1.md`
- `docs/blueprints/AMEND-nexus-lexicon-admin-ui-v0-2-0.md`
- `docs/blueprints/AMEND-nexus-lexicon-mini-substrate-v0-1-0.md`
- `docs/blueprints/AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md`
- `docs/engineering-specs/AMEND-nexus-spec-orch-v1-1-1.md`
- `docs/nexus-complete-end-to-end-flow-v4_8.md`
- `packages/planners/db-lexicon/src/internal/types.ts`
- `packages/planners/db-lexicon/src/db-lexicon-planner.ts`
- `packages/planners/db-lexicon/src/internal/preflight.ts`
- `packages/contracts/src/externals/planner.ts`
- `packages/contracts/src/externals/execution-plan.ts`
- `packages/contracts/src/interfaces/index.ts`
- `packages/core/src/lexicon/lexicon-mutation-executor.ts`
- `scripts/ci-gate.ts`
- all `fixtures/planner/db-lexicon/*.jsonl`
- all tests under `packages/planners/db-lexicon/src/*.test.ts`

Search:

```bash
cd ~/repos/nexus || exit 1
rg -n "lexicon_path|path_profile|path_evidence|path_contradiction|path_requirement|PathFeasibility|failure_likelihood|db-lexicon-transformer-v0|db-lexicon-transformer" docs packages scripts fixtures tests -S
```

Decision:

- If a full equivalent spec already exists, stop and report exact path.
- If only `lexicon_confidence` / `lexicon_arena` exist, proceed under this amendment.
- If executable code already implements path evidence/outcome, audit it before adding new code.

### Phase 2 — add spec file only first

Add this file to:

```text
docs/blueprints/AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0.md
```

Run:

```bash
cd ~/repos/nexus || exit 1
pnpm format:check
```

If formatting fails only because this new markdown needs formatting, run Prettier on this file, then re-run `pnpm format:check`.

### Phase 3 — schema/types/fixtures

Implement only after owner approves Phase 2 spec commit.

Build order:

1. Add contract types for path profile/evidence/contradiction/requirement/checkback template.
2. Extend `LexiconMutation` with new variants only if implementing admin mutation.
3. Extend `JsonlLexiconMutationExecutor` fixture map for JSONL backend.
4. Add fixture/read model for path confidence if current runtime is still JSONL.
5. If SQLite substrate exists, add SQL schema/migration instead of duplicating backend logic.
6. Add deterministic path-id builder.
7. Add reader/scorer behind a package-local interface.

### Phase 4 — planner integration

1. Add path scoring after candidate intent/template selection.
2. Add missing requirement checks before plan creation.
3. Add contradiction checks before executable plan creation.
4. Add typed checkback mapping using `lexicon_checkback_template`.
5. Extend trace with path-confidence data.
6. Preserve existing Branch 0/1/2/3 behavior.
7. Do not alter NXS/NVG authority.

### Phase 5 — admin/review projections

Only if dashboard/admin surfaces already exist and are real enough:

1. Add read-only viewer first.
2. Add mutation proposal forms through existing SigningCouncil path.
3. Add contradiction queue.
4. Add missing requirement queue.
5. Add E2E coverage matrix.

If admin path is read-only/fake/stub and would require major architecture, stop and report. Do not fake wiring.

### Phase 6 — tests

Add tests in this order:

1. path-id and scorer unit tests;
2. fixture/reader tests;
3. mutation executor tests;
4. planner trace/checkback tests;
5. integration tests through coordinator;
6. 15-run lexicon E2E wall.

### Phase 7 — gates

Add named CI gates after tests exist. Do not add a gate that checks only files while behavior is untested.

---

## 11. Stop conditions

Stop and report if:

- a full equivalent spec already exists;
- `plannerType` naming is inconsistent in executable code and the safe correction path is unclear;
- current admin mutation path is not real SigningCouncil 2-of-2;
- path scorer would require planner to import core/vanguard/connectors/interfaces outside package law;
- SQLite backend is assumed but not actually implemented;
- E2E harness cannot boot the real composition root and no existing harness alternative exists;
- implementing this would require changing NXS/NVG authority law;
- a proposed test would fake NXS/NVG/mailbox/compile;
- fix confidence is below 90%;
- any change would push downstream risk by silently accepting skips/stubs/read-only placeholders.

---

## 12. Required commands before success report

At minimum:

```bash
cd ~/repos/nexus || exit 1
pnpm typecheck
pnpm format:check
pnpm test -- packages/planners/db-lexicon
pnpm test:integration
pnpm ci:gate
pnpm test:e2e
cd ~/repos/nexus || exit 1
git status --short
```

If targeted test invocation syntax differs, inspect Vitest/package scripts and use the exact repo-supported command. Record exact commands and results.

No push.

---

## 13. Success condition

Success means one of these is true:

### Success A — spec-only closure

- Existing repo was audited.
- No full equivalent spec was found.
- This spec was added under `docs/blueprints/`.
- No runtime code changed.
- Formatting passes.
- No push.

### Success B — implementation closure

- Path profile/evidence/contradiction/requirement/checkback records exist.
- Runtime prompt channel cannot mutate authoritative lexicon records.
- SigningCouncil 2-of-2 controls all authoritative mutation.
- Planner uses path confidence only for feasibility/checkback, not governance authorization.
- Path-confidence trace is emitted with `planner_plan_trace` or equivalent projection.
- The 15 lexicon E2Es run through real workspace/orch/planner/mailbox/compile surfaces.
- No skipped/fake green tests.
- No runtime WordNet import.
- No package-law violation.
- `db-lexicon-transformer-v0` naming is preserved end-to-end.
- No push.

---

## 14. Output contract for Claude Code

Builder must report:

- repo HEAD and status;
- whether a full equivalent spec already existed;
- files inspected;
- exact naming found for planner type/class/package;
- stale naming defects found;
- decision taken;
- files changed;
- tests added/changed;
- exact commands run and results;
- what the planner can now do;
- what the planner still cannot do;
- whether any admin UI path was touched;
- whether runtime prompt mutation remains impossible;
- blockers/open questions;
- local commit hashes if created;
- explicit confirmation: no push.

---

# Appendix A — Claude Code builder prompt

You are in **NEXUS LEXICON ARENA EVIDENCE LAYER MODE**.

Role:
You are repair/audit guardrail + controlled builder.
You are allowed to add or implement the fourth lexicon layer only if the repo inspection proves the full spec/surface is missing or partial.
You are not allowed to fake dashboard wiring.
You are not allowed to bypass NXS/NVG/mailbox/compile.
You are not allowed to mutate authoritative lexicon records from runtime prompts.
You are not allowed to push.

Current verified state from audit/spec pass:

- Nexus has a real lexicon/DAG/planner foundation.
- Current canonical planner is `DbLexiconTransformerPlanner`.
- Current canonical `plannerType` is `db-lexicon-transformer-v0`.
- Current canonical package is `@nexus/planner-db-lexicon`.
- Existing mini-substrate spec names `lexicon_arena` and `lexicon_confidence`, but the full path evidence / contradiction / requirement / run outcome / failure prediction / checkback-template layer was not found in the inspected repo snapshot.
- Current planner fixture data is mechanism-thin: 22 lexical terms, 3 aliases, 3 intents, 3 capabilities, 6 targets, 3 templates, 5 nodes, 2 edges.
- No push is authorized.

Owner direction:
Build the small Nexus version of the lexicon-style database, not a full LLM.
The system should prefer correctness over natural prose. It may speak robot-to-runtime if that makes it more deterministic.
The orchestrator must know when a run is likely to fail and should check back instead of guessing.
Truths/evidence-confirmed paths should build the tree; contradicted/unsupported/unsafe paths should scatter into low-confidence, blocked, review, or checkback states.

Core law:

The fourth layer can:
- score path confidence;
- record evidence/provenance;
- record contradictions;
- record requirements/completeness;
- project run outcomes back to planner paths;
- predict likely orchestration failure;
- select typed checkback templates;
- help planner return executable plan / typed checkback / lawful unsupported-path result.

The fourth layer cannot:
- authorize actions;
- replace NXS gates;
- replace NVG routing/firewall decisions;
- call models directly;
- call target systems directly;
- append Evidence Ledger directly;
- mutate lexicon from prompt channel;
- skip SigningCouncil;
- silently pass skipped tests;
- rename canonical planner surfaces.

Phase 0 — verify current repo:

```bash
cd ~/repos/nexus || exit 1
git status --short
git log --oneline -12
cat package.json

pnpm typecheck
pnpm format:check
pnpm test:e2e
```

Expected baseline may currently be non-green because the larger wall is in repair. Report exact result; do not fake expected green.

Phase 1 — inspect before editing:

```bash
cd ~/repos/nexus || exit 1
rg -n "lexicon_path|path_profile|path_evidence|path_contradiction|path_requirement|PathFeasibility|failure_likelihood|db-lexicon-transformer-v0|db-lexicon-transformer" docs packages scripts fixtures tests -S
```

Read required files:

- `docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-1.md`
- `docs/blueprints/AMEND-nexus-lexicon-admin-ui-v0-2-0.md`
- `docs/blueprints/AMEND-nexus-lexicon-mini-substrate-v0-1-0.md`
- `docs/blueprints/AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md`
- `docs/engineering-specs/AMEND-nexus-spec-orch-v1-1-1.md`
- `docs/nexus-complete-end-to-end-flow-v4_8.md`
- `packages/planners/db-lexicon/src/internal/types.ts`
- `packages/planners/db-lexicon/src/db-lexicon-planner.ts`
- `packages/planners/db-lexicon/src/internal/preflight.ts`
- `packages/contracts/src/externals/planner.ts`
- `packages/contracts/src/externals/execution-plan.ts`
- `packages/contracts/src/interfaces/index.ts`
- `packages/core/src/lexicon/lexicon-mutation-executor.ts`
- `scripts/ci-gate.ts`
- all `fixtures/planner/db-lexicon/*.jsonl`

Create/update local build log:

```bash
cd ~/repos/nexus || exit 1
mkdir -p .local-ops
touch .git/info/exclude
grep -qxF ".local-ops/" .git/info/exclude || echo ".local-ops/" >> .git/info/exclude
printf "# Lexicon Arena Evidence Layer build log\n\n" > .local-ops/lexicon-arena-evidence-layer-log.md
```

Phase 2 — decision gate:

Choose one:

A. Full equivalent spec already exists. Stop and report exact file/path and any naming drift.

B. Partial spec exists (`lexicon_arena` / `lexicon_confidence`) but missing evidence/contradiction/requirements/outcomes/checkback layer. Add this spec only first. No runtime implementation until owner approval.

C. Existing implementation already partially exists. Audit it against this spec; repair only small production-quality gaps.

D. Required surfaces are missing and implementation would require major architecture. Stop and report.

Write A/B/C/D to `.local-ops/lexicon-arena-evidence-layer-log.md` before editing.

Phase 3 — if B, add spec file only:

Add:

```text
docs/blueprints/AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0.md
```

Use the spec above. Preserve naming exactly.

Run:

```bash
cd ~/repos/nexus || exit 1
pnpm format:check
pnpm typecheck
cd ~/repos/nexus || exit 1
git status --short
```

Do not push.

Phase 4 — implementation only after owner approves:

Follow sections 4-10 of the spec. Build smallest production-grade vertical slice:

1. path profile/evidence/contradiction/requirement/checkback contract types;
2. JSONL backend compatibility if SQLite is not implemented;
3. deterministic path-id builder;
4. scorer/reader;
5. planner trace extension;
6. typed checkback path;
7. tests;
8. 15-run lexicon e2e wall.

Stop conditions:

- full equivalent spec exists;
- planner type naming conflict unclear;
- admin mutation path is not real SigningCouncil 2-of-2;
- runtime path would mutate lexicon from prompt;
- package law would be violated;
- tests would require fake NXS/NVG/mailbox/compile;
- e2e harness cannot boot real surfaces and no existing harness alternative exists;
- implementation would change governance law;
- confidence below 90%.

Required success report:

- repo HEAD/status;
- full spec existed or not;
- decision A/B/C/D;
- files inspected;
- files changed;
- exact commands run/results;
- tests added/changed;
- naming defects found/fixed;
- what planner can now do;
- what planner still cannot do;
- blockers/open questions;
- local commit hash if committed;
- confirm no push.

