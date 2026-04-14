/**
 * Approver registry — spec §11.6, §20.3
 * Reads actors table filtering on approver_public_key IS NOT NULL.
 * Approvers must be registered actors of class HUMAN or HUMAN_WITH_COPILOT.
 */
import type Database from 'better-sqlite3';
import type { Approver, ApproverRegistry, NonEmpty } from '../types/index.js';

interface ApproverRow {
  actor_id: string; display_name: string;
  approver_public_key: string; approver_channels: string;
  registered_at: string;
}

function rowToApprover(row: ApproverRow): Approver {
  return {
    approverId:   row.actor_id,
    displayName:  row.display_name,
    publicKey:    row.approver_public_key,
    channels:     JSON.parse(row.approver_channels) as string[],
    registeredAt: row.registered_at,
  };
}

export class SqliteApproverRegistry implements ApproverRegistry {
  constructor(private readonly db: Database.Database) {}

  async get(approverId: NonEmpty): Promise<Approver | null> {
    const row = this.db
      .prepare('SELECT actor_id, display_name, approver_public_key, approver_channels, registered_at FROM actors WHERE actor_id = ? AND approver_public_key IS NOT NULL')
      .get(approverId) as ApproverRow | undefined;
    return row ? rowToApprover(row) : null;
  }

  async list(): Promise<Approver[]> {
    const rows = this.db
      .prepare('SELECT actor_id, display_name, approver_public_key, approver_channels, registered_at FROM actors WHERE approver_public_key IS NOT NULL')
      .all() as ApproverRow[];
    return rows.map(rowToApprover);
  }

  async register(approver: Omit<Approver, 'registeredAt'>): Promise<Approver> {
    const actor = this.db
      .prepare('SELECT actor_id, actor_class FROM actors WHERE actor_id = ?')
      .get(approver.approverId) as { actor_id: string; actor_class: string } | undefined;

    if (!actor) {
      throw new Error(`Actor ${approver.approverId} not found — register actor first`);
    }
    if (actor.actor_class !== 'HUMAN' && actor.actor_class !== 'HUMAN_WITH_COPILOT') {
      throw new Error(`Approver ${approver.approverId} must be HUMAN or HUMAN_WITH_COPILOT`);
    }

    this.db
      .prepare('UPDATE actors SET approver_public_key = ?, approver_channels = ? WHERE actor_id = ?')
      .run(approver.publicKey, JSON.stringify(approver.channels), approver.approverId);

    const registered: Approver = {
      ...approver,
      registeredAt: new Date().toISOString(),
    };
    return registered;
  }
}
