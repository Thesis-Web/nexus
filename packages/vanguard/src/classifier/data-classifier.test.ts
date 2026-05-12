/**
 * NVG data classifier — payload + binding axis (§24.2).
 * Covers `boundConnectorClasses` floor introduced for agent-aware routing.
 */
import { describe, expect, it } from 'vitest';
import { DATA_CLASS, type DataLabel, type NonEmpty } from '@nexus/contracts';
import { classifyOutboundData } from './data-classifier.js';

function label(cls: string, source = 'dlp'): DataLabel {
  return { source: source as NonEmpty, label: cls, confidence: 1.0 };
}

describe('classifyOutboundData — payload axis only (back-compat)', () => {
  it('empty labels with no bindings → public', () => {
    const result = classifyOutboundData([]);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.PUBLIC);
    expect(result.isSensitive).toBe(false);
  });

  it('returns the highest payload label when no bindings present', () => {
    const result = classifyOutboundData([label('public'), label('internal'), label('public')]);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.INTERNAL);
  });
});

describe('classifyOutboundData — binding axis floor (§24.2)', () => {
  it('empty labels + internal binding → internal', () => {
    const result = classifyOutboundData([], [DATA_CLASS.INTERNAL]);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.INTERNAL);
    expect(result.isSensitive).toBe(false);
  });

  it('public payload label + internal binding → internal (floor wins)', () => {
    const result = classifyOutboundData([label('public')], [DATA_CLASS.INTERNAL]);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.INTERNAL);
  });

  it('financial payload label + internal binding → financial (payload wins, higher)', () => {
    const result = classifyOutboundData([label('financial')], [DATA_CLASS.INTERNAL]);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.FINANCIAL);
    expect(result.isSensitive).toBe(true);
  });

  it('mixed bindings → max across binding axis', () => {
    const result = classifyOutboundData([], [DATA_CLASS.PUBLIC, DATA_CLASS.FINANCIAL]);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.FINANCIAL);
    expect(result.isSensitive).toBe(true);
  });

  it('empty bindings array behaves identically to omitted bindings', () => {
    const omitted = classifyOutboundData([label('internal')]);
    const empty = classifyOutboundData([label('internal')], []);
    expect(empty.effectiveDataClass).toBe(omitted.effectiveDataClass);
    expect(empty.isSensitive).toBe(omitted.isSensitive);
  });
});
