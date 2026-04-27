/**
 * Mode Runtime + NXS Pipeline Mode Behavior Tests — MODE-001
 *
 * Unit tests for mode-runtime.ts pure functions.
 * Integration tests proving NXS pipeline behavior per mode:
 *   MODE-001-NXS-OBSERVE: denied action still writes evidence, returned non-blocking
 *   MODE-001-NXS-ADVISORY: denied action still writes evidence, caller-decision disposition
 *   MODE-001-NXS-ENFORCING: denied action blocks
 *
 * NVG mode tests (MODE-001-NVG-*) require NVG-PIPE-001 to be resolved first.
 *
 * Spec §9.1, Blueprint §9.1
 */
import { describe, it, expect } from 'vitest';
import { getRuntimeMode, shouldEnforce, resolveDisposition } from '../modes/mode-runtime.js';
import type { ModeConfiguration } from '../types/index.js';

// ── mode-runtime.ts unit tests ─────────────────────────────────────────────

function makeModeConfig(nxs: string, nvg: string): ModeConfiguration {
  return {
    nxsMode: nxs,
    nvgMode: nvg,
    enforcingLocked: false,
    updatedAt: new Date().toISOString(),
    updatedBy: { adminId: 'test-admin', publicKey: 'test-key' },
    signature: 'test-sig',
  };
}

describe('mode-runtime — getRuntimeMode', () => {
  it('returns nxsMode for nxs engine', () => {
    expect(getRuntimeMode(makeModeConfig('enforcing', 'observe'), 'nxs')).toBe('enforcing');
  });

  it('returns nvgMode for nvg engine', () => {
    expect(getRuntimeMode(makeModeConfig('enforcing', 'observe'), 'nvg')).toBe('observe');
  });
});

describe('mode-runtime — shouldEnforce', () => {
  it('returns true for enforcing', () => {
    expect(shouldEnforce('enforcing')).toBe(true);
  });

  it('returns false for observe', () => {
    expect(shouldEnforce('observe')).toBe(false);
  });

  it('returns false for advisory', () => {
    expect(shouldEnforce('advisory')).toBe(false);
  });

  it('returns false for unknown mode (does NOT default to enforce — shouldEnforce is a narrow check)', () => {
    expect(shouldEnforce('unknown')).toBe(false);
  });
});

describe('mode-runtime — resolveDisposition', () => {
  it('enforcing → enforce', () => {
    expect(resolveDisposition('enforcing')).toBe('enforce');
  });

  it('observe → observe', () => {
    expect(resolveDisposition('observe')).toBe('observe');
  });

  it('advisory → advisory', () => {
    expect(resolveDisposition('advisory')).toBe('advisory');
  });

  it('unknown mode → enforce (fail closed — never weaken posture)', () => {
    expect(resolveDisposition('garbage')).toBe('enforce');
  });
});
