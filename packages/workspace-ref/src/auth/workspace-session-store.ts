// packages/workspace-ref/src/auth/workspace-session-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §5.2, §5.3
// Layer 7 — SQLite-backed workspace session store (reference implementation).
//
// Uses better-sqlite3 consistent with all other stores in the repo.
// Production: swap for Postgres/Redis via WorkspaceSessionStorePort.

import type { WorkspaceSession, WorkspaceSessionStorePort, Uuid } from '@nexus/contracts';
import Database from 'better-sqlite3';

export class SqliteWorkspaceSessionStore implements WorkspaceSessionStorePort {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_sessions (
        sid TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
  }

  create(session: WorkspaceSession): void {
    this.db
      .prepare(
        `INSERT INTO workspace_sessions (sid, principal_id, actor_id, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        session.workspaceAuthSessionId,
        session.principalId,
        session.actorId,
        session.issuedAt,
        session.expiresAt
      );
  }

  get(sid: Uuid): WorkspaceSession | null {
    const row = this.db.prepare('SELECT * FROM workspace_sessions WHERE sid = ?').get(sid) as
      | {
          sid: string;
          principal_id: string;
          actor_id: string;
          issued_at: string;
          expires_at: string;
        }
      | undefined;

    if (!row) return null;

    // Auto-expire check
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.db.prepare('DELETE FROM workspace_sessions WHERE sid = ?').run(sid);
      return null;
    }

    return {
      workspaceAuthSessionId: row.sid as Uuid,
      principalId: row.principal_id,
      actorId: row.actor_id as Uuid,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    };
  }

  revoke(sid: Uuid): void {
    this.db.prepare('DELETE FROM workspace_sessions WHERE sid = ?').run(sid);
  }
}
