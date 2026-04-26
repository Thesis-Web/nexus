/**
 * IdentityProviderFactoryRegistry — spec §12.3.45, §12.3.48
 *
 * File: packages/core/src/manifest/identity/identity-provider-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 *
 * §12.3.48 behavior law:
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown providerType returns null on get (invariant 2: loader fails closed)
 *   - Registration before manifest load — bootstrap order (invariant 3)
 *   - NOT hot-reloadable (invariant 4)
 */
import type {
  IdentityProviderFactory,
  IdentityProviderFactoryRegistry as IIdentityProviderFactoryRegistry,
} from '@nexus/contracts';

export class IdentityProviderFactoryRegistry implements IIdentityProviderFactoryRegistry {
  private readonly factories = new Map<string, IdentityProviderFactory>();

  register(factory: IdentityProviderFactory): void {
    if (this.factories.has(factory.providerType)) {
      throw new Error(`duplicate providerType: '${factory.providerType}' is already registered`);
    }
    this.factories.set(factory.providerType, factory);
  }

  get(providerType: string): IdentityProviderFactory | null {
    return this.factories.get(providerType) ?? null;
  }

  list(): IdentityProviderFactory[] {
    return [...this.factories.values()];
  }
}
