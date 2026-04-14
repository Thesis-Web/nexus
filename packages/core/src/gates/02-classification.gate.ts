/**
 * Gate 02 — Classification — spec §13.3
 * Verb normalization, target normalization, capability resolution, risk tier computation.
 * ADAPTER ENVIRONMENT LAW: environment comes from actor registry only, via targetNormalizer.
 */
import {
  GATE_ID, DENIAL_CODE,
  type Gate, type GateResult, type AgentAction,
  type PipelineContext, type GateDecision,
} from '../types/index.js';
import type { VerbNormalizer } from '../classification/verb-normalizer.js';
import type { TargetNormalizer } from '../classification/target-normalizer.js';
import type { DataClassifier } from '../classification/data-classifier.js';
import type { RiskClassifier } from '../classification/risk-classifier.js';
import { resolveCapability } from '../classification/capability-registry.js';

function deny(code: string, reason: string, startMs: number): GateResult {
  return {
    decision: {
      gateId: GATE_ID.G02, gateOrder: 2, plane: 'control',
      outcome: 'deny', reason, denialCode: code,
      policyRuleId: null, evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs, metadata: {},
    },
  };
}

export class ClassificationGate implements Gate {
  readonly gateId    = GATE_ID.G02;
  readonly gateOrder = 2;
  readonly plane     = 'control' as const;

  constructor(
    private readonly verbNormalizer:   VerbNormalizer,
    private readonly targetNormalizer: TargetNormalizer,
    private readonly dataClassifier:   DataClassifier,
    private readonly riskClassifier:   RiskClassifier
  ) {}

  async evaluate(
    action:  AgentAction,
    context: PipelineContext,
    _prior:  GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();

    const verb = this.verbNormalizer.normalize(action.rawVerb);
    if (!verb) return deny(DENIAL_CODE.UNRESOLVABLE_VERB, 'unresolvable action verb', startMs);

    // actor.environment is the authoritative environment — not adapter-supplied
    const target = this.targetNormalizer.normalize(
      action.rawTarget, action.tool, context.actor!.environment // Gate 01 invariant: actor resolved
    );
    if (!target) return deny(DENIAL_CODE.UNRESOLVABLE_TARGET, 'unresolvable target', startMs);

    const dataClasses  = this.dataClassifier.classify(action.intent, target, verb);
    const capabilityId = resolveCapability(verb, target, dataClasses);
    if (!capabilityId) return deny(DENIAL_CODE.UNRESOLVABLE_CAPABILITY, 'unresolvable capability', startMs);

    const riskTier = this.riskClassifier.compute(
      capabilityId, dataClasses, target.environment, target.externalFacing
    );

    return {
      decision: {
        gateId: GATE_ID.G02, gateOrder: 2, plane: 'control',
        outcome: 'pass', reason: `classified: ${capabilityId} @ ${riskTier}`,
        denialCode: null, policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs, metadata: { capabilityId, riskTier },
      },
      actionMutations: {
        resolvedVerb:        verb,
        resolvedCapability:  capabilityId,
        resolvedTarget:      target,
        resolvedDataClasses: dataClasses,
        resolvedRiskTier:    riskTier,
      },
    };
  }
}
