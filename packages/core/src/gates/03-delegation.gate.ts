/**
 * Gate 03 — Delegation — spec §13.4
 * Signature, expiry, capability scope, system scope, risk ceiling, chain depth,
 * propagation, environment match (blueprint law), chain snapshot.
 */
import {
  GATE_ID,
  DENIAL_CODE,
  ACTOR_CLASS,
  DelegationChainIntegrityError,
  riskTierExceeds,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type DelegationContextSnapshot,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { sha256 } from '../crypto/signer.js';
import type { KeyPair } from '../crypto/key-manager.js';

function deny(code: string, reason: string, startMs: number): GateResult {
  return {
    decision: {
      gateId: GATE_ID.G03,
      gateOrder: 3,
      plane: 'control',
      outcome: 'deny',
      reason,
      denialCode: code,
      policyRuleId: null,
      evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
  };
}

export class DelegationGate implements Gate {
  readonly gateId = GATE_ID.G03;
  readonly gateOrder = 3;
  readonly plane = 'control' as const;

  constructor(private readonly controlPlaneKey: KeyPair) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();
    const dc = context.delegationContext!; // Gate 01 invariant: delegationContext resolved

    const { signature, ...body } = dc;
    const isValid = await verify(canonicalize(body), signature, this.controlPlaneKey.publicKey);
    if (!isValid)
      return deny(DENIAL_CODE.DELEGATION_SIG_INVALID, 'delegation signature invalid', startMs);

    if (new Date(dc.expiresAt) <= new Date()) {
      return deny(DENIAL_CODE.DELEGATION_EXPIRED, 'delegation expired', startMs);
    }

    if (!dc.allowedCapabilities.includes(action.resolvedCapability!)) {
      return deny(
        DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION,
        'capability not in delegation',
        startMs
      );
    }
    if (dc.forbiddenCapabilities.includes(action.resolvedCapability!)) {
      return deny(DENIAL_CODE.CAPABILITY_FORBIDDEN, 'capability explicitly forbidden', startMs);
    }
    if (!dc.allowedSystems.includes(action.resolvedTarget!.system)) {
      return deny(DENIAL_CODE.SYSTEM_NOT_IN_DELEGATION, 'system not in delegation', startMs);
    }
    if (riskTierExceeds(action.resolvedRiskTier!, dc.maxRiskTier)) {
      return deny(
        DENIAL_CODE.RISK_TIER_EXCEEDS_CEILING,
        'risk tier exceeds delegation ceiling',
        startMs
      );
    }
    if (
      context.actor!.actorClass === ACTOR_CLASS.DELEGATED_SUBAGENT && // Gate 01 invariant
      dc.chainDepth >= dc.maxChainDepth
    ) {
      return deny(DENIAL_CODE.CHAIN_DEPTH_EXCEEDED, 'chain depth ceiling exceeded', startMs);
    }
    if (dc.parentDelegationId !== null && !dc.allowDownstreamPropagation) {
      return deny(
        DENIAL_CODE.PROPAGATION_NOT_PERMITTED,
        'downstream propagation not permitted',
        startMs
      );
    }
    // Environment must match — blueprint drift prevention law
    if (action.resolvedTarget!.environment !== dc.environment) {
      return deny(
        DENIAL_CODE.ENVIRONMENT_MISMATCH,
        `environment mismatch: delegation scoped to ${dc.environment}, action targets ${action.resolvedTarget!.environment}`,
        startMs
      );
    }

    // Build chain snapshot — throws DelegationChainIntegrityError if parent missing
    let delegationSnapshot: DelegationContextSnapshot;
    try {
      delegationSnapshot = await buildDelegationSnapshot(dc, context);
    } catch (err) {
      if (err instanceof DelegationChainIntegrityError) {
        return deny(DENIAL_CODE.CHAIN_INTEGRITY_BROKEN, err.message, startMs);
      }
      throw err;
    }

    return {
      decision: {
        gateId: GATE_ID.G03,
        gateOrder: 3,
        plane: 'control',
        outcome: 'pass',
        reason: 'delegation valid',
        denialCode: null,
        policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        metadata: { chainDepth: dc.chainDepth },
      },
      delegationSnapshot,
    };
  }
}

async function buildDelegationSnapshot(
  dc: import('../types/index.js').DelegationContext,
  context: PipelineContext
): Promise<DelegationContextSnapshot> {
  const ancestors: string[] = [];
  let current = dc;
  while (current.parentDelegationId !== null) {
    ancestors.unshift(current.parentDelegationId);
    const parent = await context.delegationStore.getById(current.parentDelegationId);
    if (!parent)
      throw new DelegationChainIntegrityError(
        `Delegation chain broken: parent ${current.parentDelegationId} not found in store`
      );
    current = parent;
  }
  return {
    delegationId: dc.delegationId,
    principalId: dc.principalId,
    actorId: dc.actorId,
    chainDepth: dc.chainDepth,
    chainAncestors: ancestors,
    chainHash: sha256(canonicalize([dc.delegationId, ...ancestors])),
    allowedSystems: dc.allowedSystems,
    maxRiskTier: dc.maxRiskTier,
    environment: dc.environment,
    expiresAt: dc.expiresAt,
  };
}
