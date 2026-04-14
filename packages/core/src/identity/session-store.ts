/**
 * Session store — spec §20.4
 *
 * CRITICAL LAW (SOLVE-011): get() returns the Session record regardless of whether
 * expires_at has passed. Gate 01 is the sole owner of the session expiry decision.
 * Filtering by expiry in get() makes SESSION_EXPIRED unreachable in Gate 01.
 */
import type Database from 'better-sqlite3';
import type { Session, Uuid, SessionStore } from '../types/index.js';

interface SessionRow {
  session_id: string; actor_id: string; principal_id: string;
  delegation_id: string; created_at: string; expires_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    sessionId:    row.session_id,
    actorId:      row.actor_id,
    principalId:  row.principal_id,
    delegationId: row.delegation_id,
    createdAt:    row.created_at,
    expiresAt:    row.expires_at,
  };
}

export class SqliteSessionStore implements SessionStore {
  constructor(private readonly db: Database.Database) {}

  async get(sessionId: Uuid): Promise<Session | null> {
    // Returns regardless of expiry — Gate 01 owns expiry semantics.
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  async create(session: Session): Promise<Session> {
    this.db
      .prepare(`
        INSERT INTO sessions (session_id, actor_id, principal_id, delegation_id, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(
        session.sessionId, session.actorId, session.principalId,
        session.delegationId, session.createdAt, session.expiresAt
      );
    return session;
  }

  async list(): Promise<Session[]> {
    const rows = this.db.prepare('SELECT * FROM sessions').all() as SessionRow[];
    return rows.map(rowToSession);
  }

  /** Invalidate sets expires_at = now. Does not delete — forensic audit integrity. */
  invalidate(sessionId: Uuid): void {
    this.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE session_id = ?')
      .run(new Date().toISOString(), sessionId);
  }
}
