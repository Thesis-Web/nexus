/**
 * Grant vault — spec §17
 * WeakMap in-memory secret store. Secret never leaves this module.
 * clearGrantSecret() called in Gate 06 finally — always, even on NexusSecurityViolation.
 *
 * CONTRA-601 FIXED: assertGrantPresent throws BROAD_TOKEN_BYPASS (spec §17.4)
 * CONTRA-602 FIXED: getGrantSecret returns string | undefined (spec §17.5)
 *
 * GRANT-SECRET-002 FIXED: grantRefs no longer retains completed/expired grants
 * indefinitely. Entries track expiresAt and are pruned lazily on new grant creation
 * and explicitly via pruneExpiredGrants(). clearGrantSecret() removes the entry
 * deterministically after execute/finally cleanup.
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

// ── Grant Lifecycle Tracking ────────────────────────────────────────────────

/** Internal ref entry with expiry metadata for lifecycle tracking. */
interface GrantEntry {
  /** WeakMap key — the only strong reference to the secret holder. */
  ref: object;
  /** ISO timestamp — grants past this time are prunable. */
  expiresAt: string;
}

const grantSecrets = new WeakMap<object, string>();
const grantRefs = new Map<string, GrantEntry>();

function getRef(grant: ExecutionGrant): object {
  let entry = grantRefs.get(grant.grantId);
  if (!entry) {
    entry = { ref: { grantId: grant.grantId }, expiresAt: grant.expiresAt };
    grantRefs.set(grant.grantId, entry);
  }
  return entry.ref;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function setGrantSecret(
  grant: ExecutionGrant,
  secretValue: string,
): void {
  // GRANT-SECRET-002: lazy prune before adding — prevents unbounded growth
  pruneExpiredGrants();
  grantSecrets.set(getRef(grant), secretValue);
}

// CONTRA-602 FIX: returns string | undefined — does not throw (spec §17.5)
export function getGrantSecret(
  grant: ExecutionGrant,
): string | undefined {
  const entry = grantRefs.get(grant.grantId);
  return entry ? grantSecrets.get(entry.ref) : undefined;
}

export function clearGrantSecret(grant: ExecutionGrant): void {
  const entry = grantRefs.get(grant.grantId);
  if (entry) {
    grantSecrets.delete(entry.ref);
    grantRefs.delete(grant.grantId);
  }
}

// CONTRA-601 FIX: missing/absent grant secret = bypass attempt = BROAD_TOKEN_BYPASS (spec §17.4)
export function assertGrantPresent(grant: ExecutionGrant): void {
  const entry = grantRefs.get(grant.grantId);
  const secret = entry ? grantSecrets.get(entry.ref) : undefined;
  if (!secret) {
    throw new NexusSecurityViolation(
      DENIAL_CODE.BROAD_TOKEN_BYPASS,
      'grant secret absent — execution without valid grant is a bypass attempt',
    );
  }
}

export function assertGrantNotExpired(grant: ExecutionGrant): void {
  if (new Date(grant.expiresAt) <= new Date()) {
    throw new NexusSecurityViolation(
      DENIAL_CODE.GRANT_EXPIRED,
      `grant ${grant.grantId} expired at ${grant.expiresAt}`,
    );
  }
}

// ── GRANT-SECRET-002: Lifecycle Cleanup ─────────────────────────────────────

/**
 * Prune all expired grant entries from the tracking map.
 * Called lazily from setGrantSecret and explicitly by infrastructure.
 * Returns the number of entries pruned.
 */
export function pruneExpiredGrants(): number {
  const now = Date.now();
  let pruned = 0;
  for (const [grantId, entry] of grantRefs) {
    if (new Date(entry.expiresAt).getTime() <= now) {
      grantSecrets.delete(entry.ref);
      grantRefs.delete(grantId);
      pruned++;
    }
  }
  return pruned;
}

/**
 * Return the number of active (tracked) grants.
 * Diagnostic/observability — used by tests and health checks.
 * Does NOT expose grant data.
 */
export function getActiveGrantCount(): number {
  return grantRefs.size;
}

// ── GrantVaultImpl ──────────────────────────────────────────────────────────

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
  /** Infrastructure lifecycle — prune expired grants. Not on GrantVault interface. */
  pruneExpired(): number {
    return pruneExpiredGrants();
  }
  /** Diagnostic — active grant count. Not on GrantVault interface. */
  activeCount(): number {
    return getActiveGrantCount();
  }
}

/** Singleton GrantVault instance — injected into connectors by Gate 06 */
export const grantVault: GrantVault = new GrantVaultImpl();
