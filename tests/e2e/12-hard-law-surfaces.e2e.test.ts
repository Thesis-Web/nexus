/**
 * tests/e2e/12-hard-law-surfaces.e2e.test.ts — E2E v0.4.0 §3.12
 *
 * Category 12: each test targets one Hard Law's enforcement surface
 * directly. This is the structural-invariant suite — if anything
 * here fails, every other test is suspect.
 *
 * Owner directive 2026-05-21: no `it.skip`. The Hard Law surfaces are
 * the highest-priority repair targets. Most have specific blockers
 * (compile pass-through, mailbox-only, claim drift) tied to known
 * arc work.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';

describe('E2E Category 12 — Hard Law surfaces', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  /**
   * E2E-111 — HL#1 auth-first.
   *
   * POST /workspace/runs without an Authorization header MUST return
   * 401 BEFORE any gate fires, BEFORE any run event hits the ledger.
   * If the route lets an unauthenticated request progress far enough
   * to write `run_opened`, every other auth assumption in the wall
   * is compromised. Hardest possible assertion: response is 401, AND
   * the run ledger has zero events relating to whatever runId the
   * caller asserted (we use a fixed sentinel runId to detect leakage).
   */
  it('E2E-111-hl1-auth-first: no auth → 401 before any gate', async () => {
    const sentinelRunId = '00000000-aaaa-4000-bbbb-000000000111';
    const before = await harness.readLedger(sentinelRunId as never);
    expect(before.length, 'sentinel runId starts clean').toBe(0);

    const res = await fetch(`${harness.baseUrl}/workspace/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceSocketId: 'reference-workspace',
        promptMode: 'free_text',
        prompt: 'unauth — should be rejected before any gate',
        agents: [SALES_AGENT_ACTOR_ID],
      }),
    });
    expect(res.status, 'unauthenticated request must return 401').toBe(401);

    // Assert nothing leaked into the run ledger. The route MUST reject
    // before run_opened, and certainly before any gate event fires.
    const after = await harness.readLedger(sentinelRunId as never);
    expect(after.length, 'no events for sentinel runId after rejected request').toBe(0);
  }, 60_000);

  /**
   * E2E-112 — HL#4 surface. Submit a run with a deliberately unhealthy
   * `preferredEndpointId` so the model-tier health check refuses the
   * dispatch. HL#4 demands a callback rather than a kill: either a
   * `plan_checkback_required` event fires, or the planner emits a
   * structured `plan_rejected`. A silent run_closed without either
   * event would be the HL#4 violation.
   */
  it('E2E-112-hl4-orch-no-kill: planner unable to resolve → callback (not deny)', async () => {
    const jwt = await harness.jwtFor('dev-admin');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'nexus-chat-default',
      promptMode: 'free_text',
      prompt: 'force unhealthy frontier preference',
      agents: [CHAT_AGENT_ACTOR_ID],
      preferredEndpointId: 'nonexistent-frontier-endpoint',
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    const callbackOrRejected =
      types.includes('plan_checkback_required') ||
      types.includes('plan_rejected') ||
      types.includes('planner_infeasible');
    expect(
      callbackOrRejected,
      'HL#4 — planner must surface a callback or structured rejection on unresolvable preference'
    ).toBe(true);
  }, 240_000);
  /**
   * E2E-113 — HL#5 NXS is the sole action authority.
   *
   * An agent process has no workspace JWT and no admin token (agents are
   * dispatched-to, not authenticated-as; comment at
   * scripts/nexus-bootstrap.ts:1450-1452). Concretely, a process that
   * attempts to bypass NXS by hitting a connector or NXS pipeline route
   * directly must be refused at the HTTP boundary.
   *
   * This test is narrower than E2E-120 (which probes a wide
   * bypass-paths set): here we focus on the NXS / connector
   * action-authority surface, with the assertion that an
   * unauthenticated POST returns an auth-blocked status (401/403),
   * a not-found (404/405), or — for routes the workspace SPA also
   * answers — the HTML catch-all. A 2xx with a non-HTML body would
   * mean the route executed for an agent-shaped caller, which is the
   * HL#5 violation we're closing out.
   */
  it('E2E-113-hl5-nxs-only-action-auth: agent NXS-bypass via side-channel → blocked', async () => {
    const nxsBypassPaths: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
      { method: 'POST', path: '/nxs/dispatch' },
      { method: 'POST', path: '/nxs/execute' },
      { method: 'POST', path: '/nxs/gates/06/execute' },
      { method: 'POST', path: '/nxs/action' },
      { method: 'POST', path: '/connectors/postgres/execute' },
      { method: 'POST', path: '/connectors/postgres-sales-finance/execute' },
      { method: 'POST', path: '/connectors/postgres-warehouse/execute' },
      { method: 'POST', path: '/connectors/stub/execute' },
      { method: 'GET', path: '/connectors/postgres-sales-finance/query' },
      { method: 'POST', path: '/agent/dispatch' },
      { method: 'POST', path: '/agent/execute' },
    ];

    for (const probe of nxsBypassPaths) {
      const res = await fetch(`${harness.baseUrl}${probe.path}`, {
        method: probe.method,
        headers: { 'Content-Type': 'application/json' },
        body: probe.method === 'POST' ? '{}' : undefined,
      });
      const contentType = res.headers.get('content-type') ?? '';
      const isHtmlSpaFallback = res.status === 200 && contentType.includes('text/html');
      const isAuthBlocked = [401, 403, 404, 405].includes(res.status);
      const acceptable = isAuthBlocked || isHtmlSpaFallback;
      expect(
        acceptable,
        `HL#5 — NXS/connector bypass route must not be agent-reachable: ${probe.method} ${probe.path} returned ${res.status} ${contentType}`
      ).toBe(true);
    }
  }, 60_000);

  /**
   * E2E-114 — HL#6 NVG is the sole LLM authority.
   *
   * Companion to E2E-113 with the NVG / model adapter surface. An
   * agent process attempting to call a model adapter directly (or any
   * NVG-side route) must be refused at the HTTP boundary. The check
   * shape mirrors E2E-113 / E2E-120 — accept auth-blocked or HTML SPA
   * fallback; reject 2xx with non-HTML body (which would prove the route
   * executed for an agent-shaped caller, the HL#6 violation).
   */
  it('E2E-114-hl6-nvg-sole-llm-auth: agent direct LLM call → blocked', async () => {
    const nvgBypassPaths: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
      { method: 'POST', path: '/nvg/classify' },
      { method: 'POST', path: '/nvg/route' },
      { method: 'POST', path: '/nvg/forward' },
      { method: 'POST', path: '/nvg/dispatch' },
      { method: 'POST', path: '/nvg/llm' },
      { method: 'POST', path: '/nvg/invoke' },
      { method: 'POST', path: '/llm/ollama/chat' },
      { method: 'POST', path: '/llm/ollama/generate' },
      { method: 'POST', path: '/llm/openai/v1/chat/completions' },
      { method: 'POST', path: '/llm/anthropic/v1/messages' },
      { method: 'POST', path: '/models/invoke' },
      { method: 'GET', path: '/llm/route' },
    ];

    for (const probe of nvgBypassPaths) {
      const res = await fetch(`${harness.baseUrl}${probe.path}`, {
        method: probe.method,
        headers: { 'Content-Type': 'application/json' },
        body: probe.method === 'POST' ? '{}' : undefined,
      });
      const contentType = res.headers.get('content-type') ?? '';
      const isHtmlSpaFallback = res.status === 200 && contentType.includes('text/html');
      const isAuthBlocked = [401, 403, 404, 405].includes(res.status);
      const acceptable = isAuthBlocked || isHtmlSpaFallback;
      expect(
        acceptable,
        `HL#6 — NVG/LLM bypass route must not be agent-reachable: ${probe.method} ${probe.path} returned ${res.status} ${contentType}`
      ).toBe(true);
    }
  }, 60_000);

  /**
   * E2E-115 — HL#7 LLM never sees tool descriptors.
   *
   * The orchestrator's NVG-call wrapper at scripts/nexus-main.ts:1064-1086
   * emits `tool_schemas_attached` ONLY when `toolDescriptors.length > 0`
   * (default-secure Nexus architecture: LLMs NEVER receive tool
   * descriptors; the planner-drift gate at scripts/build-tool-schemas
   * forces `toolDescriptors: []` for every NVG-bound payload).
   *
   * Strongest possible proof: run a real chat through NVG → Ollama →
   * compile → return, then assert TWO things:
   *   (a) `tool_schemas_attached` either never fires OR fires with
   *       `toolCount: 0` (the orchestrator's audit invariant);
   *   (b) `unsolicited_model_tool_call` never fires (the model can't
   *       inject a tool_use because we never exposed any tools).
   *
   * Any non-zero toolCount on `tool_schemas_attached` OR any
   * occurrence of `unsolicited_model_tool_call` is a HL#7 violation.
   */
  it('E2E-115-hl7-llm-no-tool-descriptors: no tool schemas attached, no unsolicited tool calls', async () => {
    const jwt = await harness.jwtFor('dev-admin');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'nexus-chat-default',
      promptMode: 'free_text',
      prompt: 'who are you?',
      agents: [CHAT_AGENT_ACTOR_ID],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 120_000 });
    expect(snap.runClosed).toBe(true);
    expect(snap.closeReason).not.toBe('error');

    // Run had to actually reach the LLM — assert the canonical chat
    // path events fired (delegation, run_closed). Otherwise the chat
    // never executed and the HL#7 invariant is unverified.
    const types = snap.ledgerEvents.map(e => e.eventType);
    expect(types, 'delegation_issued').toContain('delegation_issued');
    expect(types, 'run_closed').toContain('run_closed');

    // (a) tool_schemas_attached either never fires, or fires only with
    // toolCount: 0. The orchestrator's emitter at scripts/nexus-main.ts:1070
    // explicitly skips the emit when toolDescriptors is empty, so the
    // expected steady state is "no event at all". Either shape is fine
    // as long as we never see toolCount > 0.
    const attached = snap.ledgerEvents.filter(e => e.eventType === 'tool_schemas_attached');
    for (const e of attached) {
      const d = e.detail as Record<string, unknown>;
      expect(d['toolCount'], 'HL#7 — orchestrator never ships tool descriptors to NVG').toBe(0);
    }
    // (b) No unsolicited tool call from the model side.
    const unsolicited = snap.ledgerEvents.filter(
      e => e.eventType === 'unsolicited_model_tool_call'
    );
    expect(
      unsolicited.length,
      'HL#7 — model never emitted a tool_use block (it had no tools to call)'
    ).toBe(0);
  }, 180_000);

  /**
   * E2E-116 — HL#8 mailbox is the only data hub.
   *
   * Owner ruling 2026-05-21: the prior body was a cheap green. It
   * proved that anonymous callers get 401 from /mailbox/* and that a
   * single mailbox_allocated event carries a per-actor *name shape* —
   * neither of which establishes that actor A cannot read or
   * contaminate actor B's mailbox. Per the outline §K (Admin Dashboard,
   * BAKED), admin auth is the control/inspection plane; "anonymous
   * gets 401" is the §K boundary, not the §3 mailbox isolation proof.
   *
   * The production-correct proof is at the storage layer the runtime
   * actually writes to:
   *   1. Dispatch TWO agents in ONE run against disjoint target
   *      systems (sales-agent → sales-finance, warehouse-agent →
   *      warehouse). The orch coordinator allocates one per-actor
   *      mailbox per unique agentId in the plan (packages/orch-ref/
   *      src/run-coordinator.ts:374-379) and emits one
   *      mailbox_allocated event per allocation.
   *   2. Each NXS bridge write goes to getMailboxForActor(runId,
   *      node.agentId) (scripts/nexus-main.ts:741-744). The runtime
   *      enforces ownership at the write boundary via
   *      MailboxService.assertMailboxBelongsToActor — any cross-actor
   *      write throws NexusSecurityViolation with
   *      MAILBOX_OWNERSHIP_MISMATCH.
   *   3. Read the on-disk mailbox-items.jsonl this run wrote to and
   *      assert per-mailbox grouping shows each mailbox contains items
   *      tagged only to its own actor's agentId (and the disjoint set
   *      check is symmetric — neither mailboxId appears in the other
   *      actor's item set).
   *
   * The HTTP admin-auth probe is kept ONLY as a secondary §K control-
   * plane check (admin can audit; agents cannot reach the route). It
   * is NOT the primary proof.
   */
  it('E2E-116-hl8-mailbox-only-data-hub: per-actor mailbox isolation enforced', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'HL#8 multi-actor isolation probe',
      // Two agents, two disjoint target systems. Per Hard Law #15 the
      // symmetric intersection narrows each delegation to its own
      // single allowedSystem (sales-agent→sales-finance,
      // warehouse-agent→warehouse), so the two NXS dispatches cannot
      // overlap by construction. That sets up the storage-layer
      // isolation assertion that follows.
      agents: [SALES_AGENT_ACTOR_ID, WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'hl8-sales-probe',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Sales-agent reads its own system.',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: {
              system: 'sales-finance',
              resourceType: 'sales_orders',
              resourceScope: 'bulk',
            },
            rawPayload: {
              sql: 'SELECT order_code FROM sales_orders WHERE customer_code = $1 ORDER BY order_code',
              params: ['CUST-001'],
            },
          },
        },
        {
          kind: 'nxs',
          subTaskKey: 'hl8-warehouse-probe',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Warehouse-agent reads its own system.',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku FROM inventory WHERE sku = $1 LIMIT 1',
              params: ['WIDGET-A'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 120_000 });
    expect(snap.closeReason, 'multi-actor run must close cleanly').toBe('completed');

    // Bridge/dispatch corruption invalidates the isolation proof —
    // any item written by a fallback or error path can't be trusted to
    // carry the right (mailboxId, agentId, taskId) provenance. Hard
    // floor: neither event may appear in this run's ledger.
    const ledger = snap.ledgerEvents;
    expect(
      ledger.some(e => e.eventType === 'nxs_dispatch_bridge_returned_null'),
      'no bridge-null events (would invalidate mailbox write provenance)'
    ).toBe(false);
    expect(
      ledger.some(e => e.eventType === 'error_dispatch'),
      'no error_dispatch (would invalidate mailbox write provenance)'
    ).toBe(false);

    // ── Proof 1: two mailbox_allocated events, distinct mailboxIds ──
    //
    // RefRunCoordinator allocates one per-actor mailbox per unique
    // plan.node.agentId at plan_confirmed step 3.6 (run-coordinator.ts
    // :374-378). Two NXS sub-tasks with two different agentIds must
    // therefore yield exactly two events.
    const allocEvents = ledger.filter(e => e.eventType === 'mailbox_allocated');
    expect(allocEvents.length, 'one mailbox_allocated event per unique actor in the plan').toBe(2);
    const allocSales = allocEvents.find(
      e => (e.detail as Record<string, unknown>)['actorId'] === SALES_AGENT_ACTOR_ID
    );
    const allocWarehouse = allocEvents.find(
      e => (e.detail as Record<string, unknown>)['actorId'] === WAREHOUSE_AGENT_ACTOR_ID
    );
    expect(allocSales, 'sales-agent allocation event present').toBeDefined();
    expect(allocWarehouse, 'warehouse-agent allocation event present').toBeDefined();
    const salesMailboxId = (allocSales!.detail as Record<string, unknown>)['mailboxId'] as string;
    const warehouseMailboxId = (allocWarehouse!.detail as Record<string, unknown>)[
      'mailboxId'
    ] as string;
    expect(salesMailboxId, 'sales mailboxId is non-empty').toBeTruthy();
    expect(warehouseMailboxId, 'warehouse mailboxId is non-empty').toBeTruthy();
    expect(salesMailboxId, 'per-actor mailboxIds disjoint at allocation').not.toBe(
      warehouseMailboxId
    );
    // Canonical mailbox-pit/v1 shape (mbx-v1-run-<runId>-actor-<actorId>).
    // The audit decoder relies on this contract; if naming drifts,
    // assertMailboxBelongsToActor still enforces ownership, but the
    // audit grep path breaks.
    expect(salesMailboxId).toContain(`run-${runId}`);
    expect(salesMailboxId).toContain(`actor-${SALES_AGENT_ACTOR_ID}`);
    expect(warehouseMailboxId).toContain(`run-${runId}`);
    expect(warehouseMailboxId).toContain(`actor-${WAREHOUSE_AGENT_ACTOR_ID}`);

    // ── Proof 2: both NXS dispatches actually executed ──
    //
    // The mailbox proof below is only meaningful if both actors wrote
    // — proving "no warehouse items leaked into sales mailbox" by
    // having neither actor write anything is the cheap pseudo-proof we
    // are rejecting. Disambiguate each agent's dispatch by the resolved
    // target system in `detail.target` (the canonical Gate-02-normalized
    // system identifier emitted by scripts/nexus-main.ts:2388-2402; the
    // event's top-level actorId is not surfaced through the harness's
    // RunClosedSnapshot, so target is the load-bearing key).
    const nxsActions = ledger.filter(e => e.eventType === 'nxs_action');
    const salesExecuted = nxsActions.some(e => {
      const d = e.detail as Record<string, unknown>;
      return d['target'] === 'sales-finance' && d['finalOutcome'] === FINAL_OUTCOME.EXECUTED;
    });
    const warehouseExecuted = nxsActions.some(e => {
      const d = e.detail as Record<string, unknown>;
      return d['target'] === 'warehouse' && d['finalOutcome'] === FINAL_OUTCOME.EXECUTED;
    });
    expect(salesExecuted, 'sales-finance nxs_action reached EXECUTED').toBe(true);
    expect(warehouseExecuted, 'warehouse nxs_action reached EXECUTED').toBe(true);

    // ── Proof 3: on-disk per-actor mailbox isolation ──
    //
    // The mailbox manifest declares storageRoot as the relative path
    // `runs/mailbox`. The harness spawns the server through
    // `pnpm --dir <repoRoot> nexus serve`; pnpm changes its own cwd to
    // repoRoot, and the spawned tsx process inherits repoRoot as its
    // effective cwd at relative-path resolution time. The on-disk file
    // therefore lands at <repoRoot>/runs/mailbox/mailbox-items.jsonl —
    // shared by all harness runs, so we filter by runId.
    const mboxPath = path.join(process.cwd(), 'runs', 'mailbox', 'mailbox-items.jsonl');
    const raw = await fs.readFile(mboxPath, 'utf-8');
    type StoredItem = {
      mailboxItemId: string;
      mailboxId: string;
      runId: string;
      taskId: string;
      agentId: string;
      slotId: string;
      sourceType: string;
      provenance: string;
    };
    const allItems = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as StoredItem);
    const runItems = allItems.filter(i => i.runId === runId);
    expect(runItems.length, 'multi-actor run produced mailbox items on disk').toBeGreaterThan(0);

    const salesItems = runItems.filter(i => i.mailboxId === salesMailboxId);
    const warehouseItems = runItems.filter(i => i.mailboxId === warehouseMailboxId);
    expect(
      salesItems.length,
      'sales-agent per-actor mailbox has at least one written item'
    ).toBeGreaterThan(0);
    expect(
      warehouseItems.length,
      'warehouse-agent per-actor mailbox has at least one written item'
    ).toBeGreaterThan(0);

    // Per-item provenance: every item in the sales mailbox carries
    // sales-agent's agentId, the NXS connector provenance, and the
    // NXS execution-result sourceType. Hard floor — if any one item
    // deviates the bridge is corrupting writer identity.
    for (const item of salesItems) {
      expect(item.agentId, `sales-mailbox item ${item.mailboxItemId} agentId`).toBe(
        SALES_AGENT_ACTOR_ID
      );
      expect(item.provenance, `sales-mailbox item ${item.mailboxItemId} provenance`).toBe(
        'nxs_connector_result'
      );
      expect(item.sourceType, `sales-mailbox item ${item.mailboxItemId} sourceType`).toBe(
        'nxs_execution_result'
      );
    }
    for (const item of warehouseItems) {
      expect(item.agentId, `warehouse-mailbox item ${item.mailboxItemId} agentId`).toBe(
        WAREHOUSE_AGENT_ACTOR_ID
      );
      expect(item.provenance, `warehouse-mailbox item ${item.mailboxItemId} provenance`).toBe(
        'nxs_connector_result'
      );
      expect(item.sourceType, `warehouse-mailbox item ${item.mailboxItemId} sourceType`).toBe(
        'nxs_execution_result'
      );
    }

    // Cross-actor leak floor: stated as set membership so the failure
    // mode is unambiguous in the test report. No warehouse-agent item
    // appears under the sales mailboxId and vice versa.
    const salesItemsTaggedToWarehouseAgent = salesItems.filter(
      i => i.agentId === WAREHOUSE_AGENT_ACTOR_ID
    );
    const warehouseItemsTaggedToSalesAgent = warehouseItems.filter(
      i => i.agentId === SALES_AGENT_ACTOR_ID
    );
    expect(
      salesItemsTaggedToWarehouseAgent.length,
      'no warehouse-agent items leaked into sales mailbox'
    ).toBe(0);
    expect(
      warehouseItemsTaggedToSalesAgent.length,
      'no sales-agent items leaked into warehouse mailbox'
    ).toBe(0);

    // Inverted index: for this run, the set of mailboxIds carrying
    // sales-agent items must be disjoint from the set carrying
    // warehouse-agent items. Disjointness here is the structural
    // expression of HL#8 — the data hub is partitioned by (runId,
    // actorId) and nothing crosses the seam.
    const mailboxIdsForSales = new Set(
      runItems.filter(i => i.agentId === SALES_AGENT_ACTOR_ID).map(i => i.mailboxId)
    );
    const mailboxIdsForWarehouse = new Set(
      runItems.filter(i => i.agentId === WAREHOUSE_AGENT_ACTOR_ID).map(i => i.mailboxId)
    );
    const overlap = [...mailboxIdsForSales].filter(id => mailboxIdsForWarehouse.has(id));
    expect(
      overlap.length,
      `mailboxId sets must be disjoint per actor (overlap=${overlap.join(',')})`
    ).toBe(0);
    expect(mailboxIdsForSales.has(salesMailboxId)).toBe(true);
    expect(mailboxIdsForWarehouse.has(warehouseMailboxId)).toBe(true);

    // End-to-end completion proof — assert the final_response ledger
    // event fired (the harness's RunClosedSnapshot.artifactBody is
    // structurally null because the snapshot doesn't fetch artifact
    // payload over HTTP; the ledger event is the on-disk truth that
    // compile triggered and dispatched a final response back through
    // the workspace). Existing single-agent tests in 03-nxs-single
    // use the same ledger-event proof of completion.
    const types = ledger.map(e => e.eventType);
    expect(types, 'final_response event present (compile → return fired)').toContain(
      'final_response'
    );

    // ── Secondary check: §K admin control-plane boundary ──
    //
    // The reference HTTP mailbox route at /mailbox/* is path-scoped to
    // adminAuth (packages/interfaces/api/src/routes/index.ts:270-275).
    // Agents (no admin token) cannot reach it. Per the outline §K,
    // admin auth is the legitimate read/inspect/config plane — the
    // 401 confirms anonymous callers (the agent-runtime posture) are
    // closed out. This is a complement to the storage-layer proof
    // above, NOT a substitute.
    const res = await fetch(`${harness.baseUrl}/mailbox/runs/${runId}/items`);
    expect(
      res.status,
      'admin HTTP mailbox route closed to anonymous callers (§K control plane)'
    ).toBe(401);
    const httpBody = (await res.json()) as { ok: boolean; error: string };
    expect(httpBody.ok).toBe(false);
    expect(httpBody.error).toMatch(/Unauthorized/i);
  }, 240_000);

  /**
   * E2E-117 — HL#11 compile pass-through (no contract).
   *
   * Single-agent no-contract run: compile MUST emit the artifact
   * verbatim from the source mailbox item. Strongest proof: the
   * artifact's bodyDigest equals the source mailbox item's
   * resultDigest. Anything that mutates bytes between mailbox and
   * artifact (templating, JSON re-encoding, even key-reorder) is
   * caught by the digest comparison.
   */
  it('E2E-117-hl11-compile-passthrough: artifact.bodyDigest === source mailbox.resultDigest', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'HL#11 pass-through probe',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'passthrough-probe',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Read one inventory row',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT sku, location_code, quantity_on_hand FROM inventory WHERE sku = $1 LIMIT 1',
              params: ['WIDGET-A'],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    expect(snap.closeReason).toBe('completed');

    const compileAssembly = snap.ledgerEvents.find(
      e => e.eventType === 'compile_assembly_complete'
    );
    expect(compileAssembly, 'compile_assembly_complete event present').toBeDefined();
    const asmDetail = compileAssembly!.detail as Record<string, unknown>;
    // The deterministic compile assembler marks pass-through runs explicitly.
    expect(asmDetail['passThrough'], 'no-contract run must be pass-through').toBe(true);
    expect(asmDetail['templateId'], 'template id is the pass-through sentinel').toBe(
      'pass_through'
    );
    expect(asmDetail['itemCount'], 'exactly one mailbox item flowed through').toBe(1);
    const sourceMailboxItemId = asmDetail['sourceMailboxItemId'] as string;
    const bodyDigest = asmDetail['bodyDigest'] as string;
    expect(typeof sourceMailboxItemId).toBe('string');
    expect(typeof bodyDigest).toBe('string');

    // Now read the on-disk mailbox-items.jsonl and find the item by id;
    // its resultDigest must equal the artifact bodyDigest. This is the
    // hard digest-level proof of pass-through — no template, no re-encode.
    //
    // The mailbox manifest declares storageRoot as the relative path
    // `runs/mailbox`. The harness spawns the server through
    // `pnpm --dir <repoRoot> nexus serve`; pnpm resolves the package
    // dir against repoRoot, and the spawned process inherits repoRoot
    // as its effective cwd at relative-path resolution time. The
    // file therefore lands at <repoRoot>/runs/mailbox/mailbox-items.jsonl
    // (and accumulates items across runs — we filter by mailboxItemId).
    const mboxPath = path.join(process.cwd(), 'runs', 'mailbox', 'mailbox-items.jsonl');
    const raw = await fs.readFile(mboxPath, 'utf-8');
    const items = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as { mailboxItemId: string; resultDigest: string });
    const source = items.find(i => i.mailboxItemId === sourceMailboxItemId);
    expect(source, 'source mailbox item exists on disk').toBeDefined();
    expect(
      source!.resultDigest,
      'HL#11 — compile body bytes equal source mailbox bytes (digest match)'
    ).toBe(bodyDigest);
  }, 120_000);

  /**
   * E2E-118 — HL#14 claim drift. Open a long-ish run, attempt a
   * best-effort mid-run revoke probe (the admin endpoint may not
   * exist — that is the gap), and assert either claim_drift_detected
   * fires OR the run closes cleanly without silent capability
   * corruption. HL#14 violation would be a run closing as EXECUTED on
   * a path that depended on a revoked claim with no drift event.
   */
  it('E2E-118-hl14-claim-drift: mid-run RBAC change halts with claim_drift_detected', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'HL#14 drift probe — long warehouse read',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'hl14-long-read',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'long warehouse read',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: { sql: 'SELECT sku FROM inventory ORDER BY sku', params: [] },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    void fetch(`${harness.baseUrl}/workspace/admin/principals/sr_analyst/revoke`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ capability: 'read:record:bulk' }),
    }).catch(() => undefined);
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    // HL#14 production-shape: a mid-run revoke MUST surface
    // claim_drift_detected. Absent admin revoke endpoint → no drift
    // event → honest red.
    expect(types, 'HL#14 — claim_drift_detected must fire on mid-run revoke').toContain(
      'claim_drift_detected'
    );
  }, 300_000);

  /**
   * E2E-119 — HL#15 symmetric per-dimension intersection.
   *
   * The seeded `sr_analyst` has allowedSystems=['sales-finance',
   * 'warehouse']. The seeded `nexus-sales-agent` actor has
   * allowedSystems=['sales-finance'] ONLY. A run that dispatches the
   * sales agent against the warehouse system must fail closed — the
   * agent's narrower scope wins the intersection regardless of the
   * user's broader claim. The denial fires at
   * packages/core/src/policy/grant-template-builder.ts:88 with
   * `BROAD_TOKEN_BYPASS` because the resolved target system is not in
   * the minted delegation's allowedSystems.
   *
   * Concrete assertion: the run closes WITHOUT executed_successfully
   * AND the nxs_action records a denied finalOutcome.
   */
  it('E2E-119-hl15-symmetric-intersection: agent ceiling wins against broader user', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'HL#15 intersection probe',
      // User (sr_analyst) has warehouse; agent (sales-agent) does NOT.
      // The mint+evaluate chain should land on the agent's ceiling.
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'intersection-probe',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'Sales agent attempts a warehouse read',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: 'SELECT 1 FROM inventory LIMIT 1',
              params: [],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });

    // Two valid shapes for this denial:
    //   1. The delegation mint refuses with `delegation_empty_intersection`
    //      on `target_systems` (agent=[sales-finance], user/explicit
    //      both include warehouse — intersection on the sales-finance-
    //      narrow dimension is non-empty, but the action target
    //      warehouse is not in the resulting set).
    //   2. The mint succeeds, then grant-template-builder throws
    //      BROAD_TOKEN_BYPASS at gate 04 because the action target
    //      (warehouse) is not in the delegation's allowedSystems
    //      (the agent narrowed it to [sales-finance]).
    //
    // Both are honest denials of the same intersection law; the
    // assertion accepts either path AND rejects executed_successfully.
    const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    const driftEvents = snap.ledgerEvents.filter(
      e => e.eventType === 'delegation_empty_intersection'
    );
    const denialThroughDispatch = nxsActions.some(e => {
      const fo = (e.detail as Record<string, unknown>)['finalOutcome'];
      return typeof fo === 'string' && fo !== FINAL_OUTCOME.EXECUTED;
    });
    expect(
      driftEvents.length > 0 || denialThroughDispatch,
      'HL#15 — sales-agent → warehouse must be denied (intersection or grant-template denial)'
    ).toBe(true);

    // Hard floor: NO executed_successfully anywhere in this run.
    const executedActions = nxsActions.filter(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(
      executedActions.length,
      'no nxs_action may report executed_successfully when intersection blocks the path'
    ).toBe(0);
  }, 120_000);

  /**
   * E2E-120 — HL#16 agent boundary.
   *
   * Agents touch ONLY their assigned mailboxes. There must be no HTTP
   * route reachable by an agent process (one with no workspace JWT
   * and no admin token) that lets it bypass the orch and call NXS /
   * NVG / ledger / direct-connector primitives.
   *
   * Strongest test from the outside: probe candidate bypass paths
   * WITHOUT any authentication header (the agent's posture) and
   * assert each path is either:
   *   - 404 (route does not exist), or
   *   - 405 (method not allowed), or
   *   - 401/403 (auth-required — the agent has no auth, so the path
   *     is closed to it; an admin/workspace-JWT caller hitting an
   *     admin route is out of scope for this test).
   *
   * A 2xx response from an unauthenticated probe IS a HL#16 violation
   * because that means the route is open to ANY caller including an
   * agent process. (Out-of-scope follow-up: a separate test should
   * verify that admin-only routes truly require admin scope, not just
   * "any JWT".)
   */
  it('E2E-120-hl16-agent-touches-only-mailboxes: no agent-reachable NXS/NVG/ledger HTTP route', async () => {
    // Each candidate bypass path is one an agent process would try
    // if it wanted to skip the mailbox loop. None must be reachable
    // to an unauthenticated caller.
    const bypassPaths: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
      { method: 'POST', path: '/nxs/dispatch' },
      { method: 'POST', path: '/nxs/execute' },
      { method: 'POST', path: '/nxs/gates/06/execute' },
      { method: 'POST', path: '/nvg/classify' }, // does exist as reference; must be agent-unreachable
      { method: 'POST', path: '/nvg/route' }, //   same
      { method: 'POST', path: '/nvg/forward' },
      { method: 'POST', path: '/nvg/dispatch' },
      { method: 'POST', path: '/nvg/llm' },
      { method: 'POST', path: '/ledger/append' },
      { method: 'POST', path: '/ledger/evidence/append' },
      { method: 'POST', path: '/run-ledger/events' },
      { method: 'POST', path: '/agent/execute' },
      { method: 'POST', path: '/agent/dispatch' },
      { method: 'GET', path: '/connectors/postgres/execute' },
    ];

    for (const probe of bypassPaths) {
      const res = await fetch(`${harness.baseUrl}${probe.path}`, {
        method: probe.method,
        headers: { 'Content-Type': 'application/json' },
        body: probe.method === 'POST' ? '{}' : undefined,
      });
      const contentType = res.headers.get('content-type') ?? '';
      // Acceptable outcomes (any one proves no agent-reachable bypass):
      //   - 404 / 405: route does not exist for this method
      //   - 401 / 403: route exists but requires admin auth (agent
      //     has no token, so the path is closed)
      //   - 200 with text/html: SPA catch-all served the workspace UI
      //     bundle; the agent received HTML, not API access
      //
      // A 200 with application/json (or any non-HTML body) on an
      // unauthenticated probe IS a HL#16 violation because the route
      // executed for an agent caller.
      const isHtmlSpaFallback = res.status === 200 && contentType.includes('text/html');
      const isAuthBlocked = [401, 403, 404, 405].includes(res.status);
      const acceptable = isAuthBlocked || isHtmlSpaFallback;
      expect(
        acceptable,
        `HL#16 — bypass route must not be agent-reachable: ${probe.method} ${probe.path} returned ${res.status} ${contentType}`
      ).toBe(true);
    }
  }, 60_000);
});
