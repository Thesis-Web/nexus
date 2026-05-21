/**
 * Nexus Management API — spec §23, AMEND-spec §11.1
 * Express on port 7701, binds 127.0.0.1 only (SOLVE-008).
 * timingSafeEqual on all token comparisons.
 * principalId never in POST /sessions body (SOLVE-017).
 *
 * DEF-007: Refactored to DI pattern per §23.1.
 * This file imports @nexus/contracts ONLY — never core implementations.
 * Service instances are injected by the bootstrap entry point (`nexus serve`).
 *
 * DEF-008: Added /run-ledger and /mode routes.
 * BS-D2-004: Routes extracted to routes/ directory per spec §6.1.
 *
 * EXT-12: Expanded ApiDependencies with externals DI per AMEND-spec §11.1.
 * CMP-07: Added template admin route DI per AMEND-spec-nexus-compile §6.
 * The API must not import core/vanguard implementation classes directly.
 * It receives already-constructed service instances from scripts/nexus-bootstrap.ts.
 *
 * §11.1 Required DI:
 *   ExternalsRuntime        — bootstrap-owned type (destructured into individual deps)
 *   RunLedgerWriter          — from @nexus/contracts
 *   IdentityProviderInterface — from @nexus/contracts
 *   PipelineInterface        — from @nexus/contracts
 *   NvgService               — from @nexus/contracts
 *   ExternalSocketRegistry   — via bootstrap-owned type only
 *   CompileReturnDispatcher  — via bootstrap-owned type only
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type {
  ActorRegistry,
  PrincipalRegistry,
  SessionStoreInterface,
  DelegationStore,
  PendingApprovalStore,
  LedgerBackend,
  LoadedPolicyFile,
  ChainVerificationResult,
  ApprovalResponse,
  Actor,
  Principal,
  DelegationContext,
  RunLedgerWriter,
  ModeConfiguration,
  NvgService,
  NvgRoutingPolicy,
  RoutingTrailReader,
  IdentityProviderInterface,
  PipelineInterface,
  PipelineResult,
  AgentAction,
  WorkspaceRunRequest,
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
  IdentityProviderManifestRecord,
  ConnectorManifestRecord,
  ChannelManifestRecord,
  ModelEndpoint,
  CompileReturnRequest,
  FinalResponseArtifact,
  CompileReturnAck,
  OutputCollector,
  MailboxService,
  CompileService,
  CompileTemplate,
  Orchestrator,
  Uuid,
  NonEmpty,
  IsoTimestamp,
  Sha256Hex,
  WorkspaceSessionStorePort,
  WorkspaceRunAclStorePort,
  WorkspaceEventTicketStorePort,
  WorkspaceFileStorePort,
  WorkspaceBlobStorePort,
  PromptTemplateStorePort,
  SecureRailStorePort,
  AdminSignerRegistry,
  WorkspaceApprovalBridge,
  ElevatedAuthProvider,
  WorkspaceCatalogReaderPort,
  InfraRunIdNamespace,
} from '@nexus/contracts';
import { registerAllRoutes } from './routes/index.js';
// Re-export the SSE fanout helpers so the composition root can wrap its
// RunLedgerWriter without reaching past @nexus/api's public surface.
export { subscribeToRun, broadcastRunEvent, wrapWriterWithFanout } from './routes/run-event-bus.js';

// ── DI port re-exports ─────────────────────────────────────────────────────
// SecretWriter is defined in admin-writer.ts (the route handler that enforces
// the contract). We re-export it here so external callers wiring deps into
// ApiDependencies can import a single name from @nexus/api.
//
// Tests and the composition root may import this type from either location;
// they are the same symbol. Keeping the definition adjacent to the route
// handler prevents the two from drifting under TypeScript strict.
export type { SecretWriter, ModeSigner, ModeSignerState } from './routes/admin-writer.js';
import type { SecretWriter } from './routes/admin-writer.js';

// ── F4.13 SignedAdminMutation port re-exports ─────────────────────────────
// The middleware defines three port interfaces (signer / verifier / nonce
// store) plus the in-memory nonce store. The two builders for the signer
// and verifier live alongside in `admin-mutation-port-impls.ts`. All are
// re-exported here so the composition root can wire them from a single
// `@nexus/api` import.
export type {
  AdminMutationServerSignerPort,
  AdminMutationVerifierPort,
  AdminMutationNonceStorePort,
} from './middleware/signed-admin-mutation.js';
export { InMemoryAdminMutationNonceStore } from './middleware/signed-admin-mutation.js';
export {
  buildAdminMutationServerSigner,
  buildAdminMutationVerifier,
} from './middleware/admin-mutation-port-impls.js';
import type {
  AdminMutationServerSignerPort,
  AdminMutationVerifierPort,
  AdminMutationNonceStorePort,
} from './middleware/signed-admin-mutation.js';

// ── §23.1 + §11.1 ApiDependencies — constructor injection contract ──────────

// ── SPEC-ADMIN-WRITER §3 — ManifestWriter DI contract ──────────────────────
// Structural interface matching ManifestWriterService from @nexus/core.
// Defined here to avoid Layer 7 → Layer 1 import. DI structural typing bridges.
export interface ManifestWriter {
  /** Read raw manifest entries (ALL entries, including disabled). */
  readEntries(manifestPath: string, arrayKey: string): Promise<Record<string, unknown>[]>;
  addEntry(
    manifestPath: string,
    arrayKey: string,
    entry: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
  updateEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    updates: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
  removeEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
}

export interface ApiDependencies {
  // ── Core registries and stores (Layer 2 interfaces) ──────────────────────
  actorRegistry: ActorRegistry;
  principalRegistry: PrincipalRegistry;
  sessionStore: SessionStoreInterface;
  delegationStore: DelegationStore;
  approvalStore: PendingApprovalStore;
  ledgerBackend: LedgerBackend;

  // ── Service functions (injected by bootstrap — keys pre-bound by caller) ─
  mintRootDelegation: (
    principal: Principal,
    actor: Actor,
    params: {
      principalId: string;
      actorId: string;
      allowedSystems: string[];
      allowedCapabilities: string[];
      forbiddenCapabilities: string[];
      maxRiskTier: string;
      allowDownstreamPropagation: boolean;
      environment: string;
      expiresAt: string;
      maxChainDepth: number;
    }
  ) => Promise<DelegationContext>;

  loadPolicyFile: (filepath: string) => Promise<LoadedPolicyFile>;

  verifyChain: (
    backend: LedgerBackend,
    from: number,
    to: number
  ) => Promise<ChainVerificationResult>;

  decideApproval: (
    approvalId: string,
    decidedBy: string,
    decision: 'approved' | 'denied',
    note: string | undefined,
    store: PendingApprovalStore
  ) => Promise<ApprovalResponse>;

  // ── Config ───────────────────────────────────────────────────────────────
  adminToken: string;

  // ── §30 Run Ledger (DEF-008) ─────────────────────────────────────────────
  runLedgerWriter?: RunLedgerWriter;

  // ── F4.13 / HL #10 — SignedAdminMutation backing ports ───────────────────
  // The `withAdminMutation(...)` middleware on every admin-writer mutation
  // demands these four ports plus runLedgerWriter (above). All four are
  // required for admin writes to succeed; the middleware fails closed with
  // 503 AUDIT_UNAVAILABLE when any is missing. Composition root constructs
  // them in `serve.ts`.
  adminMutationServerSigner?: AdminMutationServerSignerPort;
  adminMutationVerifier?: AdminMutationVerifierPort;
  adminMutationNonceStore?: AdminMutationNonceStorePort;
  infraRunIdNamespace?: InfraRunIdNamespace;

  // ── §9 Operating Modes — read-only (DEF-008) ────────────────────────────
  loadModeConfig?: () => Promise<ModeConfiguration>;
  saveModeConfig?: (config: ModeConfiguration) => Promise<void>;

  // ── §22.1/§23.2 NVG services — DI (HOLE-S7-001) ────────────────────────
  nvgService?: NvgService;
  trailReader?: RoutingTrailReader;
  loadNvgRoutingPolicy?: () => Promise<NvgRoutingPolicy>;

  // ══════════════════════════════════════════════════════════════════════════
  // EXT-12: Externals reference harness DI — AMEND-spec §11.1
  // All optional — existing callers (pre-externals serve command) continue
  // to work without providing these deps.
  // ══════════════════════════════════════════════════════════════════════════

  // ── §11.1 IdentityProviderInterface — workspace auth ────────────────────
  identityProvider?: IdentityProviderInterface;

  // ── §11.1 PipelineInterface — NXS pipeline (available for future routes) ─
  pipelineInterface?: PipelineInterface;
  /**
   * CLAUDE-CODE-ADMIN-PANELS-PHASE-D §1a — runtime-reported
   * capabilities per connector systemType (matches manifest
   * connectorType). Built once at bootstrap and threaded through
   * admin-setup so the connector panel can display capabilities.
   */
  connectorCapabilities?: ReadonlyMap<string, readonly string[]>;
  /**
   * CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3c — read-only summary of the
   * loaded NXS default policy. Null when bootstrap couldn't load the
   * policy file (e.g. signature failure).
   */
  nxsPolicySummary?: import('./routes/admin-setup.js').NxsPolicySummary | null;
  /**
   * CLAUDE-CODE-NXS-WIRE-PHASE-B — runtime dispatch into the NXS pipeline.
   * Wraps `pipelineInterface.process(...)` with PipelineContext assembly,
   * the §22.5 bypass annotation, and the `nxs_action` ledger event.
   *
   * Routes that submit governed actions (currently the admin test route)
   * call this. Workspace prompt path is independent — NVG and NXS are
   * separate checkpoints (independence law).
   */
  dispatchToNxs?: (input: {
    rawAction: Omit<AgentAction, 'delegationSequence'>;
    runId: Uuid;
    /**
     * CLAUDE-CODE-ACTION-NORMALIZER-PHASE-C §1 — controls bypass_annotation.
     * true  = NXS dispatch without prior NVG (admin test route)
     * false = NXS dispatch following an NVG model invocation (post-inference)
     */
    isNvgBypass: boolean;
    /**
     * When provided, the dispatcher emits run_opened/run_closed events
     * to bracket the test run in the ledger. Used by admin test surfaces
     * that don't go through the workspace compile-return loop.
     * EXT-12 keeps run_closed writes confined to compile-return.ts /
     * compile.ts / workspace.ts at the route layer; the dispatcher
     * lives in the composition root and is the lawful writer for
     * non-compile bracket events.
     */
    bracketRun?: {
      runOpenDetail: Record<string, unknown>;
    };
  }) => Promise<PipelineResult>;

  // ── §6.2 Workspace harness deps ─────────────────────────────────────────
  workspaceSockets?: readonly WorkspaceManifestRecord[];
  computeDigest?: (obj: unknown) => Sha256Hex;
  dispatchToOrchestrator?: (request: WorkspaceRunRequest) => Promise<unknown>;

  // ── §6.3 Orchestrator harness deps ──────────────────────────────────────
  orchestratorSockets?: readonly OrchestratorManifestRecord[];
  /** Injected Orchestrator socket — for cancel and DAG-based dispatch [ORCH-23]. */
  orchestrator?: Orchestrator;

  // ── §11.2 Mailbox harness deps ──────────────────────────────────────────
  mailboxService?: MailboxService;
  primaryMailbox?: MailboxManifestRecord;

  // ── §6.8 Compile harness deps ───────────────────────────────────────────
  outputCollector?: OutputCollector;
  compileService?: CompileService;
  getDefaultCompiler?: () => CompilerManifestRecord;
  getPrimaryMailbox?: () => MailboxManifestRecord;
  resolveReturnEndpointForRun?: (runId: Uuid) => Promise<CompileReturnEndpointRecord>;
  dispatchCompileReturn?: (input: {
    runId: Uuid;
    endpoint: CompileReturnEndpointRecord;
    artifact: FinalResponseArtifact;
    sentAt: IsoTimestamp;
  }) => Promise<CompileReturnAck>;

  // ── §6.9 Compile-return harness deps (EXT-10) ──────────────────────────
  getReturnEndpoint?: (returnEndpointId: string) => CompileReturnEndpointRecord | null;
  verifyCallbackSignature?: (request: CompileReturnRequest, publicKey: string) => Promise<boolean>;
  verifyArtifactSignature?: (
    artifact: FinalResponseArtifact,
    publicKey: string
  ) => Promise<boolean>;
  recomputeArtifactDigest?: (artifact: FinalResponseArtifact) => Sha256Hex;
  controlPlanePublicKey?: string;
  /**
   * Resolve a FinalResponseArtifact bodyRef to its rendered text. Bootstrap
   * supplies the implementation (file:// reads via the registered payload
   * resolver); the compile-return route uses it to inline `body` into the
   * `final_response` ledger event so the SSE fanout reaches the browser.
   */
  resolveArtifactBody?: (ref: NonEmpty) => Promise<string>;

  /**
   * CHECKBACK-spec — wakes a pending plan_checkback Deferred. Returns true
   * iff a checkback was actually pending for this runId. Bootstrap supplies
   * the implementation; the POST /workspace/runs/:runId/checkback route
   * uses it to translate the user's allow/deny click back into the
   * sendPlanCheckback Promise the orchestrator is awaiting.
   */
  resolvePendingCheckback?: (runId: Uuid, allow: boolean) => Promise<boolean>;

  // ── AMEND-spec-nexus-compile §6: Template admin route deps ───────────────
  // Function-based — Layer 7 cannot import core types (DIFF-S23-002).
  // Bootstrap wires concrete implementations from core.
  validateTemplate?: (raw: unknown) => CompileTemplate;
  verifyTemplate?: (template: CompileTemplate) => Promise<void>;
  storeTemplate?: (template: CompileTemplate, ingestedBy: NonEmpty) => void;
  templateExists?: (templateId: NonEmpty, templateVersion: NonEmpty) => boolean;

  // ── AMEND-nexus-spec-workspace §7.1: Workspace auth deps ─────────────────
  workspaceSessionStore?: WorkspaceSessionStorePort;
  /** Run ACL store for per-run authorization [AMEND-workspace §6.1, §6.3] */
  workspaceRunAclStore?: WorkspaceRunAclStorePort;
  /** Event ticket store for WS/SSE auth [AMEND-workspace §7.7] */
  workspaceEventTicketStore?: WorkspaceEventTicketStorePort;
  /** File metadata store [AMEND-workspace §6.5] */
  workspaceFileStore?: WorkspaceFileStorePort;
  /** Blob content store — streaming [AMEND-workspace §6.5] */
  workspaceBlobStore?: WorkspaceBlobStorePort;
  /** HMAC-SHA256 secret for workspace JWTs. If missing → workspace auth fails closed (501). */
  workspaceJwtSecret?: string;

  // ── AMEND-nexus-spec-workspace §7.1 / W06: Template + Rail + Approval deps ─
  /** Prompt template store [§7.4, gate 9] */
  promptTemplateStore?: PromptTemplateStorePort;
  /** Secure rail store [§7.4, gate 10] */
  secureRailStore?: SecureRailStorePort;
  /** Admin signer registry — NOT approver keys (hard rule 32) [§7.4] */
  adminSignerRegistry?: AdminSignerRegistry;
  /** Workspace approval bridge [§7.5, blueprint §3.5.3, gate 17] */
  workspaceApprovalBridge?: WorkspaceApprovalBridge;
  /** Signature verification function (injected by bootstrap) [§7.4] */
  verifySignature?: (payload: string, signature: string, publicKey: string) => Promise<boolean>;

  // ── AMEND-nexus-spec-workspace §7.1 / W07: Elevated + Catalog deps ─────
  /** Elevated auth provider [blueprint §3.9] */
  elevatedAuthProvider?: ElevatedAuthProvider;
  /** Catalog reader [blueprint §4.2-4.4] */
  catalogReader?: WorkspaceCatalogReaderPort;

  // ══════════════════════════════════════════════════════════════════════════
  // SPEC-addendum-beta1-admin-dashboard-v0-1 §3.2 — Admin-setup projection deps
  //
  // Manifest records flow from bootstrap → composition root → here so that
  // the admin-setup routes can describe configured externals truthfully.
  // All optional — missing records produce `missing`/`partial` projections.
  // (Claude C window 1.)
  // ══════════════════════════════════════════════════════════════════════════
  identityRecords?: readonly IdentityProviderManifestRecord[];
  connectorRecords?: readonly ConnectorManifestRecord[];
  channelRecords?: readonly ChannelManifestRecord[];
  mailboxRecords?: readonly MailboxManifestRecord[];
  compilerRecords?: readonly CompilerManifestRecord[];
  compileReturnRecords?: readonly CompileReturnEndpointRecord[];
  /** Model endpoints (NVG) for admin-setup models_nvg surface. */
  endpoints?: readonly ModelEndpoint[];

  // ── SPEC-ADMIN-WRITER §3 — Manifest writer for admin dashboard mutations ──
  /** Generic YAML manifest writer (endpoints + connectors). Injected from serve. */
  manifestWriter?: ManifestWriter;

  // ── CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — admin secret onboarding ─────────
  /** File-backed secret store. Bootstrap supplies a FileSecretSource adapter. */
  secretWriter?: SecretWriter;

  // ── AMEND-nexus-admin-dashboard-full-buildout §3.6 / §3.7 / §4.1 ────────
  /** Mode signer port for /workspace/admin/setup/mode and /mode/unlock. */
  modeSigner?: import('./routes/admin-writer.js').ModeSigner;
  /** Probe whether an admin signing keypair exists for the elevated admin. */
  hasAdminSigningKeypair?: () => Promise<boolean>;
  /** Override the keys/ directory (admin-key uploads). Defaults to 'keys/'. */
  keyDirectory?: string;

  // ── F4.1 SigningCouncil — federated mutation aggregator ─────────────────
  /**
   * Baked SigningCouncilPort. Plug-in admin-writer routes call into this
   * port to open requests and add signatures; the port handles signature
   * verification, threshold checking, and dispatch.
   */
  signingCouncil?: import('@nexus/contracts').SigningCouncilPort;
  /**
   * F4.1 / feedback_signing_keys_server_side — server-side Ed25519 signer
   * for the council sign route. UI clients post without a signature; the
   * route loads the elevated admin's keypair via this port and signs the
   * canonical envelope server-side. Absent → UI clients get 403; CLI
   * (pre-signed) clients keep working.
   */
  signingCouncilServerSigner?: import('./routes/admin-writer.js').SigningCouncilServerSignerPort;

  // ── F4.5 OCT manager — signed OCT assignment surface ────────────────────
  /**
   * Baked OctManagerPort. Plug-in /workspace/admin/oct/assign calls into
   * this port; downstream the port runs @nexus/core's assignOct() with
   * the server's ActorRegistry + RunLedgerWriter bound.
   */
  octManager?: import('./routes/admin-writer.js').AdminOctManagerPort;
}

// ── §23.1 createApiServer — DI factory ───────────────────────────────────────

export function createApiServer(deps: ApiDependencies): {
  app: ReturnType<typeof express>;
  start: (port?: number) => void;
} {
  const { adminToken } = deps;

  const app = express();
  app.use(express.json());

  // ── Health endpoint — no auth required [GATE-DEPLOY-001] ──────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
  });

  // ── Admin auth middleware ──────────────────────────────────────────────────
  function adminAuth(req: Request, res: Response, next: NextFunction): void {
    const auth = req.headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    try {
      const a = Buffer.from(token);
      const b = Buffer.from(adminToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).json({ ok: false, error: 'Unauthorized' });
        return;
      }
    } catch {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    next();
  }

  // ── Register all routes from routes/ directory (BS-D2-004, EXT-12) ──────
  registerAllRoutes(app, deps, { currentPolicy: null }, adminAuth);

  // ── Static serving — after all API routes [blueprint §2.2] ────────────────
  // Order: API routes → static assets → SPA fallback (LAST)
  const distPath = path.join(process.cwd(), 'packages', 'workspace-ref', 'dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback — catches unmatched GET requests for client-side routing
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // ── Server start ──────────────────────────────────────────────────────────
  function startServer(port: number = 7701): void {
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`Nexus management API listening on 127.0.0.1:${port}`);
    });

    // §7.7/§3.6: WebSocket upgrade handler for /ws/runs/:runId
    // Auth: event ticket via ?ticket= query param (protocol limit)
    if (deps.workspaceEventTicketStore) {
      const wss = new WebSocketServer({ noServer: true });

      server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url ?? '', `http://${request.headers.host}`);
        const match = url.pathname.match(/^\/ws\/runs\/([^/]+)$/);
        if (!match) {
          socket.destroy();
          return;
        }

        const runId = match[1] as Uuid;
        const ticketId = url.searchParams.get('ticket');
        if (!ticketId) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // Consume ticket — validates TTL, single-use, and runId match
        void Promise.resolve(deps.workspaceEventTicketStore!.consume(ticketId as Uuid, runId)).then(
          ticket => {
            if (!ticket) {
              socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
              socket.destroy();
              return;
            }

            wss.handleUpgrade(request, socket, head, ws => {
              ws.send(JSON.stringify({ type: 'connected', runId }));
            });
          }
        );
      });
    }
  }

  return { app, start: startServer };
}
