/**
 * Pipeline orchestrator — spec §13.1
 * Explicit stateful control-flow branch — NOT a generic gate loop. (BS-101)
 * Gate 05 and Gate 06 are NOT in the main gate array.
 * Gate 07 always runs exactly once unconditionally.
 */
import {
  OUTCOME_LABEL,
  NexusSecurityViolation,
  DENIAL_CODE,
  type AgentAction,
  type PipelineContext,
  type EvidenceRecord,
  type ThreatEvent,
  type ConnectorRegistry,
  type ChannelRegistry,
  type Connector,
  type ApprovalChannel,
  type PipelineInterface,
} from '../types/index.js';
import type { IdentityGate } from '../gates/01-identity.gate.js';
import type { ClassificationGate } from '../gates/02-classification.gate.js';
import type { DelegationGate } from '../gates/03-delegation.gate.js';
import type { PolicyGate } from '../gates/04-policy.gate.js';
import type { ApprovalGate } from '../gates/05-approval.gate.js';
import type { ExecutionGate } from '../gates/06-execution.gate.js';
import type { EvidenceGate } from '../gates/07-evidence.gate.js';
import type { ReplayDetector } from '../security/replay-detector.js';
import type { RateLimiter } from '../security/rate-limiter.js';
import { buildThreatEvent } from '../security/threat-log.js';
import { guardString, INTENT_MAX_CHARS, RISK_NOTE_MAX_CHARS } from '../security/injection-guard.js';
import { validateActionSchema } from '../security/ingress-validator.js';
import { nextSequence } from '../identity/delegation-store.js';
import type Database from 'better-sqlite3';

export interface PipelineGates {
  identity: IdentityGate;
  classification: ClassificationGate;
  delegation: DelegationGate;
  policy: PolicyGate;
  approval: ApprovalGate;
  execution: ExecutionGate;
  evidence: EvidenceGate;
}

export class Pipeline implements PipelineInterface {
  constructor(
    private readonly gates: PipelineGates,
    private readonly replay: ReplayDetector,
    private readonly limiter: RateLimiter,
    private readonly db: Database.Database
  ) {}

  async process(
    rawAction: Omit<AgentAction, 'delegationSequence'>,
    context: PipelineContext
  ): Promise<EvidenceRecord> {
    // === INGRESS SECURITY ===
    // Rate limit
    try {
      this.limiter.check(rawAction.actorId);
    } catch (err) {
      if (err instanceof NexusSecurityViolation) {
        const te: ThreatEvent = buildThreatEvent('rate_limit_exceeded', 'ingress', err.message);
        context.threatLog.push(te);
        const action = this.assignSequence(rawAction, context);
        return this.runGate07(action, context, [
          {
            gateId: 'ingress',
            gateOrder: 0,
            plane: 'control',
            outcome: 'deny',
            reason: err.message,
            denialCode: DENIAL_CODE.RATE_LIMIT_EXCEEDED,
            policyRuleId: null,
            evaluatedAt: new Date().toISOString(),
            durationMs: 0,
            metadata: {},
          },
        ]);
      }
      throw err;
    }

    // Replay detection
    try {
      this.replay.check(rawAction.actionId);
    } catch (err) {
      if (err instanceof NexusSecurityViolation) {
        const te: ThreatEvent = buildThreatEvent('replay_detected', 'ingress', err.message);
        context.threatLog.push(te);
        const action = this.assignSequence(rawAction, context);
        return this.runGate07(action, context, [
          {
            gateId: 'ingress',
            gateOrder: 0,
            plane: 'control',
            outcome: 'deny',
            reason: err.message,
            denialCode: DENIAL_CODE.REPLAY_DETECTED,
            policyRuleId: null,
            evaluatedAt: new Date().toISOString(),
            durationMs: 0,
            metadata: {},
          },
        ]);
      }
      throw err;
    }

    // SECURITY-INGRESS-001 FIX: Structural schema validation at ingress
    // Spec §8.1: "Security Layer: checkIngress → replay check, rate limit, schema validation"
    const schemaViolation = validateActionSchema(rawAction);
    if (schemaViolation) {
      const te: ThreatEvent = buildThreatEvent(
        'security_violation',
        'ingress',
        `schema validation failed: ${schemaViolation}`
      );
      context.threatLog.push(te);
      const action = this.assignSequence(rawAction, context);
      return this.runGate07(action, context, [
        {
          gateId: 'ingress',
          gateOrder: 0,
          plane: 'control',
          outcome: 'deny',
          reason: `ingress schema invalid: ${schemaViolation}`,
          denialCode: DENIAL_CODE.INGRESS_SCHEMA_INVALID,
          policyRuleId: null,
          evaluatedAt: new Date().toISOString(),
          durationMs: 0,
          metadata: {},
        },
      ]);
    }

    // SECURITY-INGRESS-002 / REDACT-001 FIX: Intent field sanitization at ingress
    // spec §17.2 — sanitize before Gate 02 classification
    const summaryGuard = guardString(rawAction.intent.objectiveSummary, INTENT_MAX_CHARS);
    rawAction.intent.objectiveSummary = summaryGuard.value || rawAction.intent.objectiveSummary;
    if (summaryGuard.truncated) {
      context.threatLog.push(
        buildThreatEvent('intent_overflow', 'ingress', 'objectiveSummary truncated')
      );
    }
    if (summaryGuard.injectionDetected) {
      context.threatLog.push(
        buildThreatEvent('security_violation', 'ingress', 'objectiveSummary injection pattern')
      );
    }
    if (rawAction.intent.riskNote) {
      const riskGuard = guardString(rawAction.intent.riskNote, RISK_NOTE_MAX_CHARS);
      rawAction.intent.riskNote = riskGuard.value;
      if (riskGuard.truncated) {
        context.threatLog.push(
          buildThreatEvent('intent_overflow', 'ingress', 'riskNote truncated')
        );
      }
      if (riskGuard.injectionDetected) {
        context.threatLog.push(
          buildThreatEvent('security_violation', 'ingress', 'riskNote injection pattern')
        );
      }
    }

    // Assign delegation sequence — engine-assigned, never adapter-provided
    const action: AgentAction = this.assignSequence(rawAction, context);
    const decisions: import('../types/index.js').GateDecision[] = [];

    // === GATES 01-06: exception-safe wrapper (PIPELINE-001) ===
    // Gate 07 must always run. If any gate throws, we catch and still run Gate 07.
    try {
      // === GATES 01-04: fixed sequential pipeline ===
      const linearGates = [
        this.gates.identity,
        this.gates.classification,
        this.gates.delegation,
        this.gates.policy,
      ];

      let earlyDenial = false;
      for (const gate of linearGates) {
        const result = await gate.evaluate(action, context, decisions);
        decisions.push(result.decision);

        if (result.actionMutations) Object.assign(action, result.actionMutations);
        if (result.delegationSnapshot) context.delegationSnapshot = result.delegationSnapshot;
        if (result.grantTemplate) context.grantTemplate = result.grantTemplate;

        const isDeny = result.decision.outcome === 'deny' || result.decision.outcome === 'error';
        if (isDeny) {
          earlyDenial = true;
          break;
        }
      }

      // === POST-GATE-04 BRANCH — explicit on OutcomeLabel (BS-101) ===
      if (!earlyDenial) {
        const outcome = decisions[decisions.length - 1]!.outcome;

        if (outcome === OUTCOME_LABEL.REQUIRE_APPROVAL || outcome === OUTCOME_LABEL.ESCALATE) {
          // === GATE 05: Approval (conditional — never on ALLOW paths) ===
          const approvalResult = await this.gates.approval.evaluate(action, context, decisions);
          decisions.push(approvalResult.decision);
          if (approvalResult.approvalRequest)
            context.approvalRequest = approvalResult.approvalRequest;
          if (approvalResult.approvalResponse)
            context.approvalResponse = approvalResult.approvalResponse;

          const approvalDenied =
            approvalResult.decision.outcome === 'deny' ||
            approvalResult.decision.outcome === 'error';

          if (!approvalDenied) {
            // Gate 05 passed → Gate 06
            const execResult = await this.gates.execution.evaluate(action, context, decisions);
            decisions.push(execResult.decision);
            if (execResult.grant) context.executionGrant = execResult.grant;
            if (execResult.executionResult) context.executionResult = execResult.executionResult;
          }
        } else if (outcome === OUTCOME_LABEL.ALLOW) {
          // === GATE 06: Execution (no approval required) ===
          const execResult = await this.gates.execution.evaluate(action, context, decisions);
          decisions.push(execResult.decision);
          if (execResult.grant) context.executionGrant = execResult.grant;
          if (execResult.executionResult) context.executionResult = execResult.executionResult;
        }
        // else: DENY or unknown — fall through to Gate 07
      }
    } catch (err) {
      // Mid-pipeline exception — Gate 07 must still run.
      // Swallow the error into a threat event so evidence is recorded.
      if (err instanceof NexusSecurityViolation) {
        context.threatLog.push(buildThreatEvent('security_violation', 'ingress', err.message));
      } else {
        context.threatLog.push(
          buildThreatEvent(
            'security_violation',
            'ingress',
            err instanceof Error ? err.message : 'unknown pipeline error'
          )
        );
      }
    }

    // === GATE 07: Evidence (always runs — every path, including thrown exceptions) ===
    return this.runGate07(action, context, decisions);
  }

  /** Gate 07 always runs exactly once per action. Extracted to prevent duplication. */
  private async runGate07(
    action: AgentAction,
    context: PipelineContext,
    decisions: import('../types/index.js').GateDecision[]
  ): Promise<EvidenceRecord> {
    const evidenceResult = await this.gates.evidence.evaluate(action, context, decisions);
    decisions.push(evidenceResult.decision);
    if (!context.lastEvidenceRecord) {
      throw new Error('invariant: lastEvidenceRecord must be set by Gate 07');
    }
    return context.lastEvidenceRecord;
  }

  private assignSequence(
    rawAction: Omit<AgentAction, 'delegationSequence'>,
    context: PipelineContext
  ): AgentAction {
    const seq = nextSequence(this.db, rawAction.delegationId);
    return { ...rawAction, delegationSequence: seq } as AgentAction;
  }
}

// Registry implementations
export class SimpleConnectorRegistry implements ConnectorRegistry {
  private readonly map = new Map<string, Connector>();
  get(systemType: string): Connector | undefined {
    return this.map.get(systemType);
  }
  register(c: Connector) {
    this.map.set(c.systemType, c);
  }
  list() {
    return [...this.map.values()];
  }
}

export class SimpleChannelRegistry implements ChannelRegistry {
  private readonly map = new Map<string, ApprovalChannel>();
  get(channelId: string): ApprovalChannel | undefined {
    return this.map.get(channelId);
  }
  register(c: ApprovalChannel) {
    this.map.set(c.channelId, c);
  }
  list() {
    return [...this.map.values()];
  }
}
