/**
 * ModelTransportAdapterRegistry — spec §12.3.41, §12.3.48
 *
 * File: packages/vanguard/src/transport/registry.ts
 * Layer 3 — imports from @nexus/contracts only.
 *
 * §12.3.48 behavior law:
 *   - Duplicate registration throws (invariant 1)
 *   - Unknown adapter returns null on get (invariant 2: loader fails closed)
 *   - Registration before manifest load — bootstrap order (invariant 3)
 *   - NOT hot-reloadable (invariant 4)
 */
import type {
  ModelTransportAdapter,
  ModelTransportAdapterRegistry as IModelTransportAdapterRegistry,
} from '@nexus/contracts';

export class ModelTransportAdapterRegistry implements IModelTransportAdapterRegistry {
  private readonly adapters = new Map<string, ModelTransportAdapter>();

  register(adapter: ModelTransportAdapter): void {
    if (this.adapters.has(adapter.adapterId)) {
      throw new Error(`duplicate adapterId: '${adapter.adapterId}' is already registered`);
    }
    this.adapters.set(adapter.adapterId, adapter);
  }

  get(adapterId: string): ModelTransportAdapter | null {
    return this.adapters.get(adapterId) ?? null;
  }

  list(): ModelTransportAdapter[] {
    return [...this.adapters.values()];
  }
}
