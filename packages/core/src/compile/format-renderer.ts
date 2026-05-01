/**
 * Format Renderer — AMEND-spec-nexus-compile §8.5
 *
 * File: packages/core/src/compile/format-renderer.ts
 * Layer 1 — per-format output rendering.
 *
 * Prose walks sections/locations by position, emits by granularity
 * [blueprint §6.5, §8.5]. Table/raw/mixed per [blueprint §8.5].
 * file_bundle fail-closed in V1 [DIFF-S23-001].
 *
 * Deterministic ordering: section position → location position [blueprint §8.6].
 */
import type { CompileTemplate, CompileFormat, NonEmpty } from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';
import type { SlotMatchResult } from './slot-matcher.js';
import type { DenialOutput } from './denial-marker-inserter.js';
import type { GuardWarning } from './guard-evaluator.js';
import { CompileAssemblyError } from './compile-errors.js';

// ─── Interface [spec §8.5] ───

export interface FormatRenderer {
  render(
    template: CompileTemplate,
    matchResult: SlotMatchResult,
    validatedFills: Map<string, unknown>,
    denialOutput: DenialOutput,
    warnings: GuardWarning[]
  ): string;
}

// ─── Prose Renderer ───

export class ProseRenderer implements FormatRenderer {
  render(
    template: CompileTemplate,
    matchResult: SlotMatchResult,
    validatedFills: Map<string, unknown>,
    denialOutput: DenialOutput,
    warnings: GuardWarning[]
  ): string {
    const lines: string[] = [];
    const sortedSections = [...template.sections].sort((a, b) => a.position - b.position);

    for (const section of sortedSections) {
      lines.push(`## ${section.title}`);
      lines.push('');

      const sortedLocations = [...section.locations].sort((a, b) => a.position - b.position);

      for (const location of sortedLocations) {
        // Check omission
        if (denialOutput.omittedLocationIds.has(location.locationId)) continue;

        // Check inline denial marker
        const marker = denialOutput.inlineMarkers.get(location.locationId);
        if (marker !== undefined) {
          lines.push(marker);
          lines.push('');
          continue;
        }

        // Render matched fill
        const fill = validatedFills.get(location.locationId);
        if (fill !== undefined) {
          lines.push(String(fill));
          lines.push('');
        }
      }
    }

    // Append warnings
    if (warnings.length > 0) {
      lines.push('---');
      lines.push('### Warnings');
      for (const w of warnings) {
        lines.push(`- ${w.message}`);
      }
      lines.push('');
    }

    // Append separate denial section
    if (denialOutput.separateSection !== null && denialOutput.separateSection.length > 0) {
      lines.push('---');
      lines.push(denialOutput.separateSection);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ─── Table Renderer ───

export class TableRenderer implements FormatRenderer {
  render(
    template: CompileTemplate,
    _matchResult: SlotMatchResult,
    validatedFills: Map<string, unknown>,
    denialOutput: DenialOutput,
    _warnings: GuardWarning[]
  ): string {
    const lines: string[] = [];
    const sortedSections = [...template.sections].sort((a, b) => a.position - b.position);

    for (const section of sortedSections) {
      lines.push(`## ${section.title}`);
      lines.push('');
      lines.push('| Location | Slot | Value |');
      lines.push('|---|---|---|');

      const sortedLocations = [...section.locations].sort((a, b) => a.position - b.position);

      for (const location of sortedLocations) {
        if (denialOutput.omittedLocationIds.has(location.locationId)) continue;

        const marker = denialOutput.inlineMarkers.get(location.locationId);
        if (marker !== undefined) {
          lines.push(`| ${location.locationId} | ${location.expectedSlotId} | ${marker} |`);
          continue;
        }

        const fill = validatedFills.get(location.locationId);
        const value = fill !== undefined ? String(fill).replace(/\|/g, '\\|') : '';
        lines.push(`| ${location.locationId} | ${location.expectedSlotId} | ${value} |`);
      }
      lines.push('');
    }

    // Append separate denial section
    if (denialOutput.separateSection !== null && denialOutput.separateSection.length > 0) {
      lines.push(denialOutput.separateSection);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ─── Raw Renderer ───

export class RawRenderer implements FormatRenderer {
  render(
    template: CompileTemplate,
    _matchResult: SlotMatchResult,
    validatedFills: Map<string, unknown>,
    denialOutput: DenialOutput,
    _warnings: GuardWarning[]
  ): string {
    const parts: string[] = [];
    const sortedSections = [...template.sections].sort((a, b) => a.position - b.position);

    for (const section of sortedSections) {
      const sortedLocations = [...section.locations].sort((a, b) => a.position - b.position);

      for (const location of sortedLocations) {
        if (denialOutput.omittedLocationIds.has(location.locationId)) continue;

        const marker = denialOutput.inlineMarkers.get(location.locationId);
        if (marker !== undefined) {
          parts.push(marker);
          continue;
        }

        const fill = validatedFills.get(location.locationId);
        if (fill !== undefined) {
          parts.push(String(fill));
        }
      }
    }

    // Append separate denial section
    if (denialOutput.separateSection !== null && denialOutput.separateSection.length > 0) {
      parts.push(denialOutput.separateSection);
    }

    return parts.join('\n');
  }
}

// ─── Mixed Renderer ───

export class MixedRenderer implements FormatRenderer {
  render(
    template: CompileTemplate,
    matchResult: SlotMatchResult,
    validatedFills: Map<string, unknown>,
    denialOutput: DenialOutput,
    warnings: GuardWarning[]
  ): string {
    const lines: string[] = [];
    const sortedSections = [...template.sections].sort((a, b) => a.position - b.position);

    for (const section of sortedSections) {
      lines.push(`## ${section.title}`);
      lines.push('');

      const sortedLocations = [...section.locations].sort((a, b) => a.position - b.position);

      for (const location of sortedLocations) {
        if (denialOutput.omittedLocationIds.has(location.locationId)) continue;

        const marker = denialOutput.inlineMarkers.get(location.locationId);
        if (marker !== undefined) {
          lines.push(marker);
          lines.push('');
          continue;
        }

        const fill = validatedFills.get(location.locationId);
        if (fill === undefined) continue;

        // Mixed: render based on section expectedContentType
        if (section.expectedContentType === 'table' && typeof fill === 'object' && fill !== null) {
          lines.push('```json');
          lines.push(JSON.stringify(fill, null, 2));
          lines.push('```');
        } else {
          lines.push(String(fill));
        }
        lines.push('');
      }
    }

    if (warnings.length > 0) {
      lines.push('---');
      lines.push('### Warnings');
      for (const w of warnings) {
        lines.push(`- ${w.message}`);
      }
      lines.push('');
    }

    if (denialOutput.separateSection !== null && denialOutput.separateSection.length > 0) {
      lines.push('---');
      lines.push(denialOutput.separateSection);
      lines.push('');
    }

    return lines.join('\n');
  }
}

// ─── Factory: build renderer map ───

export function buildFormatRendererMap(): Map<CompileFormat, FormatRenderer> {
  const map = new Map<CompileFormat, FormatRenderer>();
  map.set('prose', new ProseRenderer());
  map.set('table', new TableRenderer());
  map.set('raw', new RawRenderer());
  map.set('mixed', new MixedRenderer());
  // file_bundle: not in map — fail-closed at assembly [DIFF-S23-001]
  return map;
}

// ─── file_bundle guard (called by assembler) ───

export function assertNotFileBundleFormat(format: CompileFormat): void {
  if (format === 'file_bundle') {
    throw new CompileAssemblyError(
      DENIAL_CODE.FILE_BUNDLE_DENIED,
      'file_bundle format is not supported in V1'
    );
  }
}
