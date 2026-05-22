/**
 * tests/e2e/11-rbac-differentials.e2e.test.ts — E2E v0.4.0 §3.11
 *
 * Category 11: RBAC / OCT denial differentials. Same prompt across
 * roles; lower ranks denied, higher ranks allowed. Each body submits
 * real requests through the production stack and asserts the
 * canonical denial event(s). Higher-role allowance legs that require
 * Gate 04/05 approval flows or revoke-mid-run admin endpoints submit
 * the catalog-named request and accept any honest production outcome
 * (approval requested, plan_rejected, or executed) — but never silent
 * success without governance events.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const WAREHOUSE_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000041';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';
const FRONTIER_ENDPOINT = 'openai-gpt';

interface RunSnap {
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}

function assertDeniedShape(snap: RunSnap, label: string): void {
  const types = snap.ledgerEvents.map(e => e.eventType);
  const driftEvents = snap.ledgerEvents.filter(
    e => e.eventType === 'delegation_empty_intersection'
  );
  const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
  const denied = nxsActions.some(e => {
    const fo = (e.detail as Record<string, unknown>)['finalOutcome'];
    return typeof fo === 'string' && fo !== FINAL_OUTCOME.EXECUTED;
  });
  expect(
    driftEvents.length > 0 || denied || types.includes('plan_rejected'),
    `${label} — must be denied (intersection / dispatch denial / plan_rejected)`
  ).toBe(true);

  const executed = nxsActions.filter(
    e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
  );
  expect(executed.length, `${label} — no EXECUTED nxs_action on a denied path`).toBe(0);
}

async function postNxs(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  capability: string,
  system: 'sales-finance' | 'warehouse' | 'gmail',
  resourceType: string,
  payload: Record<string, unknown>,
  agentId: string = SALES_AGENT_ACTOR_ID
): Promise<RunSnap> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt: `${role} attempts ${capability} on ${system}.`,
    agents: [agentId],
    subTasks: [
      {
        kind: 'nxs',
        subTaskKey: 'rbac-probe',
        agentId,
        taskSummary: `${role} ${capability}`,
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability,
          target: { system, resourceType, resourceScope: 'bulk' },
          rawPayload: payload,
        },
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  });
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
}

describe('E2E Category 11 — RBAC / OCT denial differentials', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-101-secret-data-access: janitor denied vs vp allowed', async () => {
    // Lower-role leg: janitor attempts a SECRET-tier read.
    const janitorSnap = await postNxs(
      harness,
      'janitor',
      'read:secret',
      'sales-finance',
      'customer_payment_tokens',
      { sql: 'SELECT token_id FROM customer_payment_tokens LIMIT 1', params: [] }
    );
    assertDeniedShape(janitorSnap, 'janitor SECRET read');

    // Higher-role leg: vp must reach EXECUTED on the SECRET-tier read.
    // Without an OCT-SECRET-classified resource seeded, the connector
    // path denies on missing table → fails honestly.
    const vpSnap = await postNxs(
      harness,
      'vp',
      'read:secret',
      'sales-finance',
      'customer_payment_tokens',
      { sql: 'SELECT token_id FROM customer_payment_tokens LIMIT 1', params: [] }
    );
    const vpNxs = vpSnap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    const vpExecuted = vpNxs.some(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(vpExecuted, 'vp SECRET read must reach EXECUTED on a seeded resource').toBe(true);
  }, 360_000);

  it('E2E-102-bulk-delete: analyst denied vs vp Gate 05 approval', async () => {
    const analystSnap = await postNxs(
      harness,
      'analyst',
      'delete:record:bulk',
      'sales-finance',
      'sales_orders',
      { sql: 'DELETE FROM sales_orders WHERE status = $1', params: ['cancelled'] }
    );
    assertDeniedShape(analystSnap, 'analyst bulk delete');

    const vpSnap = await postNxs(
      harness,
      'vp',
      'delete:record:bulk',
      'sales-finance',
      'sales_orders',
      { sql: 'DELETE FROM sales_orders WHERE status = $1', params: ['cancelled'] }
    );
    const vpTypes = vpSnap.ledgerEvents.map(e => e.eventType);
    const vpApprovalOrDenial =
      vpTypes.includes('gate_05_require_approval') ||
      vpTypes.includes('approval_requested') ||
      vpTypes.includes('plan_checkback_required') ||
      vpTypes.includes('plan_rejected') ||
      vpTypes.includes('delegation_empty_intersection');
    expect(vpApprovalOrDenial, 'vp bulk delete must surface approval or denial — no silent execution').toBe(
      true
    );
  }, 360_000);

  it('E2E-103-policy-override-attempt: manager+ceo both denied without SigningCouncil 2-of-2', async () => {
    const managerSnap = await postNxs(
      harness,
      'manager',
      'policy:override',
      'sales-finance',
      'policy_override',
      { reason: 'manual override attempt' }
    );
    assertDeniedShape(managerSnap, 'manager policy override');

    const ceoSnap = await postNxs(
      harness,
      'ceo',
      'policy:override',
      'sales-finance',
      'policy_override',
      { reason: 'manual override attempt' }
    );
    assertDeniedShape(ceoSnap, 'ceo policy override (without 2-of-2 council)');
  }, 360_000);

  it('E2E-104-cross-system-confidential: intern denied vs sr_analyst allowed', async () => {
    const internSnap = await postNxs(
      harness,
      'intern',
      'read:record:bulk',
      'warehouse',
      'inventory',
      { sql: 'SELECT sku FROM inventory LIMIT 1', params: [] }
    );
    assertDeniedShape(internSnap, 'intern cross-system OCT-CONFIDENTIAL');

    const srAnalystSnap = await postNxs(
      harness,
      'sr_analyst',
      'read:record:bulk',
      'warehouse',
      'inventory',
      { sql: 'SELECT sku FROM inventory LIMIT 1', params: [] }
    );
    const srAnalystNxs = srAnalystSnap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
    const srAnalystExecuted = srAnalystNxs.some(
      e => (e.detail as Record<string, unknown>)['finalOutcome'] === FINAL_OUTCOME.EXECUTED
    );
    expect(srAnalystExecuted, 'sr_analyst cross-system warehouse read must reach EXECUTED').toBe(
      true
    );
  }, 360_000);

  it('E2E-105-firewall-egress-denied-by-role: janitor → frontier denied at NVG', async () => {
    const jwt = await harness.jwtFor('janitor');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'janitor frontier egress probe.',
      agents: [CHAT_AGENT_ACTOR_ID],
      preferredEndpointId: FRONTIER_ENDPOINT,
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'janitor-frontier-probe',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'janitor frontier chat',
          taskPrompt: 'Search the web for the latest economic indicators.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    const denied =
      types.includes('firewall_egress_denied') ||
      types.includes('tier_ceiling_exceeded') ||
      types.includes('delegation_empty_intersection') ||
      types.includes('plan_rejected');
    expect(denied, 'janitor frontier egress must surface a denial').toBe(true);
  }, 300_000);

  it('E2E-106-bulk-pull-risk-ceiling: analyst → 10k row pull denied (medium < bulk:high)', async () => {
    const snap = await postNxs(
      harness,
      'analyst',
      'read:record:bulk',
      'sales-finance',
      'sales_orders',
      { sql: 'SELECT order_code FROM sales_orders LIMIT 10000', params: [] }
    );
    assertDeniedShape(snap, 'analyst 10k-row bulk pull');
  }, 300_000);

  it('E2E-107-chain-depth-ceiling: sr_analyst → chain > maxChainDepth denied', async () => {
    // Submit a 6-node sequential chain through reference-workspace.
    const jwt = await harness.jwtFor('sr_analyst');
    const subTasks = Array.from({ length: 6 }, (_, i) => ({
      kind: 'nvg' as const,
      subTaskKey: `chain-${i}`,
      agentId: CHAT_AGENT_ACTOR_ID,
      taskSummary: `chain stage ${i}`,
      taskPrompt: `Stage ${i}: continue the prior step.`,
      expectedOutputSlots: ['response'],
      inputSlotReads: [],
    }));
    const subTaskEdges = subTasks.slice(0, -1).map((t, i) => ({
      sourceSubTaskKey: t.subTaskKey,
      targetSubTaskKey: subTasks[i + 1]!.subTaskKey,
      edgeType: 'sequential' as const,
      conditionSpec: null,
      outputSlotRef: 'response',
    }));
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Chain depth exceeds ceiling.',
      agents: [CHAT_AGENT_ACTOR_ID],
      subTasks,
      subTaskEdges,
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 300_000 });
    const types = snap.ledgerEvents.map(e => e.eventType);
    const denied =
      types.includes('chain_depth_exceeded') ||
      types.includes('plan_rejected') ||
      types.includes('plan_checkback_required');
    expect(denied, 'sr_analyst over-depth chain must surface ceiling denial').toBe(true);
  }, 360_000);

  it('E2E-108-environment-mismatch: analyst dev → prod target denied', async () => {
    // The catalog row asks for an analyst in dev hitting a prod-tagged
    // connector. Today no env-tagged connectors are seeded, so the
    // request lands on the default seeded sales-finance connector.
    // The body still attempts the cross-environment hint; the test
    // accepts any honest production outcome including denial.
    const snap = await postNxs(
      harness,
      'analyst',
      'read:record:bulk',
      'sales-finance',
      'sales_orders',
      {
        sql: 'SELECT order_code FROM sales_orders LIMIT 1',
        params: [],
        environment: 'prod',
      }
    );
    const types = snap.ledgerEvents.map(e => e.eventType);
    // Production-shape: an env-mismatch request must EXPLICITLY deny —
    // a silent final_response that ignored the env hint is the gap.
    const denied =
      types.includes('environment_mismatch') ||
      types.includes('plan_rejected') ||
      types.includes('delegation_empty_intersection');
    expect(denied, 'env-mismatch request must surface a denial event').toBe(true);
  }, 240_000);

  it('E2E-109-external-facing-action: vp → Gate 04 approval flow', async () => {
    const snap = await postNxs(
      harness,
      'vp',
      'compose:email',
      'gmail',
      'message',
      {
        to: ['external@example.com'],
        subject: 'External communication',
        body: 'Body of external comms.',
      }
    );
    const types = snap.ledgerEvents.map(e => e.eventType);
    const surfaced =
      types.includes('gate_04_require_approval') ||
      types.includes('gate_05_require_approval') ||
      types.includes('approval_requested') ||
      types.includes('plan_checkback_required') ||
      types.includes('delegation_empty_intersection') ||
      types.includes('plan_rejected');
    expect(surfaced, 'vp external-action must surface approval or denial').toBe(true);
  }, 300_000);

  it('E2E-110-revoked-mid-run: sr_analyst → mid-run RBAC revoke → claim drift', async () => {
    // Open a long-ish run and attempt to call a revoke endpoint
    // mid-flight. The admin revoke endpoint does not exist today; the
    // probe asserts the run still closes with claim_drift_detected OR
    // closes normally without silent corruption of capability state.
    const jwt = await harness.jwtFor('sr_analyst');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Long warehouse read to allow mid-run revoke.',
      agents: [WAREHOUSE_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'long-warehouse-read',
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
    // Best-effort revoke probe — the route is expected to not exist
    // (the catalog row is the gap). The fetch result is observed but
    // does not gate the run's own assertion shape.
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
    // HL#14 production-shape: a mid-run revoke MUST emit
    // claim_drift_detected. The absence of an admin revoke endpoint
    // means the drift never fires today; the test fails honestly on
    // the missing event.
    expect(types, 'HL#14 — claim_drift_detected must fire on mid-run revoke').toContain(
      'claim_drift_detected'
    );
  }, 360_000);
});
