import { describe, it, expect } from 'vitest';
import { InMemoryInfraRunIdNamespace } from './infra-run-id-namespace.js';

describe('InMemoryInfraRunIdNamespace (Q13 / F4.13)', () => {
  it('returns infra-YYYY-MM-DD-NNNN format', () => {
    const ns = new InMemoryInfraRunIdNamespace({ clock: () => new Date('2026-05-20T00:00:00Z') });
    const id = ns.next();
    expect(id).toMatch(/^infra-2026-05-20-\d{4}$/);
  });

  it('monotonically increments seq within a day', () => {
    const ns = new InMemoryInfraRunIdNamespace({ clock: () => new Date('2026-05-20T01:00:00Z') });
    const a = ns.next();
    const b = ns.next();
    const c = ns.next();
    expect(a).toBe('infra-2026-05-20-0001');
    expect(b).toBe('infra-2026-05-20-0002');
    expect(c).toBe('infra-2026-05-20-0003');
  });

  it('resets seq when the day rolls over', () => {
    let now = new Date('2026-05-20T23:59:59Z');
    const ns = new InMemoryInfraRunIdNamespace({ clock: () => now });
    expect(ns.next()).toBe('infra-2026-05-20-0001');
    expect(ns.next()).toBe('infra-2026-05-20-0002');
    now = new Date('2026-05-21T00:00:00Z');
    expect(ns.next()).toBe('infra-2026-05-21-0001');
  });
});
