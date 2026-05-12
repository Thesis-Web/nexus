// packages/core/src/manifest/planners/planner-factory-registry.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.1, log ADD-PLANNER-LEXICON-002.
//
// Concrete `PlannerFactoryRegistry` implementation. The interface in
// `packages/contracts/src/externals/factory-registries.ts` has existed
// unused since the externals refactor; V1 ships the real one.
//
// Bootstrap step 17b constructs an instance; step 18a (after fixture
// load) calls `register()` with the resolved factory; step 22c uses
// `get(plannerType)` to resolve the active planner from the
// orchestrator manifest. Missing factory → fail-closed per
// `factories.ts` law.

import type { PlannerFactory, PlannerFactoryRegistry } from '@nexus/contracts';

export class PlannerFactoryRegistryImpl implements PlannerFactoryRegistry {
  private readonly factories: Map<string, PlannerFactory> = new Map();

  register(factory: PlannerFactory): void {
    if (this.factories.has(factory.plannerType)) {
      throw new Error(
        `PlannerFactoryRegistry: factory already registered for plannerType '${factory.plannerType}'`
      );
    }
    this.factories.set(factory.plannerType, factory);
  }

  get(plannerType: string): PlannerFactory | null {
    return this.factories.get(plannerType) ?? null;
  }

  list(): PlannerFactory[] {
    return [...this.factories.values()];
  }
}
