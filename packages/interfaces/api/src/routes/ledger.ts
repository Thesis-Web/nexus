/**
 * Ledger routes — spec §23.2
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { LedgerBackend, ChainVerificationResult } from '@nexus/contracts';
import { san } from './shared.js';

export function registerLedgerRoutes(
  app: Express,
  deps: {
    ledgerBackend: LedgerBackend;
    verifyChain: (
      backend: LedgerBackend,
      from: number,
      to: number
    ) => Promise<ChainVerificationResult>;
  }
): void {
  const { ledgerBackend, verifyChain } = deps;

  app.get('/ledger', async (req, res) => {
    try {
      const from = parseInt(String(req.query['from'] ?? '1'), 10);
      const to = parseInt(String(req.query['to'] ?? '50'), 10);
      res.json({ ok: true, data: await ledgerBackend.listRange(from, to) });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/ledger/:recordId', async (req, res) => {
    try {
      const r = await ledgerBackend.getByRecordId(req.params['recordId']!);
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
      const result = await verifyChain(ledgerBackend, from, to);
      res.json({ ok: true, data: result });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
