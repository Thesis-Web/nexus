# Amendment — Mailbox Pit (per-actor mailbox isolation)
# Version: v0.1.0 (DRAFT — pending owner approval)
# Date: 2026-05-12
# Status: DRAFT — not yet ratified
# Amends: nexus-blueprint-v1-5-13.md §3.5/§3.6 (Mailbox contracts) +
#         AMEND-blueprint-nexus-infra-externals-v1-0-0.md (Mailbox Service)
# Author: Claude (deterministic build agent), under owner direction
# Owner: James Huson / Lake Area LLC

---

## Scope Statement

This amendment replaces the single-primary-mailbox-per-run model with a
**mailbox pit**: a set of named per-actor mailboxes physically isolated
in the storage backend and assigned per-run by orch.

The amendment is motivated by a real security boundary, not optimization:
in the current single-primary model the isolation between agents is
logical only (the dispatcher filters by `slot + task`). Any bug in the
filter path exposes one agent's slot data to another agent's listener
view. With per-actor mailboxes the storage layer itself enforces the
boundary — same way OS file permissions are stronger than "the code
is careful."

The amendment also lays the foundation for compile-provenance-by-
mailbox-source: compile can identify which agent emitted each piece of
content from the mailbox the item lives in, rather than trusting the
LLM to self-tag in the prose body.

**Out of scope** (explicit, captured for future amendments):

1. **Orch-as-mailbox-listener** with push/subscribe semantics. V1 keeps
   the pull-based reading orch already does (dag-walk + findBySlot).
   The orch-listener piece (where orch picks up agent output from a
   dedicated orch inbox and dynamically re-plans) is a separate
   amendment.
2. **Bidirectional mailboxes** with explicit inbox / outbox roles. V1
   uses one mailbox per (run, agent) where the agent both writes its
   own outputs to its mailbox AND reads upstream slot data from
   upstream agents' mailboxes (via orch resolving slot reads on the
   agent's behalf at dispatch time). Compile reads from all listed
   agent mailboxes for the run.
3. **Multi-round framework distribution** (the bash compiler.sh
   pattern where compile drops "framework" back into each agent's
   mailbox for round 2). Belongs to the orch-listener amendment.
4. **Mailbox-as-channel addressing** for cross-run flows. V1 is
   strictly per-run scoping.

---

## §1 Problem Statement

### §1.1 Today's single-primary model

`scripts/nexus-bootstrap.ts:704-707` constructs ONE `LocalJsonlMailboxBackend`
at the storage root configured by the primary mailbox manifest record. The
composition root uses `br.externals.socketRegistry.getPrimaryMailbox()` at
every dispatch site (`nexus-main.ts:557`, `:669`, `:1086`, `:1259`). Every
`MailboxItem` written during any run lands in the same physical store,
discriminated only by `mailboxItemId`, `runId`, `taskId`, `slotId`,
`agentId`.

Filter paths in production:
- `MailboxService.findBySlot(mailboxId, runId, taskId, slotId)` filters by
  `(taskId, slotId, status='available')` AFTER `listByRun` returns
  everything for the run.
- `MailboxService.listEligibleForCompile(mailboxId, runId)` returns every
  item for the run.

A bug in either filter — wrong taskId, wrong slot match, missing status
check — leaks across actors.

### §1.2 Why physical isolation matters

- **Agent / LLM is the unsafe actor.** It transforms, hallucinates,
  drifts. Letting it ever see another agent's bytes is a governance
  failure regardless of the slot it queries.
- **Orch and compile are deterministic.** They read across actors by
  design — that's fine.
- **Provenance for compile.** When compile assembles outputs from N
  agents, the mailbox-source IS the provenance. The agent does not have
  to self-tag its output for compile to know who emitted it. This is
  load-bearing for the "agent might lie about its own attribution"
  failure mode.

---

## §2 Architecture — Per-Actor Mailbox Model

### §2.1 Mailbox identity

Each (run, agent) pair owns a distinct mailbox in the backend:

```
mbx-<runId>-agent-<agentId>
```

`mailboxId` is computed deterministically from the run and agent so
audit can re-derive without storing the mapping. Format is
implementation detail — what matters is that two distinct `(runId,
agentId)` pairs always map to distinct `mailboxId` strings.

### §2.2 What lives in each mailbox

An agent's mailbox holds **every mailbox item produced under that
agent's authority for the run** — both NVG results (the LLM's text)
and NXS results (the connector's read / receipt / data payload),
regardless of which plan node produced it. The `taskId + slotId`
addressing inside the mailbox still distinguishes per-node outputs;
the mailbox itself is the per-agent envelope.

Two distinct agents NEVER share a mailbox, even within the same run.

### §2.3 Allocation lifecycle

| Stage | What happens |
|---|---|
| `run_opened` | No mailboxes yet — plan hasn't been built |
| `plan_confirmed` | Orch enumerates `plan.nodes`, derives the unique `agentId` set, allocates one mailbox per unique agentId. `mailbox_allocated` event written to run ledger for each. |
| Per-node dispatch | Composition root looks up the producing agent's mailbox via `getMailboxForActor(runId, agentId)`. Writes go to that mailbox. |
| Per-node slot reads | Composition root resolves an upstream slot by computing the UPSTREAM agent's mailbox (from the upstream node's `agentId`) and calling `findBySlot(upstreamMailboxId, runId, upstreamNodeId, slotId)`. |
| `compile_started` | Compile receives a list of every mailbox allocated for the run + reads from each. |
| `run_closed completed` | Each mailbox's items are marked consumed per existing `markConsumed` path. Mailbox records persist for audit per the existing `retentionPolicy.metadataRetention`. |
| `run_cancelled` | `cancelRun` runs on each allocated mailbox; items go to `cancelled`. |

### §2.4 No orch mailbox in V1

V1 deliberately does NOT allocate a dedicated orch inbox. Orch reads
agent mailboxes directly via the existing dag-walk + findBySlot
mechanism. The orch-as-listener pattern (where orch has its own inbox
agents drop work-products into) is a separate amendment because it
requires push/subscribe semantics on the MailboxBackend and a re-
planning surface in the coordinator. We do not stub that here.

### §2.5 No compile mailbox in V1

V1 deliberately does NOT allocate a dedicated compile inbox. Compile
reads from every allocated agent mailbox for the run. This preserves
the mailbox-source-as-provenance property — every item compile sees
came from a known agent's mailbox, and the mailbox name resolves back
to the agent. A separate amendment can add a compile inbox if multi-
round compile patterns require it.

---

## §3 Surface Changes

### §3.1 MailboxService extensions

`packages/contracts/src/externals/mailbox.ts`:

```typescript
export interface MailboxService {
  // Existing — unchanged signature:
  writeFromOutput(input: MailboxWriteInput): Promise<MailboxItem>;
  listEligibleForCompile(mailboxId: NonEmpty, runId: Uuid): Promise<MailboxItem[]>;
  markConsumed(mailboxId: NonEmpty, runId: Uuid, itemIds: Uuid[]): Promise<void>;
  cancelRun(mailboxId: NonEmpty, runId: Uuid, reason: DenialCode): Promise<void>;
  findBySlot(mailboxId: NonEmpty, runId: Uuid, taskId: Uuid, slotId: NonEmpty): Promise<MailboxItem | null>;

  // NEW — V1 mailbox-pit:

  /** Allocate one per-agent mailbox for each unique agentId in the
   *  agents set, idempotent. Returns the canonical mailboxId for each.
   *  Emits `mailbox_allocated` to the run ledger for each new
   *  allocation. Existing allocations are returned unchanged. */
  allocateForRun(
    runId: Uuid,
    agents: readonly Uuid[]
  ): Promise<ReadonlyMap<Uuid, NonEmpty>>;

  /** Return the canonical mailboxId for a (runId, agentId) pair.
   *  Returns null when no allocation exists. Does NOT auto-allocate —
   *  allocateForRun must have run first. */
  getMailboxForActor(runId: Uuid, agentId: Uuid): Promise<NonEmpty | null>;

  /** Enumerate every mailbox allocated for the run, keyed by agentId.
   *  Used by compile to list its read targets. */
  listMailboxesForRun(runId: Uuid): Promise<ReadonlyMap<Uuid, NonEmpty>>;
}
```

`MailboxBackend` (replaceable storage abstraction) is unchanged. The
backend already discriminates items by `mailboxId`; the pit model just
uses many distinct `mailboxId` values per run instead of one.

### §3.2 MailboxManifestRecord — no schema change

The manifest record already describes ONE backend's configuration.
V1 uses a single backend for the whole pit (one `LocalJsonlMailboxBackend`
instance handles every per-actor mailbox via per-mailboxId file
naming). The manifest's `storageRoot`, `retentionPolicy`,
`classificationRequired`, `digestRequired` apply uniformly.

A future amendment may introduce per-mailbox configuration if
enterprise deployments need it (e.g., different retention for
secure-OCT agent mailboxes). Out of scope for V1.

### §3.3 Run ledger events

Three new event types:

```typescript
// In RunEventType union (packages/contracts/src/interfaces/index.ts):
type RunEventType =
  | ...
  | 'mailbox_allocated'      // one per per-actor mailbox allocation
  | 'mailbox_bypass_partial' // compile encountered a malformed item; bypassed to workspace
  | 'mailboxes_listed';      // compile enumerated mailboxes for assembly
```

`mailbox_allocated` detail shape:

```typescript
{
  mailboxId: NonEmpty,
  runId: Uuid,
  agentId: Uuid,
  allocatedAt: IsoTimestamp,
}
```

`mailboxes_listed` detail shape:

```typescript
{
  runId: Uuid,
  mailboxCount: number,
  mailboxIds: readonly NonEmpty[],
}
```

`mailbox_bypass_partial` detail shape (§5.2):

```typescript
{
  mailboxItemId: Uuid,
  sourceMailboxId: NonEmpty,
  sourceAgentId: Uuid,
  bypassReason: 'malformed_output' | 'slot_type_mismatch' | 'guard_halt',
  workspacePartialRef: NonEmpty,  // pointer to the partial we emitted
}
```

### §3.4 Composition-root callsite changes

`scripts/nexus-main.ts`:

| Site | Today | After |
|---|---|---|
| `dispatchNxsNode` mailbox write | `socketRegistry.getPrimaryMailbox().mailboxId` | `mailboxService.getMailboxForActor(runId, node.agentId)` |
| `dispatchToGovernance` nvg input slot reads | `socketRegistry.getPrimaryMailbox().mailboxId` | `mailboxService.getMailboxForActor(runId, upstreamNode.agentId)` |
| `dispatchToGovernance` final NVG mailbox write | `socketRegistry.getPrimaryMailbox().mailboxId` (implicit via OutputCollector) | OutputCollector parameterized by the dispatching agent's mailboxId |
| `triggerCompile` | `socketRegistry.getPrimaryMailbox().mailboxId` then `listEligibleForCompile` | `mailboxService.listMailboxesForRun(runId)` → for each mailboxId call `listEligibleForCompile` |
| `resolveNxsSlotBindings` (the slot-binding work in the worktree) | takes `mailboxId` as input today | unchanged signature — caller now supplies the upstream agent's mailboxId |

`OutputCollectorImpl` (`packages/core/src/output/output-collector.ts`)
holds `mailboxId` on construction today. After the pit, EITHER:
- (a) construct one OutputCollector per agent per run (cheap; reuse all other deps), or
- (b) parameterize `writeMailboxItemFromXxx` with an explicit `mailboxId` argument.

V1 recommendation: **(b)**, because the OutputCollector wires are
already shared across many call sites; adding a per-write parameter
is a smaller diff than restructuring lifecycle.

### §3.5 Plan allocation step in RefRunCoordinator

`packages/orch-ref/src/run-coordinator.ts` `handleRun`:

After `plan_confirmed` (step 3) and before delegation issuance (step
4), insert a new step:

> **Step 3.6 — Mailbox allocation.** Enumerate `plan.nodes.map(n => n.agentId)`, dedup, call `deps.mailboxService.allocateForRun(request.runId, uniqueAgents)`. Persist the returned map for downstream dispatch lookups. Emit `mailbox_allocated` per allocation.

Per-run dep list (`RunCoordinatorDeps`) is unchanged — the mailbox
service is already there.

---

## §4 Lifecycle Detail

### §4.1 Allocation

- Allocation is **idempotent**. `allocateForRun(runId, agents)` called
  twice with the same input returns the same mailboxIds. The
  implementation derives mailboxId deterministically from `(runId,
  agentId)` so audit reconstruction works without persisted state.
- Allocation does NOT write a record to the backend. The backend's
  per-mailbox file/path appears only when the FIRST item is written
  to that mailbox. This avoids empty-mailbox directories for plans
  where some agents never get dispatched (e.g., conditional branches).
- `mailbox_allocated` event is the audit record of allocation.

### §4.2 Drainage and consumption

Existing `markConsumed` law applies per-mailbox. When `compile_return`
is accepted, the coordinator iterates `listMailboxesForRun(runId)` and
calls `markConsumed(mailboxId, runId, items)` for each. The
`compile_return` route does not need to change.

### §4.3 Retention

Per the existing `MailboxManifestRecord.retentionPolicy.payloadTtlSeconds`
+ `metadataRetention`. Applies per-mailbox-item, same as today.

### §4.4 Cancellation

`cancelRun(mailboxId, runId, reason)` is called for each allocated
mailbox during the run-cancelled path. The composition root iterates
`listMailboxesForRun`.

---

## §5 Compile Provenance + Malformed Bypass

### §5.1 Provenance via source mailbox

When compile reads, each `MailboxItem` carries `agentId` AND lives in
a mailbox whose id encodes `(runId, agentId)`. Compile MUST treat
**the source mailboxId as authoritative provenance**, never the
item's `agentId` field alone (which the agent could in theory cause
to drift if a future write path mis-tags). For default compile, that
means:

- `CompileService.buildOutputContract` lists items grouped by source
  mailboxId.
- Templated compile's slot-matcher matches `(assignedAgentId, expected
  SlotId)` against the source-mailbox derivation of agentId, not the
  item's `agentId` field directly. (Implementation: when reading from
  mailbox M, agent provenance = `decodeAgentIdFromMailboxId(M)`. The
  item's `agentId` is checked to equal this; mismatch → bypass.)

### §5.2 Malformed bypass to workspace partial

When compile encounters a mailbox item that:
- has a `resultRef` whose digest fails to verify, OR
- has a `slotId` that doesn't match any template slot, OR
- carries a content body that fails the slot's type validator (e.g.,
  prose validator rejecting an object), OR
- triggers a `guard.halt` rule on its OCT class,

compile MUST NOT kill the run. Instead:

1. Skip the item in the templated assembly.
2. Emit a `mailbox_bypass_partial` ledger event with provenance.
3. Append the bypassed content (as opaque bytes + provenance label)
   to a **partial bypass section** of the FinalResponseArtifact.
4. Continue assembling the rest of the document.

The workspace UI renders the partial bypass section visually
distinguished from the assembled portion, with the source agent
labeled so the user can see "Agent 3's output was malformed; raw
contribution shown below for reference."

V1 limits malformed-bypass to compile-time concerns; agent ceiling
denial / classification denial still kill the relevant node per
existing law (those aren't compile's call to make).

---

## §6 Migration

### §6.1 What touches the primary mailbox today

A grep at draft-time:

- `scripts/nexus-bootstrap.ts:707` — constructs the backend
- `scripts/nexus-main.ts:557,669,1086,1259` — primary mailbox lookups
- `packages/interfaces/api/src/routes/*.ts` — surfaces mailbox status to admin UI
- Tests in `packages/core/src/mailbox/`, `tests/orchestration/`, and `packages/orch-ref/src/`

Each call site needs to be threaded through `getMailboxForActor` or
`listMailboxesForRun` per §3.4. The diff is mechanical but spans
several files.

### §6.2 Backwards compatibility

There is none. The primary mailbox lookup is removed. The reference
harness build is a self-contained MVP — there are no external
deployments to migrate. The single `MailboxManifestRecord` continues
to govern backend configuration.

### §6.3 The uncommitted slot-binding work in the worktree

Today's worktree contains uncommitted slot-binding changes (resolver +
contract + planner check + validate-plan Check 15 + integration test).
They survive the pit largely intact:

- `NxsSlotBinding` contract: logical addressing by `subTaskKey + slotId`.
  Unchanged.
- `resolveNxsSlotBindings`: accepts `mailboxId` as input. Caller
  changes from "primary" to "the upstream agent's mailbox."
- Planner check + validate-plan Check 15: unchanged.
- `dispatchNxsNode` wiring: changes one line — the mailboxId passed
  to the resolver — and the integration test rewires under the new
  model.

The slot-binding work commits AFTER the pit is built and tested,
with the test updated to the per-actor mailbox flow.

---

## §7 What Stays Unchanged

- `MailboxItem` schema. All fields, all semantics.
- `MailboxBackend` interface. Per-mailboxId items already supported.
- Payload resolution (`PayloadResolverRegistry`, file:// resolver).
- Digest verification on every mailbox write.
- Slot validation (`DeclaredOutputSlotReader`) law.
- Mailbox eligibility computation (`computeMailboxEligibility`).
- Existing `MailboxStatus` transitions: available → blocked /
  cancelled / expired / consumed.

---

## §8 What Goes In a Future Amendment

Captured for the next planning pass:

- **Orch-as-listener / push semantics.** Orch picks up agent outputs
  from a dedicated orch inbox; coordinator re-plans dynamically based
  on content. Required for multi-round patterns (compiler.sh).
- **Bidirectional inbox/outbox split.** Distinguish "this agent's
  incoming work data" from "this agent's outgoing results." V1 uses
  one mailbox per agent for both directions; some workloads will
  want the split.
- **Per-mailbox manifest configuration.** Secure-OCT agents may need
  different retention / classification rules than public-OCT agents
  in the same run.
- **Cross-run mailbox channels.** Long-running agent processes that
  subscribe across multiple runs (the bash long-running-watcher
  pattern). Requires backend subscription semantics.

---

## §9 Test Plan

### §9.1 New unit tests

- `MailboxServiceImpl.allocateForRun` — idempotency, deterministic
  mailboxId derivation, ledger event emission.
- `MailboxServiceImpl.getMailboxForActor` — null on unknown, correct
  on known.
- `MailboxServiceImpl.listMailboxesForRun` — empty run, populated run,
  cross-run isolation (other run's allocations don't leak).

### §9.2 Updated existing tests

- `packages/core/src/mailbox/mailbox-service.test.ts` — augment
  `findBySlot` tests to assert items in mailbox A don't appear in
  results for mailbox B.
- `tests/orchestration/multi-node-slot-binding.test.ts` (uncommitted
  in worktree) — rewire under the per-actor mailbox model.

### §9.3 New integration test

`tests/orchestration/mailbox-pit-isolation.integration.test.ts`:
- 2 agents in the same run
- Each writes a mailbox item with the same `slotId`
- Assert agent A's `findBySlot` cannot retrieve agent B's item
- Assert compile's `listMailboxesForRun` returns both mailboxes
- Assert provenance per item resolves back to the correct agent

### §9.4 New negative test

`tests/orchestration/mailbox-pit-malformed-bypass.test.ts`:
- 2 agents in the same run with an output contract
- Agent A emits well-formed content
- Agent B emits content that fails slot-type validation
- Assert compile assembles agent A's contribution normally
- Assert `mailbox_bypass_partial` event fires for agent B
- Assert the FinalResponseArtifact contains agent A's assembled
  section AND agent B's bypass partial labeled with its source
- Assert run_closed completed (not failed)

### §9.5 Acceptance

- `pnpm ci:gate` → 79/79 green
- `vitest run` → all suites green
- `vitest -c vitest.integration.config.ts` → all integration suites
  green (the existing 52 + the new ones)
- Live workspace run (warehouse worked example) shows the expected
  per-agent mailbox creation + reads + compile-list events in the
  run ledger.

---

## §10 Owner Decisions Needed

1. **MailboxId naming convention.** Proposed: `mbx-<runId>-agent-<agentId>`.
   Approve or override.
2. **OutputCollector parameterization.** §3.4 proposed option (b)
   (per-write mailboxId argument). Approve or pick (a) (per-agent
   OutputCollector instance).
3. **Compile bypass partial — workspace UI shape.** §5.2 emits the
   bypass as a structured field on the FinalResponseArtifact. Does the
   workspace want a dedicated render component, or is a labeled prose
   block acceptable for V1?
4. **Ledger event names.** §3.3 names: `mailbox_allocated`,
   `mailbox_bypass_partial`, `mailboxes_listed`. Approve naming.
5. **Should V1 also pre-allocate a per-run orch inbox** (even if not
   used yet, to reserve the mailboxId pattern for the future amendment)?
   Recommendation: NO — don't reserve what isn't used; allocate when
   the orch-listener amendment lands. Approve or override.
6. **Migration ordering.** Confirm: pit build lands first; then slot-
   binding rewires + integration test on top of the pit; then commit
   the combined piece. Or: pit + slot-binding in one commit.
   Recommendation: separate commits — pit alone is large enough to
   review independently.

---

## §11 Honest Risks

- **OutputCollector lifecycle.** §3.4 option (b) means every mailbox
  write site needs the mailboxId at the callsite. If a write happens
  in a path that doesn't know the dispatching agent's id, that's a
  bug we'll catch in build. Should be findable by grep.
- **Compile-time provenance derivation.** §5.1 derives agentId from
  mailboxId. If the derivation is implementation-specific
  (`mbx-<runId>-agent-<agentId>` parsing) instead of a stored
  mapping, refactors of the naming scheme break the derivation.
  Mitigation: encapsulate as `mailboxService.decodeAgentIdFromMailboxId`
  with its own test.
- **Multi-instance backends.** A future enterprise might split
  storage across multiple backends (one per OCT class). V1's
  manifest-driven single-backend model doesn't preclude this — the
  backend factory registry already supports multiple types — but
  the routing-by-OCT layer isn't in V1. Worth flagging so a future
  amendment can extend without rebuilding.
- **Lexicon planner intersection.** When the lexicon planner emits
  multi-node plans, every agentId in the plan triggers a mailbox
  allocation at `plan_confirmed`. Plans that revise during a run
  (plan amendment, §11.6.6 of the orch amendment) will re-call
  allocateForRun; idempotency handles the no-op case but new agents
  added by an amendment trigger fresh allocations + ledger events.
  This is correct behavior, captured for the lexicon spec's
  reference.
