/**
 * Payload Resolver Registry — AMEND-spec §6.7.2
 *
 * File: packages/core/src/output/payload-resolver.ts
 * Layer 1 — resolves resultRef to bytes for digest verification.
 *
 * Law:
 * - OutputCollector must use the resolver registry before mailbox write.
 * - Missing resolver fails closed with payload_resolver_not_found.
 * - Digest mismatch fails closed with mailbox_digest_mismatch.
 * - Populated by bootstrap with only approved built-in/resolved factories.
 */
import type { PayloadResolver, NonEmpty, Sha256Hex } from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import { sha256Hex } from './output-digest.js';

export interface PayloadResolverRegistry {
  register(resolver: PayloadResolver): void;
  resolveBytes(resultRef: NonEmpty): Promise<Uint8Array>;
  verifyDigest(resultRef: NonEmpty, expected: Sha256Hex): Promise<boolean>;
}

export class PayloadResolverRegistryImpl implements PayloadResolverRegistry {
  private readonly resolvers: PayloadResolver[] = [];

  register(resolver: PayloadResolver): void {
    this.resolvers.push(resolver);
  }

  async resolveBytes(resultRef: NonEmpty): Promise<Uint8Array> {
    for (const resolver of this.resolvers) {
      if (resolver.canResolve(resultRef)) {
        return resolver.resolveBytes(resultRef);
      }
    }
    throw new Error(
      `${DENIAL_CODE.PAYLOAD_RESOLVER_NOT_FOUND}: no resolver for resultRef '${resultRef}'`
    );
  }

  async verifyDigest(resultRef: NonEmpty, expected: Sha256Hex): Promise<boolean> {
    const bytes = await this.resolveBytes(resultRef);
    const actual = sha256Hex(bytes);
    return actual === expected;
  }
}
