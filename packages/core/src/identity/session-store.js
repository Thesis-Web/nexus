function rowToSession(row) {
    return {
        sessionId: row.session_id,
        actorId: row.actor_id,
        principalId: row.principal_id,
        delegationId: row.delegation_id,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
    };
}
export class SqliteSessionStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async get(sessionId) {
        // Returns regardless of expiry — Gate 01 owns expiry semantics.
        const row = this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
        return row ? rowToSession(row) : null;
    }
    async create(session) {
        this.db
            .prepare(`
        INSERT INTO sessions (session_id, actor_id, principal_id, delegation_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
            .run(session.sessionId, session.actorId, session.principalId, session.delegationId, session.createdAt, session.expiresAt);
        return session;
    }
    async list() {
        const rows = this.db.prepare('SELECT * FROM sessions').all();
        return rows.map(rowToSession);
    }
    /** Invalidate sets expires_at = now. Does not delete — forensic audit integrity. */
    invalidate(sessionId) {
        this.db
            .prepare('UPDATE sessions SET expires_at = ? WHERE session_id = ?')
            .run(new Date().toISOString(), sessionId);
    }
}
