/**
 * Grant vault — spec §17
 * WeakMap in-memory secret store. Secret never leaves this module.
 * clearGrantSecret() called in Gate 06 finally — always, even on NexusSecurityViolation.
 *
 * Blueprint drift prevention: "do not let grant secrets leave the grant vault"
 */
import { NexusSecurityViolation, DENIAL_CODE, type ExecutionGrant } from '../types/index.js';

const grantSecrets = new WeakMap<object, string>();

// Stable object references per grantId — needed for WeakMap key
const grantRefs = new Map<string, object>();

function getRef(grant: ExecutionGrant): object {
  let ref = grantRefs.get(grant.grantId);
  if (!ref) {
    ref = { grantId: grant.grantId };
    grantRefs.set(grant.grantId, ref);
  }
  return ref;
}

export function setGrantSecret(grant: ExecutionGrant, secretValue: string): void {
  grantSecrets.set(getRef(grant), secretValue);
}

export function getGrantSecret(grant: ExecutionGrant): string {
  const secret = grantSecrets.get(getRef(grant));
  if (!secret) {
    throw new NexusSecurityViolation(
      'grant secret not present in vault — redeemGrant() must be called before execute()',
      DENIAL_CODE.GRANT_EXPIRED
    );
  }
  return secret;
}

export function clearGrantSecret(grant: ExecutionGrant): void {
  const ref = grantRefs.get(grant.grantId);
  if (ref) {
    grantSecrets.delete(ref);
    grantRefs.delete(grant.grantId);
  }
}

export function assertGrantPresent(grant: ExecutionGrant): void {
  const ref = grantRefs.get(grant.grantId);
  const secret = ref ? grantSecrets.get(ref) : undefined;
  if (!secret) {
    throw new NexusSecurityViolation(
      'grant secret absent — assertGrantPresent failed',
      DENIAL_CODE.GRANT_EXPIRED
    );
  }
}

export function assertGrantNotExpired(grant: ExecutionGrant): void {
  if (new Date(grant.expiresAt) <= new Date()) {
    throw new NexusSecurityViolation(
      `grant ${grant.grantId} expired at ${grant.expiresAt}`,
      DENIAL_CODE.GRANT_EXPIRED
    );
  }
}
