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
  WorkspaceRunRequest,
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
  CompileReturnRequest,
  FinalResponseArtifact,
  CompileReturnAck,
  OutputCollector,
  MailboxService,
  CompileService,
  Uuid,
  NonEmpty,
  IsoTimestamp,
  Sha256Hex,
} from '@nexus/contracts';
import { registerAllRoutes } from './routes/index.js';

// ── §23.1 + §11.1 ApiDependencies — constructor injection contract ──────────

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

  // ── §6.2 Workspace harness deps ─────────────────────────────────────────
  workspaceSockets?: readonly WorkspaceManifestRecord[];
  computeDigest?: (obj: unknown) => Sha256Hex;
  dispatchToOrchestrator?: (request: WorkspaceRunRequest) => Promise<unknown>;

  // ── §6.3 Orchestrator harness deps ──────────────────────────────────────
  orchestratorSockets?: readonly OrchestratorManifestRecord[];

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
}

// ── §23.1 createApiServer — DI factory ───────────────────────────────────────

export function createApiServer(deps: ApiDependencies): {
  app: ReturnType<typeof express>;
  start: (port?: number) => void;
} {
  const { adminToken } = deps;

  const app = express();
  app.use(express.json());

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
  app.use(adminAuth);

  // ── Register all routes from routes/ directory (BS-D2-004, EXT-12) ──────
  registerAllRoutes(app, deps, { currentPolicy: null });

  // ── Server start ──────────────────────────────────────────────────────────
  function startServer(port: number = 7701): void {
    app.listen(port, '127.0.0.1', () => {
      console.log(`Nexus management API listening on 127.0.0.1:${port}`);
    });
  }

  return { app, start: startServer };
}
