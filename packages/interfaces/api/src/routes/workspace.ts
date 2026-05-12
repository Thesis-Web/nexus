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
  WorkspaceEventTicketStorePort,
  WorkspaceEventTicket,
  WorkspaceFileStorePort,
  WorkspaceBlobStorePort,
  WorkspaceFileReference,
  Uuid,
  NonEmpty,
  Sha256Hex,
  IsoTimestamp,
  IdentityClaims,
  PromptTemplateStorePort,
  SecureRailStorePort,
  AdminSignerRegistry,
  WorkspaceApprovalBridge,
  PromptTemplate,
  SecureRail,
  ApprovalResponse,
  ElevatedAuthProvider,
  ElevatedAuthChallengeRequest,
  ElevatedAuthVerifyRequest,
  ElevatedSession,
  ElevatedSessionStatus,
  ElevatedAuthChallenge,
  WorkspaceCatalogReaderPort,
  CatalogItem,
} from '@nexus/contracts';
import { nowIso, addSeconds } from '@nexus/contracts';
import { createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Readable } from 'node:stream';
import { san } from './shared.js';
import { subscribeToRun } from './run-event-bus.js';

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
  /** Event ticket store for WS/SSE stream auth [§7.7] */
  workspaceEventTicketStore?: WorkspaceEventTicketStorePort;
  /** File metadata store [§6.5] */
  workspaceFileStore?: WorkspaceFileStorePort;
  /** Blob content store — streaming [§6.5, hard rule 21] */
  workspaceBlobStore?: WorkspaceBlobStorePort;
  /** Prompt template store [§7.4, gate 9] */
  promptTemplateStore?: PromptTemplateStorePort;
  /** Secure rail store [§7.4, gate 10] */
  secureRailStore?: SecureRailStorePort;
  /** Admin signer registry — NOT approver keys (hard rule 32) [§7.4] */
  adminSignerRegistry?: AdminSignerRegistry;
  /** Workspace approval bridge [§7.5, blueprint §3.5.3] */
  workspaceApprovalBridge?: WorkspaceApprovalBridge;
  /** Signature verification function (injected by bootstrap) [§7.4] */
  verifySignature?: (payload: string, signature: string, publicKey: string) => Promise<boolean>;
  /** Elevated auth provider [blueprint §3.9, §7.3] */
  elevatedAuthProvider?: ElevatedAuthProvider;
  /** Catalog reader [blueprint §4.2-4.4] */
  catalogReader?: WorkspaceCatalogReaderPort;
  /**
   * CHECKBACK-spec — resolves a pending plan_checkback Deferred. Bound by
   * the composition root; the POST /workspace/runs/:runId/checkback route
   * delegates here so the orchestrator's awaiting promise wakes with the
   * user's allow/deny decision. Returns true iff a checkback was pending.
   */
  resolvePendingCheckback?: (runId: Uuid, allow: boolean) => Promise<boolean>;
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

// ─── Multi-node planner sub-task input schemas ───
// AMEND-spec-nexus-orch §5 extension. These are optional on the
// run-submit input; when omitted the legacy single-prompt path
// applies. The planner does deeper structural validation
// (subTaskKey uniqueness, edge cycles, slot ref resolution); these
// schemas just keep the API gate tight on the wire shape.

const SlotReadRefSchema = z
  .object({
    fromSubTaskKey: z.string().min(1),
    slotId: z.string().min(1),
  })
  .strict();

const NxsActionTemplateSchema = z
  .object({
    capability: z.string().min(1),
    target: z
      .object({
        system: z.string().min(1),
        resourceType: z.string().min(1),
        resourceScope: z.string().min(1),
      })
      .strict(),
    rawPayload: z.unknown(),
  })
  .strict();

const NvgSubTaskSchema = z
  .object({
    kind: z.literal('nvg'),
    subTaskKey: z.string().min(1),
    agentId: z.string().min(1),
    taskSummary: z.string().min(1),
    expectedOutputSlots: z.array(z.string().min(1)),
    inputSlotReads: z.array(SlotReadRefSchema),
    taskPrompt: z.string().min(1).nullable(),
  })
  .strict();

const NxsSubTaskSchema = z
  .object({
    kind: z.literal('nxs'),
    subTaskKey: z.string().min(1),
    agentId: z.string().min(1),
    taskSummary: z.string().min(1),
    expectedOutputSlots: z.array(z.string().min(1)),
    inputSlotReads: z.array(SlotReadRefSchema),
    actionTemplate: NxsActionTemplateSchema,
  })
  .strict();

const SecureHandoffSubTaskSchema = z
  .object({
    kind: z.literal('secure_handoff'),
    subTaskKey: z.string().min(1),
    agentId: z.string().min(1),
    taskSummary: z.string().min(1),
    expectedOutputSlots: z.array(z.string().min(1)),
    inputSlotReads: z.array(SlotReadRefSchema),
    taskPrompt: z.string().min(1).nullable(),
  })
  .strict();

const SubTaskDeclSchema = z.discriminatedUnion('kind', [
  NvgSubTaskSchema,
  NxsSubTaskSchema,
  SecureHandoffSubTaskSchema,
]);

const SubTaskEdgeHintSchema = z
  .object({
    sourceSubTaskKey: z.string().min(1),
    targetSubTaskKey: z.string().min(1),
    edgeType: z.enum(['data_dependency', 'conditional', 'sequential']),
    conditionSpec: z
      .object({
        sourceField: z.string().min(1),
        operator: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
      .strict()
      .nullable(),
    outputSlotRef: z.string().min(1).nullable(),
  })
  .strict();

const FreeTextSchema = z
  .object({
    promptMode: z.literal('free_text'),
    prompt: z.string().min(1),
    agents: z.array(z.string()).optional(),
    /**
     * V1 model selection: a single endpointId (CatalogItem.id from
     * /workspace/catalogs/models). Optional — absence means "Auto (policy)".
     * The modelPreferences[] field is kept as a back-compat shim; the route
     * builder extracts the first entry's modelTier as preferredEndpointId
     * when this direct field is omitted.
     */
    preferredEndpointId: z.string().optional(),
    modelPreferences: z.array(ModelPreferenceSchema).optional(),
    attachmentIds: z.array(z.string()).optional(),
    /**
     * AMEND-spec-nexus-orch §5 extension — optional structured sub-task DAG.
     * When non-empty the orchestrator emits one node per sub-task (multi-
     * node planner) instead of one node per agent (legacy path). Edges
     * keyed by subTaskKey via subTaskEdges. The bash-script workflow
     * shapes (parallel fan-out, sequential pipes, judge routing) submit
     * via this field.
     */
    subTasks: z.array(SubTaskDeclSchema).optional(),
    subTaskEdges: z.array(SubTaskEdgeHintSchema).optional(),
    /**
     * AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 — additive optional
     * field. Non-null when this run was opened via the
     * Accept-Suggestions flow on a prior preferred-agents preflight
     * rejection; carries the prior runId for audit correlation. Null
     * on fresh runs. Server-side passes through to
     * `WorkspaceRunRequest.checkbackSourceRunId` without business logic.
     */
    checkbackSourceRunId: z.string().uuid().optional(),
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
    preferredEndpointId: z.string().optional(),
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

// §4: VaultAuthSchema — discriminatedUnion on 'action' [challenge, verify]
const VaultChallengeSchema = z
  .object({
    action: z.literal('challenge'),
    principalId: z.string(),
    method: z.string(),
  })
  .strict();

const VaultVerifySchema = z
  .object({
    action: z.literal('verify'),
    challengeId: z.string(),
    principalId: z.string(),
    method: z.string(),
    response: z.string(),
  })
  .strict();

const VaultAuthSchema = z.discriminatedUnion('action', [VaultChallengeSchema, VaultVerifySchema]);

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
    res.locals['expiresAt'] = new Date(payload.exp * 1000).toISOString();

    next();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /workspace/me — workspace session reflection [GATE-DEPLOY-001]
  // Returns current caller's identity from JWT claims. Stateless.
  // Does NOT store, enumerate, or return tokens/secrets.
  // This is workspace-scoped session reflection, NOT centralized IAM.
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/workspace/me', (_req: Request, res: Response) => {
    const claims = res.locals['claims'] as IdentityClaims | undefined;
    res.json({
      ok: true,
      data: {
        actorId: res.locals['actorId'] ?? null,
        principalId: res.locals['principalId'] ?? null,
        workspaceAuthSessionId: res.locals['workspaceAuthSessionId'] ?? null,
        expiresAt: res.locals['expiresAt'] ?? null,
        claims: claims
          ? {
              roleAssignments: claims.roleAssignments,
              capabilityCeilings: claims.capabilityCeilings,
              environmentContext: claims.environmentContext,
              actorClass: claims.actorClass,
            }
          : null,
      },
    });
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
      let preferredEndpointId: string | null = null;
      const planCheckbackRequested = false;
      let subTasks: z.infer<typeof SubTaskDeclSchema>[] | null = null;
      let subTaskEdges: z.infer<typeof SubTaskEdgeHintSchema>[] | null = null;

      switch (input.promptMode) {
        case 'free_text':
          prompt = input.prompt;
          selectedAgentIds = (input.agents ?? []) as string[];
          // CLAUDE-CODE-MODEL-SELECTION-SPEC §1c — accept the direct
          // preferredEndpointId. For back-compat: if the legacy
          // modelPreferences[] array is provided without preferredEndpointId,
          // extract the first entry's modelTier (which is in fact an
          // endpointId, despite the misleading field name in older clients).
          if (input.preferredEndpointId !== undefined && input.preferredEndpointId !== '') {
            preferredEndpointId = input.preferredEndpointId;
          } else if (input.modelPreferences && input.modelPreferences.length > 0) {
            const firstPref = input.modelPreferences[0];
            if (firstPref && firstPref.modelTier !== '') {
              preferredEndpointId = firstPref.modelTier;
            }
          }
          // AMEND-spec-nexus-orch §5 extension — multi-node submit shape.
          if (input.subTasks && input.subTasks.length > 0) {
            subTasks = input.subTasks;
            subTaskEdges = input.subTaskEdges ?? [];
          }
          break;
        case 'sectioned':
          prompt = input.prompt;
          selectedAgentIds = (input.agents ?? []) as string[];
          if (input.preferredEndpointId !== undefined && input.preferredEndpointId !== '') {
            preferredEndpointId = input.preferredEndpointId;
          } else if (input.modelPreferences && input.modelPreferences.length > 0) {
            const firstPref = input.modelPreferences[0];
            if (firstPref && firstPref.modelTier !== '') {
              preferredEndpointId = firstPref.modelTier;
            }
          }
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

      // CLAUDE-CODE-FILE-ATTACH Phase A — collected after the existing
      // classify+bind loop so file content rides into the run request only
      // for governance-cleared bytes. Empty when no attachments were sent.
      const attachedFiles: Array<{
        fileId: string;
        filename: string;
        mediaType: string;
        content: string;
      }> = [];

      // §6.1 step 5: write run_opened — no raw prompt in detail (hard rule 19)
      // CLAUDE-CODE-MODEL-SELECTION-SPEC §5 — preferredEndpointId in audit
      // trail records what the user asked for; the dispatch event later
      // records what was actually used and whether the preference was honored.
      // (attachedFiles metadata is appended below after binding completes —
      // the run_opened event documents what the run was OPENED with, but we
      // need the bound file list before we can include it.)
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
          selectedAgentIds,
          planCheckbackRequested,
          preferredEndpointId,
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

      // §6.1 step 7: if attachmentIds, classify → bind or quarantine [§6.4]
      if (
        'attachmentIds' in input &&
        input.attachmentIds &&
        input.attachmentIds.length > 0 &&
        deps.workspaceFileStore &&
        deps.workspaceBlobStore
      ) {
        for (const attachId of input.attachmentIds) {
          const fileRef = await Promise.resolve(deps.workspaceFileStore.get(attachId as Uuid));
          if (!fileRef || fileRef.status !== 'staged') {
            // Write run_closed on bind failure (hard rule 26)
            await deps.runLedgerWriter.writeEvent({
              runId,
              eventType: 'run_closed',
              timestamp: nowIso(),
              actorId: null,
              detail: { closeReason: `Attachment ${attachId} not found or not staged` },
            });
            res.status(400).json({ ok: false, error: `Attachment ${attachId} invalid` });
            return;
          }

          // §6.4: classify FIRST (reference stub — production: real classifier)
          const classification = { pass: true, labels: ['unclassified'] as string[] };

          if (!classification.pass) {
            // Quarantine: markQuarantined + blobStore.quarantine + ledger + run_closed
            deps.workspaceFileStore.markQuarantined(
              attachId as Uuid,
              'Classification failed',
              classification.labels
            );
            await deps.workspaceBlobStore.quarantine(fileRef.storedAt);
            await deps.runLedgerWriter.writeEvent({
              runId,
              eventType: 'workspace_file_quarantined',
              timestamp: nowIso(),
              actorId: null,
              detail: {
                fileId: attachId,
                sha256: fileRef.sha256,
                reason: 'Classification failed',
                classificationState: 'rejected',
                auditTargetRunId: runId,
              },
            });
            // Hard rule 26: run failure after run_opened → run_closed
            await deps.runLedgerWriter.writeEvent({
              runId,
              eventType: 'run_closed',
              timestamp: nowIso(),
              actorId: null,
              detail: { closeReason: `File ${attachId} quarantined` },
            });
            res.status(400).json({ ok: false, error: `File ${attachId} quarantined` });
            return;
          }

          // §6.4: classify passed → bind
          await Promise.resolve(
            deps.workspaceFileStore.bindToRun(attachId as Uuid, runId, classification.labels)
          );
          await deps.runLedgerWriter.writeEvent({
            runId,
            eventType: 'workspace_file_bound',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              fileId: attachId,
              runId,
              sha256: fileRef.sha256,
              classificationLabels: classification.labels,
            },
          });

          // CLAUDE-CODE-FILE-ATTACH Phase A — read the bound bytes from the
          // blob store and decode them for the prompt payload. Text-like
          // media types are decoded as UTF-8; everything else is base64
          // (Phase A passes only text content into the model — see
          // makeDispatchToGovernance — but base64 keeps the wire shape
          // uniform for future binary/vision support).
          //
          // This is the ONLY place file content is loaded into memory.
          // It rides on WorkspaceRunRequest.attachedFiles long enough for
          // the orchestrator to assemble the NVG payload, then is dropped.
          // Never written to the run ledger; never persisted in storage.
          const stream = await deps.workspaceBlobStore.read(fileRef.storedAt);
          if (stream === null) {
            // Bound file should always be readable; missing bytes is a
            // backend integrity error. Close the run rather than ship a
            // bound-but-empty file silently.
            await deps.runLedgerWriter.writeEvent({
              runId,
              eventType: 'run_closed',
              timestamp: nowIso(),
              actorId: null,
              detail: {
                closeReason: `Attachment ${attachId} bound but blob unreadable`,
              },
            });
            res.status(500).json({
              ok: false,
              error: `Attachment ${attachId} bytes unavailable`,
            });
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const buffer = Buffer.concat(chunks);
          const isTextLike =
            /^(text\/|application\/json|application\/xml|application\/javascript|application\/x-yaml)/.test(
              fileRef.mediaType
            );
          attachedFiles.push({
            fileId: attachId as string,
            filename: fileRef.declaredFilename,
            mediaType: fileRef.mediaType,
            content: isTextLike ? buffer.toString('utf-8') : buffer.toString('base64'),
          });
        }

        // CLAUDE-CODE-FILE-ATTACH Phase A §5 — log attachment metadata
        // (NOT content) so operators can see what files entered the run
        // without bloating the ledger with potentially-huge file bytes.
        if (attachedFiles.length > 0) {
          await deps.runLedgerWriter.writeEvent({
            runId,
            eventType: 'workspace_file_attached',
            timestamp: nowIso(),
            actorId: null,
            detail: {
              attachedFileCount: attachedFiles.length,
              attachedFiles: attachedFiles.map(f => ({
                fileId: f.fileId,
                filename: f.filename,
                mediaType: f.mediaType,
                sizeChars: f.content.length,
              })),
            },
          });
        }
      }

      // §6.1 step 5 (deferred): build WorkspaceRunRequest now that any
      // attached files have been classified, bound, and read. The request
      // carries `attachedFiles` so the orchestrator can hand the content
      // to NVG without re-reading from the blob store.
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
        preferredEndpointId: preferredEndpointId as NonEmpty | null,
        attachedFiles,
        // AMEND-spec-nexus-orch §5 extension — null on legacy submits.
        subTasks: subTasks as WorkspaceRunRequest['subTasks'],
        subTaskEdges: subTaskEdges as WorkspaceRunRequest['subTaskEdges'],
        // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 — additive
        // field. Non-null when the operator accepted a counter-suggestion
        // from a prior run's preferred-agents preflight rejection; the
        // value is the originally-rejected runId for audit correlation.
        // Only `free_text` mode currently carries the field in the input
        // schema; other modes default to null.
        checkbackSourceRunId:
          input.promptMode === 'free_text' && input.checkbackSourceRunId
            ? (input.checkbackSourceRunId as Uuid)
            : null,
      };

      // §8.1/§8.2: secure rail events (gate 14) — write if promptMode === 'secure_rails'
      if (input.promptMode === 'secure_rails') {
        const railId = input.railId;
        const railVersion = input.railVersion;
        const elevSessionId = input.elevatedSessionId;

        // workspace_secure_rail_selected — required details: railId, railVersion, principalId, elevatedSessionId
        await deps.runLedgerWriter.writeEvent({
          runId,
          eventType: 'workspace_secure_rail_selected',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            railId,
            railVersion,
            principalId,
            elevatedSessionId: elevSessionId,
          },
        });

        // workspace_secure_rail_submitted — required details: railId, railVersion, runId, agentId, modelTier, elevatedSessionId
        // Load rail to get agentId and modelTier
        let railAgentId: string = 'unknown';
        let railModelTier: string = 'unknown';
        if (deps.secureRailStore) {
          const rail = await deps.secureRailStore.get(railId, railVersion);
          if (rail) {
            railAgentId = rail.agentId;
            railModelTier = rail.modelTier;
          }
        }

        await deps.runLedgerWriter.writeEvent({
          runId,
          eventType: 'workspace_secure_rail_submitted',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            railId,
            railVersion,
            runId,
            agentId: railAgentId,
            modelTier: railModelTier,
            elevatedSessionId: elevSessionId,
          },
        });
      }

      // §6.2: dispatch to orchestrator if wired.
      //
      // CLAUDE-CODE-FIX-SSE-AND-PLAN-REVIEW BUG-1 (Cause A) — the run was
      // already created on disk (run_opened was written and ACL stored), so
      // the POST must always return `{ ok:true, runId }` so the client can
      // establish the SSE subscription. Governed denials flow through the
      // coordinator cleanly today, but an UNEXPECTED throw inside the
      // dispatch chain previously bubbled to the catch below and surfaced as
      // a 500 with no runId — leaving the client unable to subscribe and
      // unable to recover without a hard refresh. Catch here, log, and
      // persist a synthetic run_closed so the run doesn't hang forever and
      // the timeline shows error state via the SSE replay.
      let planPreview: unknown = null;
      if (deps.dispatchToOrchestrator) {
        try {
          planPreview = await deps.dispatchToOrchestrator(request);
        } catch (dispatchErr) {
          // eslint-disable-next-line no-console
          console.error('[workspace] dispatchToOrchestrator threw —', dispatchErr);
          try {
            await deps.runLedgerWriter.writeEvent({
              runId,
              eventType: 'run_closed',
              timestamp: nowIso(),
              actorId: null,
              detail: {
                closeReason: 'error',
                error: dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr),
              },
            });
          } catch {
            // ledger fanout failure isn't fatal here — the SSE response is
            // about to return, and the client will see error state via
            // either the run-status route or a stale-stream timeout.
          }
          planPreview = null;
        }
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
      const rejectionEvent = events.find(e => e.eventType === 'plan_rejected');

      res.json({
        ok: true,
        data: {
          runId,
          eventCount: events.length,
          eventTypes: events.map(e => e.eventType),
          status: isClosed ? 'closed' : 'open',
          lastEvent: events[events.length - 1]?.eventType ?? null,
          ...(rejectionEvent
            ? {
                rejection: {
                  reason:
                    (rejectionEvent.detail as Record<string, unknown>)?.['reason'] ?? 'unknown',
                  reasonDetail:
                    (rejectionEvent.detail as Record<string, unknown>)?.['reasonDetail'] ?? '',
                },
              }
            : {}),
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §6.5 POST /workspace/files — file staging (streaming upload)
  // JWT protected. File bodies streaming only (hard rule 21).
  // Logs workspace_file_staged with infra runId (NOT user runId) [§6.5, gate 13]
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/files', async (req: Request, res: Response) => {
    if (!deps.workspaceFileStore || !deps.workspaceBlobStore || !deps.runLedgerWriter) {
      res.status(501).json({ ok: false, error: 'File staging not configured' });
      return;
    }

    try {
      const principalId = res.locals['principalId'] as string;

      // §6.5 step 2: fileId BEFORE blob write
      const fileId = randomUUID() as Uuid;

      // Determine stream source and metadata
      let stream: NodeJS.ReadableStream;
      let declaredFilename: string;
      let declaredMediaType: string;

      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json') && req.body) {
        // JSON upload (reference convenience) — convert base64 to stream
        const body = req.body as Record<string, unknown>;
        declaredFilename = (body['filename'] as string) || 'unnamed';
        declaredMediaType = (body['mediaType'] as string) || 'application/octet-stream';
        const data = Buffer.from((body['data'] as string) || '', 'base64');
        stream = Readable.from(data);
      } else {
        // Streaming upload (production path) — hard rule 21
        declaredFilename = (req.headers['x-filename'] as string) || 'unnamed';
        declaredMediaType = contentType || 'application/octet-stream';
        stream = req;
      }

      // §6.5 step 3: stream to blobStore.write
      const result = await deps.workspaceBlobStore.write({
        fileId,
        stream,
        declaredMediaType,
        maxSizeBytes: 50 * 1024 * 1024, // 50MB default
      });

      // §6.5 step 4: store file metadata
      const fileRef: WorkspaceFileReference = {
        fileId,
        sha256: result.sha256 as Sha256Hex,
        declaredFilename,
        mediaType: declaredMediaType,
        sizeBytes: result.sizeBytes,
        classificationLabels: [],
        provenance: 'user_upload',
        storedAt: result.storedAt,
        runId: null,
        uploadedByPrincipalId: principalId,
        uploadedAt: nowIso(),
        status: 'staged',
      };
      await Promise.resolve(deps.workspaceFileStore.store(fileRef));

      // §6.5 step 5: log workspace_file_staged with infra runId (NOT user runId)
      const infraRunId = randomUUID() as Uuid;
      await deps.runLedgerWriter.writeEvent({
        runId: infraRunId,
        eventType: 'workspace_file_staged',
        timestamp: nowIso(),
        actorId: null,
        detail: {
          fileId,
          sha256: result.sha256,
          sizeBytes: result.sizeBytes,
          mediaType: declaredMediaType,
          uploadedByPrincipalId: principalId,
        },
      });

      // §6.5 step 6: return
      res.json({ ok: true, data: { fileId, sha256: result.sha256 } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('maximum allowed size')) {
        res.status(413).json({ ok: false, error: 'File too large' });
        return;
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7.2 GET /workspace/templates — list active prompt templates
  // JWT protected. Returns non-disabled templates only.
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/workspace/templates', async (req: Request, res: Response) => {
    if (!deps.promptTemplateStore) {
      res.status(501).json({ ok: false, error: 'Template store not configured' });
      return;
    }

    try {
      const templates = await deps.promptTemplateStore.list();
      res.json({ ok: true, data: templates });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7.2 POST /workspace/vault/auth — elevated re-authentication
  // JWT protected. VaultAuthSchema discriminated union (challenge | verify).
  // Blueprint §3.9: configurable timeout, cannot be silently extended.
  // Hard rule 6: elevated re-auth ≠ OCT change.
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/vault/auth', async (req: Request, res: Response) => {
    if (!deps.elevatedAuthProvider || !deps.runLedgerWriter) {
      res.status(501).json({ ok: false, error: 'Elevated auth not configured' });
      return;
    }

    try {
      const parsed = VaultAuthSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: parsed.error.message });
        return;
      }
      const input = parsed.data;

      if (input.action === 'challenge') {
        const challenge: ElevatedAuthChallenge = await deps.elevatedAuthProvider.challenge({
          principalId: input.principalId,
          method: input.method,
        });
        res.json({ ok: true, data: challenge });
      } else {
        // action === 'verify'
        const session: ElevatedSession = await deps.elevatedAuthProvider.verify({
          challengeId: input.challengeId as Uuid,
          principalId: input.principalId,
          method: input.method,
          response: input.response,
        });

        // §8.2: workspace_vault_session_opened event — required details
        await deps.runLedgerWriter.writeEvent({
          runId: randomUUID() as Uuid,
          eventType: 'workspace_vault_session_opened',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            principalId: input.principalId,
            elevatedSessionId: session.elevatedSessionId,
            authMethod: session.method,
            expiresAt: session.expiresAt,
            auditTargetMode: 'infra',
          },
        });

        res.json({
          ok: true,
          data: { elevatedSessionId: session.elevatedSessionId, expiresAt: session.expiresAt },
        });
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7.2 GET /workspace/vault/session — validate elevated session
  // JWT + X-Elevated-Session header [§7.3]. Principal-bound [hard rule 30].
  // Header transport only — NOT query string [hard rule 31].
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/workspace/vault/session', async (req: Request, res: Response) => {
    if (!deps.elevatedAuthProvider) {
      res.status(501).json({ ok: false, error: 'Elevated auth not configured' });
      return;
    }

    try {
      const principalId = res.locals['principalId'] as string;

      // §7.3 / hard rule 31: X-Elevated-Session header ONLY — not query string
      const elevatedSessionId = req.headers['x-elevated-session'] as string | undefined;
      if (!elevatedSessionId) {
        res.status(403).json({ ok: false, error: 'X-Elevated-Session header required' });
        return;
      }

      // Hard rule 30: principal-bound validation
      const status: ElevatedSessionStatus = await deps.elevatedAuthProvider.validateSession(
        elevatedSessionId as Uuid,
        principalId
      );

      // §8.2: vault-session-closed event when session is not valid
      if (!status.valid && deps.runLedgerWriter) {
        await deps.runLedgerWriter.writeEvent({
          runId: randomUUID() as Uuid,
          eventType: 'workspace_vault_session_closed',
          timestamp: nowIso(),
          actorId: null,
          detail: {
            principalId,
            elevatedSessionId,
            reason: status.reason ?? 'session invalid',
            closedAt: nowIso(),
          },
        });
      }

      if (!status.valid) {
        res.status(403).json({ ok: false, error: status.reason ?? 'Elevated session invalid' });
        return;
      }

      res.json({ ok: true, data: status });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7.2 GET /workspace/catalogs/* — catalog routes
  // agents, models, connectors: JWT only
  // rails: JWT + X-Elevated-Session (elevated session required)
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/workspace/catalogs/agents', async (req: Request, res: Response) => {
    if (!deps.catalogReader) {
      res.status(501).json({ ok: false, error: 'Catalog not configured' });
      return;
    }
    try {
      const claims = res.locals['claims'] as IdentityClaims;
      const items: CatalogItem[] = await deps.catalogReader.listAgents(claims);
      res.json({ ok: true, data: items });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/catalogs/models', async (req: Request, res: Response) => {
    if (!deps.catalogReader) {
      res.status(501).json({ ok: false, error: 'Catalog not configured' });
      return;
    }
    try {
      const claims = res.locals['claims'] as IdentityClaims;
      const items: CatalogItem[] = await deps.catalogReader.listModels(claims);
      res.json({ ok: true, data: items });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/catalogs/connectors', async (req: Request, res: Response) => {
    if (!deps.catalogReader) {
      res.status(501).json({ ok: false, error: 'Catalog not configured' });
      return;
    }
    try {
      const claims = res.locals['claims'] as IdentityClaims;
      const items: CatalogItem[] = await deps.catalogReader.listConnectors(claims);
      res.json({ ok: true, data: items });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // Rails catalog: JWT + X-Elevated-Session required [§7.2]
  app.get('/workspace/catalogs/rails', async (req: Request, res: Response) => {
    if (!deps.secureRailStore || !deps.elevatedAuthProvider) {
      res.status(501).json({ ok: false, error: 'Rail catalog not configured' });
      return;
    }

    try {
      const principalId = res.locals['principalId'] as string;

      // §7.3 / hard rule 31: X-Elevated-Session header ONLY
      const elevatedSessionId = req.headers['x-elevated-session'] as string | undefined;
      if (!elevatedSessionId) {
        res.status(403).json({ ok: false, error: 'X-Elevated-Session header required' });
        return;
      }

      // Hard rule 30: principal-bound validation
      const status = await deps.elevatedAuthProvider.validateSession(
        elevatedSessionId as Uuid,
        principalId
      );
      if (!status.valid) {
        res.status(403).json({ ok: false, error: 'Elevated session required' });
        return;
      }

      const rails = await deps.secureRailStore.list();
      res.json({ ok: true, data: rails });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7.7 POST /workspace/runs/:runId/event-ticket — mint event ticket
  // JWT + RunAcl required. 60s TTL, single-use. Ticket IDs redacted from logs.
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /workspace/runs/:runId/close — operator-initiated run closure
  // AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7 + §6.2 Commit 8.
  //
  // Used by the planner-rejection counter-suggestion modal (PlanCheckbackModal)
  // to close a run when the operator:
  //   - clicks Accept Suggestions (reason: 'user_accepted_checkback_reissued')
  //     — closes the source run before a new re-issued run is opened
  //   - clicks Cancel Run (reason: 'user_cancelled_after_checkback')
  //     — closes the source run with no follow-on run
  //
  // JWT-authenticated + RunAcl-authorized (principal must own the run).
  // Emits `run_cancelled` ledger event with reason + actor.
  // Idempotent (subsequent calls emit additional events but the run is
  // already closed from the first call's perspective).
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/runs/:runId/close', async (req: Request, res: Response) => {
    if (!deps.runLedgerWriter || !deps.workspaceRunAclStore) {
      res.status(501).json({ ok: false, error: 'Run close not configured' });
      return;
    }
    try {
      const runId = req.params['runId'] as Uuid;
      const principalId = res.locals['principalId'] as string;

      // RunAcl check — must own the run to close it
      const authorized = await deps.workspaceRunAclStore.isAuthorized(runId, principalId);
      if (!authorized) {
        res.status(403).json({ ok: false, error: 'Not authorized for this run' });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      const reason = body['reason'] as string | undefined;
      const VALID_CLOSE_REASONS = new Set([
        'user_cancelled_after_checkback',
        'user_accepted_checkback_reissued',
      ]);
      if (!reason || !VALID_CLOSE_REASONS.has(reason)) {
        res.status(400).json({
          ok: false,
          error:
            "reason required: 'user_cancelled_after_checkback' | 'user_accepted_checkback_reissued'",
        });
        return;
      }

      await deps.runLedgerWriter.writeEvent({
        runId,
        eventType: 'run_cancelled',
        timestamp: nowIso(),
        actorId: principalId as Uuid,
        detail: {
          reason,
          source: 'plan_checkback_modal',
          closedByPrincipalId: principalId,
        },
      });

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.post('/workspace/runs/:runId/event-ticket', async (req: Request, res: Response) => {
    if (!deps.workspaceEventTicketStore || !deps.workspaceRunAclStore) {
      res.status(501).json({ ok: false, error: 'Event tickets not configured' });
      return;
    }

    try {
      const runId = req.params['runId'] as Uuid;
      const principalId = res.locals['principalId'] as string;

      // RunAcl check — must own the run to get a ticket
      const authorized = await deps.workspaceRunAclStore.isAuthorized(runId, principalId);
      if (!authorized) {
        res.status(403).json({ ok: false, error: 'Not authorized for this run' });
        return;
      }

      // Mint ticket: 60s TTL, single-use [§7.7]
      const ticketId = randomUUID() as Uuid;
      const issuedAt = nowIso();
      const expiresAt = addSeconds(issuedAt, 60);

      const ticket: WorkspaceEventTicket = {
        ticketId,
        runId,
        principalId,
        issuedAt,
        expiresAt,
        consumed: false,
      };

      await Promise.resolve(deps.workspaceEventTicketStore.store(ticket));

      // §7.7: ticket IDs redacted from access logs — only return to caller
      res.json({ ok: true, data: { ticketId, expiresAt } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §7.8 POST /workspace/runs/:runId/approval — approval decision
  // JWT + approval authorization. Registered approver key ALWAYS required.
  // RunAcl alone never authorizes. Routes through WorkspaceApprovalBridge.
  // [GWS5-AUD-03, GWS6-AUD-01, GWS7-AUD-01] — 7 gate cases (a-g)
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/runs/:runId/approval', async (req: Request, res: Response) => {
    if (!deps.workspaceApprovalBridge) {
      res.status(501).json({ ok: false, error: 'Approval bridge not configured' });
      return;
    }

    try {
      const runId = req.params['runId'] as Uuid;
      const principalId = res.locals['principalId'] as string;
      const workspaceAuthSessionId = res.locals['workspaceAuthSessionId'] as Uuid;

      const body = req.body as Record<string, unknown>;
      const approvalId = body['approvalId'] as string | undefined;
      const decision = body['decision'] as 'approved' | 'denied' | undefined;
      const note = body['note'] as string | undefined;

      if (!approvalId || !decision || !['approved', 'denied'].includes(decision)) {
        res.status(400).json({ ok: false, error: 'approvalId and decision required' });
        return;
      }

      // §7.8: delegate to bridge — bridge verifies runId match + approver key
      // Gate 17 cases (a-g) validated through bridge logic
      const response: ApprovalResponse = await deps.workspaceApprovalBridge.submitDecision({
        approvalId: approvalId as Uuid,
        runId,
        principalId,
        decision,
        ...(note !== undefined ? { note } : {}),
        workspaceAuthSessionId,
      });

      res.json({ ok: true, data: response });
    } catch (err) {
      // Bridge errors mapped to HTTP status codes
      if (err instanceof Error) {
        const msg = err.message;
        if (msg.includes('not found')) {
          res.status(404).json({ ok: false, error: msg });
          return;
        }
        if (msg.includes('not belong') || msg.includes('not a registered approver')) {
          res.status(403).json({ ok: false, error: msg });
          return;
        }
        if (msg.includes('already')) {
          res.status(409).json({ ok: false, error: msg });
          return;
        }
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKBACK-spec — POST /workspace/runs/:runId/checkback
  // JWT + RunAcl protected. Wakes a pending plan_checkback Deferred so the
  // orchestrator's sendPlanCheckback can return with the user's decision.
  // Returns 404 if no checkback is pending for this runId.
  // ═══════════════════════════════════════════════════════════════════════════

  app.post('/workspace/runs/:runId/checkback', async (req: Request, res: Response) => {
    if (!deps.resolvePendingCheckback) {
      res.status(501).json({ ok: false, error: 'Checkback resolver not configured' });
      return;
    }
    try {
      const runId = req.params['runId'] as Uuid;

      // RunAcl: only the run's principal may resolve its checkback.
      if (deps.workspaceRunAclStore) {
        const principalId = res.locals['principalId'] as string;
        const authorized = await deps.workspaceRunAclStore.isAuthorized(runId, principalId);
        if (!authorized) {
          res.status(403).json({ ok: false, error: 'Not authorized for this run' });
          return;
        }
      }

      const body = req.body as Record<string, unknown>;
      const decision = body['decision'];
      if (decision !== 'allow' && decision !== 'deny') {
        res.status(400).json({ ok: false, error: "decision must be 'allow' or 'deny'" });
        return;
      }

      const resolved = await deps.resolvePendingCheckback(runId, decision === 'allow');
      if (!resolved) {
        res.status(404).json({ ok: false, error: 'No pending checkback for this run' });
        return;
      }

      res.json({ ok: true, data: { runId, decision } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // §3.6/§7.2 GET /sse/runs/:runId — SSE event stream
  // Auth: event ticket — spec §7.7 says SSE *prefers* Authorization: Bearer,
  // but EventSource (the standard browser SSE client) cannot set custom
  // headers, so we also accept the ticket via `?ticket=` query string. WS
  // already uses the same query-param transport for the same protocol limit.
  // NOT under /workspace/* JWT middleware — self-authenticating.
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/sse/runs/:runId', async (req: Request, res: Response) => {
    if (!deps.workspaceEventTicketStore) {
      res.status(501).json({ ok: false, error: 'Event tickets not configured' });
      return;
    }

    const runId = req.params['runId'] as Uuid;

    // Extract ticket — Authorization: Bearer header preferred [§7.7], with
    // ?ticket= query-string fallback for browser EventSource compatibility.
    const auth = req.headers['authorization'] ?? '';
    const headerTicket = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const queryTicket =
      typeof req.query['ticket'] === 'string' ? (req.query['ticket'] as string) : '';
    const ticketId = headerTicket || queryTicket;
    if (!ticketId) {
      res.status(401).json({ ok: false, error: 'Event ticket required' });
      return;
    }

    // Consume ticket — validates TTL, single-use, and runId match
    const ticket = await Promise.resolve(
      deps.workspaceEventTicketStore.consume(ticketId as Uuid, runId)
    );
    if (!ticket) {
      res.status(401).json({ ok: false, error: 'Invalid, expired, or consumed ticket' });
      return;
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', runId })}\n\n`);

    // Replay any ledger events that already landed for this run before the
    // browser opened the stream — without this the client misses events
    // emitted between run dispatch and ticket-mint/connect (commonly the
    // entire happy-path lifecycle for fast runs).
    if (deps.runLedgerWriter) {
      try {
        const existing = await deps.runLedgerWriter.getByRunId(runId);
        for (const entry of existing) {
          const payload = JSON.stringify({
            type: entry.eventType,
            runId: entry.runId,
            timestamp: entry.timestamp,
            detail: entry.detail,
          });
          res.write('data: ' + payload + '\n\n');
        }
      } catch {
        // best-effort replay — live fanout still delivers fresh events
      }
    }

    // Live fanout — every subsequent runLedgerWriter.writeEvent for this
    // runId pushes a `data:` line through the bus to this response.
    const unsubscribe = subscribeToRun(runId, res);

    // Keep-alive heartbeat (every 30s)
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30_000);

    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// §7.2/§7.4 Admin routes — admin bearer auth (applied by routes/index.ts)
// Templates: POST (create), PUT (disable), DELETE (disable — hard rule 25)
// Rails: POST (create), PUT (disable), DELETE (disable — hard rule 25)
// Signature law: canonicalize(sans signatures), verify vs AdminSignerRegistry.
// Immutable versions. Disabled-not-deleted. Collision → 409.
// ═══════════════════════════════════════════════════════════════════════════════

export interface WorkspaceAdminDeps {
  promptTemplateStore?: PromptTemplateStorePort;
  secureRailStore?: SecureRailStorePort;
  adminSignerRegistry?: AdminSignerRegistry;
  /** Signature verification function (injected by bootstrap) [§7.4] */
  verifySignature?: (payload: string, signature: string, publicKey: string) => Promise<boolean>;
}

/** Canonicalize object for signature verification — deterministic JSON [§7.4] */
function canonicalize(obj: Record<string, unknown>): string {
  const sortedKeys = Object.keys(obj).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    sorted[k] = obj[k];
  }
  return JSON.stringify(sorted);
}

export function registerWorkspaceAdminRoutes(app: Express, deps: WorkspaceAdminDeps): void {
  // ── POST /admin/prompt-templates — create new template ──────────────────
  app.post('/admin/prompt-templates', async (req: Request, res: Response) => {
    if (!deps.promptTemplateStore || !deps.adminSignerRegistry || !deps.verifySignature) {
      res.status(501).json({ ok: false, error: 'Template admin not configured' });
      return;
    }

    try {
      const template = req.body as PromptTemplate;

      // §7.4: unsigned → reject
      if (!template.signatures || template.signatures.length === 0) {
        res.status(400).json({ ok: false, error: 'Template must be signed' });
        return;
      }

      // §7.4: collision → 409 (immutable versions)
      if (await deps.promptTemplateStore.exists(template.templateId, template.version)) {
        res.status(409).json({ ok: false, error: 'Template version already exists' });
        return;
      }

      // §7.4: verify each signature against AdminSignerRegistry
      const { signatures, ...rest } = template;
      const signaturePayload = canonicalize(rest as Record<string, unknown>);

      for (const sig of signatures) {
        // Unknown signer → reject
        const registered = await deps.adminSignerRegistry.isRegistered(sig.signedBy);
        if (!registered) {
          res.status(403).json({ ok: false, error: `Unknown signer: ${sig.signedBy}` });
          return;
        }

        // Get public key and verify signature
        const publicKey = await deps.adminSignerRegistry.getPublicKey(sig.signedBy);
        if (!publicKey) {
          res.status(403).json({ ok: false, error: `No public key for signer: ${sig.signedBy}` });
          return;
        }

        // Invalid signature → reject
        const valid = await deps.verifySignature(signaturePayload, sig.signature, publicKey);
        if (!valid) {
          res.status(400).json({ ok: false, error: 'Invalid template signature' });
          return;
        }
      }

      await deps.promptTemplateStore.save(template);
      res.json({ ok: true, data: { templateId: template.templateId, version: template.version } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── PUT /admin/prompt-templates — disable template version ──────────────
  app.put('/admin/prompt-templates', async (req: Request, res: Response) => {
    if (!deps.promptTemplateStore) {
      res.status(501).json({ ok: false, error: 'Template admin not configured' });
      return;
    }

    try {
      const body = req.body as Record<string, unknown>;
      const templateId = body['templateId'] as string;
      const version = body['version'] as string;
      if (!templateId || !version) {
        res.status(400).json({ ok: false, error: 'templateId and version required' });
        return;
      }
      // Hard rule 25: disabled, never deleted
      await deps.promptTemplateStore.disable(templateId, version);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── DELETE /admin/prompt-templates — disable (hard rule 25: never delete) ─
  app.delete('/admin/prompt-templates', async (req: Request, res: Response) => {
    if (!deps.promptTemplateStore) {
      res.status(501).json({ ok: false, error: 'Template admin not configured' });
      return;
    }

    try {
      const body = req.body as Record<string, unknown>;
      const templateId = body['templateId'] as string;
      const version = body['version'] as string;
      if (!templateId || !version) {
        res.status(400).json({ ok: false, error: 'templateId and version required' });
        return;
      }
      // Hard rule 25: disabled-not-deleted
      await deps.promptTemplateStore.disable(templateId, version);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── POST /admin/secure-rails — create new secure rail ────────────────────
  app.post('/admin/secure-rails', async (req: Request, res: Response) => {
    if (!deps.secureRailStore || !deps.adminSignerRegistry || !deps.verifySignature) {
      res.status(501).json({ ok: false, error: 'Rail admin not configured' });
      return;
    }

    try {
      const rail = req.body as SecureRail;

      // §7.4: unsigned → reject
      if (!rail.signatures || rail.signatures.length === 0) {
        res.status(400).json({ ok: false, error: 'Rail must be signed' });
        return;
      }

      // §7.4: collision → 409 (immutable versions)
      if (await deps.secureRailStore.exists(rail.railId, rail.version)) {
        res.status(409).json({ ok: false, error: 'Rail version already exists' });
        return;
      }

      // §7.4: verify each signature against AdminSignerRegistry
      const { signatures, ...rest } = rail;
      const signaturePayload = canonicalize(rest as Record<string, unknown>);

      for (const sig of signatures) {
        // Unknown signer → reject
        const registered = await deps.adminSignerRegistry.isRegistered(sig.signedBy);
        if (!registered) {
          res.status(403).json({ ok: false, error: `Unknown signer: ${sig.signedBy}` });
          return;
        }

        // Get public key and verify signature
        const publicKey = await deps.adminSignerRegistry.getPublicKey(sig.signedBy);
        if (!publicKey) {
          res.status(403).json({ ok: false, error: `No public key for signer: ${sig.signedBy}` });
          return;
        }

        // Invalid signature → reject
        const valid = await deps.verifySignature(signaturePayload, sig.signature, publicKey);
        if (!valid) {
          res.status(400).json({ ok: false, error: 'Invalid rail signature' });
          return;
        }
      }

      await deps.secureRailStore.save(rail);
      res.json({ ok: true, data: { railId: rail.railId, version: rail.version } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── PUT /admin/secure-rails — disable rail version ───────────────────────
  app.put('/admin/secure-rails', async (req: Request, res: Response) => {
    if (!deps.secureRailStore) {
      res.status(501).json({ ok: false, error: 'Rail admin not configured' });
      return;
    }

    try {
      const body = req.body as Record<string, unknown>;
      const railId = body['railId'] as string;
      const version = body['version'] as string;
      if (!railId || !version) {
        res.status(400).json({ ok: false, error: 'railId and version required' });
        return;
      }
      // Hard rule 25: disabled, never deleted
      await deps.secureRailStore.disable(railId, version);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── DELETE /admin/secure-rails — disable (hard rule 25: never delete) ────
  app.delete('/admin/secure-rails', async (req: Request, res: Response) => {
    if (!deps.secureRailStore) {
      res.status(501).json({ ok: false, error: 'Rail admin not configured' });
      return;
    }

    try {
      const body = req.body as Record<string, unknown>;
      const railId = body['railId'] as string;
      const version = body['version'] as string;
      if (!railId || !version) {
        res.status(400).json({ ok: false, error: 'railId and version required' });
        return;
      }
      // Hard rule 25: disabled-not-deleted
      await deps.secureRailStore.disable(railId, version);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
