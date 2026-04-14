/**
 * Delegation Engine — spec §21.1 + §21.2
 *
 * Mints root and sub-delegation DelegationContext objects.
 * Signs with the control-plane key via canonicalize() + sign().
 *
 * Law:
 *  - SOLVE-018: root delegation environment must equal actor.environment
 *  - SOLVE-020: mintedBy uses DELEGATION_ENGINE_ID constant; never hardcoded string
 *  - MODULAR-002: ActorClass is open string type — no closed union ceiling here
 *
 * Callers (CLI, API) must call delegationStore.save(dc) after minting.
 * This engine does NOT persist — it only mints and signs.
 */
import { DELEGATION_ENGINE_ID, riskTierExceeds, DelegationError, DelegationChainIntegrityError, } from '../types/index.js';
import { sign } from '../crypto/signer.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { uuid as newUuid, nowIso, addSeconds } from '../utils/time.js';
/**
 * Mint a root DelegationContext.
 * Validates:
 *  1. maxRiskTier does not exceed principal.maxDelegableRiskTier
 *  2. All allowedSystems ⊆ principal.allowedSystems
 *  3. environment === actor.environment (SOLVE-018 invariant)
 *
 * Signs the canonicalized body with the control-plane key.
 * Caller must save to DelegationStore.
 */
export async function mintRootDelegation(principal, actor, params) {
    // Principal authority ceiling check
    if (riskTierExceeds(params.maxRiskTier, principal.maxDelegableRiskTier)) {
        throw new DelegationError(`delegation_exceeds_principal_authority: requested maxRiskTier '${params.maxRiskTier}' ` +
            `exceeds principal ceiling '${principal.maxDelegableRiskTier}'`);
    }
    for (const sys of params.allowedSystems) {
        if (!principal.allowedSystems.includes(sys)) {
            throw new DelegationError(`system_not_in_principal_scope: ${sys}`);
        }
    }
    // SOLVE-018: environment invariant — root delegation env must equal actor.environment
    if (params.environment !== actor.environment) {
        throw new DelegationError(`delegation_environment_mismatch: delegation environment '${params.environment}' ` +
            `does not match actor environment '${actor.environment}'`);
    }
    const body = {
        delegationId: newUuid(),
        principalId: params.principalId,
        actorId: params.actorId,
        parentDelegationId: null,
        chainDepth: 0,
        maxChainDepth: params.maxChainDepth,
        allowedSystems: params.allowedSystems,
        allowedCapabilities: params.allowedCapabilities,
        forbiddenCapabilities: params.forbiddenCapabilities,
        maxRiskTier: params.maxRiskTier,
        allowDownstreamPropagation: params.allowDownstreamPropagation,
        environment: params.environment,
        mintedAt: nowIso(),
        expiresAt: params.expiresAt,
        mintedBy: DELEGATION_ENGINE_ID, // SOLVE-020: never hardcoded
    };
    const controlPlaneKey = await loadControlPlaneKey();
    const signature = await sign(canonicalize(body), controlPlaneKey);
    return { ...body, signature };
}
/**
 * Mint a sub-delegation from a parent DelegationContext.
 * Validates:
 *  - parentDelegation.allowDownstreamPropagation === true
 *  - sub maxRiskTier ≤ parent maxRiskTier
 *  - sub allowedSystems ⊆ parent allowedSystems
 *  - sub allowedCapabilities ⊆ parent allowedCapabilities
 *  - chainDepth + 1 ≤ maxChainDepth
 *  - parent exists in store (CHAIN_INTEGRITY_BROKEN guard)
 *
 * Sub-delegation inherits parent.environment — cannot change.
 * Caller must save to DelegationStore.
 */
export async function mintSubDelegation(parentDelegation, delegationStore, params) {
    // Guard: parent must be in store (chain integrity)
    const parentInStore = await delegationStore.getById(parentDelegation.delegationId);
    if (!parentInStore) {
        throw new DelegationChainIntegrityError(`chain_integrity_broken: parent delegation '${parentDelegation.delegationId}' not found in store`);
    }
    if (!parentDelegation.allowDownstreamPropagation) {
        throw new DelegationError(`downstream_propagation_not_permitted: parent delegation '${parentDelegation.delegationId}' ` +
            `does not allow downstream propagation`);
    }
    if (riskTierExceeds(params.maxRiskTier, parentDelegation.maxRiskTier)) {
        throw new DelegationError(`risk_tier_exceeds_delegation_ceiling: requested '${params.maxRiskTier}' ` +
            `exceeds parent ceiling '${parentDelegation.maxRiskTier}'`);
    }
    for (const sys of params.allowedSystems) {
        if (!parentDelegation.allowedSystems.includes(sys)) {
            throw new DelegationError(`system_not_in_delegation: ${sys}`);
        }
    }
    for (const cap of params.allowedCapabilities) {
        if (!parentDelegation.allowedCapabilities.includes(cap)) {
            throw new DelegationError(`capability_not_in_delegation: ${cap}`);
        }
    }
    const newChainDepth = parentDelegation.chainDepth + 1;
    if (newChainDepth > parentDelegation.maxChainDepth) {
        throw new DelegationError(`chain_depth_ceiling_exceeded: depth ${newChainDepth} exceeds max ${parentDelegation.maxChainDepth}`);
    }
    const mintedAt = nowIso();
    const expiresAt = addSeconds(mintedAt, params.ttlSeconds);
    const body = {
        delegationId: newUuid(),
        principalId: parentDelegation.principalId,
        actorId: params.actorId,
        parentDelegationId: parentDelegation.delegationId,
        chainDepth: newChainDepth,
        maxChainDepth: parentDelegation.maxChainDepth, // ceiling never increases
        allowedSystems: params.allowedSystems,
        allowedCapabilities: params.allowedCapabilities,
        forbiddenCapabilities: params.forbiddenCapabilities,
        maxRiskTier: params.maxRiskTier,
        allowDownstreamPropagation: params.allowDownstreamPropagation,
        environment: parentDelegation.environment, // inherited — cannot change
        mintedAt,
        expiresAt,
        mintedBy: DELEGATION_ENGINE_ID, // SOLVE-020
    };
    const controlPlaneKey = await loadControlPlaneKey();
    const signature = await sign(canonicalize(body), controlPlaneKey);
    return { ...body, signature };
}
