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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerAdminWriterRoutes } from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type { ManifestWriter } from '../../packages/interfaces/api/src/routes/admin-writer.js';
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

// ─── App fixture ────────────────────────────────────────────────────────────

function buildApp(opts: {
  includeElevatedAuth?: boolean;
  includeManifestWriter?: boolean;
  includeActorRegistry?: boolean;
  includePrincipalRegistry?: boolean;
}): {
  app: express.Express;
  start: () => Promise<{ port: number; server: Server }>;
  manifestWriter: ReturnType<typeof createMockManifestWriter>;
  actorRegistry: ReturnType<typeof createMockActorRegistry>;
  principalRegistry: ReturnType<typeof createMockPrincipalRegistry>;
} {
  const app = express();
  app.use(express.json());
  app.use('/workspace', fakeJwtMiddleware);

  const manifestWriter = createMockManifestWriter();
  const actorRegistry = createMockActorRegistry();
  const principalRegistry = createMockPrincipalRegistry();

  registerAdminWriterRoutes(app, {
    ...(opts.includeElevatedAuth !== false ? { elevatedAuthProvider: mockElevatedAuth } : {}),
    ...(opts.includeManifestWriter !== false ? { manifestWriter } : {}),
    ...(opts.includeActorRegistry !== false ? { actorRegistry } : {}),
    ...(opts.includePrincipalRegistry !== false ? { principalRegistry } : {}),
  });

  const start = async (): Promise<{ port: number; server: Server }> =>
    new Promise(resolve => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        resolve({ port: addr.port, server });
      });
    });

  return { app, start, manifestWriter, actorRegistry, principalRegistry };
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
    const res = await fetch(url('/workspace/admin/setup/connectors'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        connectorId: 'test-pg',
        connectorType: 'stub',
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
      body: JSON.stringify({ connectorId: 'to-rm', connectorType: 'stub' }),
    });
    const res = await fetch(url('/workspace/admin/setup/connectors/to-rm'), {
      method: 'DELETE',
      headers: adminHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { removed: boolean } };
    expect(body.data.removed).toBe(true);
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
