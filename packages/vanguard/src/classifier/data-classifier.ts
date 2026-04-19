/**
 * NVG Data Classifier — spec §24.2
 * Label-driven classification. Reads labels the enterprise has applied.
 * Layer 3 — imports from @nexus/contracts only.
 */
import {
  DATA_CLASS,
  DATA_CLASS_ORDER,
  isSensitiveDataClass,
  type DataClass,
  type DataLabel,
  type NvgClassificationResult,
  type IsoTimestamp,
} from '@nexus/contracts';

export function resolveHighestDataClass(labels: DataLabel[]): DataClass {
  if (!labels.length) return DATA_CLASS.PUBLIC;
  let maxIdx = 0;
  for (const label of labels) {
    const idx = DATA_CLASS_ORDER.indexOf(label.label);
    if (idx > maxIdx) maxIdx = idx;
  }
  return DATA_CLASS_ORDER[maxIdx]!;
}

export function classifyOutboundData(labels: DataLabel[]): NvgClassificationResult {
  const highestClass = resolveHighestDataClass(labels);
  const isSensitive = isSensitiveDataClass(highestClass);
  return {
    effectiveDataClass: highestClass,
    isSensitive,
    labels,
    classifiedAt: new Date().toISOString() as IsoTimestamp,
  };
}
