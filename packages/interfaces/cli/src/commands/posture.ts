import { ActorRegistry, nowIso } from '@nexus/core';
import type { TokenPostureReport, PostureViolation } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdPosture(): Promise<void> {
  const db = openDb();
  const actors = await new ActorRegistry(db).list();
  const violations: PostureViolation[] = [];
  for (const a of actors) {
    if (a.actorClass !== 'human' && !a.owner)
      violations.push({
        actorId: a.actorId,
        actorClass: a.actorClass,
        reason: `Non-human actor ${a.actorId} has no owner` as any,
        detectedAt: nowIso(),
      });
    if (a.actorClass !== 'human' && !a.reviewCadence)
      violations.push({
        actorId: a.actorId,
        actorClass: a.actorClass,
        reason: `Non-human actor ${a.actorId} has no reviewCadence` as any,
        detectedAt: nowIso(),
      });
  }
  const report: TokenPostureReport = {
    generatedAt: nowIso(),
    totalActors: actors.length,
    violations,
    postureScore:
      actors.length === 0 ? 1.0 : Math.max(0, 1.0 - violations.length / (actors.length * 2)),
  };
  console.log(JSON.stringify(report, null, 2));
}
