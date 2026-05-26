/**
 * tests/e2e/14-shared-harness-concurrency.e2e.test.ts —
 * Phase 7 vertical slice (E2E-WALL-REPAIR-CAMPAIGN-v3 §13 TASK-29).
 *
 * Proves the shared single-server harness correctly mirrors production:
 * one Nexus server, many users/personas/runs concurrently, runtime-
 * enforced isolation via per-runId UUIDs + per-(runId, actorId) mailbox
 * storage + runId-keyed ledger filtering.
 *
 * SHARED-MODE ONLY. The isolated config excludes this file (per
 * vitest.e2e.config.ts comment). Running this against an isolated
 * harness would prove nothing — every "concurrent" run would land on
 * this file's own one-suite subprocess, not test cross-test isolation.
 *
 * Seven cases, mapped to the campaign prompt:
 *   1. shared server serves 10 ladder personas (login parity)
 *   2. concurrent runs produce unique runIds
 *   3. no mailbox item from run A appears in run B
 *   4. user A cannot read user B's run
 *   5. ledgers interleave but filter cleanly by runId
 *   6. final_response delivered to correct run
 *   7. simultaneous NXS actions do not cross principal/delegation scopes
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';

// Full ladder used across the wall — proves the shared server's auth +
// claims projection works for every persona, not just dev-admin.
const LADDER_ROLES: ReadonlyArray<UserLadderRole> = [
  'janitor',
  'intern',
  'analyst',
  'sr_analyst',
  'manager',
  'sr_manager',
  'director',
  'vp',
  'executive',
  'ceo',
];

describe('E2E Category 14 — shared-harness concurrency (Phase 7)', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    // Fails fast with a clear message if NEXUS_E2E_BASE_URL isn't set,
    // i.e. someone tried to run this against the isolated config.
    harness = await bootHarness({ mode: 'shared' });
  }, 60_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  /** Case 1 — every persona can log into the shared server in parallel. */
  it('SHARED-01: 10 ladder personas log in concurrently and receive distinct JWTs', async () => {
    const jwts = await Promise.all(LADDER_ROLES.map(role => harness.jwtFor(role)));
    expect(jwts.length).toBe(LADDER_ROLES.length);
    // Distinct JWTs (no session aliasing across personas).
    const unique = new Set(jwts);
    expect(unique.size, '10 distinct JWTs (no session aliasing)').toBe(LADDER_ROLES.length);
    // Each token resolves to its own principal via /workspace/me.
    const mes = await Promise.all(
      jwts.map(async jwt => {
        const res = await fetch(harness.baseUrl + '/workspace/me', {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        const body = (await res.json()) as { ok: boolean; data?: { principalId: string } };
        expect(body.ok).toBe(true);
        return body.data!.principalId;
      })
    );
    const uniquePrincipals = new Set(mes);
    expect(uniquePrincipals.size, '10 distinct principalIds resolved').toBe(LADDER_ROLES.length);
  }, 120_000);

  /** Case 2 — concurrent runs produce unique runIds. */
  it('SHARED-02: 5 concurrent runs from 5 personas produce 5 distinct runIds', async () => {
    const personas: ReadonlyArray<UserLadderRole> = [
      'sr_analyst',
      'manager',
      'sr_manager',
      'director',
      'vp',
    ];
    const runIds = await Promise.all(
      personas.map(async role => {
        const jwt = await harness.jwtFor(role);
        const { runId } = await harness.createRun(jwt, {
          workspaceSocketId: 'reference-workspace',
          promptMode: 'free_text',
          prompt: `concurrency probe — ${role} ${Date.now()}`,
          agents: [SALES_AGENT_ACTOR_ID],
          subTasks: [
            {
              kind: 'nxs',
              subTaskKey: `probe-${role}`,
              agentId: SALES_AGENT_ACTOR_ID,
              taskSummary: 'concurrent probe',
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
                  sql: 'SELECT order_code FROM sales_orders ORDER BY order_code LIMIT 1',
                  params: [],
                },
              },
            },
          ] as ReadonlyArray<unknown>,
          subTaskEdges: [],
        });
        return runId;
      })
    );
    expect(new Set(runIds).size, 'all runIds distinct (UUIDs minted server-side)').toBe(
      personas.length
    );
    // Sanity: every runId is a UUID.
    for (const id of runIds) {
      expect(id).toMatch(/^[a-f0-9-]{36}$/);
    }
  }, 180_000);

  /** Case 3 + Case 5 — mailbox items + ledger events filter cleanly by runId. */
  it('SHARED-03 + 05: mailbox isolation + ledger runId filtering across two concurrent runs', async () => {
    const [jwtA, jwtB] = await Promise.all([
      harness.jwtFor('sr_analyst'),
      harness.jwtFor('manager'),
    ]);
    // AUDIT FIX 2026-05-26: dispatch A and B CONCURRENTLY via Promise.all.
    // The prior shape was `const runA = await ...; const runB = await ...;`
    // — sequential dispatch then concurrent wait, which left the
    // dispatch-concurrency invariant unexercised. The downstream isolation
    // assertions below (mailbox disjointness, runId-keyed ledger filtering)
    // only mean something if both dispatches were ACTUALLY in flight at the
    // same time against the shared server.
    const [runA, runB] = await Promise.all([
      harness.createRun(jwtA, {
        workspaceSocketId: 'reference-workspace',
        promptMode: 'free_text',
        prompt: 'concurrency-mailbox-A',
        agents: [SALES_AGENT_ACTOR_ID],
        subTasks: [
          {
            kind: 'nxs',
            subTaskKey: 'leg-A',
            agentId: SALES_AGENT_ACTOR_ID,
            taskSummary: 'A',
            expectedOutputSlots: ['rows'],
            inputSlotReads: [],
            actionTemplate: {
              capability: 'read:record:bulk',
              target: {
                system: 'sales-finance',
                resourceType: 'sales_orders',
                resourceScope: 'bulk',
              },
              rawPayload: { sql: 'SELECT order_code FROM sales_orders LIMIT 1', params: [] },
            },
          },
        ] as ReadonlyArray<unknown>,
        subTaskEdges: [],
      }),
      harness.createRun(jwtB, {
        workspaceSocketId: 'reference-workspace',
        promptMode: 'free_text',
        prompt: 'concurrency-mailbox-B',
        agents: [SALES_AGENT_ACTOR_ID],
        subTasks: [
          {
            kind: 'nxs',
            subTaskKey: 'leg-B',
            agentId: SALES_AGENT_ACTOR_ID,
            taskSummary: 'B',
            expectedOutputSlots: ['rows'],
            inputSlotReads: [],
            actionTemplate: {
              capability: 'read:record:bulk',
              target: {
                system: 'sales-finance',
                resourceType: 'sales_orders',
                resourceScope: 'bulk',
              },
              rawPayload: { sql: 'SELECT order_code FROM sales_orders LIMIT 1', params: [] },
            },
          },
        ] as ReadonlyArray<unknown>,
        subTaskEdges: [],
      }),
    ]);
    // Wait for both — concurrent waits, sharing the server's compile + return path.
    const [snapA, snapB] = await Promise.all([
      harness.waitForRunClosed(jwtA, runA.runId, { timeoutMs: 180_000 }),
      harness.waitForRunClosed(jwtB, runB.runId, { timeoutMs: 180_000 }),
    ]);
    expect(snapA.runClosed).toBe(true);
    expect(snapB.runClosed).toBe(true);

    // Ledger filtering: each snapshot only contains events for ITS own runId
    // (readRunEvents filters at line 129 of harness.ts).
    for (const e of snapA.ledgerEvents) {
      expect((e.detail as Record<string, unknown>)['runId'] ?? runA.runId).toBe(runA.runId);
    }
    for (const e of snapB.ledgerEvents) {
      expect((e.detail as Record<string, unknown>)['runId'] ?? runB.runId).toBe(runB.runId);
    }
    // The two runs must have different runIds (sanity).
    expect(runA.runId).not.toBe(runB.runId);

    // Mailbox: run A's per-actor mailbox file is disjoint from run B's.
    // (Per-runId named JSONL — harness.ts:446 reads
    // <ledgerCwd>/runs/mailbox/<runId>.jsonl)
    const aItems = await harness.readMailboxItems(runA.runId);
    const bItems = await harness.readMailboxItems(runB.runId);
    expect(aItems.length, 'run A produced mailbox items').toBeGreaterThan(0);
    expect(bItems.length, 'run B produced mailbox items').toBeGreaterThan(0);
    // No item from run B carries runId=A's runId (and vice versa).
    for (const item of aItems as ReadonlyArray<{ runId?: string }>) {
      if (item.runId !== undefined) expect(item.runId).toBe(runA.runId);
    }
    for (const item of bItems as ReadonlyArray<{ runId?: string }>) {
      if (item.runId !== undefined) expect(item.runId).toBe(runB.runId);
    }
  }, 360_000);

  /** Case 4 — user A cannot read user B's run via /workspace/runs/:runId. */
  it('SHARED-04: user A cannot fetch user B run status (HTTP scope enforcement)', async () => {
    const [jwtA, jwtB] = await Promise.all([
      harness.jwtFor('sr_analyst'),
      harness.jwtFor('manager'),
    ]);
    // user A opens a run.
    const { runId: runAId } = await harness.createRun(jwtA, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'A-only-visibility',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'a-probe',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'A',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: {
              system: 'sales-finance',
              resourceType: 'sales_orders',
              resourceScope: 'bulk',
            },
            rawPayload: { sql: 'SELECT order_code FROM sales_orders LIMIT 1', params: [] },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    // user B asks for user A's runId — must not get the run record.
    // Acceptable shapes: 403, 404, or an ok response that hides the
    // run from B (the workspace MUST NOT leak A's run into B's view).
    const res = await fetch(`${harness.baseUrl}/workspace/runs/${encodeURIComponent(runAId)}`, {
      headers: { Authorization: `Bearer ${jwtB}` },
    });
    const acceptable =
      res.status === 403 ||
      res.status === 404 ||
      (res.status === 200 &&
        (await res
          .clone()
          .json()
          .catch(() => ({}) as Record<string, unknown>)) &&
        // If the workspace ever returns 200 to a cross-user lookup, the
        // body MUST NOT carry the run's principalId / actor identifiers.
        !(await res
          .clone()
          .text()
          .then(txt => txt.includes(runAId))));
    expect(
      acceptable,
      `cross-user run lookup must not leak A's run to B (status=${res.status})`
    ).toBe(true);
  }, 60_000);

  /** Case 6 + 7 — final_response per run, NXS scopes per principal/delegation. */
  it('SHARED-06 + 07: simultaneous NXS dispatches keep final_response + delegation scopes per-run', async () => {
    const [jwtA, jwtB] = await Promise.all([
      harness.jwtFor('sr_analyst'),
      harness.jwtFor('sr_analyst'),
    ]);
    // Same persona, two SIMULTANEOUS dispatches against DIFFERENT target
    // systems. The delegation mint must produce scopes that target each
    // system disjointly — A→sales-finance only, B→warehouse only.
    //
    // AUDIT FIX 2026-05-26: dispatch A and B CONCURRENTLY via Promise.all
    // (was sequential await runA; await runB). The "simultaneous NXS
    // dispatches" invariant in the test name only mean something if both
    // createRun calls fire against the shared server at the same time;
    // otherwise the delegation-mint isolation proof collapses to "two
    // serial mints produced disjoint scopes" — which is trivially true.
    const [runA, runB] = await Promise.all([
      harness.createRun(jwtA, {
        workspaceSocketId: 'reference-workspace',
        promptMode: 'free_text',
        prompt: 'scope-A-sales',
        agents: [SALES_AGENT_ACTOR_ID],
        subTasks: [
          {
            kind: 'nxs',
            subTaskKey: 'sales-leg',
            agentId: SALES_AGENT_ACTOR_ID,
            taskSummary: 'sales pull',
            expectedOutputSlots: ['rows'],
            inputSlotReads: [],
            actionTemplate: {
              capability: 'read:record:bulk',
              target: {
                system: 'sales-finance',
                resourceType: 'sales_orders',
                resourceScope: 'bulk',
              },
              rawPayload: { sql: 'SELECT order_code FROM sales_orders LIMIT 1', params: [] },
            },
          },
        ] as ReadonlyArray<unknown>,
        subTaskEdges: [],
      }),
      harness.createRun(jwtB, {
        workspaceSocketId: 'reference-workspace',
        promptMode: 'free_text',
        prompt: 'scope-B-warehouse',
        agents: [WAREHOUSE_AGENT_ACTOR_ID],
        subTasks: [
          {
            kind: 'nxs',
            subTaskKey: 'warehouse-leg',
            agentId: WAREHOUSE_AGENT_ACTOR_ID,
            taskSummary: 'warehouse pull',
            expectedOutputSlots: ['rows'],
            inputSlotReads: [],
            actionTemplate: {
              capability: 'read:record:bulk',
              target: { system: 'warehouse', resourceType: 'inventory', resourceScope: 'bulk' },
              rawPayload: { sql: 'SELECT sku FROM inventory LIMIT 1', params: [] },
            },
          },
        ] as ReadonlyArray<unknown>,
        subTaskEdges: [],
      }),
    ]);
    const [snapA, snapB] = await Promise.all([
      harness.waitForRunClosed(jwtA, runA.runId, { timeoutMs: 240_000 }),
      harness.waitForRunClosed(jwtB, runB.runId, { timeoutMs: 240_000 }),
    ]);

    // Both runs reach final_response — the compile-return delivery
    // didn't cross-deliver A's artifact to B or vice versa.
    expect(
      snapA.ledgerEvents.some(e => e.eventType === 'final_response'),
      'final_response landed in run A'
    ).toBe(true);
    expect(
      snapB.ledgerEvents.some(e => e.eventType === 'final_response'),
      'final_response landed in run B'
    ).toBe(true);

    // Delegation scope: every nxs_action in run A targeted sales-finance;
    // every nxs_action in run B targeted warehouse. No cross-system leak.
    const aTargets = snapA.ledgerEvents
      .filter(e => e.eventType === 'nxs_action')
      .map(e => {
        const d = e.detail as Record<string, unknown>;
        const nested = (d['resolvedTarget'] as { system?: string } | undefined)?.system;
        return (d['target'] ?? d['targetSystem'] ?? d['system'] ?? nested) as string | undefined;
      })
      .filter((s): s is string => s !== undefined);
    const bTargets = snapB.ledgerEvents
      .filter(e => e.eventType === 'nxs_action')
      .map(e => {
        const d = e.detail as Record<string, unknown>;
        const nested = (d['resolvedTarget'] as { system?: string } | undefined)?.system;
        return (d['target'] ?? d['targetSystem'] ?? d['system'] ?? nested) as string | undefined;
      })
      .filter((s): s is string => s !== undefined);
    expect(aTargets.length).toBeGreaterThan(0);
    expect(bTargets.length).toBeGreaterThan(0);
    for (const t of aTargets)
      expect(t, 'run A nxs_actions targeted sales-finance only').toBe('sales-finance');
    for (const t of bTargets)
      expect(t, 'run B nxs_actions targeted warehouse only').toBe('warehouse');

    // EXECUTED finalOutcome lands at least once per run (the runtime
    // actually executed both, not just classified them).
    const aExecuted = snapA.ledgerEvents.some(
      e =>
        e.eventType === 'nxs_action' &&
        (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    const bExecuted = snapB.ledgerEvents.some(
      e =>
        e.eventType === 'nxs_action' &&
        (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(aExecuted, 'run A nxs_action reached EXECUTED').toBe(true);
    expect(bExecuted, 'run B nxs_action reached EXECUTED').toBe(true);
  }, 360_000);
});
