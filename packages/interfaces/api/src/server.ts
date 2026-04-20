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
  Session,
  TokenPostureReport,
  PostureViolation,
  ActorPosture,
  Actor,
  Principal,
  DelegationContext,
  RunLedgerWriter,
  ModeConfiguration,
  NvgService,
  RoutingTrailReader,
} from '@nexus/contracts';
import { ApprovalDecisionError, nowIso, newUuid, addSeconds } from '@nexus/contracts';

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
}

// ── §23.1 createApiServer — DI factory ───────────────────────────────────────

export function createApiServer(deps: ApiDependencies): {
  app: ReturnType<typeof express>;
  start: (port?: number) => void;
} {
  const {
    actorRegistry,
    principalRegistry: principalReg,
    sessionStore,
    delegationStore: delegStore,
    approvalStore,
    ledgerBackend: ledger,
    mintRootDelegation,
    loadPolicyFile,
    verifyChain,
    decideApproval,
    adminToken,
    runLedgerWriter,
    loadModeConfig: loadMode,
    saveModeConfig: _saveMode,
    nvgService,
    trailReader,
  } = deps;

  let currentPolicy: LoadedPolicyFile | null = null;

  const app = express();
  app.use(express.json());

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

  // ── Principals ────────────────────────────────────────────────────────────
  app.post('/principals', async (req, res) => {
    try {
      const p = req.body;
      if (!p?.principalId) {
        res.status(400).json({ ok: false, error: 'principalId required' });
        return;
      }
      await principalReg.register({ ...p, registeredAt: nowIso() });
      res.json({ ok: true, data: { principalId: p.principalId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/principals/:id', async (req, res) => {
    try {
      const p = await principalReg.get(req.params['id']!);
      if (!p) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: p });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Actors ────────────────────────────────────────────────────────────────
  app.post('/actors', async (req, res) => {
    try {
      const a = req.body;
      if (!a?.actorId) {
        res.status(400).json({ ok: false, error: 'actorId required' });
        return;
      }
      await actorRegistry.register({ ...a, registeredAt: nowIso() });
      res.json({ ok: true, data: { actorId: a.actorId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/actors', async (_req, res) => {
    try {
      res.json({ ok: true, data: await actorRegistry.list() });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/actors/:id', async (req, res) => {
    try {
      const a = await actorRegistry.get(req.params['id']!);
      if (!a) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: a });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Sessions ──────────────────────────────────────────────────────────────
  app.post('/sessions', async (req, res) => {
    try {
      const { actorId, delegationId, ttlSeconds = 3600 } = req.body ?? {};
      if (!actorId || !delegationId) {
        res.status(400).json({ ok: false, error: 'actorId and delegationId required' });
        return;
      }
      const actor = await actorRegistry.get(actorId);
      if (!actor) {
        res.status(400).json({ ok: false, error: 'actor not found' });
        return;
      }
      const delegation = await delegStore.getById(delegationId);
      if (!delegation) {
        res.status(400).json({ ok: false, error: 'delegation not found' });
        return;
      }
      if (actor.principalId !== delegation.principalId) {
        res
          .status(400)
          .json({ ok: false, error: 'actor.principalId does not match delegation.principalId' });
        return;
      }
      const session: Session = {
        sessionId: newUuid(),
        actorId: actor.actorId,
        principalId: actor.principalId,
        delegationId: delegation.delegationId,
        createdAt: nowIso(),
        expiresAt: addSeconds(nowIso(), ttlSeconds),
      };
      await sessionStore.create(session);
      res.json({
        ok: true,
        data: { sessionId: session.sessionId, expiresAt: session.expiresAt },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/sessions/:id', async (req, res) => {
    try {
      const s = await sessionStore.get(req.params['id']!);
      if (!s) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: s });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Delegations ───────────────────────────────────────────────────────────
  app.post('/delegations', async (req, res) => {
    try {
      const body = req.body ?? {};
      const actor = await actorRegistry.get(body.actorId);
      if (!actor) {
        res.status(400).json({ ok: false, error: 'actor not found' });
        return;
      }
      const principal = await principalReg.get(body.principalId);
      if (!principal) {
        res.status(400).json({ ok: false, error: 'principal not found' });
        return;
      }
      const dc = await mintRootDelegation(principal, actor, {
        principalId: principal.principalId,
        actorId: actor.actorId,
        allowedSystems: body.allowedSystems ?? [],
        allowedCapabilities: body.allowedCapabilities ?? [],
        forbiddenCapabilities: body.forbiddenCapabilities ?? [],
        maxRiskTier: body.maxRiskTier,
        allowDownstreamPropagation: body.allowDownstreamPropagation ?? false,
        environment: body.environment,
        expiresAt: body.expiresAt ?? addSeconds(nowIso(), body.ttlSeconds ?? 3600),
        maxChainDepth: body.maxChainDepth ?? 1,
      });
      await delegStore.save(dc);
      res.json({
        ok: true,
        data: { delegationId: dc.delegationId, expiresAt: dc.expiresAt },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/delegations/:id', async (req, res) => {
    try {
      const dc = await delegStore.getById(req.params['id']!);
      if (!dc) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: dc });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Policies ──────────────────────────────────────────────────────────────
  app.post('/policies', async (req, res) => {
    try {
      const { filepath } = req.body ?? {};
      if (!filepath || typeof filepath !== 'string') {
        res.status(400).json({ ok: false, error: 'filepath required' });
        return;
      }
      currentPolicy = await loadPolicyFile(filepath);
      res.json({
        ok: true,
        data: {
          bundleId: currentPolicy.bundleId,
          bundleVersion: currentPolicy.bundleVersion,
          ruleCount: currentPolicy.sortedRules.length,
        },
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: san(err) });
    }
  });
  app.get('/policies/current', (_req, res) => {
    if (!currentPolicy) {
      res.status(404).json({ ok: false, error: 'no policy loaded' });
      return;
    }
    res.json({
      ok: true,
      data: {
        bundleId: currentPolicy.bundleId,
        bundleVersion: currentPolicy.bundleVersion,
        ruleCount: currentPolicy.sortedRules.length,
      },
    });
  });

  // ── Approvals ─────────────────────────────────────────────────────────────
  app.get('/approvals/pending', async (_req, res) => {
    try {
      res.json({ ok: true, data: await approvalStore.listPending() });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.post('/approvals/:id/approve', async (req, res) => {
    try {
      const { decidedBy } = req.body ?? {};
      if (!decidedBy) {
        res.status(400).json({ ok: false, error: 'decidedBy required' });
        return;
      }
      const r = await decideApproval(
        req.params['id']!,
        decidedBy,
        'approved',
        undefined,
        approvalStore
      );
      res.json({ ok: true, data: { decision: r.decision, decidedBy: r.decidedBy } });
    } catch (err) {
      if (err instanceof ApprovalDecisionError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.post('/approvals/:id/deny', async (req, res) => {
    try {
      const { decidedBy, note } = req.body ?? {};
      if (!decidedBy) {
        res.status(400).json({ ok: false, error: 'decidedBy required' });
        return;
      }
      const r = await decideApproval(req.params['id']!, decidedBy, 'denied', note, approvalStore);
      res.json({ ok: true, data: { decision: r.decision, decidedBy: r.decidedBy } });
    } catch (err) {
      if (err instanceof ApprovalDecisionError) {
        res.status(400).json({ ok: false, error: err.message });
        return;
      }
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Ledger ────────────────────────────────────────────────────────────────
  app.get('/ledger', async (req, res) => {
    try {
      const from = parseInt(String(req.query['from'] ?? '1'), 10);
      const to = parseInt(String(req.query['to'] ?? '50'), 10);
      res.json({ ok: true, data: await ledger.listRange(from, to) });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/ledger/:recordId', async (req, res) => {
    try {
      const r = await ledger.getByRecordId(req.params['recordId']!);
      if (!r) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: r });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.post('/ledger/verify', async (req, res) => {
    try {
      const { from = 1, to = 9999 } = req.body ?? {};
      const result = await verifyChain(ledger, from, to);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Posture ───────────────────────────────────────────────────────────────
  app.get('/posture', async (_req, res) => {
    try {
      const actors = await actorRegistry.list();
      const violations: PostureViolation[] = actors
        .filter((a: Actor) => a.actorClass !== 'human' && !a.owner)
        .map((a: Actor) => ({
          type: 'unowned_non_human_actor' as const,
          detail: `Non-human actor ${a.actorId} has no owner`,
          actorId: a.actorId,
        }));
      const actorPostures: ActorPosture[] = actors.map((a: Actor) => ({
        actorId: a.actorId,
        actorClass: a.actorClass,
        owner: a.owner ?? null,
        environment: a.environment,
        grantCount: 0,
        maxRiskSeen: a.riskCeiling,
        hasOwner: !!a.owner,
      }));
      const report: TokenPostureReport = {
        generatedAt: nowIso(),
        runId: newUuid(),
        actors: actorPostures,
        grantPatterns: [],
        violations,
      };
      res.json({ ok: true, data: report });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Run Ledger (§23.2 — DEF-008) ──────────────────────────────────────────
  app.get('/run-ledger', async (req, res) => {
    try {
      if (!runLedgerWriter) {
        res.status(501).json({ ok: false, error: 'run ledger not configured' });
        return;
      }
      const runId = req.query['runId'] as string | undefined;
      if (runId) {
        const entries = await runLedgerWriter.getByRunId(runId as any);
        res.json({ ok: true, data: entries });
      } else {
        const entries = await runLedgerWriter.tail(50);
        res.json({ ok: true, data: entries });
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/run-ledger/latest', async (_req, res) => {
    try {
      if (!runLedgerWriter) {
        res.status(501).json({ ok: false, error: 'run ledger not configured' });
        return;
      }
      const latestRunId = await runLedgerWriter.getLatestRunId();
      if (!latestRunId) {
        res.status(404).json({ ok: false, error: 'no run ledger entries' });
        return;
      }
      const entries = await runLedgerWriter.getByRunId(latestRunId);
      res.json({ ok: true, data: { runId: latestRunId, entries } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ── Operating Modes (§23.2 — DEF-008) ─────────────────────────────────────
  app.get('/mode', async (_req, res) => {
    try {
      if (!loadMode) {
        res.status(501).json({ ok: false, error: 'mode management not configured' });
        return;
      }
      const config = await loadMode();
      res.json({
        ok: true,
        data: {
          nxsMode: config.nxsMode,
          nvgMode: config.nvgMode,
          enforcingLocked: config.enforcingLocked,
          updatedAt: config.updatedAt,
          updatedBy: config.updatedBy.adminId,
        },
      });
    } catch {
      res.json({
        ok: true,
        data: {
          nxsMode: 'observe',
          nvgMode: 'observe',
          enforcingLocked: false,
          updatedAt: null,
        },
      });
    }
  });
  app.post('/mode', async (_req, res) => {
    // §9.3: Mode changes require signed admin command with Ed25519 keypair.
    // Admin keypair cannot be safely transmitted over HTTP in the POC.
    // Use CLI: nexus mode set --engine <nxs|nvg> --mode <mode>
    res
      .status(501)
      .json({ ok: false, error: 'POST /mode requires admin keypair — use CLI nexus mode set' });
  });

  // ── NVG (§23.2 — DEF-008, HOLE-S7-001) ───────────────────────────────────
  app.get('/nvg/trail', async (req, res) => {
    try {
      if (!trailReader) {
        res.status(501).json({ ok: false, error: 'NVG trail not configured' });
        return;
      }
      const runId = req.query['runId'] as string | undefined;
      const entries = runId
        ? await trailReader.getByRunId(runId as any)
        : await trailReader.tail(50);
      res.json({ ok: true, data: entries });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.get('/nvg/policy', async (_req, res) => {
    // Return current NVG routing policy metadata (loaded at startup or via CLI)
    res.json({ ok: true, data: { message: 'NVG policy — use CLI nexus nvg policy-validate' } });
  });
  app.post('/nvg/classify', async (req, res) => {
    try {
      if (!nvgService) {
        res.status(501).json({ ok: false, error: 'NVG service not configured' });
        return;
      }
      const { dataLabels = [], octLevel, requestedTier = 'frontier_general' } = req.body ?? {};
      const classification = nvgService.classify(dataLabels);
      const result: Record<string, unknown> = { classification };
      if (octLevel) {
        result['ceilingCheck'] = nvgService.enforceOctCeiling(
          octLevel,
          requestedTier,
          classification
        );
      }
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
  app.post('/nvg/route', async (req, res) => {
    try {
      if (!nvgService) {
        res.status(501).json({ ok: false, error: 'NVG service not configured' });
        return;
      }
      const { policy, request, dataLabels = [] } = req.body ?? {};
      if (!policy || !request) {
        res.status(400).json({ ok: false, error: 'policy and request required' });
        return;
      }
      const classification = nvgService.classify(dataLabels);
      const decision = nvgService.route(policy, request, classification);
      res.json({ ok: true, data: decision });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  function startServer(port: number = 7701): void {
    app.listen(port, '127.0.0.1', () => {
      console.log(`Nexus management API listening on 127.0.0.1:${port}`);
    });
  }

  return { app, start: startServer };
}

function san(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  return err.message
    .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED]')
    .slice(0, 300);
}
