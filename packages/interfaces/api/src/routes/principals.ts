/**
 * Principal routes — spec §23.2
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { PrincipalRegistry } from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { san } from './shared.js';

export function registerPrincipalRoutes(
  app: Express,
  deps: { principalRegistry: PrincipalRegistry }
): void {
  const { principalRegistry } = deps;

  app.post('/principals', async (req, res) => {
    try {
      const p = req.body;
      if (!p?.principalId) {
        res.status(400).json({ ok: false, error: 'principalId required' });
        return;
      }
      await principalRegistry.register({ ...p, registeredAt: nowIso() });
      res.json({ ok: true, data: { principalId: p.principalId } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/principals/:id', async (req, res) => {
    try {
      const p = await principalRegistry.get(req.params['id']!);
      if (!p) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: p });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
