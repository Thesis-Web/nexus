/**
 * Admin Dashboard Ledger Viewer Routes — CLAUDE-CODE-LEDGER-VIEWER-SPEC.
 *
 * File: packages/interfaces/api/src/routes/admin-ledger.ts
 * Layer 7 — workspace-attached read-only views over the three governance
 * ledgers (Run Ledger / Evidence Ledger / NVG Routing Trail).
 *
 * Auth chain matches admin-writer.ts: workspace JWT (enforced by the
 * blanket /workspace/* middleware) → nexus-admin role → X-Elevated-Session.
 * The same `checkAdminAuth` helper guards every route here.
 *
 * Routes (all GET):
 *   /workspace/admin/ledger/runs              — recent runs grouped by runId
 *   /workspace/admin/ledger/runs/:runId       — every entry for a specific run
 *   /workspace/admin/ledger/evidence          — evidence by ?runId or ?from/?to
 *   /workspace/admin/ledger/evidence/verify   — chain verify over ?from/?to
 *   /workspace/admin/ledger/trail             — routing trail by ?runId or tail
 *
 * Existing admin-bearer routes (`/run-ledger`, `/ledger`, `/nvg/trail`) are
 * intentionally untouched — they still work for CLI / server-side use. This
 * module is the browser-callable mirror.
 *
 * Import law: Layer 7 — @nexus/contracts only, plus local route helpers.
 */
import type { Express, Request, Response } from 'express';
import type {
  EvidenceRecord,
  LedgerBackend,
  RoutingProvenanceTrailEntry,
  RoutingTrailReader,
  RunLedgerEntry,
  RunLedgerWriter,
  Uuid,
  ChainVerificationResult,
} from '@nexus/contracts';
import { checkAdminAuth, type AdminAuthDeps } from './admin-auth.js';
import { san } from './shared.js';

// ── Dependencies ────────────────────────────────────────────────────────────

export interface AdminLedgerRouteDeps extends AdminAuthDeps {
  readonly runLedgerWriter?: RunLedgerWriter;
  readonly ledgerBackend?: LedgerBackend;
  readonly trailReader?: RoutingTrailReader;
  readonly verifyChain?: (
    backend: LedgerBackend,
    from: number,
    to: number
  ) => Promise<ChainVerificationResult>;
}

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Default tail size when listing recent runs. We pull a wider event window
 * than the run cap because runs span many events; aggregating from `tail`
 * produces fewer-than-N runs if the tail ends mid-run otherwise.
 */
const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 100;
const RUN_TAIL_FACTOR = 30;

/** Cap how far back the evidence-by-runId scan walks. Ledgers grow forever
 * in production; bounding the scan keeps the dashboard responsive. */
const EVIDENCE_BY_RUN_SCAN_CAP = 1000;

const DEFAULT_TRAIL_TAIL = 50;
const MAX_TRAIL_TAIL = 500;

// ── Run aggregation ────────────────────────────────────────────────────────

interface RunSummary {
  runId: string;
  eventCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  lastEventType: string;
  /** 'open' until a run_closed event arrives; 'completed'/'denied'/'cancelled'
   *  derive from the close detail when present. */
  status: 'open' | 'completed' | 'denied' | 'cancelled' | 'error';
}

/**
 * Group ledger entries by runId, derive a status from terminal events, and
 * sort newest-first by lastTimestamp. The ledger is append-only so the
 * order of arrival within a runId is also chronological.
 */
function summarizeRuns(entries: RunLedgerEntry[]): RunSummary[] {
  const byRun = new Map<string, RunSummary>();
  for (const e of entries) {
    const existing = byRun.get(e.runId);
    if (!existing) {
      byRun.set(e.runId, {
        runId: e.runId,
        eventCount: 1,
        firstTimestamp: e.timestamp,
        lastTimestamp: e.timestamp,
        lastEventType: e.eventType,
        status: deriveStatus('open', e),
      });
    } else {
      existing.eventCount += 1;
      // Earliest timestamp wins for first; latest for last. The ledger is
      // ISO-8601, so lexicographic compare is chronological.
      if (e.timestamp < existing.firstTimestamp) existing.firstTimestamp = e.timestamp;
      if (e.timestamp >= existing.lastTimestamp) {
        existing.lastTimestamp = e.timestamp;
        existing.lastEventType = e.eventType;
      }
      existing.status = deriveStatus(existing.status, e);
    }
  }
  const summaries = Array.from(byRun.values());
  summaries.sort((a, b) => (b.lastTimestamp < a.lastTimestamp ? -1 : 1));
  return summaries;
}

function deriveStatus(prior: RunSummary['status'], entry: RunLedgerEntry): RunSummary['status'] {
  // run_cancelled is an explicit terminal state.
  if (entry.eventType === 'run_cancelled') return 'cancelled';
  // plan_rejected / node_failed / dag_failed are non-terminal denial signals.
  // We keep them as 'denied' until run_closed clarifies the cause.
  if (
    entry.eventType === 'plan_rejected' ||
    entry.eventType === 'node_failed' ||
    entry.eventType === 'dag_failed'
  ) {
    return 'denied';
  }
  if (entry.eventType !== 'run_closed') return prior;
  // run_closed: prefer detail.closeReason / detail.reason for the final state.
  const detail = (entry.detail ?? {}) as Record<string, unknown>;
  const reason =
    typeof detail['closeReason'] === 'string'
      ? detail['closeReason']
      : typeof detail['reason'] === 'string'
        ? (detail['reason'] as string)
        : null;
  if (reason === null) return prior === 'open' ? 'completed' : prior;
  if (reason === 'completed' || reason === 'success') return 'completed';
  if (reason === 'user_cancelled' || reason === 'cancelled' || reason === 'run_cancelled') {
    return 'cancelled';
  }
  if (reason === 'compile_skipped' || reason === 'no_eligible_results') {
    // Treat a compile-skipped close as denied unless we already have a
    // stronger signal — compile-skip means nothing user-facing was produced.
    return prior === 'open' ? 'denied' : prior;
  }
  if (reason.startsWith('error') || reason.includes('failed')) return 'error';
  // Anything else is a structured close — promote 'open' to 'completed'.
  return prior === 'open' ? 'completed' : prior;
}

// ── Route registration ─────────────────────────────────────────────────────

export function registerAdminLedgerRoutes(app: Express, deps: AdminLedgerRouteDeps): void {
  // ─── GET /workspace/admin/ledger/runs ──────────────────────────────────
  // Paginate by tailing the ledger. Returns up to ?limit (default 20) most
  // recent runs grouped from the tail window.
  app.get('/workspace/admin/ledger/runs', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.runLedgerWriter) {
      res.status(501).json({ ok: false, error: 'Run ledger not configured' });
      return;
    }
    try {
      const limit = clampInt(req.query['limit'], DEFAULT_RUN_LIMIT, 1, MAX_RUN_LIMIT);
      const tailWindow = Math.max(limit * RUN_TAIL_FACTOR, 100);
      const entries = await deps.runLedgerWriter.tail(tailWindow);
      const summaries = summarizeRuns(entries).slice(0, limit);
      res.json({
        ok: true,
        data: {
          runs: summaries,
          tailWindow,
          totalEventsScanned: entries.length,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── GET /workspace/admin/ledger/runs/:runId ───────────────────────────
  app.get('/workspace/admin/ledger/runs/:runId', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.runLedgerWriter) {
      res.status(501).json({ ok: false, error: 'Run ledger not configured' });
      return;
    }
    try {
      const runId = String(req.params['runId'] ?? '');
      if (!runId) {
        res.status(400).json({ ok: false, error: 'runId required' });
        return;
      }
      const events = await deps.runLedgerWriter.getByRunId(runId as Uuid);
      res.json({ ok: true, data: { runId, events, eventCount: events.length } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── GET /workspace/admin/ledger/evidence ──────────────────────────────
  // Either ?runId=<uuid> (scan-and-filter — capped) or ?from=N&to=N range.
  app.get('/workspace/admin/ledger/evidence', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.ledgerBackend) {
      res.status(501).json({ ok: false, error: 'Evidence ledger not configured' });
      return;
    }
    try {
      const runIdQuery = req.query['runId'];
      if (typeof runIdQuery === 'string' && runIdQuery.length > 0) {
        // No native by-runId index on LedgerBackend (§12.3.24). Walk the
        // most recent EVIDENCE_BY_RUN_SCAN_CAP records and filter. The
        // dashboard surfaces a capped scan banner when truncated.
        const latest = await deps.ledgerBackend.getLatestSequence();
        const from = Math.max(1, latest - EVIDENCE_BY_RUN_SCAN_CAP + 1);
        const range = await deps.ledgerBackend.listRange(from, latest);
        const filtered = range.filter((r: EvidenceRecord) => r.runId === runIdQuery);
        res.json({
          ok: true,
          data: {
            records: filtered,
            scannedFrom: from,
            scannedTo: latest,
            truncated: latest - from + 1 >= EVIDENCE_BY_RUN_SCAN_CAP,
          },
        });
        return;
      }
      const fromRaw = req.query['from'];
      const toRaw = req.query['to'];
      const from = clampInt(fromRaw, 1, 1, Number.MAX_SAFE_INTEGER);
      const latestSeq = await deps.ledgerBackend.getLatestSequence();
      const toDefault = Math.max(latestSeq, from);
      const to = clampInt(toRaw, toDefault, 1, Number.MAX_SAFE_INTEGER);
      if (to < from) {
        res.status(400).json({ ok: false, error: 'to must be >= from' });
        return;
      }
      const records = await deps.ledgerBackend.listRange(from, to);
      res.json({
        ok: true,
        data: {
          records,
          from,
          to,
          latestSequence: latestSeq,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── GET /workspace/admin/ledger/evidence/verify ───────────────────────
  // Re-derives hashes and verifies signatures across the requested range.
  app.get('/workspace/admin/ledger/evidence/verify', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.ledgerBackend || !deps.verifyChain) {
      res.status(501).json({ ok: false, error: 'Chain verifier not configured' });
      return;
    }
    try {
      const latestSeq = await deps.ledgerBackend.getLatestSequence();
      const from = clampInt(req.query['from'], 1, 1, Number.MAX_SAFE_INTEGER);
      const to = clampInt(req.query['to'], latestSeq, 1, Number.MAX_SAFE_INTEGER);
      if (to < from) {
        res.status(400).json({ ok: false, error: 'to must be >= from' });
        return;
      }
      const result = await deps.verifyChain(deps.ledgerBackend, from, to);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── GET /workspace/admin/ledger/trail ─────────────────────────────────
  app.get('/workspace/admin/ledger/trail', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.trailReader) {
      res.status(501).json({ ok: false, error: 'NVG trail reader not configured' });
      return;
    }
    try {
      const runId = req.query['runId'];
      let entries: RoutingProvenanceTrailEntry[];
      if (typeof runId === 'string' && runId.length > 0) {
        entries = await deps.trailReader.getByRunId(runId as Uuid);
      } else {
        const limit = clampInt(req.query['limit'], DEFAULT_TRAIL_TAIL, 1, MAX_TRAIL_TAIL);
        entries = await deps.trailReader.tail(limit);
      }
      res.json({ ok: true, data: { entries } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}
