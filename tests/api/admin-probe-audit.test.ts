/**
 * admin-probe-audit.test.ts
 *
 * Closes D-4 from
 * `docs/acceptance-wall/MAILPIT-INTEGRATION-DRIFT-AUDIT-2026-05-22.md`:
 * the admin connector probe + test-connection routes MUST emit
 * infrastructure-audit run-ledger events (`admin_probe` /
 * `admin_test_connection`) carrying:
 *   - infra run id (from infraRunIdNamespace)
 *   - admin principal id (and actorId)
 *   - connector id + type
 *   - diagnostic kind (admin_probe | admin_test_connection)
 *   - target side-effect flag (false for probe, true for test-connection)
 *   - redacted config digest (sha256 of canonical config; never the
 *     raw configuration in detail)
 *   - result status (ok | failed)
 *
 * Uses a fake `ConnectorProbeHandler` to keep the test independent of
 * any external substrate (Mailpit, Gmail, etc.). The real Mailpit-
 * backed integration test
 * (`tests/integration/admin-mailpit-install.integration.test.ts`)
 * already proves the routes do not regress at the response shape.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import {
  registerAdminWriterRoutes,
  type ConnectorProbeHandler,
  type ManifestWriter,
} from '../../packages/interfaces/api/src/routes/admin-writer.js';
import { InMemoryInfraRunIdNamespace } from '../../packages/core/src/infra/infra-run-id-namespace.js';
import { InMemoryAdminMutationNonceStore } from '../../packages/interfaces/api/src/middleware/signed-admin-mutation.js';
import type {
  AdminMutationKind,
  AdminMutationServerSignerPort,
  AdminMutationVerifierPort,
  ElevatedAuthChallenge,
  ElevatedAuthChallengeRequest,
  ElevatedAuthProvider,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  ElevatedSessionStatus,
  IdentityClaims,
  NonEmpty,
  RunLedgerEntry,
  RunLedgerWriter,
  SignedAdminMutation,
  Uuid,
} from '../../packages/contracts/src/index.js';

const ADMIN_PID = 'aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb';
const ADMIN_AID = 'cccccccc-1111-4111-8111-dddddddddddd';
const ELEV = 'eeeeeeee-1111-4111-8111-ffffffffffff';

function fakeJwtMiddleware(req: Request, res: Response, next: NextFunction): void {
  const raw = req.header('X-Test-Identity');
  if (raw === undefined) {
    next();
    return;
  }
  const parsed = JSON.parse(raw) as {
    kind: 'admin' | 'plain';
    principalId: string;
    actorId: string;
  };
  const claims: IdentityClaims = {
    principalIdentity: ('Test:' + parsed.principalId) as NonEmpty,
    roleAssignments:
      parsed.kind === 'admin' ? (['nexus-admin'] as NonEmpty[]) : (['user'] as NonEmpty[]),
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
  async challenge(_req: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge> {
    throw new Error('not used');
  },
  async verify(_req: ElevatedAuthVerifyRequest): Promise<ElevatedSession> {
    throw new Error('not used');
  },
  async validateSession(sessionId: Uuid, principalId: string): Promise<ElevatedSessionStatus> {
    if ((sessionId as string) === ELEV && principalId === ADMIN_PID) {
      return { valid: true, remainingSeconds: 600 };
    }
    return { valid: false, remainingSeconds: 0, reason: 'mock-rejected' as NonEmpty };
  },
};

function createManifestWriter(
  initial: Record<string, unknown>[]
): ManifestWriter & { _entries: Record<string, unknown>[] } {
  const store = new Map<string, Record<string, unknown>[]>();
  return {
    _entries: initial,
    async readEntries(p, k) {
      const key = `${p}::${k}`;
      if (!store.has(key)) store.set(key, [...initial]);
      return store.get(key)!;
    },
    async addEntry(p, k, e) {
      const key = `${p}::${k}`;
      const arr = store.get(key) ?? [];
      arr.push(e);
      store.set(key, arr);
    },
    async updateEntry() {},
    async removeEntry() {},
  };
}

function createMockRunLedgerWriter(): RunLedgerWriter & { _entries: RunLedgerEntry[] } {
  const entries: RunLedgerEntry[] = [];
  return {
    _entries: entries,
    async writeEvent(entry) {
      entries.push({ ...entry, entryId: ('e-' + randomUUID()) as never } as RunLedgerEntry);
    },
    async getByRunId() {
      return entries;
    },
    async tail(n) {
      return entries.slice(-n);
    },
    async getLatestRunId() {
      return null;
    },
  };
}

const passVerifier: AdminMutationVerifierPort = {
  async verify(envelope: SignedAdminMutation<unknown>) {
    return {
      ok: true,
      opener: envelope.opener,
      payloadDigest: 'fixture-digest',
      signatureRef: 'fixture-sigref',
    };
  },
};

const fixtureSigner: AdminMutationServerSignerPort = {
  async sign<TPayload>(args: {
    opener: NonEmpty;
    mutationKind: AdminMutationKind;
    payload: TPayload;
    issuedAt: string;
    nonce: NonEmpty;
  }): Promise<SignedAdminMutation<TPayload>> {
    return {
      mutationKind: args.mutationKind,
      payload: args.payload,
      opener: args.opener,
      issuedAt: args.issuedAt as never,
      nonce: args.nonce,
      signature: 'fixture-sig' as never,
    };
  },
};

const adminHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Test-Identity': JSON.stringify({
    kind: 'admin',
    principalId: ADMIN_PID,
    actorId: ADMIN_AID,
  }),
  'X-Elevated-Session': ELEV,
};

const plainHeaders: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Test-Identity': JSON.stringify({
    kind: 'plain',
    principalId: ADMIN_PID,
    actorId: ADMIN_AID,
  }),
  'X-Elevated-Session': ELEV,
};

// ── Fake probe handler with configurable behavior ────────────────────────
interface FakeBehavior {
  probeHealthy: boolean;
  probeThrows: boolean;
  testOk: boolean;
  testThrows: boolean;
}
function buildFakeProbe(behavior: FakeBehavior): ConnectorProbeHandler {
  return {
    async probe(record) {
      if (behavior.probeThrows) {
        throw new Error('fake-probe-throw');
      }
      return {
        probedAt: '2026-05-22T12:00:00.000Z',
        connectorId: record.connectorId,
        connectorType: record.connectorType,
        healthy: behavior.probeHealthy,
        detail: { systemType: record.configuration['systemType'] ?? 'fake' },
      };
    },
    async testConnection(record) {
      if (behavior.testThrows) {
        throw new Error('fake-test-throw');
      }
      return {
        probedAt: '2026-05-22T12:00:00.000Z',
        connectorId: record.connectorId,
        connectorType: record.connectorType,
        ok: behavior.testOk,
        runId: record.runId,
        detail: { sent: true, retrieved: behavior.testOk, durationMs: 12 },
        ...(behavior.testOk ? {} : { error: 'fake-failure' }),
      };
    },
  };
}

interface ProbeFixture {
  app: Express;
  server: Server;
  baseUrl: string;
  ledger: ReturnType<typeof createMockRunLedgerWriter>;
  behavior: FakeBehavior;
}

async function buildFixture(opts?: {
  configuration?: Record<string, unknown>;
}): Promise<ProbeFixture> {
  const behavior: FakeBehavior = {
    probeHealthy: true,
    probeThrows: false,
    testOk: true,
    testThrows: false,
  };
  const configuration: Record<string, unknown> = opts?.configuration ?? {
    systemType: 'mailpit',
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    apiBaseUrl: 'http://127.0.0.1:8025',
    secret: 'super-secret-token-not-in-detail',
  };
  const manifestWriter = createManifestWriter([
    {
      connectorId: 'connector-under-test',
      connectorType: 'fake-probe-type',
      allowedSystems: ['fake'],
      dataClass: 'internal',
      configuration,
    },
  ]);
  const ledger = createMockRunLedgerWriter();
  const probeHandlers = new Map<string, ConnectorProbeHandler>();
  probeHandlers.set('fake-probe-type', buildFakeProbe(behavior));

  const app = express();
  app.use(express.json());
  app.use('/workspace', fakeJwtMiddleware);
  registerAdminWriterRoutes(app, {
    elevatedAuthProvider: mockElevatedAuth,
    manifestWriter,
    runLedgerWriter: ledger,
    infraRunIdNamespace: new InMemoryInfraRunIdNamespace(),
    adminMutationVerifier: passVerifier,
    adminMutationNonceStore: new InMemoryAdminMutationNonceStore(),
    adminMutationServerSigner: fixtureSigner,
    connectorProbeHandlers: probeHandlers,
  });
  const listening = await new Promise<{ server: Server; port: number }>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => {
      resolve({ server: s, port: (s.address() as AddressInfo).port });
    });
  });
  return {
    app,
    server: listening.server,
    baseUrl: `http://127.0.0.1:${listening.port}`,
    ledger,
    behavior,
  };
}

async function closeFixture(f: ProbeFixture): Promise<void> {
  await new Promise<void>(resolve => f.server.close(() => resolve()));
}

// Canonical JSON of an object — same algorithm the route uses for the
// configDigest, mirrored here so we can assert byte-exact match.
function canonicalJsonOf(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonOf).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJsonOf(obj[k])).join(',') + '}';
}
function expectedDigest(config: Record<string, unknown>): string {
  return 'sha256:' + createHash('sha256').update(canonicalJsonOf(config)).digest('hex');
}

describe('admin connector probe + test-connection — infra-audit emission (D-4 closure)', () => {
  let fix: ProbeFixture;

  beforeAll(async () => {
    fix = await buildFixture();
  });
  afterAll(async () => {
    await closeFixture(fix);
  });

  it('AUDIT-01: successful probe → admin_probe event, hasTargetSideEffect=false, configDigest present, raw config NOT in detail', async () => {
    fix.ledger._entries.length = 0;
    fix.behavior.probeHealthy = true;
    fix.behavior.probeThrows = false;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`,
      { method: 'POST', headers: adminHeaders }
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { ok: boolean; data: { healthy: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.healthy).toBe(true);

    expect(fix.ledger._entries.length).toBe(1);
    const ev = fix.ledger._entries[0]!;
    expect(ev.eventType).toBe('admin_probe');
    expect(ev.actorId).toBe(ADMIN_AID);
    const detail = ev.detail as Record<string, unknown>;
    expect(detail['adminPrincipalId']).toBe(ADMIN_PID);
    expect(detail['connectorId']).toBe('connector-under-test');
    expect(detail['connectorType']).toBe('fake-probe-type');
    expect(detail['dataClass']).toBe('internal');
    expect(detail['diagnosticKind']).toBe('admin_probe');
    expect(detail['hasTargetSideEffect']).toBe(false);
    expect(detail['result']).toBe('ok');
    expect(String(detail['configDigest'])).toMatch(/^sha256:[0-9a-f]{64}$/);

    // The raw configuration MUST NOT appear in detail (secret leak guard).
    expect(detail['configuration']).toBeUndefined();
    const detailJson = JSON.stringify(detail);
    expect(detailJson).not.toContain('super-secret-token-not-in-detail');

    // infra run id is in the runId field.
    expect(String(ev.runId)).toMatch(/^infra-\d{4}-\d{2}-\d{2}-\d{4}$/);
  });

  it('AUDIT-02: probe handler throws → admin_probe event with result=failed; response surfaces error', async () => {
    fix.ledger._entries.length = 0;
    fix.behavior.probeThrows = true;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`,
      { method: 'POST', headers: adminHeaders }
    );
    // Express default error handler returns 500 when next(err) is called.
    expect(resp.status).toBeGreaterThanOrEqual(500);

    // Even on throw the audit event must have been emitted (the finally
    // block fires before the error propagates).
    expect(fix.ledger._entries.length).toBe(1);
    const ev = fix.ledger._entries[0]!;
    expect(ev.eventType).toBe('admin_probe');
    const detail = ev.detail as Record<string, unknown>;
    expect(detail['result']).toBe('failed');

    fix.behavior.probeThrows = false;
  });

  it('AUDIT-03: successful test-connection → admin_test_connection event, hasTargetSideEffect=true, result=ok', async () => {
    fix.ledger._entries.length = 0;
    fix.behavior.testOk = true;
    fix.behavior.testThrows = false;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/test-connection`,
      { method: 'POST', headers: adminHeaders }
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { ok: boolean; data: { ok: boolean } };
    expect(body.ok).toBe(true);
    expect(body.data.ok).toBe(true);

    expect(fix.ledger._entries.length).toBe(1);
    const ev = fix.ledger._entries[0]!;
    expect(ev.eventType).toBe('admin_test_connection');
    expect(ev.actorId).toBe(ADMIN_AID);
    const detail = ev.detail as Record<string, unknown>;
    expect(detail['diagnosticKind']).toBe('admin_test_connection');
    expect(detail['hasTargetSideEffect']).toBe(true);
    expect(detail['result']).toBe('ok');
    expect(String(detail['configDigest'])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('AUDIT-04: test-connection failure (ok:false) → admin_test_connection event with result=failed, response 502', async () => {
    fix.ledger._entries.length = 0;
    fix.behavior.testOk = false;
    fix.behavior.testThrows = false;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/test-connection`,
      { method: 'POST', headers: adminHeaders }
    );
    expect(resp.status).toBe(502);
    expect(fix.ledger._entries.length).toBe(1);
    const ev = fix.ledger._entries[0]!;
    expect(ev.eventType).toBe('admin_test_connection');
    const detail = ev.detail as Record<string, unknown>;
    expect(detail['result']).toBe('failed');
    expect(detail['hasTargetSideEffect']).toBe(true);

    fix.behavior.testOk = true;
  });

  it('AUDIT-05: unauthenticated request → no event emitted, response 401-class', async () => {
    fix.ledger._entries.length = 0;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`,
      { method: 'POST' /* no headers */ }
    );
    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect(resp.status).toBeLessThan(500);
    // No probe event because auth failed before the route's emission block.
    expect(fix.ledger._entries.length).toBe(0);
  });

  it('AUDIT-06: non-admin user → no event emitted, response 4xx', async () => {
    fix.ledger._entries.length = 0;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`,
      { method: 'POST', headers: plainHeaders }
    );
    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect(resp.status).toBeLessThan(500);
    expect(fix.ledger._entries.length).toBe(0);
  });

  it('AUDIT-07: configDigest matches sha256 of canonical-JSON of the configuration', async () => {
    fix.ledger._entries.length = 0;
    fix.behavior.probeHealthy = true;
    fix.behavior.probeThrows = false;

    const resp = await fetch(
      `${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`,
      { method: 'POST', headers: adminHeaders }
    );
    expect(resp.status).toBe(200);
    expect(fix.ledger._entries.length).toBe(1);
    const detail = fix.ledger._entries[0]!.detail as Record<string, unknown>;
    const expected = expectedDigest({
      systemType: 'mailpit',
      smtpHost: '127.0.0.1',
      smtpPort: 1025,
      apiBaseUrl: 'http://127.0.0.1:8025',
      secret: 'super-secret-token-not-in-detail',
    });
    expect(detail['configDigest']).toBe(expected);
  });

  it('AUDIT-08: same config → identical digest across invocations (deterministic)', async () => {
    fix.ledger._entries.length = 0;
    fix.behavior.probeThrows = false;

    await fetch(`${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`, {
      method: 'POST',
      headers: adminHeaders,
    });
    await fetch(`${fix.baseUrl}/workspace/admin/setup/connectors/connector-under-test/probe`, {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(fix.ledger._entries.length).toBe(2);
    const d1 = (fix.ledger._entries[0]!.detail as Record<string, unknown>)['configDigest'];
    const d2 = (fix.ledger._entries[1]!.detail as Record<string, unknown>)['configDigest'];
    expect(d1).toBe(d2);
  });
});
