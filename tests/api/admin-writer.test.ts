/**
 * Admin Writer Routes — tests
 * SPEC-ADMIN-WRITER §4–§6 (Claude D)
 *
 * Covers:
 *   1. Auth chain — 401/403 for missing claims, non-admin role, missing elevated session
 *   2. Endpoint CRUD — POST add, PUT update (not tested — needs real manifest), DELETE remove
 *   3. Actor CRUD — POST register, PUT update, DELETE hard-delete
 *   4. Connector CRUD — POST add, DELETE remove
 *   5. 501 when manifestWriter not configured
 *   6. 501 when actorRegistry not configured
 *   7. 400 for missing required fields
 *   8. Lock status endpoint
 *
 * Test seam: same fake JWT middleware + mock ElevatedAuthProvider as
 * admin-setup.test.ts. ManifestWriter and ActorRegistry are in-memory mocks.
 *
 * No supertest dependency. We use app.listen(0) + fetch().
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerAdminWriterRoutes } from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type {
  ManifestWriter,
  SecretWriter,
} from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type {
  IdentityClaims,
  ElevatedAuthProvider,
  ElevatedSessionStatus,
  ElevatedAuthChallengeRequest,
  ElevatedAuthChallenge,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  Actor,
  ActorRegistry,
  ActorClass,
  OctLevel,
  Principal,
  PrincipalRegistry,
  RunLedgerEntry,
  RunLedgerWriter,
  Uuid,
  NonEmpty,
} from '@nexus/contracts';

// ─── Fake JWT middleware (same seam as admin-setup.test.ts) ─────────────────

type Identity =
  | { kind: 'admin'; principalId: string; actorId: string }
  | { kind: 'plain'; principalId: string; actorId: string }
  | { kind: 'none' };

function fakeJwtMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const headerVal = req.headers['x-test-identity'];
  const ident: Identity = headerVal
    ? (JSON.parse(String(headerVal)) as Identity)
    : { kind: 'none' };

  if (ident.kind === 'none') {
    next();
    return;
  }
  const roleAssignments: NonEmpty[] =
    ident.kind === 'admin' ? (['nexus-admin'] as NonEmpty[]) : (['user'] as NonEmpty[]);
  const claims: IdentityClaims = {
    principalIdentity: ('Test:' + ident.principalId) as NonEmpty,
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
  res.locals['principalId'] = ident.principalId;
  res.locals['actorId'] = ident.actorId;
  next();
}

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_ELEV = '11111111-1111-1111-1111-111111111111';
const ADMIN_PID = '22222222-2222-2222-2222-222222222222';
const ADMIN_AID = '33333333-3333-3333-3333-333333333333';

// ─── Mock ElevatedAuthProvider ──────────────────────────────────────────────

const mockElevatedAuth: ElevatedAuthProvider = {
  challenge: async (_input: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge> => {
    throw new Error('not used in test');
  },
  verify: async (_input: ElevatedAuthVerifyRequest): Promise<ElevatedSession> => {
    throw new Error('not used in test');
  },
  validateSession: async (
    elevatedSessionId: Uuid,
    principalId: string
  ): Promise<ElevatedSessionStatus> => {
    if ((elevatedSessionId as string) === VALID_ELEV && principalId === ADMIN_PID) {
      return { valid: true, remainingSeconds: 600 };
    }
    return { valid: false, remainingSeconds: 0, reason: 'mock-rejected' as NonEmpty };
  },
};

// ─── Mock ManifestWriter (in-memory) ────────────────────────────────────────

function createMockManifestWriter(): ManifestWriter & {
  _store: Map<string, Record<string, unknown>[]>;
} {
  const store = new Map<string, Record<string, unknown>[]>();

  return {
    _store: store,

    async readEntries(manifestPath: string, arrayKey: string): Promise<Record<string, unknown>[]> {
      const key = `${manifestPath}:${arrayKey}`;
      return store.get(key) ?? [];
    },

    async addEntry(
      manifestPath: string,
      arrayKey: string,
      entry: Record<string, unknown>,
      idKey: string
    ): Promise<Record<string, unknown>[]> {
      const key = `${manifestPath}:${arrayKey}`;
      const arr = store.get(key) ?? [];
      const entryId = entry[idKey];
      if (arr.some(e => e[idKey] === entryId)) {
        throw Object.assign(new Error(`Entry ${String(entryId)} already exists`), {
          statusCode: 409,
        });
      }
      arr.push(entry);
      store.set(key, arr);
      return arr;
    },

    async updateEntry(
      manifestPath: string,
      arrayKey: string,
      entryId: string,
      updates: Record<string, unknown>,
      idKey: string
    ): Promise<Record<string, unknown>[]> {
      const key = `${manifestPath}:${arrayKey}`;
      const arr = store.get(key) ?? [];
      const idx = arr.findIndex(e => e[idKey] === entryId);
      if (idx === -1) {
        throw Object.assign(new Error(`Entry ${entryId} not found`), { statusCode: 404 });
      }
      arr[idx] = { ...arr[idx], ...updates };
      store.set(key, arr);
      return arr;
    },

    async removeEntry(
      manifestPath: string,
      arrayKey: string,
      entryId: string,
      idKey: string
    ): Promise<Record<string, unknown>[]> {
      const key = `${manifestPath}:${arrayKey}`;
      const arr = store.get(key) ?? [];
      const idx = arr.findIndex(e => e[idKey] === entryId);
      if (idx === -1) {
        throw Object.assign(new Error(`Entry ${entryId} not found`), { statusCode: 404 });
      }
      arr.splice(idx, 1);
      store.set(key, arr);
      return arr;
    },
  };
}

// ─── Mock ActorRegistry (in-memory) ─────────────────────────────────────────

function createMockActorRegistry(): ActorRegistry & { _actors: Map<string, Actor> } {
  const actors = new Map<string, Actor>();

  return {
    _actors: actors,
    async get(actorId: Uuid): Promise<Actor | null> {
      return actors.get(actorId) ?? null;
    },
    async getByClass(actorClass: ActorClass): Promise<Actor[]> {
      return [...actors.values()].filter(a => a.actorClass === actorClass);
    },
    async register(actor: Actor): Promise<void> {
      if (actors.has(actor.actorId)) {
        throw new Error(`UNIQUE constraint: actor ${actor.actorId} already exists`);
      }
      actors.set(actor.actorId, actor);
    },
    async update(actorId: Uuid, actor: Actor): Promise<void> {
      if (!actors.has(actorId)) {
        throw new Error(`Actor ${actorId} not found`);
      }
      actors.set(actorId, actor);
    },
    async updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void> {
      const a = actors.get(actorId);
      if (a) actors.set(actorId, { ...a, octLevel });
    },
    async list(): Promise<Actor[]> {
      return [...actors.values()];
    },
    async delete(actorId: Uuid): Promise<void> {
      if (!actors.has(actorId)) {
        throw new Error(`Actor ${actorId} not found`);
      }
      actors.delete(actorId);
    },
  };
}

// ─── Mock PrincipalRegistry (in-memory) ─────────────────────────────────────

function createMockPrincipalRegistry(): PrincipalRegistry & {
  _principals: Map<string, Principal>;
} {
  const principals = new Map<string, Principal>();

  return {
    _principals: principals,
    async get(principalId: Uuid): Promise<Principal | null> {
      return principals.get(principalId) ?? null;
    },
    async register(principal: Principal): Promise<void> {
      principals.set(principal.principalId, principal);
    },
    async list(): Promise<Principal[]> {
      return [...principals.values()];
    },
  };
}

// ─── Mock SecretWriter (in-memory) ──────────────────────────────────────────
// CLAUDE-CODE-SECRET-MANAGEMENT-SPEC test seam — mirrors FileSecretSource's
// admin write surface without touching disk.

function createMockSecretWriter(): SecretWriter & { _values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    _values: values,
    storageLabel: 'mock://secrets',
    async writeSecret(keyName: string, keyValue: string): Promise<void> {
      values.set(keyName, keyValue);
    },
    async deleteSecret(keyName: string): Promise<boolean> {
      return values.delete(keyName);
    },
    async listKeyNames(): Promise<readonly string[]> {
      return [...values.keys()];
    },
  };
}

// ─── Mock RunLedgerWriter (in-memory) ───────────────────────────────────────
// Captures audit events so secret_stored / secret_removed assertions can
// verify both presence and detail shape (no value leakage).

function createMockRunLedgerWriter(): RunLedgerWriter & {
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

// ─── App fixture ────────────────────────────────────────────────────────────

function buildApp(opts: {
  includeElevatedAuth?: boolean;
  includeManifestWriter?: boolean;
  includeActorRegistry?: boolean;
  includePrincipalRegistry?: boolean;
  includeSecretWriter?: boolean;
  includeRunLedgerWriter?: boolean;
}): {
  app: express.Express;
  start: () => Promise<{ port: number; server: Server }>;
  manifestWriter: ReturnType<typeof createMockManifestWriter>;
  actorRegistry: ReturnType<typeof createMockActorRegistry>;
  principalRegistry: ReturnType<typeof createMockPrincipalRegistry>;
  secretWriter: ReturnType<typeof createMockSecretWriter>;
  runLedgerWriter: ReturnType<typeof createMockRunLedgerWriter>;
} {
  const app = express();
  app.use(express.json());
  app.use('/workspace', fakeJwtMiddleware);

  const manifestWriter = createMockManifestWriter();
  const actorRegistry = createMockActorRegistry();
  const principalRegistry = createMockPrincipalRegistry();
  const secretWriter = createMockSecretWriter();
  const runLedgerWriter = createMockRunLedgerWriter();

  registerAdminWriterRoutes(app, {
    ...(opts.includeElevatedAuth !== false ? { elevatedAuthProvider: mockElevatedAuth } : {}),
    ...(opts.includeManifestWriter !== false ? { manifestWriter } : {}),
    ...(opts.includeActorRegistry !== false ? { actorRegistry } : {}),
    ...(opts.includePrincipalRegistry !== false ? { principalRegistry } : {}),
    ...(opts.includeSecretWriter !== false ? { secretWriter } : {}),
    ...(opts.includeRunLedgerWriter !== false ? { runLedgerWriter } : {}),
  });

  const start = async (): Promise<{ port: number; server: Server }> =>
    new Promise(resolve => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        resolve({ port: addr.port, server });
      });
    });

  return {
    app,
    start,
    manifestWriter,
    actorRegistry,
    principalRegistry,
    secretWriter,
    runLedgerWriter,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function plainHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Test-Identity': JSON.stringify({
      kind: 'plain',
      principalId: ADMIN_PID,
      actorId: ADMIN_AID,
    }),
    'X-Elevated-Session': VALID_ELEV,
  };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('admin-writer routes', () => {
  let server: Server;
  let port: number;
  let manifestWriter: ReturnType<typeof createMockManifestWriter>;
  let actorRegistry: ReturnType<typeof createMockActorRegistry>;
  let principalRegistry: ReturnType<typeof createMockPrincipalRegistry>;

  beforeAll(async () => {
    const fixture = buildApp({});
    const r = await fixture.start();
    port = r.port;
    server = r.server;
    manifestWriter = fixture.manifestWriter;
    actorRegistry = fixture.actorRegistry;
    principalRegistry = fixture.principalRegistry;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    manifestWriter._store.clear();
    actorRegistry._actors.clear();
    principalRegistry._principals.clear();
  });

  const url = (p: string): string => `http://127.0.0.1:${port}${p}`;

  // ── Auth chain ──────────────────────────────────────────────────────────

  it('returns 401 when JWT did not populate claims', async () => {
    const res = await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpointId: 'test' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller has no admin role', async () => {
    const res = await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: plainHeaders(),
      body: JSON.stringify({ endpointId: 'test' }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 403 when X-Elevated-Session header is missing', async () => {
    const h = adminHeaders();
    delete h['X-Elevated-Session'];
    const res = await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ endpointId: 'test' }),
    });
    expect(res.status).toBe(403);
  });

  // ── Surface 1: Model Endpoints ──────────────────────────────────────────

  it('POST /endpoints — adds endpoint and returns requiresRestart: true', async () => {
    const res = await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        endpointId: 'test-ollama',
        url: 'http://localhost:11434/api/chat',
        adapterId: 'ollama-chat-v1',
        modelName: 'llama3.2',
        tier: 'on_prem_general',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { endpointId: string; requiresRestart: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.endpointId).toBe('test-ollama');
    expect(body.data.requiresRestart).toBe(true);
  });

  it('POST /endpoints — 409 on duplicate endpointId', async () => {
    const payload = JSON.stringify({
      endpointId: 'dup-ep',
      url: 'http://localhost:11434/api/chat',
      adapterId: 'ollama-chat-v1',
      modelName: 'llama3.2',
    });
    await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: adminHeaders(),
      body: payload,
    });
    const res = await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: adminHeaders(),
      body: payload,
    });
    expect(res.status).toBe(409);
  });

  it('POST /endpoints — 400 when required fields missing', async () => {
    const res = await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ endpointId: 'no-url' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /endpoints/:id — removes endpoint', async () => {
    await fetch(url('/workspace/admin/setup/endpoints'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        endpointId: 'to-delete',
        url: 'http://localhost:11434',
        adapterId: 'ollama-chat-v1',
        modelName: 'llama3.2',
      }),
    });
    const res = await fetch(url('/workspace/admin/setup/endpoints/to-delete'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { removed: boolean } };
    expect(body.data.removed).toBe(true);
  });

  it('DELETE /endpoints/:id — 404 for nonexistent', async () => {
    const res = await fetch(url('/workspace/admin/setup/endpoints/ghost'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(404);
  });

  // ── Surface 2: Actors & Agents ──────────────────────────────────────────

  it('POST /actors — registers actor, requiresRestart: false', async () => {
    const res = await fetch(url('/workspace/admin/setup/actors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        actorId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        actorClass: 'SUPERVISED_AGENT',
        principalId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        displayName: 'test-agent',
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'medium',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single'],
        owner: 'test-owner',
        purpose: 'test-purpose',
        reviewCadence: 'quarterly',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { actorId: string; requiresRestart: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.requiresRestart).toBe(false);
  });

  it('POST /actors — 400 when required fields missing', async () => {
    const res = await fetch(url('/workspace/admin/setup/actors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ actorId: 'no-class' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /actors/:id — updates existing actor', async () => {
    const aid = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    // Seed actor directly in mock
    actorRegistry._actors.set(aid, {
      actorId: aid,
      actorClass: 'SUPERVISED_AGENT',
      principalId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      displayName: 'old-name' as NonEmpty,
      environment: 'reference',
      octLevel: 'OCT-OPEN',
      riskCeiling: 'medium',
      allowedSystems: ['stub'],
      allowedCapabilities: [],
      enabled: true,
      registeredAt: new Date().toISOString(),
      owner: 'test' as NonEmpty,
      purpose: 'test' as NonEmpty,
      reviewCadence: 'quarterly' as NonEmpty,
    } as Actor);

    const res = await fetch(url(`/workspace/admin/setup/actors/${aid}`), {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ displayName: 'new-name' }),
    });
    expect(res.status).toBe(200);
    const updated = actorRegistry._actors.get(aid);
    expect(updated?.displayName).toBe('new-name');
  });

  it('PUT /actors/:id — 404 for nonexistent', async () => {
    const res = await fetch(
      url('/workspace/admin/setup/actors/00000000-0000-0000-0000-000000000000'),
      {
        method: 'PUT',
        headers: adminHeaders(),
        body: JSON.stringify({ displayName: 'nope' }),
      }
    );
    expect(res.status).toBe(404);
  });

  it('DELETE /actors/:id — hard-deletes actor', async () => {
    const aid = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    actorRegistry._actors.set(aid, {
      actorId: aid,
      actorClass: 'SUPERVISED_AGENT',
      principalId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      displayName: 'doomed' as NonEmpty,
      environment: 'reference',
      octLevel: 'OCT-OPEN',
      riskCeiling: 'low',
      allowedSystems: ['stub'],
      allowedCapabilities: [],
      enabled: true,
      registeredAt: new Date().toISOString(),
      owner: 'test' as NonEmpty,
      purpose: 'test' as NonEmpty,
      reviewCadence: 'quarterly' as NonEmpty,
    } as Actor);

    const res = await fetch(url(`/workspace/admin/setup/actors/${aid}`), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
    expect(actorRegistry._actors.has(aid)).toBe(false);
  });

  // ── Surface 3: Connectors ──────────────────────────────────────────────

  it('POST /connectors — adds connector, requiresRestart: true', async () => {
    // CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §2 — allowedSystems is now
    // required (Zod) with concrete-identifier validation. The previous
    // route default of `['*']` was a wildcard violation removed in
    // Phase B; tests have to send explicit systems to match the boundary.
    const res = await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        connectorId: 'test-pg',
        connectorType: 'stub',
        allowedSystems: ['stub'],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { connectorId: string; requiresRestart: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.connectorId).toBe('test-pg');
    expect(body.data.requiresRestart).toBe(true);
  });

  it('DELETE /connectors/:id — removes connector', async () => {
    await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        connectorId: 'to-rm',
        connectorType: 'stub',
        allowedSystems: ['stub'],
      }),
    });
    const res = await fetch(url('/workspace/admin/setup/connectors/to-rm'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { removed: boolean } };
    expect(body.data.removed).toBe(true);
  });

  it('POST /connectors — rejects wildcard (*) in allowedSystems with 400 + details', async () => {
    // CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §2c — wildcard rejection at
    // schema level. The route MUST never write `*` into the manifest;
    // the old server-side `if (!entry.allowedSystems) entry.allowedSystems = ['*']`
    // default has been replaced by an explicit Zod refinement.
    const res = await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        connectorId: 'wildcard-rejected',
        connectorType: 'stub',
        allowedSystems: ['*'],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      details: ReadonlyArray<{ path: string; message: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Validation failed');
    expect(body.details.some(d => /wildcard/i.test(d.message))).toBe(true);
  });

  // ── Catalog ─────────────────────────────────────────────────────────────

  it('GET /catalog — returns governed constants and raw manifest entries', async () => {
    // Seed disabled + enabled entries to prove catalog includes both.
    manifestWriter._store.set('config/nvg/endpoints.v1.yaml:endpoints', [
      {
        endpointId: 'enabled-ep',
        url: 'http://x',
        adapterId: 'ollama-chat-v1',
        modelName: 'llama3.2',
        tier: 'on_prem_general',
        enabled: true,
        auth: { kind: 'none' },
      },
      {
        endpointId: 'disabled-ep',
        url: 'http://y',
        adapterId: 'openai-chat-v1',
        modelName: 'gpt-4o',
        tier: 'frontier_general',
        enabled: false,
        auth: { kind: 'bearer' },
      },
    ]);
    manifestWriter._store.set('config/connectors/connectors.v1.yaml:connectors', [
      { connectorId: 'stub-conn', connectorType: 'stub', enabled: true },
    ]);
    // AMEND-nexus-admin-dashboard-full-buildout §4.2 — seed all seven new
    // manifest surfaces so the catalog response exposes them for panel
    // dropdowns + cross-surface FK validation.
    manifestWriter._store.set('config/identity/providers.v1.yaml:providers', [
      { providerId: 'local-default', providerType: 'local', enabled: true, configuration: {} },
    ]);
    manifestWriter._store.set('config/channels/channels.v1.yaml:channels', [
      { channelId: 'cli-approval', channelType: 'cli', enabled: true, configuration: {} },
    ]);
    manifestWriter._store.set('config/orchestrators/orchestrators.v1.yaml:orchestrators', [
      { orchestratorSocketId: 'ref-orch', orchestratorType: 'ref-deterministic', enabled: true },
    ]);
    manifestWriter._store.set('config/workspace/workspaces.v1.yaml:workspaces', [
      { workspaceSocketId: 'http-ws', workspaceType: 'http', enabled: true },
    ]);
    manifestWriter._store.set('config/mailbox/mailboxes.v1.yaml:mailboxes', [
      { mailboxId: 'primary', mailboxType: 'jsonl-file', enabled: true, required: true },
    ]);
    manifestWriter._store.set('config/compile/compilers.v1.yaml:compilers', [
      { compilerSocketId: 'ref-compile', compilerType: 'deterministic', enabled: true },
    ]);
    manifestWriter._store.set('config/output/compile-return.v1.yaml:returnEndpoints', [
      { returnEndpointId: 'http-return', endpointType: 'http_callback', enabled: true },
    ]);
    // Seed an actor + a principal so allActors and principals come back populated.
    const seedActorId = '99999999-9999-4999-a999-999999999999' as Uuid;
    const seedPrincipalId = '00000000-0000-4000-a000-000000000001' as Uuid;
    actorRegistry._actors.set(seedActorId, {
      actorId: seedActorId,
      actorClass: 'SUPERVISED_AGENT',
      principalId: seedPrincipalId,
      displayName: 'seed-agent' as NonEmpty,
      environment: 'reference',
      octLevel: 'OCT-OPEN',
      riskCeiling: 'medium',
      allowedSystems: ['stub'],
      allowedCapabilities: ['read:record:single'],
      enabled: true,
      registeredAt: new Date().toISOString(),
      owner: 'tester' as NonEmpty,
      purpose: 'seed' as NonEmpty,
      reviewCadence: 'quarterly' as NonEmpty,
    } as Actor);
    principalRegistry._principals.set(seedPrincipalId, {
      principalId: seedPrincipalId,
      displayName: 'dev-admin' as NonEmpty,
      email: 'admin@example.com' as NonEmpty,
      registeredAt: new Date().toISOString(),
      maxDelegableRiskTier: 'critical',
      allowedSystems: ['*'],
    });

    const res = await fetch(url('/workspace/admin/setup/catalog'), { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        actorClasses: { id: string }[];
        octLevels: { id: string }[];
        riskTiers: { id: string; order: number }[];
        modelTiers: { id: string }[];
        capabilityIds: string[];
        authKinds: { id: string; requiresSecret: boolean }[];
        allEndpoints: Record<string, unknown>[];
        allConnectors: Record<string, unknown>[];
        allActors: Record<string, unknown>[];
        principals: Record<string, unknown>[];
        allIdentityProviders: Record<string, unknown>[];
        allChannels: Record<string, unknown>[];
        allOrchestrators: Record<string, unknown>[];
        allWorkspaces: Record<string, unknown>[];
        allMailboxes: Record<string, unknown>[];
        allCompilers: Record<string, unknown>[];
        allReturnEndpoints: Record<string, unknown>[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.actorClasses.map(a => a.id)).toContain('HUMAN');
    expect(body.data.actorClasses.map(a => a.id)).toContain('AUTONOMOUS_AGENT');
    expect(body.data.octLevels.map(o => o.id)).toContain('OCT-SECURE');
    expect(body.data.riskTiers.find(r => r.id === 'critical')?.order).toBe(3);
    expect(body.data.modelTiers.map(m => m.id)).toContain('on_prem_general');
    expect(body.data.modelTiers.map(m => m.id)).toContain('frontier_general');
    expect(body.data.capabilityIds).toContain('read:record:single');
    expect(body.data.capabilityIds).toContain('execute:automation');
    expect(body.data.authKinds.find(a => a.id === 'api_key')?.requiresSecret).toBe(true);
    expect(body.data.authKinds.find(a => a.id === 'none')?.requiresSecret).toBe(false);
    // Both enabled and disabled entries returned.
    expect(body.data.allEndpoints).toHaveLength(2);
    expect(body.data.allEndpoints.map(e => e['endpointId'])).toEqual(['enabled-ep', 'disabled-ep']);
    expect(body.data.allConnectors).toHaveLength(1);
    // Actors + principals come back populated.
    expect(body.data.allActors).toHaveLength(1);
    expect(body.data.allActors[0]?.['displayName']).toBe('seed-agent');
    expect(body.data.principals).toHaveLength(1);
    expect(body.data.principals[0]?.['principalId']).toBe(seedPrincipalId);
    // AMEND-nexus-admin-dashboard-full-buildout §4.2 — seven new arrays
    // exposed for panel dropdowns and cross-surface FK validation.
    expect(body.data.allIdentityProviders).toHaveLength(1);
    expect(body.data.allIdentityProviders[0]?.['providerId']).toBe('local-default');
    expect(body.data.allChannels).toHaveLength(1);
    expect(body.data.allChannels[0]?.['channelId']).toBe('cli-approval');
    expect(body.data.allOrchestrators).toHaveLength(1);
    expect(body.data.allOrchestrators[0]?.['orchestratorSocketId']).toBe('ref-orch');
    expect(body.data.allWorkspaces).toHaveLength(1);
    expect(body.data.allWorkspaces[0]?.['workspaceSocketId']).toBe('http-ws');
    expect(body.data.allMailboxes).toHaveLength(1);
    expect(body.data.allMailboxes[0]?.['mailboxId']).toBe('primary');
    expect(body.data.allCompilers).toHaveLength(1);
    expect(body.data.allCompilers[0]?.['compilerSocketId']).toBe('ref-compile');
    expect(body.data.allReturnEndpoints).toHaveLength(1);
    expect(body.data.allReturnEndpoints[0]?.['returnEndpointId']).toBe('http-return');
  });

  it('GET /catalog — missing manifests degrade to empty arrays for all seven new surfaces', async () => {
    // No manifests seeded — every all* array should come back as []
    // (readEntries is wrapped in .catch(() => []) per spec §4.2).
    const res = await fetch(url('/workspace/admin/setup/catalog'), { headers: adminHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        allIdentityProviders: unknown[];
        allChannels: unknown[];
        allOrchestrators: unknown[];
        allWorkspaces: unknown[];
        allMailboxes: unknown[];
        allCompilers: unknown[];
        allReturnEndpoints: unknown[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.allIdentityProviders).toEqual([]);
    expect(body.data.allChannels).toEqual([]);
    expect(body.data.allOrchestrators).toEqual([]);
    expect(body.data.allWorkspaces).toEqual([]);
    expect(body.data.allMailboxes).toEqual([]);
    expect(body.data.allCompilers).toEqual([]);
    expect(body.data.allReturnEndpoints).toEqual([]);
  });

  it('GET /catalog — 401 without claims', async () => {
    const res = await fetch(url('/workspace/admin/setup/catalog'));
    expect(res.status).toBe(401);
  });

  it('GET /catalog — 403 without admin role', async () => {
    const res = await fetch(url('/workspace/admin/setup/catalog'), {
      headers: plainHeaders(),
    });
    expect(res.status).toBe(403);
  });

  // ── Discover ────────────────────────────────────────────────────────────

  it('POST /discover — 400 on missing baseUrl', async () => {
    const res = await fetch(url('/workspace/admin/setup/discover'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /discover — 400 on invalid URL', async () => {
    const res = await fetch(url('/workspace/admin/setup/discover'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ baseUrl: 'not a url' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /discover — 400 on non-http protocol', async () => {
    const res = await fetch(url('/workspace/admin/setup/discover'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ baseUrl: 'file:///etc/passwd' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /discover — probes /api/tags and returns models on success', async () => {
    // Stand up a tiny ollama-shaped server for the probe to hit.
    const fakeOllama = express();
    fakeOllama.get('/api/tags', (_req, res) =>
      res.json({
        models: [
          {
            name: 'llama3.2:latest',
            model: 'llama3.2:latest',
            size: 1234567,
            modified_at: '2026-01-02T03:04:05Z',
          },
          { name: 'qwen3:8b' },
        ],
      })
    );
    const ollamaServer = await new Promise<Server>(resolve => {
      const s = fakeOllama.listen(0, '127.0.0.1', () => resolve(s));
    });
    const ollamaPort = (ollamaServer.address() as AddressInfo).port;

    try {
      const res = await fetch(url('/workspace/admin/setup/discover'), {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          baseUrl: `http://127.0.0.1:${ollamaPort}/api/chat`,
          adapterId: 'ollama-chat-v1',
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { probedUrl: string; models: { name: string; size?: number }[] };
      };
      expect(body.ok).toBe(true);
      expect(body.data.probedUrl).toBe(`http://127.0.0.1:${ollamaPort}/api/tags`);
      expect(body.data.models).toHaveLength(2);
      expect(body.data.models[0]?.name).toBe('llama3.2:latest');
      expect(body.data.models[0]?.size).toBe(1234567);
      expect(body.data.models[1]?.name).toBe('qwen3:8b');
    } finally {
      await new Promise<void>(resolve => ollamaServer.close(() => resolve()));
    }
  });

  it('POST /discover — 502 on probe target HTTP error', async () => {
    const fakeOllama = express();
    fakeOllama.get('/api/tags', (_req, res) => res.status(500).json({ error: 'down' }));
    const errServer = await new Promise<Server>(resolve => {
      const s = fakeOllama.listen(0, '127.0.0.1', () => resolve(s));
    });
    const errPort = (errServer.address() as AddressInfo).port;
    try {
      const res = await fetch(url('/workspace/admin/setup/discover'), {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ baseUrl: `http://127.0.0.1:${errPort}` }),
      });
      expect(res.status).toBe(502);
    } finally {
      await new Promise<void>(resolve => errServer.close(() => resolve()));
    }
  });

  // ── Identity providers (AMEND-admin-dashboard §3.1) ─────────────────────

  it('POST /identity-providers — adds a provider and reports restart required', async () => {
    const res = await fetch(url('/workspace/admin/setup/identity-providers'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        providerId: 'corp-oidc',
        providerType: 'oidc',
        configuration: {
          issuerUrl: 'https://idp.example.com',
          clientId: 'nexus',
          clientSecretRef: 'file:OIDC_CLIENT_SECRET',
          redirectUri: 'https://nexus.local/cb',
          scopes: ['openid'],
        },
        enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { providerId: string; requiresRestart: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.data.providerId).toBe('corp-oidc');
    expect(body.data.requiresRestart).toBe(true);
    expect(manifestWriter._store.get('config/identity/providers.v1.yaml:providers')).toHaveLength(
      1
    );
  });

  it('PUT /identity-providers/:id — updates configuration', async () => {
    manifestWriter._store.set('config/identity/providers.v1.yaml:providers', [
      { providerId: 'local-1', providerType: 'local', configuration: {}, enabled: true },
    ]);
    const res = await fetch(url('/workspace/admin/setup/identity-providers/local-1'), {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ configuration: { sessionTtlMinutes: 120 } }),
    });
    expect(res.status).toBe(200);
    const updated = manifestWriter._store.get('config/identity/providers.v1.yaml:providers')?.[0];
    expect(updated?.['configuration']).toEqual({ sessionTtlMinutes: 120 });
  });

  it('DELETE /identity-providers/:id — refuses to remove the last enabled provider', async () => {
    manifestWriter._store.set('config/identity/providers.v1.yaml:providers', [
      { providerId: 'only-1', providerType: 'local', configuration: {}, enabled: true },
    ]);
    const res = await fetch(url('/workspace/admin/setup/identity-providers/only-1'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/last enabled identity provider/i);
  });

  it('DELETE /identity-providers/:id — succeeds when other enabled providers exist', async () => {
    manifestWriter._store.set('config/identity/providers.v1.yaml:providers', [
      { providerId: 'p1', providerType: 'local', configuration: {}, enabled: true },
      { providerId: 'p2', providerType: 'oidc', configuration: {}, enabled: true },
    ]);
    const res = await fetch(url('/workspace/admin/setup/identity-providers/p1'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    expect(manifestWriter._store.get('config/identity/providers.v1.yaml:providers')).toHaveLength(
      1
    );
  });

  it('DELETE /identity-providers/:id — allows removing a disabled provider even if it is last', async () => {
    manifestWriter._store.set('config/identity/providers.v1.yaml:providers', [
      { providerId: 'disabled-only', providerType: 'local', configuration: {}, enabled: false },
    ]);
    const res = await fetch(url('/workspace/admin/setup/identity-providers/disabled-only'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });

  it('POST /identity-providers — rejects unknown extra fields (.strict)', async () => {
    const res = await fetch(url('/workspace/admin/setup/identity-providers'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        providerId: 'x',
        providerType: 'local',
        configuration: {},
        enabled: true,
        someUnknownField: 'reject me',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ── Approval channels (AMEND-admin-dashboard §3.2) ──────────────────────

  it('POST /approval-channels — adds a slack channel', async () => {
    const res = await fetch(url('/workspace/admin/setup/approval-channels'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        channelId: 'ops-slack',
        channelType: 'slack',
        configuration: {
          workspaceUrl: 'https://example.slack.com',
          channel: '#approvals',
          botTokenRef: 'file:SLACK_BOT_TOKEN',
        },
        enabled: true,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { channelId: string; requiresRestart: boolean };
    };
    expect(body.data.channelId).toBe('ops-slack');
    expect(body.data.requiresRestart).toBe(true);
  });

  it('PUT /approval-channels/:id — updates configuration', async () => {
    manifestWriter._store.set('config/channels/channels.v1.yaml:channels', [
      { channelId: 'webhook-1', channelType: 'webhook', configuration: {}, enabled: true },
    ]);
    const res = await fetch(url('/workspace/admin/setup/approval-channels/webhook-1'), {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ configuration: { url: 'https://hook.example/cb', timeoutMs: 8000 } }),
    });
    expect(res.status).toBe(200);
    const updated = manifestWriter._store.get('config/channels/channels.v1.yaml:channels')?.[0];
    expect((updated?.['configuration'] as Record<string, unknown>)?.['timeoutMs']).toBe(8000);
  });

  it('DELETE /approval-channels/:id — refuses last enabled channel', async () => {
    manifestWriter._store.set('config/channels/channels.v1.yaml:channels', [
      { channelId: 'cli', channelType: 'cli', configuration: {}, enabled: true },
    ]);
    const res = await fetch(url('/workspace/admin/setup/approval-channels/cli'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/last enabled approval channel/i);
  });

  it('DELETE /approval-channels/:id — succeeds with multiple enabled channels', async () => {
    manifestWriter._store.set('config/channels/channels.v1.yaml:channels', [
      { channelId: 'cli', channelType: 'cli', configuration: {}, enabled: true },
      { channelId: 'webhook-1', channelType: 'webhook', configuration: {}, enabled: true },
    ]);
    const res = await fetch(url('/workspace/admin/setup/approval-channels/webhook-1'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
  });

  // ── Orchestrators (AMEND-admin-dashboard §3.3) ──────────────────────────

  const fullOrchestratorBody = (overrides: Record<string, unknown> = {}) => ({
    orchestratorSocketId: 'ref-2',
    orchestratorType: 'reference_deterministic',
    enabled: true,
    orchestratorActorId: '00000000-0000-4000-a000-000000000002',
    plannerMode: 'deterministic_first',
    maxSplitDepth: 3,
    planCheckbackDefault: true,
    secureMode: {
      octSecureDefault: 'single_agent_no_helper',
      allowSecureMultiAgentOnlyBySignedPolicy: true,
    },
    retryPolicy: { transientAutoRetryCount: 1 },
    timeouts: { systemActionMs: 30000, modelCallMs: 60000 },
    outputSlotPolicy: 'strict_declared_slots',
    configuration: {},
    plannerType: 'db-lexicon-transformer-v0',
    plannerVersion: '0.1.0',
    plannerConfiguration: {},
    planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: false },
    partialCompletion: {
      enabled: true,
      minRequiredCompletedNodes: 1,
      compileOnPartial: true,
    },
    maxToolTurnsPerNode: 6,
    ...overrides,
  });

  it('POST /orchestrators — adds an orchestrator with full nested config', async () => {
    const res = await fetch(url('/workspace/admin/setup/orchestrators'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(fullOrchestratorBody()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { orchestratorSocketId: string; requiresRestart: boolean };
    };
    expect(body.data.orchestratorSocketId).toBe('ref-2');
    expect(body.data.requiresRestart).toBe(true);
  });

  it('POST /orchestrators — rejects maxToolTurnsPerNode < 1', async () => {
    const res = await fetch(url('/workspace/admin/setup/orchestrators'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(fullOrchestratorBody({ maxToolTurnsPerNode: 0 })),
    });
    expect(res.status).toBe(400);
  });

  it('POST /orchestrators — rejects bogus plannerMode', async () => {
    const res = await fetch(url('/workspace/admin/setup/orchestrators'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify(fullOrchestratorBody({ plannerMode: 'bogus' })),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /orchestrators/:socketId — updates maxToolTurnsPerNode', async () => {
    manifestWriter._store.set('config/orchestrators/orchestrators.v1.yaml:orchestrators', [
      fullOrchestratorBody({ orchestratorSocketId: 'ref-1' }),
    ]);
    const res = await fetch(url('/workspace/admin/setup/orchestrators/ref-1'), {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ maxToolTurnsPerNode: 3 }),
    });
    expect(res.status).toBe(200);
    const updated = manifestWriter._store.get(
      'config/orchestrators/orchestrators.v1.yaml:orchestrators'
    )?.[0];
    expect(updated?.['maxToolTurnsPerNode']).toBe(3);
  });

  it('DELETE /orchestrators/:socketId — refuses last enabled orchestrator', async () => {
    manifestWriter._store.set('config/orchestrators/orchestrators.v1.yaml:orchestrators', [
      fullOrchestratorBody({ orchestratorSocketId: 'only-orch' }),
    ]);
    const res = await fetch(url('/workspace/admin/setup/orchestrators/only-orch'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/last enabled orchestrator/i);
  });

  // ── Lock status ─────────────────────────────────────────────────────────

  it('GET /lock/endpoints — reports unlocked when no writes pending', async () => {
    const res = await fetch(url('/workspace/admin/setup/lock/endpoints'), {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { locked: boolean } };
    expect(body.data.locked).toBe(false);
  });

  it('GET /lock/actors — always unlocked (SQLite, no file lock)', async () => {
    const res = await fetch(url('/workspace/admin/setup/lock/actors'), {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { locked: boolean } };
    expect(body.data.locked).toBe(false);
  });
});

// ─── Missing deps — 501 ────────────────────────────────────────────────────

describe('admin-writer without manifestWriter', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const fixture = buildApp({ includeManifestWriter: false });
    const r = await fixture.start();
    port = r.port;
    server = r.server;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('POST /endpoints returns 501 when manifestWriter missing', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/endpoints`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Identity': JSON.stringify({
          kind: 'admin',
          principalId: ADMIN_PID,
          actorId: ADMIN_AID,
        }),
        'X-Elevated-Session': VALID_ELEV,
      },
      body: JSON.stringify({
        endpointId: 'x',
        url: 'http://x',
        adapterId: 'ollama-chat-v1',
        modelName: 'x',
      }),
    });
    expect(res.status).toBe(501);
  });
});

describe('admin-writer without actorRegistry', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const fixture = buildApp({ includeActorRegistry: false });
    const r = await fixture.start();
    port = r.port;
    server = r.server;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('POST /actors returns 501 when actorRegistry missing', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/actors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Identity': JSON.stringify({
          kind: 'admin',
          principalId: ADMIN_PID,
          actorId: ADMIN_AID,
        }),
        'X-Elevated-Session': VALID_ELEV,
      },
      body: JSON.stringify({
        actorId: 'x',
        actorClass: 'SUPERVISED_AGENT',
        displayName: 'x',
      }),
    });
    expect(res.status).toBe(501);
  });
});

// ─── Secret routes (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC) ────────────────────

describe('admin-writer secret routes', () => {
  let server: Server;
  let port: number;
  let secretWriter: ReturnType<typeof createMockSecretWriter>;
  let runLedgerWriter: ReturnType<typeof createMockRunLedgerWriter>;

  beforeAll(async () => {
    const fixture = buildApp({});
    const r = await fixture.start();
    port = r.port;
    server = r.server;
    secretWriter = fixture.secretWriter;
    runLedgerWriter = fixture.runLedgerWriter;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    secretWriter._values.clear();
    runLedgerWriter._entries.length = 0;
    delete process.env['ADMIN_WRITER_TEST_ENV_KEY'];
  });

  it('POST /secrets stores a key and never echoes the value', async () => {
    const TEST_VAL = 'sk-do-not-echo-me-7f3c-9a';
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: TEST_VAL }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.keyName).toBe('OPENAI_API_KEY');
    expect(body.data.stored).toBe(true);
    expect(body.data.source).toBe('file');
    // Crucially — value is NOT echoed back anywhere.
    expect(JSON.stringify(body)).not.toContain(TEST_VAL);
    // Underlying writer received the value.
    expect(secretWriter._values.get('OPENAI_API_KEY')).toBe(TEST_VAL);
  });

  it('POST /secrets rejects keyName with disallowed characters (400)', async () => {
    for (const bad of ['lowercase', 'has space', 'with-dash', '../escape', 'colon:nope']) {
      const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ keyName: bad, keyValue: 'v' }),
      });
      expect(res.status).toBe(400);
    }
  });

  it('POST /secrets rejects empty keyValue (400)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /secrets requires admin role (403 for plain user)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: plainHeaders(),
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: 'v' }),
    });
    expect(res.status).toBe(403);
  });

  it('POST /secrets requires elevated session header (403 when missing)', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Identity': JSON.stringify({
          kind: 'admin',
          principalId: ADMIN_PID,
          actorId: ADMIN_AID,
        }),
      },
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: 'v' }),
    });
    expect(res.status).toBe(403);
  });

  it('GET /secrets/status reports presence + source, never values', async () => {
    const TEST_VAL = 'sk-secret-7f3c-9a';
    secretWriter._values.set('OPENAI_API_KEY', TEST_VAL);
    process.env['ADMIN_WRITER_TEST_ENV_KEY'] = 'env-leaks-here';

    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets/status`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain(TEST_VAL);
    expect(JSON.stringify(body)).not.toContain('env-leaks-here');
    const openai = body.data.keys.find((k: { keyName: string }) => k.keyName === 'OPENAI_API_KEY');
    expect(openai).toBeDefined();
    expect(openai.present).toBe(true);
    expect(openai.source).toBe('file');
    const anthropic = body.data.keys.find(
      (k: { keyName: string }) => k.keyName === 'ANTHROPIC_API_KEY'
    );
    expect(anthropic).toBeDefined();
    expect(anthropic.present).toBe(false);
    expect(anthropic.source).toBeNull();
  });

  it('GET /secrets/status reports env-side keys when file-side is missing', async () => {
    process.env['OPENAI_API_KEY'] = 'env-managed-value';
    try {
      const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets/status`, {
        headers: adminHeaders(),
      });
      const body = await res.json();
      const openai = body.data.keys.find(
        (k: { keyName: string }) => k.keyName === 'OPENAI_API_KEY'
      );
      expect(openai.present).toBe(true);
      expect(openai.source).toBe('env');
    } finally {
      delete process.env['OPENAI_API_KEY'];
    }
  });

  it('DELETE /secrets/:keyName removes the key', async () => {
    secretWriter._values.set('OPENAI_API_KEY', 'sk-x');
    const res = await fetch(
      `http://127.0.0.1:${port}/workspace/admin/setup/secrets/OPENAI_API_KEY`,
      { method: 'DELETE', headers: adminHeaders() }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.removed).toBe(true);
    expect(secretWriter._values.has('OPENAI_API_KEY')).toBe(false);
  });

  it('DELETE /secrets/:keyName returns removed=false for unknown key', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets/MISSING_KEY`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.removed).toBe(false);
  });

  it('DELETE /secrets/:keyName rejects bad key names (400)', async () => {
    const res = await fetch(
      `http://127.0.0.1:${port}/workspace/admin/setup/secrets/lowercase-bad`,
      { method: 'DELETE', headers: adminHeaders() }
    );
    expect(res.status).toBe(400);
  });

  // ── Audit events (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC FLAG-2) ─────────────

  it('POST /secrets emits a secret_stored audit event with no value leakage', async () => {
    const TEST_VAL = 'sk-audit-do-not-leak-9k4e';
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: TEST_VAL }),
    });
    expect(res.status).toBe(200);
    expect(runLedgerWriter._entries).toHaveLength(1);
    const entry = runLedgerWriter._entries[0]!;
    expect(entry.eventType).toBe('secret_stored');
    expect(entry.actorId).toBe(ADMIN_AID);
    expect(entry.detail['adminOperation']).toBe(true);
    expect(entry.detail['keyName']).toBe('OPENAI_API_KEY');
    expect(entry.detail['principalId']).toBe(ADMIN_PID);
    expect(entry.detail['storageLabel']).toBe('mock://secrets');
    // The value MUST NOT appear anywhere in the audit entry.
    expect(JSON.stringify(entry)).not.toContain(TEST_VAL);
  });

  it('POST /secrets does NOT emit an audit event on validation failure', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ keyName: 'lowercase-bad', keyValue: 'v' }),
    });
    expect(res.status).toBe(400);
    expect(runLedgerWriter._entries).toHaveLength(0);
  });

  it('POST /secrets does NOT emit an audit event on auth failure', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: plainHeaders(),
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: 'v' }),
    });
    expect(res.status).toBe(403);
    expect(runLedgerWriter._entries).toHaveLength(0);
  });

  it('DELETE /secrets/:keyName emits a secret_removed audit event', async () => {
    secretWriter._values.set('OPENAI_API_KEY', 'sk-x');
    const res = await fetch(
      `http://127.0.0.1:${port}/workspace/admin/setup/secrets/OPENAI_API_KEY`,
      { method: 'DELETE', headers: adminHeaders() }
    );
    expect(res.status).toBe(200);
    expect(runLedgerWriter._entries).toHaveLength(1);
    const entry = runLedgerWriter._entries[0]!;
    expect(entry.eventType).toBe('secret_removed');
    expect(entry.actorId).toBe(ADMIN_AID);
    expect(entry.detail['adminOperation']).toBe(true);
    expect(entry.detail['keyName']).toBe('OPENAI_API_KEY');
    expect(entry.detail['principalId']).toBe(ADMIN_PID);
  });

  it('DELETE /secrets/:keyName does NOT emit audit when no key was removed', async () => {
    // Key absent — delete is a no-op — no credential state changed, so no audit.
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets/MISSING_KEY`, {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.removed).toBe(false);
    expect(runLedgerWriter._entries).toHaveLength(0);
  });

  it('audit ledger failure does NOT roll back a successful key write', async () => {
    // Local fixture so we can swap in a writer that throws — we want the
    // request to still succeed (best-effort audit) and the key to be stored.
    const localSecret = createMockSecretWriter();
    const throwingLedger: RunLedgerWriter = {
      async writeEvent(): Promise<void> {
        throw new Error('ledger backend down');
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
    const localApp = express();
    localApp.use(express.json());
    localApp.use('/workspace', fakeJwtMiddleware);
    registerAdminWriterRoutes(localApp, {
      elevatedAuthProvider: mockElevatedAuth,
      secretWriter: localSecret,
      runLedgerWriter: throwingLedger,
    });
    const localServer = await new Promise<{ port: number; server: Server }>(resolve => {
      const s = localApp.listen(0, '127.0.0.1', () => {
        const a = s.address() as AddressInfo;
        resolve({ port: a.port, server: s });
      });
    });
    try {
      // Silence the warn() emitted by the audit helper for this single case.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = await fetch(
        `http://127.0.0.1:${localServer.port}/workspace/admin/setup/secrets`,
        {
          method: 'POST',
          headers: adminHeaders(),
          body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: 'sk-still-stored' }),
        }
      );
      expect(res.status).toBe(200);
      expect(localSecret._values.get('OPENAI_API_KEY')).toBe('sk-still-stored');
      // A warning must have been logged so operators can detect the gap.
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    } finally {
      await new Promise<void>(resolve => localServer.server.close(() => resolve()));
    }
  });
});

describe('admin-writer without secretWriter', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const fixture = buildApp({ includeSecretWriter: false });
    const r = await fixture.start();
    port = r.port;
    server = r.server;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('POST /secrets returns 501 when secretWriter not configured', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ keyName: 'OPENAI_API_KEY', keyValue: 'v' }),
    });
    expect(res.status).toBe(501);
  });

  it('GET /secrets/status still works (env-only) without a secretWriter', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/secrets/status`, {
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.storageLabel).toBeNull();
  });
});
