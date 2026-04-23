/**
 * NVG Label Reader — spec §24.1, §24.2, blueprint §13.2–§13.3
 * First step in NVG outbound pipeline.
 * Reads and validates enterprise-applied data classification labels.
 * Layer 3 — imports from @nexus/contracts only.
 *
 * Pipeline position: INPUT → label-reader → data-classifier → policy-engine → ...
 *
 * Responsibilities:
 *   1. Validate label structure (source, label, confidence)
 *   2. Clamp confidence to [0,1]
 *   3. Reject labels with empty/missing required fields
 *   4. Flag unknown provenance for quarantine decisions downstream
 *   5. Return validated label set for data-classifier
 */
import { DATA_CLASS_ORDER, type DataClass, type DataLabel, type NonEmpty } from '@nexus/contracts';

// ── Label validation result ─────────────────────────────────────────────────

export interface LabelReadResult {
  /** Validated labels safe for classification */
  validLabels: DataLabel[];
  /** Labels that were rejected during validation */
  rejectedCount: number;
  /** Whether any label comes from an unknown or empty provenance source */
  hasUnknownProvenance: boolean;
  /** Validation notes for audit/debugging */
  notes: string[];
}

// ── Known data class set for validation ─────────────────────────────────────

const KNOWN_DATA_CLASSES = new Set<string>(DATA_CLASS_ORDER);

// ── Label reader ────────────────────────────────────────────────────────────

/**
 * Read and validate enterprise-applied data labels from an NVG outbound request.
 *
 * Blueprint §13.3: Classification is label-driven. NVG reads labels the enterprise
 * has already applied. NVG does not infer content meaning from raw text.
 *
 * Labels with invalid structure are rejected. Labels with out-of-range confidence
 * are clamped to [0,1]. Labels with unknown data class values are rejected —
 * governed data class set is the source of truth.
 *
 * @param rawLabels - DataLabel[] from NvgOutboundRequest.dataLabels
 */
export function readLabels(rawLabels: DataLabel[]): LabelReadResult {
  const validLabels: DataLabel[] = [];
  const notes: string[] = [];
  let rejectedCount = 0;
  let hasUnknownProvenance = false;

  for (let i = 0; i < rawLabels.length; i++) {
    const label = rawLabels[i]!;

    // ── Validate source (required, non-empty) ──
    if (!label.source || typeof label.source !== 'string' || label.source.trim().length === 0) {
      notes.push(`label[${i}]: rejected — missing or empty source`);
      rejectedCount++;
      continue;
    }

    // ── Flag unknown provenance ──
    const normalizedSource = label.source.trim().toLowerCase();
    if (normalizedSource === 'unknown' || normalizedSource === 'unverified') {
      hasUnknownProvenance = true;
      notes.push(`label[${i}]: unknown provenance source '${label.source}'`);
    }

    // ── Validate data class ──
    if (!label.label || typeof label.label !== 'string') {
      notes.push(`label[${i}]: rejected — missing or invalid data class`);
      rejectedCount++;
      continue;
    }

    if (!KNOWN_DATA_CLASSES.has(label.label)) {
      notes.push(`label[${i}]: rejected — unrecognized data class '${label.label}'`);
      rejectedCount++;
      continue;
    }

    // ── Validate and clamp confidence ──
    if (typeof label.confidence !== 'number' || isNaN(label.confidence)) {
      notes.push(`label[${i}]: rejected — confidence is not a valid number`);
      rejectedCount++;
      continue;
    }

    const clampedConfidence = Math.min(1, Math.max(0, label.confidence));
    if (clampedConfidence !== label.confidence) {
      notes.push(
        `label[${i}]: confidence clamped from ${label.confidence} to ${clampedConfidence}`
      );
    }

    validLabels.push({
      source: label.source.trim() as NonEmpty,
      label: label.label as DataClass,
      confidence: clampedConfidence,
    });
  }

  // ── No labels at all ──
  if (rawLabels.length === 0) {
    notes.push('no labels provided — downstream will classify as PUBLIC');
  }

  return {
    validLabels,
    rejectedCount,
    hasUnknownProvenance,
    notes,
  };
}
