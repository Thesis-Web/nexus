import { ACTOR_CLASS, } from '../types/index.js';
function rowToActor(row) {
    return {
        actorId: row.actor_id,
        actorClass: row.actor_class,
        principalId: row.principal_id,
        displayName: row.display_name,
        environment: row.environment,
        riskCeiling: row.risk_ceiling,
        allowedSystems: JSON.parse(row.allowed_systems),
        registeredAt: row.registered_at,
        ...(row.owner !== null ? { owner: row.owner } : {}),
        ...(row.purpose !== null ? { purpose: row.purpose } : {}),
        ...(row.review_cadence !== null ? { reviewCadence: row.review_cadence } : {}),
    };
}
export class ActorRegistry {
    db;
    constructor(db) {
        this.db = db;
    }
    async get(actorId) {
        const row = this.db.prepare('SELECT * FROM actors WHERE actor_id = ?').get(actorId);
        return row ? rowToActor(row) : null;
    }
    async getByClass(actorClass) {
        const rows = this.db
            .prepare('SELECT * FROM actors WHERE actor_class = ?')
            .all(actorClass);
        return rows.map(rowToActor);
    }
    async register(actor) {
        const isNonHuman = actor.actorClass !== ACTOR_CLASS.HUMAN && actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;
        if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
            throw new Error(`Non-human actor ${actor.actorId} must have owner, purpose, and reviewCadence`);
        }
        this.db
            .prepare(`
        INSERT INTO actors
          (actor_id, actor_class, principal_id, display_name, environment, risk_ceiling,
           allowed_systems, registered_at, owner, purpose, review_cadence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
            .run(actor.actorId, actor.actorClass, actor.principalId, actor.displayName, actor.environment, actor.riskCeiling, JSON.stringify(actor.allowedSystems), actor.registeredAt, actor.owner ?? null, actor.purpose ?? null, actor.reviewCadence ?? null);
        return actor;
    }
    async list() {
        const rows = this.db.prepare('SELECT * FROM actors').all();
        return rows.map(rowToActor);
    }
}
