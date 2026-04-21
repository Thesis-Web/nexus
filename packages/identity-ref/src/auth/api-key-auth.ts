/**
 * Reference Auth Provider — spec §32.2
 * API-key authentication for starter deployments.
 * Layer 6 internal — not exported to contracts.
 */
import type { AuthCredentials, NonEmpty } from '@nexus/contracts';

export interface ReferenceAuthProvider {
  validate(credentials: AuthCredentials): Promise<NonEmpty>;
}

/**
 * Simple API key auth: maps API keys to actor identifiers.
 * Sufficient for bootstrap. Not for production.
 */
export class ApiKeyAuthProvider implements ReferenceAuthProvider {
  private readonly keys = new Map<string, string>();

  registerKey(apiKey: string, actorIdentifier: string): void {
    this.keys.set(apiKey, actorIdentifier);
  }

  async validate(credentials: AuthCredentials): Promise<NonEmpty> {
    if (credentials.type !== 'api_key') {
      throw new Error('UNSUPPORTED_AUTH_TYPE: Reference Identity Adapter supports api_key only');
    }
    const actorId = this.keys.get(credentials.value);
    if (!actorId) {
      throw new Error('INVALID_API_KEY: key not registered');
    }
    return actorId as NonEmpty;
  }
}
