/**
 * Reference Principal Store — spec §32.2
 * Layer 6 internal type. Not exported to contracts.
 * In-memory store for starter deployments.
 */
import type { Uuid, Principal } from '@nexus/contracts';

export interface ReferencePrincipalStore {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<void>;
}

export class InMemoryPrincipalStore implements ReferencePrincipalStore {
  private readonly principals = new Map<string, Principal>();

  async get(principalId: Uuid): Promise<Principal | null> {
    return this.principals.get(principalId) ?? null;
  }

  async register(principal: Principal): Promise<void> {
    this.principals.set(principal.principalId, principal);
  }
}
