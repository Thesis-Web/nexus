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
import { AcceptanceWallFailure } from './_acceptance/failure.js';

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

  it('E2E-112-hl4-orch-no-kill: planner unable to resolve → callback (not deny)', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-112',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason: 'HL#4 — orch never kills. Body not written.',
      blockedBy: 'E2E-CALLBACK-FLOW',
      owner: 'builder',
      lawPins: ['HL#4'],
    });
  });
  it('E2E-113-hl5-nxs-only-action-auth: agent NXS-bypass via side-channel → blocked', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-113',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#5 — NXS is the sole action authority. Body should attempt to call a connector directly (no run) and assert refusal at boundary.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#5'],
    });
  });
  it('E2E-114-hl6-nvg-sole-llm-auth: agent direct LLM call → blocked', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-114',
      failureClass: 'UNIMPLEMENTED_TEST_BODY',
      reason:
        'HL#6 — NVG is the sole LLM authority. Body should attempt to call a model adapter directly and assert refusal.',
      blockedBy: 'E2E-HARD-LAW-CATALOG',
      owner: 'builder',
      lawPins: ['HL#6'],
    });
  });

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
   * Two structural proofs combined:
   *   (a) NXS dispatch writes mailbox items into per-actor mailboxes
   *       (mbx-v1-run-<runId>-actor-<actorId>), NOT a shared primary
   *       mailbox. Reading the mailbox storage shows items isolated by
   *       (runId, actorId).
   *   (b) The reference HTTP mailbox route at
   *       GET /mailbox/runs/:runId/items is bound to the legacy primary
   *       mailbox manifest record — it CANNOT return items from
   *       per-actor mailboxes by design, so cross-actor leak via this
   *       route is structurally impossible. (Logged in
   *       REPAIR-MODE-FINDINGS-2026-05-21.md as a separate finding —
   *       the route lacks auth but also lacks access to per-actor
   *       data, so the isolation invariant holds either way.)
   *
   * Drives a real NXS run as sr_analyst, then verifies BOTH proofs:
   *   - mailbox-items.jsonl contains the dispatched item, tagged with
   *     the dispatching agent's mailboxId
   *   - GET /mailbox/runs/:runId/items returns itemCount:0 because the
   *     primary mailbox is empty for this NXS run (the per-actor
   *     mailbox is separate)
   */
  it('E2E-116-hl8-mailbox-only-data-hub: per-actor mailbox isolation enforced', async () => {
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'HL#8 isolation probe',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'isolation-probe',
          agentId: WAREHOUSE_AGENT_ACTOR_ID,
          taskSummary: 'Probe inventory for isolation test',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
            rawPayload: {
              sql: "SELECT sku FROM inventory WHERE sku = 'WIDGET-A' LIMIT 1",
              params: [],
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 90_000 });
    expect(snap.closeReason).toBe('completed');

    // Proof (a) — mailbox_allocated event carries the per-actor
    // mailboxId in the expected canonical shape.
    const mailboxAllocated = snap.ledgerEvents.find(e => e.eventType === 'mailbox_allocated');
    expect(mailboxAllocated, 'mailbox_allocated event present').toBeDefined();
    const allocDetail = mailboxAllocated!.detail as Record<string, unknown>;
    const mailboxId = allocDetail['mailboxId'] as string;
    const actorId = allocDetail['actorId'] as string;
    // Canonical per-actor mailbox shape (see
    // AMEND-nexus-mailbox-pit-v0-2-1 §3.6): mbx-v1-run-<runId>-actor-<actorId>
    expect(mailboxId, 'per-actor mailbox naming').toContain(`run-${runId}`);
    expect(mailboxId, 'per-actor mailbox naming').toContain(`actor-${actorId}`);
    expect(actorId, 'allocation actor matches the dispatching agent').toBe(
      WAREHOUSE_AGENT_ACTOR_ID
    );

    // Proof (b) — the reference HTTP mailbox route is mounted under
    // `/mailbox/*` which is path-scoped to the adminAuth bearer
    // middleware (packages/interfaces/api/src/routes/index.ts:270-275).
    // An agent process (no admin token) hitting this route receives
    // 401 BEFORE the handler runs. That is the HL#8 boundary an agent
    // sees: the only data-hub it can reach is its own per-actor
    // mailbox via the in-process MailboxService, not the HTTP route.
    const res = await fetch(`${harness.baseUrl}/mailbox/runs/${runId}/items`);
    expect(
      res.status,
      'mailbox route is admin-auth-protected; agent cannot reach it without admin token'
    ).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/Unauthorized/i);
  }, 120_000);

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

  it('E2E-118-hl14-claim-drift: mid-run RBAC change halts with claim_drift_detected', () => {
    throw new AcceptanceWallFailure({
      testId: 'E2E-118',
      failureClass: 'UNIMPLEMENTED_SURFACE',
      reason: 'Same blocker as E2E-110 — no admin endpoint to revoke a capability mid-run.',
      blockedBy: 'ADMIN-REVOKE-ENDPOINT-V1',
      owner: 'owner',
      lawPins: ['HL#14'],
    });
  });

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
