/**
 * ConnectorFactoryRegistry — spec §12.3.46, §12.3.48
 *
 * File: packages/core/src/manifest/connectors/connector-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 *
 * §12.3.48 behavior law:
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown connectorType returns null on get (invariant 2: loader fails closed)
 *   - Registration before manifest load — bootstrap order (invariant 3)
 *   - NOT hot-reloadable (invariant 4)
 */
import type {
  ConnectorFactory,
  ConnectorFactoryRegistry as IConnectorFactoryRegistry,
} from '@nexus/contracts';

export class ConnectorFactoryRegistry implements IConnectorFactoryRegistry {
  private readonly factories = new Map<string, ConnectorFactory>();

  register(factory: ConnectorFactory): void {
    if (this.factories.has(factory.connectorType)) {
      throw new Error(`duplicate connectorType: '${factory.connectorType}' is already registered`);
    }
    this.factories.set(factory.connectorType, factory);
  }

  get(connectorType: string): ConnectorFactory | null {
    return this.factories.get(connectorType) ?? null;
  }

  list(): ConnectorFactory[] {
    return [...this.factories.values()];
  }
}
