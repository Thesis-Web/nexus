/**
 * AMEND-nexus-planner-chat-tier-v0-2-0.md §3.6 (Arc 1 fixup) — chat-tier
 * HTTP route integration test.
 *
 * Closes the audit gap left after Commits 1–5: the chat workspace was
 * fully built end-to-end at planner / loader / writer / UI levels, but
 * the route at workspace.ts always picked the first enabled workspace
 * via `find(ws => ws.enabled)` and the request schema had no field for
 * workspace selection. Real HTTP traffic could not reach the seeded
 * `nexus-chat-default` workspace.
 *
 * This test stands up the live Express route with two enabled workspaces
 * (governed first, chat second), drives real auth via the
 * /workspace/auth/login endpoint, and asserts that:
 *
 *   ROUTE-CHAT-01: POST /workspace/runs WITHOUT workspaceSocketId →
 *     route falls back to the first-enabled workspace (governed) →
 *     dispatched WorkspaceRunRequest carries the governed socketId →
 *     buildPlannerRequestForWorkspace derives tier 'normal'.
 *
 *   ROUTE-CHAT-02: POST /workspace/runs WITH workspaceSocketId =
 *     'nexus-chat-default' → dispatched WorkspaceRunRequest carries the
 *     chat socketId → buildPlannerRequestForWorkspace derives tier 'chat'.
 *
 *   ROUTE-CHAT-03: POST with bogus workspaceSocketId → HTTP 400 (NOT
 *     503 — distinguishing client error from server-config error).
 *
 *   ROUTE-CHAT-04: POST with disabled workspaceSocketId → HTTP 400.
 *
 *   ROUTE-CHAT-05: POST with chat workspace + selectedAgentIds.length !== 1
 *     → HTTP 400 (cardinality enforced before run_opened).
 *
 * Only the orchestrator dispatch is captured; the planner / mailbox /
 * compile chain is exercised by the unit + planner-integration suites.
 * The point here is to PROVE the route → orchestrator boundary works
 * end-to-end against a real Express server with two enabled workspaces.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { registerWorkspaceRoutes } from '../../packages/interfaces/api/src/routes/workspace.js';
import { buildPlannerRequestForWorkspace } from '../../packages/orch-ref/src/planner-request-builder.js';
import { nowIso } from '../../packages/contracts/src/utils/time.js';
import type {
  AuthCredentials,
  IdentityClaims,
  IdentityProviderInterface,
  NonEmpty,
  RunLedgerEntry,
  RunLedgerWriter,
  Sha256Hex,
  Uuid,
  WorkspaceManifestRecord,
  WorkspaceRunRequest,
  WorkspaceSession,
  WorkspaceSessionStorePort,
} from '@nexus/contracts';

const TEST_JWT_SECRET = 'chat-route-integration-test-secret';
const TEST_PRINCIPAL = '11111111-1111-1111-1111-111111111111';
const TEST_ACTOR = '22222222-2222-2222-2222-222222222222' as Uuid;
const CHAT_AGENT_ID = '00000000-0000-4000-a000-000000000004' as Uuid;

const GOVERNED_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'reference-workspace' as NonEmpty,
  workspaceType: 'reference_http' as NonEmpty,
  enabled: true,
  entryMode: 'governed_only',
  baseUrl: 'http://localhost:4100' as NonEmpty,
  returnEndpointId: 'reference-workspace-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: true, finalDisplay: true, fileSpace: false },
  configuration: {},
};

const CHAT_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'nexus-chat-default' as NonEmpty,
  workspaceType: 'chat_workspace' as NonEmpty,
  enabled: true,
  entryMode: 'free_chat',
  baseUrl: 'http://localhost:4100/chat' as NonEmpty,
  returnEndpointId: 'reference-workspace-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: false, finalDisplay: true, fileSpace: false },
  configuration: { defaultChatAgentId: CHAT_AGENT_ID },
};

const DISABLED_WORKSPACE: WorkspaceManifestRecord = {
  workspaceSocketId: 'disabled-workspace' as NonEmpty,
  workspaceType: 'reference_http' as NonEmpty,
  enabled: false,
  entryMode: 'governed_only',
  baseUrl: 'http://localhost:4100/disabled' as NonEmpty,
  returnEndpointId: 'reference-workspace-return' as NonEmpty,
  capabilities: { promptEntry: true, planReview: true, finalDisplay: true, fileSpace: false },
  configuration: {},
};

function inMemorySessionStore(): WorkspaceSessionStorePort {
  const sessions = new Map<string, WorkspaceSession>();
  return {
    create: session => {
      sessions.set(session.workspaceAuthSessionId, session);
    },
    get: sid => sessions.get(sid) ?? null,
    revoke: sid => {
      sessions.delete(sid);
    },
  };
}

function ledgerWriter(): RunLedgerWriter & { events: Array<Omit<RunLedgerEntry, 'entryId'>> } {
  const events: Array<Omit<RunLedgerEntry, 'entryId'>> = [];
  return {
    events,
    writeEvent: async entry => {
      events.push(entry);
    },
    getByRunId: async () => [],
    tail: async () => [],
    getLatestRunId: async () => null,
  };
}

function identityProvider(): IdentityProviderInterface {
  return {
    providerType: 'reference_adapter',
    providerVersion: '1.0.0' as NonEmpty,
    authenticate: async (_: AuthCredentials) => TEST_ACTOR as NonEmpty,
    resolveIdentity: async (): Promise<IdentityClaims> => ({
      principalIdentity: TEST_PRINCIPAL as NonEmpty,
      roleAssignments: ['user'] as NonEmpty[],
      capabilityCeilings: [
        { allowedSystems: ['*'], allowedCapabilities: ['*'], maxRiskTier: 'critical' },
      ],
      environmentContext: 'reference' as NonEmpty,
      actorClass: 'HUMAN',
    }),
  };
}

function computeDigest(obj: unknown): Sha256Hex {
  // Stable JSON for the test — production uses canonicalize from
  // @nexus/runtime-utils, but the route never inspects the digest value
  // beyond storing it in the ledger entry, so any deterministic hash
  // works here.
  return createHash('sha256').update(JSON.stringify(obj), 'utf-8').digest('hex') as Sha256Hex;
}

interface Harness {
  baseUrl: string;
  token: string;
  capturedDispatches: WorkspaceRunRequest[];
  ledger: ReturnType<typeof ledgerWriter>;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const capturedDispatches: WorkspaceRunRequest[] = [];
  const ledger = ledgerWriter();

  registerWorkspaceRoutes(app, {
    runLedgerWriter: ledger,
    identityProvider: identityProvider(),
    workspaceSockets: [GOVERNED_WORKSPACE, CHAT_WORKSPACE, DISABLED_WORKSPACE],
    computeDigest,
    workspaceJwtSecret: TEST_JWT_SECRET,
    workspaceSessionStore: inMemorySessionStore(),
    dispatchToOrchestrator: async (request: WorkspaceRunRequest) => {
      capturedDispatches.push(request);
      return null;
    },
  });

  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Real /workspace/auth/login → real JWT.
  const loginRes = await fetch(`${baseUrl}/workspace/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'api_key', value: 'integration-test-key' }),
  });
  const loginBody = (await loginRes.json()) as { ok: boolean; data?: { token: string } };
  if (!loginBody.ok || !loginBody.data) {
    throw new Error(`login failed: ${JSON.stringify(loginBody)}`);
  }
  const token = loginBody.data.token;

  return {
    baseUrl,
    token,
    capturedDispatches,
    ledger,
    close: () =>
      new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  if (harness) await harness.close();
});

async function postRun(body: Record<string, unknown>): Promise<{
  status: number;
  json: { ok: boolean; data?: { runId: string }; error?: string };
}> {
  const res = await fetch(`${harness.baseUrl}/workspace/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${harness.token}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok: boolean;
    data?: { runId: string };
    error?: string;
  };
  return { status: res.status, json };
}

describe('ROUTE-CHAT-01: workspaceSocketId omitted → first-enabled fallback', () => {
  it('routes to the governed workspace and derives tier "normal"', async () => {
    const before = harness.capturedDispatches.length;
    const { status, json } = await postRun({
      promptMode: 'free_text',
      prompt: 'Run something governed',
      agents: [CHAT_AGENT_ID],
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(harness.capturedDispatches.length).toBe(before + 1);

    const captured = harness.capturedDispatches[before]!;
    expect(captured.workspaceSocketId).toBe('reference-workspace');

    const derived = buildPlannerRequestForWorkspace({
      request: captured,
      workspace: GOVERNED_WORKSPACE,
      nowIso: () => nowIso(),
    });
    expect(derived.tier).toBe('normal');
  });
});

describe('ROUTE-CHAT-02: workspaceSocketId targets nexus-chat-default → tier "chat"', () => {
  it('routes to the chat workspace and derives tier "chat"', async () => {
    const before = harness.capturedDispatches.length;
    const { status, json } = await postRun({
      promptMode: 'free_text',
      prompt: 'Hello chat',
      agents: [CHAT_AGENT_ID],
      workspaceSocketId: 'nexus-chat-default',
    });

    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(harness.capturedDispatches.length).toBe(before + 1);

    const captured = harness.capturedDispatches[before]!;
    expect(captured.workspaceSocketId).toBe('nexus-chat-default');

    const derived = buildPlannerRequestForWorkspace({
      request: captured,
      workspace: CHAT_WORKSPACE,
      nowIso: () => nowIso(),
    });
    expect(derived.tier).toBe('chat');
    if (derived.tier !== 'chat') return;
    expect(derived.selectedAgentIds).toEqual([CHAT_AGENT_ID]);
    expect(derived.workspaceSocketId).toBe('nexus-chat-default');
  });
});

describe('ROUTE-CHAT-03: bogus workspaceSocketId → HTTP 400', () => {
  it('rejects an unknown workspaceSocketId without writing run_opened', async () => {
    const ledgerBefore = harness.ledger.events.length;
    const dispatchBefore = harness.capturedDispatches.length;

    const { status, json } = await postRun({
      promptMode: 'free_text',
      prompt: 'should not run',
      agents: [CHAT_AGENT_ID],
      workspaceSocketId: 'no-such-workspace',
    });

    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error ?? '').toContain('Unknown workspaceSocketId');
    expect(harness.ledger.events.length).toBe(ledgerBefore);
    expect(harness.capturedDispatches.length).toBe(dispatchBefore);
  });
});

describe('ROUTE-CHAT-04: disabled workspaceSocketId → HTTP 400', () => {
  it('rejects a disabled workspaceSocketId without writing run_opened', async () => {
    const ledgerBefore = harness.ledger.events.length;
    const dispatchBefore = harness.capturedDispatches.length;

    const { status, json } = await postRun({
      promptMode: 'free_text',
      prompt: 'should not run',
      agents: [CHAT_AGENT_ID],
      workspaceSocketId: 'disabled-workspace',
    });

    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error ?? '').toContain('disabled');
    expect(harness.ledger.events.length).toBe(ledgerBefore);
    expect(harness.capturedDispatches.length).toBe(dispatchBefore);
  });
});

describe('ROUTE-CHAT-CATALOG: GET /workspace/catalogs/workspaces surfaces enabled entries', () => {
  it('returns only enabled workspaces as CatalogItem[] with selectable=true', async () => {
    const res = await fetch(`${harness.baseUrl}/workspace/catalogs/workspaces`, {
      headers: { Authorization: `Bearer ${harness.token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: Array<{
        id: string;
        name: string;
        description: string;
        visible: boolean;
        selectable: boolean;
      }>;
    };
    expect(json.ok).toBe(true);
    const ids = json.data.map(item => item.id).sort();
    // harness wires three workspace records; the disabled one MUST be omitted.
    expect(ids).toEqual(['nexus-chat-default', 'reference-workspace']);
    for (const item of json.data) {
      expect(item.visible).toBe(true);
      expect(item.selectable).toBe(true);
      expect(item.description).toMatch(/entryMode:/);
    }
    const chat = json.data.find(i => i.id === 'nexus-chat-default');
    expect(chat?.description).toContain('free_chat');
    const gov = json.data.find(i => i.id === 'reference-workspace');
    expect(gov?.description).toContain('governed_only');
  });
});

describe('ROUTE-CHAT-05: chat workspace + wrong cardinality → HTTP 400', () => {
  it('rejects free_chat selectedAgentIds.length !== 1 before any ledger write', async () => {
    const ledgerBefore = harness.ledger.events.length;
    const dispatchBefore = harness.capturedDispatches.length;

    const { status, json } = await postRun({
      promptMode: 'free_text',
      prompt: 'too many agents',
      agents: [CHAT_AGENT_ID, '00000000-0000-4000-a000-000000000041'],
      workspaceSocketId: 'nexus-chat-default',
    });

    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.error ?? '').toContain('exactly one selectedAgentId');
    expect(harness.ledger.events.length).toBe(ledgerBefore);
    expect(harness.capturedDispatches.length).toBe(dispatchBefore);
  });
});
