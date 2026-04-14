/**
 * Nexus Management API — spec §23
 * Express on port 7701, binds 127.0.0.1 only (SOLVE-008).
 * timingSafeEqual on all token comparisons.
 * principalId never in POST /sessions body (SOLVE-017).
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
  initializeSchema,
  loadAdminToken,
  loadControlPlaneKey,
  ActorRegistry,
  PrincipalRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  SqliteApproverRegistry,
  SqlitePendingApprovalStore,
  JsonlLedgerBackend,
  mintRootDelegation,
  decideApproval,
  ApprovalDecisionError,
  loadPolicyFile,
  verifyChain,
  nowIso,
  newUuid,
  addSeconds,
} from '@nexus/core';
import type { Session, TokenPostureReport, PostureViolation } from '@nexus/core';

const DB_PATH = process.env['NEXUS_DB_PATH'] ?? path.join(process.cwd(), 'nexus.db');
const LEDGER_PATH =
  process.env['NEXUS_LEDGER_PATH'] ?? path.join(process.cwd(), 'nexus.ledger.jsonl');

async function start(): Promise<void> {
  let adminToken: string;
  try {
    adminToken = await loadAdminToken();
  } catch {
    console.error('✗ keys/admin.token not found. Run `nexus init` first.');
    process.exit(1);
  }

  const controlPlaneKey = await loadControlPlaneKey();
  const db = new Database(DB_PATH);
  initializeSchema(db);

  const actorRegistry = new ActorRegistry(db);
  const principalReg = new PrincipalRegistry(db);
  const sessionStore = new SqliteSessionStore(db);
  const delegStore = new SqliteDelegationStore(db);
  const approvalStore = new SqlitePendingApprovalStore(db);
  const ledger = new JsonlLedgerBackend(LEDGER_PATH);
  let currentPolicy: Awaited<ReturnType<typeof loadPolicyFile>> | null = null;

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
      res.json({ ok: true, data: { sessionId: session.sessionId, expiresAt: session.expiresAt } });
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
      // mintRootDelegation takes 3 args — loads controlPlaneKey internally
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
      res.json({ ok: true, data: { delegationId: dc.delegationId, expiresAt: dc.expiresAt } });
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
      currentPolicy = await loadPolicyFile(filepath, controlPlaneKey);
      // LoadedPolicyFile has bundleId, bundleVersion — not policyId
      res.json({
        ok: true,
        data: {
          bundleId: currentPolicy.bundleId,
          bundleVersion: currentPolicy.bundleVersion,
          ruleCount: currentPolicy.rules.length,
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
        ruleCount: currentPolicy.rules.length,
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
      // verifyChain(backend, fromSeq, toSeq, publicKey)
      const result = await verifyChain(ledger, from, to, controlPlaneKey.publicKey);
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
        .filter(a => a.actorClass !== 'human' && !a.owner)
        .map(a => ({
          actorId: a.actorId,
          actorClass: a.actorClass,
          reason: `Non-human actor ${a.actorId} has no owner` as any,
          detectedAt: nowIso(),
        }));
      const report: TokenPostureReport = {
        generatedAt: nowIso(),
        totalActors: actors.length,
        violations,
        postureScore:
          actors.length === 0 ? 1.0 : Math.max(0, 1.0 - violations.length / (actors.length * 2)),
      };
      res.json({ ok: true, data: report });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.listen(7701, '127.0.0.1', () => {
    console.log('Nexus management API listening on 127.0.0.1:7701');
    console.log(`DB: ${DB_PATH}`);
  });
}

function san(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  return err.message
    .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED]')
    .slice(0, 300);
}

start().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
