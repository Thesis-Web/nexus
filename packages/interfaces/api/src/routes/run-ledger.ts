/**
 * Run Ledger routes — spec §23.2, DEF-008
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { RunLedgerWriter } from '@nexus/contracts';
import { san } from './shared.js';

export function registerRunLedgerRoutes(
  app: Express,
  deps: { runLedgerWriter?: RunLedgerWriter }
): void {
  const { runLedgerWriter } = deps;

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
}
