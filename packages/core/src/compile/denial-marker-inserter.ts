/**
 * Denial Marker Inserter — AMEND-spec-nexus-compile §8.6
 *
 * File: packages/core/src/compile/denial-marker-inserter.ts
 * Layer 1 — three denial modes per [blueprint §12].
 *
 * inline: marker inserted at the missing location.
 * separate_section: all denials collected in dedicated section at end.
 * omit: missing sections removed from user output (NEVER audit-silent).
 *
 * Omission is never audit-silent — compile_slot_missing events are always
 * emitted regardless of denial handling mode. This inserter produces the
 * user-facing output; audit events are written by the renderer.
 */
import type { CompileTemplate, DenialHandling, NonEmpty } from '@nexus/contracts';
import type { UnmatchedLocation } from './slot-matcher.js';

// ─── Output Types ───

export interface DenialOutput {
  /** Inline markers keyed by locationId — for inline mode. */
  inlineMarkers: Map<string, string>;
  /** Collected denial section text — for separate_section mode. */
  separateSection: string | null;
  /** Location IDs to omit from rendering — for omit mode. */
  omittedLocationIds: Set<string>;
  /** All denial entries for audit (always populated regardless of mode). */
  denialEntries: DenialEntry[];
}

export interface DenialEntry {
  locationId: NonEmpty;
  sectionId: NonEmpty;
  expectedSlotId: NonEmpty;
  required: boolean;
  reason: string;
}

// ─── Interface ───

export interface DenialMarkerInserter {
  insert(
    template: CompileTemplate,
    unmatched: UnmatchedLocation[],
    denialHandling: DenialHandling
  ): DenialOutput;
}

// ─── Implementation ───

export class DenialMarkerInserterImpl implements DenialMarkerInserter {
  insert(
    _template: CompileTemplate,
    unmatched: UnmatchedLocation[],
    denialHandling: DenialHandling
  ): DenialOutput {
    const inlineMarkers = new Map<string, string>();
    const omittedLocationIds = new Set<string>();
    const denialEntries: DenialEntry[] = [];

    // Build denial entries (always, for audit)
    for (const u of unmatched) {
      denialEntries.push({
        locationId: u.location.locationId,
        sectionId: u.sectionId,
        expectedSlotId: u.location.expectedSlotId,
        required: u.required,
        reason: 'no_matching_fill',
      });
    }

    switch (denialHandling) {
      case 'inline':
        // Insert marker text at each missing location
        for (const u of unmatched) {
          const marker = this.buildInlineMarker(u);
          inlineMarkers.set(u.location.locationId, marker);
        }
        return { inlineMarkers, separateSection: null, omittedLocationIds, denialEntries };

      case 'separate_section':
        // Collect all denials into a dedicated section
        return {
          inlineMarkers,
          separateSection: this.buildSeparateSection(unmatched),
          omittedLocationIds,
          denialEntries,
        };

      case 'omit':
        // Mark locations for omission — rendering skips them
        for (const u of unmatched) {
          omittedLocationIds.add(u.location.locationId);
        }
        return { inlineMarkers, separateSection: null, omittedLocationIds, denialEntries };
    }
  }

  // ─── Private ───

  private buildInlineMarker(u: UnmatchedLocation): string {
    // [blueprint §12.1] — concise marker with trace context
    const requiredTag = u.required ? 'required' : 'optional';
    return `[section unavailable: no_matching_fill slot=${u.location.expectedSlotId} ${requiredTag}]`;
  }

  private buildSeparateSection(unmatched: UnmatchedLocation[]): string {
    if (unmatched.length === 0) return '';

    const lines: string[] = ['## Unavailable Sections'];
    for (const u of unmatched) {
      const requiredTag = u.required ? '(required)' : '(optional)';
      lines.push(
        `- ${u.sectionId}/${u.location.locationId}: no_matching_fill ${requiredTag} slot=${u.location.expectedSlotId}`
      );
    }
    return lines.join('\n');
  }
}
