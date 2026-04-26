/**
 * Transport & Factory Registries — spec §12.3.41, §12.3.42, §12.3.45–§12.3.48
 *
 * File: packages/contracts/src/interfaces/transport-registries.ts
 *
 * §12.3.48 shared factory-registry behavior law:
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown manifest type fails closed at loader (invariant 2)
 *   - Registration before manifest load — bootstrap order (invariant 3)
 *   - NOT hot-reloadable (invariant 4)
 */
import type { ModelTransportAdapter } from './transport-adapter.js';
import type { SecretSource } from './secret-source.js';
import type { IdentityProviderFactory } from './identity-provider-factory.js';
import type { ConnectorFactory } from './connector-factory.js';
import type { ApprovalChannelFactory } from './approval-channel-factory.js';

// ─── §12.3.41 ModelTransportAdapterRegistry ───
/**
 * Registry of transport adapters by adapterId.
 * Follows §12.3.48 behavior law: duplicate throws, unknown fails closed,
 * register before manifest load, not hot-reloadable.
 */
export interface ModelTransportAdapterRegistry {
  register(adapter: ModelTransportAdapter): void;
  get(adapterId: string): ModelTransportAdapter | null;
  list(): ModelTransportAdapter[];
}

// ─── §12.3.42 NvgTransportContext ───
/**
 * Grouped DI for transport dependencies (DIFF-S9-001).
 * Injected into NvgService at construction time. Module-level singleton
 * or globally-mutated transport state is a build violation (§30).
 */
export interface NvgTransportContext {
  readonly registry: ModelTransportAdapterRegistry;
  readonly secretSource: SecretSource;
}

// ─── §12.3.45 IdentityProviderFactoryRegistry ───
export interface IdentityProviderFactoryRegistry {
  register(factory: IdentityProviderFactory): void;
  get(providerType: string): IdentityProviderFactory | null;
  list(): IdentityProviderFactory[];
}

// ─── §12.3.46 ConnectorFactoryRegistry ───
export interface ConnectorFactoryRegistry {
  register(factory: ConnectorFactory): void;
  get(connectorType: string): ConnectorFactory | null;
  list(): ConnectorFactory[];
}

// ─── §12.3.47 ApprovalChannelFactoryRegistry ───
export interface ApprovalChannelFactoryRegistry {
  register(factory: ApprovalChannelFactory): void;
  get(channelType: string): ApprovalChannelFactory | null;
  list(): ApprovalChannelFactory[];
}
