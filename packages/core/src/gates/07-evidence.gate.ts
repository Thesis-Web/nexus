/**
 * Gate 07 — Evidence — spec §13.8
 * ALWAYS runs exactly once per action regardless of upstream outcome.
 * CCV inside signed body — MODULAR-009 law.
 *
 * v1.7.25: sentinel encoding for absent fields. New fields: runId,
 * approvalRequired, approvalDecisionLabel. grantMetadata and
 * delegationContextSnapshot are non-nullable (sentinel-encoded internally).
 */
import {
  GATE_ID,
  GENESIS_HASH,
  OUTCOME_LABEL,
  FINAL_OUTCOME,
  DENIAL_CODE,
  EVIDENCE_SENTINEL,
  type Gate,
  type GateResult,
  type AgentAction,
  type PipelineContext,
  type GateDecision,
  type EvidenceRecord,
  type FinalOutcome,
  type ExecutionGrantMetadata,
  type DelegationContextSnapshot,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256, sign } from '../crypto/signer.js';
import { buildCCV } from '../compiler-view/ccv-builder.js';
import { redactExecutionResult } from '../redaction/redactor.js';
import type { LedgerBackend } from '../types/index.js';
import type { KeyPair } from '../crypto/key-manager.js';
import { newUuid } from '../utils/helpers.js';

function buildMinimalDelegationSnapshot(
  dc: import('../types/index.js').DelegationContext
): DelegationContextSnapshot {
  return {
    delegationId: dc.delegationId,
    principalId: dc.principalId,
    actorId: dc.actorId,
    chainDepth: dc.chainDepth,
    chainAncestors: [],
    chainHash: sha256(canonicalize([dc.delegationId])),
    allowedSystems: dc.allowedSystems,
    maxRiskTier: dc.maxRiskTier,
    environment: dc.environment,
    expiresAt: dc.expiresAt,
  };
}

function buildGrantMetadata(
  grant: import('../types/index.js').ExecutionGrant,
  template: import('../types/index.js').ExecutionGrantTemplate
): ExecutionGrantMetadata {
  return {
    grantId: grant.grantId,
    scopeDescriptor: grant.scopeDescriptor,
    credentialSubjectId: grant.credentialSubject.subjectId,
    credentialSubjectType: grant.credentialSubject.subjectType,
    issuedAt: grant.mintedAt,
    expiresAt: grant.expiresAt,
    expiryClass: template.expiryClass,
    templateFingerprint: template.templateFingerprint,
    approvalLinkage: grant.approvalId ?? EVIDENCE_SENTINEL,
  };
}

/** Sentinel-encoded grant metadata when no grant was minted */
function buildSentinelGrantMetadata(): ExecutionGrantMetadata {
  return {
    grantId: EVIDENCE_SENTINEL,
    scopeDescriptor: EVIDENCE_SENTINEL,
    credentialSubjectId: EVIDENCE_SENTINEL,
    credentialSubjectType: EVIDENCE_SENTINEL,
    issuedAt: EVIDENCE_SENTINEL,
    expiresAt: EVIDENCE_SENTINEL,
    expiryClass: EVIDENCE_SENTINEL,
    templateFingerprint: EVIDENCE_SENTINEL,
    approvalLinkage: EVIDENCE_SENTINEL,
  };
}

function computeFinalOutcome(decisions: GateDecision[]): FinalOutcome {
  for (const d of decisions) {
    if (
      d.outcome === 'pass' ||
      d.outcome === 'allow' ||
      d.outcome === OUTCOME_LABEL.REQUIRE_APPROVAL ||
      d.outcome === OUTCOME_LABEL.ESCALATE
    )
      continue;
    if (d.outcome === 'error') return FINAL_OUTCOME.ERROR;

    const code = d.denialCode;
    if (code === DENIAL_CODE.APPROVAL_TIMEOUT) return FINAL_OUTCOME.DENIED_TIMEOUT;
    if (
      code === DENIAL_CODE.REPLAY_DETECTED ||
      code === DENIAL_CODE.RATE_LIMIT_EXCEEDED ||
      code === DENIAL_CODE.BROAD_TOKEN_BYPASS ||
      code === DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED ||
      code === DENIAL_CODE.GRANT_EXPIRED
    )
      return FINAL_OUTCOME.DENIED_THREAT;
    if (d.gateId === GATE_ID.G06 && d.outcome === 'deny') return FINAL_OUTCOME.DENIED_THREAT;
    if (d.gateId === GATE_ID.G01) return FINAL_OUTCOME.DENIED_IDENTITY;
    if (d.gateId === GATE_ID.G02) return FINAL_OUTCOME.DENIED_CLASSIF;
    if (d.gateId === GATE_ID.G03) return FINAL_OUTCOME.DENIED_DELEGATION;
    if (d.gateId === GATE_ID.G04) return FINAL_OUTCOME.DENIED_POLICY;
    if (d.gateId === GATE_ID.G05) return FINAL_OUTCOME.DENIED_APPROVAL;
  }
  return FINAL_OUTCOME.EXECUTED;
}

export class EvidenceGate implements Gate {
  readonly gateId = GATE_ID.G07;
  readonly gateOrder = 7;
  readonly plane = 'control' as const;

  constructor(
    private readonly ledger: LedgerBackend,
    private readonly controlPlaneKey: KeyPair
  ) {}

  async evaluate(
    action: AgentAction,
    context: PipelineContext,
    decisions: GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();

    const prevSeq = await this.ledger.getLatestSequence();
    const prevRecord = prevSeq > 0 ? await this.ledger.getBySequence(prevSeq) : null;
    const prevHash = prevRecord?.recordHash ?? GENESIS_HASH;
    const nextSeq = prevSeq + 1;

    // delegationContextSnapshot is non-nullable in v1.7.25
    const delegationSnapshot: DelegationContextSnapshot =
      context.delegationSnapshot ?? buildMinimalDelegationSnapshot(context.delegationContext);

    // actionSummary: resolved* fields use EVIDENCE_SENTINEL when absent
    const actionSummary: EvidenceRecord['actionSummary'] = {
      actionId: action.actionId,
      receivedAt: action.receivedAt,
      protocol: action.protocol,
      actorId: action.actorId,
      actorClass: context.actor.actorClass,
      actorEnvironment: context.actor.environment,
      principalId: action.principalId,
      delegationSequence: action.delegationSequence,
      tool: action.tool,
      resolvedVerb: action.resolvedVerb ?? EVIDENCE_SENTINEL,
      resolvedCapability: action.resolvedCapability ?? EVIDENCE_SENTINEL,
      resolvedTarget: action.resolvedTarget ?? EVIDENCE_SENTINEL,
      resolvedDataClasses:
        action.resolvedDataClasses.length > 0 ? action.resolvedDataClasses : EVIDENCE_SENTINEL,
      resolvedRiskTier: action.resolvedRiskTier ?? EVIDENCE_SENTINEL,
    };

    // grantMetadata: non-nullable, sentinel-encoded when no grant
    const grantMeta: ExecutionGrantMetadata =
      context.executionGrant && context.grantTemplate
        ? buildGrantMetadata(context.executionGrant, context.grantTemplate)
        : buildSentinelGrantMetadata();

    const intentEvidence = {
      objectiveSummary: action.intent.objectiveSummary,
      triggeringSource: action.intent.triggeringSource,
      toolchainContext: action.intent.toolchainContext,
      modelId: action.intent.modelId,
      modelConfidence: action.intent.modelConfidence,
      riskNote: action.intent.riskNote,
    };

    const policyDecision = decisions.find(d => d.gateId === GATE_ID.G04);
    const finalOutcome = computeFinalOutcome(decisions);

    // approvalRequired and approvalDecisionLabel — new v1.7.25 fields
    const approvalRequired: boolean | typeof EVIDENCE_SENTINEL =
      context.approvalRequest !== undefined
        ? context.approvalRequest !== null
          ? true
          : false
        : EVIDENCE_SENTINEL;

    const approvalDecisionLabel = context.approvalResponse?.decision ?? EVIDENCE_SENTINEL;

    const recordBodyPreCCV: Omit<EvidenceRecord, 'compilerView' | 'recordHash' | 'signature'> = {
      recordId: newUuid(),
      actionId: action.actionId,
      sessionId: action.sessionId,
      runId: action.runId,
      ledgerSequence: nextSeq,
      actionSummary,
      intentEvidence,
      delegationContextSnapshot: delegationSnapshot,
      gateDecisions: decisions,
      policyRuleId: policyDecision?.policyRuleId ?? EVIDENCE_SENTINEL,
      policyOutcome: policyDecision ? (policyDecision.outcome as string) : EVIDENCE_SENTINEL,
      approvalRequired,
      approvalRequest: context.approvalRequest ?? null,
      approvalResponse: context.approvalResponse ?? null,
      approvalDecisionLabel,
      grantMetadata: grantMeta,
      executionResult: context.executionResult
        ? redactExecutionResult(context.executionResult, action.resolvedDataClasses)
        : null,
      finalOutcome,
      threatEvents: context.threatLog,
      previousHash: prevHash,
    };

    // CCV materialized inside the record body — MODULAR-009
    const compilerView = buildCCV(recordBodyPreCCV, context);
    const recordBodyFull = { ...recordBodyPreCCV, compilerView };

    const recordHash = sha256(canonicalize(recordBodyFull));
    const signature = await sign(recordHash, this.controlPlaneKey);
    const record: EvidenceRecord = {
      ...recordBodyFull,
      recordHash,
      signature,
    };

    await this.ledger.append(record);
    context.lastEvidenceRecord = record;

    return {
      decision: {
        gateId: GATE_ID.G07,
        gateOrder: 7,
        plane: 'control',
        outcome: 'pass',
        reason: 'evidence record written',
        denialCode: null,
        policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        metadata: { ledgerSequence: nextSeq, finalOutcome },
      },
    };
  }
}
