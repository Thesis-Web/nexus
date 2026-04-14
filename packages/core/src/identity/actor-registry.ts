/**
 * Actor registry — spec §20.2
 * Backed by SQLite actors table (§20.1).
 * Validation: non-human actors must have owner/purpose/reviewCadence.
 */
import type Database from 'better-sqlite3';
import {
  ACTOR_CLASS,
  type Actor,
  type Uuid,
  type ActorClass,
  type ActorRegistryStore,
} from '../types/index.js';

interface ActorRow {
  actor_id: string;
  actor_class: string;
  principal_id: string;
  display_name: string;
  environment: string;
  risk_ceiling: string;
  allowed_systems: string;
  registered_at: string;
  owner: string | null;
  purpose: string | null;
  review_cadence: string | null;
}

function rowToActor(row: ActorRow): Actor {
  return {
    actorId: row.actor_id,
    actorClass: row.actor_class,
    principalId: row.principal_id,
    displayName: row.display_name,
    environment: row.environment,
    riskCeiling: row.risk_ceiling,
    allowedSystems: JSON.parse(row.allowed_systems) as string[],
    registeredAt: row.registered_at,
    ...(row.owner !== null ? { owner: row.owner } : {}),
    ...(row.purpose !== null ? { purpose: row.purpose } : {}),
    ...(row.review_cadence !== null ? { reviewCadence: row.review_cadence } : {}),
  };
}

export class ActorRegistry implements ActorRegistryStore {
  constructor(private readonly db: Database.Database) {}

  async get(actorId: Uuid): Promise<Actor | null> {
    const row = this.db.prepare('SELECT * FROM actors WHERE actor_id = ?').get(actorId) as
      | ActorRow
      | undefined;
    return row ? rowToActor(row) : null;
  }

  async getByClass(actorClass: ActorClass): Promise<Actor[]> {
    const rows = this.db
      .prepare('SELECT * FROM actors WHERE actor_class = ?')
      .all(actorClass) as ActorRow[];
    return rows.map(rowToActor);
  }

  async register(actor: Actor): Promise<Actor> {
    const isNonHuman =
      actor.actorClass !== ACTOR_CLASS.HUMAN && actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;

    if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
      throw new Error(
        `Non-human actor ${actor.actorId} must have owner, purpose, and reviewCadence`
      );
    }

    this.db
      .prepare(
        `
        INSERT INTO actors
          (actor_id, actor_class, principal_id, display_name, environment, risk_ceiling,
           allowed_systems, registered_at, owner, purpose, review_cadence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        actor.actorId,
        actor.actorClass,
        actor.principalId,
        actor.displayName,
        actor.environment,
        actor.riskCeiling,
        JSON.stringify(actor.allowedSystems),
        actor.registeredAt,
        actor.owner ?? null,
        actor.purpose ?? null,
        actor.reviewCadence ?? null
      );
    return actor;
  }

  async list(): Promise<Actor[]> {
    const rows = this.db.prepare('SELECT * FROM actors').all() as ActorRow[];
    return rows.map(rowToActor);
  }
}
