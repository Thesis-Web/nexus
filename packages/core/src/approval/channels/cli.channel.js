import { sleep } from '../../utils/time.js';
function printApprovalPrompt(req) {
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
export class CliApprovalChannel {
    store;
    pollMs;
    channelId = 'cli';
    channelVersion = 'v0.1.0';
    constructor(store, pollMs = 2000) {
        this.store = store;
        this.pollMs = pollMs;
    }
    async dispatch(request) {
        await this.store.create({
            approvalId: request.approvalId,
            actionId: request.actionId,
            templateId: request.templateId,
            requestJson: JSON.stringify(request),
            channelId: this.channelId,
            dispatchedAt: new Date().toISOString(),
            expiresAt: request.expiresAt,
        });
        printApprovalPrompt(request);
    }
    async awaitDecision(approvalId, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const row = await this.store.getStatus(approvalId);
            if (row && row.status !== 'pending') {
                if (!row.responseJson)
                    return null;
                return JSON.parse(row.responseJson);
            }
            await sleep(this.pollMs);
        }
        await this.store.markTimedOut(approvalId);
        return null;
    }
}
