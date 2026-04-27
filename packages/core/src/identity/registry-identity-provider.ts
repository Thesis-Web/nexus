/**
 * RegistryBackedIdentityProvider — IDENTITY-001/002 hardening
 *
 * Composition-root helper: wraps the existing ActorRegistry + PrincipalRegistry
 * (Layer 2 contracts) into an IdentityProviderInterface implementation.
 *
 * This is NOT a replacement for ReferenceIdentityAdapter (identity-ref, Layer 6)
 * or enterprise IAM/RBAC. It is a bootstrap convenience so that every IdentityGate
 * construction site has a real, non-optional provider without cross-layer imports.
 *
 * allowedCapabilities: returned as ['*'] because the Actor type does not carry
 * per-actor capability restrictions. This is an explicit provider decision — NOT
 * a gate-level fallback. Enterprise IAM/RBAC providers return scoped capabilities.
 *
 * Layer 1 — imports from Layer 2 (@nexus/contracts) only.
 * Spec: §10.2 (IdentityProviderInterface), §32.1 (three valid sources)
 * Blueprint: §7.1–§7.3 (five required claims)
 */
import type {
  IdentityProviderInterface,
  IdentityClaims,
  AuthCredentials,
  ActorRegistry,
  PrincipalRegistry,
  NonEmpty,
  CapabilityCeiling,
} from '@nexus/contracts';

export class RegistryBackedIdentityProvider implements IdentityProviderInterface {
  readonly providerType = 'reference_adapter' as const;
  readonly providerVersion = 'v1.0.0' as NonEmpty;

  constructor(
    private readonly actorRegistry: ActorRegistry,
    private readonly principalRegistry: PrincipalRegistry
  ) {}

  async resolveIdentity(actorIdentifier: NonEmpty): Promise<IdentityClaims | null> {
    const actor = await this.actorRegistry.get(actorIdentifier);
    if (!actor) return null;

    const principal = await this.principalRegistry.get(actor.principalId);
    if (!principal) return null;

    const ceiling: CapabilityCeiling = {
      allowedSystems: actor.allowedSystems,
      allowedCapabilities: ['*'], // explicit provider decision — Actor type has no capability field
      maxRiskTier: actor.riskCeiling,
    };

    return {
      principalIdentity: principal.principalId as NonEmpty,
      roleAssignments: [], // Actor type does not carry roles — enterprise IAM/RBAC provides these
      capabilityCeilings: [ceiling],
      environmentContext: actor.environment,
      actorClass: actor.actorClass,
    };
  }

  async authenticate(_credentials: AuthCredentials): Promise<NonEmpty> {
    throw new Error(
      'RegistryBackedIdentityProvider does not support authentication. ' +
        'Use ReferenceIdentityAdapter (identity-ref) or enterprise IAM/RBAC.'
    );
  }
}
