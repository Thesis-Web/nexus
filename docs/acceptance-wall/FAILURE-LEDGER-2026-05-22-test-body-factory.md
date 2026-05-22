# Nexus E2E Acceptance Wall — Failure Ledger 2026-05-22 (Test-Body Factory)

Generated: 2026-05-22 (post test-body factory commit 20041a3, on top of
the body work from commits ea600a0 / c6980e0 / 43e5ed3).

Source command:

    pnpm typecheck     # clean
    pnpm gate:no-e2e-skip   # 0 matched
    pnpm test:e2e      # 138 tests, 103 passed, 35 failed

Baseline at session entry (a725b52, baseline ledger from 2026-05-21):

    138 tests, 19 passed, 119 failed.

Test-Body Factory delta: **+84 net passes**. Every remaining failure
below is honest production red, not a missing test body.

## Summary

| metric | baseline (a725b52) | post body-build (8db2f4d) | this run (HEAD) |
| --- | --- | --- | --- |
| total tests | 138 | 138 | 138 |
| passing | 19 | 36 | **103** |
| failing | 119 | 102 | **35** |
| placeholder slots (AcceptanceWallFailure throws) | 119 | 102 | **0** |

## Failure breakdown by root cause

| # | Root cause | Tests | Class |
| --- | --- | --- | --- |
| 1 | Chat-agent ladder intersection empty (F-15) | 9 (E2E-02..10) | PRODUCT_RUNTIME |
| 2 | Output-contract template library not built (TB-01, TB-02) | 12 (E2E-41..50, E2E-56, E2E-65, E2E-70, E2E-76, E2E-90) | UNIMPLEMENTED_SURFACE |
| 3 | NVG/orch path on non-trivial DAG closes before run_closed event captured (run-coordinator timing or `error_dispatch` cascade) | 7 (E2E-61, E2E-62, E2E-64, E2E-65, E2E-67, E2E-70) | PRODUCT_RUNTIME |
| 4 | HL#12 checkbackSourceRunId provenance event not emitted | 1 (E2E-69) | UNIMPLEMENTED_SURFACE |
| 5 | HL#4 planner-decomposition checkback emitter absent | 3 (E2E-79, E2E-112, E2E-59) | UNIMPLEMENTED_SURFACE |
| 6 | Gate 04/05 approval surface not exercised | 2 (E2E-102 vp leg, E2E-109) | UNIMPLEMENTED_SURFACE |
| 7 | NVG firewall_egress_denied / OCT-CONFIDENTIAL outbound emitter absent | 1 (E2E-99) | UNIMPLEMENTED_SURFACE |

## Class totals

| class | count |
| --- | --- |
| PRODUCT_RUNTIME | 16 |
| UNIMPLEMENTED_SURFACE | 19 |
| EXTERNAL_DEPENDENCY | 0 |
| CONNECTOR_MISSING | 0 (all gmail bodies pass-by-denial as expected) |
| HARNESS_GAP | 0 |
| CATALOG_DRIFT | 0 |
| UNCLASSIFIED | 0 |

(The reporter emits every row as `UNCLASSIFIED` because the new bodies
do not throw `AcceptanceWallFailure` — they fail with native
`AssertionError`. The classification above is from manual triage and
is also captured per-test in `REPAIR-MODE-FINDINGS-2026-05-22-test-body-factory.md`.)

## Failing tests (full list)

| # | Test | File | Failure |
| --- | --- | --- | --- |
| 1 | E2E-02-chat-time | 01-chat-onprem | closeReason='error' (F-15 cascade) |
| 2 | E2E-03-chat-math | 01-chat-onprem | closeReason='error' |
| 3 | E2E-04-chat-summarize | 01-chat-onprem | closeReason='error' |
| 4 | E2E-05-chat-translate | 01-chat-onprem | closeReason='error' |
| 5 | E2E-06-chat-poem | 01-chat-onprem | closeReason='error' |
| 6 | E2E-07-chat-explain | 01-chat-onprem | closeReason='error' |
| 7 | E2E-08-chat-list | 01-chat-onprem | closeReason='error' |
| 8 | E2E-09-chat-define | 01-chat-onprem | closeReason='error' |
| 9 | E2E-10-chat-followup | 01-chat-onprem | closeReason='error' |
| 10 | E2E-41-table-monthly-sales | 05-multi-with-contract | passThrough=undefined |
| 11 | E2E-42-prose-quarterly-review | 05-multi-with-contract | passThrough=undefined |
| 12 | E2E-43-mixed-prose-table | 05-multi-with-contract | passThrough=undefined |
| 13 | E2E-44-file-bundle | 05-multi-with-contract | passThrough=undefined |
| 14 | E2E-45-guarded-confidential | 05-multi-with-contract | passThrough=undefined |
| 15 | E2E-46-judge-decision-table | 05-multi-with-contract | passThrough=undefined |
| 16 | E2E-47-multi-source-merge | 05-multi-with-contract | passThrough=undefined |
| 17 | E2E-48-citation-formatted | 05-multi-with-contract | passThrough=undefined |
| 18 | E2E-49-email-draft | 05-multi-with-contract | passThrough=undefined |
| 19 | E2E-50-financial-summary-template | 05-multi-with-contract | passThrough=undefined |
| 20 | E2E-56-mixed-with-output-contract | 06-mixed-tier | compile_assembly_complete missing |
| 21 | E2E-59-mixed-fallback | 06-mixed-tier | unhealthy endpoint dropped silently |
| 22 | E2E-61-frontier-then-fan-out | 07-branching | run_closed event missing |
| 23 | E2E-62-research-then-merge | 07-branching | run_closed event missing |
| 24 | E2E-64-multi-loop-deep | 07-branching | run_closed event missing |
| 25 | E2E-65-branching-with-output | 07-branching | run_closed event missing |
| 26 | E2E-67-branching-with-secure-rail | 07-branching | run_closed event missing |
| 27 | E2E-69-second-run-trigger | 07-branching | HL#12 chain provenance not recorded |
| 28 | E2E-70-branching-with-output-contract-and-mixed-tier | 07-branching | run_closed event missing |
| 29 | E2E-76-batch-with-output-contract | 08-batch-summary | compile_assembly_complete missing |
| 30 | E2E-79-batch-with-callback | 08-batch-summary | oversize batch silent |
| 31 | E2E-90-cross-system-audit | 09-multi-source-merge | compile_assembly_complete missing |
| 32 | E2E-99-gmail-compose-secure-data-denied | 10-gmail | denial event not emitted |
| 33 | E2E-102-bulk-delete | 11-rbac-differentials | vp approval surface absent |
| 34 | E2E-109-external-facing-action | 11-rbac-differentials | approval surface absent |
| 35 | E2E-112-hl4-orch-no-kill | 12-hard-law-surfaces | planner-decomposition callback missing |

See `runs/acceptance-wall-2026-05-21/FAILURE-LEDGER.jsonl` and the
companion `.md` for the raw reporter output (overwritten on every wall
run; this dated file is the immutable snapshot).

## Notable passes (proving the wall works)

- All 12-hard-law-surfaces tests except E2E-112 pass — HL#1/#5/#6/#7/#8/#11/#15/#16 surfaces are honest green.
- E2E-37 manager 2x parallel NXS pull executes both legs (commit c6980e0 stuck).
- E2E-116 multi-actor mailbox isolation continues to pass post-bodies.
- E2E-117 HL#11 compile pass-through digest match holds.
- All E2E-21..30 NXS single-agent tests pass.
- The 9-multi-source-merge denials all surface honestly without bridge null or unsolicited tool calls.

## Next mode

PRODUCT REPAIR MODE using this ledger. The top three repair targets:
1. **F-15 chat-agent ladder intersection** — closes E2E-02..10 + opens
   E2E-31..40 / E2E-51..58 / E2E-71..75 mixed-chat paths.
2. **Output-contract template library + workspace route plumbing
   (TB-01, TB-02)** — closes E2E-41..50 + adjacent contract tests.
3. **HL#4 planner-decomposition checkback emitter (TB-06)** — closes
   E2E-79, E2E-112, E2E-59 + arms the HL#4 surface broadly.
