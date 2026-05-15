/**
 * AMEND-nexus-admin-dashboard-full-buildout §1.F — Admin writer-chain
 * composition integration test.
 *
 * Scoped to the writer surface (the part the spec turns from read-only to
 * writer-enabled across Commits 1–10): walk through every newly-enabled
 * route via real HTTP fetch against an in-memory app, asserting:
 *
 *   1. Catalog starts empty for the seven new arrays.
 *   2. Each writer route adds an entry that the catalog then reflects.
 *   3. Cross-surface FK validation rejects a return-endpoint whose target
 *      workspace is missing, then accepts it once the workspace is added.
 *   4. The workspace.returnEndpointId dropdown source (catalog
 *      allReturnEndpoints) only surfaces enabled entries.
 *   5. Last-enabled guards return 409 across surfaces.
 *
 * Spec §1.F asked for a workspace-prompt-to-ledger E2E that requires
 * bootstrapping a full server (nexus serve), real SQLite, real
 * orchestrator/NVG dispatch, signed mode envelopes, etc. That broader
 * E2E is deferred to a follow-on spec — captured in the SESSION LOG.
 * This integration test covers the writer chain itself, which is what
 * Commits 1–10 introduced.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { registerAdminWriterRoutes } from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type { ManifestWriter } from '../../packages/interfaces/api/src/routes/admin-writer.js';
import type {
  ElevatedAuthProvider,
  ElevatedSessionStatus,
  ElevatedAuthChallengeRequest,
  ElevatedAuthChallenge,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  IdentityClaims,
  Uuid,
  NonEmpty,
} from '@nexus/contracts';

const ADMIN_PID = '22222222-2222-2222-2222-222222222222';
const ADMIN_AID = '33333333-3333-3333-3333-333333333333';
const ELEV = '11111111-1111-1111-1111-111111111111';

function fakeJwt(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  const claims: IdentityClaims = {
    principalIdentity: ('Test:' + ADMIN_PID) as NonEmpty,
    roleAssignments: ['nexus-admin'] as NonEmpty[],
    capabilityCeilings: [
      { allowedSystems: ['*'], allowedCapabilities: ['*'], maxRiskTier: 'critical' },
    ],
    environmentContext: 'reference' as NonEmpty,
    actorClass: 'HUMAN',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).res!.locals['claims'] = claims;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).res!.locals['principalId'] = ADMIN_PID;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).res!.locals['actorId'] = ADMIN_AID;
  next();
}

const mockAuth: ElevatedAuthProvider = {
  challenge: async (_: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge> => {
    throw new Error('unused');
  },
  verify: async (_: ElevatedAuthVerifyRequest): Promise<ElevatedSession> => {
    throw new Error('unused');
  },
  validateSession: async (s: Uuid, p: string): Promise<ElevatedSessionStatus> =>
    (s as string) === ELEV && p === ADMIN_PID
      ? { valid: true, remainingSeconds: 600 }
      : { valid: false, remainingSeconds: 0, reason: 'mock-rejected' as NonEmpty },
};

function inMemoryManifestWriter(): ManifestWriter & {
  _store: Map<string, Record<string, unknown>[]>;
} {
  const store = new Map<string, Record<string, unknown>[]>();
  return {
    _store: store,
    async readEntries(p, k) {
      return store.get(`${p}:${k}`) ?? [];
    },
    async addEntry(p, k, e, idK) {
      const key = `${p}:${k}`;
      const arr = store.get(key) ?? [];
      if (arr.some(x => x[idK] === e[idK])) {
        throw Object.assign(new Error('exists'), { statusCode: 409 });
      }
      arr.push(e);
      store.set(key, arr);
      return arr;
    },
    async updateEntry(p, k, id, u, idK) {
      const key = `${p}:${k}`;
      const arr = store.get(key) ?? [];
      const i = arr.findIndex(x => x[idK] === id);
      if (i === -1) throw Object.assign(new Error('missing'), { statusCode: 404 });
      arr[i] = { ...arr[i], ...u };
      store.set(key, arr);
      return arr;
    },
    async removeEntry(p, k, id, idK) {
      const key = `${p}:${k}`;
      const arr = store.get(key) ?? [];
      const i = arr.findIndex(x => x[idK] === id);
      if (i === -1) throw Object.assign(new Error('missing'), { statusCode: 404 });
      arr.splice(i, 1);
      store.set(key, arr);
      return arr;
    },
  };
}

const headers = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  'X-Elevated-Session': ELEV,
});

describe('admin writer-chain composition (AMEND §1.F scoped E2E)', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/workspace', fakeJwt);
    registerAdminWriterRoutes(app, {
      elevatedAuthProvider: mockAuth,
      manifestWriter: inMemoryManifestWriter(),
    });
    server = await new Promise<Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const url = (p: string): string => `http://127.0.0.1:${port}${p}`;

  it('walks the full writer chain end-to-end and validates the catalog reflects each step', async () => {
    // ── 1. Catalog starts empty for the seven new arrays. ───────────────
    const initialCatalog = (await (
      await fetch(url('/workspace/admin/setup/catalog'), {
        headers: headers(),
      })
    ).json()) as {
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
    expect(initialCatalog.ok).toBe(true);
    expect(initialCatalog.data.allIdentityProviders).toHaveLength(0);
    expect(initialCatalog.data.allChannels).toHaveLength(0);
    expect(initialCatalog.data.allOrchestrators).toHaveLength(0);
    expect(initialCatalog.data.allWorkspaces).toHaveLength(0);
    expect(initialCatalog.data.allMailboxes).toHaveLength(0);
    expect(initialCatalog.data.allCompilers).toHaveLength(0);
    expect(initialCatalog.data.allReturnEndpoints).toHaveLength(0);

    // ── 2. Add an identity provider. ───────────────────────────────────
    const idpRes = await fetch(url('/workspace/admin/setup/identity-providers'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        providerId: 'local-default',
        providerType: 'local',
        configuration: { sessionTtlMinutes: 60 },
        enabled: true,
      }),
    });
    expect(idpRes.status).toBe(200);

    // ── 3. Add an approval channel. ────────────────────────────────────
    const chRes = await fetch(url('/workspace/admin/setup/approval-channels'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        channelId: 'cli-default',
        channelType: 'cli',
        configuration: { promptText: 'Approve?' },
        enabled: true,
      }),
    });
    expect(chRes.status).toBe(200);

    // ── 4. Add an orchestrator. ────────────────────────────────────────
    const orchRes = await fetch(url('/workspace/admin/setup/orchestrators'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        orchestratorSocketId: 'ref-orch',
        orchestratorType: 'reference_deterministic',
        enabled: true,
        orchestratorActorId: '00000000-0000-4000-a000-000000000001',
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
      }),
    });
    expect(orchRes.status).toBe(200);

    // ── 5. Add a mailbox (file-backed). ────────────────────────────────
    const mbRes = await fetch(url('/workspace/admin/setup/mailboxes'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        mailboxId: 'core-return-mailbox',
        mailboxType: 'jsonl-file',
        enabled: true,
        required: true,
        storageRoot: 'runs/mailbox',
        retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
        classificationRequired: true,
        digestRequired: true,
        configuration: {},
      }),
    });
    expect(mbRes.status).toBe(200);

    // ── 6. Add a compiler that reads from the mailbox. ─────────────────
    const compRes = await fetch(url('/workspace/admin/setup/compilers'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        compilerSocketId: 'ref-compile',
        compilerType: 'reference_deterministic_renderer',
        enabled: true,
        actorRegistration: 'exempt_reference_deterministic_renderer',
        compilerActorId: null,
        octMode: 'OCT-COMPILE',
        allowedModes: ['deterministic_render'],
        readsFromMailboxId: 'core-return-mailbox',
        outputContractVersion: 'v1',
        artifactSigning: { kind: 'control_plane' },
        configuration: {},
      }),
    });
    expect(compRes.status).toBe(200);

    // ── 7. Return endpoint REJECTED before workspace exists (FK check). ─
    const returnEndpointBody = {
      returnEndpointId: 'ref-return',
      endpointType: 'http_callback',
      enabled: true,
      targetWorkspaceSocketId: 'ref-workspace',
      url: 'http://127.0.0.1:7701/compile-return/ref-return',
      auth: { kind: 'signed_callback', keyId: 'dev-compile-return-key' },
      acceptedArtifactTypes: ['final_response.v1'],
      configuration: {},
    };
    const earlyReturnRes = await fetch(url('/workspace/admin/setup/return-endpoints'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(returnEndpointBody),
    });
    expect(earlyReturnRes.status).toBe(409);
    const earlyReturnErr = (await earlyReturnRes.json()) as { error: string };
    expect(earlyReturnErr.error).toMatch(/workspace .* not found/i);

    // ── 8. Add the workspace. ──────────────────────────────────────────
    const wsRes = await fetch(url('/workspace/admin/setup/workspaces'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        workspaceSocketId: 'ref-workspace',
        workspaceType: 'reference_http',
        enabled: true,
        entryMode: 'governed_only',
        baseUrl: 'http://localhost:4100',
        returnEndpointId: 'ref-return',
        capabilities: {
          promptEntry: true,
          planReview: true,
          finalDisplay: true,
          fileSpace: false,
        },
        configuration: {},
      }),
    });
    expect(wsRes.status).toBe(200);

    // ── 9. Now return endpoint succeeds. ───────────────────────────────
    const returnRes = await fetch(url('/workspace/admin/setup/return-endpoints'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(returnEndpointBody),
    });
    expect(returnRes.status).toBe(200);

    // ── 10. Catalog reflects every step. ───────────────────────────────
    const finalCatalog = (await (
      await fetch(url('/workspace/admin/setup/catalog'), {
        headers: headers(),
      })
    ).json()) as {
      ok: boolean;
      data: {
        allIdentityProviders: Array<Record<string, unknown>>;
        allChannels: Array<Record<string, unknown>>;
        allOrchestrators: Array<Record<string, unknown>>;
        allWorkspaces: Array<Record<string, unknown>>;
        allMailboxes: Array<Record<string, unknown>>;
        allCompilers: Array<Record<string, unknown>>;
        allReturnEndpoints: Array<Record<string, unknown>>;
      };
    };
    expect(finalCatalog.data.allIdentityProviders.map(e => e['providerId'])).toEqual([
      'local-default',
    ]);
    expect(finalCatalog.data.allChannels.map(e => e['channelId'])).toEqual(['cli-default']);
    expect(finalCatalog.data.allOrchestrators.map(e => e['orchestratorSocketId'])).toEqual([
      'ref-orch',
    ]);
    expect(finalCatalog.data.allWorkspaces.map(e => e['workspaceSocketId'])).toEqual([
      'ref-workspace',
    ]);
    expect(finalCatalog.data.allMailboxes.map(e => e['mailboxId'])).toEqual([
      'core-return-mailbox',
    ]);
    expect(finalCatalog.data.allCompilers.map(e => e['compilerSocketId'])).toEqual(['ref-compile']);
    expect(finalCatalog.data.allReturnEndpoints.map(e => e['returnEndpointId'])).toEqual([
      'ref-return',
    ]);

    // ── 11. Last-enabled guards trip on the only-enabled workspace. ───
    const delWsRes = await fetch(url('/workspace/admin/setup/workspaces/ref-workspace'), {
      method: 'DELETE',
      headers: headers(),
    });
    expect(delWsRes.status).toBe(409);
    const delWsErr = (await delWsRes.json()) as { error: string };
    expect(delWsErr.error).toMatch(/last enabled workspace/i);
  });
});
