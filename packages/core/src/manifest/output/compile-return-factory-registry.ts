/**
 * CompileReturnTransportFactoryRegistry — AMEND-spec §5.1, §3.13
 *
 * File: packages/core/src/manifest/output/compile-return-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 */
import type {
  CompileReturnTransportFactory,
  CompileReturnTransportFactoryRegistry as ICompileReturnTransportFactoryRegistry,
} from '@nexus/contracts';

export class CompileReturnTransportFactoryRegistry implements ICompileReturnTransportFactoryRegistry {
  private readonly factories = new Map<string, CompileReturnTransportFactory>();

  register(factory: CompileReturnTransportFactory): void {
    if (this.factories.has(factory.endpointType)) {
      throw new Error(`duplicate endpointType: '${factory.endpointType}' is already registered`);
    }
    this.factories.set(factory.endpointType, factory);
  }

  get(endpointType: string): CompileReturnTransportFactory | null {
    return this.factories.get(endpointType) ?? null;
  }

  list(): CompileReturnTransportFactory[] {
    return [...this.factories.values()];
  }
}
