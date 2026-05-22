# Nexus E2E Acceptance Wall — Failure Ledger 2026-05-22 (Test-Body Factory, tightened)

Generated 2026-05-22T17:40:38Z. Tightened-assertion re-run after owner
feedback that the first pass was over-counting passes by accepting
`run_closed event present` instead of requiring `closeReason='completed'
+ final_response event present`.

Source commands:

    pnpm typecheck       # clean
    pnpm gate:no-e2e-skip  # 0 matched
    pnpm test:e2e        # 138 tests / 46 pass / 92 fail / 0 placeholders

## Summary

| metric | baseline (a725b52) | first pass (loose assertions) | tightened (HEAD) |
| --- | --- | --- | --- |
| total tests | 138 | 138 | **138** |
| passing | 19 | 103 | **46** |
| failing | 119 | 35 | **92** |
| placeholder slots | 119 | 0 | **0** |

The first-pass count (103/35) was inflated. The loose envelope helpers
in batches 3-8 only checked `run_closed event present` + `no bridge
null`, so any run that closed with `closeReason='error'` or
`plan_rejected` silently counted as a pass. The tightened helpers now
require `closeReason='completed' + final_response event present + no
node_failed + no dag_failed + no error_dispatch`, which is the
production-shape success the catalog actually asks for.

## Honest failure distribution

Grouped by first-failing assertion message (from
`runs/acceptance-wall-2026-05-21/FAILURE-LEDGER.jsonl`):

| count | failing assertion | dominant root cause |
| --- | --- | --- |
| 10 | `multi-source merge closes completed: expected 'error'` | F-15 chat-agent intersection (merge nvg node) |
| 10 | `mixed-tier run closes completed: expected 'error'` | F-15 chat-agent intersection (kind=nvg nodes) |
| 10 | `frontier chat closes completed: expected 'error'` | F-15 chat-agent intersection (frontier preferred) |
| 9 | `expected 'error' not to be 'error'` (E2E-02..10) | F-15 chat-agent intersection via `nexus-chat-default` |
| 9 | `batch + summary closes completed: expected 'error'` | F-15 chat-agent intersection (summarize nvg node) |
| 10 | `passThrough=false: expected undefined to be false` (E2E-41..50) | Output-contract template library not built (TB-01) |
| 8 | `multi-leg run closes completed: expected 'error'` | F-15 chat-agent intersection (chat fan-out) |
| 6 | `run closed: expected false to be true` | Run never reached run_closed (timeout / dispatch hang) |
| 5 | `gmail run closes completed: expected null` | Run never closed (no gmail connector path) |
| 3 | `branching DAG closes completed: expected 'error'` | F-15 chat-agent intersection (branching nvg nodes) |
| 2 | `gmail run closes completed: expected 'error'` | Gmail send attempted through chat path; closes error |
| 2 | `HL#14 — claim_drift_detected must fire on mid-run revoke` | Admin revoke endpoint absent → no drift emit (TB-07) |
| 1 | `vp external-action must surface approval or denial` | Gate 04 approval surface not exercised through HTTP |
| 1 | `vp bulk delete must surface approval or denial` | Gate 05 approval surface not exercised through HTTP |
| 1 | `vp SECRET read must reach EXECUTED on a seeded resource` | No OCT-SECRET-tagged resource seeded |
| 1 | `sr_analyst cross-system warehouse read must reach EXECUTED` | sr_analyst→warehouse intersection narrowing |
| 1 | `analyst OCT-CONFIDENTIAL outbound must surface a denial` | NVG firewall_egress_denied emitter absent |
| 1 | `env-mismatch request must surface a denial event` | No env-tagged connector to deny against |
| 1 | `HL#4 — planner must surface a callback or rejection` | Planner-decomposition checkback emitter absent (TB-06) |
| 1 | `vp bulk delete must surface approval or denial` (dup label) | — |

## Root-cause concentration

- **~60 tests** fail because the F-15 chat-agent ladder intersection
  empty cascades across every workspace that uses chat-style nvg
  nodes. Resolving F-15 should unblock the dominant slice.
- **10 tests** fail purely on the output-contract template library
  gap (TB-01).
- **~12 tests** fail on specific denial/approval/drift emitter gaps
  (TB-06, TB-07, TB-10, etc.).

## Class totals (manual triage)

| class | count |
| --- | --- |
| PRODUCT_RUNTIME (F-15 cascade + dispatch hangs) | ~60 |
| UNIMPLEMENTED_SURFACE (template lib, approval surface, drift emitter) | ~30 |
| CONNECTOR_MISSING (Gmail) | ~7 (subset of the F-15 cascade) |
| EXTERNAL_DEPENDENCY | 0 |
| HARNESS_GAP | 0 |
| CATALOG_DRIFT | 0 |

(The reporter labels everything UNCLASSIFIED because new bodies use
native `AssertionError` instead of `AcceptanceWallFailure`; manual
triage classification is the table above and the per-finding
breakdown in `REPAIR-MODE-FINDINGS-2026-05-22-test-body-factory.md`.)

## Notable passes (46 honest greens)

- 00-phase-0 spine (11 tests) — server lifecycle, auth, admin write.
- 00b-persona-RBAC-seeds (6 tests) — seed shape proof.
- 01-chat-onprem E2E-01 (1 test) — dev-admin chat baseline.
- 03-nxs-single E2E-21..28 (8 tests) — NXS single-agent reads + the
  delete-denied differential.
- 04-multi-no-contract E2E-37 + E2E-40 (2 tests) — the two slots with
  strict NXS-pair assertions.
- 12-hard-law E2E-111, E2E-113..117, E2E-119, E2E-120 (8 tests) —
  HL#1, HL#5, HL#6, HL#7, HL#8, HL#11, HL#15, HL#16 surfaces all
  honestly green.
- Plus the explicit-denial RBAC differentials (E2E-101 janitor leg,
  E2E-103 manager + ceo legs, E2E-104 intern leg, E2E-105 janitor
  frontier, E2E-106 analyst bulk pull, E2E-107 chain depth) — denials
  fire deterministically.

## Next mode

PRODUCT REPAIR MODE using this ledger. Top three repair targets,
ranked by failure count unblocked:

1. **F-15 chat-agent ladder intersection empty** — closes ~60 tests
   in one stroke. Owner ratification options open in F-15 logs.
2. **Output-contract template library + workspace-route plumbing
   (TB-01, TB-02)** — closes 10 tests in E2E-41..50 + a handful of
   contract assertions in adjacent files.
3. **HL#4 planner-decomposition checkback emitter (TB-06)** — closes
   E2E-79, E2E-112, E2E-59 and arms the HL#4 surface across the wall.

After repair mode lands these three, the wall should swing from
46/92 to roughly 105/33 passing. The remaining ~33 will be the
specific denial-emitter / approval-flow / admin-endpoint gaps
(TB-05..TB-12) that need targeted patches.
