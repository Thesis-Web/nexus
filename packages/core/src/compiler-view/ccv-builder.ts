/**
 * CCV builder — spec §14
 * MODULAR-009: CCV is blueprint law. Stored within the signed EvidenceRecord body only.
 * delegationSequence is NOT a CCV field — forensic-only in actionSummary.
 *
 * v1.8.26: sentinel encoding (EVIDENCE_SENTINEL = 'NOT_APPLICABLE') replaces null/empty
 * for absent classification, policy, and execution fields.
 */
import {
  GATE_ID,
  BLUEPRINT_VERSION,
  RUNTIME_CONTRACT_VERSION,
  CAPABILITY_TAXONOMY_VERSION,
  COMPARISON_INPUT_VERSION,
  EVIDENCE_SENTINEL,
  type EvidenceRecord,
  type EvidenceSentinel,
  type PipelineContext,
  type CompilerComparisonView,
  type ResourceTarget,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';

function isResourceTarget(val: ResourceTarget | EvidenceSentinel): val is ResourceTarget {
  return typeof val === 'object' && val !== null;
}

export function computeNormalizedActionHash(
  actionSummary: EvidenceRecord['actionSummary']
): string {
  const target = actionSummary.resolvedTarget;
  // CCV-001 FIX: spec §14.2 — sentinel-faithful; use EVIDENCE_SENTINEL, not null/[]
  const normalized = {
    tool: actionSummary.tool,
    resolvedVerb: actionSummary.resolvedVerb,
    resolvedCapability: actionSummary.resolvedCapability,
    targetSystem: isResourceTarget(target) ? target.system : EVIDENCE_SENTINEL,
    targetResourceType: isResourceTarget(target) ? target.resourceType : EVIDENCE_SENTINEL,
    targetScope: isResourceTarget(target) ? target.resourceScope : EVIDENCE_SENTINEL,
    externalFacing: isResourceTarget(target) ? target.externalFacing : EVIDENCE_SENTINEL,
    dataClasses: Array.isArray(actionSummary.resolvedDataClasses)
      ? [...actionSummary.resolvedDataClasses].sort()
      : EVIDENCE_SENTINEL,
    riskTier: actionSummary.resolvedRiskTier,
  };
  return sha256(canonicalize(normalized));
}

export function buildCCV(
  record: Omit<EvidenceRecord, 'compilerView' | 'recordHash' | 'signature'>,
  context: PipelineContext
): CompilerComparisonView {
  const policyDecision = record.gateDecisions.find(d => d.gateId === GATE_ID.G04);

  return {
    meta: {
      blueprintVersion: BLUEPRINT_VERSION,
      runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
      capabilityTaxonomyVersion: CAPABILITY_TAXONOMY_VERSION,
      comparisonInputVersion: COMPARISON_INPUT_VERSION,
      normalizedActionHash: computeNormalizedActionHash(record.actionSummary),
      policyBundleHash: context.policyFile?.bundleHash ?? sha256(canonicalize('no_policy')),
    },
    identity: {
      actorId: record.actionSummary.actorId,
      actorClass: record.actionSummary.actorClass,
      principalId: record.actionSummary.principalId,
      environment: record.actionSummary.actorEnvironment,
    },
    delegation: {
      delegationContextId: record.delegationContextSnapshot.delegationId,
      chainDepth: record.delegationContextSnapshot.chainDepth,
      chainHash: record.delegationContextSnapshot.chainHash,
      maxRiskTier: record.delegationContextSnapshot.maxRiskTier,
    },
    classification: {
      capabilityId: record.actionSummary.resolvedCapability,
      actionVerb: record.actionSummary.resolvedVerb,
      dataClasses: Array.isArray(record.actionSummary.resolvedDataClasses)
        ? [...record.actionSummary.resolvedDataClasses].sort()
        : EVIDENCE_SENTINEL,
      riskTier: record.actionSummary.resolvedRiskTier,
    },
    policyAndApproval: {
      policyRuleId: record.policyRuleId,
      outcomeLabel: record.policyOutcome,
      approvalRequired: record.approvalRequired,
      approvalDecisionLabel: record.approvalDecisionLabel,
    },
    authorityAndExecution: {
      executionGrantId: record.grantMetadata.grantId,
      credentialSubjectType: record.grantMetadata.credentialSubjectType,
      scopeDescriptor: record.grantMetadata.scopeDescriptor,
      expiryClass: record.grantMetadata.expiryClass,
      grantTemplateFingerprint: record.grantMetadata.templateFingerprint,
    },
    result: {
      finalOutcome: record.finalOutcome,
      errorCodeFamily: record.executionResult?.errorType ?? null,
    },
  };
}

export function areComparable(a: CompilerComparisonView, b: CompilerComparisonView): boolean {
  return (
    a.meta.blueprintVersion === b.meta.blueprintVersion &&
    a.meta.runtimeContractVersion === b.meta.runtimeContractVersion &&
    a.meta.capabilityTaxonomyVersion === b.meta.capabilityTaxonomyVersion &&
    a.meta.comparisonInputVersion === b.meta.comparisonInputVersion &&
    a.identity.actorClass === b.identity.actorClass &&
    a.identity.environment === b.identity.environment &&
    a.classification.capabilityId === b.classification.capabilityId &&
    a.meta.normalizedActionHash === b.meta.normalizedActionHash
  );
}
