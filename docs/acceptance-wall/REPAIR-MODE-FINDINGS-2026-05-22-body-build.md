# Repair-mode out-of-scope findings — 2026-05-22 (body-build session)

Body-build session against the acceptance wall, three commits at HEAD
`96e2cac` on `feat/beta1-admin-dashboard`:

- `6eefd43 test(e2e): body E2E-CHAT-ONPREM-CATALOG — 9 slots bodied`
- `e6fc994 test(e2e): body E2E-28 + E2E-113 + E2E-114; refresh E2E-29 metadata`
- `96e2cac test(e2e-metadata): refresh batch/merge/multi-no-contract blockers post bridge fix`

Wall delta: **32 → 35 passing** (+3, -3 failing). Zero regressions
(the prior 32 are all still green). Failure-class shift on the 9
newly-bodied chat-onprem clones:
`UNIMPLEMENTED_TEST_BODY → UNCLASSIFIED` (real bug surfaced — see F-15).

Per-test ledger snapshot at
`docs/acceptance-wall/FAILURE-LEDGER-2026-05-22-body-build.{md,jsonl}`.

## In-scope (LANDED this session)

- **Cluster 3 (E2E-HARD-LAW-CATALOG, 2/2)**: E2E-113 (HL#5 NXS bypass)
  and E2E-114 (HL#6 NVG/LLM bypass) bodied as narrower companions to
  E2E-120. Each probes a category-specific bypass paths set with no
  auth header; accepts 401/403/404/405 or HTML SPA fallback; rejects
  2xx-non-HTML. Both PASS.
- **Cluster 10 (E2E-RBAC body-only, 1/8)**: E2E-28 (analyst → DELETE
  on sales → Gate 03 / HL#15 denied) bodied in 03-nxs-single. Body
  asserts denial via either `delegation_empty_intersection` on
  capabilities, or `nxs_action` with `finalOutcome != EXECUTED`. Hard
  floor: zero `executed_successfully`. PASS.
- **Cluster 1 (E2E-CHAT-ONPREM-CATALOG, 9/9 bodied — all RED)**:
  E2E-02..E2E-10 bodied as clones of E2E-01 with `runChatOnprem` +
  `assertChatOnpremEnvelope` helpers extracted. All 9 land RED with
  the same real-system assertion failure — wall surfaced F-15 below.
- **Metadata refreshes (cluster 8 partial + cluster 2 helper)**:
  E2E-29 individually + `batchBlocked` / `mergeBlocked` /
  `multiNoContractBlocked` helper rationale in files 04 / 08 / 09
  point at the actual remaining blockers post bridge fix (43e5ed3).

## Out-of-scope findings

### F-15 [SEED_DRIFT, PRODUCT_RUNTIME] — default chat agent's `allowedSystems=['stub']` is disjoint from every ladder persona's seed; HL#15 intersection denies the entire chat path for non-admin users

**Severity**: high. Directly blocks 9 catalog slots (E2E-02..E2E-10);
transitively blocks ~25 additional slots that route any leg through
the chat workspace (multi-no-contract fan-out, callback-flow,
second-run-chain, batch-summarize, several RBAC differentials).

**Evidence (verified by 9 newly-bodied tests + targeted ledger probe)**:
- `scripts/nexus-bootstrap.ts:1349-1369` registers the default chat
  agent (actor `00000000-0000-4000-a000-000000000004`) with
  `allowedSystems: ['stub']` and capabilities
  `['read:record:single', 'search:data', 'synthesize:content']`.
- `scripts/seeds/user-ladder-seeds.ts:104-330` seeds every ladder
  persona with `allowedSystems` from a disjoint set:
  - `janitor`, `intern`: `[]`
  - `analyst`: `['sales-finance']`
  - `sr_analyst`, `manager`: `['sales-finance', 'warehouse']`
  - `sr_manager`..`ceo`: `['sales-finance', 'warehouse', 'gmail']`
- `scripts/nexus-bootstrap.ts:1221` shows `dev-admin` is the ONLY
  registered principal with `'stub'` in `allowedSystems`
  (`['stub', 'sales-finance', 'warehouse']`).
- E2E-01 (dev-admin → chat) passes; E2E-02..E2E-10 (every ladder
  persona → chat) fail with identical ledger:
  ```
  delegation_empty_intersection {
    dimension: 'target_systems',
    userValues: [...persona's seeded systems],
    agentValues: ['stub'],
    explicitValues: []
  }
  run_closed {
    closeReason: 'error',
    error: 'delegation_mint_failed: empty intersection on dimension target_systems'
  }
  ```

**Root cause**: HL#15 symmetric intersection on the `target_systems`
dimension demands a non-empty intersection between the
user.allowedSystems set and the agent.allowedSystems set. The default
chat agent declares `'stub'` (a placeholder system name reflecting
"chat touches no real system") but the ladder personas declare only
real connector systems. The intersection is empty for every
non-`dev-admin` principal.

**Resolution options (owner ratification required — NOT undertaken
this session per prompt §1 / §11)**:

1. **Re-declare the default chat agent's allowedSystems to `[]`**, and
   special-case the intersection law to treat empty-on-agent-side as
   "no system gate" (i.e., chat truly touches no system, so don't
   require an intersection). Smallest change; matches the semantic.
2. **Skip the `target_systems` intersection when the resolved planner
   tier is `'chat'`** (i.e., when workspace.entryMode === 'free_chat',
   no NXS dispatch is planned, so the system intersection is moot).
   Localizes the fix to `packages/orch-ref` rather than the law itself.
3. **Re-declare the chat agent with an allowedSystems superset that
   matches the ladder personas** (e.g., explicit list including all
   declared connector systems). Defensible only if the chat agent
   actually plans to read those systems via NXS; today it does not.
   Rejected as "fake widening" the chat agent's surface.

**EXPLICITLY REJECTED** (per prompt §1 no-widening rule): widening
each ladder persona's `allowedSystems` to include `'stub'` so the
intersection succeeds. That would pollute every persona's seed with a
chat-only sentinel — wrong direction.

**Wall-surfaced state**: The 9 failing tests are real bodies with
correct assertions; they will flip GREEN automatically the moment any
of options 1/2 lands. They will flip RED again if a future change
re-introduces the drift. The wall now verifies both directions.

### F-16 [SEED_DRIFT, CATALOG_DRIFT] — `update:record:bulk` capability has no seeded user × agent pair; E2E-29's "manager → bulk update" framing is unbuildable

**Severity**: medium. Affects E2E-29 directly and any future catalog
slot that names a `bulk write` against the seeded business agents.

**Evidence**:
- `scripts/seeds/user-ladder-seeds.ts:168-189`: `manager` persona's
  `allowedCapabilities` includes `update:record:single` but NOT
  `update:record:bulk` (first appears at `director`, line 235).
- `scripts/nexus-bootstrap.ts:1503-1530`: `warehouse-agent` declares
  `allowedCapabilities: [read:record:single, read:record:bulk,
  query:data, search:data, update:record:internal]` — bulk-update is
  not in the set.
- Even substituting `director` for the catalog's `manager` persona
  (the F-10 persona-deviation pattern from Pass 2), the HL#15
  intersection on the bulk-update capability dimension is empty
  because the agent itself does not declare it.

**Catalog row** (`docs/blueprints/AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md`,
search "E2E-29"): "manager → mark batch shipped" / "update-bulk-allowed-for-manager".

**Resolution options**:

1. Widen `warehouse-agent.allowedCapabilities` to include
   `update:record:bulk`, lift `manager` to include it too, and let
   E2E-29 body as written.
2. Amend the catalog row to use `update:record:internal` (the
   `single-record adjustment` that warehouse-agent ALREADY supports,
   matching `warehouse-agent.purpose: read + governed-write
   inventory adjustment`); document persona-deviation per F-10.

Either path is single-commit-sized. Owner ratification needed.

### F-17 [SEED_GAP, UNIMPLEMENTED_SURFACE] — multi-agent chat fan-out catalog names actors that don't exist

**Severity**: medium. Blocks 11 catalog slots
(`E2E-31..36, 38..40, 64, 68`) in Cluster 2 (multi-no-contract).
Transitively blocks deep-chain (E2E-64, multi-loop-deep) and
judge-driven branching (E2E-68).

**Evidence**:
- `tests/e2e/04-multi-no-contract.e2e.test.ts` catalog rows reference
  `analyst-bot`, `summary-bot`, `finance-bot`, `ops-bot`,
  `english-bot`, `french-bot`, `formal-bot`, `casual-bot`,
  `response-bot`, `judge-bot`, `fact1-bot`, `fact2-bot`, `en-fr`,
  `en-es` agents — none of these are seeded in
  `scripts/nexus-bootstrap.ts`.
- The bootstrap seeds only: `dev-admin` actor, `nexus-default-agent`
  (chat with `allowedSystems=['stub']`),
  `nexus-sales-agent`, `nexus-warehouse-agent` (NXS read agents
  scoped to single target systems).

**Compounding F-15**: even if the multi-agent fan-out agents were
seeded, they would need `allowedSystems` that intersect the ladder
personas' sets — NOT `'stub'` — to avoid the same intersection-empty
denial path as F-15.

**Resolution**: owner ratification to seed the catalog's named fan-out
agents. The smallest set that unblocks Cluster 2 would be a pair of
chat agents (e.g., `summary-bot` + `judge-bot`) seeded with
`allowedSystems` matching the catalog's expected personas. Or, if the
catalog rows are themselves aspirational, amend them to use the
existing seeded agents.

### F-18 [WALL_RATIONALE_REFRESH] — bridge-fix landing (43e5ed3) made the `NXS-DISPATCH-BRIDGE-RETURNS-NULL` blocker text stale on many slots

**Severity**: low (cosmetic but load-bearing for future repair-mode
prioritization).

**Evidence**: Pre-bridge-fix, the failure ledger grouped 24 tests
under `NXS-DISPATCH-BRIDGE-RETURNS-NULL`. After 43e5ed3 the bridge
synthesizes a denial-receipt instead of returning null; the actual
remaining blocker on most of those slots is now CHAT-AGENT-LADDER-
INTERSECTION-EMPTY (F-15), F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH
(merge), or APPROVAL-FLOW (E2E-102).

**Resolution (LANDED this session)**: Helper-function rationale in
`tests/e2e/04-multi-no-contract.e2e.test.ts`,
`tests/e2e/08-batch-summary.e2e.test.ts`,
`tests/e2e/09-multi-source-merge.e2e.test.ts` refreshed to point at
actual remaining blockers. E2E-29 individually replaced its
`nxsBlocked(...)` call with a sharper AcceptanceWallFailure. The wall
ledger now classifies these correctly.

## Wall numerics for next session entry

- Before session: 32 passed / 106 failed (138 total)
- After session: **35 passed / 103 failed (138 total)**
- Real-bodied tests at HEAD: 44 / 138 (32 pre-existing + 12 new)
  - 35 pass green
  - 9 fail RED with real assertion (the 9 F-15-blocked clones)
- Still `throw new AcceptanceWallFailure(...)` stubs: 94 / 138
- Top blockers (post this session):
  - `CHAT-AGENT-LADDER-INTERSECTION-EMPTY` (F-15) — blocks ~25 tests
  - `OUTPUT-CONTRACT-TEMPLATE-LIBRARY-V1` — blocks 15
  - `FRONTIER-LIVE-OR-FIXTURE-V1` — blocks 21
  - `GMAIL-CONNECTOR-V1` (Mailpit/Gmail) — blocks 10
  - `F4.12-COMPILE-MULTI-ITEM-PASSTHROUGH` — blocks ~8
  - `MULTI-AGENT-CHAT-FANOUT-AGENT-SEEDS` (F-17) — blocks 11
  - `ADMIN-REVOKE-ENDPOINT-V1` — blocks 2
  - `E2E-APPROVAL-FLOW-V1` cancel-half — blocks 2
  - `CHAT-AGENT-AND-WRITE-CAPABILITY-SEED-DRIFT` (F-16, E2E-29) — 1
  - Various RBAC differentials (no OCT-classified data, no prod-env
    tag, no SigningCouncil flow, etc.)
