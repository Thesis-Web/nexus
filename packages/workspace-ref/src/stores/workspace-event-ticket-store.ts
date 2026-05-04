// packages/workspace-ref/src/stores/workspace-event-ticket-store.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.7
// Layer 7 — SQLite-backed event ticket store (reference implementation).
//
// Single-use, 60s TTL event tickets for WS/SSE stream authentication.
// Ticket IDs redacted from access logs (hard rule 22).
// Production: swap for Redis via WorkspaceEventTicketStorePort.

import type {
  WorkspaceEventTicket,
  WorkspaceEventTicketStorePort,
  Uuid,
  IsoTimestamp,
} from '@nexus/contracts';
import Database from 'better-sqlite3';

export class SqliteWorkspaceEventTicketStore implements WorkspaceEventTicketStorePort {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_tickets (
        ticket_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  store(ticket: WorkspaceEventTicket): void {
    this.db
      .prepare(
        `INSERT INTO event_tickets (ticket_id, run_id, principal_id, issued_at, expires_at, consumed)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        ticket.ticketId,
        ticket.runId,
        ticket.principalId,
        ticket.issuedAt,
        ticket.expiresAt,
        ticket.consumed ? 1 : 0
      );
  }

  consume(ticketId: Uuid, runId: Uuid): WorkspaceEventTicket | null {
    const row = this.db
      .prepare('SELECT * FROM event_tickets WHERE ticket_id = ? AND run_id = ?')
      .get(ticketId, runId) as
      | {
          ticket_id: string;
          run_id: string;
          principal_id: string;
          issued_at: string;
          expires_at: string;
          consumed: number;
        }
      | undefined;

    // Missing ticket → null
    if (!row) return null;
    // Already consumed → null (single-use)
    if (row.consumed) return null;
    // Expired → null (60s TTL)
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;

    // Mark consumed atomically (single-use enforcement)
    this.db.prepare('UPDATE event_tickets SET consumed = 1 WHERE ticket_id = ?').run(ticketId);

    return {
      ticketId: row.ticket_id as Uuid,
      runId: row.run_id as Uuid,
      principalId: row.principal_id,
      issuedAt: row.issued_at as IsoTimestamp,
      expiresAt: row.expires_at as IsoTimestamp,
      consumed: true,
    };
  }
}
