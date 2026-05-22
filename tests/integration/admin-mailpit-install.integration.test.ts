/**
 * admin-mailpit-install.integration.test.ts
 *
 * End-to-end proof that the Mailpit connector can be installed, probed,
 * exercised, and deleted THROUGH THE ADMIN DASHBOARD HTTP API — exactly
 * the path an admin operator would walk. No direct source editing of
 * connectors.v1.yaml; every state transition goes through the real
 * admin-writer routes.
 *
 * Requires the local Mailpit substrate to be reachable at the
 * configured ports:
 *   - SMTP : 127.0.0.1:${MAILPIT_SMTP_PORT  || 1025}
 *   - API  : http://127.0.0.1:${MAILPIT_HTTP_PORT || 8025}
 *
 * That substrate is provided by the `nexus-lab-test-bed` repo at
 * https://github.com/Thesis-Web/nexus-lab-test-bed (run `pnpm lab:up`
 * there to start it). The test SKIPS if Mailpit is not reachable —
 * it never invents fake state.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import * as net from 'node:net';
import { registerAdminWriterRoutes } from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type {
  ManifestWriter,
  ConnectorProbeHandler,
  ConnectorTestResult,
} from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type {
  IdentityClaims,
  ElevatedAuthProvider,
  ElevatedSession,
  ElevatedSessionStatus,
  ElevatedAuthChallengeRequest,
  ElevatedAuthChallenge,
  ElevatedAuthVerifyRequest,
  AdminMutationVerifierPort,
  AdminMutationServerSignerPort,
  RunLedgerWriter,
  RunLedgerEntry,
  IsoTimestamp,
  Sha256Hex,
  Uuid,
  NonEmpty,
  DataClass,
} from '../../packages/contracts/src/index.js';
import { InMemoryInfraRunIdNamespace } from '../../packages/core/src/infra/infra-run-id-namespace.js';
import { InMemoryAdminMutationNonceStore } from '../../packages/interfaces/api/src/middleware/signed-admin-mutation.js';
import {
  buildMailpitConnector,
  mailpitConfigFromManifestRecord,
} from '../../packages/connectors/mailpit/mailpit.connector.js';

// ── Mailpit reachability gate (skip test if substrate down) ───────────────
const SMTP_PORT = Number(process.env['MAILPIT_SMTP_PORT'] ?? 1025);
const HTTP_PORT = Number(process.env['MAILPIT_HTTP_PORT'] ?? 8025);

async function probeMailpit(): Promise<boolean> {
  const tcpOk = await new Promise<boolean>(resolve => {
    const sock = net.createConnection({ host: '127.0.0.1', port: SMTP_PORT });
    sock.setTimeout(1500);
    sock.once('connect', () => {
      sock.end();
      resolve(true);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('error', () => resolve(false));
  });
  if (!tcpOk) return false;
  try {
    const resp = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/v1/info`, {
      signal: AbortSignal.timeout(1500),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Minimal fakes (mirror tests/api/admin-writer.test.ts) ─────────────────
const ADMIN_PID = '22222222-2222-2222-2222-222222222222';
const ADMIN_AID = '33333333-3333-3333-3333-333333333333';
const VALID_ELEV = '11111111-1111-1111-1111-111111111111';

function fakeJwtMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.header('X-Test-Identity');
  if (raw === undefined) {
    next();
    return;
  }
  const parsed = JSON.parse(raw) as {
    kind: 'admin' | 'plain' | 'none';
    principalId: string;
    actorId: string;
  };
  if (parsed.kind === 'none') {
    next();
    return;
  }
  const roleAssignments: NonEmpty[] =
    parsed.kind === 'admin' ? (['nexus-admin'] as NonEmpty[]) : (['user'] as NonEmpty[]);
  const claims: IdentityClaims = {
    principalIdentity: ('Test:' + parsed.principalId) as NonEmpty,
    roleAssignments,
    capabilityCeilings: [
      {
        allowedSystems: ['*'],
        allowedCapabilities: ['*'],
        maxRiskTier: 'critical',
      },
    ],
    environmentContext: 'reference' as NonEmpty,
    actorClass: 'HUMAN',
  };
  res.locals['claims'] = claims;
  res.locals['principalId'] = parsed.principalId;
  res.locals['actorId'] = parsed.actorId;
  next();
}

const mockElevatedAuth: ElevatedAuthProvider = {
  challenge: async (_req: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge> => {
    throw new Error('not used in this test');
  },
  verify: async (_req: ElevatedAuthVerifyRequest): Promise<ElevatedSession> => {
    throw new Error('not used in this test');
  },
  validateSession: async (sessionId: Uuid, principalId: string): Promise<ElevatedSessionStatus> => {
    if ((sessionId as string) === VALID_ELEV && principalId === ADMIN_PID) {
      return { valid: true, remainingSeconds: 600 };
    }
    return { valid: false, remainingSeconds: 0, reason: 'mock-rejected' as NonEmpty };
  },
};

function createInMemoryManifestWriter(): ManifestWriter & {
  _store: Map<string, Record<string, unknown>[]>;
} {
  const store = new Map<string, Record<string, unknown>[]>();
  const key = (path: string, arrayKey: string): string => `${path}::${arrayKey}`;
  return {
    _store: store,
    async readEntries(path, arrayKey) {
      return [...(store.get(key(path, arrayKey)) ?? [])];
    },
    async addEntry(path, arrayKey, entry, idKey) {
      const k = key(path, arrayKey);
      const list = [...(store.get(k) ?? [])];
      if (list.some(e => e[idKey] === entry[idKey])) {
        throw Object.assign(new Error(`duplicate ${idKey}=${entry[idKey]}`), {
          statusCode: 409,
        });
      }
      list.push(entry);
      store.set(k, list);
    },
    async updateEntry(path, arrayKey, id, patch, idKey) {
      const k = key(path, arrayKey);
      const list = [...(store.get(k) ?? [])];
      const idx = list.findIndex(e => e[idKey] === id);
      if (idx < 0) {
        throw Object.assign(new Error(`${idKey}=${id} not found`), { statusCode: 404 });
      }
      const before = list[idx] ?? {};
      list[idx] = { ...before, ...patch };
      store.set(k, list);
    },
    async removeEntry(path, arrayKey, id, idKey) {
      const k = key(path, arrayKey);
      const list = (store.get(k) ?? []).filter(e => e[idKey] !== id);
      store.set(k, list);
    },
  };
}

function createInMemoryRunLedgerWriter(): RunLedgerWriter & {
  _entries: Array<Omit<RunLedgerEntry, 'entryId'>>;
} {
  const entries: Array<Omit<RunLedgerEntry, 'entryId'>> = [];
  return {
    _entries: entries,
    async writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
      entries.push(entry);
    },
    async getByRunId(): Promise<RunLedgerEntry[]> {
      return [];
    },
    async tail(): Promise<RunLedgerEntry[]> {
      return [];
    },
    async getLatestRunId(): Promise<Uuid | null> {
      return null;
    },
  };
}

const passThroughVerifier: AdminMutationVerifierPort = {
  async verify(envelope) {
    return {
      ok: true,
      opener: envelope.opener,
      payloadDigest: 'fixture-digest',
      signatureRef: 'fixture-sigref',
    };
  },
};

function makeFixtureSigner(adminPrincipalId: string): AdminMutationServerSignerPort {
  return {
    async sign<TPayload>(args: {
      opener: NonEmpty;
      mutationKind: import('@nexus/contracts').AdminMutationKind;
      payload: TPayload;
      issuedAt: string;
      nonce: NonEmpty;
    }): Promise<import('@nexus/contracts').SignedAdminMutation<TPayload>> {
      return {
        mutationKind: args.mutationKind,
        payload: args.payload,
        opener: adminPrincipalId as NonEmpty,
        issuedAt: args.issuedAt as never,
        nonce: args.nonce,
        signature: 'fixture-sig' as never,
      };
    },
  };
}

function adminHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Test-Identity': JSON.stringify({
      kind: 'admin',
      principalId: ADMIN_PID,
      actorId: ADMIN_AID,
    }),
    'X-Elevated-Session': VALID_ELEV,
  };
}

// ── Real Mailpit probe handler — same wiring as composition root ──────────
function buildMailpitProbeHandler(payloadsRoot: string): ConnectorProbeHandler {
  return {
    probe: async record => {
      const systemTypeRaw = record.configuration['systemType'];
      const systemType =
        typeof systemTypeRaw === 'string' && systemTypeRaw.length > 0
          ? (systemTypeRaw as NonEmpty)
          : (record.connectorId as NonEmpty);
      const cfg = mailpitConfigFromManifestRecord(record, {
        systemType,
        dataClass: record.dataClass as DataClass,
        payloadsRoot,
      });
      const c = buildMailpitConnector(cfg);
      const r = await c.probe();
      return {
        probedAt: new Date().toISOString(),
        connectorId: record.connectorId,
        connectorType: record.connectorType,
        healthy: r.healthy,
        detail: { smtp: r.smtp, api: r.api },
      };
    },
    testConnection: async record => {
      const systemTypeRaw = record.configuration['systemType'];
      const systemType =
        typeof systemTypeRaw === 'string' && systemTypeRaw.length > 0
          ? (systemTypeRaw as NonEmpty)
          : (record.connectorId as NonEmpty);
      const cfg = mailpitConfigFromManifestRecord(record, {
        systemType,
        dataClass: record.dataClass as DataClass,
        payloadsRoot,
      });
      const c = buildMailpitConnector(cfg);
      const r = await c.testConnection({ runId: record.runId });
      const out: ConnectorTestResult = {
        probedAt: new Date().toISOString(),
        connectorId: record.connectorId,
        connectorType: record.connectorType,
        ok: r.ok,
        runId: r.runId,
        detail: { sent: r.sent, retrieved: r.retrieved, durationMs: r.durationMs },
        ...(r.error !== undefined ? { error: r.error } : {}),
      };
      return out;
    },
  };
}

// ── Composed app fixture ─────────────────────────────────────────────────
function buildApp(): {
  app: Express;
  manifestWriter: ReturnType<typeof createInMemoryManifestWriter>;
} {
  const app = express();
  app.use(express.json());
  app.use('/workspace', fakeJwtMiddleware);
  const manifestWriter = createInMemoryManifestWriter();
  const runLedgerWriter = createInMemoryRunLedgerWriter();
  const probeHandlers = new Map<string, ConnectorProbeHandler>();
  probeHandlers.set('mailpit', buildMailpitProbeHandler('/tmp/nexus-admin-probe-payloads'));
  registerAdminWriterRoutes(app, {
    elevatedAuthProvider: mockElevatedAuth,
    manifestWriter,
    runLedgerWriter,
    infraRunIdNamespace: new InMemoryInfraRunIdNamespace(),
    adminMutationVerifier: passThroughVerifier,
    adminMutationNonceStore: new InMemoryAdminMutationNonceStore(),
    adminMutationServerSigner: makeFixtureSigner(ADMIN_PID),
    connectorProbeHandlers: probeHandlers,
  });
  return { app, manifestWriter };
}

describe('admin Mailpit install — end-to-end through admin dashboard HTTP API', () => {
  let server: Server;
  let port: number;
  let mailpitUp = false;
  let manifestWriter: ReturnType<typeof createInMemoryManifestWriter>;

  beforeAll(async () => {
    mailpitUp = await probeMailpit();
    const fixture = buildApp();
    manifestWriter = fixture.manifestWriter;
    const started = await new Promise<{ server: Server; port: number }>(resolve => {
      const s = fixture.app.listen(0, '127.0.0.1', () => {
        const addr = s.address() as AddressInfo;
        resolve({ server: s, port: addr.port });
      });
    });
    server = started.server;
    port = started.port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    manifestWriter._store.clear();
  });

  const url = (p: string): string => `http://127.0.0.1:${port}${p}`;

  const mailpitInstallPayload = (overrides: Record<string, unknown> = {}) => ({
    connectorId: 'mailpit-local',
    connectorType: 'mailpit',
    allowedSystems: ['mailpit-local'],
    enabled: true,
    configuration: {
      systemType: 'mailpit-local',
      displayLabel: 'Mailpit (local lab)',
      smtpHost: '127.0.0.1',
      smtpPort: SMTP_PORT,
      apiBaseUrl: `http://127.0.0.1:${HTTP_PORT}`,
      tlsMode: 'none',
      authMode: 'none',
      allowedSenders: ['admin@nexlabco.test', 'notifications@nexlabco.test'],
      allowedRecipients: ['support@nexlabco.test', 'owner@nexlabco.test'],
      allowedDomains: ['nexlabco.test'],
      queryLimit: 50,
      ...overrides,
    },
  });

  it('install → probe → test-connection → disable → delete (full lifecycle)', async () => {
    if (!mailpitUp) {
      console.log(
        `[skip] Mailpit not reachable at 127.0.0.1:${SMTP_PORT}/127.0.0.1:${HTTP_PORT}. ` +
          'Run pnpm lab:up in the nexus-lab-test-bed repo.'
      );
      return;
    }

    // 1. INSTALL — POST creates a Mailpit connector through the dashboard route.
    const create = await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(mailpitInstallPayload()),
    });
    expect(create.status).toBe(200);
    const createBody = (await create.json()) as { ok: boolean; data?: Record<string, unknown> };
    expect(createBody.ok).toBe(true);
    expect(createBody.data?.['connectorId']).toBe('mailpit-local');
    expect(createBody.data?.['requiresRestart']).toBe(true);

    // 2. PROBE — TCP SMTP + HTTP API /info against real Mailpit.
    const probe = await fetch(url('/workspace/admin/setup/connectors/mailpit-local/probe'), {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect(probe.status).toBe(200);
    const probeBody = (await probe.json()) as {
      ok: boolean;
      data: {
        healthy: boolean;
        detail: { smtp: { reachable: boolean }; api: { reachable: boolean; version?: string } };
      };
    };
    expect(probeBody.ok).toBe(true);
    expect(probeBody.data.healthy).toBe(true);
    expect(probeBody.data.detail.smtp.reachable).toBe(true);
    expect(probeBody.data.detail.api.reachable).toBe(true);
    expect(typeof probeBody.data.detail.api.version).toBe('string');

    // 3. TEST CONNECTION — real SMTP send + Mailpit API roundtrip.
    const test = await fetch(
      url('/workspace/admin/setup/connectors/mailpit-local/test-connection'),
      {
        method: 'POST',
        headers: adminHeaders(),
      }
    );
    expect(test.status).toBe(200);
    const testBody = (await test.json()) as {
      ok: boolean;
      data: {
        ok: boolean;
        runId: string;
        detail: {
          sent: { from: string; to: string; subject: string };
          retrieved: { id: string; from: string; to: string[]; subject: string } | null;
        };
        error?: string;
      };
    };
    expect(testBody.ok).toBe(true);
    expect(testBody.data.ok).toBe(true);
    expect(testBody.data.runId.length).toBeGreaterThan(8);
    expect(testBody.data.detail.retrieved).not.toBeNull();
    expect(testBody.data.detail.retrieved?.from).toBe('admin@nexlabco.test');
    expect(testBody.data.detail.retrieved?.to).toContain('support@nexlabco.test');
    expect(testBody.data.detail.retrieved?.subject).toBe(`ADMIN-PROBE-${testBody.data.runId}`);

    // Verify the probe message is in Mailpit AND carries the explicit admin
    // probe header — so it can never be confused with NXS-dispatched traffic.
    const verifyByHeader = await fetch(
      `http://127.0.0.1:${HTTP_PORT}/api/v1/search?query=${encodeURIComponent(testBody.data.detail.sent.subject)}&limit=1`
    );
    const verifyBody = (await verifyByHeader.json()) as { messages: Array<{ ID: string }> };
    expect(verifyBody.messages.length).toBe(1);
    const headerResp = await fetch(
      `http://127.0.0.1:${HTTP_PORT}/api/v1/message/${verifyBody.messages[0]?.ID}/headers`
    );
    const headers = (await headerResp.json()) as Record<string, string[]>;
    expect(headers['X-Nexus-Admin-Probe']).toEqual(['true']);
    expect(headers['X-Nexus-Probe-Kind']).toEqual(['admin_probe_message']);

    // 4. DISABLE — PUT enabled=false through the dashboard route.
    const disable = await fetch(url('/workspace/admin/setup/connectors/mailpit-local'), {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ enabled: false }),
    });
    expect(disable.status).toBe(200);
    const disableBody = (await disable.json()) as { ok: boolean };
    expect(disableBody.ok).toBe(true);

    // 5. DELETE — DELETE through the dashboard route.
    const del = await fetch(url('/workspace/admin/setup/connectors/mailpit-local'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { ok: boolean; data: { removed: boolean } };
    expect(delBody.ok).toBe(true);
    expect(delBody.data.removed).toBe(true);

    // 6. CONFIRM — manifest no longer holds the entry.
    const stored = await manifestWriter.readEntries(
      'config/connectors/connectors.v1.yaml',
      'connectors'
    );
    expect(stored.find(e => e['connectorId'] === 'mailpit-local')).toBeUndefined();
  });

  it('probe returns 404 for an unknown connector', async () => {
    const res = await fetch(url('/workspace/admin/setup/connectors/does-not-exist/probe'), {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('test-connection returns 404 for an unknown connector', async () => {
    const res = await fetch(
      url('/workspace/admin/setup/connectors/does-not-exist/test-connection'),
      {
        method: 'POST',
        headers: adminHeaders(),
      }
    );
    expect(res.status).toBe(404);
  });

  it('probe rejects when sender is not in allow-list (wildcard rejection at install layer)', async () => {
    if (!mailpitUp) {
      console.log('[skip] Mailpit not reachable');
      return;
    }
    // Try to install a connector with wildcard in allowedSenders. The connector
    // constructor will throw at probe time when the handler instantiates it.
    const create = await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(
        mailpitInstallPayload({
          allowedSenders: ['*'],
        })
      ),
    });
    // The admin-writer ConnectorCreateSchema doesn't enforce mailpit-specific
    // shape (configuration is record(unknown)); the wildcard is caught at
    // probe time by the connector constructor. That is the architectural
    // intent: the connector is the authority on its own config invariants.
    expect(create.status).toBe(200);
    // Now attempt to probe — handler should throw because of wildcard.
    const probe = await fetch(url('/workspace/admin/setup/connectors/mailpit-local/probe'), {
      method: 'POST',
      headers: adminHeaders(),
    });
    expect(probe.status).toBe(500);
  });

  it('probe and test-connection both require elevated session', async () => {
    if (!mailpitUp) {
      console.log('[skip] Mailpit not reachable');
      return;
    }
    await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(mailpitInstallPayload()),
    });
    const headersNoElev = { ...adminHeaders() };
    delete headersNoElev['X-Elevated-Session'];
    const probe = await fetch(url('/workspace/admin/setup/connectors/mailpit-local/probe'), {
      method: 'POST',
      headers: headersNoElev,
    });
    expect(probe.status).toBe(403);
    const test = await fetch(
      url('/workspace/admin/setup/connectors/mailpit-local/test-connection'),
      {
        method: 'POST',
        headers: headersNoElev,
      }
    );
    expect(test.status).toBe(403);
  });
});
