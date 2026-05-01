/**
 * Default Template Generator — AMEND-spec-nexus-compile §8.1
 *
 * File: packages/core/src/compile/default-template-generator.ts
 * Layer 1 — generates session-only default templates for runs without
 * a pre-registered template.
 *
 * Layout law [blueprint §6.2]:
 *   - Group by agentId (sorted)
 *   - One section per agent
 *   - One prose/block location per item
 *   - `default_<runId>` as templateId
 *   - Signed with control-plane key
 *   - NOT inserted into registry
 *
 * Synchronous: uses Ed25519 sync signing (sha512Sync pre-configured).
 */
import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { createHash } from 'node:crypto';
import type {
  Uuid,
  NonEmpty,
  Sha256Hex,
  Base64Url,
  MailboxItem,
  CompileTemplate,
  CompileSection,
  CompileLocation,
  CompilePreferences,
  CompileFormat,
  DenialHandling,
  IsoTimestamp,
} from '@nexus/contracts';
import { nowIso } from '@nexus/contracts';
import { canonicalize } from '@nexus/runtime-utils';

// Ensure sync signing is available
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(ed25519.etc as any).sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

// ─── Interface ───

export interface DefaultTemplateGenerator {
  generate(
    runId: Uuid,
    items: MailboxItem[],
    preferences: CompilePreferences | null
  ): CompileTemplate;
}

// ─── Implementation ───

export class DefaultTemplateGeneratorImpl implements DefaultTemplateGenerator {
  private readonly signingPrivateKey: Uint8Array;

  constructor(signingPrivateKeyBase64url: string) {
    this.signingPrivateKey = new Uint8Array(Buffer.from(signingPrivateKeyBase64url, 'base64url'));
  }

  generate(
    runId: Uuid,
    items: MailboxItem[],
    preferences: CompilePreferences | null
  ): CompileTemplate {
    const format: CompileFormat = preferences?.format ?? 'prose';
    const denialHandling: DenialHandling = preferences?.denialHandling ?? 'inline';

    // Group items by agentId
    const agentGroups = new Map<string, MailboxItem[]>();
    for (const item of items) {
      const group = agentGroups.get(item.agentId);
      if (group !== undefined) {
        group.push(item);
      } else {
        agentGroups.set(item.agentId, [item]);
      }
    }

    // Sort agents alphabetically
    const sortedAgentIds = [...agentGroups.keys()].sort();

    // Apply section order from preferences if provided
    const orderedAgentIds =
      preferences?.sectionOrder !== undefined && preferences.sectionOrder.length > 0
        ? this.applyCustomOrder(sortedAgentIds, preferences.sectionOrder)
        : sortedAgentIds;

    // Build sections — one per agent
    const sections: CompileSection[] = orderedAgentIds.map((agentId, sectionIdx) => {
      const agentItems = agentGroups.get(agentId)!;
      // Sort items deterministically: createdAt ASC, then mailboxItemId ASC
      const sorted = [...agentItems].sort((a, b) => {
        const byTime = a.createdAt.localeCompare(b.createdAt);
        if (byTime !== 0) return byTime;
        return a.mailboxItemId.localeCompare(b.mailboxItemId);
      });

      // One location per item — prose/block
      const locations: CompileLocation[] = sorted.map((item, locIdx) => ({
        locationId: `loc_${agentId}_${locIdx}` as NonEmpty,
        position: locIdx,
        assignedAgentId: agentId as Uuid,
        expectedSlotId: item.slotId,
        slotType: { type: 'prose' as const, granularity: 'block' as const },
        required: true,
      }));

      return {
        sectionId: `section_${agentId}` as NonEmpty,
        position: sectionIdx,
        title: `Agent ${agentId}`,
        assignedAgentId: agentId as Uuid,
        expectedContentType: 'prose' as const,
        locations,
      };
    });

    const templateId = `default_${runId}` as NonEmpty;
    const templateVersion = '1' as NonEmpty;
    const createdAt = nowIso();

    // Compute digest [blueprint §11.2]
    const digestInput = {
      templateId,
      templateVersion,
      format,
      sections,
      guards: [],
      denialHandling,
      createdAt,
      createdBy: 'default' as const,
    };
    const canonical = canonicalize(digestInput);
    const templateDigest = createHash('sha256').update(canonical).digest('hex') as Sha256Hex;

    // Sign (sync) — signature over digest string
    const msgBytes = new TextEncoder().encode(templateDigest);
    const sigBytes = ed25519.sign(msgBytes, this.signingPrivateKey);
    const signature = Buffer.from(sigBytes).toString('base64url') as Base64Url;

    return {
      templateId,
      templateVersion,
      format,
      sections,
      guards: [],
      denialHandling,
      createdAt: createdAt as IsoTimestamp,
      createdBy: 'default',
      templateDigest,
      signature,
    };
  }

  // ─── Private ───

  /**
   * Reorder agents to match sectionOrder preference.
   * Agents in sectionOrder come first (in specified order),
   * remaining agents follow in alphabetical order.
   */
  private applyCustomOrder(sortedAgentIds: string[], sectionOrder: string[]): string[] {
    const ordered: string[] = [];
    const remaining = new Set(sortedAgentIds);

    for (const id of sectionOrder) {
      if (remaining.has(id)) {
        ordered.push(id);
        remaining.delete(id);
      }
    }

    // Append remaining in alphabetical order
    for (const id of sortedAgentIds) {
      if (remaining.has(id)) {
        ordered.push(id);
      }
    }

    return ordered;
  }
}
