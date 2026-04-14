/**
 * CCV builder — spec §14
 * MODULAR-009: CCV is blueprint law. Stored within the signed EvidenceRecord body only.
 * delegationSequence is NOT a CCV field — forensic-only in actionSummary.
 */
import { GATE_ID, BLUEPRINT_VERSION, SPEC_VERSION, CAPABILITY_TAXONOMY_VERSION, COMPARISON_INPUT_VERSION, } from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';
function computeNormalizedActionHash(actionSummary) {
    const normalized = {
        tool: actionSummary.tool,
        resolvedVerb: actionSummary.resolvedVerb,
        resolvedCapability: actionSummary.resolvedCapability,
        targetSystem: actionSummary.resolvedTarget?.system ?? null,
        targetResourceType: actionSummary.resolvedTarget?.resourceType ?? null,
        targetScope: actionSummary.resolvedTarget?.resourceScope ?? null,
        externalFacing: actionSummary.resolvedTarget?.externalFacing ?? null,
        dataClasses: [...actionSummary.resolvedDataClasses].sort(),
        riskTier: actionSummary.resolvedRiskTier,
    };
    return sha256(canonicalize(normalized));
}
export function buildCCV(record, context) {
    const policyDecision = record.gateDecisions.find(d => d.gateId === GATE_ID.G04);
    return {
        meta: {
            blueprintVersion: BLUEPRINT_VERSION,
            runtimeContractVersion: SPEC_VERSION,
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
            delegationContextId: record.delegationContextSnapshot?.delegationId ?? null,
            chainDepth: record.delegationContextSnapshot?.chainDepth ?? null,
            chainHash: record.delegationContextSnapshot?.chainHash ?? null,
            maxRiskTier: record.delegationContextSnapshot?.maxRiskTier ?? null,
        },
        classification: {
            capabilityId: record.actionSummary.resolvedCapability ?? '',
            actionVerb: record.actionSummary.resolvedVerb ?? '',
            dataClasses: [...record.actionSummary.resolvedDataClasses].sort(),
            riskTier: record.actionSummary.resolvedRiskTier ?? '',
        },
        policyAndApproval: {
            policyRuleId: record.policyRuleId,
            outcomeLabel: record.policyOutcome,
            approvalRequired: record.approvalRequest !== null,
            approvalDecisionLabel: record.approvalResponse?.decision ?? null,
        },
        authorityAndExecution: {
            executionGrantId: record.grantMetadata?.grantId ?? null,
            credentialSubjectType: record.grantMetadata?.credentialSubjectType ?? null,
            scopeDescriptor: record.grantMetadata?.scopeDescriptor ?? null,
            expiryClass: record.grantMetadata?.expiryClass ?? null,
            grantTemplateFingerprint: record.grantMetadata?.templateFingerprint ?? null,
        },
        result: {
            finalOutcome: record.finalOutcome,
            errorCodeFamily: record.executionResult?.errorType ?? null,
        },
    };
}
export function areComparable(a, b) {
    return (a.meta.blueprintVersion === b.meta.blueprintVersion &&
        a.meta.runtimeContractVersion === b.meta.runtimeContractVersion &&
        a.meta.capabilityTaxonomyVersion === b.meta.capabilityTaxonomyVersion &&
        a.meta.comparisonInputVersion === b.meta.comparisonInputVersion &&
        a.identity.actorClass === b.identity.actorClass &&
        a.identity.environment === b.identity.environment &&
        a.classification.capabilityId === b.classification.capabilityId &&
        a.meta.normalizedActionHash === b.meta.normalizedActionHash);
}
