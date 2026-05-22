# Model-Dispatch Repair Trace — 2026-05-22

Branch: `feat/beta1-admin-dashboard`
Entry HEAD: `f5729d7` (F-15 delegation-mint NXS intersection scope fix)
Wall before: 47 pass / 91 fail / 138 total

## Entry verification

- F-15 verified green on **E2E-01-chat-onprem**: 10/10 pass. The
  assertion is weak (`closeReason !== 'error'`), and the underlying
  run still produces `closeReason: null` from a `compile_skipped`
  branch — but the test passes because `null !== 'error'`. F-15 closed
  the explicit `closeReason='error'` cluster; the next-downstream
  symptom is the path that lands `closeReason: null` from a
  `compile_skipped` branch.
- E2E-02 (10/10), E2E-04 (8/10), E2E-06 (10/10) red on the strict
  `closeReason === 'completed'` assertion.

## Probe — what the run-ledger actually emits (scripts/probe-model-dispatch.ts)

E2E-02 frontier (single chat, preferredEndpointId='openai-gpt'):
```
run_opened → planner_plan_trace → plan_created → plan_checkback_sent →
plan_confirmed → orchestrator_dispatched → mailbox_allocated →
delegation_issued → node_dispatched →
node_failed { failureReason:
  "nvg_unknown_provenance_payload: empty labels with untrusted
   provenance unknown — gate quarantines per F4.11 §3.3 ..." } →
dag_failed { reason: "no_compile_eligible_nodes" } →
compile_skipped { reason: "no_eligible_results" } →
final_response { outcome: "no_eligible_results", payload: null } →
run_closed { reason: "compile_skipped" }   ← reason:, NOT closeReason:
```

E2E-04 multi-leg chat-fan-out (two `kind:nvg` legs, same chat agent):
```
... → 2× node_failed with the SAME
   "nvg_unknown_provenance_payload: empty labels with untrusted
    provenance unknown ..." → dag_failed → compile_skipped →
final_response { outcome: "no_eligible_results", payload: null } →
run_closed { reason: "compile_skipped" }
```

The harness reads `detail['closeReason']` (`tests/e2e/harness.ts:312`)
and the run_closed event carries `reason:`, so `closeReason → null`.

## Pinned runtime path

| Step | File | Function |
|------|------|----------|
| Entry test | `tests/e2e/02-chat-frontier.e2e.test.ts:43-62` | `assertFrontierEnvelope` |
| Harness POST | `tests/e2e/harness.ts:280` | `createRun` → `/workspace/runs` |
| Workspace route | `packages/interfaces/api/src/routes/workspace.ts` | run creation handler |
| Run creation | `packages/orch-ref/src/run-coordinator.ts:159` | `RefRunCoordinator.handleRun` |
| Plan / subTask | `packages/orch-ref/src/run-coordinator.ts:258-403` | plan validate + delegation issue |
| DAG executor | `packages/orch-ref/src/dag-executor.ts` | `execute()` invokes dispatchNode |
| Node dispatch | `scripts/nexus-main.ts:947-1540` | `makeDispatchToGovernance` closure |
| NVG outbound build | `scripts/nexus-main.ts:1268-1291` | `aggregatedLabels` + `aggregatedProvenance` |
| Provenance aggregator | `packages/runtime-utils/src/payload-labels.ts:70-82` | `resolveAggregatedProvenance` |
| NVG service | `packages/vanguard/src/nvg-service.ts:230-342` | `classifyAndRoute` empty-labels §3.3 case split |
| Endpoint select | (unreached) | `packages/vanguard/src/router/model-router.ts` |
| Invocation | (unreached) | `packages/vanguard/src/transport/registry.ts` |
| NVG inbound | (unreached) | `packages/vanguard/src/inbound/response-normalizer.ts` |
| Compile | (unreached for failing paths) | `scripts/nexus-main.ts:1766 triggerCompile` |
| Compile-return | (unreached) | `packages/interfaces/api/src/routes/compile-return.ts` |
| Run close | `packages/orch-ref/src/run-coordinator.ts:565-582` | `compile_skipped` branch — emits `reason:` not `closeReason:` |

## Observed failure point

`scripts/nexus-main.ts:1272`:

```ts
const aggregatedProvenance = resolveAggregatedProvenance(upstreamMailboxItems);
```

When a `kind:nvg` node has no `inputSlotReads` (the entire chat path,
single-leg or multi-leg, and the first leg of any DAG), the orch
constructs the `NvgOutboundRequest` with **no contribution from the
user prompt itself**. The aggregator therefore returns `'unknown'`
(`packages/runtime-utils/src/payload-labels.ts:73`). NVG's §3.3 empty-
labels case split (`packages/vanguard/src/nvg-service.ts:273-340`)
sees `validLabels.length===0`, `boundConnectorClasses.length===0`,
and an untrusted provenance — and denies with
`NVG_UNKNOWN_PROVENANCE_PAYLOAD`.

The user prompt arrives via `/workspace/runs` (a workspace surface).
Its provenance is `'workspace_upload'` (trusted per §3.3 — see
`packages/runtime-utils/src/payload-labels.ts:146-150` and
`packages/vanguard/src/nvg-classify-and-route.test.ts:582-596` /
`NPL-05`). Orch never contributes this provenance into the
aggregation, so every chat-style dispatch with no upstream items is
denied.

## Classification (Phase 2)

**J — orchestrator NVG dispatch construction omits the
`workspace_upload` provenance contribution for the user prompt**.

- Not A: the node IS dispatched (`node_dispatched` fires).
- Not B–H in the canonical sense; the dispatch reaches NVG and NVG
  denies *before* endpoint selection.
- Not I: harness behavior is correct; it reads `detail['closeReason']`
  which is absent on the `compile_skipped` branch's `run_closed`.
  (That field-name inconsistency is a real bug too, but fixing it
  would only change `null` → `'compile_skipped'` and the catalog
  still expects `'completed'`. The root cause is the upstream
  NVG denial that prevents the model-bound path from running.)

Confidence: ≥95% from direct ledger evidence + code reading.

## Smallest production patch (Phase 3 plan)

1. `packages/runtime-utils/src/payload-labels.ts`:
   `resolveAggregatedProvenance` accepts an optional
   `additionalSources: ReadonlyArray<ProvenanceSource>` so a caller
   can contribute non-mailbox provenance signals into the weakest-
   link aggregation. Behavior preserved when the argument is absent
   (empty list still returns `'unknown'`). Unit test added.

2. `scripts/nexus-main.ts:1272`: orch passes
   `['workspace_upload']` as `additionalSources` — the user prompt
   that the orch reads from `request.prompt` / `node.taskPrompt`
   originates from a workspace POST and is therefore a workspace
   upload by definition. With upstream items present the aggregator
   still picks the WEAKEST of `[workspace_upload, ...upstreams]`, so
   downstream legs reading `agent_output` items still resolve to
   `agent_output` and the upstream-labels case split runs unchanged.

This patch repairs the model-bound path it touches:
- Chat with no upstream → workspace_upload (trusted) → empty-labels
  case split floors classification to `'internal'` → routing rule
  `nvg-rule-02-internal-onprem` → on_prem_general → real configured
  ollama endpoint → invocation → NVG inbound logs/normalizes → orch
  receives result → mailbox write → compile path runs → final_response
  → run_closed `closeReason='completed'`.
- Multi-leg with upstream → behavior unchanged (workspace_upload
  loses to agent_output in trust ranking; the upstream labels keep
  the §3.3 case split from firing).
- Frontier-preferred prompts with no upstream items still floor to
  `'internal'` and route to on-prem per policy (`internal` is not
  routed to frontier under the default policy). That is the
  catalog-asserted behavior — the catalog says the run must close
  with `'completed'`, not that frontier must be invoked.

## Out of scope for this mode (explicitly NOT touched)

- F-15-style intersection logic (already landed).
- Output-contract template library.
- Gmail / Mailpit connectors.
- Approval Gate 04/05.
- Callback / checkback.
- SigningCouncil.
- RBAC / OCT seeds.
- E2E-29 catalog mismatch.
- Chain-depth.
- Risk/OCT denial emitters.
- Lexicon / WordNet / DAG lexical layer.
- Admin dashboard.
- REST Adapter v2.
- Webhook Channel v2.
- Frontier deterministic fixture architecture.
- The separate truthfulness bug where `run-coordinator.ts` writes
  `run_closed { reason: ... }` instead of `closeReason: ...` on the
  `compile_skipped` / `executor_error` / `run_cancelled` branches.
  Renaming the field would NOT make the failing tests pass (the
  value would be `'compile_skipped'`, not `'completed'`). The
  catalog wants `'completed'`, which only the real compile path
  produces.
