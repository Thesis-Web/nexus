/**
 * Gate 02 — Classification — spec §13.3
 * Verb normalization, target normalization, capability resolution, risk tier computation.
 * ADAPTER ENVIRONMENT LAW: environment comes from actor registry only, via targetNormalizer.
 */
import { GATE_ID, DENIAL_CODE, } from '../types/index.js';
import { resolveCapability } from '../classification/capability-registry.js';
function deny(code, reason, startMs) {
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
export class ClassificationGate {
    verbNormalizer;
    targetNormalizer;
    dataClassifier;
    riskClassifier;
    gateId = GATE_ID.G02;
    gateOrder = 2;
    plane = 'control';
    constructor(verbNormalizer, targetNormalizer, dataClassifier, riskClassifier) {
        this.verbNormalizer = verbNormalizer;
        this.targetNormalizer = targetNormalizer;
        this.dataClassifier = dataClassifier;
        this.riskClassifier = riskClassifier;
    }
    async evaluate(action, context, _prior) {
        const startMs = Date.now();
        const verb = this.verbNormalizer.normalize(action.rawVerb);
        if (!verb)
            return deny(DENIAL_CODE.UNRESOLVABLE_VERB, 'unresolvable action verb', startMs);
        // actor.environment is the authoritative environment — not adapter-supplied
        const target = this.targetNormalizer.normalize(action.rawTarget, action.tool, context.actor.environment // Gate 01 invariant: actor resolved
        );
        if (!target)
            return deny(DENIAL_CODE.UNRESOLVABLE_TARGET, 'unresolvable target', startMs);
        const dataClasses = this.dataClassifier.classify(action.intent, target, verb);
        const capabilityId = resolveCapability(verb, target, dataClasses);
        if (!capabilityId)
            return deny(DENIAL_CODE.UNRESOLVABLE_CAPABILITY, 'unresolvable capability', startMs);
        const riskTier = this.riskClassifier.compute(capabilityId, dataClasses, target.environment, target.externalFacing);
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
