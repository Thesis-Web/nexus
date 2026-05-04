/**
 * Workspace Governed Route — AMEND-nexus-spec-workspace-v1-1-1 §5, §6, §7
 *
 * File: packages/interfaces/api/src/routes/workspace.ts
 * Layer 7 — governed workspace routes with JWT auth split.
 * Imports @nexus/contracts ONLY. Service instances injected by DI.
 *
 * Route registration order (§5.1, GWS5-AUD-01):
 *   1. POST /workspace/auth/login — NO JWT required (issues the JWT)
 *   2. Blanket /workspace/* JWT middleware
 *   3. All other /workspace/* routes (protected by JWT)
 *
 * Auth split (T16-F02): workspace routes use JWT, admin routes use bearer token.
 * Principal binding (T8-F02): principalId from server-resolved claims, never body.
 * JWT secret fail-closed (GWS5-N02): if workspaceJwtSecret missing → 501 / reject.
 *
 * OD-WS-ROUTE-001: Replaces EXT-12 reference harness workspace route.
 * Body-supplied principalId is no longer accepted on governed routes.
 */
import type { Express, Request, Response, NextFunction } from 'express';
import type {
  RunLedgerWriter,
  IdentityProviderInterface,
  WorkspaceRunRequest,
  WorkspaceManifestRecord,
  WorkspaceSessionStorePort,
  WorkspaceRunAclStorePort,
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
  IdentityClaims,
} from '@nexus/contracts';
import { nowIso, addSeconds } from '@nexus/contracts';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { san } from './shared.js';

// ─── DI Dependencies ────────────────────────────────────────────────────────

export interface WorkspaceRouteDeps {
  runLedgerWriter: RunLedgerWriter;
  identityProvider: IdentityProviderInterface;
  workspaceSockets: readonly WorkspaceManifestRecord[];
  computeDigest: (obj: unknown) => Sha256Hex;
  dispatchToOrchestrator?: (request: WorkspaceRunRequest) => Promise<unknown>;
  /** Workspace session store — required for JWT login/validation [§5.2, §5.3] */
  workspaceSessionStore?: WorkspaceSessionStorePort;
  /** HMAC-SHA256 shared secret for workspace JWTs [§5.7] */
  workspaceJwtSecret?: string;
  /** Run ACL store for per-run authorization [§6.1 step 6, §6.3] */
  workspaceRunAclStore?: WorkspaceRunAclStorePort;
}

// ─── JWT Helpers (reference-only HMAC-SHA256) ────────────────────────────────

interface WorkspaceJwtPayload {
  sub: string;
  sid: string;
  exp: number;
  iat: number;
}

function base64urlEncode(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

function signJwt(payload: WorkspaceJwtPayload, secret: string): string {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = base64urlEncode(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token: string, secret: string): WorkspaceJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const headerB64 = parts[0]!;
  const payloadB64 = parts[1]!;
  const signatureB64 = parts[2]!;

  // Verify header
  try {
    const header = JSON.parse(base64urlDecode(headerB64).toString('utf-8')) as {
      alg?: string;
    };
    if (header.alg !== 'HS256') return null;
  } catch {
    return null;
  }

  // Verify HMAC signature (timing-safe)
  const expected = createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest();
  const actual = base64urlDecode(signatureB64);
  if (expected.length !== actual.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected[i]! ^ actual[i]!;
  }
  if (mismatch !== 0) return null;

  // Decode payload
  try {
    const payload = JSON.parse(
      base64urlDecode(payloadB64).toString('utf-8')
    ) as WorkspaceJwtPayload;
    if (!payload.sub || !payload.sid || typeof payload.exp !== 'number') return null;
    // Check expiry
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Route Registration ─────────────────────────────────────────────────────

/** Default workspace session TTL: 8 hours */
const SESSION_TTL_SECONDS = 8 * 60 * 60;

// ─── §4 Zod Validation (route-layer only, NOT in contracts) ─────────────────
// Schemas per [blueprint §3.8.1]. discriminatedUnion per promptMode.
// outputFormat bound to OUTPUT_FORMAT_VALUES. .strict() per branch.

const ModelPreferenceSchema = z
  .object({
    agentId: z.string(),
    modelTier: z.string(),
    mode: z.enum(['available', 'preferred']),
  })
  .strict();

const FreeTextSchema = z
  .object({
    promptMode: z.literal('free_text'),
    prompt: z.string().min(1),
    agents: z.array(z.string()).optional(),
    modelPreferences: z.array(ModelPreferenceSchema).optional(),
    attachmentIds: z.array(z.string()).optional(),
  })
  .strict();

const SectionedSchema = z
  .object({
    promptMode: z.literal('sectioned'),
    prompt: z.string().min(1),
    templateId: z.string(),
    templateVersion: z.string(),
    outputFormat: z.enum(['prose', 'table', 'raw', 'mixed', 'file_bundle']).optional(),
    connectors: z.array(z.string()).optional(),
    executionMode: z.enum(['human_in_the_loop', 'autonomous']).optional(),
    agents: z.array(z.string()).optional(),
    modelPreferences: z.array(ModelPreferenceSchema).optional(),
    attachmentIds: z.array(z.string()).optional(),
  })
  .strict();

const SecureRailsSchema = z
  .object({
    promptMode: z.literal('secure_rails'),
    railId: z.string(),
    railVersion: z.string(),
    elevatedSessionId: z.string(),
    constrainedInputs: z.record(z.string(), z.string()).optional(),
    attachmentIds: z.array(z.string()).optional(),
  })
  .strict();

const WorkspacePromptInputSchema = z.discriminatedUnion('promptMode', [
  FreeTextSchema,
  SectionedSchema,
  SecureRailsSchema,
]);

export function registerWorkspaceRoutes(app: Express, deps: Partial<WorkspaceRouteDeps>): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // §5.2 POST /workspace/auth/login — NO JWT required [GWS5-AUD-01]
  // Registered BEFORE the blanket /workspace/* JWT middleware.
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/auth/login', async (req: Request, res: Response) => {
    // §5.7: JWT secret fail-closed
    if (!deps.workspaceJwtSecret) {
      res.status(501).json({ ok: false, error: 'Workspace JWT not configured' });
      return;
    }
    if (!deps.identityProvider || !deps.workspaceSessionStore) {
      res.status(501).json({ ok: false, error: 'Workspace auth not configured' });
      return;
    }

    try {
      const body = req.body as Record<string, unknown>;
      const credType = body['type'] as string | undefined;
      const credValue = body['value'] as string | undefined;

      if (!credType || !credValue) {
        res.status(400).json({ ok: false, error: 'type and value required' });
        return;
      }

      // §5.2 step 1: authenticate via identityProvider
      const actorId = await deps.identityProvider.authenticate({
        type: credType as 'api_key' | 'jwt' | 'oauth_token',
        value: credValue as NonEmpty,
      });

      // §5.2 step 2: resolve identity → five claims
      const claims = await deps.identityProvider.resolveIdentity(actorId);
      if (!claims) {
        res.status(403).json({ ok: false, error: 'Identity resolution failed' });
        return;
      }

      // §5.2 step 3-4: mint session
      const workspaceAuthSessionId = randomUUID() as Uuid;
      const issuedAt = nowIso();
      const expiresAt = addSeconds(issuedAt, SESSION_TTL_SECONDS);

      const session = {
        workspaceAuthSessionId,
        principalId: claims.principalIdentity,
        actorId: actorId as Uuid,
        issuedAt,
        expiresAt,
      };

      // §5.2 step 5: store session
      deps.workspaceSessionStore.create(session);

      // §5.2 step 6: issue workspace JWT
      const nowSec = Math.floor(Date.now() / 1000);
      const token = signJwt(
        {
          sub: actorId,
          sid: workspaceAuthSessionId,
          exp: nowSec + SESSION_TTL_SECONDS,
          iat: nowSec,
        },
        deps.workspaceJwtSecret
      );

      // §5.2 step 7: return
      res.json({
        ok: true,
        data: { token, workspaceAuthSessionId, expiresAt },
      });
    } catch (err) {
      res.status(401).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §5.3 JWT Middleware — blanket /workspace/* [GWS3-AUD-04]
  // Registered AFTER login route. Applies to all other /workspace/* routes.
  // ═══════════════════════════════════════════════════════════════════════════

  app.use('/workspace', async (req: Request, res: Response, next: NextFunction) => {
    // §5.7: JWT secret fail-closed
    if (!deps.workspaceJwtSecret || !deps.workspaceSessionStore || !deps.identityProvider) {
      res.status(501).json({ ok: false, error: 'Workspace JWT not configured' });
      return;
    }

    // Extract Bearer token
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    // §5.3 step 1: verify JWT signature
    const payload = verifyJwt(token, deps.workspaceJwtSecret);
    if (!payload) {
      res.status(401).json({ ok: false, error: 'Invalid or expired token' });
      return;
    }

    // §5.3 step 2-3: extract sid, load session [GWS3-AUD-04]
    const session = await deps.workspaceSessionStore.get(payload.sid as Uuid);
    if (!session) {
      res.status(401).json({ ok: false, error: 'Session not found or expired' });
      return;
    }

    // §5.3 step 5: verify session.actorId === payload.sub [GWS3-AUD-04]
    if (session.actorId !== payload.sub) {
      res.status(401).json({ ok: false, error: 'Session actor mismatch' });
      return;
    }

    // §5.3 step 6: re-resolve claims
    const claims = await deps.identityProvider.resolveIdentity(payload.sub as NonEmpty);
    if (!claims) {
      res.status(403).json({ ok: false, error: 'Identity resolution failed' });
      return;
    }

    // §5.3 step 7: verify claims.principalIdentity === session.principalId [GWS3-AUD-04]
    if (claims.principalIdentity !== session.principalId) {
      res.status(401).json({ ok: false, error: 'Principal identity mismatch' });
      return;
    }

    // §5.3 step 8: attach to request via res.locals
    res.locals['principalId'] = claims.principalIdentity;
    res.locals['actorId'] = payload.sub;
    res.locals['claims'] = claims;
    res.locals['workspaceAuthSessionId'] = payload.sid;

    next();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §6.1 POST /workspace/runs — governed workspace entry
  // Principal from server-resolved claims (T8-F02), never body.
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/runs', async (req: Request, res: Response) => {
    if (
      !deps.runLedgerWriter ||
      !deps.identityProvider ||
      !deps.workspaceSockets ||
      !deps.computeDigest
    ) {
      res.status(501).json({ ok: false, error: 'Workspace not configured' });
      return;
    }

    try {
      // §6.1 step 2: validate body with Zod schema [§4]
      const parsed = WorkspacePromptInputSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.message });
        return;
      }
      const input = parsed.data;

      // Extract prompt: free_text/sectioned have .prompt, secure_rails uses constrainedInputs
      let prompt: string;
      let selectedAgentIds: string[] = [];
      const planCheckbackRequested = false;

      switch (input.promptMode) {
        case 'free_text':
        case 'sectioned':
          prompt = input.prompt;
          selectedAgentIds = (input.agents ?? []) as string[];
          break;
        case 'secure_rails':
          prompt = JSON.stringify(input.constrainedInputs ?? {});
          break;
      }

      // §5.5 Principal binding (T8-F02): server-resolved, never body-supplied
      const principalId = res.locals['principalId'] as string;
      const actorId = res.locals['actorId'] as string;

      // Resolve first enabled workspace socket
      const workspace = deps.workspaceSockets.find(ws => ws.enabled);
      if (!workspace) {
        res.status(503).json({ ok: false, error: 'No enabled workspace socket' });
        return;
      }

      // §6.1 steps 2-4
      const runId = randomUUID() as Uuid;
      const enteredAt = nowIso();
      const workspaceSocketId = workspace.workspaceSocketId;

      const promptDigest = deps.computeDigest({
        runId,
        prompt,
        enteredAt,
        workspaceSocketId,
      });

      // §6.1 step 5: build WorkspaceRunRequest
      const request: WorkspaceRunRequest = {
        runId,
        userId: actorId as NonEmpty,
        principalId: principalId as Uuid,
        authenticatedBy: deps.identityProvider.providerType as NonEmpty,
        enteredAt,
        prompt: prompt as NonEmpty,
        promptDigest,
        promptRef: null,
        selectedAgentIds: selectedAgentIds as Uuid[],
        workspaceSocketId,
        planCheckbackRequested,
      };

      // §6.1 step 5: write run_opened — no raw prompt in detail (hard rule 19)
      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'run_opened',
        timestamp: enteredAt,
        actorId: null,
        detail: {
          workspaceSocketId,
          userId: actorId,
          principalId,
          authenticatedBy: deps.identityProvider.providerType,
          promptDigest,
          selectedAgentIds: request.selectedAgentIds,
          planCheckbackRequested: request.planCheckbackRequested,
        },
      });

      // §6.1 step 6: store RunAcl [blueprint §5.3-5.4]
      if (deps.workspaceRunAclStore) {
        deps.workspaceRunAclStore.store({
          runId,
          principalId,
          actorId: actorId as Uuid,
          permittedViewers: [principalId],
        });
      }

      // §6.2: dispatch to orchestrator if wired
      let planPreview: unknown = null;
      if (deps.dispatchToOrchestrator) {
        planPreview = await deps.dispatchToOrchestrator(request);
      }

      res.json({ ok: true, data: { runId, planPreview } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── GET /workspace/runs/:runId — run status (JWT protected) ────────────────

  app.get('/workspace/runs/:runId', async (req: Request, res: Response) => {
    if (!deps.runLedgerWriter) {
      res.status(501).json({ ok: false, error: 'Workspace not configured' });
      return;
    }

    try {
      const runId = req.params['runId'] as Uuid;

      // §6.3: RunAcl check — cross-run access denied [gate 7]
      if (deps.workspaceRunAclStore) {
        const principalId = res.locals['principalId'] as string;
        const authorized = await deps.workspaceRunAclStore.isAuthorized(runId, principalId);
        if (!authorized) {
          res.status(403).json({ ok: false, error: 'Not authorized for this run' });
          return;
        }
      }

      const events = await deps.runLedgerWriter.getByRunId(runId);

      if (events.length === 0) {
        res.status(404).json({ ok: false, error: 'Run not found' });
        return;
      }

      const isClosed = events.some(e => e.eventType === 'run_closed');

      res.json({
        ok: true,
        data: {
          runId,
          eventCount: events.length,
          eventTypes: events.map(e => e.eventType),
          status: isClosed ? 'closed' : 'open',
          lastEvent: events[events.length - 1]?.eventType ?? null,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
