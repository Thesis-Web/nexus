# Repair-mode out-of-scope findings — 2026-05-21 (Pass 2)

Pass-2 repair session focused on the next two sub-clusters per owner
ratification:
- 5 NXS single-dispatch reads (E2E-21, 22, 24, 25, 27)
- 6 Hard Law surface tests (E2E-111, 115, 116, 117, 119, 120)

Plus closure of F-1 (Gate 02 capability classification drift) which
was logged as out-of-scope in Pass 1's findings doc.

## In-scope (LANDED in this pass)

Documented here only to set context for the out-of-scope notes
below.

- **F-1 closed.** `scripts/nexus-main.ts` orchestrator AgentAction
  synthesis now JSON-encodes the full target into `rawTarget`, so
  `TargetNormalizer.normalize` takes its existing `fromParsed` JSON
  branch (preserving system / resourceType / resourceScope /
  externalFacing exactly). `resolveCapability` now returns
  `READ_RECORD_BULK` for planner-declared bulk reads.
- **nxs_action audit-trail target field** now uses
  `evidence.actionSummary.resolvedTarget.system` (the canonical
  Gate-02-normalized system identifier) instead of the JSON-encoded
  `rawTarget` blob. Downstream consumers reading `detail.target` see
  a clean system name.
- **5 NXS single-dispatch read tests** live against real postgres
  fixtures: E2E-21 (sr_analyst recent sales orders), E2E-22
  (sr_analyst Acme orders), E2E-24 (sr_analyst warehouse low-stock),
  E2E-25 (manager top-customers aggregation), E2E-27 (director
  warehouse reorder list).
- **6 Hard Law surface tests** real and green: E2E-111 (auth-first),
  E2E-115 (no tool descriptors), E2E-116 (mailbox-only data hub),
  E2E-117 (compile pass-through digest match), E2E-119 (symmetric
  intersection), E2E-120 (no agent-reachable bypass HTTP).

## Out-of-scope findings

### F-8 [SPEC_DRIFT, mailbox manifest] — `primaryMailbox` concept is deprecated but still referenced

**Severity**: low. The reference HTTP mailbox route at
`packages/interfaces/api/src/routes/mailbox.ts` is bound to a single
"primary mailbox" via `deps.primaryMailbox`. The actual NXS dispatch
path uses per-actor mailboxes (`mbx-v1-run-<runId>-actor-<actorId>`)
per AMEND-nexus-mailbox-pit-v0-2-1 §3.6. The route is now closed to
agents (admin-auth-scoped at `routes/index.ts:270-275`), so HL#8 is
not violated — but the `primaryMailbox` shape carries a stale
mental model.

**Evidence**:
- `packages/interfaces/api/src/routes/mailbox.ts:36-84` — uses
  `deps.primaryMailbox.mailboxId` exclusively.
- `scripts/nexus-bootstrap.ts:724-725` — `primaryMailbox =
  socketRegistry.getPrimaryMailbox()` and the LocalJsonlMailboxBackend
  is bound to its `storageRoot`.
- All NXS-dispatch mailbox items go through `MailboxService.write`
  with per-actor mailboxIds; the primary mailbox manifest record's
  storageRoot is shared across writers but the mailboxId is not.

**Why out of scope**: the structural isolation invariant (HL#8) is
preserved by routing + auth. Cleaning up the `primaryMailbox`
naming is a follow-on housekeeping patch.

---

### F-9 [SPEC_DRIFT / observability] — relative `storageRoot` paths resolve against repoRoot, not harness tmpCwd

**Severity**: low — affects test harness only, not production.

**Evidence**:
- `config/mailbox/mailboxes.v1.yaml` declares `storageRoot: runs/mailbox`
  (relative path).
- `config/compile/compilers.v1.yaml` similarly declares relative
  output paths.
- `tests/e2e/harness.ts` spawns the server via
  `pnpm --dir <repoRoot> nexus serve` — pnpm changes its own cwd to
  `repoRoot` so the spawned tsx process inherits that cwd at the
  point relative-path resolution happens. The result: mailbox items
  and compile artifacts from harness runs land under the REAL
  repo's `runs/mailbox/` and `runs/compile/`, not the harness's
  `tmpCwd/runs/`. The `nexus.ledger.jsonl` is in the right place
  only because the harness sets `NEXUS_LEDGER_PATH` env override.

**Why out of scope**: harness tests still work — they read repo-root
paths. The pollution is a test-hygiene issue. The fix is either env
overrides for mailbox/compile storage roots, or absolute-path
resolution in the manifests, or harness-side path rewrites.

---

### F-10 [SPEC_DRIFT / persona ladder] — catalog names use "analyst" for queries that require `read:record:bulk`

**Severity**: low — wall slot strings are colloquial labels.

**Evidence**:
- The catalog wall slot E2E-21 (and E2E-22) is named
  `nxs-sales-list-orders: analyst → last 7 days of sales orders`,
  but `scripts/seeds/user-ladder-seeds.ts:140-145` gives the analyst
  persona only `[search:public, summarize, read:record:single, query:data]`
  — no `read:record:bulk`. A literal "list orders" query is bulk.
- The promoted tests in Patch 52 use `sr_analyst` (the smallest
  persona with bulk) and document the deviation per test. The wall
  slot name string is preserved verbatim; only the persona used in
  the test body deviates.

**Why out of scope**: per the owner directive ("no widening RBAC to
make tests pass"), the seed is the law. The right longer-term fix
is either (a) update the catalog wall slot names so `analyst →
single-record lookup` and `sr_analyst → bulk list`, or (b) add
`read:record:bulk` to the analyst persona if the spec intends an
analyst can do bulk sales reads. Owner ratification needed.

---

### F-11 [PRODUCT_RUNTIME / unblocked tests] — Pass 2 unblocks N additional catalog slots

**Severity**: action item.

After Patches 51-53, the following tests are no longer transitively
blocked and could be promoted in a future pass:

- E2E-26 (sr_manager bulk export) — was bridge-blocked, now testable
  via the helper added in Patch 52.
- E2E-29 (manager bulk update) — was bridge-blocked; needs an UPDATE
  variant of `assertNxsReadForensicEnvelope` that handles the
  write-receipt mailbox item shape.
- E2E-71..75, E2E-77 — batch-summary scenarios that were transitively
  blocked on the bridge bug. Each is a copy/paste of the helper
  pattern.
- E2E-81..89 — multi-source merge scenarios. Each needs the helper
  plus a 2-node subTasks DAG.
- E2E-101..108 — RBAC differential scenarios that fire Gate 02/03/04
  denials. Most don't need the bridge at all.

**Why out of scope**: this pass is bounded to the 11 tests the owner
ratified. Listed here so the next repair pass can pick the next
priority bracket. F-7 from Pass 1 grouped these by failure class; this
finding refines the count after Pass 2's helper-driven promotions.

---

### F-12 [HARNESS_BUG, observability] — `tool_schemas_attached` event detail shape varies

**Severity**: low.

**Evidence**:
- `scripts/nexus-main.ts:1071-1086` emits `tool_schemas_attached`
  with `toolCount, toolNames, capabilityRefs, targetSystems,
  schemaDigest`. But ONLY when `toolDescriptors.length > 0`. So the
  steady state for chat runs (no tools) is "event absent" —
  E2E-115's structural assertion accepts both "absent" and
  "present with toolCount: 0".
- This is fine for the HL#7 test but means the audit trail does NOT
  positively confirm "we attached zero tools on every NVG call". A
  belt-and-suspenders fix would emit the event with toolCount: 0
  unconditionally on every NVG turn — that makes the absence of the
  event itself diagnosable instead of being inferred.

**Why out of scope**: HL#7 IS verified by current E2E-115. The
belt-and-suspenders emit is a future audit-completeness patch.

---

### F-13 [SPEC_DRIFT, naming] — `closeReason` event field literal `'completed'`

**Severity**: very low.

**Evidence**: The successful `run_closed` event detail uses
`closeReason: 'completed'` while the audit summary canonical
final-outcome label is `FINAL_OUTCOME.EXECUTED = 'executed_
successfully'`. These are different fields with different
semantics (closeReason is run-lifecycle; finalOutcome is action-
level) so they're not in direct conflict, but the parallel
vocabulary risks confusion. Tests now use `closeReason === 'completed'`
as the canonical signal of a successful run.

**Why out of scope**: same vocabulary debate as F-2 (FINAL_OUTCOME
naming) — the constants are right where they are; the duplication is
informational, not load-bearing.
