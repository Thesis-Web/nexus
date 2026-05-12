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

/**
 * Classify outbound NVG data using both the payload axis (labels) and the
 * binding axis (data classes contributed by the connectors the caller can
 * reach). Returns the highest class across both. Empty `boundConnectorClasses`
 * preserves pure payload classification; this is the back-compat shape for
 * callers that don't yet plumb bindings.
 */
export function classifyOutboundData(
  labels: DataLabel[],
  boundConnectorClasses: DataClass[] = []
): NvgClassificationResult {
  const labelClass = resolveHighestDataClass(labels);
  let maxIdx = DATA_CLASS_ORDER.indexOf(labelClass);
  for (const cls of boundConnectorClasses) {
    const idx = DATA_CLASS_ORDER.indexOf(cls);
    if (idx > maxIdx) maxIdx = idx;
  }
  const highestClass = DATA_CLASS_ORDER[maxIdx]!;
  return {
    effectiveDataClass: highestClass,
    isSensitive: isSensitiveDataClass(highestClass),
    labels,
    classifiedAt: new Date().toISOString() as IsoTimestamp,
  };
}
