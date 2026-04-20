/**
 * Replay detector — spec §17
 * SQLite-backed. TTL window enforced per REPLAY_DEDUP_TTL_SECONDS.
 * SEQUENCE_ANOMALY is emitted by chain-verifier only — not here.
 */
import type Database from 'better-sqlite3';
import { REPLAY_DEDUP_TTL_SECONDS, DENIAL_CODE, type Uuid } from '../types/index.js';
import { NexusSecurityViolation } from '../types/index.js';

export class ReplayDetector {
  constructor(private readonly db: Database.Database) {}

  check(actionId: Uuid): void {
    this.evict();
    const row = this.db
      .prepare('SELECT action_id FROM replay_cache WHERE action_id = ?')
      .get(actionId);
    if (row) {
      throw new NexusSecurityViolation(
        DENIAL_CODE.REPLAY_DETECTED,
        `replay detected: actionId ${actionId} already processed`
      );
    }
    this.db
      .prepare('INSERT INTO replay_cache (action_id, seen_at) VALUES (?, ?)')
      .run(actionId, new Date().toISOString());
  }

  private evict(): void {
    const cutoff = new Date(Date.now() - REPLAY_DEDUP_TTL_SECONDS * 1000).toISOString();
    this.db.prepare('DELETE FROM replay_cache WHERE seen_at < ?').run(cutoff);
  }
}
