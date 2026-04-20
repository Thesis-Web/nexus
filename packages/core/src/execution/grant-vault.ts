/**
 * Grant vault — spec §17
 * WeakMap in-memory secret store. Secret never leaves this module.
 * clearGrantSecret() called in Gate 06 finally — always, even on NexusSecurityViolation.
 *
 * CONTRA-601 FIXED: assertGrantPresent throws BROAD_TOKEN_BYPASS (spec §17.4)
 * CONTRA-602 FIXED: getGrantSecret returns string | undefined (spec §17.5)
 *
 * SOLVE-S6-001: GrantVaultImpl implements GrantVault interface from contracts.
 * Connectors receive the interface via DI from Gate 06 — they never import this file.
 * Standalone functions are kept for core-internal use (Gate 06 finally block, etc.).
 */
import {
  NexusSecurityViolation,
  DENIAL_CODE,
  type ExecutionGrant,
  type GrantVault,
} from '../types/index.js';

const grantSecrets = new WeakMap<object, string>();
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

// CONTRA-602 FIX: returns string | undefined — does not throw (spec §17.5)
export function getGrantSecret(grant: ExecutionGrant): string | undefined {
  const ref = grantRefs.get(grant.grantId);
  return ref ? grantSecrets.get(ref) : undefined;
}

export function clearGrantSecret(grant: ExecutionGrant): void {
  const ref = grantRefs.get(grant.grantId);
  if (ref) {
    grantSecrets.delete(ref);
    grantRefs.delete(grant.grantId);
  }
}

// CONTRA-601 FIX: missing/absent grant secret = bypass attempt = BROAD_TOKEN_BYPASS (spec §17.4)
export function assertGrantPresent(grant: ExecutionGrant): void {
  const ref = grantRefs.get(grant.grantId);
  const secret = ref ? grantSecrets.get(ref) : undefined;
  if (!secret) {
    throw new NexusSecurityViolation(
      DENIAL_CODE.BROAD_TOKEN_BYPASS,
      'grant secret absent — execution without valid grant is a bypass attempt'
    );
  }
}

export function assertGrantNotExpired(grant: ExecutionGrant): void {
  if (new Date(grant.expiresAt) <= new Date()) {
    throw new NexusSecurityViolation(
      DENIAL_CODE.GRANT_EXPIRED,
      `grant ${grant.grantId} expired at ${grant.expiresAt}`
    );
  }
}

/**
 * GrantVaultImpl — implements GrantVault interface from contracts (Layer 2).
 * Delegates to the module-level WeakMap singleton.
 * Singleton instance exported as `grantVault` for DI into Gate 06 → connectors.
 */
export class GrantVaultImpl implements GrantVault {
  setSecret(grant: ExecutionGrant, secret: string): void {
    setGrantSecret(grant, secret);
  }
  getSecret(grant: ExecutionGrant): string | undefined {
    return getGrantSecret(grant);
  }
  clearSecret(grant: ExecutionGrant): void {
    clearGrantSecret(grant);
  }
  assertPresent(grant: ExecutionGrant): void {
    assertGrantPresent(grant);
  }
  assertNotExpired(grant: ExecutionGrant): void {
    assertGrantNotExpired(grant);
  }
}

/** Singleton GrantVault instance — injected into connectors by Gate 06 */
export const grantVault: GrantVault = new GrantVaultImpl();
