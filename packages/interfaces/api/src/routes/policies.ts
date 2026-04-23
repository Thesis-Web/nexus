/**
 * Policy routes — spec §23.2
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { LoadedPolicyFile } from '@nexus/contracts';
import { san, type ApiSharedState } from './shared.js';

export function registerPolicyRoutes(
  app: Express,
  deps: {
    loadPolicyFile: (filepath: string) => Promise<LoadedPolicyFile>;
  },
  state: ApiSharedState
): void {
  const { loadPolicyFile } = deps;

  app.post('/policies', async (req, res) => {
    try {
      const { filepath } = req.body ?? {};
      if (!filepath || typeof filepath !== 'string') {
        res.status(400).json({ ok: false, error: 'filepath required' });
        return;
      }
      state.currentPolicy = await loadPolicyFile(filepath);
      res.json({
        ok: true,
        data: {
          bundleId: state.currentPolicy.bundleId,
          bundleVersion: state.currentPolicy.bundleVersion,
          ruleCount: state.currentPolicy.sortedRules.length,
        },
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: san(err) });
    }
  });

  app.get('/policies/current', (_req, res) => {
    if (!state.currentPolicy) {
      res.status(404).json({ ok: false, error: 'no policy loaded' });
      return;
    }
    res.json({
      ok: true,
      data: {
        bundleId: state.currentPolicy.bundleId,
        bundleVersion: state.currentPolicy.bundleVersion,
        ruleCount: state.currentPolicy.sortedRules.length,
      },
    });
  });
}
