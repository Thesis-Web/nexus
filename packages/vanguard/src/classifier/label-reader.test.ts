/**
 * NVG Label Reader Tests — spec §24.1, §24.2, blueprint §13.2-§13.3
 * Covers: valid labels, invalid labels, confidence clamping, unknown provenance, empty input
 */
import { describe, it, expect } from 'vitest';
import { readLabels } from './label-reader.js';
import type { DataLabel, NonEmpty, DataClass } from '@nexus/contracts';

function makeLabel(source: string, label: string, confidence: number): DataLabel {
  return {
    source: source as NonEmpty,
    label: label as DataClass,
    confidence,
  };
}

describe('NVG Label Reader — spec §24.1', () => {
  it('accepts valid labels with known data classes', () => {
    const result = readLabels([
      makeLabel('collibra', 'confidential', 0.95),
      makeLabel('alation', 'public', 0.8),
    ]);
    expect(result.validLabels).toHaveLength(2);
    expect(result.rejectedCount).toBe(0);
    expect(result.hasUnknownProvenance).toBe(false);
  });

  it('rejects labels with empty source', () => {
    const result = readLabels([
      makeLabel('', 'public', 0.9),
      makeLabel('collibra', 'internal', 0.85),
    ]);
    expect(result.validLabels).toHaveLength(1);
    expect(result.rejectedCount).toBe(1);
    expect(result.validLabels[0]!.source).toBe('collibra');
  });

  it('rejects labels with unrecognized data class', () => {
    const result = readLabels([makeLabel('dlp', 'top_secret', 0.9)]);
    expect(result.validLabels).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
    expect(result.notes[0]).toContain('unrecognized data class');
  });

  it('clamps confidence to [0,1]', () => {
    const result = readLabels([
      makeLabel('collibra', 'pii', 1.5),
      makeLabel('alation', 'financial', -0.2),
    ]);
    expect(result.validLabels).toHaveLength(2);
    expect(result.validLabels[0]!.confidence).toBe(1);
    expect(result.validLabels[1]!.confidence).toBe(0);
    expect(result.notes.filter(n => n.includes('clamped'))).toHaveLength(2);
  });

  it('rejects labels with non-numeric confidence', () => {
    const result = readLabels([
      { source: 'dlp' as NonEmpty, label: 'public' as DataClass, confidence: NaN },
    ]);
    expect(result.validLabels).toHaveLength(0);
    expect(result.rejectedCount).toBe(1);
  });

  it('flags unknown provenance sources', () => {
    const result = readLabels([
      makeLabel('unknown', 'internal', 0.5),
      makeLabel('unverified', 'public', 0.7),
    ]);
    expect(result.hasUnknownProvenance).toBe(true);
    expect(result.validLabels).toHaveLength(2);
    expect(result.notes.filter(n => n.includes('unknown provenance'))).toHaveLength(2);
  });

  it('returns empty validLabels and note for empty input', () => {
    const result = readLabels([]);
    expect(result.validLabels).toHaveLength(0);
    expect(result.rejectedCount).toBe(0);
    expect(result.notes).toContain('no labels provided — downstream will classify as PUBLIC');
  });

  it('trims whitespace from source', () => {
    const result = readLabels([makeLabel('  collibra  ', 'phi', 0.88)]);
    expect(result.validLabels).toHaveLength(1);
    expect(result.validLabels[0]!.source).toBe('collibra');
  });

  it('handles mixed valid and invalid labels', () => {
    const result = readLabels([
      makeLabel('collibra', 'confidential', 0.95),
      makeLabel('', 'public', 0.8),
      makeLabel('dlp', 'invented_class', 0.7),
      makeLabel('alation', 'pii', 0.6),
    ]);
    expect(result.validLabels).toHaveLength(2);
    expect(result.rejectedCount).toBe(2);
    expect(result.validLabels[0]!.label).toBe('confidential');
    expect(result.validLabels[1]!.label).toBe('pii');
  });
});
