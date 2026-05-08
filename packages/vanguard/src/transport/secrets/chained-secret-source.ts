/**
 * ChainedSecretSource — beta1 admin onboarding (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC)
 *
 * File: packages/vanguard/src/transport/secrets/chained-secret-source.ts
 * Layer 3 — imports from @nexus/contracts only.
 *
 * Tries each backing SecretSource in order. First non-null resolver wins.
 *
 * Order (per spec §Part 6):
 *   1. FileSecretSource (keys/secrets.json) — handles 'file:KEY' refs
 *   2. EnvSecretSource (process.env)        — handles bare KEY refs
 *
 * Same SecretSource invariants:
 *   - canResolve: presence-only, no logging.
 *   - resolve: null → caller maps to NVG_TRANSPORT_AUTH_MISSING.
 *   - resolve: throw → caller maps to NVG_TRANSPORT_SECRET_SOURCE_ERROR.
 *
 * If a delegate throws on resolve, we surface that throw (fail-loud) so
 * the caller can map it to SECRET_SOURCE_ERROR. Throwing on canResolve
 * is treated as "this source can't resolve" and we move on — startup
 * must remain robust against a single backend hiccup that another
 * backend could cover.
 */
import type { SecretSource } from '@nexus/contracts';

export class ChainedSecretSource implements SecretSource {
  private readonly sources: readonly SecretSource[];

  constructor(sources: readonly SecretSource[]) {
    if (sources.length === 0) {
      throw new Error('ChainedSecretSource: at least one SecretSource required');
    }
    this.sources = sources;
  }

  async canResolve(secretRef: string): Promise<boolean> {
    for (const source of this.sources) {
      try {
        if (await source.canResolve(secretRef)) return true;
      } catch {
        // A single backend's failure must not blind the chain. Other
        // sources may still cover this secretRef.
      }
    }
    return false;
  }

  async resolve(secretRef: string): Promise<string | null> {
    for (const source of this.sources) {
      const value = await source.resolve(secretRef);
      if (value !== null && value.length > 0) return value;
    }
    return null;
  }
}
