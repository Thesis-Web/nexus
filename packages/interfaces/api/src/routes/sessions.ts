/**
 * Session routes — spec §23.2
 * principalId never accepted from request body (SOLVE-017).
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { Express } from 'express';
import type {
  ActorRegistry,
  SessionStoreInterface,
  DelegationStore,
  Session,
} from '@nexus/contracts';
import { ACTOR_CLASS, nowIso, newUuid, addSeconds } from '@nexus/contracts';
import { san } from './shared.js';

export function registerSessionRoutes(
  app: Express,
  deps: {
    actorRegistry: ActorRegistry;
    sessionStore: SessionStoreInterface;
    delegationStore: DelegationStore;
  }
): void {
  const { actorRegistry, sessionStore, delegationStore } = deps;

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
      const delegation = await delegationStore.getById(delegationId);
      if (!delegation) {
        res.status(400).json({ ok: false, error: 'delegation not found' });
        return;
      }
      // SPEC-DELEGATION-RUNTIME-PRINCIPAL-FIX §2.4.
      // Human actors create sessions under their own principal — strict match.
      // Agents act under the requesting USER's principal, which won't equal
      // the agent's registrar principal. The delegation already binds the
      // runtime principal; checking actor.principalId here would block agents.
      const isHumanActor =
        actor.actorClass === ACTOR_CLASS.HUMAN ||
        actor.actorClass === ACTOR_CLASS.HUMAN_WITH_COPILOT;
      if (isHumanActor && actor.principalId !== delegation.principalId) {
        res
          .status(400)
          .json({ ok: false, error: 'actor.principalId does not match delegation.principalId' });
        return;
      }
      // GATE01-002 FIX: delegation must be bound to this actor
      if (delegation.actorId !== actor.actorId) {
        res
          .status(400)
          .json({ ok: false, error: 'delegation.actorId does not match actor.actorId' });
        return;
      }
      const session: Session = {
        sessionId: newUuid(),
        actorId: actor.actorId,
        // Use the delegation's principal — the runtime authority for this
        // session — not the actor's registrar principal.
        principalId: delegation.principalId,
        delegationId: delegation.delegationId,
        createdAt: nowIso(),
        expiresAt: addSeconds(nowIso(), ttlSeconds),
      };
      await sessionStore.create(session);
      res.json({
        ok: true,
        data: { sessionId: session.sessionId, expiresAt: session.expiresAt },
      });
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
}
