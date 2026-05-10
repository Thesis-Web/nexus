# Status — Multi-Node Planner

**Last updated:** 2026-05-10
**Branch:** `feat/beta1-admin-dashboard`
**Phase:** 1 of 2

## Phase 1 — Complete

The orchestrator now supports structured multi-node DAG plans alongside the
legacy single-prompt path. Sub-task kinds (`nvg` / `nxs` / `secure_handoff`)
drive distinct dispatch paths so the orchestrator only invokes NVG for nodes
that actually need a model. End-to-end demo flow runs through curl / API; UI
surfaces are partially landed (see "UI status" below).

### Shipped

- `SubTaskDecl` discriminated union, `SlotReadRef`, `NxsActionTemplate`,
  `SubTaskEdgeHint` — contract additions on `WorkspaceRunRequest` +
  `NormalPlannerRequest` / `MetadataPlannerRequest` + `PlanNode`
  (commit 4f109b2).
- `RefDeterministicPlanner.planFromSubTasks` — emits N nodes with
  kind-driven `nodeType`, edges keyed by `subTaskKey`, same-agent
  multi-step legal. Validates duplicate keys, dangling slot reads,
  dangling edge refs, cycles, sub-task count vs `maxSplitDepth`
  (commit c22a9b7).
- `nodeType` branching in dispatch — `nvg_dispatch` / `nxs_dispatch` /
  `secure_agent_handoff` each take their own path. `nxs_dispatch`
  skips NVG entirely. New `MailboxService.findBySlot`. Slot reads
  pre-seed initial messages on nvg / secure_handoff nodes
  (commit 7936a71).
- `secure_agent_handoff` Phase 1 guard — hard deny on OCT clearance
  mismatch at slot read. Rank: `OCT-OPEN` < `OCT-CONFIDENTIAL` <
  `OCT-SECURE`. Unknown labels rank 0 (fail-closed)
  (commit 9b93d7d).
- `WorkspaceRunRequest.subTasks` + `subTaskEdges` accepted on the
  `/workspace/runs` API with strict zod schemas. Threaded through
  `buildPlannerRequest` to the planner (commit e3eafa3).

Tests: 886 / 886 passing. `pnpm ci:gate`: 79 / 79.

### Demo flow (warehouse 2-node)

```bash
curl -X POST http://localhost:7701/workspace/runs \
  -H "Content-Type: application/json" \
  -d '{
    "promptMode": "free_text",
    "prompt": "Find low-stock items and adjust inventory.",
    "subTasks": [
      {
        "kind": "nvg",
        "subTaskKey": "scan",
        "agentId": "<warehouse-agent-id>",
        "taskSummary": "Scan inventory",
        "taskPrompt": "Find products with units < 10 in WH-WEST",
        "expectedOutputSlots": ["low_stock"],
        "inputSlotReads": []
      },
      {
        "kind": "nvg",
        "subTaskKey": "adjust",
        "agentId": "<warehouse-agent-id>",
        "taskSummary": "Plan adjustments",
        "taskPrompt": "Propose unit-level adjustments for the low-stock list",
        "expectedOutputSlots": ["adjustments"],
        "inputSlotReads": [{ "fromSubTaskKey": "scan", "slotId": "low_stock" }]
      }
    ],
    "subTaskEdges": [
      {
        "sourceSubTaskKey": "scan",
        "targetSubTaskKey": "adjust",
        "edgeType": "sequential",
        "conditionSpec": null,
        "outputSlotRef": "low_stock"
      }
    ]
  }'
```

The first node's NVG turn runs the round-trip loop (read inventory via the
postgres connector). Its final assistant text lands in mailbox under slot
`low_stock`. The second node's dispatch sees `inputSlotReads` and pre-seeds
that text into its NVG message thread before its own round-trip.

## Phase 2 — Deferred

Items intentionally not shipped in Phase 1, sequenced for follow-up:

| Area | Description |
|---|---|
| LLM-assisted planning | `plannerMode: 'llm_assisted'` — an LLM decomposes a free-text prompt into a sub-task DAG. Phase 1 requires the workspace to submit explicit DAGs. |
| Real bidirectional redaction | `secure_agent_handoff` slot reads currently hard-deny on OCT mismatch. Phase 2 rewrites bytes flowing INTO a less-cleared agent (lower the data class on read) instead of denying. Phase 1 is correct fail-closed; Phase 2 unlocks practical heterogeneous-clearance flows. |
| Slot-ref substitution in NXS payloads | `NxsActionTemplate.rawPayload` is literal in Phase 1. Phase 2 adds `${slot:subTaskKey:slotId:jsonPath}` template-string substitution so an `nxs_dispatch` node can execute "UPDATE … WHERE id = $upstream-slot[0].id". |
| DAG-builder UI in workspace | The prompt panel doesn't expose `subTasks`. Power users submit via the API today. A real DAG-builder is a frontend project of its own. |
| Plan checkback DAG visualization | The existing checkback shows agents + risk hints as a flat list. Multi-node plans need a graph view. |
| Same-agent delegation reuse | `makeIssueDelegation` mints one delegation per `(principal, agent, sub-task)` tuple. When the same agent appears in multiple sub-tasks, sharing one delegation across them would cut ledger churn. Optimization, not correctness. |
| `partial_result` event detail extension | Currently lacks a `kind: 'data' | 'receipt'` discriminator and `resultRef`. Adding either lets the ledger viewer distinguish receipts from connector data payloads without a per-item drill-down. |
| Re-planning on partial failure | `plan_amendment` codepath exists for amendments mid-run; multi-node DAGs aren't yet integrated with it. |

## UI status

Backend-driven changes that needed front-end work:

| Surface | State | Notes |
|---|---|---|
| Orchestrator panel (`maxToolTurnsPerNode`) | ✅ | Column added, live API exposes the field. |
| Connector panel (postgres default) | ✅ | Placeholder shows postgres-sales-finance + postgres-warehouse. Live wiring already worked. |
| Actor / agent panel (roles) | ✅ | Column + read-only row. Catalog API already returned roles raw; admin-setup endpoint mapped them in. Role mutation is intentionally not wired — sensitive op deserves a guarded writer. |
| Ledger viewer (tool-turn / secure-handoff) | ✅ | Pretty-printed summary line for `node_completed` (toolTurnCount, toolCallsPerTurn, capReached) + `node_failed` (secure_handoff_oct_mismatch, slot_read_*, tool_turn_cap_exceeded, etc.). Receipt vs data discrimination on `partial_result` is deferred (needs backend contract change). |
| Run-timeline / run-stage-reducer | ⏳ | Still collapses multi-node DAGs into a single "Agent response" stage. Per-node taskSummary, sub-task kind, and slot-flow rendering not surfaced. Real multi-node visualization is the largest remaining UI piece. |
| Prompt panel (sub-task DAG builder) | ⏳ | Intentionally skipped in Phase 1 spec. Real DAG-builder UI is a follow-up. |
| Identity provider panel (provider configs) | n/a | Roles belong on actors, not on identity-provider configurations. The provider panel is correct as-is. |

## Architectural notes worth keeping

- **`nodeType` is now load-bearing.** Pre-Phase-1 the discriminator existed
  but every non-local node ran through NVG. Now `nxs_dispatch` is a real
  alternate path with no model invocation.
- **Legacy single-prompt plans now emit `nvg_dispatch`** instead of the
  historical-but-misleading `nxs_dispatch`. The runtime semantics never
  changed; the type now matches what dispatch actually does.
- **`MailboxService.findBySlot` is read-only.** Slot reads do NOT
  transition mailbox items to `consumed`; that only happens on
  compile-return acceptance. Multiple downstream nodes can read the
  same upstream slot.
- **OCT rank is a Phase 1 simplification.** The richer `OCT_CEILINGS`
  (data-class-based) check from `@nexus/contracts` is the correct
  long-term answer; pulled in alongside Phase 2 redaction.
