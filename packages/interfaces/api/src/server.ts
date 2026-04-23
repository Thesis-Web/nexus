/**
 * Nexus Management API — spec §23
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
} from '@nexus/contracts';
import { registerAllRoutes } from './routes/index.js';

// ── §23.1 ApiDependencies — constructor injection contract ───────────────────

export interface ApiDependencies {
  // Registries and stores (Layer 2 interfaces)
  actorRegistry: ActorRegistry;
  principalRegistry: PrincipalRegistry;
  sessionStore: SessionStoreInterface;
  delegationStore: DelegationStore;
  approvalStore: PendingApprovalStore;
  ledgerBackend: LedgerBackend;

  // Service functions (injected by bootstrap — keys pre-bound by caller)
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

  // Config
  adminToken: string;

  // §30 Run Ledger (DEF-008)
  runLedgerWriter?: RunLedgerWriter;

  // §9 Operating Modes — read-only (DEF-008)
  loadModeConfig?: () => Promise<ModeConfiguration>;
  saveModeConfig?: (config: ModeConfiguration) => Promise<void>;

  // §22.1/§23.2 NVG services — DI (HOLE-S7-001)
  nvgService?: NvgService;
  trailReader?: RoutingTrailReader;
  loadNvgRoutingPolicy?: () => Promise<NvgRoutingPolicy>;
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

  // ── Register all routes from routes/ directory (BS-D2-004) ────────────────
  registerAllRoutes(app, deps, { currentPolicy: null });

  // ── Server start ──────────────────────────────────────────────────────────
  function startServer(port: number = 7701): void {
    app.listen(port, '127.0.0.1', () => {
      console.log(`Nexus management API listening on 127.0.0.1:${port}`);
    });
  }

  return { app, start: startServer };
}
