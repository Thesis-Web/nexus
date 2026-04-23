/**
 * Composite Auth Provider — BS-D2-008 Part A
 * Dispatches authentication to the correct provider based on credential type.
 * Layer 6 internal — not exported to contracts.
 *
 * Wraps ApiKeyAuthProvider and JwtAuthProvider behind a single
 * ReferenceAuthProvider interface so the ReferenceIdentityAdapter
 * constructor can accept one provider that handles all supported
 * credential types.
 *
 * Supported credential types:
 *   - 'api_key'     → ApiKeyAuthProvider
 *   - 'jwt'         → JwtAuthProvider
 *   - 'oauth_token' → not implemented (enterprise territory)
 *
 * Spec: §32.2 (reference auth providers)
 * Blueprint: §12 (identity law), §24.6 (identity provider is swappable)
 *
 * "Reference Identity Adapter — starter only.
 *  Not for production deployments with enterprise IAM or RBAC in place."
 */
import type { AuthCredentials, NonEmpty } from '@nexus/contracts';
import type { ReferenceAuthProvider } from './api-key.js';

export class CompositeAuthProvider implements ReferenceAuthProvider {
  private readonly providers = new Map<string, ReferenceAuthProvider>();

  /**
   * Register a provider for a specific credential type.
   * Only one provider per type. Last registration wins.
   */
  registerProvider(credentialType: AuthCredentials['type'], provider: ReferenceAuthProvider): void {
    this.providers.set(credentialType, provider);
  }

  async validate(credentials: AuthCredentials): Promise<NonEmpty> {
    const provider = this.providers.get(credentials.type);
    if (!provider) {
      throw new Error(
        `UNSUPPORTED_AUTH_TYPE: no provider registered for credential type '${credentials.type}'`
      );
    }
    return provider.validate(credentials);
  }
}
