/**
 * Reference Identity Adapter — spec §32.3, §10.2
 * Implements IdentityProviderInterface from Layer 2 contracts.
 *
 * "Reference Identity Adapter — starter only.
 *  Not for production deployments with enterprise IAM or RBAC in place."
 *
 * Layer 6 — imports from @nexus/contracts (Layer 2) ONLY.
 */
import type {
  IdentityProviderInterface,
  IdentityClaims,
  AuthCredentials,
  NonEmpty,
} from '@nexus/contracts';
import type { ReferenceActorStore } from './actor-store.js';
import type { ReferencePrincipalStore } from './principal-store.js';
import type { ReferenceAuthProvider } from './auth/api-key.js';

export class ReferenceIdentityAdapter implements IdentityProviderInterface {
  readonly providerType = 'reference_adapter' as const;
  readonly providerVersion = 'v1.0.0' as NonEmpty;

  constructor(
    private readonly actorStore: ReferenceActorStore,
    private readonly principalStore: ReferencePrincipalStore,
    private readonly authProvider: ReferenceAuthProvider
  ) {}

  async resolveIdentity(actorIdentifier: NonEmpty): Promise<IdentityClaims | null> {
    const actor = await this.actorStore.get(actorIdentifier);
    if (!actor) return null;

    const principal = await this.principalStore.get(actor.principalId);
    if (!principal) return null;

    return {
      principalIdentity: principal.principalId as NonEmpty,
      roleAssignments: (actor.roles ?? []) as NonEmpty[],
      capabilityCeilings: [
        {
          allowedSystems: actor.allowedSystems,
          allowedCapabilities: actor.allowedCapabilities ?? [],
          maxRiskTier: actor.riskCeiling,
        },
      ],
      environmentContext: actor.environment,
      actorClass: actor.actorClass,
    };
  }

  async authenticate(credentials: AuthCredentials): Promise<NonEmpty> {
    return this.authProvider.validate(credentials);
  }
}
