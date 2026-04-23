/**
 * NVG routes — spec §23.2, HOLE-S7-001
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type { NvgService, NvgRoutingPolicy, RoutingTrailReader } from '@nexus/contracts';
import { san } from './shared.js';

export function registerNvgRoutes(
  app: Express,
  deps: {
    nvgService?: NvgService;
    trailReader?: RoutingTrailReader;
    loadNvgRoutingPolicy?: () => Promise<NvgRoutingPolicy>;
  }
): void {
  const { nvgService, trailReader, loadNvgRoutingPolicy } = deps;

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
    try {
      if (!loadNvgRoutingPolicy) {
        res.status(501).json({ ok: false, error: 'NVG policy loader not configured' });
        return;
      }
      const policy = await loadNvgRoutingPolicy();
      res.json({
        ok: true,
        data: {
          version: policy.version,
          policyId: policy.policyId,
          issuer: policy.issuer,
          issuedAt: policy.issuedAt,
          defaultAction: policy.defaultAction,
          ruleCount: policy.rules.length,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
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
}
