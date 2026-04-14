export class SqlitePendingApprovalStore {
    db;
    constructor(db) {
        this.db = db;
    }
    async create(approval) {
        this.db
            .prepare(`
      INSERT INTO pending_approvals
        (approval_id, action_id, template_id, request_json, channel_id, dispatched_at, expires_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `)
            .run(approval.approvalId, approval.actionId, approval.templateId, approval.requestJson, approval.channelId, approval.dispatchedAt, approval.expiresAt);
    }
    async getStatus(approvalId) {
        const row = this.db
            .prepare('SELECT status, response_json FROM pending_approvals WHERE approval_id = ?')
            .get(approvalId);
        return row ? { status: row.status, responseJson: row.response_json } : null;
    }
    async getRequest(approvalId) {
        const row = this.db
            .prepare('SELECT request_json FROM pending_approvals WHERE approval_id = ?')
            .get(approvalId);
        return row?.request_json ?? null;
    }
    async resolve(approvalId, status, responseJson) {
        this.db
            .prepare('UPDATE pending_approvals SET status = ?, response_json = ? WHERE approval_id = ?')
            .run(status, responseJson, approvalId);
    }
    async markTimedOut(approvalId) {
        this.db
            .prepare("UPDATE pending_approvals SET status = 'timed_out' WHERE approval_id = ?")
            .run(approvalId);
    }
    async listPending() {
        const rows = this.db
            .prepare("SELECT approval_id, channel_id, expires_at, request_json FROM pending_approvals WHERE status = 'pending'")
            .all();
        return rows.map(r => ({
            approvalId: r.approval_id,
            channelId: r.channel_id,
            expiresAt: r.expires_at,
            requestJson: r.request_json,
        }));
    }
}
