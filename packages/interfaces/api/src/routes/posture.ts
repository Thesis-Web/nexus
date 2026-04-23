/**
 * Posture route — spec §23.2
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type {
  ActorRegistry,
  Actor,
  TokenPostureReport,
  PostureViolation,
  ActorPosture,
} from '@nexus/contracts';
import { nowIso, newUuid, ACTOR_CLASS } from '@nexus/contracts';
import { san } from './shared.js';

export function registerPostureRoutes(app: Express, deps: { actorRegistry: ActorRegistry }): void {
  const { actorRegistry } = deps;

  app.get('/posture', async (_req, res) => {
    try {
      const actors = await actorRegistry.list();
      const violations: PostureViolation[] = actors
        .filter((a: Actor) => a.actorClass !== ACTOR_CLASS.HUMAN && !a.owner)
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
}
