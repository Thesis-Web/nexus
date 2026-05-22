# Nexus E2E Acceptance Wall — Failure Ledger 2026-05-22 (Test-Body Factory, audit-tightened)

Generated 2026-05-22T18:01:58Z. Third pass after the NEXUS TEST WALL AUDIT
PATCH MODE owner directive caught false-green tests in the second pass
that accepted "denial OR approval", "delegation_empty_intersection OR
plan_rejected", or generic plan_rejected when the catalog asks for a
specific gate event.

Source commands:

    pnpm typecheck       # clean
    pnpm gate:no-e2e-skip  # 0 matched
    pnpm test:e2e        # 138 tests / 38 pass / 100 fail / 0 placeholders

## Summary across the three passes

| metric | baseline (a725b52) | first pass (loose) | tightened (2nd) | **audit-tightened (HEAD)** |
| --- | --- | --- | --- | --- |
| total tests | 138 | 138 | 138 | **138** |
| passing | 19 | 103 | 46 | **38** |
| failing | 119 | 35 | 92 | **100** |
| placeholder slots | 119 | 0 | 0 | **0** |

The first pass over-counted by ~57 (loose `run_closed event present`).
The second pass tightened that to require `closeReason='completed' +
final_response` but still accepted "denial OR approval" / "intersection
OR plan_rejected" / generic plan_rejected for tests whose catalog row
calls for a specific surface. This third pass closes those loopholes.

## Audit-target tests newly failing (this pass)

All 10 of the audit directive's targets now appear in the failure list:

| # | Test | Was (loose) | Now requires |
| --- | --- | --- | --- |
| 1 | E2E-29 manager bulk update | accepted denial as success | EXECUTED (catalog says ALLOWED) |
| 2 | E2E-30 vp delete | "approval OR denial OR drift" | `gate_05_require_approval` |
| 3 | E2E-66 ambiguous next agent | "checkback OR plan_rejected" | `plan_checkback_required` only (HL#4 is callback, not kill) |
| 4 | E2E-80 OCT batch | intersection / plan_rejected accepted | `gate_02_oct_denied` / `oct_ceiling_exceeded` only |
| 5 | E2E-102 vp leg | "approval OR denial" | `gate_05_require_approval` |
| 6 | E2E-103 manager+ceo | generic capability denial | quorum-specific event (one of `quorum_required` / `signing_council_quorum_not_met` / `gate_05_quorum_required` / `signing_council_denied`) |
| 7 | E2E-105 janitor frontier | intersection / plan_rejected | `firewall_egress_denied` / `tier_ceiling_exceeded` / `firewall_transit_rights_denied` |
| 8 | E2E-106 analyst 10k pull | generic capability denial | `gate_02_risk_denied` / `risk_ceiling_exceeded` |
| 9 | E2E-107 chain depth | "chain_depth_exceeded OR plan_rejected OR checkback" | `chain_depth_exceeded` only |
| 10 | E2E-109 vp external action | "approval OR denial" | `gate_04_require_approval` |

These 8 net flips (E2E-105 and E2E-106 were already in the failure list
under the looser assertion; the new strict assertion makes their failure
mode honest rather than incidental) account for the 46→38 pass drop.

## Honest failure distribution

| count | dominant root cause | example failing assertion |
| --- | --- | --- |
| ~60 | F-15 chat-agent ladder intersection-empty cascade | `closes completed: expected 'error'` |
| 10 | Output-contract template library not built (TB-01) | `passThrough=false: expected undefined to be false` |
| 6 | Run never reached run_closed (timeout / dispatch hang) | `run closed: expected false to be true` |
| 5 | Gmail connector absent (gmail run never closes) | `gmail run closes completed: expected null` |
| 8 | Audit-tightened gate-specific assertions newly enforced | various `<gate>_required` / `<oct/risk/quorum/firewall>_*_*` `expected to contain` |
| 2 | HL#14 claim_drift_detected emit absent | `expected … to include 'claim_drift_detected'` |
| 1 | NVG firewall_egress_denied emit absent (E2E-99) | `analyst OCT-CONFIDENTIAL outbound must surface a denial` |
| 1 | sr_analyst×warehouse intersection narrowing (E2E-104) | `sr_analyst cross-system warehouse read must reach EXECUTED` |
| 1 | OCT-SECRET resource not seeded (E2E-101) | `vp SECRET read must reach EXECUTED` |
| 1 | env-tagged connectors not seeded (E2E-108) | `env-mismatch request must surface a denial event` |

## E2E-40 — F4.12 multi-item compile correction

E2E-40 (`multi-no-contract-bundle-shape: executive → bundle
FinalResponseArtifact carries both items`) asserts
`compile_assembly_complete.itemCount === 2` and **passes** at HEAD
4fb0dc8 → b66f0c1. The earlier REPAIR-MODE-FINDINGS doc claim that
E2E-40 exposed TB-04 (F4.12 multi-item compile gap) was wrong; the
simple 2-NXS-leg bundle shape assembles both items correctly. The
finding has been re-classified in
`REPAIR-MODE-FINDINGS-2026-05-22-test-body-factory.md` to "PARTIAL
EVIDENCE OF GREEN" — multi-item is proven for the simple case; the
nvg-mixed compile path remains UNKNOWN because the upstream legs fail
on F-15 before reaching compile.

## Notable passes (38 honest greens)

- 00-phase-0 spine (11 tests)
- 00b-persona-RBAC-seeds (6 tests)
- 01-chat-onprem E2E-01 (1 test, dev-admin only)
- 03-nxs-single E2E-21..28 (8 tests — single-agent NXS reads + analyst-delete-denied)
- 04-multi-no-contract E2E-37 + E2E-40 (2 tests — strict NXS-pair assertions)
- 12-hard-law E2E-111, E2E-113..117, E2E-119, E2E-120 (8 tests — HL#1/5/6/7/8/11/15/16)
- Plus genuine denial proofs: E2E-28 (HL#5 delete denied), E2E-101 janitor leg (SECRET denied), E2E-104 intern leg, E2E-119 (HL#15)

## Next mode

PRODUCT REPAIR MODE using this ledger. Top repair targets unchanged:

1. **F-15 chat-agent ladder intersection** — closes ~60 tests
2. **Output-contract template library + route plumbing (TB-01, TB-02)** — closes 10
3. **Specific gate emitters for the 10 audit-target tests** —
   `plan_checkback_required` for HL#4 (TB-06), `gate_02_oct_denied`,
   `gate_02_risk_denied`, `chain_depth_exceeded`, `quorum_required`,
   `firewall_egress_denied`, `gate_04_require_approval`,
   `gate_05_require_approval`, `claim_drift_detected` (TB-07), plus
   catalog amendment or seed widening for E2E-29 if the "manager bulk
   update is ALLOWED" framing is to stand.
