/**
 * Gate 04 — Policy — spec §13.5
 * Rule evaluation, outcome determination, grant template computation.
 * MODULAR-008: sole computation point for ExecutionGrantTemplate.
 */
import {
  GATE_ID, OUTCOME_LABEL, DENIAL_CODE,
  type Gate, type GateResult, type AgentAction,
  type PipelineContext, type GateDecision,
} from '../types/index.js';
import { matchesCondition, type PolicyEvalEnvelope } from '../policy/evaluator.js';
import { buildGrantTemplate } from '../policy/grant-template-builder.js';

export class PolicyGate implements Gate {
  readonly gateId    = GATE_ID.G04;
  readonly gateOrder = 4;
  readonly plane     = 'control' as const;

  async evaluate(
    action:  AgentAction,
    context: PipelineContext,
    _prior:  GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();

    if (!context.policyFile) {
      return {
        decision: {
          gateId: GATE_ID.G04, gateOrder: 4, plane: 'control',
          outcome: 'deny', reason: 'no valid policy bundle loaded',
          denialCode: DENIAL_CODE.DEFAULT_DENY, policyRuleId: 'default_deny',
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs, metadata: {},
        },
      };
    }

    const envelope: PolicyEvalEnvelope = {
      actorClass:    context.actor.actorClass,
      capability:    action.resolvedCapability!,
      verb:          action.resolvedVerb!,
      riskTier:      action.resolvedRiskTier!,
      dataClasses:   action.resolvedDataClasses,
      environment:   action.resolvedTarget!.environment,
      externalFacing:action.resolvedTarget!.externalFacing,
      chainDepth:    context.delegationContext.chainDepth,
    };

    const matchedRule  = context.policyFile.sortedRules.find(
      r => matchesCondition(r.conditions, envelope)
    );
    const outcome      = matchedRule?.outcome ?? OUTCOME_LABEL.DENY;
    const policyRuleId = matchedRule?.ruleId  ?? 'default_deny';

    if (outcome === OUTCOME_LABEL.DENY) {
      return {
        decision: {
          gateId: GATE_ID.G04, gateOrder: 4, plane: 'control',
          outcome: 'deny', reason: `policy deny: rule ${policyRuleId}`,
          denialCode: DENIAL_CODE.POLICY_DENY, policyRuleId,
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs, metadata: {},
        },
      };
    }

    const template = buildGrantTemplate(action, matchedRule, context);

    return {
      decision: {
        gateId: GATE_ID.G04, gateOrder: 4, plane: 'control',
        outcome,
        reason:      `policy rule matched: ${policyRuleId}`,
        denialCode:  null, policyRuleId,
        evaluatedAt: new Date().toISOString(),
        durationMs:  Date.now() - startMs, metadata: {},
      },
      grantTemplate: template,
    };
  }
}
