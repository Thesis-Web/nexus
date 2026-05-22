/**
 * tests/e2e/10-gmail.e2e.test.ts — E2E v0.4.0 §3.10
 *
 * Category 10: Gmail compose / read. The Gmail connector is not yet
 * wired (no connector adapter registered for `gmail` system). Bodies
 * submit real subTask DAGs targeting the gmail system through the
 * production stack; the path fails with connector-missing /
 * delegation-empty-intersection / unknown-action depending on which
 * gate hits first. Each test exercises the catalog-named flow without
 * faking connector behavior.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { bootHarness, type E2EHarness } from './harness.js';
import type { UserLadderRole } from '../../scripts/seeds/user-ladder-seeds.js';

const SALES_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000031';
const CHAT_AGENT_ACTOR_ID = '00000000-0000-4000-a000-000000000004';

interface RunSnap {
  runClosed: boolean;
  closeReason: string | null;
  ledgerEvents: ReadonlyArray<{ eventType: string; detail: Record<string, unknown> }>;
}

function assertGmailExecuted(snap: RunSnap): void {
  // Catalog expects the email action to actually fire. Without the
  // Gmail connector, no nxs_action with target='gmail' will reach
  // EXECUTED — this assertion surfaces that gap as honest red.
  const types = snap.ledgerEvents.map(e => e.eventType);
  expect(snap.runClosed, 'run closed').toBe(true);
  expect(snap.closeReason, 'gmail run closes completed').toBe('completed');
  expect(types, 'final_response event present').toContain('final_response');
  expect(
    snap.ledgerEvents.some(e => e.eventType === 'nxs_dispatch_bridge_returned_null'),
    'no bridge-null events'
  ).toBe(false);
  const nxsActions = snap.ledgerEvents.filter(e => e.eventType === 'nxs_action');
  const executedGmail = nxsActions.some(e => {
    const d = e.detail as Record<string, unknown>;
    const target = (d['target'] ?? d['targetSystem'] ?? d['system']) as string | undefined;
    return target === 'gmail' && d['finalOutcome'] === FINAL_OUTCOME.EXECUTED;
  });
  expect(executedGmail, 'gmail nxs_action must reach EXECUTED on a wired connector').toBe(true);
}

async function attemptGmailSend(
  harness: E2EHarness,
  role: UserLadderRole | 'dev-admin',
  prompt: string,
  capability: 'compose:email' | 'read:email',
  payload: Record<string, unknown>
): Promise<RunSnap> {
  const jwt = await harness.jwtFor(role);
  const { runId } = await harness.createRun(jwt, {
    workspaceSocketId: 'reference-workspace',
    promptMode: 'free_text',
    prompt,
    agents: [SALES_AGENT_ACTOR_ID],
    subTasks: [
      {
        kind: 'nxs',
        subTaskKey: 'gmail-action',
        agentId: SALES_AGENT_ACTOR_ID,
        taskSummary: capability === 'compose:email' ? 'compose email' : 'read inbox',
        expectedOutputSlots: ['rows'],
        inputSlotReads: [],
        actionTemplate: {
          capability,
          target: { system: 'gmail', resourceType: 'message', resourceScope: 'single' },
          rawPayload: payload,
        },
      },
    ] as ReadonlyArray<unknown>,
    subTaskEdges: [],
  });
  return harness.waitForRunClosed(jwt, runId, { timeoutMs: 180_000 });
}

describe('E2E Category 10 — Gmail compose / read', () => {
  let harness: E2EHarness;

  beforeAll(async () => {
    harness = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (harness) await harness.shutdown();
  });

  it('E2E-91-gmail-compose-draft: sr_manager → draft to ops@ about Q2', async () => {
    const snap = await attemptGmailSend(harness, 'sr_manager', 'Draft an email to ops about Q2.', 'compose:email', {
      to: ['ops@example.com'],
      subject: 'Q2 sales summary',
      body: 'Body text for the Q2 summary.',
      isDraft: true,
    });
    assertGmailExecuted(snap);
  }, 240_000);

  it('E2E-92-gmail-read-inbox: sr_manager → last 10 inbox threads', async () => {
    const snap = await attemptGmailSend(harness, 'sr_manager', 'Read last 10 inbox threads.', 'read:email', {
      mailbox: 'INBOX',
      max: 10,
    });
    assertGmailExecuted(snap);
  }, 240_000);

  it('E2E-93-gmail-compose-from-batch: director → customer follow-ups for order issues', async () => {
    const jwt = await harness.jwtFor('director');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Compose follow-up emails from order issues.',
      agents: [SALES_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'pull-issues',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'pull issue orders',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:record:bulk',
            target: { system: 'sales-finance', resourceType: 'sales_orders', resourceScope: 'bulk' },
            rawPayload: {
              sql: "SELECT order_code, customer_code FROM sales_orders WHERE status IN ('cancelled', 'pending') LIMIT 10",
              params: [],
            },
          },
        },
        {
          kind: 'nxs',
          subTaskKey: 'send-followup',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'send followup email',
          expectedOutputSlots: ['sent'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'compose:email',
            target: { system: 'gmail', resourceType: 'message', resourceScope: 'single' },
            rawPayload: {
              to: ['customer@example.com'],
              subject: 'Order follow-up',
              body: 'Body of the customer follow-up.',
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertGmailExecuted(snap);
  }, 300_000);

  it('E2E-94-gmail-compose-multi-recipient: vp → board update to 5 recipients', async () => {
    const snap = await attemptGmailSend(
      harness,
      'vp',
      'Compose board update to 5 recipients.',
      'compose:email',
      {
        to: [
          'a@example.com',
          'b@example.com',
          'c@example.com',
          'd@example.com',
          'e@example.com',
        ],
        subject: 'Board update Q2',
        body: 'Body of the board update.',
      }
    );
    assertGmailExecuted(snap);
  }, 240_000);

  it('E2E-95-gmail-read-classify: director → classify inbox by topic', async () => {
    const jwt = await harness.jwtFor('director');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Read inbox and classify by topic.',
      agents: [SALES_AGENT_ACTOR_ID, CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nxs',
          subTaskKey: 'read-inbox',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'read inbox',
          expectedOutputSlots: ['rows'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'read:email',
            target: { system: 'gmail', resourceType: 'message', resourceScope: 'bulk' },
            rawPayload: { mailbox: 'INBOX', max: 20 },
          },
        },
        {
          kind: 'nvg',
          subTaskKey: 'classify',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'classify by topic',
          taskPrompt: 'Classify each inbox item by topic.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertGmailExecuted(snap);
  }, 300_000);

  it('E2E-96-gmail-search: sr_manager → emails containing "invoice" last 30 days', async () => {
    const snap = await attemptGmailSend(
      harness,
      'sr_manager',
      'Search inbox for invoice over last 30 days.',
      'read:email',
      { query: 'invoice newer_than:30d', max: 25 }
    );
    assertGmailExecuted(snap);
  }, 240_000);

  it('E2E-97-gmail-compose-with-attachment: director → email referencing sales PDF', async () => {
    const snap = await attemptGmailSend(
      harness,
      'director',
      'Email referencing sales PDF attachment.',
      'compose:email',
      {
        to: ['recipient@example.com'],
        subject: 'Sales PDF',
        body: 'See attached sales PDF.',
        attachments: [{ filename: 'sales.pdf', mimeType: 'application/pdf' }],
      }
    );
    assertGmailExecuted(snap);
  }, 240_000);

  it('E2E-98-gmail-denied-low-clearance: intern lacks compose:email → Gate 03 denied', async () => {
    const snap = await attemptGmailSend(
      harness,
      'intern',
      'Intern attempts to compose email — must be denied.',
      'compose:email',
      {
        to: ['anyone@example.com'],
        subject: 'Subject',
        body: 'Body',
      }
    );
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
      'intern compose:email must be denied (capability outside intersection)'
    ).toBe(true);
  }, 240_000);

  it('E2E-99-gmail-compose-secure-data-denied: analyst → email OCT-CONFIDENTIAL → NVG denied', async () => {
    const snap = await attemptGmailSend(
      harness,
      'analyst',
      'analyst attempting to email OCT-CONFIDENTIAL data — must be denied.',
      'compose:email',
      {
        to: ['external@example.com'],
        subject: 'Confidential',
        body: 'OCT-CONFIDENTIAL contents',
        octLevel: 'OCT-CONFIDENTIAL',
      }
    );
    const types = snap.ledgerEvents.map(e => e.eventType);
    const denied =
      types.includes('oct_ceiling_exceeded') ||
      types.includes('firewall_egress_denied') ||
      types.includes('delegation_empty_intersection') ||
      types.includes('plan_rejected');
    expect(denied, 'analyst OCT-CONFIDENTIAL outbound must surface a denial').toBe(true);
  }, 240_000);

  it('E2E-100-gmail-multi-step-research-then-compose: ceo → research + classify + compose', async () => {
    const jwt = await harness.jwtFor('ceo');
    const { runId } = await harness.createRun(jwt, {
      workspaceSocketId: 'reference-workspace',
      promptMode: 'free_text',
      prompt: 'Research, classify, then compose follow-up email.',
      agents: [SALES_AGENT_ACTOR_ID, CHAT_AGENT_ACTOR_ID],
      subTasks: [
        {
          kind: 'nvg',
          subTaskKey: 'research',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'research',
          taskPrompt: 'Outline three relevant industry trends.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nvg',
          subTaskKey: 'classify',
          agentId: CHAT_AGENT_ACTOR_ID,
          taskSummary: 'classify',
          taskPrompt: 'Classify each trend by impact.',
          expectedOutputSlots: ['response'],
          inputSlotReads: [],
        },
        {
          kind: 'nxs',
          subTaskKey: 'compose',
          agentId: SALES_AGENT_ACTOR_ID,
          taskSummary: 'compose summary email',
          expectedOutputSlots: ['sent'],
          inputSlotReads: [],
          actionTemplate: {
            capability: 'compose:email',
            target: { system: 'gmail', resourceType: 'message', resourceScope: 'single' },
            rawPayload: {
              to: ['board@example.com'],
              subject: 'Quarterly trend brief',
              body: 'Summary of the three trends.',
            },
          },
        },
      ] as ReadonlyArray<unknown>,
      subTaskEdges: [],
    });
    const snap = await harness.waitForRunClosed(jwt, runId, { timeoutMs: 240_000 });
    assertGmailExecuted(snap);
  }, 300_000);
});
