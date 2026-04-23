/**
 * Actor routes — spec §23.2
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { ActorRegistry } from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { san } from './shared.js';

export function registerActorRoutes(app: Express, deps: { actorRegistry: ActorRegistry }): void {
  const { actorRegistry } = deps;

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
}
