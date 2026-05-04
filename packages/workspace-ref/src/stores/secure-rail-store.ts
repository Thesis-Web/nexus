// packages/workspace-ref/src/stores/secure-rail-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.4 (signature law), §10 gate 10
// Layer 7 — SQLite-backed secure rail store (reference implementation).
//
// Immutable versions. Disabled-not-deleted (hard rule 25).
// Collision → 409 enforced at route layer via exists() check.
// Production: swap for Postgres via SecureRailStorePort.

import type { SecureRail, SecureRailStorePort } from '@nexus/contracts';
import Database from 'better-sqlite3';

export class SqliteSecureRailStore implements SecureRailStorePort {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secure_rails (
        rail_id TEXT NOT NULL,
        version TEXT NOT NULL,
        data_json TEXT NOT NULL,
        disabled INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (rail_id, version)
      )
    `);
  }

  async list(): Promise<SecureRail[]> {
    const rows = this.db
      .prepare('SELECT data_json FROM secure_rails WHERE disabled = 0')
      .all() as Array<{ data_json: string }>;
    return rows.map(r => JSON.parse(r.data_json) as SecureRail);
  }

  async get(id: string, version: string): Promise<SecureRail | null> {
    const row = this.db
      .prepare('SELECT data_json FROM secure_rails WHERE rail_id = ? AND version = ?')
      .get(id, version) as { data_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data_json) as SecureRail;
  }

  async save(r: SecureRail): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO secure_rails (rail_id, version, data_json, disabled)
         VALUES (?, ?, ?, 0)`
      )
      .run(r.railId, r.version, JSON.stringify(r));
  }

  async disable(id: string, version: string): Promise<void> {
    this.db
      .prepare('UPDATE secure_rails SET disabled = 1 WHERE rail_id = ? AND version = ?')
      .run(id, version);
  }

  async exists(id: string, version: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM secure_rails WHERE rail_id = ? AND version = ?')
      .get(id, version);
    return row !== undefined;
  }
}
