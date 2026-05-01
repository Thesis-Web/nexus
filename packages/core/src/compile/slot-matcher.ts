/**
 * Slot Matcher — AMEND-spec-nexus-compile §8.2
 *
 * File: packages/core/src/compile/slot-matcher.ts
 * Layer 1 — matches mailbox items to template locations by slotId.
 *
 * Algorithm per [blueprint §8.2]:
 *   - Build index: slotId → MailboxItem[]
 *   - Walk sections/locations by position
 *   - Match by expectedSlotId: repeating_group matches all, else oldest
 *   - Unmatched locations and orphaned items tracked
 */
import type {
  CompileTemplate,
  CompileLocation,
  CompileSection,
  MailboxItem,
  NonEmpty,
} from '@nexus/contracts';

// ─── Result Types ───

export interface MatchedSlot {
  location: CompileLocation;
  items: MailboxItem[];
}

export interface UnmatchedLocation {
  location: CompileLocation;
  sectionId: NonEmpty;
  required: boolean;
}

export interface OrphanedItem {
  item: MailboxItem;
  reason: 'no_matching_location';
}

export interface SlotMatchResult {
  matched: Map<string, MatchedSlot>;
  unmatched: UnmatchedLocation[];
  orphaned: OrphanedItem[];
}

// ─── Interface ───

export interface SlotMatcher {
  match(template: CompileTemplate, items: MailboxItem[]): SlotMatchResult;
}

// ─── Implementation ───

export class SlotMatcherImpl implements SlotMatcher {
  match(template: CompileTemplate, items: MailboxItem[]): SlotMatchResult {
    // Build slot index: slotId → MailboxItem[]
    const slotIndex = new Map<string, MailboxItem[]>();
    for (const item of items) {
      const existing = slotIndex.get(item.slotId);
      if (existing !== undefined) {
        existing.push(item);
      } else {
        slotIndex.set(item.slotId, [item]);
      }
    }

    const matched = new Map<string, MatchedSlot>();
    const unmatched: UnmatchedLocation[] = [];
    const consumedIds = new Set<string>();

    // Walk sections by position, then locations by position
    const sortedSections = [...template.sections].sort((a, b) => a.position - b.position);

    for (const section of sortedSections) {
      this.matchLocations(
        section.sectionId,
        section.locations,
        slotIndex,
        consumedIds,
        matched,
        unmatched
      );
    }

    // Orphaned = items not consumed by any location
    const orphaned: OrphanedItem[] = [];
    for (const item of items) {
      if (!consumedIds.has(item.mailboxItemId)) {
        orphaned.push({ item, reason: 'no_matching_location' });
      }
    }

    return { matched, unmatched, orphaned };
  }

  // ─── Private ───

  private matchLocations(
    sectionId: NonEmpty,
    locations: readonly CompileLocation[],
    slotIndex: Map<string, MailboxItem[]>,
    consumedIds: Set<string>,
    matched: Map<string, MatchedSlot>,
    unmatched: UnmatchedLocation[]
  ): void {
    const sortedLocations = [...locations].sort((a, b) => a.position - b.position);

    for (const location of sortedLocations) {
      const candidates = slotIndex.get(location.expectedSlotId);

      if (candidates === undefined || candidates.length === 0) {
        unmatched.push({ location, sectionId, required: location.required });
        continue;
      }

      // Filter out already-consumed candidates
      const available = candidates.filter(c => !consumedIds.has(c.mailboxItemId));

      if (available.length === 0) {
        unmatched.push({ location, sectionId, required: location.required });
        continue;
      }

      // Sort deterministically: createdAt ASC, then mailboxItemId ASC
      const sorted = [...available].sort((a, b) => {
        const byTime = a.createdAt.localeCompare(b.createdAt);
        if (byTime !== 0) return byTime;
        return a.mailboxItemId.localeCompare(b.mailboxItemId);
      });

      // repeating_group matches all; else match oldest only
      const matchedItems = location.slotType.type === 'repeating_group' ? sorted : [sorted[0]!];

      for (const item of matchedItems) {
        consumedIds.add(item.mailboxItemId);
      }

      matched.set(location.locationId, { location, items: matchedItems });

      // Recurse into childLocations for repeating_group
      if (
        location.slotType.type === 'repeating_group' &&
        location.slotType.childLocations !== undefined
      ) {
        this.matchLocations(
          sectionId,
          location.slotType.childLocations as CompileLocation[],
          slotIndex,
          consumedIds,
          matched,
          unmatched
        );
      }
    }
  }
}
