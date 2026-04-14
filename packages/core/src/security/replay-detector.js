import { REPLAY_DEDUP_TTL_SECONDS, DENIAL_CODE } from '../types/index.js';
import { NexusSecurityViolation } from '../types/index.js';
export class ReplayDetector {
    db;
    constructor(db) {
        this.db = db;
    }
    check(actionId) {
        this.evict();
        const row = this.db
            .prepare('SELECT action_id FROM replay_cache WHERE action_id = ?')
            .get(actionId);
        if (row) {
            throw new NexusSecurityViolation(`replay detected: actionId ${actionId} already processed`, DENIAL_CODE.REPLAY_DETECTED);
        }
        this.db
            .prepare('INSERT INTO replay_cache (action_id, seen_at) VALUES (?, ?)')
            .run(actionId, new Date().toISOString());
    }
    evict() {
        const cutoff = new Date(Date.now() - REPLAY_DEDUP_TTL_SECONDS * 1000).toISOString();
        this.db.prepare('DELETE FROM replay_cache WHERE seen_at < ?').run(cutoff);
    }
}
