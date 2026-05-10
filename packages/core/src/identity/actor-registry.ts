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
  type NonEmpty,
} from '../types/index.js';

interface ActorRow {
  actor_id: string;
  actor_class: string;
  principal_id: string;
  display_name: string;
  environment: string;
  risk_ceiling: string;
  allowed_systems: string;
  allowed_capabilities: string;
  enabled: number;
  registered_at: string;
  owner: string | null;
  purpose: string | null;
  review_cadence: string | null;
  oct_level: string | null;
  // HOLE-A02 closure: governed roles persisted as a JSON-encoded string of
  // NonEmpty[]. Defaulted to '[]' for both fresh installs and upgraded rows.
  roles: string;
}

function rowToActor(row: ActorRow): Actor {
  // HOLE-A02 closure: roles is the governed source of truth for admin gating.
  // Empty array is a valid value (most actors have no roles) and yields
  // hasAdminRole() === false. The defensive parse handles the edge case
  // where an out-of-band write left a NULL or non-JSON value.
  let roles: NonEmpty[] = [];
  if (typeof row.roles === 'string' && row.roles.length > 0) {
    try {
      const parsed = JSON.parse(row.roles) as unknown;
      if (Array.isArray(parsed)) {
        roles = parsed.filter(
          (r): r is NonEmpty => typeof r === 'string' && r.length > 0
        ) as NonEmpty[];
      }
    } catch {
      // Treat malformed roles JSON as empty — gates fail closed.
      roles = [];
    }
  }
  return {
    actorId: row.actor_id,
    actorClass: row.actor_class,
    principalId: row.principal_id,
    displayName: row.display_name,
    environment: row.environment,
    riskCeiling: row.risk_ceiling,
    allowedSystems: JSON.parse(row.allowed_systems) as string[],
    allowedCapabilities: JSON.parse(row.allowed_capabilities) as string[],
    enabled: row.enabled === 1,
    registeredAt: row.registered_at,
    // OCT-001 FIX: null octLevel permitted — actors start without OCT.
    // Gate 02 enforces fail-closed: null/unknown OCT = deny.
    // oct_assignment signed operator action assigns OCT post-registration.
    octLevel: row.oct_level ? (row.oct_level as OctLevel) : null,
    ...(roles.length > 0 ? { roles } : {}),
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

    // OCT-001: octLevel is mandatory at registration — operator must assign via signed action.
    // Null octLevel in DB is permitted (for oct_assignment flow), but register() rejects null.
    if (!actor.octLevel) {
      throw new Error(
        `OCT_REQUIRED: actor ${actor.actorId} must have explicit octLevel at registration per §11.3`
      );
    }

    this.db
      .prepare(
        `INSERT INTO actors
          (actor_id, actor_class, principal_id, display_name, environment, risk_ceiling,
           allowed_systems, allowed_capabilities, enabled,
           registered_at, owner, purpose, review_cadence, oct_level, roles)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        actor.actorId,
        actor.actorClass,
        actor.principalId,
        actor.displayName,
        actor.environment,
        actor.riskCeiling,
        JSON.stringify(actor.allowedSystems),
        JSON.stringify(actor.allowedCapabilities ?? []),
        (actor.enabled ?? true) ? 1 : 0,
        actor.registeredAt,
        actor.owner ?? null,
        actor.purpose ?? null,
        actor.reviewCadence ?? null,
        actor.octLevel,
        JSON.stringify(actor.roles ?? [])
      );
  }

  async list(): Promise<Actor[]> {
    const rows = this.db.prepare('SELECT * FROM actors').all() as ActorRow[];
    return rows.map(rowToActor);
  }

  async updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void> {
    this.db.prepare('UPDATE actors SET oct_level = ? WHERE actor_id = ?').run(octLevel, actorId);
  }

  async update(actorId: Uuid, actor: Actor): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE actors SET
          actor_class = ?, principal_id = ?, display_name = ?, environment = ?,
          risk_ceiling = ?, allowed_systems = ?, allowed_capabilities = ?,
          enabled = ?, owner = ?, purpose = ?, review_cadence = ?, oct_level = ?,
          roles = ?
        WHERE actor_id = ?`
      )
      .run(
        actor.actorClass,
        actor.principalId,
        actor.displayName,
        actor.environment,
        actor.riskCeiling,
        JSON.stringify(actor.allowedSystems),
        JSON.stringify(actor.allowedCapabilities ?? []),
        (actor.enabled ?? true) ? 1 : 0,
        actor.owner ?? null,
        actor.purpose ?? null,
        actor.reviewCadence ?? null,
        actor.octLevel,
        JSON.stringify(actor.roles ?? []),
        actorId
      );
    if (result.changes === 0) {
      throw new Error(`Actor ${actorId} not found`);
    }
  }

  async delete(actorId: Uuid): Promise<void> {
    const result = this.db.prepare('DELETE FROM actors WHERE actor_id = ?').run(actorId);
    if (result.changes === 0) {
      throw new Error(`Actor ${actorId} not found`);
    }
  }
}
