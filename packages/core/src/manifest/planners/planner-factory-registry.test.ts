// packages/core/src/manifest/planners/planner-factory-registry.test.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.1 PlannerFactoryRegistry tests.

import { describe, expect, it } from 'vitest';
import type {
  OrchestratorManifestRecord,
  NonEmpty,
  Planner,
  PlannerFactory,
} from '@nexus/contracts';
import { PlannerFactoryRegistryImpl } from './planner-factory-registry.js';

class FakeFactory implements PlannerFactory {
  constructor(
    public readonly plannerType: NonEmpty,
    public readonly factoryVersion: NonEmpty = '0.1.0' as NonEmpty
  ) {}
  async create(_record: OrchestratorManifestRecord): Promise<Planner> {
    return {
      plannerType: this.plannerType,
      plannerVersion: '0.1.0' as NonEmpty,
      async plan() {
        throw new Error('fake');
      },
    };
  }
}

describe('PlannerFactoryRegistryImpl', () => {
  it('registers and retrieves a factory by plannerType', () => {
    const registry = new PlannerFactoryRegistryImpl();
    const factory = new FakeFactory('db-lexicon-transformer-v0' as NonEmpty);
    registry.register(factory);
    expect(registry.get('db-lexicon-transformer-v0')).toBe(factory);
  });

  it('returns null for unknown plannerType', () => {
    const registry = new PlannerFactoryRegistryImpl();
    expect(registry.get('does-not-exist')).toBeNull();
  });

  it('fails closed on duplicate registration for the same plannerType', () => {
    const registry = new PlannerFactoryRegistryImpl();
    registry.register(new FakeFactory('foo' as NonEmpty));
    expect(() => registry.register(new FakeFactory('foo' as NonEmpty))).toThrow(
      /already registered/
    );
  });

  it('lists all registered factories', () => {
    const registry = new PlannerFactoryRegistryImpl();
    registry.register(new FakeFactory('a' as NonEmpty));
    registry.register(new FakeFactory('b' as NonEmpty));
    expect(registry.list().length).toBe(2);
  });
});
