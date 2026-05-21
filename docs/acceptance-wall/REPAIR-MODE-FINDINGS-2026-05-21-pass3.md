# Repair-mode out-of-scope findings — 2026-05-21 (Pass 3)

Pass-3 repair session, two patches:

- E2E-116 hardened from cheap admin-auth/name-shape proof into real
  multi-actor mailbox isolation proof (commit `f6ce8b8`).
- E2E-26 promoted to a positive success-path envelope (sr_manager
  literal Q1 bulk export against sales-finance, truthful seed
  rowCount=0). Staged for owner approval.

Wall after both: 32 passed / 106 failed (was 31 / 107 at HEAD ec29e03).

## In-scope notes (LANDED or STAGED in this pass)

- **E2E-116 rewrite (LANDED, commit `f6ce8b8`)**: one workspace run,
  two agents, disjoint target systems. Two distinct
  `mailbox_allocated` events. On-disk `mailbox-items.jsonl` confirms
  per-actor isolation: every item in the sales mailbox carries
  `agentId=sales`, `provenance=nxs_connector_result`,
  `sourceType=nxs_execution_result`; every item in the warehouse
  mailbox carries `agentId=warehouse`; the mailboxId sets are
  disjoint; no cross-actor leak. HTTP `/mailbox/*` admin-auth 401
  retained as a secondary §K control-plane boundary check only, not
  the primary proof.
- **E2E-26 promotion (STAGED)**: sr_manager Q1 bulk export, rowCount=0
  is the truthful seed answer. The gate envelope (Gate 01-07, mailbox
  data-kind item, compile pass-through, final_response, run_closed)
  fires end-to-end on the zero-row result. Proves only the positive
  ceiling for E2E-26's catalog row; the lower-role denial differential
  is NOT proven by this test (it belongs to E2E-106, currently
  honest-red, and is itself blocked by F-14 below).

## Out-of-scope findings

### F-14 [CATALOG_DRIFT, risk classification] — bulk reads on sales-finance not classified as high-risk; lower-role denial differential cannot be exercised as catalog asks

**Severity**: medium. Affects two catalog slots directly (E2E-26
positive envelope, E2E-106 differential) and any future slot pinned
to the catalog's "(bulk → high risk)" framing.

**Evidence**:
- `docs/blueprints/AMEND-nexus-workspace-e2e-smoke-tests-v0-4-0.md`
  line 123 catalog row E2E-26 frames the action as "(bulk → high
  risk)" and the acceptance as "Gate 02 risk OK for sr_manager,
  denied at lower role".
- Same blueprint line 251 catalog row E2E-106 states "Gate 02 denies
  (riskCeiling: medium < bulk:high)" for analyst pulling 10000 rows
  from sales.
- Implemented runtime (verified by E2E-21 passing): `sr_analyst` with
  `maxRiskTier='medium'` successfully runs `read:record:bulk` against
  sales-finance through the full Gate 01-07 chain. By HL#15 symmetric
  intersection, if the action resolved to risk='high' the user's
  ceiling=medium would block it. The action therefore resolves to risk
  ≤ medium under current policy/risk classification.
- `config/connectors/connectors.v1.yaml` declares
  `postgres-sales-finance.maxRows: 500` — the connector caps results
  at 500 rows regardless of query intent. E2E-106's "pull 10000 rows"
  cannot occur at the connector boundary even if the SQL asked for it.
- `scripts/seeds/user-ladder-seeds.ts:138-145` shows the `analyst`
  persona's `allowedCapabilities` are `[search:public, summarize,
  read:record:single, query:data]` — NO `read:record:bulk`. Even if
  the runtime classified bulk-on-sales as high-risk, an analyst-issued
  bulk read would deny at Gate 03 CAPABILITY before Gate 02 RISK ever
  evaluated. The catalog's claim that Gate 02 RISK is the denial gate
  does not match the implemented ladder either way.

**Impact**:
- E2E-26 (currently staged) proves only the positive sr_manager
  success envelope. The catalog row's "denied at lower role" cannot
  be proven by E2E-26 — and the dedicated differential slot E2E-106
  cannot be promoted under current runtime because the risk
  classifier, connector row cap, and ladder capabilities are all
  inconsistent with the catalog's framing.
- The wall therefore does not currently prove any "bulk → high risk"
  classification anywhere. Any test that depends on that framing is
  unbuildable until this drift is resolved.

**Why this is logged, not fixed in-session**:
Resolution requires owner ratification of which side moves:

  (a) **Production fix — scope-aware risk classifier.** Add a
      classifier so bulk reads against sales-finance get tagged
      `risk='high'` for full-table or large-result-set scopes; small
      narrowed bulk reads stay at medium. The existing `maxRows: 500`
      cap could inform a threshold (e.g. any bulk read returning > N
      rows or projecting more than M columns is classified high), or
      the planner-derived "export" intent could be a tag. Then add a
      bulk capability to a persona at the right ceiling level so the
      denial differential E2E-106 can actually fire at Gate 02 RISK.

  (b) **Specification fix — amend the catalog.** Rule that bulk reads
      on sales-finance are categorically medium-risk; revise E2E-26's
      "(bulk → high risk)" framing and revise E2E-106's denial-gate
      from Gate 02 RISK to Gate 03 CAPABILITY. Choose a persona for
      E2E-106 that has the right ceiling/capability combination to
      land in the desired denial gate.

  (c) **Third option.** Some hybrid — e.g. introduce a "data-export"
      capability separate from `read:record:bulk` that tiers up
      automatically; classify exports as high-risk; assign the
      capability only to sr_manager+ on the ladder.

Each path is feasible. None is in repair-mode scope (each touches
policy/risk-classifier code or amends the spec). Build queue should
pick this up after owner ruling.

**Owner ruling needed.** Until ruled, the lower-role denial
differential is NOT PROVEN anywhere in the wall, and E2E-26's
positive envelope is the only side of the catalog row that can hold.
