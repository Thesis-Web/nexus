function rowToApprover(row) {
    return {
        approverId: row.actor_id,
        displayName: row.display_name,
        publicKey: row.approver_public_key,
        channels: JSON.parse(row.approver_channels),
        registeredAt: row.registered_at,
    };
}
export class SqliteApproverRegistry {
    db;
    constructor(db) {
        this.db = db;
    }
    async get(approverId) {
        const row = this.db
            .prepare('SELECT actor_id, display_name, approver_public_key, approver_channels, registered_at FROM actors WHERE actor_id = ? AND approver_public_key IS NOT NULL')
            .get(approverId);
        return row ? rowToApprover(row) : null;
    }
    async list() {
        const rows = this.db
            .prepare('SELECT actor_id, display_name, approver_public_key, approver_channels, registered_at FROM actors WHERE approver_public_key IS NOT NULL')
            .all();
        return rows.map(rowToApprover);
    }
    async register(approver) {
        const actor = this.db
            .prepare('SELECT actor_id, actor_class FROM actors WHERE actor_id = ?')
            .get(approver.approverId);
        if (!actor) {
            throw new Error(`Actor ${approver.approverId} not found — register actor first`);
        }
        if (actor.actor_class !== 'HUMAN' && actor.actor_class !== 'HUMAN_WITH_COPILOT') {
            throw new Error(`Approver ${approver.approverId} must be HUMAN or HUMAN_WITH_COPILOT`);
        }
        this.db
            .prepare('UPDATE actors SET approver_public_key = ?, approver_channels = ? WHERE actor_id = ?')
            .run(approver.publicKey, JSON.stringify(approver.channels), approver.approverId);
        const registered = {
            ...approver,
            registeredAt: new Date().toISOString(),
        };
        return registered;
    }
}
