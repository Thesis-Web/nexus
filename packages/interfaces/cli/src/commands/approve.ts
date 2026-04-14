import { decideApproval, ApprovalDecisionError, SqlitePendingApprovalStore } from '@nexus/core';
import type { Uuid, NonEmpty } from '@nexus/core';
import { openDb } from '../db.js';
export async function cmdApprove(approvalId: string, opts: { approverId: string }): Promise<void> {
  return handleDecision(approvalId as Uuid, opts.approverId as NonEmpty, 'approved', undefined);
}
export async function cmdDeny(
  approvalId: string,
  opts: { approverId: string; note?: string }
): Promise<void> {
  return handleDecision(approvalId as Uuid, opts.approverId as NonEmpty, 'denied', opts.note);
}
async function handleDecision(
  approvalId: Uuid,
  approverId: NonEmpty,
  decision: 'approved' | 'denied',
  note?: string
): Promise<void> {
  const db = openDb();
  const store = new SqlitePendingApprovalStore(db);
  try {
    const response = await decideApproval(approvalId, approverId, decision, note, store);
    console.log(`✓ Approval ${approvalId} ${decision} by ${approverId}`);
    console.log(
      JSON.stringify(
        { ok: true, decision: response.decision, decidedBy: response.decidedBy },
        null,
        2
      )
    );
  } catch (err) {
    if (err instanceof ApprovalDecisionError) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
