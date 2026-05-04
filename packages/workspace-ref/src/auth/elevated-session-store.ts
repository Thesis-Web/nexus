// packages/workspace-ref/src/auth/elevated-session-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §5.8 (session vocabulary), §7.3 (transport)
// Layer 7 — SQLite-backed elevated session store (reference implementation).
// Internal to ReferenceElevatedAuthProvider — not a contract port.
//
// Hard rule 30: Elevated session validation is principal-bound.
// Hard rule 31: Elevated session via X-Elevated-Session header — not query string.
// Blueprint §3.9: configurable timeout, cannot be silently extended.

import type { Uuid, IsoTimestamp } from '@nexus/contracts';
import Database from 'better-sqlite3';

export interface ElevatedSessionRow {
  elevated_session_id: string;
  principal_id: string;
  method: string;
  issued_at: string;
  expires_at: string;
  timeout_seconds: number;
  closed: number;
  close_reason: string | null;
}

export class SqliteElevatedSessionStore {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS elevated_sessions (
        elevated_session_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        method TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        timeout_seconds INTEGER NOT NULL,
        closed INTEGER NOT NULL DEFAULT 0,
        close_reason TEXT
      )
    `);
  }

  store(session: {
    elevatedSessionId: Uuid;
    principalId: string;
    method: string;
    issuedAt: IsoTimestamp;
    expiresAt: IsoTimestamp;
    timeoutSeconds: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO elevated_sessions
         (elevated_session_id, principal_id, method, issued_at, expires_at, timeout_seconds, closed)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        session.elevatedSessionId,
        session.principalId,
        session.method,
        session.issuedAt,
        session.expiresAt,
        session.timeoutSeconds
      );
  }

  get(elevatedSessionId: Uuid): ElevatedSessionRow | null {
    const row = this.db
      .prepare('SELECT * FROM elevated_sessions WHERE elevated_session_id = ?')
      .get(elevatedSessionId) as ElevatedSessionRow | undefined;
    return row ?? null;
  }

  close(elevatedSessionId: Uuid, reason: string): void {
    this.db
      .prepare(
        'UPDATE elevated_sessions SET closed = 1, close_reason = ? WHERE elevated_session_id = ?'
      )
      .run(reason, elevatedSessionId);
  }
}
