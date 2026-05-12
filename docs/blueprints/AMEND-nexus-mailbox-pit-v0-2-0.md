# Amendment — Mailbox Pit (per-actor mailbox isolation)
# Version: v0.2.0 (DRAFT — pending owner ratification)
# Date: 2026-05-12
# Status: DRAFT — incorporates owner-approved best-solve rows from v0.1.0 review (audit 1 + audit 2 + owner pushback on rows 8, 10)
# Amends:
#   AMEND-blueprint-nexus-infra-externals-v1-0-0.md §7.3 (Mailbox Manifest) + lines 354-360 (Mailbox primitive law)
#   AMEND-spec-nexus-infra-externals-v0-2-5.md §3.5 (MailboxItem) + §3.6 (Mailbox Backend Contract and Baked Service Law)
# Supersedes:
#   R2-WIRE-008 in AMEND-spec-nexus-infra-externals-v0-2-5.md (line 95) — "V1 governed runtime permits exactly one enabled required mailbox" — replaced by per-actor mailbox-pit law (§2 + §3)
# Author: Claude (deterministic build agent), under owner direction
# Owner: James Huson / Lake Area LLC
# HEAD pin at draft time: 18f09f9 + uncommitted slot-binding worktree changes
# Canonical event name verification: `compile_started` confirmed at packages/contracts/src/interfaces/index.ts:896 (HOLE-002 closed)

---

## Changelog from v0.1.0

- **Header fix:** v0.1.0 incorrectly pointed `Amends:` at `nexus-blueprint-v1-5-13.md §3.5/§3.6`. The canonical blueprint contains no mailbox content; mailbox law lives in the infra-externals amendments. Corrected.
- **CONTRA logged:** R2-WIRE-008 single-mailbox V1 constraint is now explicitly superseded. v0.1.0 did not acknowledge this constraint.
- **Row 1 (provenance):** Added typed `MailboxAllocation` record + `MailboxService.resolveMailboxProvenance` + `assertMailboxBelongsToActor`. Compile uses the inverted `listMailboxesForRun` map on the hot path; deterministic decode exists for offline audit reconstruction only.
- **Row 2:** Added allocation persistence law — `allocateForRun` MUST persist or be reconstructable from `mailbox_allocated` ledger events.
- **Row 3:** Added write-time ownership validation — `writeFromOutput` MUST reject mismatches.
- **Row 4:** Split bypass into `render_partial` vs `withhold_quarantine` dispositions; digest failure + `guard.halt` quarantine never render raw bytes.
- **Row 5:** Structured `bypassPartials: BypassPartial[]` on `FinalResponseArtifact`; V1 workspace renderer is a simple labeled prose block + "withheld" placeholder for quarantined items.
- **Row 6:** Renamed ledger events — `compile_mailbox_item_bypassed`, `compile_mailboxes_listed`. Kept `mailbox_allocated`.
- **Row 7:** Added `mailbox_slot_resolved_for_dispatch` event for cross-actor data movement audit.
- **Row 8 (revised per owner):** `actorId` in contracts, `agent` only in prose. Documented orch↔mailbox naming seam (orch uses `agentId`, mailbox uses `actorId`, same UUID); option (a) — accept the seam in V1, defer orch rename to the orch-listener amendment. Logged as DIFF-MAILBOX-PIT-001.
- **Row 9:** `MailboxWriteContext` object replaces bare `mailboxId` argument.
- **Row 10 (closed):** `compile_started` is canonical per grep — no spec change required.
- **Row 11:** Function-name references replace HEAD-pinned line numbers; HEAD hash pinned at top of doc.
- **Row 12:** §3.7 numbering convention explicitly notes "insertion."
- **Row 13:** §5.1 sentence structure tightened.
- **Row 14:** §9.5 replaced "79/79" with "all ci:gate checks green; integration suite green."
- **Row 15:** §4.4 spells out cancel-before-allocation edge.
- **Row 16:** §11 adds contracts surface expansion risk.

---

## §0 Canonical Law Alignment

This amendment operates under the precedence: project instructions → engineering spec → blueprint → owner-approved logs. Canonical blueprint `nexus-blueprint-v1-5-13.md` contains no mailbox content; the mailbox primitive was introduced by the infra-externals amendments listed in the header. Per the owner-clarified fallback hierarchy, this amendment falls back to the infra-externals blueprint as authoritative parent.

### §0.1 Preserved from infra-externals blueprint §354-360

These laws remain unchanged under the mailbox-pit:

- Mailbox primitive is baked.
- Mailbox implementation/backend may be replaceable behind the mailbox interface.
- Mailbox items are scoped by `runId`, `agentId`, `taskId`, and `slotId`.
- Mailbox does not call LLMs.
- Mailbox does not make governance decisions.
- Mailbox stores/references returned payloads and classifications; Run Ledger stores metadata and references.
- Mailbox service implementation may live in `packages/core/src/mailbox`, but engines must not import across layers to reach it.

### §0.2 Preserved from infra-externals spec §3.6

- `MailboxBackend` has exactly one source of truth: `packages/contracts/src/externals/mailbox.ts`.
- `MailboxService` is baked core infrastructure, not a replaceable plugin surface.
- Enterprises may replace storage backends but may NOT replace digest/classification/status/redaction eligibility law.
- V1 reference backend is local JSONL metadata + filesystem payload references.
- Backend implementations must not call LLMs, NXS, NVG, connectors, approval channels, or workspace endpoints.

### §0.3 Superseded — R2-WIRE-008

Original constraint (infra-externals spec line 95): *"V1 governed runtime permits exactly one enabled required mailbox."*

The mailbox-pit supersedes this single-mailbox constraint with the per-actor isolation model defined in §2. The MailboxManifestRecord still describes ONE backend instance (one storage configuration); the supersedence is at the **runtime allocation** layer — one backend now hosts many per-actor mailboxIds per run.

---

## Scope Statement

This amendment replaces the single-primary-mailbox-per-run runtime allocation with a **mailbox pit**: a set of named per-actor mailboxes physically isolated at the storage layer and assigned per-run by orch.

Motivation: in the single-primary model the isolation between actors is logical only (filter by `slot + task`). Any bug in the filter path exposes one actor's slot data to another actor's listener view. With per-actor mailboxes the storage layer itself enforces the boundary — same way OS file permissions are stronger than "the code is careful." The amendment also lays the foundation for compile-provenance-by-mailbox-source: compile identifies which actor emitted each piece of content from the allocation record the item is bound to, rather than trusting the LLM to self-tag in the prose body.

**Out of scope** (explicit, captured for future amendments):

1. Orch-as-mailbox-listener with push/subscribe semantics.
2. Bidirectional inbox / outbox split per actor.
3. Multi-round framework distribution (the bash `compiler.sh` pattern).
4. Cross-run mailbox channels (long-running agent subscribers).

---

## §1 Problem Statement

(Unchanged from v0.1.0 §1.1–§1.2 — single-primary model relies on logical filtering, agent/LLM is the unsafe actor, provenance for compile must be load-bearing without trusting agent self-tagging. Reproduced in v0.1.0 archive.)

---

## §2 Architecture — Per-Actor Mailbox Model

### §2.1 Mailbox identity

Each `(runId, actorId)` pair owns a distinct mailbox in the backend:

```
mbx-v1-run-<runId>-actor-<actorId>
```

`mailboxId` is computed deterministically from `(runId, actorId)` so audit reconstruction works without persisted state in the hot path. The `v1` prefix is a schema version so future renames stay forward-compatible. Two distinct `(runId, actorId)` pairs always map to distinct `mailboxId` strings.

### §2.2 Naming seam: actorId vs agentId

The mailbox-pit contracts use `actorId` (canonical Nexus identity term per §0.1 / canonical blueprint §12 actor model). The orchestrator-ref contracts (`OrchestratorSelectedAgent`, `PlanNode.agentId`, `dag-executor` agentId, `RunDagState`) use `agentId` for the same entity. **The entity is the same UUID.** The vocabulary seam is intentional in V1:

- Orch calls it `agentId` because the role expressed by orch is "this is the agent producing the work."
- Mailbox calls it `actorId` because the identity tier expressed by mailbox is "this is the actor whose isolation boundary owns the mailbox."

At the seam (e.g., the new step in `RefRunCoordinator.handleRun` that calls `allocateForRun(runId, plan.nodes.map(n => n.agentId))`), the call passes orch's `agentId` into mailbox's `actorId` parameter. No type bridge is required (both are `Uuid`). The seam is documented in code comments at every callsite.

Logged: **DIFF-MAILBOX-PIT-001** (status: open, accept-the-seam V1; orch rename deferred to orch-listener amendment).

### §2.3 What lives in each mailbox

Each actor's mailbox holds every mailbox item produced under that actor's authority for the run — both NVG results (LLM text) and NXS results (connector read / receipt / data payload), regardless of which plan node produced it. The `taskId + slotId` addressing inside the mailbox still distinguishes per-node outputs; the mailbox itself is the per-actor envelope.

Two distinct actors NEVER share a mailbox, even within the same run.

### §2.4 Allocation lifecycle (high-level)

| Stage | What happens |
|---|---|
| `run_opened` | No mailboxes yet — plan hasn't been built |
| `plan_confirmed` | Orch enumerates `plan.nodes.map(n => n.agentId)` (deduplicated), calls `allocateForRun(runId, uniqueActors)`. `mailbox_allocated` event written to run ledger for each new allocation. Allocation index persisted. |
| Per-node dispatch | Composition root looks up the producing actor's mailbox via `getMailboxForActor(runId, agentId)`. Writes go through a `MailboxWriteContext` carrying the producer identity (§3.6). |
| Per-node slot reads | Composition root resolves an upstream slot by computing the UPSTREAM actor's mailbox via `getMailboxForActor(runId, upstreamNode.agentId)` and calling `findBySlot(upstreamMailboxId, runId, upstreamNodeId, slotId)`. Each resolution emits `mailbox_slot_resolved_for_dispatch` (§3.4.4). |
| `compile_started` | Compile calls `listMailboxesForRun(runId)` (canonical name verified — see HOLE-002 closure note in changelog). Emits `compile_mailboxes_listed`. For each mailboxId, calls `listEligibleForCompile`. |
| `run_closed completed` | Each mailbox's items are marked consumed via `markConsumed` per existing law. Mailbox allocation records persist for audit per the manifest's `retentionPolicy.metadataRetention`. |
| `run_cancelled` | `cancelRun` runs on each allocated mailbox; items go to `cancelled`. |

### §2.5 No orch mailbox in V1

V1 deliberately does NOT allocate a dedicated orch inbox. Orch reads actor mailboxes directly via the existing dag-walk + findBySlot mechanism. The orch-as-listener pattern is a separate amendment.

### §2.6 No compile mailbox in V1

V1 deliberately does NOT allocate a dedicated compile inbox. Compile reads from every allocated actor mailbox for the run. This preserves mailbox-source-as-provenance — every item compile sees came from a known actor's mailbox, and the mailbox's allocation record resolves back to the actor.

---

## §3 Surface Changes

### §3.1 MailboxAllocation record and provenance authority

New typed record:

```typescript
export interface MailboxAllocation {
  allocationId: Uuid;
  runId: Uuid;
  actorId: Uuid;
  mailboxId: NonEmpty;
  mailboxRole: 'agent_output';   // V1 — future amendments may add 'orch_inbox', 'compile_inbox', etc.
  backendId: NonEmpty;            // which MailboxBackend instance hosts this mailbox
  allocatedAt: IsoTimestamp;
  allocationVersion: 'mailbox-pit/v1';
}
```

The allocation record is the **authoritative provenance source**. Compile MUST NOT parse mailboxId strings on the hot path; it uses the allocation map.

### §3.2 MailboxService — extended surface

`packages/contracts/src/externals/mailbox.ts`:

```typescript
export interface MailboxService {
  // Existing — unchanged signatures (preserved from infra-externals spec §3.6):
  writeFromOutput(input: MailboxWriteInput): Promise<MailboxItem>;
  listEligibleForCompile(mailboxId: NonEmpty, runId: Uuid): Promise<MailboxItem[]>;
  markConsumed(mailboxId: NonEmpty, runId: Uuid, itemIds: Uuid[]): Promise<void>;
  cancelRun(mailboxId: NonEmpty, runId: Uuid, reason: DenialCode): Promise<void>;
  findBySlot(mailboxId: NonEmpty, runId: Uuid, taskId: Uuid, slotId: NonEmpty): Promise<MailboxItem | null>;

  // NEW — V1 mailbox-pit:

  /** Allocate one per-actor mailbox for each unique actorId, idempotent.
   *  Returns the canonical mailboxId for each. Persists each allocation
   *  to the allocation index AND emits `mailbox_allocated` to the run
   *  ledger. Existing allocations are returned unchanged with no event. */
  allocateForRun(
    runId: Uuid,
    actors: readonly Uuid[]
  ): Promise<ReadonlyMap<Uuid, NonEmpty>>;

  /** Return the canonical mailboxId for a (runId, actorId) pair. Returns
   *  null when no allocation exists. Does NOT auto-allocate. */
  getMailboxForActor(runId: Uuid, actorId: Uuid): Promise<NonEmpty | null>;

  /** Enumerate every mailbox allocated for the run, keyed by actorId.
   *  Compile reads this to build its list of source targets. The
   *  inverted map (mailboxId → actorId) is compile's hot-path provenance
   *  index. */
  listMailboxesForRun(runId: Uuid): Promise<ReadonlyMap<Uuid, NonEmpty>>;

  /** Resolve the typed allocation record for a (runId, mailboxId) pair.
   *  Returns null when the mailboxId is unknown for the run. Used by
   *  compile to verify provenance authoritatively, and by audit tooling
   *  to walk back from a stored mailbox file to its actor. */
  resolveMailboxProvenance(runId: Uuid, mailboxId: NonEmpty): Promise<MailboxAllocation | null>;

  /** Assert the mailboxId belongs to the actorId under the runId.
   *  Throws (with a typed denial code) on mismatch. Called by
   *  `writeFromOutput` before persisting any item AND by any callsite
   *  that wants a defensive check. */
  assertMailboxBelongsToActor(runId: Uuid, actorId: Uuid, mailboxId: NonEmpty): Promise<void>;
}
```

### §3.3 Allocation persistence law

`allocateForRun` MUST EITHER persist a mailbox allocation index (storage backend table or sidecar file) OR be deterministically reconstructable from Run Ledger `mailbox_allocated` events. In-memory-only allocation state is non-conformant: a process restart between `plan_confirmed` and `compile_started` must not lose the allocation map.

V1 implementation recommendation: deterministic derivation (`mbx-v1-run-<runId>-actor-<actorId>`) for fast path + ledger-reconstruction for restart recovery. The deterministic derivation is hidden inside `MailboxService` — external callers never see it.

### §3.4 Run ledger events (revised)

Four event types are added/renamed:

#### §3.4.1 `mailbox_allocated`

Fires once per `(runId, actorId)` pair the first time `allocateForRun` records it.

```typescript
{
  mailboxId: NonEmpty,
  runId: Uuid,
  actorId: Uuid,
  mailboxRole: 'agent_output',
  allocatedAt: IsoTimestamp,
}
```

#### §3.4.2 `compile_mailboxes_listed` (renamed from `mailboxes_listed`)

Fires once when compile begins assembly and enumerates its source mailboxes.

```typescript
{
  runId: Uuid,
  mailboxCount: number,
  mailboxIds: readonly NonEmpty[],
}
```

#### §3.4.3 `compile_mailbox_item_bypassed` (renamed from `mailbox_bypass_partial`)

Fires per mailbox item compile bypasses during assembly.

```typescript
{
  mailboxItemId: Uuid,
  sourceMailboxId: NonEmpty,
  sourceActorId: Uuid,
  bypassReason: 'malformed_output' | 'slot_type_mismatch' | 'guard_halt' | 'digest_mismatch',
  bypassDisposition: 'render_partial' | 'withhold_quarantine',  // §5.2
  workspacePartialRef: NonEmpty | null,                          // null when withheld
}
```

#### §3.4.4 `mailbox_slot_resolved_for_dispatch` (NEW)

Fires every time orch resolves a downstream node's `inputSlotReads` entry into a concrete mailbox item to seed into dispatch context.

```typescript
{
  runId: Uuid,
  readerActorId: Uuid,        // the downstream agent (the consumer)
  sourceActorId: Uuid,        // the upstream agent (the producer)
  sourceMailboxId: NonEmpty,
  sourceTaskId: Uuid,         // upstream node id
  slotId: NonEmpty,
  mailboxItemId: Uuid,        // the resolved item
  resolvedAt: IsoTimestamp,
}
```

This event is the auditable record of orch moving bytes from one actor's mailbox into another actor's dispatch context. Without it, cross-actor data flow is implicit.

All four event names are added to `RunEventType` in `packages/contracts/src/interfaces/index.ts`. Additive only; no existing values change.

### §3.5 Composition-root callsite changes (revised — function-name references)

`scripts/nexus-main.ts` callsites (referenced by function name, not line number, per row 11 of the best-solve):

| Function | Today | After |
|---|---|---|
| `dispatchNxsNode` (mailbox write) | `socketRegistry.getPrimaryMailbox().mailboxId` | `mailboxService.getMailboxForActor(runId, node.agentId)` |
| `dispatchToGovernance` (NVG input slot reads) | `socketRegistry.getPrimaryMailbox().mailboxId` | `mailboxService.getMailboxForActor(runId, upstreamNode.agentId)`; emit `mailbox_slot_resolved_for_dispatch` per read |
| `dispatchToGovernance` (final NVG mailbox write) | implicit via OutputCollector with primary mailbox | OutputCollector takes `MailboxWriteContext` (§3.6); context constructed at callsite from the dispatching agent |
| `triggerCompile` | `socketRegistry.getPrimaryMailbox().mailboxId` then `listEligibleForCompile` | `mailboxService.listMailboxesForRun(runId)` → emit `compile_mailboxes_listed` → for each `mailboxId`, call `listEligibleForCompile` |
| `resolveNxsSlotBindings` (uncommitted slot-binding worktree) | takes `mailboxId` as input | unchanged signature — caller now supplies the upstream actor's mailboxId |

HEAD pin at draft time: `18f09f9` + uncommitted slot-binding changes. Use this to recover specific line numbers if needed for historical inspection.

### §3.6 OutputCollector — MailboxWriteContext

Replace the bare `mailboxId` parameter on every `writeMailboxItemFromXxx` method with a typed context object:

```typescript
export interface MailboxWriteContext {
  runId: Uuid;
  producerActorId: Uuid;   // the actor whose authority produced this item
  mailboxId: NonEmpty;     // the canonical mailbox for (runId, producerActorId)
  taskId: Uuid;            // the producing plan node id
  slotId: NonEmpty;        // the producing node's output slot
}
```

`OutputCollectorImpl` constructor stops taking `mailboxId`. Each write method accepts `MailboxWriteContext` as its second argument:

```typescript
writeMailboxItemFromNvgResult(input: NvgOutputReference, ctx: MailboxWriteContext): Promise<MailboxItem>;
writeMailboxItemFromNxsResult(input: NxsOutputReference, ctx: MailboxWriteContext): Promise<MailboxItem>;
writeMailboxItemFromAgentPartial(input: AgentPartialOutputReference, ctx: MailboxWriteContext): Promise<MailboxItem>;
```

Inside `writeFromOutput` (the underlying `MailboxService` call), the implementation MUST:

1. Call `assertMailboxBelongsToActor(ctx.runId, ctx.producerActorId, ctx.mailboxId)` before persisting.
2. Reject (typed denial code) on mismatch — item is NOT written as `available`. This is fail-closed at the write boundary; compile's mismatch check (§5) remains as defense-in-depth.

### §3.7 RefRunCoordinator allocation step (insertion)

`packages/orch-ref/src/run-coordinator.ts` `handleRun`:

**Step 3.6 — Mailbox allocation.** (This is an insertion convention between existing steps 3 and 4, NOT a renumbering of canonical step list.) After `plan_confirmed` and before delegation issuance: enumerate `plan.nodes.map(n => n.agentId)` deduplicated, call `deps.mailboxService.allocateForRun(request.runId, uniqueActors)`. Persist the returned map for downstream dispatch lookups. Emit `mailbox_allocated` per new allocation. (The seam — passing `agentId` into `actorId` parameter — is documented per §2.2.)

`RunCoordinatorDeps` is unchanged structurally — the `mailboxService` is already present.

---

## §4 Lifecycle Detail

### §4.1 Allocation

- Idempotent: same input → same mailboxIds, no duplicate ledger events.
- Allocation persists per §3.3.
- Backend file/path appears only when the FIRST item is written to that mailbox. Avoids empty-mailbox directories for plans where some agents never get dispatched (conditional branches).

### §4.2 Drainage and consumption

Existing `markConsumed` law applies per-mailbox. When `compile_return` is accepted, the coordinator iterates `listMailboxesForRun(runId)` and calls `markConsumed(mailboxId, runId, items)` for each.

### §4.3 Retention

Per `MailboxManifestRecord.retentionPolicy.payloadTtlSeconds` + `metadataRetention`. Applies per-mailbox-item.

### §4.4 Cancellation

`cancelRun(mailboxId, runId, reason)` is called for each allocated mailbox during the run-cancelled path. The composition root iterates `listMailboxesForRun`.

**Edge case (row 15 of best-solve):** if no mailboxes were allocated (run cancelled before `plan_confirmed`), `listMailboxesForRun` returns an empty map and the cancel iteration is a no-op. This is correct behavior, captured to avoid future "missing cancel" confusion.

---

## §5 Compile Provenance + Malformed Bypass

### §5.1 Provenance via source allocation

When compile reads items, each `MailboxItem` carries `agentId` AND lives in a mailbox whose allocation record encodes `(runId, actorId)`. Compile MUST treat **the allocation record as authoritative provenance**, never the item's `agentId` field alone, and never the mailboxId string parsed in compile.

Implementation: compile builds an inverted map `mailboxId → actorId` from `listMailboxesForRun(runId)` once at assembly start. For each item, compile derives the provenance actor from `invertedMap.get(item.mailboxId)`. The item's `agentId` field is checked to equal this derived value; mismatch → bypass.

`MailboxService.resolveMailboxProvenance` exists for audit tooling — the offline case where you have a mailbox file on disk and need to trace back to the actor. Hot path uses the inverted map.

### §5.2 Malformed bypass — split disposition

When compile encounters a mailbox item that fails verification, the run does NOT die. Compile MUST emit a structured bypass record on `FinalResponseArtifact.bypassPartials[]` and a `compile_mailbox_item_bypassed` ledger event.

Disposition table:

| Condition | bypassReason | bypassDisposition |
|---|---|---|
| Slot not in template | `slot_type_mismatch` | `render_partial` |
| Slot type validator rejects | `slot_type_mismatch` | `render_partial` |
| Item's `agentId` ≠ mailbox-derived actorId | `malformed_output` | `withhold_quarantine` |
| Digest verification failure | `digest_mismatch` | `withhold_quarantine` |
| `guard.halt` fired on the item's OCT class | `guard_halt` | `withhold_quarantine` |

`render_partial` means the content is labeled and included on the artifact for workspace display. `withhold_quarantine` means the content is referenced (by mailboxItemId + provenance) but NOT included as renderable bytes — display is a "withheld" placeholder.

Contract:

```typescript
export interface BypassPartial {
  mailboxItemId: Uuid;
  sourceMailboxId: NonEmpty;
  sourceActorId: Uuid;
  bypassReason: 'malformed_output' | 'slot_type_mismatch' | 'guard_halt' | 'digest_mismatch';
  bypassDisposition: 'render_partial' | 'withhold_quarantine';
  /** Only set for render_partial. Path/URL to the raw bytes for the
   *  workspace renderer. Null for withhold_quarantine. */
  workspacePartialRef: NonEmpty | null;
}

export interface FinalResponseArtifact {
  // ... existing fields ...
  assembledSections: FinalSection[];
  bypassPartials: readonly BypassPartial[];
}
```

V1 workspace renderer: labeled prose block per `render_partial` entry, "withheld — see audit" placeholder per `withhold_quarantine` entry. Dedicated render component deferred to workspace-UI-polish phase.

V1 limits malformed-bypass to compile-time concerns. Agent ceiling denial / classification denial still kill the relevant node per existing law (those aren't compile's call to make).

---

## §6 Migration

### §6.1 Callsite enumeration (function-name references)

Touched callsites:
- `scripts/nexus-bootstrap.ts` — `LocalJsonlMailboxBackend` construction unchanged.
- `scripts/nexus-main.ts`:
  - `dispatchNxsNode` — mailbox write site
  - `dispatchToGovernance` — slot read site + final NVG write site
  - `triggerCompile` — compile read site
- `packages/interfaces/api/src/routes/*.ts` — admin UI mailbox surfaces (need allocation-aware listing)
- Tests:
  - `packages/core/src/mailbox/*.test.ts`
  - `packages/orch-ref/src/*.test.ts`
  - `tests/orchestration/multi-node-slot-binding.test.ts` (uncommitted in worktree)

HEAD pin at draft time: `18f09f9` + uncommitted slot-binding worktree changes.

### §6.2 Backwards compatibility

There is none. The primary mailbox lookup is removed. R2-WIRE-008 is superseded. Single `MailboxManifestRecord` continues to govern backend configuration.

### §6.3 Uncommitted slot-binding worktree

Today's worktree contains uncommitted slot-binding changes (resolver + contract + planner check + validate-plan Check 15 + integration test). They survive the pit largely intact:

- `NxsSlotBinding` contract: logical addressing by `subTaskKey + slotId`. Unchanged.
- `resolveNxsSlotBindings`: accepts `mailboxId` as input. Caller changes from "primary" to "the upstream actor's mailbox."
- Planner check + validate-plan Check 15: unchanged.
- `dispatchNxsNode` wiring: changes one line — the mailboxId passed to the resolver — plus integration test rewires under the new model.

The slot-binding work commits AFTER the pit is built and tested, with the test updated to the per-actor mailbox flow (task #7).

---

## §7 What Stays Unchanged

(Same as v0.1.0; all infra-externals §354-360 + §3.6 laws hold; the file resolver, slot validation, digest verify, OCT propagation, mailbox status transitions are all preserved.)

---

## §8 Out of Scope (Future Amendments)

(Same as v0.1.0: orch-as-listener, bidirectional inbox/outbox split, per-mailbox manifest, cross-run channels.)

---

## §9 Test Plan

### §9.1 New unit tests

- `MailboxServiceImpl.allocateForRun` — idempotency, deterministic mailboxId derivation, ledger event emission, persistence/reconstruction.
- `MailboxServiceImpl.getMailboxForActor` — null on unknown, correct on known, restart-recovery from ledger.
- `MailboxServiceImpl.listMailboxesForRun` — empty run, populated run, cross-run isolation.
- `MailboxServiceImpl.resolveMailboxProvenance` — returns typed `MailboxAllocation`, null on unknown.
- `MailboxServiceImpl.assertMailboxBelongsToActor` — passes on match, throws typed denial on mismatch.
- `OutputCollectorImpl.writeMailboxItemFromXxx` — calls `assertMailboxBelongsToActor`, rejects on mismatch.

### §9.2 Updated existing tests

- `packages/core/src/mailbox/mailbox-service.test.ts` — `findBySlot` cross-mailbox isolation assertions.
- `tests/orchestration/multi-node-slot-binding.test.ts` — rewire under per-actor model.

### §9.3 New integration tests

- `tests/orchestration/mailbox-pit-isolation.integration.test.ts` — two actors, same run, same `slotId`, assert actor A's findBySlot cannot see actor B's item, compile's `listMailboxesForRun` returns both.
- `tests/orchestration/mailbox-pit-malformed-bypass.test.ts` — two actors, agent B emits content failing slot-type validation, assert `compile_mailbox_item_bypassed render_partial` + bypassPartials structure + run_closed completed.
- `tests/orchestration/mailbox-pit-quarantine.test.ts` — digest-failed item triggers `withhold_quarantine`; assert raw bytes NOT in artifact, placeholder in bypassPartials.
- `tests/orchestration/mailbox-pit-allocation-restart.test.ts` — allocate, simulate restart (drop in-memory state), reconstruct from ledger, verify same mailboxIds.
- `tests/orchestration/mailbox-pit-slot-resolved-event.test.ts` — verify `mailbox_slot_resolved_for_dispatch` fires with correct reader/source provenance.

### §9.4 Acceptance

- All `ci:gate` checks green (current count at draft = 79; verify gates added during the build phase don't regress).
- `vitest run` all suites green.
- `vitest -c vitest.integration.config.ts` all suites green (existing 52 + the new ones).
- Live workspace run (warehouse worked example) shows expected per-actor allocation, slot-resolved events, and compile-list events in the run ledger.

---

## §10 Owner Decisions — Resolved (this revision)

1. ✅ MailboxId naming: `mbx-v1-run-<runId>-actor-<actorId>` — APPROVED per owner.
2. ✅ OutputCollector parameterization: `MailboxWriteContext` typed object — APPROVED per owner.
3. ✅ Bypass UI: structured contract + V1 labeled-prose renderer + "withheld" placeholder for quarantined — APPROVED per owner.
4. ✅ Ledger event names: `mailbox_allocated`, `compile_mailbox_item_bypassed`, `compile_mailboxes_listed`, `mailbox_slot_resolved_for_dispatch` — APPROVED per owner.
5. ✅ No pre-allocate orch inbox in V1 — APPROVED per owner.
6. ✅ Migration ordering: separate commits on same branch — APPROVED per owner.

---

## §11 Risk Log (revised)

### Risks preserved from v0.1.0

- **OutputCollector lifecycle.** Mitigated by `MailboxWriteContext` (§3.6) and write-time assertion (§3.6). Grep guard remains useful at code-review time for any future write path added by someone who doesn't know the pit model.
- **Multi-instance backends.** Out of V1 scope; factory registry already supports the architecture.
- **Lexicon planner intersection.** Idempotency handles plan amendment; fresh allocation events on new agents.

### New risks

- **Allocation persistence on restart.** If persistence layer fails OR ledger events are missing, `listMailboxesForRun` returns incomplete data. Mitigation: deterministic derivation + ledger reconstruction as fallback. Test: §9.3 restart test.
- **Raw bypass content leaks unsafe data.** Mitigated by §5.2 split disposition (digest/guard quarantine never renders raw bytes).
- **Mailbox ownership mismatch accepted too late.** Mitigated by §3.6 write-time `assertMailboxBelongsToActor`. Compile mismatch (§5.1) remains as defense-in-depth.
- **Cross-actor slot reads under-audited.** Mitigated by §3.4.4 `mailbox_slot_resolved_for_dispatch` event.
- **Naming seam (`agentId` orch vs `actorId` mailbox).** Logged DIFF-MAILBOX-PIT-001; accept-in-V1; defer orch rename to orch-listener amendment.
- **Contracts surface expansion.** Four new `RunEventType` values and one new contract type (`MailboxAllocation`, `BypassPartial`). Additive; will not break existing consumers, but crosses Layer 2 — needs its own ci:gate verification on barrel exports + no-zod-import guard.

---

## §12 Logs to Open at Build Time

```
DIFF-MAILBOX-PIT-001 | spec: §2.2 + §3.7 | blueprint: orch-ref contracts vs mailbox-pit contracts | orch uses `agentId`, mailbox uses `actorId`, same UUID. Documented seam in V1; orch rename deferred to orch-listener amendment | required to keep naming canonical without forcing a wide orch rename now | downstream: orch-listener amendment must close this | status: open, accepted V1

ADD-MAILBOX-PIT-001 | spec: §3.4 | infra-externals spec §3.6 RunEventType union | Four new RunEventType values: `mailbox_allocated`, `compile_mailboxes_listed`, `compile_mailbox_item_bypassed`, `mailbox_slot_resolved_for_dispatch` | required for mailbox-pit allocation + compile + slot-resolution audit | downstream: ledger viewer UI, run-timeline renderer | status: pending build phase

CONTRA-MAILBOX-PIT-001 | spec: §0.3 supersedence | infra-externals spec R2-WIRE-008 line 95 | "V1 governed runtime permits exactly one enabled required mailbox" — superseded by mailbox-pit per-actor allocation | required because mailbox-pit allocates many per-run mailboxIds; the single-mailbox V1 constraint is incompatible | downstream: any test/doc that references R2-WIRE-008 must be updated | status: owner approval pending on this amendment

HOLE-001 (CLOSED) | spec v0.1.0 header `Amends:` line | nexus-blueprint-v1-5-13.md §3.5/§3.6 (zero mailbox content) | v0.1.0 spec pointed at wrong canonical document | RESOLVED by header correction in v0.2.0 + this risk log | downstream: none after v0.2.0 ratified | status: closed (this revision)

HOLE-002 (CLOSED) | spec v0.1.0 §2.3 row | canonical event name `compile_started` per packages/contracts/src/interfaces/index.ts:896 | v0.1.0 used correct name; A2 flagged it as worth verifying | RESOLVED via grep | status: closed (no spec change)
```
