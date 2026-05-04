// packages/workspace-ref/src/bridge/workspace-approval-bridge.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.5 (approval bridge), §7.8 (approval auth)
// Blueprint §3.5.3 — WorkspaceApprovalBridge reference implementation.
// Layer 7 — replaceable via WorkspaceApprovalBridge port interface.
//
// Bridge law (§3.5.3):
//   1. Load ApprovalRequest from PendingApprovalStore.getRequest()
//   2. Verify approval.runId === input.runId (403 on mismatch)
//   3. Verify principal maps to registered approverId via loadApproverKey (403 if not)
//   4. Route to decideApproval — never signs, never writes Evidence
//
// §7.8: Registered approver key ALWAYS required. RunAcl alone never authorizes.
// Hard rule 32: Admin signers ≠ approver keys (different key domains).
// Blueprint §16.6: Timeout = DENY.

import type {
  WorkspaceApprovalBridge as WorkspaceApprovalBridgePort,
  ApprovalResponse,
  PendingApprovalStore,
  Uuid,
} from '@nexus/contracts';

/** Error codes for workspace approval bridge failures. */
export class ApprovalBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'RUN_MISMATCH' | 'NOT_APPROVER' | 'RESOLVED'
  ) {
    super(message);
    this.name = 'ApprovalBridgeError';
  }
}

/** Constructor dependencies for the reference bridge. */
export interface ApprovalBridgeDeps {
  /** PendingApprovalStore — loads approval requests, checks status */
  approvalStore: PendingApprovalStore;
  /** Core decideApproval — the single signing/resolution path [blueprint §3.5.3] */
  decideApproval: (
    approvalId: string,
    decidedBy: string,
    decision: 'approved' | 'denied',
    note: string | undefined,
    store: PendingApprovalStore
  ) => Promise<ApprovalResponse>;
  /**
   * Resolve principalId → approver key. Returns the approverId string if the
   * principal is a registered approver, or null if not. This is NOT the
   * AdminSignerRegistry — approver keys and admin signer keys are separate
   * domains (hard rule 32).
   */
  loadApproverKey: (principalId: string) => Promise<string | null>;
}

/**
 * Reference workspace approval bridge.
 *
 * Routes approval decisions from the workspace UI through the
 * ApprovalDecisionService. Never signs ApprovalResponse directly.
 * Never writes Evidence. The bridge verifies:
 *   (a) approval exists and is pending
 *   (b) approval.runId matches the route runId
 *   (c) principal is a registered approver
 * Then delegates to decideApproval for the actual decision.
 */
export class ReferenceWorkspaceApprovalBridge implements WorkspaceApprovalBridgePort {
  private readonly approvalStore: PendingApprovalStore;
  private readonly decideApproval: ApprovalBridgeDeps['decideApproval'];
  private readonly loadApproverKey: ApprovalBridgeDeps['loadApproverKey'];

  constructor(deps: ApprovalBridgeDeps) {
    this.approvalStore = deps.approvalStore;
    this.decideApproval = deps.decideApproval;
    this.loadApproverKey = deps.loadApproverKey;
  }

  async submitDecision(input: {
    approvalId: Uuid;
    runId: Uuid;
    principalId: string;
    decision: 'approved' | 'denied';
    note?: string;
    workspaceAuthSessionId: Uuid;
  }): Promise<ApprovalResponse> {
    // §7.5 step 1: load pending ApprovalRequest from PendingApprovalStore
    const requestJson = await this.approvalStore.getRequest(input.approvalId);
    if (!requestJson) {
      throw new ApprovalBridgeError(`Approval ${input.approvalId} not found`, 'NOT_FOUND');
    }

    // Check status — must be pending (not resolved/expired)
    const status = await this.approvalStore.getStatus(input.approvalId);
    if (status && status.status !== 'pending') {
      throw new ApprovalBridgeError(
        `Approval ${input.approvalId} already ${status.status}`,
        'RESOLVED'
      );
    }

    // §7.5 step 2: deserialize → extract runId → verify matches route :runId
    const request = JSON.parse(requestJson) as { runId?: string };
    if (request.runId !== input.runId) {
      throw new ApprovalBridgeError('Approval does not belong to this run', 'RUN_MISMATCH');
    }

    // §7.5 step 3 / §7.8: verify principal maps to registered approverId
    // Registered approver key is ALWAYS required — RunAcl alone never authorizes.
    const approverId = await this.loadApproverKey(input.principalId);
    if (!approverId) {
      throw new ApprovalBridgeError('Principal is not a registered approver', 'NOT_APPROVER');
    }

    // §7.5 step 4: route to decideApproval — the single signing/resolution path
    // Bridge never signs ApprovalResponse directly. Bridge never writes Evidence.
    const response = await this.decideApproval(
      input.approvalId,
      approverId,
      input.decision,
      input.note,
      this.approvalStore
    );

    return response;
  }
}
