/**
 * NVG Threat Test 13 — OCT Ceiling Violation
 * Spec §38.3 item 3: OCT-SECURE actor requesting frontier → denied
 *
 * OCT-SECURE permits only on_prem_sensitive tier.
 * Any request from an OCT-SECURE actor to any frontier tier must be denied
 * with NVG_OCT_CEILING_DENIED, even if the data is not sensitive.
 */
import { describe, it, expect } from 'vitest';
import { classifyOutboundData } from './classifier/data-classifier.js';
import { enforceOctModelCeiling } from './classifier/ceiling-enforcer.js';
import { MODEL_TIER, OCT_LEVEL, DATA_CLASS, DENIAL_CODE, type DataLabel } from '@nexus/contracts';

describe('NVG Threat: OCT-SECURE Ceiling Denial (§38.3)', () => {
  const publicClassification = classifyOutboundData([
    { source: 'dlp', label: DATA_CLASS.PUBLIC, confidence: 0.95 } as DataLabel,
  ]);

  it('OCT-SECURE denies frontier_general even with public data', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.SECURE,
      MODEL_TIER.FRONTIER_GENERAL,
      publicClassification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
  });

  it('OCT-SECURE denies frontier_reasoning', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.SECURE,
      MODEL_TIER.FRONTIER_REASONING,
      publicClassification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
  });

  it('OCT-SECURE denies frontier_live', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.SECURE,
      MODEL_TIER.FRONTIER_LIVE,
      publicClassification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
  });

  it('OCT-SECURE denies on_prem_general (only on_prem_sensitive allowed)', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.SECURE,
      MODEL_TIER.ON_PREM_GENERAL,
      publicClassification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
  });

  it('OCT-SECURE allows on_prem_sensitive with public data', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.SECURE,
      MODEL_TIER.ON_PREM_SENSITIVE,
      publicClassification
    );
    expect(result.allowed).toBe(true);
  });

  it('OCT-COMPILE denies all tiers (empty ceiling)', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.COMPILE,
      MODEL_TIER.ON_PREM_SENSITIVE,
      publicClassification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
  });

  it('unknown OCT level denies with NVG_OCT_CEILING_DENIED', () => {
    const result = enforceOctModelCeiling(
      'OCT-NONEXISTENT',
      MODEL_TIER.ON_PREM_SENSITIVE,
      publicClassification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
  });

  it('OCT-OPEN allows frontier_general with public data', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.OPEN,
      MODEL_TIER.FRONTIER_GENERAL,
      publicClassification
    );
    expect(result.allowed).toBe(true);
  });

  it('OCT-CONFIDENTIAL allows frontier_general with public data', () => {
    const result = enforceOctModelCeiling(
      OCT_LEVEL.CONFIDENTIAL,
      MODEL_TIER.FRONTIER_GENERAL,
      publicClassification
    );
    expect(result.allowed).toBe(true);
  });
});
