/**
 * capacity-tracker.test.ts — Phase 8 NVG endpoint concurrency tracking.
 *
 * Covers the in-process driver's acquire/release/getInflight semantics
 * + the default-cap behavior when maxConcurrentRequests is absent on a
 * manifest entry. Future RedisCapacityTracker tests will go under a
 * sibling suite and reuse the same shape.
 */
import { describe, it, expect } from 'vitest';
import { InProcessCapacityTracker, DEFAULT_MAX_CONCURRENT } from './capacity-tracker.js';

describe('InProcessCapacityTracker — acquire/release semantics', () => {
  it('acquires up to maxConcurrentRequests, then refuses', () => {
    const t = new InProcessCapacityTracker();
    const r1 = t.tryAcquire('ep-1', 2);
    expect(r1.acquired).toBe(true);
    expect(r1.currentInflight).toBe(1);
    expect(r1.maxConcurrent).toBe(2);
    const r2 = t.tryAcquire('ep-1', 2);
    expect(r2.acquired).toBe(true);
    expect(r2.currentInflight).toBe(2);
    // Now at capacity — next acquire refused.
    const r3 = t.tryAcquire('ep-1', 2);
    expect(r3.acquired).toBe(false);
    expect(r3.currentInflight).toBe(2);
    expect(r3.maxConcurrent).toBe(2);
  });

  it('release decrements; a released slot can be re-acquired', () => {
    const t = new InProcessCapacityTracker();
    expect(t.tryAcquire('ep-1', 1).acquired).toBe(true);
    expect(t.tryAcquire('ep-1', 1).acquired).toBe(false);
    t.release('ep-1');
    expect(t.getInflight('ep-1')).toBe(0);
    // Released slot is now available again.
    expect(t.tryAcquire('ep-1', 1).acquired).toBe(true);
  });

  it('release floors at zero (idempotent under spurious calls)', () => {
    const t = new InProcessCapacityTracker();
    // Releasing a never-acquired endpoint is a no-op, not a negative.
    t.release('ep-never-seen');
    t.release('ep-never-seen');
    expect(t.getInflight('ep-never-seen')).toBe(0);
    // One acquire then two releases — second release stays at zero.
    expect(t.tryAcquire('ep-1', 5).acquired).toBe(true);
    t.release('ep-1');
    t.release('ep-1');
    expect(t.getInflight('ep-1')).toBe(0);
  });

  it('isolates counters per endpointId', () => {
    const t = new InProcessCapacityTracker();
    expect(t.tryAcquire('ep-A', 1).acquired).toBe(true);
    // ep-A at cap; ep-B has its own counter at zero.
    expect(t.tryAcquire('ep-A', 1).acquired).toBe(false);
    expect(t.tryAcquire('ep-B', 1).acquired).toBe(true);
    expect(t.getInflight('ep-A')).toBe(1);
    expect(t.getInflight('ep-B')).toBe(1);
  });

  it('applies DEFAULT_MAX_CONCURRENT when maxConcurrentRequests is undefined', () => {
    const t = new InProcessCapacityTracker();
    // No explicit cap → defaults to 4 (DEFAULT_MAX_CONCURRENT).
    for (let i = 0; i < DEFAULT_MAX_CONCURRENT; i++) {
      const r = t.tryAcquire('ep-default', undefined);
      expect(r.acquired, `acquire #${i + 1} under default cap`).toBe(true);
      expect(r.maxConcurrent).toBe(DEFAULT_MAX_CONCURRENT);
    }
    // 5th attempt refused — default cap held.
    expect(t.tryAcquire('ep-default', undefined).acquired).toBe(false);
  });

  it('applies constructor-injected defaultMax override', () => {
    const t = new InProcessCapacityTracker({ defaultMax: 2 });
    expect(t.tryAcquire('ep-x', undefined).acquired).toBe(true);
    expect(t.tryAcquire('ep-x', undefined).acquired).toBe(true);
    // Third attempt refused — injected default of 2 wins.
    expect(t.tryAcquire('ep-x', undefined).acquired).toBe(false);
  });

  it('treats a zero or negative explicit cap as "use default"', () => {
    const t = new InProcessCapacityTracker({ defaultMax: 3 });
    // 0 and negative are nonsensical per the contract (z.number().positive()
    // at the manifest layer enforces > 0); the tracker is defensive and
    // falls back to the default rather than allowing infinite acquires.
    for (let i = 0; i < 3; i++) {
      expect(t.tryAcquire('ep-zero', 0).acquired).toBe(true);
    }
    expect(t.tryAcquire('ep-zero', 0).acquired).toBe(false);
  });
});
