/**
 * Delegation routes — spec §23.2
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type {
  ActorRegistry,
  PrincipalRegistry,
  DelegationStore,
  Principal,
  Actor,
  DelegationContext,
} from '@nexus/contracts';
import { nowIso, addSeconds } from '@nexus/contracts';
import { san } from './shared.js';

export function registerDelegationRoutes(
  app: Express,
  deps: {
    actorRegistry: ActorRegistry;
    principalRegistry: PrincipalRegistry;
    delegationStore: DelegationStore;
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
  }
): void {
  const { actorRegistry, principalRegistry, delegationStore, mintRootDelegation } = deps;

  app.post('/delegations', async (req, res) => {
    try {
      const body = req.body ?? {};
      const actor = await actorRegistry.get(body.actorId);
      if (!actor) {
        res.status(400).json({ ok: false, error: 'actor not found' });
        return;
      }
      const principal = await principalRegistry.get(body.principalId);
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
      await delegationStore.save(dc);
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
      const dc = await delegationStore.getById(req.params['id']!);
      if (!dc) {
        res.status(404).json({ ok: false, error: 'not found' });
        return;
      }
      res.json({ ok: true, data: dc });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}
