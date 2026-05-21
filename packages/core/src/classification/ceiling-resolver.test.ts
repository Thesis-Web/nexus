/**
 * Ceiling Resolver Tests — spec §10.4, blueprint §7.3
 * Tests: resolveEffectiveCeiling, riskTierMin, intersect
 */
import { describe, it, expect } from 'vitest';
import { resolveEffectiveCeiling, riskTierMin, intersect } from './ceiling-resolver.js';
import { OCT_CEILINGS, EVIDENCE_SENTINEL, AXIS_NOT_CONSTRAINED } from '../types/index.js';
import type { CapabilityCeiling, OctCeiling } from '../types/index.js';

describe('Ceiling Resolver — spec §10.4', () => {
  // ── riskTierMin ───────────────────────────────────────────────────────

  it('riskTierMin returns lower risk tier', () => {
    expect(riskTierMin('low', 'critical')).toBe('low');
    expect(riskTierMin('critical', 'low')).toBe('low');
    expect(riskTierMin('medium', 'medium')).toBe('medium');
    expect(riskTierMin('high', 'medium')).toBe('medium');
  });

  // ── intersect ─────────────────────────────────────────────────────────

  it('intersect returns common elements', () => {
    expect(intersect(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual(['b', 'c']);
  });

  it('intersect with wildcard passes through other array', () => {
    expect(intersect(['*'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(intersect(['a', 'b'], ['*'])).toEqual(['a', 'b']);
  });

  it('intersect with empty returns empty', () => {
    expect(intersect(['a'], [])).toEqual([]);
    expect(intersect([], ['a'])).toEqual([]);
  });

  // ── resolveEffectiveCeiling ───────────────────────────────────────────

  it('resolveEffectiveCeiling: OCT-OPEN with medium identity ceiling', () => {
    const identity: CapabilityCeiling = {
      allowedSystems: ['stub'],
      allowedCapabilities: [AXIS_NOT_CONSTRAINED],
      maxRiskTier: 'medium',
    };
    const oct = OCT_CEILINGS['OCT-OPEN'] as OctCeiling;
    const eff = resolveEffectiveCeiling(identity, oct);
    expect(eff.maxRiskTier).toBe('medium'); // min(medium, medium) = medium
    expect(eff.allowedSystems).toEqual(['stub']); // intersect(['stub'], ['*']) = ['stub']
    expect(eff.modelTierCeiling.length).toBeGreaterThan(0);
  });

  it('resolveEffectiveCeiling: OCT-SECURE with high identity ceiling → OCT wins', () => {
    const identity: CapabilityCeiling = {
      allowedSystems: ['stub', 'vault'],
      allowedCapabilities: [AXIS_NOT_CONSTRAINED],
      maxRiskTier: 'critical',
    };
    const oct = OCT_CEILINGS['OCT-SECURE'] as OctCeiling;
    const eff = resolveEffectiveCeiling(identity, oct);
    expect(eff.maxRiskTier).toBe('critical'); // min(critical, critical) = critical
    expect(eff.modelTierCeiling).toEqual(['on_prem_sensitive']);
  });

  it('resolveEffectiveCeiling: identity ceiling more restrictive → identity wins', () => {
    const identity: CapabilityCeiling = {
      allowedSystems: ['stub'],
      allowedCapabilities: ['read:record:single'],
      maxRiskTier: 'low', // more restrictive than OCT-CONFIDENTIAL high
    };
    const oct = OCT_CEILINGS['OCT-CONFIDENTIAL'] as OctCeiling;
    const eff = resolveEffectiveCeiling(identity, oct);
    expect(eff.maxRiskTier).toBe('low'); // identity wins
  });

  it('resolveEffectiveCeiling: OCT-COMPILE uses identity maxRiskTier (defensive)', () => {
    const identity: CapabilityCeiling = {
      allowedSystems: ['stub'],
      allowedCapabilities: [AXIS_NOT_CONSTRAINED],
      maxRiskTier: 'medium',
    };
    const oct = OCT_CEILINGS['OCT-COMPILE'] as OctCeiling;
    const eff = resolveEffectiveCeiling(identity, oct);
    // OCT-COMPILE: sentinel → identity governs (moot — Gate 02 denies)
    expect(eff.maxRiskTier).toBe('medium');
    expect(eff.allowedSystems).toEqual([]); // intersect(['stub'], []) = []
  });
});
