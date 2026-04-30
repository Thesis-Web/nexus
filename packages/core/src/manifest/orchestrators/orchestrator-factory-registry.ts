/**
 * OrchestratorFactoryRegistry — AMEND-spec §5.1, §3.13
 *
 * File: packages/core/src/manifest/orchestrators/orchestrator-factory-registry.ts
 * Layer 1 — imports from @nexus/contracts only.
 */
import type {
  OrchestratorFactory,
  OrchestratorFactoryRegistry as IOrchestratorFactoryRegistry,
} from '@nexus/contracts';

export class OrchestratorFactoryRegistry implements IOrchestratorFactoryRegistry {
  private readonly factories = new Map<string, OrchestratorFactory>();

  register(factory: OrchestratorFactory): void {
    if (this.factories.has(factory.orchestratorType)) {
      throw new Error(
        `duplicate orchestratorType: '${factory.orchestratorType}' is already registered`
      );
    }
    this.factories.set(factory.orchestratorType, factory);
  }

  get(orchestratorType: string): OrchestratorFactory | null {
    return this.factories.get(orchestratorType) ?? null;
  }

  list(): OrchestratorFactory[] {
    return [...this.factories.values()];
  }
}
