/**
 * NVG Threat Test 11 — Wall Violation
 * Spec §38.3 item 1: sensitive data routed to frontier → hard deny
 *
 * The hard wall is the foundational security invariant of NVG:
 * data classified as sensitive (pii, phi, financial, confidential)
 * must NEVER reach a frontier tier, regardless of OCT level or
 * routing policy.
 */
import { describe, it, expect } from 'vitest';
import { classifyOutboundData } from './classifier/data-classifier.js';
import { enforceOctModelCeiling, isFrontierTier } from './classifier/ceiling-enforcer.js';
import {
  MODEL_TIER,
  DATA_CLASS,
  DENIAL_CODE,
  type DataLabel,
  type OctLevel,
} from '@nexus/contracts';

describe('NVG Threat: Wall Violation — sensitive data to frontier (§38.3)', () => {
  const SENSITIVE_CLASSES = [
    DATA_CLASS.PII,
    DATA_CLASS.PHI,
    DATA_CLASS.FINANCIAL,
    DATA_CLASS.CONFIDENTIAL,
  ];
  const FRONTIER_TIERS = [
    MODEL_TIER.FRONTIER_GENERAL,
    MODEL_TIER.FRONTIER_REASONING,
    MODEL_TIER.FRONTIER_LIVE,
  ];

  it('isFrontierTier correctly identifies all frontier tiers', () => {
    for (const tier of FRONTIER_TIERS) {
      expect(isFrontierTier(tier)).toBe(true);
    }
    expect(isFrontierTier(MODEL_TIER.ON_PREM_SENSITIVE)).toBe(false);
    expect(isFrontierTier(MODEL_TIER.ON_PREM_GENERAL)).toBe(false);
    expect(isFrontierTier(MODEL_TIER.FALLBACK)).toBe(false);
  });

  for (const dataClass of SENSITIVE_CLASSES) {
    for (const frontierTier of FRONTIER_TIERS) {
      it(`denies ${dataClass} data routed to ${frontierTier}`, () => {
        const labels: DataLabel[] = [{ source: 'dlp', label: dataClass, confidence: 0.99 }];
        const classification = classifyOutboundData(labels);
        expect(classification.isSensitive).toBe(true);

        // OCT-CONFIDENTIAL permits frontier tiers in OCT ceiling,
        // but the hard wall must still block sensitive data.
        const result = enforceOctModelCeiling(
          'OCT-CONFIDENTIAL' as OctLevel,
          frontierTier,
          classification
        );
        expect(result.allowed).toBe(false);
        expect(result.denialCode).toBe(DENIAL_CODE.NVG_CLASSIFICATION_DENIED);
      });
    }
  }

  it('allows public data to frontier tiers (not sensitive)', () => {
    const labels: DataLabel[] = [{ source: 'dlp', label: DATA_CLASS.PUBLIC, confidence: 0.95 }];
    const classification = classifyOutboundData(labels);
    expect(classification.isSensitive).toBe(false);

    const result = enforceOctModelCeiling(
      'OCT-CONFIDENTIAL' as OctLevel,
      MODEL_TIER.FRONTIER_GENERAL,
      classification
    );
    expect(result.allowed).toBe(true);
  });

  it('denies when highest data class among multiple labels is sensitive', () => {
    const labels: DataLabel[] = [
      { source: 'dlp', label: DATA_CLASS.PUBLIC, confidence: 0.9 },
      { source: 'catalog', label: DATA_CLASS.PII, confidence: 0.85 },
    ];
    const classification = classifyOutboundData(labels);
    expect(classification.isSensitive).toBe(true);
    expect(classification.effectiveDataClass).toBe(DATA_CLASS.PII);

    const result = enforceOctModelCeiling(
      'OCT-CONFIDENTIAL' as OctLevel,
      MODEL_TIER.FRONTIER_GENERAL,
      classification
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_CLASSIFICATION_DENIED);
  });
});
