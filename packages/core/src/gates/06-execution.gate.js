/**
 * Gate 06 — Execution — spec §13.7
 * MODULAR-005: Calls connector interface only.
 * SOLVE-013: NexusSecurityViolation caught separately — maps to denied_threat + ThreatEvent.
 * clearGrantSecret() always called in finally — even on NexusSecurityViolation.
 */
import { GATE_ID, DENIAL_CODE, NexusSecurityViolation, } from '../types/index.js';
import { assertTemplateIntegrity } from '../policy/grant-template-builder.js';
import { mintGrant } from '../execution/grant-minter.js';
import { clearGrantSecret } from '../execution/grant-vault.js';
function sanitizeError(err) {
    if (!(err instanceof Error))
        return 'connector_unknown_error';
    return (err.message
        .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED:SECRET]')
        .slice(0, 500) || 'connector_error_no_message');
}
export class ExecutionGate {
    controlPlaneKey;
    gateId = GATE_ID.G06;
    gateOrder = 6;
    plane = 'data';
    constructor(controlPlaneKey) {
        this.controlPlaneKey = controlPlaneKey;
    }
    async evaluate(action, context, _prior) {
        const startMs = Date.now();
        const template = context.grantTemplate; // orchestrator invariant
        // === CONTROL PLANE: verify template integrity and mint grant ===
        assertTemplateIntegrity(template);
        const grant = await mintGrant(action, template, context.approvalRequest ?? null, this.controlPlaneKey);
        // === DATA PLANE: connector forwarding ===
        const connector = context.connectorRegistry.get(action.resolvedTarget.system);
        if (!connector) {
            return {
                decision: {
                    gateId: GATE_ID.G06,
                    gateOrder: 6,
                    plane: 'data',
                    outcome: 'error',
                    reason: `connector not registered: ${action.resolvedTarget.system}`,
                    denialCode: DENIAL_CODE.CONNECTOR_NOT_REGISTERED,
                    policyRuleId: null,
                    evaluatedAt: new Date().toISOString(),
                    durationMs: Date.now() - startMs,
                    metadata: {},
                },
            };
        }
        if (!connector.supportedCapabilities().includes(action.resolvedCapability)) {
            return {
                decision: {
                    gateId: GATE_ID.G06,
                    gateOrder: 6,
                    plane: 'data',
                    outcome: 'error',
                    reason: `connector does not support: ${action.resolvedCapability}`,
                    denialCode: DENIAL_CODE.CONNECTOR_CAP_UNSUPPORTED,
                    policyRuleId: null,
                    evaluatedAt: new Date().toISOString(),
                    durationMs: Date.now() - startMs,
                    metadata: {},
                },
            };
        }
        await connector.redeemGrant(grant);
        let executionResult;
        try {
            executionResult = await connector.execute(action, grant);
        }
        catch (err) {
            // NexusSecurityViolation: governed security breach — SEPARATE catch path (SOLVE-013)
            if (err instanceof NexusSecurityViolation) {
                const threatEvent = {
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
                            violationType: err.violationType ?? '',
                        },
                    },
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
        finally {
            clearGrantSecret(grant); // always clear — even on NexusSecurityViolation
        }
        return {
            decision: {
                gateId: GATE_ID.G06,
                gateOrder: 6,
                plane: 'data',
                outcome: executionResult.status === 'failure' ? 'error' : 'pass',
                reason: `connector execution: ${executionResult.status}`,
                denialCode: null,
                policyRuleId: null,
                evaluatedAt: new Date().toISOString(),
                durationMs: Date.now() - startMs,
                metadata: { connectorStatus: executionResult.status },
            },
            grant,
            executionResult: executionResult,
        };
    }
}
