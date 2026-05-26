/**
 * Gate 02 — Classification — spec §13.3, §10.4, §11.2
 * Verb normalization, target normalization, capability resolution, risk tier computation.
 * §10.4: OCT ceiling enforcement — more restrictive of identity + OCT wins.
 * DEF-S10-001: OCT enforcement is MANDATORY. Missing/unknown octLevel = deny.
 * ADAPTER ENVIRONMENT LAW: environment comes from actor registry only.
 *
 * IDENTITY-002 HARDENED: identityClaims MUST be present in context (set by Gate01).
 * If missing → DENY. No wildcard fallback. No ['*'] invention. Default-deny.
 * The identity PROVIDER decides what capabilities an actor has — the gate enforces.
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
  type CapabilityCeiling,
  type IsoTimestamp,
  type RunLedgerWriter,
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
    private readonly riskClassifier: RiskClassifier,
    // Optional ledger writer for the Phase 5 canonical surface emissions.
    // Production composition root passes coreDeps.runLedgerWriter; unit
    // tests construct without it and the gate stays silent.
    private readonly runLedger?: RunLedgerWriter
  ) {}

  /**
   * Phase 5 canonical surface emission for Gate 02 denials. Each kind
   * fires two events: the gate-level event (gate_02_*) and the
   * ceiling-specific event (*_ceiling_exceeded). Both are in the
   * RunEventType union; tests assert either one is sufficient. Silent
   * when no runLedger is wired.
   *
   *   kind='oct'  → gate_02_oct_denied + oct_ceiling_exceeded
   *   kind='risk' → gate_02_risk_denied + risk_ceiling_exceeded
   */
  private async emitGate02Denial(
    action: AgentAction,
    kind: 'oct' | 'risk',
    reason: string,
    extraDetail: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.runLedger) return;
    const timestamp = new Date().toISOString() as IsoTimestamp;
    const gateEventType = kind === 'oct' ? 'gate_02_oct_denied' : 'gate_02_risk_denied';
    const ceilingEventType = kind === 'oct' ? 'oct_ceiling_exceeded' : 'risk_ceiling_exceeded';
    const detail = { reason, ...extraDetail };
    await this.runLedger.writeEvent({
      runId: action.runId,
      eventType: gateEventType,
      timestamp,
      actorId: action.actorId,
      detail,
    });
    await this.runLedger.writeEvent({
      runId: action.runId,
      eventType: ceilingEventType,
      timestamp,
      actorId: action.actorId,
      detail,
    });
  }

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();
    const actor = context.actor!; // Gate 01 invariant: actor resolved

    // ── IDENTITY-002 HARDENED: identity claims MUST be present ────────────
    // Gate 01 sets context.identityClaims on pass. If absent, something
    // bypassed Gate 01 or Gate 01 is broken. Either way: DENY.
    if (!context.identityClaims) {
      return deny(
        DENIAL_CODE.IDENTITY_CLAIMS_UNRESOLVABLE,
        'identity claims not present in context — Gate 01 must resolve claims before Gate 02',
        startMs
      );
    }

    // ── §11.1: OCT is mandatory actor state ─────────────────────────────
    // DEF-S10-001: Missing or unknown octLevel is a deterministic deny.
    // OCT-001: null octLevel is permitted in DB — fail closed here.
    if (!actor.octLevel) {
      await this.emitGate02Denial(action, 'oct', 'oct_unassigned', { octLevel: null });
      return deny(
        DENIAL_CODE.OCT_UNASSIGNED,
        `actor ${actor.actorId} has null OCT level — assign via signed oct_assignment`,
        startMs
      );
    }
    const octCeiling = OCT_CEILINGS[actor.octLevel];
    if (!octCeiling) {
      await this.emitGate02Denial(action, 'oct', 'oct_unknown', { octLevel: actor.octLevel });
      return deny(
        DENIAL_CODE.OCT_UNASSIGNED,
        `actor ${actor.actorId} has unknown OCT level: ${actor.octLevel}`,
        startMs
      );
    }

    // ── §11.2: OCT-COMPILE actors cannot execute system actions ──────────
    if (octCeiling.actionRiskCeiling === EVIDENCE_SENTINEL) {
      // OCT class itself forbids actions — this is an OCT-axis denial
      // (not a risk-tier denial). The DENIAL_CODE.RISK_CEILING_EXCEEDED
      // label is retained for backward compatibility with consumers that
      // read the gate's internal code; the audit-trail event uses the
      // OCT name because the axis at fault is OCT.
      await this.emitGate02Denial(action, 'oct', 'oct_compile_forbids_actions', {
        octLevel: actor.octLevel,
      });
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
    // IDENTITY-002 HARDENED: Use identity provider claims directly.
    // No fallback to actor.riskCeiling with ['*'] wildcard.
    // The provider already made the capability decision — we enforce it.
    const claimsCeiling = context.identityClaims.capabilityCeilings[0];
    const identityCeiling: CapabilityCeiling = claimsCeiling
      ? {
          allowedSystems: claimsCeiling.allowedSystems,
          allowedCapabilities: claimsCeiling.allowedCapabilities,
          maxRiskTier: claimsCeiling.maxRiskTier,
        }
      : {
          // No capability ceilings in claims = no capabilities allowed = DENY path via ceiling
          allowedSystems: [],
          allowedCapabilities: [],
          maxRiskTier: 'low',
        };
    const effective = resolveEffectiveCeiling(identityCeiling, octCeiling);
    // T16-F01 / RULING-005: store effective ceiling in context for downstream gates,
    // NVG integration, and bypass path enforcement.
    context.effectiveCeiling = effective;
    if (riskTierExceeds(riskTier, effective.maxRiskTier)) {
      // Risk-tier denial: action's resolved risk exceeds the effective
      // ceiling (min of OCT-side and identity-side). Phase 5 audit
      // surface — emit gate_02_risk_denied + risk_ceiling_exceeded.
      await this.emitGate02Denial(action, 'risk', 'risk_tier_exceeds_effective_ceiling', {
        riskTier,
        effectiveCeiling: effective.maxRiskTier,
        octLevel: actor.octLevel,
        identityMaxRiskTier: identityCeiling.maxRiskTier,
        capability: capabilityId,
      });
      return deny(
        DENIAL_CODE.RISK_CEILING_EXCEEDED,
        `risk tier ${riskTier} exceeds effective ceiling ${effective.maxRiskTier} ` +
          `(OCT: ${actor.octLevel}, identity: ${identityCeiling.maxRiskTier})`,
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
