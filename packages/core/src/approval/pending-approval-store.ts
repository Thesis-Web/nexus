/**
 * Pending approval store — spec §20.6
 * getRequest() is required by the shared decideApproval service (BS-102).
 */
import type Database from 'better-sqlite3';
import type { Uuid, IsoTimestamp } from '../types/index.js';

export interface PendingApprovalStore {
  create(approval: {
    approvalId: Uuid;
    actionId: Uuid;
    templateId: Uuid;
    requestJson: string;
    channelId: string;
    dispatchedAt: IsoTimestamp;
    expiresAt: IsoTimestamp;
  }): Promise<void>;
  getStatus(approvalId: Uuid): Promise<{ status: string; responseJson: string | null } | null>;
  getRequest(approvalId: Uuid): Promise<string | null>;
  resolve(approvalId: Uuid, status: 'approved' | 'denied', responseJson: string): Promise<void>;
  markTimedOut(approvalId: Uuid): Promise<void>;
  listPending(): Promise<
    Array<{ approvalId: string; channelId: string; expiresAt: string; requestJson: string }>
  >;
}

export class SqlitePendingApprovalStore implements PendingApprovalStore {
  constructor(private readonly db: Database.Database) {}

  async create(approval: {
    approvalId: Uuid;
    actionId: Uuid;
    templateId: Uuid;
    requestJson: string;
    channelId: string;
    dispatchedAt: IsoTimestamp;
    expiresAt: IsoTimestamp;
  }): Promise<void> {
    this.db
      .prepare(
        `
      INSERT INTO pending_approvals
        (approval_id, action_id, template_id, request_json, channel_id, dispatched_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `
      )
      .run(
        approval.approvalId,
        approval.actionId,
        approval.templateId,
        approval.requestJson,
        approval.channelId,
        approval.dispatchedAt,
        approval.expiresAt
      );
  }

  async getStatus(
    approvalId: Uuid
  ): Promise<{ status: string; responseJson: string | null } | null> {
    const row = this.db
      .prepare('SELECT status, response_json FROM pending_approvals WHERE approval_id = ?')
      .get(approvalId) as { status: string; response_json: string | null } | undefined;
    return row ? { status: row.status, responseJson: row.response_json } : null;
  }

  async getRequest(approvalId: Uuid): Promise<string | null> {
    const row = this.db
      .prepare('SELECT request_json FROM pending_approvals WHERE approval_id = ?')
      .get(approvalId) as { request_json: string } | undefined;
    return row?.request_json ?? null;
  }

  async resolve(
    approvalId: Uuid,
    status: 'approved' | 'denied',
    responseJson: string
  ): Promise<void> {
    this.db
      .prepare('UPDATE pending_approvals SET status = ?, response_json = ? WHERE approval_id = ?')
      .run(status, responseJson, approvalId);
  }

  async markTimedOut(approvalId: Uuid): Promise<void> {
    this.db
      .prepare("UPDATE pending_approvals SET status = 'timed_out' WHERE approval_id = ?")
      .run(approvalId);
  }

  async listPending(): Promise<
    Array<{ approvalId: string; channelId: string; expiresAt: string; requestJson: string }>
  > {
    const rows = this.db
      .prepare(
        "SELECT approval_id, channel_id, expires_at, request_json FROM pending_approvals WHERE status = 'pending'"
      )
      .all() as Array<{
      approval_id: string;
      channel_id: string;
      expires_at: string;
      request_json: string;
    }>;
    return rows.map(r => ({
      approvalId: r.approval_id,
      channelId: r.channel_id,
      expiresAt: r.expires_at,
      requestJson: r.request_json,
    }));
  }
}
