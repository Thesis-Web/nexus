/**
 * Admin Setup Routes — tests
 * SPEC-addendum-beta1-admin-dashboard-v0-1 §3 (Claude C)
 *
 * Covers:
 *   1. 401 without JWT-populated res.locals (claims missing)
 *   2. 403 without admin role (claims present but role assignments lack 'nexus-admin')
 *   3. 403 without X-Elevated-Session header
 *   4. 403 with invalid elevated session
 *   5. 200 with all three auth checks satisfied → shape matches
 *      DashboardSetupStatusResponse (11 surfaces, summary, mode, generatedBy)
 *   6. 200 for valid surfaceId; 404 for unknown
 *   7. secretFields never echo raw values (only fieldPath + status)
 *   8. surfaces.length === 11 (one per DashboardSurfaceCategory)
 *
 * Test seam: we construct a minimal Express app and install a fake JWT
 * middleware that reads `X-Test-Identity` and populates res.locals before
 * calling registerAdminSetupRoutes. This is isolated from the workspace
 * route module — we exercise the admin-setup module in isolation.
 *
 * No supertest dependency. We use app.listen(0) + fetch() against an
 * ephemeral port.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerAdminSetupRoutes } from '../../packages/interfaces/api/src/routes/admin-setup.js';
import type {
  IdentityClaims,
  ElevatedAuthProvider,
  ElevatedSession,
  ElevatedSessionStatus,
  ElevatedAuthChallengeRequest,
  ElevatedAuthChallenge,
  ElevatedAuthVerifyRequest,
  Uuid,
  NonEmpty,
} from '@nexus/contracts';
import { ADMIN_ROLE } from '../../packages/contracts/src/externals/dashboard-setup.js';

// ─── Fake JWT middleware (mimics workspace.ts:326-382 contract) ────────────

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
    ident.kind === 'admin' ? ([ADMIN_ROLE] as NonEmpty[]) : (['user'] as NonEmpty[]);
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

// ─── Mock ElevatedAuthProvider ──────────────────────────────────────────────

const VALID_ELEVATED_SESSION_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_PRINCIPAL_ID = '22222222-2222-2222-2222-222222222222';

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
    if (
      (elevatedSessionId as string) === VALID_ELEVATED_SESSION_ID &&
      principalId === ADMIN_PRINCIPAL_ID
    ) {
      return { valid: true, remainingSeconds: 600 };
    }
    return { valid: false, remainingSeconds: 0, reason: 'mock-rejected' as NonEmpty };
  },
};

// ─── App fixture ───────────────────────────────────────────────────────────

function buildApp(includeElevatedAuth: boolean): {
  app: express.Express;
  start: () => Promise<{ port: number; server: Server }>;
} {
  const app = express();
  app.use(express.json());
  // Apply fake JWT middleware ONLY under /workspace (mirrors real wiring).
  app.use('/workspace', fakeJwtMiddleware);

  registerAdminSetupRoutes(app, {
    ...(includeElevatedAuth ? { elevatedAuthProvider: mockElevatedAuth } : {}),
    // Minimal data to exercise composers — most surfaces will be `missing`/`partial`.
    identityRecords: [
      {
        providerId: 'ria' as NonEmpty,
        providerType: 'reference_adapter' as NonEmpty,
        configuration: {},
      },
    ],
    connectorRecords: [
      {
        connectorId: 'stub' as NonEmpty,
        connectorType: 'stub' as NonEmpty,
        allowedSystems: ['*'],
        configuration: {},
      },
    ],
    channelRecords: [],
    endpoints: [
      {
        endpointId: 'local-ollama' as NonEmpty,
        tier: 'on_prem_general' as NonEmpty,
        url: 'http://localhost:11434/api/chat' as NonEmpty,
        adapterId: 'ollama-chat-v1' as NonEmpty,
        modelName: 'llama3.2' as NonEmpty,
        auth: { kind: 'none' },
        timeoutMs: 30000,
        adapterConfig: {},
        healthy: true,
        lastCheckAt: new Date().toISOString() as NonEmpty,
      },
      {
        endpointId: 'anthropic' as NonEmpty,
        tier: 'frontier_general' as NonEmpty,
        url: 'https://api.anthropic.com' as NonEmpty,
        adapterId: 'anthropic-messages-v1' as NonEmpty,
        modelName: 'claude-sonnet' as NonEmpty,
        auth: {
          kind: 'api_key',
          secretRef: 'FIXTURE_SYNTHETIC_SECRET:ANTHROPIC_API_KEY' as NonEmpty,
          headerName: 'x-api-key' as NonEmpty,
        },
        adapterConfig: {},
        healthy: false,
        lastCheckAt: new Date().toISOString() as NonEmpty,
      },
    ] as never, // ModelEndpoint type is structurally satisfied; cast avoids deep import friction
  });

  const start = async (): Promise<{ port: number; server: Server }> =>
    new Promise(resolve => {
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        resolve({ port: addr.port, server });
      });
    });

  return { app, start };
}

// ─── Test suite ─────────────────────────────────────────────────────────────

describe('admin-setup routes', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const fixture = buildApp(true);
    const r = await fixture.start();
    port = r.port;
    server = r.server;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const url = (p: string): string => `http://127.0.0.1:${port}${p}`;

  function adminHeaders(elevatedSession: string | undefined): Record<string, string> {
    const h: Record<string, string> = {
      'X-Test-Identity': JSON.stringify({
        kind: 'admin',
        principalId: ADMIN_PRINCIPAL_ID,
        actorId: '33333333-3333-3333-3333-333333333333',
      }),
    };
    if (elevatedSession !== undefined) h['X-Elevated-Session'] = elevatedSession;
    return h;
  }

  function plainHeaders(): Record<string, string> {
    return {
      'X-Test-Identity': JSON.stringify({
        kind: 'plain',
        principalId: ADMIN_PRINCIPAL_ID,
        actorId: '44444444-4444-4444-4444-444444444444',
      }),
      'X-Elevated-Session': VALID_ELEVATED_SESSION_ID,
    };
  }

  it('returns 401 when JWT did not populate claims', async () => {
    const res = await fetch(url('/workspace/admin/setup/status'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('returns 403 when caller has no admin role', async () => {
    const res = await fetch(url('/workspace/admin/setup/status'), { headers: plainHeaders() });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/admin role/i);
  });

  it('returns 403 when X-Elevated-Session header is missing', async () => {
    const res = await fetch(url('/workspace/admin/setup/status'), {
      headers: adminHeaders(undefined),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/elevated[ -]session/i);
  });

  it('returns 403 when elevated session id is invalid', async () => {
    const res = await fetch(url('/workspace/admin/setup/status'), {
      headers: adminHeaders('00000000-0000-0000-0000-000000000000'),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.error).toMatch(/elevated[ -]session/i);
  });

  it('returns 200 + 11 surfaces when fully authed', async () => {
    const res = await fetch(url('/workspace/admin/setup/status'), {
      headers: adminHeaders(VALID_ELEVATED_SESSION_ID),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: true;
      generatedAt: string;
      generatedBy: { actorId: string; principalId: string };
      surfaces: Array<{ surfaceId: string; state: string; secretFields: Array<unknown> }>;
      summary: Record<string, number>;
    };
    expect(body.ok).toBe(true);
    expect(body.generatedBy.principalId).toBe(ADMIN_PRINCIPAL_ID);
    expect(body.surfaces).toHaveLength(11);
    const counts = Object.values(body.summary).reduce((a, b) => a + b, 0);
    expect(counts).toBe(11);
  });

  it('returns 404 for unknown surfaceId', async () => {
    const res = await fetch(url('/workspace/admin/setup/surfaces/nonexistent'), {
      headers: adminHeaders(VALID_ELEVATED_SESSION_ID),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 for known surfaceId (identity)', async () => {
    const res = await fetch(url('/workspace/admin/setup/surfaces/identity'), {
      headers: adminHeaders(VALID_ELEVATED_SESSION_ID),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: true; data: { surfaceId: string } };
    expect(body.data.surfaceId).toBe('identity');
  });

  it('never echoes raw secret values in secretFields', async () => {
    const res = await fetch(url('/workspace/admin/setup/status'), {
      headers: adminHeaders(VALID_ELEVATED_SESSION_ID),
    });
    const body = (await res.json()) as {
      surfaces: Array<{
        secretFields: Array<{ fieldPath: string; status: string; value?: unknown }>;
      }>;
    };
    for (const surface of body.surfaces) {
      for (const field of surface.secretFields) {
        expect(['present', 'missing', 'unknown']).toContain(field.status);
        // The shape must be exactly { fieldPath, status }. No `value`, no leak.
        expect(field).not.toHaveProperty('value');
        expect(Object.keys(field).sort()).toEqual(['fieldPath', 'status']);
      }
    }
  });

  it('reports FIXTURE_SYNTHETIC_SECRET refs as missing, never present', async () => {
    const res = await fetch(url('/workspace/admin/setup/surfaces/models_nvg'), {
      headers: adminHeaders(VALID_ELEVATED_SESSION_ID),
    });
    const body = (await res.json()) as {
      data: { secretFields: Array<{ fieldPath: string; status: string }> };
    };
    const fixtureRef = body.data.secretFields.find(f =>
      f.fieldPath.includes('anthropic.auth.secretRef')
    );
    expect(fixtureRef).toBeDefined();
    expect(fixtureRef?.status).toBe('missing');
  });
});

// ─── Setup without elevated auth provider — should reject 403 ──────────────

describe('admin-setup without elevatedAuthProvider', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const fixture = buildApp(false);
    const r = await fixture.start();
    port = r.port;
    server = r.server;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('returns 403 explaining elevated session validator missing', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/workspace/admin/setup/status`, {
      headers: {
        'X-Test-Identity': JSON.stringify({
          kind: 'admin',
          principalId: ADMIN_PRINCIPAL_ID,
          actorId: '33333333-3333-3333-3333-333333333333',
        }),
        'X-Elevated-Session': VALID_ELEVATED_SESSION_ID,
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/elevated session validator/i);
  });
});
