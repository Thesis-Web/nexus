/**
 * Approver registry — spec §11.6, §20.3
 * Reads actors table filtering on approver_public_key IS NOT NULL.
 *
 * v1.7.25 ApproverRegistry interface requires:
 *   getPublicKey(approverId): Promise<Base64Url | null>
 *   register(actorId, publicKey, channels): Promise<void>
 *
 * Additional helper methods (get, list) are available but not
 * part of the interface contract.
 */
import type Database from 'better-sqlite3';
import type { ApproverRegistry, NonEmpty, Uuid, Base64Url } from '../types/index.js';

interface ApproverRow {
  actor_id: string;
  display_name: string;
  approver_public_key: string;
  approver_channels: string;
  registered_at: string;
}

export interface Approver {
  approverId: string;
  displayName: string;
  publicKey: string;
  channels: string[];
  registeredAt: string;
}

function rowToApprover(row: ApproverRow): Approver {
  return {
    approverId: row.actor_id,
    displayName: row.display_name,
    publicKey: row.approver_public_key,
    channels: JSON.parse(row.approver_channels) as string[],
    registeredAt: row.registered_at,
  };
}

export class SqliteApproverRegistry implements ApproverRegistry {
  constructor(private readonly db: Database.Database) {}

  /** Interface method: returns just the public key string or null */
  async getPublicKey(approverId: NonEmpty): Promise<Base64Url | null> {
    const row = this.db
      .prepare(
        'SELECT approver_public_key FROM actors WHERE actor_id = ? AND approver_public_key IS NOT NULL'
      )
      .get(approverId) as { approver_public_key: string } | undefined;
    return row ? row.approver_public_key : null;
  }

  /** Interface method: register an approver by updating their actor row */
  async register(actorId: Uuid, publicKey: Base64Url, channels: string[]): Promise<void> {
    this.db
      .prepare(
        'UPDATE actors SET approver_public_key = ?, approver_channels = ? WHERE actor_id = ?'
      )
      .run(publicKey, JSON.stringify(channels), actorId);
  }

  /** Helper: get full approver record (not part of interface contract) */
  async get(approverId: NonEmpty): Promise<Approver | null> {
    const row = this.db
      .prepare(
        'SELECT actor_id, display_name, approver_public_key, approver_channels, registered_at FROM actors WHERE actor_id = ? AND approver_public_key IS NOT NULL'
      )
      .get(approverId) as ApproverRow | undefined;
    return row ? rowToApprover(row) : null;
  }

  /** Helper: list all approvers (not part of interface contract) */
  async list(): Promise<Approver[]> {
    const rows = this.db
      .prepare(
        'SELECT actor_id, display_name, approver_public_key, approver_channels, registered_at FROM actors WHERE approver_public_key IS NOT NULL'
      )
      .all() as ApproverRow[];
    return rows.map(rowToApprover);
  }
}
