# AMEND — Nexus Lexicon Admin UI

**Version:** v0.2.0
**Status:** RATIFIED (Q7 Phase 1: JSONL via SigningCouncil; Phase 2 SQLite sequenced)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 E Lexicon Mini-Substrate, §3 K Admin Dashboard, §3 S Signing Keys, §4 P Run Ledger, Hard Law #10
**Audit packet:** Turn 1 P0-003, Turn 2 P0-010, Turn 5 P0-042

---

## §0 Disposition

This is the canonical lexicon admin UI spec. It supersedes the v0.1.0 lineage (which existed in pre-reset history with a single-admin JSONL apply baseline that contradicted Hard Law #10 and outline §3 E/S). v0.2.0 implements **Q7 sequencing**:

- **Phase 1 (V1):** double-admin JSONL apply through `SigningCouncil(operation='lexicon_mutation')` (Spec F4.1). Closes the federation governance gap on the current JSONL backend. No SQLite refactor required.
- **Phase 2 (follow-on arc):** migrate to SQLite entity/edge/confidence/arena mini-substrate. JSONL becomes seed/import/disaster-recovery compatibility only.

**Q-rulings applied:**
- **Q4** Strict 2-signature threshold for `lexicon_mutation`.
- **Q7** Sequencing: Phase 1 SigningCouncil over JSONL; Phase 2 SQLite later.
- **Q3** BAKED enforcement (SigningCouncil + Run Ledger writes are baked); plug-in admin UI is defense in depth.
- **Q5** Plug-ins never kill — the lexicon admin UI cannot apply a mutation unilaterally; the baked SigningCouncil executor is the only legitimate apply path.

**Hard Laws this spec preserves:**
- **#10** Every lexicon mutation is Ed25519-signed by two admin-registered keys; every gate outcome to ledger; failure path fail-closed.
- **#13** Default-secure — runtime cannot mutate lexicon (prompt-channel learning forbidden).
- **#14** Admin-mediated growth via review queues; no implicit RBAC drift.

**Audit findings closed:** P0-003 (Turn 1), P0-010 (Turn 2), P0-042 (Turn 5).

---

## §1 Scope

In scope (V1 / Phase 1):
- Admin UI surfaces: entity editor (add/edit/disable), edge editor, confidence-per-arena editor, workflow template editor, guard editor, seed/source viewer.
- `unmapped_prompt` review queue.
- `lexicon_signal` review queue.
- Pending mutation queue (filtered SigningCouncil view).
- Mutation flow via SigningCouncil 2-of-2 (Spec F4.1 `lexicon_mutation` operation).
- JSONL append executor that runs AFTER threshold met; validated mutation appended atomically; runtime hot-reload.
- Ledger events for every operation.

Out of scope (Phase 2 follow-on arc):
- SQLite entity/edge/confidence/arena schema.
- Graph-walk admin tools.
- Cross-fixture foreign-key constraints.
- Cross-arena migration tooling.

Out of scope entirely (V1):
- Real-time learning from user prompts (Hard Law violation; forbidden).
- Single-admin apply paths (forbidden).

---

## §2 Contract types

### §2.1 `LexiconMutation` (V1 payload for SigningCouncil)

```ts
type LexiconMutation =
  | { kind: 'entity_add';        entity: LexiconEntity }
  | { kind: 'entity_update';     entityId: LexiconEntityId; patch: Partial<LexiconEntity> }
  | { kind: 'entity_disable';    entityId: LexiconEntityId }
  | { kind: 'edge_add';          edge: LexiconEdge }
  | { kind: 'edge_update';       edgeId: LexiconEdgeId; patch: Partial<LexiconEdge> }
  | { kind: 'edge_disable';      edgeId: LexiconEdgeId }
  | { kind: 'confidence_set';    entityId: LexiconEntityId; arena: ArenaId; score: number }
  | { kind: 'workflow_template_add';    template: WorkflowTemplate }
  | { kind: 'workflow_template_update'; templateId: WorkflowTemplateId; patch: Partial<WorkflowTemplate> }
  | { kind: 'guard_add';         guard: LexiconGuard }
  | { kind: 'guard_update';      guardId: LexiconGuardId; patch: Partial<LexiconGuard> };
```

Each mutation is the payload of a `SigningRequest(operation='lexicon_mutation', payload: LexiconMutation, ...)`.

### §2.2 `LexiconMutationExecutor` (baked)

```ts
interface LexiconMutationExecutor {
  /** Called by SigningCouncil when 2-of-2 distinct admin signatures reached. */
  apply(mutation: LexiconMutation, signatures: readonly SignatureChainEntry[]): Promise<LexiconMutationResult>;
}

interface LexiconMutationResult {
  readonly mutationId: LexiconMutationId;     // ULID
  readonly appliedAt: RunSequence;
  readonly jsonlFile: string;                  // which JSONL fixture file received the append
  readonly jsonlSeqNo: number;                 // monotonic seq within file
  readonly signatureChainRef: SignatureChainRef;
}
```

Executor:
1. Validates mutation against current lexicon state (entity exists for update/disable; arena exists for confidence_set; etc.).
2. Appends a canonical line to the appropriate JSONL fixture (`lexicon_entity.jsonl`, `lexicon_edge.jsonl`, `lexicon_confidence.jsonl`, `workflow_template.jsonl`, `lexicon_guard.jsonl`).
3. Emits `lexicon_mutation_applied` ledger event with full signature chain.
4. Triggers runtime hot-reload of in-memory lexicon tables.

### §2.3 `UnmappedPromptEvent` and `LexiconSignalEvent`

```ts
interface UnmappedPromptEvent {
  readonly eventId: EventId;
  readonly runId: RunId;
  readonly principalId: PrincipalId;
  readonly promptDigest: HexDigest;             // raw prompt NOT stored in ledger (P1-013)
  readonly arena: ArenaId;
  readonly topCandidatesUnderThreshold: ReadonlyArray<{ candidateId: string; score: number }>;
  readonly emittedAt: RunSequence;
}

interface LexiconSignalEvent {
  readonly eventId: EventId;
  readonly runId: RunId;
  readonly principalId: PrincipalId;
  readonly promptDigest: HexDigest;
  readonly arena: ArenaId;
  readonly chosenIntent: IntentId;               // user pick from callback
  readonly candidateScores: ReadonlyArray<{ intentId: IntentId; score: number }>;
  readonly emittedAt: RunSequence;
}
```

Both events surface in admin dashboard review queues for periodic owner / admin review. The admin proposes a `LexiconMutation`; the second admin signs to apply.

### §2.4 `LexiconReader` (runtime port, unchanged)

The runtime lexicon reader is unchanged in Phase 1; the JSONL fixture loader (`packages/planners/db-lexicon/src/internal/fixture-loader.ts`) continues to be the source. Phase 2 swaps to SQLite-backed reader behind the same interface.

---

## §3 Runtime behavior

### §3.1 Admin authors a mutation

1. Admin opens entity editor in dashboard, fills form (or selects from `unmapped_prompt` / `lexicon_signal` queue with pre-populated draft).
2. Submit → server constructs `LexiconMutation` payload → `SigningCouncil.open(operation='lexicon_mutation', payload, opener=principalId)` (Spec F4.1).
3. Returns `requestId`; admin sees "Awaiting second signer" state.

### §3.2 Second admin reviews + signs

1. Pending queue (filtered `operation=lexicon_mutation`) visible to all admins.
2. Reviewer clicks "Sign as me" → server-side signs (per `feedback_signing_keys_server_side.md`).
3. `SigningCouncil.sign(requestId, principalId, signature)` → threshold met (2 distinct admin signatures) → SigningCouncil calls `LexiconMutationExecutor.apply(mutation, signatures)`.

### §3.3 Executor applies

1. Validates mutation against current state.
2. Canonicalizes JSONL line + appends to fixture file (atomic write).
3. Emits `lexicon_mutation_applied` ledger event.
4. Triggers in-process lexicon hot-reload (re-reads affected fixture; recomputes derived structures).
5. Returns `LexiconMutationResult`; SigningCouncil marks request `executed`.

### §3.4 Runtime cannot mutate

`packages/planners/db-lexicon/**` runtime read paths are read-only. No `apply`-class method exists outside the admin-writer surface. Per outline §3 E "MUTATION admin-only" — runtime prompt channel is FORBIDDEN to mutate.

### §3.5 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | SigningCouncil opens + threshold met → executor logs `would_apply_lexicon_mutation`; JSONL untouched | yes            | always         |
| advisory  | Same as observe + workspace warning to opener                                                       | yes            | always         |
| enforcing | Executor applies; below threshold or duplicate signer or expired → request denied; no JSONL append   | n/a (admin op) | always         |

### §3.6 BAKED vs plug-in

- **BAKED (floor):** SigningCouncil + signature verification + executor + Run Ledger writes + runtime-read-only enforcement.
- **PLUG-IN (defense in depth):** admin UI panels; JSONL backend is plug-in storage (SQLite swap in Phase 2 doesn't break the contract).

---

## §4 Admin dashboard surfaces

- **Entity editor** — list / add / edit / disable entities; filter by entity type.
- **Edge editor** — list / add / edit / disable edges; visualize source/target.
- **Confidence editor** — per-entity / per-arena score adjustments.
- **Workflow template editor** — slots, sections, guards.
- **Guard editor** — when/then rules.
- **Seed / source viewer** — read-only display of WordNet subset + governed-verb-lexicon.
- **Unmapped prompt queue** — list `UnmappedPromptEvent` rows; "Propose entity" action drafts a `LexiconMutation`.
- **Lexicon signal queue** — list `LexiconSignalEvent` rows; "Promote pick to entity" action.
- **Pending mutations queue** — embedded filtered SigningCouncil view (`operation=lexicon_mutation`); "Sign as me" action.
- **History** — past `lexicon_mutation_applied` events with full signature chain.

---

## §5 Implementation sequence (Phase 1, V1)

1. Add `LexiconMutation` discriminated union to `packages/contracts/src/lexicon/`.
2. Implement `LexiconMutationExecutor` in `packages/core/src/lexicon/`.
3. Register `lexicon_mutation` as `FederatedOperation` member in SigningCouncil (Spec F4.1).
4. Wire admin-writer routes for entity / edge / confidence / template / guard authoring → all create SigningRequests.
5. Wire admin dashboard panels.
6. Implement `unmapped_prompt` + `lexicon_signal` ledger event emission at runtime (planner callback path; see Spec F4.7).
7. Implement admin review queue projections from ledger.
8. CI gates per §6.

## §5.5 Phase 2 sequencing (follow-on arc)

After V1 ships:
1. Define SQLite schema for entity/edge/confidence/arena/template/guard.
2. Implement migration tool: import JSONL fixtures into SQLite.
3. Swap runtime lexicon reader from JSONL loader to SQLite reader (behind same interface).
4. Swap executor JSONL append for SQLite insert.
5. JSONL becomes seed/export/disaster-recovery format; remains read-supported.

Phase 2 is a separate spec arc; ratification before Phase 2 build.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| LEX-MUT-01 | Admin POSTs entity_add → SigningRequest created with operation=`lexicon_mutation`; status=pending | Integration |
| LEX-MUT-02 | Single signature → JSONL untouched, status stays pending | Integration |
| LEX-MUT-03 | Two distinct admin signatures → executor applies; JSONL appended; ledger event written | Integration |
| LEX-MUT-04 | Duplicate same-admin signature → second sign rejected (409); JSONL untouched | Integration |
| LEX-MUT-05 | Stale/replayed payload with different requestId → signature rejected | Integration |
| LEX-MUT-06 | Mutation referencing non-existent entityId (entity_update on missing id) → executor validation rejects; status=denied; no JSONL append | Integration |
| LEX-MUT-07 | Runtime read paths cannot call apply (`LexiconMutationExecutor.apply` not exported from planner package) | Static |
| LEX-MUT-08 | Prompt channel writes to lexicon — static AST gate fails (Spec F4.19 GOV-14) | Static |
| LEX-MUT-09 | `unmapped_prompt` event written on planner callback for unmappable prompt | Integration |
| LEX-MUT-10 | `lexicon_signal` event written on user pick from top-N callback | Integration |
| LEX-MUT-11 | Hot-reload picks up new JSONL line within one second of apply | Integration |
| LEX-MUT-12 | observe mode: executor logs `would_apply_lexicon_mutation`; JSONL untouched | Integration |

**CI static gates (Spec F4.19):**
- `GOV-14 lexicon mutation double-admin` — verifies `getThreshold('lexicon_mutation')` literal === 2 and no single-admin apply path exists.

---

## §7 Backwards compatibility

At 3ae197d, the runtime lexicon loader reads JSONL fixtures as a static bootstrap; no admin mutation surface exists. Phase 1 adds the mutation surface as a strict superset; existing read paths unchanged. Phase 2 (separate arc) preserves the same read contract while swapping backend.

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-003 | All mutations go through SigningCouncil 2-of-2; no immediate single-admin apply; tests LEX-MUT-02/-04 |
| P0-010 | Phase 1 closes federation gap on JSONL backend; Phase 2 SQLite sequenced; `unmapped_prompt` / `lexicon_signal` events + queues added |
| P0-042 | Body rewrites JSONL-single-admin baseline; SigningCouncil is the only apply path; Phase 2 sequencing explicit |

---

*End of v0.2.0.*
