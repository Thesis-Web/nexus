/**
 * Gate 04 — Policy — spec §13.5
 * Rule evaluation, outcome determination, grant template computation.
 * MODULAR-008: sole computation point for ExecutionGrantTemplate.
 *
 * F4.2 — Hard Law #5/#10/#13. Gate 04 reads `context.actor.octLevel`
 * (set at Gate 01 from actor-registry) and threads it through the
 * PolicyEvalEnvelope. If actor.octLevel is null/undefined, Gate 04 fails
 * closed with denial code POLICY_ENVELOPE_MISSING_OCT — the policy rules
 * are authored against an OCT axis, so an unclassified actor cannot be
 * evaluated.
 */
import {
  GATE_ID,
  OUTCOME_LABEL,
  DENIAL_CODE,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type IsoTimestamp,
  type RunLedgerWriter,
} from '../types/index.js';
import { matchesCondition, type PolicyEvalEnvelope } from '../policy/evaluator.js';
import { buildGrantTemplate } from '../policy/grant-template-builder.js';

export class PolicyGate implements Gate {
  readonly gateId = GATE_ID.G04;
  readonly gateOrder = 4;
  readonly plane = 'control' as const;

  constructor(
    // Optional ledger writer for the Phase 5 canonical surface emission.
    // Production composition root passes coreDeps.runLedgerWriter; unit
    // tests construct without it and the gate stays silent.
    private readonly runLedger?: RunLedgerWriter
  ) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    _prior: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();

    if (!context.policyFile) {
      return {
        decision: {
          gateId: GATE_ID.G04,
          gateOrder: 4,
          plane: 'control',
          outcome: 'deny',
          reason: 'no valid policy bundle loaded',
          denialCode: DENIAL_CODE.DEFAULT_DENY,
          policyRuleId: 'default_deny',
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          metadata: {},
        },
      };
    }

    // F4.2 §3.1 — actor must carry an OCT classification before policy
    // rules (which are keyed by OCT axis) can be evaluated. Fail closed.
    const actorOctLevel = context.actor?.octLevel ?? null;
    if (actorOctLevel === null) {
      return {
        decision: {
          gateId: GATE_ID.G04,
          gateOrder: 4,
          plane: 'control',
          outcome: 'deny',
          reason: 'policy_envelope_missing_oct: actor.octLevel absent',
          denialCode: DENIAL_CODE.POLICY_ENVELOPE_MISSING_OCT,
          policyRuleId: 'default_deny',
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          metadata: { actorId: context.actor?.actorId ?? null },
        },
      };
    }

    const envelope: PolicyEvalEnvelope = {
      actorClass: context.actor!.actorClass, // Gate 01 invariant
      capability: action.resolvedCapability!,
      verb: action.resolvedVerb!,
      riskTier: action.resolvedRiskTier!,
      dataClasses: action.resolvedDataClasses,
      environment: action.resolvedTarget!.environment,
      externalFacing: action.resolvedTarget!.externalFacing,
      chainDepth: context.delegationContext!.chainDepth, // Gate 01 invariant
      targetSystem: action.resolvedTarget!.system, // for PolicyCondition.targetSystems
      octLevel: actorOctLevel, // F4.2 §2.2
    };

    const matchedRule = context.policyFile.sortedRules.find(r =>
      matchesCondition(r.conditions, envelope)
    );
    const outcome = matchedRule?.outcome ?? OUTCOME_LABEL.DENY;
    const policyRuleId = matchedRule?.ruleId ?? 'default_deny';

    if (outcome === OUTCOME_LABEL.DENY) {
      return {
        decision: {
          gateId: GATE_ID.G04,
          gateOrder: 4,
          plane: 'control',
          outcome: 'deny',
          reason: `policy deny: rule ${policyRuleId}`,
          denialCode: DENIAL_CODE.POLICY_DENY,
          policyRuleId,
          evaluatedAt: new Date().toISOString(),
          durationMs: Date.now() - startMs,
          metadata: {},
        },
      };
    }

    const template = buildGrantTemplate(action, matchedRule, context);

    // Phase 5 canonical surface — emit `gate_04_require_approval` when
    // the policy rule's outcome routes the request through Gate 05 for
    // human-in-the-loop approval. This is the audit-trail signal that
    // policy decided approval IS required (distinct from a deny, distinct
    // from a clean allow). Gate 05 then runs the approval workflow and
    // emits its own `gate_05_require_approval` once the signed request
    // has been dispatched to the channel. Only emits when a
    // RunLedgerWriter is wired — keeps unit-test constructors clean.
    if (outcome === OUTCOME_LABEL.REQUIRE_APPROVAL && this.runLedger) {
      await this.runLedger.writeEvent({
        runId: action.runId,
        eventType: 'gate_04_require_approval',
        timestamp: new Date().toISOString() as IsoTimestamp,
        actorId: action.actorId,
        detail: {
          policyRuleId,
          capability: action.resolvedCapability!,
          targetSystem: action.resolvedTarget!.system,
        },
      });
    }

    return {
      decision: {
        gateId: GATE_ID.G04,
        gateOrder: 4,
        plane: 'control',
        outcome,
        reason: `policy rule matched: ${policyRuleId}`,
        denialCode: null,
        policyRuleId,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        metadata: {},
      },
      grantTemplate: template,
    };
  }
}
