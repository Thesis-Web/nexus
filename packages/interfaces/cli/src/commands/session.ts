import {
  SqliteActorRegistry,
  SqliteSessionStore,
  SqliteDelegationStore,
  addSeconds,
  newUuid,
  nowIso,
} from '@nexus/core';
import type { Session } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdSessionStart(opts: {
  actor: string;
  delegation: string;
  ttl?: number;
}): Promise<void> {
  const db = openDb();
  const actorRegistry = new SqliteActorRegistry(db);
  const sessionStore = new SqliteSessionStore(db);
  const delegationStore = new SqliteDelegationStore(db);
  const actor = await actorRegistry.get(opts.actor);
  if (!actor) {
    console.error(`✗ Actor not found: ${opts.actor}`);
    process.exit(1);
  }
  const delegation = await delegationStore.getById(opts.delegation);
  if (!delegation) {
    console.error(`✗ Delegation not found: ${opts.delegation}`);
    process.exit(1);
  }
  // GATE01-002 FIX: delegation must be bound to this actor and principal
  if (delegation.actorId !== actor.actorId) {
    console.error(`✗ delegation.actorId does not match actor.actorId`);
    process.exit(1);
  }
  if (delegation.principalId !== actor.principalId) {
    console.error(`✗ delegation.principalId does not match actor.principalId`);
    process.exit(1);
  }
  const ttlSeconds = opts.ttl ?? 3600;
  const createdAt = nowIso();
  const session: Session = {
    sessionId: newUuid(),
    actorId: actor.actorId,
    principalId: actor.principalId,
    delegationId: delegation.delegationId,
    createdAt,
    expiresAt: addSeconds(createdAt, ttlSeconds),
  };
  await sessionStore.create(session);
  console.log(
    JSON.stringify(
      { ok: true, sessionId: session.sessionId, expiresAt: session.expiresAt },
      null,
      2
    )
  );
}
