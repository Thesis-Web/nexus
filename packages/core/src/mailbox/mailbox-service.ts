/**
 * Baked Mailbox Service — AMEND-spec §3.6, §7
 *
 * File: packages/core/src/mailbox/mailbox-service.ts
 * Layer 1 — baked core infrastructure.
 *
 * This class implements the MailboxService interface from contracts.
 * It is NOT a replaceable plugin surface. Enterprises may replace the
 * storage backend (MailboxBackend), but they may NOT replace eligibility,
 * transition, or digest/classification law.
 *
 * Law:
 * - writeFromOutput creates a MailboxItem from an OutputReference and
 *   writes it through the backend.
 * - listEligibleForCompile returns only items that pass eligibility.
 * - markConsumed transitions items to 'consumed' only after successful
 *   compile-return acceptance.
 * - cancelRun transitions all available items for that run to 'cancelled'.
 */
import { randomUUID } from 'node:crypto';
import type {
  MailboxService as IMailboxService,
  MailboxBackend,
  MailboxItem,
  MailboxWriteInput,
  MailboxManifestRecord,
  NonEmpty,
  Uuid,
  DenialCode,
} from '@nexus/contracts';
import { nowIso, DENIAL_CODE } from '@nexus/contracts';
import { computeMailboxEligibility } from './mailbox-eligibility.js';

export class MailboxServiceImpl implements IMailboxService {
  private readonly backend: MailboxBackend;
  private readonly manifest: MailboxManifestRecord;

  constructor(backend: MailboxBackend, manifest: MailboxManifestRecord) {
    this.backend = backend;
    this.manifest = manifest;
  }

  async writeFromOutput(input: MailboxWriteInput): Promise<MailboxItem> {
    const now = nowIso();
    const output = input.output;

    const item: MailboxItem = {
      mailboxItemId: randomUUID() as Uuid,
      mailboxId: input.mailboxId,
      runId: output.runId,
      taskId: output.taskId,
      agentId: output.agentId,
      slotId: output.slotId,
      sourceType: output.sourceType,
      resultRef: output.resultRef,
      resultDigest: output.resultDigest,
      resultClassifications: output.resultClassifications,
      octLevel: output.octLevel,
      createdAt: now,
      expiresAt: input.expiresAt,
      evidenceRecordId:
        output.sourceType === 'nxs_execution_result' ? output.evidenceRecordId : null,
      routingTrailRecordId: output.sourceType === 'nvg_result' ? output.routingTrailRecordId : null,
      runLedgerEventId: input.runLedgerEventId,
      redactionState: output.redactionState,
      mailboxStatus: 'available',
      compileEligible: true,
      consumedAt: null,
      blockedReason: null,
    };

    // Initial eligibility check — block before storage if obviously ineligible
    const check = computeMailboxEligibility(item, this.manifest, now);
    if (!check.eligible && check.transitionTo !== null) {
      item.mailboxStatus = check.transitionTo;
      item.compileEligible = false;
      item.blockedReason = (check.denialCode as DenialCode) ?? null;
    }

    await this.backend.write(item);
    return item;
  }

  async listEligibleForCompile(mailboxId: NonEmpty, runId: Uuid): Promise<MailboxItem[]> {
    const now = nowIso();
    const all = await this.backend.listByRun({
      mailboxId,
      runId,
      includeIneligible: true,
    });

    const eligible: MailboxItem[] = [];
    for (const item of all) {
      const check = computeMailboxEligibility(item, this.manifest, now);
      if (check.eligible) {
        eligible.push(item);
      } else if (check.transitionTo !== null && item.mailboxStatus !== check.transitionTo) {
        // Side-effect: transition expired items on read (§7.4)
        await this.backend.updateStatus(
          item.mailboxItemId,
          check.transitionTo,
          (check.denialCode as DenialCode) ?? null
        );
      }
    }
    return eligible;
  }

  async markConsumed(mailboxId: NonEmpty, runId: Uuid, itemIds: Uuid[]): Promise<void> {
    for (const itemId of itemIds) {
      const item = await this.backend.getById(itemId);
      if (item === null) continue;
      if (item.mailboxId !== mailboxId || item.runId !== runId) continue;
      if (item.mailboxStatus === 'consumed') continue;
      await this.backend.updateStatus(itemId, 'consumed', null);
    }
  }

  async cancelRun(mailboxId: NonEmpty, runId: Uuid, reason: DenialCode): Promise<void> {
    const all = await this.backend.listByRun({
      mailboxId,
      runId,
      includeIneligible: true,
    });
    for (const item of all) {
      if (item.mailboxStatus !== 'available') continue;
      await this.backend.updateStatus(item.mailboxItemId, 'cancelled', reason);
    }
  }
}
