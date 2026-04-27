/**
 * Gate 02 — Classification — spec §13.3, §10.4, §11.2
 * Verb normalization, target normalization, capability resolution, risk tier computation.
 * §10.4: OCT ceiling enforcement — more restrictive of identity + OCT wins.
 * DEF-S10-001: OCT enforcement is MANDATORY. Missing/unknown octLevel = deny.
 * ADAPTER ENVIRONMENT LAW: environment comes from actor registry only.
 */
import {
  GATE_ID,
  DENIAL_CODE,
  OCT_CEILINGS,
  EVIDENCE_SENTINEL,
  riskTierExceeds,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type RiskTier,
  type CapabilityCeiling,
} from '../types/index.js';
import type { VerbNormalizer } from '../classification/verb-normalizer.js';
import type { TargetNormalizer } from '../classification/target-normalizer.js';
import type { DataClassifier } from '../classification/data-classifier.js';
import type { RiskClassifier } from '../classification/risk-classifier.js';
import { resolveCapability } from '../classification/capability-registry.js';
import { resolveEffectiveCeiling } from '../classification/ceiling-resolver.js';

function deny(code: string, reason: string, startMs: number): GateResult {
  return {
    decision: {
      gateId: GATE_ID.G02,
      gateOrder: 2,
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

export class ClassificationGate implements Gate {
  readonly gateId = GATE_ID.G02;
  readonly gateOrder = 2;
  readonly plane = 'control' as const;

  constructor(
    private readonly verbNormalizer: VerbNormalizer,
    private readonly targetNormalizer: TargetNormalizer,
    private readonly dataClassifier: DataClassifier,
    private readonly riskClassifier: RiskClassifier
  ) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();
    const actor = context.actor!; // Gate 01 invariant: actor resolved

    // ── §11.1: OCT is mandatory actor state ─────────────────────────────
    // DEF-S10-001: Missing or unknown octLevel is a deterministic deny.
    const octCeiling = OCT_CEILINGS[actor.octLevel];
    if (!octCeiling) {
      return deny(
        DENIAL_CODE.OCT_UNASSIGNED,
        `actor ${actor.actorId} has missing or unknown OCT level: ${actor.octLevel}`,
        startMs
      );
    }

    // ── §11.2: OCT-COMPILE actors cannot execute system actions ──────────
    if (octCeiling.actionRiskCeiling === EVIDENCE_SENTINEL) {
      return deny(
        DENIAL_CODE.RISK_CEILING_EXCEEDED,
        'OCT-COMPILE actors cannot execute system actions',
        startMs
      );
    }

    // ── Verb normalization ──────────────────────────────────────────────
    const verb = this.verbNormalizer.normalize(action.rawVerb);
    if (!verb) return deny(DENIAL_CODE.UNRESOLVABLE_VERB, 'unresolvable action verb', startMs);

    // actor.environment is the authoritative environment — not adapter-supplied
    const target = this.targetNormalizer.normalize(
      action.rawTarget,
      action.tool,
      actor.environment
    );
    if (!target) return deny(DENIAL_CODE.UNRESOLVABLE_TARGET, 'unresolvable target', startMs);

    const dataClasses = this.dataClassifier.classify(action.intent, target, verb);
    const capabilityId = resolveCapability(verb, target, dataClasses);
    if (!capabilityId)
      return deny(DENIAL_CODE.UNRESOLVABLE_CAPABILITY, 'unresolvable capability', startMs);

    const riskTier = this.riskClassifier.compute(
      capabilityId,
      dataClasses,
      target.environment,
      target.externalFacing
    );

    // ── §10.4: Post-classification OCT ceiling check (mandatory) ─────────
    // IDENTITY-002 FIX: Use identity provider claims if available, else actor registration data
    const claimsCeiling = context.identityClaims?.capabilityCeilings?.[0];
    const identityCeiling: CapabilityCeiling = claimsCeiling
      ? {
          allowedSystems: claimsCeiling.allowedSystems,
          allowedCapabilities: claimsCeiling.allowedCapabilities,
          maxRiskTier: claimsCeiling.maxRiskTier,
        }
      : {
          allowedSystems: actor.allowedSystems,
          allowedCapabilities: ['*'],
          maxRiskTier: actor.riskCeiling as RiskTier,
        };
    const effective = resolveEffectiveCeiling(identityCeiling, octCeiling);
    if (riskTierExceeds(riskTier, effective.maxRiskTier)) {
      return deny(
        DENIAL_CODE.RISK_CEILING_EXCEEDED,
        `risk tier ${riskTier} exceeds effective ceiling ${effective.maxRiskTier} ` +
          `(OCT: ${actor.octLevel}, identity: ${actor.riskCeiling})`,
        startMs
      );
    }

    return {
      decision: {
        gateId: GATE_ID.G02,
        gateOrder: 2,
        plane: 'control',
        outcome: 'pass',
        reason: `classified: ${capabilityId} @ ${riskTier}`,
        denialCode: null,
        policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        metadata: { capabilityId, riskTier },
      },
      actionMutations: {
        resolvedVerb: verb,
        resolvedCapability: capabilityId,
        resolvedTarget: target,
        resolvedDataClasses: dataClasses,
        resolvedRiskTier: riskTier,
      },
    };
  }
}
