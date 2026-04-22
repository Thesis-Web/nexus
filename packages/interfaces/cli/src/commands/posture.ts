import { SqliteActorRegistry, nowIso, newUuid, ACTOR_CLASS } from '@nexus/core';
import type { TokenPostureReport, PostureViolation, ActorPosture } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdPosture(): Promise<void> {
  const db = openDb();
  const actors = await new SqliteActorRegistry(db).list();
  const violations: PostureViolation[] = [];
  for (const a of actors) {
    if (a.actorClass !== ACTOR_CLASS.HUMAN && !a.owner)
      violations.push({
        type: 'unowned_non_human_actor',
        detail: `Non-human actor ${a.actorId} has no owner`,
        actorId: a.actorId,
      });
    if (a.actorClass !== ACTOR_CLASS.HUMAN && !a.reviewCadence)
      violations.push({
        type: 'missing_review_cadence',
        detail: `Non-human actor ${a.actorId} has no reviewCadence`,
        actorId: a.actorId,
      });
  }
  const actorPostures: ActorPosture[] = actors.map(a => ({
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
  console.log(JSON.stringify(report, null, 2));
}
