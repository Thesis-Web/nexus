/**
 * Gate 06 — Execution — spec §13.7
 * MODULAR-005: Calls connector interface only.
 * SOLVE-013: NexusSecurityViolation caught separately — maps to denied_threat + ThreatEvent.
 * clearGrantSecret() always called in finally — even on NexusSecurityViolation.
 */
import {
  GATE_ID,
  DENIAL_CODE,
  NexusSecurityViolation,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type ExecutionResult,
  type ThreatEvent,
} from '../types/index.js';
import { assertTemplateIntegrity } from '../policy/grant-template-builder.js';
import { mintGrant } from '../execution/grant-minter.js';
import { clearGrantSecret, grantVault } from '../execution/grant-vault.js';
import type { KeyPair } from '../crypto/key-manager.js';

function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return 'connector_unknown_error';
  return (
    err.message
      .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED:SECRET]')
      .slice(0, 500) || 'connector_error_no_message'
  );
}

export class ExecutionGate implements Gate {
  readonly gateId = GATE_ID.G06;
  readonly gateOrder = 6;
  readonly plane = 'data' as const;

  constructor(private readonly controlPlaneKey: KeyPair) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();
    const template = context.grantTemplate!; // orchestrator invariant

    // === CONTROL PLANE: verify template integrity and mint grant ===
    assertTemplateIntegrity(template);
    const grant = await mintGrant(
      action,
      template,
      context.approvalRequest ?? null,
      this.controlPlaneKey
    );

    // === DATA PLANE: connector forwarding ===
    // GATE06-001/002/003 + GRANT-SECRET-001 FIX:
    // All paths after mintGrant wrapped in try/finally to ensure clearGrantSecret.
    // All return paths include `grant` so Gate 07 can populate grant metadata (§34.4).
    // redeemGrant moved INSIDE try/finally so failures also clear the secret.
    try {
      const connector = context.connectorRegistry.get(action.resolvedTarget!.system);
      if (!connector) {
        return {
          decision: {
            gateId: GATE_ID.G06,
            gateOrder: 6,
            plane: 'data',
            outcome: 'error',
            reason: `connector not registered: ${action.resolvedTarget!.system}`,
            denialCode: DENIAL_CODE.CONNECTOR_NOT_REGISTERED,
            policyRuleId: null,
            evaluatedAt: new Date().toISOString(),
            durationMs: Date.now() - startMs,
            metadata: {},
          },
          grant, // GATE06-003 FIX: grant was minted — evidence must reflect this
        };
      }
      if (!connector.supportedCapabilities().includes(action.resolvedCapability!)) {
        return {
          decision: {
            gateId: GATE_ID.G06,
            gateOrder: 6,
            plane: 'data',
            outcome: 'error',
            reason: `connector does not support: ${action.resolvedCapability!}`,
            denialCode: DENIAL_CODE.CONNECTOR_CAP_UNSUPPORTED,
            policyRuleId: null,
            evaluatedAt: new Date().toISOString(),
            durationMs: Date.now() - startMs,
            metadata: {},
          },
          grant, // GATE06-003 FIX: grant was minted — evidence must reflect this
        };
      }

      // GRANT-SECRET-001 FIX: redeemGrant now INSIDE try/finally
      await connector.redeemGrant(grant, grantVault);

      let executionResult: ExecutionResult;
      try {
        executionResult = await connector.execute(action, grant, grantVault);
      } catch (err) {
        // NexusSecurityViolation: governed security breach — SEPARATE catch path (SOLVE-013)
        if (err instanceof NexusSecurityViolation) {
          const threatEvent: ThreatEvent = {
            threatType: 'security_violation',
            detectedAt: new Date().toISOString(),
            gateId: GATE_ID.G06,
            detail: `Security violation in connector execution: ${err.message}`.slice(0, 300),
          };
          context.threatLog.push(threatEvent);
          return {
            decision: {
              gateId: GATE_ID.G06,
              gateOrder: 6,
              plane: 'data',
              outcome: 'deny',
              reason: err.message,
              denialCode: err.denialCode,
              policyRuleId: null,
              evaluatedAt: new Date().toISOString(),
              durationMs: Date.now() - startMs,
              metadata: {
                violationType:
                  (err as NexusSecurityViolation & { violationType?: string }).violationType ?? '',
              },
            },
            grant, // grant was minted — denied_threat path still has grant metadata
          };
        }
        // Generic connector error — map to error outcome, no ThreatEvent
        executionResult = {
          grantId: grant.grantId,
          executedAt: new Date().toISOString(),
          status: 'failure',
          responseCode: null,
          durationMs: 0,
          redactedSummary: null,
          errorType: 'connector_execution_error',
          errorMessage: sanitizeError(err),
        };
      }

      return {
        decision: {
          gateId: GATE_ID.G06,
          gateOrder: 6,
          plane: 'data',
          outcome: executionResult!.status === 'failure' ? 'error' : 'pass',
          reason: `connector execution: ${executionResult!.status}`,
          denialCode: null,
          policyRuleId: null,
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          metadata: { connectorStatus: executionResult!.status },
        },
        grant,
        executionResult: executionResult!,
      };
    } finally {
      // GRANT-SECRET-001 FIX: clearGrantSecret now covers ALL post-mint paths:
      // connector not registered, capability unsupported, redeemGrant failure,
      // NexusSecurityViolation, generic error, and success.
      clearGrantSecret(grant);
    }
  }
}
