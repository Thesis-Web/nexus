// packages/workspace-ref/src/stores/workspace-run-acl-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §6.1 step 6
// Layer 7 — SQLite-backed run ACL store (reference implementation).
//
// RunAcl created at run_opened. Enforces per-run access control.
// Production: swap for Postgres via WorkspaceRunAclStorePort.

import type { RunAcl, WorkspaceRunAclStorePort, Uuid } from '@nexus/contracts';
import Database from 'better-sqlite3';

export class SqliteWorkspaceRunAclStore implements WorkspaceRunAclStorePort {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_acls (
        run_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        permitted_viewers TEXT NOT NULL
      )
    `);
  }

  store(acl: RunAcl): void {
    this.db
      .prepare(
        `INSERT INTO run_acls (run_id, principal_id, actor_id, permitted_viewers)
         VALUES (?, ?, ?, ?)`
      )
      .run(acl.runId, acl.principalId, acl.actorId, JSON.stringify(acl.permittedViewers));
  }

  get(runId: Uuid): RunAcl | null {
    const row = this.db.prepare('SELECT * FROM run_acls WHERE run_id = ?').get(runId) as
      | { run_id: string; principal_id: string; actor_id: string; permitted_viewers: string }
      | undefined;

    if (!row) return null;

    return {
      runId: row.run_id as Uuid,
      principalId: row.principal_id,
      actorId: row.actor_id as Uuid,
      permittedViewers: JSON.parse(row.permitted_viewers) as string[],
    };
  }

  isAuthorized(runId: Uuid, principalId: string): boolean {
    const acl = this.get(runId);
    if (!acl) return false;
    return acl.permittedViewers.includes(principalId);
  }
}
