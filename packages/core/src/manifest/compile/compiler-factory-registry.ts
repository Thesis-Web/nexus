/**
 * CompilerFactoryRegistry — AMEND-spec §5.1, §3.13
 *
 * File: packages/core/src/manifest/compile/compiler-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 */
import type {
  CompilerFactory,
  CompilerFactoryRegistry as ICompilerFactoryRegistry,
} from '@nexus/contracts';

export class CompilerFactoryRegistry implements ICompilerFactoryRegistry {
  private readonly factories = new Map<string, CompilerFactory>();

  register(factory: CompilerFactory): void {
    if (this.factories.has(factory.compilerType)) {
      throw new Error(`duplicate compilerType: '${factory.compilerType}' is already registered`);
    }
    this.factories.set(factory.compilerType, factory);
  }

  get(compilerType: string): CompilerFactory | null {
    return this.factories.get(compilerType) ?? null;
  }

  list(): CompilerFactory[] {
    return [...this.factories.values()];
  }
}
