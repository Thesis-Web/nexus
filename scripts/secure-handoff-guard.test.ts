/**
 * Unit tests for the secure_agent_handoff slot-read guard.
 */
import { describe, it, expect } from 'vitest';
import { checkSecureHandoffSlotRead, octRank } from './secure-handoff-guard.js';

describe('octRank', () => {
  it('ranks the canonical OCT levels as OPEN < CONFIDENTIAL < SECURE', () => {
    expect(octRank('OCT-OPEN')).toBeLessThan(octRank('OCT-CONFIDENTIAL'));
    expect(octRank('OCT-CONFIDENTIAL')).toBeLessThan(octRank('OCT-SECURE'));
  });

  it('returns 0 for null, undefined, OCT-COMPILE, and unknown strings', () => {
    expect(octRank(null)).toBe(0);
    expect(octRank(undefined)).toBe(0);
    expect(octRank('OCT-COMPILE')).toBe(0);
    expect(octRank('NOT-A-REAL-LEVEL')).toBe(0);
  });
});

describe('checkSecureHandoffSlotRead', () => {
  it('allows reads where downstream clearance equals upstream classification', () => {
    const r = checkSecureHandoffSlotRead('OCT-SECURE', 'OCT-SECURE', 'reader', 'state');
    expect(r.allowed).toBe(true);
    expect(r.denyReason).toBeUndefined();
  });

  it('allows reads where downstream clearance exceeds upstream classification', () => {
    expect(checkSecureHandoffSlotRead('OCT-SECURE', 'OCT-CONFIDENTIAL', 'r', 's').allowed).toBe(
      true
    );
    expect(checkSecureHandoffSlotRead('OCT-SECURE', 'OCT-OPEN', 'r', 's').allowed).toBe(true);
    expect(checkSecureHandoffSlotRead('OCT-CONFIDENTIAL', 'OCT-OPEN', 'r', 's').allowed).toBe(true);
  });

  it('denies reads where downstream clearance is lower than upstream classification', () => {
    const r = checkSecureHandoffSlotRead('OCT-OPEN', 'OCT-SECURE', 'reader', 'state');
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toMatch(/secure_handoff_oct_mismatch/);
    expect(r.denyReason).toMatch(/OCT-OPEN/);
    expect(r.denyReason).toMatch(/OCT-SECURE/);
    expect(r.denyReason).toMatch(/reader\.state/);
  });

  it('denies when downstream octLevel is null and upstream is classified', () => {
    const r = checkSecureHandoffSlotRead(null, 'OCT-SECURE', 'reader', 'state');
    expect(r.allowed).toBe(false);
    expect(r.denyReason).toMatch(/<none>/);
  });

  it('denies when downstream is OCT-COMPILE (it is not a clearance)', () => {
    const r = checkSecureHandoffSlotRead('OCT-COMPILE', 'OCT-OPEN', 'r', 's');
    expect(r.allowed).toBe(false);
  });

  it('allows when both are null/unknown (rank 0 vs 0)', () => {
    // Defensive: a fresh demo with un-classified items should not fail
    // closed at the guard — failure should come from a real OCT level
    // mismatch, not the absence of one.
    const r = checkSecureHandoffSlotRead(null, 'NOT-CLASSIFIED', 'r', 's');
    expect(r.allowed).toBe(true);
  });
});
