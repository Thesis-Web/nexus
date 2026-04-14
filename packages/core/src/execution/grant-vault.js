/**
 * Grant vault — spec §17
 * WeakMap in-memory secret store. Secret never leaves this module.
 * clearGrantSecret() called in Gate 06 finally — always, even on NexusSecurityViolation.
 *
 * CONTRA-601 FIXED: assertGrantPresent throws BROAD_TOKEN_BYPASS (spec §17.4)
 * CONTRA-602 FIXED: getGrantSecret returns string | undefined (spec §17.5)
 */
import { NexusSecurityViolation, DENIAL_CODE } from '../types/index.js';
const grantSecrets = new WeakMap();
const grantRefs = new Map();
function getRef(grant) {
    let ref = grantRefs.get(grant.grantId);
    if (!ref) {
        ref = { grantId: grant.grantId };
        grantRefs.set(grant.grantId, ref);
    }
    return ref;
}
export function setGrantSecret(grant, secretValue) {
    grantSecrets.set(getRef(grant), secretValue);
}
// CONTRA-602 FIX: returns string | undefined — does not throw (spec §17.5)
export function getGrantSecret(grant) {
    const ref = grantRefs.get(grant.grantId);
    return ref ? grantSecrets.get(ref) : undefined;
}
export function clearGrantSecret(grant) {
    const ref = grantRefs.get(grant.grantId);
    if (ref) {
        grantSecrets.delete(ref);
        grantRefs.delete(grant.grantId);
    }
}
// CONTRA-601 FIX: missing/absent grant secret = bypass attempt = BROAD_TOKEN_BYPASS (spec §17.4)
export function assertGrantPresent(grant) {
    const ref = grantRefs.get(grant.grantId);
    const secret = ref ? grantSecrets.get(ref) : undefined;
    if (!secret) {
        throw new NexusSecurityViolation('grant secret absent — execution without valid grant is a bypass attempt', DENIAL_CODE.BROAD_TOKEN_BYPASS);
    }
}
export function assertGrantNotExpired(grant) {
    if (new Date(grant.expiresAt) <= new Date()) {
        throw new NexusSecurityViolation(`grant ${grant.grantId} expired at ${grant.expiresAt}`, DENIAL_CODE.GRANT_EXPIRED);
    }
}
