import {
  SqliteActorRegistry,
  SqlitePrincipalRegistry,
  SqliteDelegationStore,
  mintRootDelegation,
} from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdDelegate(opts: {
  principal: string;
  actor: string;
  systems: string;
  caps: string;
  forbidden?: string;
  maxRisk: string;
  env: string;
  ttl: number;
  maxChainDepth?: number;
  allowPropagation?: boolean;
}): Promise<void> {
  const db = openDb();
  const actorRegistry = new SqliteActorRegistry(db);
  const principalRegistry = new SqlitePrincipalRegistry(db);
  const delegationStore = new SqliteDelegationStore(db);
  const actor = await actorRegistry.get(opts.actor);
  if (!actor) {
    console.error(`✗ Actor not found: ${opts.actor}`);
    process.exit(1);
  }
  const principal = await principalRegistry.get(opts.principal);
  if (!principal) {
    console.error(`✗ Principal not found: ${opts.principal}`);
    process.exit(1);
  }
  try {
    const delegation = await mintRootDelegation(principal, actor, {
      principalId: principal.principalId,
      actorId: actor.actorId,
      allowedSystems: opts.systems
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      allowedCapabilities: opts.caps
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
      forbiddenCapabilities: opts.forbidden
        ? opts.forbidden
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
      maxRiskTier: opts.maxRisk as any,
      environment: opts.env as any,
      allowDownstreamPropagation: opts.allowPropagation ?? false,
      maxChainDepth: opts.maxChainDepth ?? 1,
      expiresAt: new Date(Date.now() + opts.ttl * 1000).toISOString() as any,
    });
    await delegationStore.save(delegation);
    console.log(
      JSON.stringify(
        { ok: true, delegationId: delegation.delegationId, expiresAt: delegation.expiresAt },
        null,
        2
      )
    );
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
