# Acceptance Wall — Test-Body Build Plan 2026-05-22

Per the 2026-05-22 Test-Body Factory prompt. Goal: replace every remaining
`AcceptanceWallFailure`-placeholder in `tests/e2e/*.e2e.test.ts` with a
real, runnable body that exercises the production surface. Red is
expected; the deliverable is wall completeness, not green.

## Inventory (grep at HEAD 5acd4e1)

| File | Placeholder count |
|---|---|
| `tests/e2e/02-chat-frontier.e2e.test.ts` | 10 (E2E-11..20) |
| `tests/e2e/03-nxs-single.e2e.test.ts` | 2 (E2E-29, E2E-30) |
| `tests/e2e/04-multi-no-contract.e2e.test.ts` | 9 (E2E-31..36, 38, 39, 40) |
| `tests/e2e/05-multi-with-contract.e2e.test.ts` | 10 (E2E-41..50) |
| `tests/e2e/06-mixed-tier.e2e.test.ts` | 10 (E2E-51..60) |
| `tests/e2e/07-branching.e2e.test.ts` | 10 (E2E-61..70) |
| `tests/e2e/08-batch-summary.e2e.test.ts` | 10 (E2E-71..80) |
| `tests/e2e/09-multi-source-merge.e2e.test.ts` | 10 (E2E-81..90) |
| `tests/e2e/10-gmail.e2e.test.ts` | 10 (E2E-91..100) |
| `tests/e2e/11-rbac-differentials.e2e.test.ts` | 10 (E2E-101..110) |
| `tests/e2e/12-hard-law-surfaces.e2e.test.ts` | 2 (E2E-112, E2E-118) |
| **Total** | **93** |

## Batch order

| Batch | File | Strategy |
|---|---|---|
| 1 | 02-chat-frontier | preferredEndpointId='openai-gpt' (frontier tier) + chat through `nexus-chat-default` |
| 2 | 03-nxs-single E2E-29/30 | Real NXS subTasks DAG with seeded agents; let capability/approval gap surface |
| 3 | 04-multi-no-contract | 2-node `kind:nvg` DAG via `reference-workspace` using default chat agent |
| 4 | 05-multi-with-contract | Same shape as Batch 3 + invented `outputContractTemplateId` |
| 5 | 06-mixed-tier | 2-node DAG: one node with preferredEndpointId frontier, one on-prem |
| 6 | 07-branching | 3-4 node DAG with fan-out edges through `reference-workspace` |
| 7 | 08-batch-summary | NXS bulk pull + nvg summarize node DAG |
| 8 | 09-multi-source-merge | Two parallel NXS pulls (sales + warehouse) + nvg merge node |
| 9 | 10-gmail | Real attempts at email connector dispatch through reference-workspace + assert run-closed shape |
| 10 | 11-rbac-differentials | Lower-role denial leg as primary assertion; second leg where harness allows |
| 11 | 12-hard-law E2E-112/118 | Trigger model-tier checkback via unhealthy preferredEndpointId; revoke leg via best-effort admin route |

## Expected first failures

Most bodies will land as `body_written_failing_product`. The point: each
slot fails with the actual error shape (delegation_empty_intersection,
404 on missing route, missing template, tier_ceiling_exceeded, etc.) so
the failure ledger can drive Repair Mode.

## Status (final)

To be updated after the wall runs.
