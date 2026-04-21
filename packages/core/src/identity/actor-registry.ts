/**
 * Actor registry — spec §20.2, §11.1
 * Backed by SQLite actors table (§20.1).
 * Validation: non-human actors must have owner/purpose/reviewCadence.
 * §11.1: octLevel persisted and retrieved.
 */
import type Database from 'better-sqlite3';
import {
  ACTOR_CLASS,
  OCT_LEVEL,
  type Actor,
  type Uuid,
  type ActorClass,
  type ActorRegistry,
  type OctLevel,
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
  oct_level: string | null;
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
    octLevel: row.oct_level ?? OCT_LEVEL.OPEN,
    ...(row.owner !== null ? { owner: row.owner } : {}),
    ...(row.purpose !== null ? { purpose: row.purpose } : {}),
    ...(row.review_cadence !== null ? { reviewCadence: row.review_cadence } : {}),
  };
}

export class SqliteActorRegistry implements ActorRegistry {
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

  async register(actor: Actor): Promise<void> {
    const isNonHuman =
      actor.actorClass !== ACTOR_CLASS.HUMAN && actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;

    if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
      throw new Error(
        `Non-human actor ${actor.actorId} must have owner, purpose, and reviewCadence`
      );
    }

    this.db
      .prepare(
        `INSERT INTO actors
          (actor_id, actor_class, principal_id, display_name, environment, risk_ceiling,
           allowed_systems, registered_at, owner, purpose, review_cadence, oct_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        actor.reviewCadence ?? null,
        actor.octLevel ?? OCT_LEVEL.OPEN
      );
  }

  async list(): Promise<Actor[]> {
    const rows = this.db.prepare('SELECT * FROM actors').all() as ActorRow[];
    return rows.map(rowToActor);
  }

  async updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void> {
    this.db.prepare('UPDATE actors SET oct_level = ? WHERE actor_id = ?').run(octLevel, actorId);
  }
}
