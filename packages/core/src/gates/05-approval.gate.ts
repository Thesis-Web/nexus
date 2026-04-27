/**
 * Gate 05 — Approval — spec §13.6
 * SOLVE-016: channelId is a string, not an array. Uses channelId directly.
 * Invoked at most once per action. Never invoked on ALLOW paths (orchestrator invariant).
 * Template consumed from context.grantTemplate! — CONTRA-001 closed.
 */
import {
  GATE_ID,
  DENIAL_CODE,
  APPROVAL_DECISION_LABEL,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type ApprovalResponse,
  type ApprovalRequest,
} from '../types/index.js';
import { buildSignedApprovalRequest } from '../approval/packager.js';
import { verify } from '../crypto/verifier.js';
import { canonicalize } from '../crypto/canonicalize.js';
import type { KeyPair } from '../crypto/key-manager.js';

function deny(
  code: string,
  reason: string,
  startMs: number,
  req?: ApprovalRequest,
  resp?: ApprovalResponse
): GateResult {
  return {
    decision: {
      gateId: GATE_ID.G05,
      gateOrder: 5,
      plane: 'control',
      outcome: 'deny',
      reason,
      denialCode: code,
      policyRuleId: null,
      evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
    ...(req ? { approvalRequest: req } : {}),
    ...(resp ? { approvalResponse: resp } : {}),
  };
}

export class ApprovalGate implements Gate {
  readonly gateId = GATE_ID.G05;
  readonly gateOrder = 5;
  readonly plane = 'control' as const;

  constructor(private readonly controlPlaneKey: KeyPair) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();
    const template = context.grantTemplate!; // orchestrator invariant
    const approvalConfig = template.approvalConfig;

    if (!approvalConfig) {
      return deny(
        DENIAL_CODE.APPROVAL_CONFIG_MISSING,
        'approval required but template carries no config',
        startMs
      );
    }

    // Attempt diff from connector — non-fatal
    let diff: string | null = null;
    const connector = context.connectorRegistry.get(action.resolvedTarget!.system);
    if (connector?.canProduceDiff?.()) {
      try {
        const raw = await connector.produceDiff!(action, template);
        diff = raw && raw.length > 2000 ? raw.slice(0, 2000) + '...[TRUNCATED]' : (raw ?? null);
      } catch {
        diff = null;
      }
    }

    const signedRequest = await buildSignedApprovalRequest(
      action,
      template,
      context,
      diff,
      this.controlPlaneKey
    );

    // SOLVE-016: channelId is a string — used directly, NOT as channels[0]
    const channelId = approvalConfig.channelId;
    const channel = context.channelRegistry.get(channelId);
    if (!channel) {
      return deny(
        DENIAL_CODE.APPROVAL_CHANNEL_NOT_FOUND,
        `channel ${channelId} not registered`,
        startMs
      );
    }

    await channel.dispatch(signedRequest);

    const timeoutMs = approvalConfig.timeoutSeconds * 1000;
    const response = await channel.awaitDecision(signedRequest.approvalId, timeoutMs);

    if (!response) {
      const timeoutResp: ApprovalResponse = {
        approvalId: signedRequest.approvalId,
        decision: APPROVAL_DECISION_LABEL.TIMED_OUT,
        decidedBy: 'system:timeout',
        decidedAt: new Date().toISOString(),
        channel: channelId,
        note: null,
        signature: '<none>',
      };
      return deny(
        DENIAL_CODE.APPROVAL_TIMEOUT,
        'approval timed out',
        startMs,
        signedRequest,
        timeoutResp
      );
    }

    // DEF-S29-002 fix: single verify using canonicalize() — mirrors signing path
    // decision-service.ts signs: sign(canonicalize(responseBody), approverKey)
    // Gate 05 verifies: verify(canonicalize(responseBody), signature, approverPubKey)
    // Timeout responses (decidedBy: 'system:timeout') skip verification per §19.7.
    if (response.decidedBy !== 'system:timeout') {
      const approverPubKey = await context.approverRegistry.getPublicKey(response.decidedBy);
      if (approverPubKey) {
        const { signature, ...responseBody } = response;
        const valid = await verify(canonicalize(responseBody), signature, approverPubKey);
        if (!valid) {
          return deny(
            DENIAL_CODE.APPROVAL_SIG_INVALID,
            'approval response signature invalid',
            startMs,
            signedRequest,
            response
          );
        }
      } else {
        // GATE05-001 FIX: fail-closed — unknown/unregistered approver always produces DENY.
        // Blueprint §19.7: "An unsigned response, a response signed by an unregistered
        // approver, or a response with an invalid signature always produces DENY
        // with APPROVAL_SIG_INVALID."
        return deny(
          DENIAL_CODE.APPROVAL_SIG_INVALID,
          `approver '${response.decidedBy}' not registered — signature unverifiable`,
          startMs,
          signedRequest,
          response
        );
      }
    }

    if (response.decision === APPROVAL_DECISION_LABEL.DENIED) {
      return deny(
        DENIAL_CODE.APPROVAL_DENIED_BY_HUMAN,
        'approval denied by human',
        startMs,
        signedRequest,
        response
      );
    }

    template.approvalLinkage = signedRequest.approvalId;

    return {
      decision: {
        gateId: GATE_ID.G05,
        gateOrder: 5,
        plane: 'control',
        outcome: 'pass',
        reason: `approval granted by ${response.decidedBy}`,
        denialCode: null,
        policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        metadata: {},
      },
      approvalRequest: signedRequest,
      approvalResponse: response,
    };
  }
}
