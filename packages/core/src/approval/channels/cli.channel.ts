/**
 * CLI Approval Channel (Channel v1) — spec §20.6
 * Dispatches to pending_approvals store. Polls for decision. channelId = 'cli'.
 */
import type { ApprovalChannel, ApprovalRequest, ApprovalResponse, Uuid } from '../../types/index.js';
import type { PendingApprovalStore } from '../pending-approval-store.js';
import { sleep } from '../../utils/time.js';

function printApprovalPrompt(req: ApprovalRequest): void {
  const expiresIn = Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000);
  const m = Math.floor(expiresIn / 60);
  const s = expiresIn % 60;
  // eslint-disable-next-line no-console
  console.log(`
⚡ Approval required: ${req.actorDisplayName} → ${req.actionSummary}

  Impact:    ${req.estimatedImpact}
  Intent:    "${req.actionSummary}"
  Diff:      ${req.diff ?? '[preview not available]'}
  Principal: ${req.principalDisplayName}
  Risk:      ${req.riskTier.toUpperCase()}
  Expires:   in ${m}m ${s}s
  ID:        ${req.approvalId}

  Run: pnpm nexus approve ${req.approvalId} --approver-id <id>
       pnpm nexus deny   ${req.approvalId} --approver-id <id>
`);
}

export class CliApprovalChannel implements ApprovalChannel {
  readonly channelId      = 'cli';
  readonly channelVersion = 'v0.1.0';

  constructor(
    private readonly store:  PendingApprovalStore,
    private readonly pollMs: number = 2000
  ) {}

  async dispatch(request: ApprovalRequest): Promise<void> {
    await this.store.create({
      approvalId:   request.approvalId,
      actionId:     request.actionId,
      templateId:   request.templateId,
      requestJson:  JSON.stringify(request),
      channelId:    this.channelId,
      dispatchedAt: new Date().toISOString(),
      expiresAt:    request.expiresAt,
    });
    printApprovalPrompt(request);
  }

  async awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await this.store.getStatus(approvalId);
      if (row && row.status !== 'pending') {
        if (!row.responseJson) return null;
        return JSON.parse(row.responseJson) as ApprovalResponse;
      }
      await sleep(this.pollMs);
    }
    await this.store.markTimedOut(approvalId);
    return null;
  }
}
