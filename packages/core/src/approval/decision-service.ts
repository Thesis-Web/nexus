/**
 * Shared approval decision service — spec §20.6 (BS-102)
 * Single signing path for both CLI and management API. No duplication.
 */
import {
  APPROVAL_DECISION_LABEL,
  type Uuid,
  type NonEmpty,
  type ApprovalResponse,
  type ApprovalRequest,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';
import { loadApproverKey } from '../crypto/key-manager.js';
import type { PendingApprovalStore } from './pending-approval-store.js';

export class ApprovalDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalDecisionError';
  }
}

export async function decideApproval(
  approvalId: Uuid,
  approverId: NonEmpty,
  decision: 'approved' | 'denied',
  note: string | undefined,
  store: PendingApprovalStore
): Promise<ApprovalResponse> {
  // 1. Load pending record
  const row = await store.getStatus(approvalId);
  if (!row) throw new ApprovalDecisionError(`Approval ${approvalId} not found`);

  // 2. Reject if not pending
  if (row.status !== 'pending') {
    throw new ApprovalDecisionError(
      `Approval ${approvalId} status is '${row.status}', expected 'pending'`
    );
  }

  // 3. Load request via getRequest() — required method (BS-102)
  const requestJson = await store.getRequest(approvalId);
  if (!requestJson) throw new ApprovalDecisionError(`Approval ${approvalId} request not found`);
  const request = JSON.parse(requestJson) as ApprovalRequest;

  // 4. Reject if expired
  if (new Date(request.expiresAt) <= new Date()) {
    throw new ApprovalDecisionError(`Approval ${approvalId} has expired`);
  }

  // 5. Load approver key — only legal path (SOLVE-006)
  const approverKey = await loadApproverKey(approverId);

  // 6. Build response body
  const responseBody: Omit<ApprovalResponse, 'signature'> = {
    approvalId,
    decision:
      decision === 'approved' ? APPROVAL_DECISION_LABEL.APPROVED : APPROVAL_DECISION_LABEL.DENIED,
    decidedBy: approverId,
    decidedAt: new Date().toISOString(),
    channel: 'cli',
    note: note ?? null,
  };

  // 7. Sign with approver key
  const signature = await sign(canonicalize(responseBody), approverKey);
  const response: ApprovalResponse = { ...responseBody, signature };

  // 8. Persist
  await store.resolve(approvalId, decision, JSON.stringify(response));

  return response;
}
