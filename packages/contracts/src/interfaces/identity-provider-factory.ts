/**
 * IdentityProviderFactory — spec §12.3.49 (audit B2)
 *
 * File: packages/contracts/src/interfaces/identity-provider-factory.ts
 *
 * Minimal acceptable shape so the four manifest loaders can resolve
 * factories at bootstrap. Domain-specific extension lives in
 * packages/identity-ref/.
 */
import type { NonEmpty } from '../types/index.js';
import type { IdentityProviderInterface } from './index.js';

export interface IdentityProviderFactory {
  /**
   * Discriminator string registered with IdentityProviderFactoryRegistry.
   * Manifest entries reference this string in `providerType`.
   */
  readonly providerType: NonEmpty;

  /**
   * Construct an IdentityProviderInterface from a manifest entry's
   * `configuration` object. The factory is responsible for validating
   * its own configuration shape and throwing a fail-closed startup
   * error if invalid.
   */
  create(configuration: Record<string, unknown>): Promise<IdentityProviderInterface>;
}
