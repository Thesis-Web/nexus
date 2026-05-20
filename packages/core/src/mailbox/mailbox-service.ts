/**
 * Baked Mailbox Service — AMEND-spec §3.6, §7
 * Extended for Mailbox-pit V1 — AMEND-nexus-mailbox-pit-v0-2-1 §3.2, §3.3
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
 *
 * Mailbox-pit additions (V1 — AMEND-nexus-mailbox-pit-v0-2-1):
 * - allocateForRun assigns one per-actor mailbox per (runId, actorId).
 * - getMailboxForActor / listMailboxesForRun / resolveMailboxProvenance
 *   provide the per-actor lookup surface.
 * - assertMailboxBelongsToActor is the write-time ownership assertion.
 * - State persistence law (§3.3): allocation is reconstructable from
 *   Run Ledger `mailbox_allocated` events. In-memory cache is a
 *   performance optimization; the ledger is the authoritative source.
 */
import { randomUUID } from 'node:crypto';
import type {
  MailboxService as IMailboxService,
  MailboxAllocation,
  MailboxBackend,
  MailboxItem,
  MailboxWriteInput,
  MailboxManifestRecord,
  NonEmpty,
  Uuid,
  IsoTimestamp,
  DenialCode,
  RunLedgerWriter,
} from '@nexus/contracts';
import { nowIso, DENIAL_CODE, NexusSecurityViolation } from '@nexus/contracts';
import { provenanceFromSourceType } from '@nexus/runtime-utils';
import { computeMailboxEligibility } from './mailbox-eligibility.js';
import { encodeMailboxIdV1 } from './mailbox-id-format.js';

export class MailboxServiceImpl implements IMailboxService {
  private readonly backend: MailboxBackend;
  private readonly manifest: MailboxManifestRecord;
  private readonly ledgerWriter: RunLedgerWriter;

  // In-memory allocation cache. Keyed by runId → (actorId → allocation).
  // This is a perf cache, not the authority — the Run Ledger
  // `mailbox_allocated` events are authoritative per spec §3.3, and
  // any cache miss falls back to ledger reconstruction. Survives
  // within process lifetime; lost on restart and rebuilt on first
  // read.
  private readonly allocations = new Map<Uuid, Map<Uuid, MailboxAllocation>>();

  constructor(
    backend: MailboxBackend,
    manifest: MailboxManifestRecord,
    ledgerWriter: RunLedgerWriter
  ) {
    this.backend = backend;
    this.manifest = manifest;
    this.ledgerWriter = ledgerWriter;
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
      // F4.11 / Hard Law #6 — provenance derived from the writer's
      // OutputSourceType. NXS connector results are trusted, NVG/agent
      // outputs default to 'agent_output' (untrusted unless the agent
      // declaration carries trusted=true at NVG case-split time).
      provenance: provenanceFromSourceType(output.sourceType),
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

    // Mailbox-pit V1 write-time ownership assertion (AMEND-nexus-mailbox-
    // pit-v0-2-1 §3.6). Fail-closed at the write boundary: the (runId,
    // producerActorId, mailboxId) triple MUST match a known allocation.
    // The producer identity comes from the output reference's `agentId`
    // (the orchestrator built the output reference under that actor's
    // authority). If the dispatcher / collector mis-routes a write to
    // the wrong mailbox, this throws NexusSecurityViolation before any
    // bytes hit the backend.
    await this.assertMailboxBelongsToActor(output.runId, output.agentId, input.mailboxId);

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

  async findBySlot(
    mailboxId: NonEmpty,
    runId: Uuid,
    taskId: Uuid,
    slotId: NonEmpty
  ): Promise<MailboxItem | null> {
    // Multi-node planner slot lookup. The downstream node's inputSlotReads
    // names the upstream node by subTaskKey (resolved to nodeId at the
    // dispatch layer) and the slotId. We filter by (taskId, slotId) and
    // return the most recently created available item. We deliberately
    // do NOT transition any items here — slot reads are read-only.
    const all = await this.backend.listByRun({
      mailboxId,
      runId,
      includeIneligible: false,
    });
    const matches = all.filter(
      item => item.taskId === taskId && item.slotId === slotId && item.mailboxStatus === 'available'
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return matches[0] ?? null;
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

  // ─── Mailbox-pit V1 (AMEND-nexus-mailbox-pit-v0-2-1 §3.2) ─────────────

  async allocateForRun(runId: Uuid, actors: readonly Uuid[]): Promise<ReadonlyMap<Uuid, NonEmpty>> {
    const runMap = await this.runAllocationMap(runId);
    const result = new Map<Uuid, NonEmpty>();
    for (const actorId of actors) {
      let allocation = runMap.get(actorId);
      if (allocation === undefined) {
        const now = nowIso();
        const mailboxId = encodeMailboxIdV1(runId, actorId);
        allocation = {
          allocationId: randomUUID() as Uuid,
          runId,
          actorId,
          mailboxId,
          mailboxRole: 'agent_output',
          backendId: this.backend.backendId,
          allocatedAt: now,
          allocationVersion: 'mailbox-pit/v1',
        };
        runMap.set(actorId, allocation);
        await this.ledgerWriter.writeEvent({
          runId,
          eventType: 'mailbox_allocated',
          timestamp: now,
          actorId,
          detail: {
            allocationId: allocation.allocationId,
            mailboxId: allocation.mailboxId,
            runId,
            actorId,
            mailboxRole: allocation.mailboxRole,
            backendId: allocation.backendId,
            allocatedAt: allocation.allocatedAt,
            allocationVersion: allocation.allocationVersion,
          },
        });
      }
      result.set(actorId, allocation.mailboxId);
    }
    return result;
  }

  async getMailboxForActor(runId: Uuid, actorId: Uuid): Promise<NonEmpty | null> {
    const runMap = await this.runAllocationMap(runId);
    return runMap.get(actorId)?.mailboxId ?? null;
  }

  async listMailboxesForRun(runId: Uuid): Promise<ReadonlyMap<Uuid, NonEmpty>> {
    const runMap = await this.runAllocationMap(runId);
    const result = new Map<Uuid, NonEmpty>();
    for (const [actorId, allocation] of runMap.entries()) {
      result.set(actorId, allocation.mailboxId);
    }
    return result;
  }

  async resolveMailboxProvenance(
    runId: Uuid,
    mailboxId: NonEmpty
  ): Promise<MailboxAllocation | null> {
    const runMap = await this.runAllocationMap(runId);
    for (const allocation of runMap.values()) {
      if (allocation.mailboxId === mailboxId) return allocation;
    }
    return null;
  }

  async assertMailboxBelongsToActor(
    runId: Uuid,
    actorId: Uuid,
    mailboxId: NonEmpty
  ): Promise<void> {
    const runMap = await this.runAllocationMap(runId);
    const allocation = runMap.get(actorId);
    if (allocation === undefined || allocation.mailboxId !== mailboxId) {
      throw new NexusSecurityViolation(
        DENIAL_CODE.MAILBOX_OWNERSHIP_MISMATCH,
        `mailbox '${mailboxId}' does not belong to actor '${actorId}' under run '${runId}'`
      );
    }
  }

  // ─── private: in-memory cache hydration via ledger reconstruction ──

  /**
   * Return the allocation map for runId, hydrating from the Run Ledger
   * on first access (§3.3 — allocation state must survive process
   * restart by being reconstructable from `mailbox_allocated` events).
   * The returned map is the live in-memory store; allocateForRun
   * mutates it directly.
   */
  private async runAllocationMap(runId: Uuid): Promise<Map<Uuid, MailboxAllocation>> {
    let runMap = this.allocations.get(runId);
    if (runMap !== undefined) return runMap;
    runMap = await this.reconstructAllocationsFromLedger(runId);
    this.allocations.set(runId, runMap);
    return runMap;
  }

  private async reconstructAllocationsFromLedger(
    runId: Uuid
  ): Promise<Map<Uuid, MailboxAllocation>> {
    const events = await this.ledgerWriter.getByRunId(runId);
    const map = new Map<Uuid, MailboxAllocation>();
    for (const event of events) {
      if (event.eventType !== 'mailbox_allocated') continue;
      const d = event.detail as Record<string, unknown>;
      const allocationId = d['allocationId'] as Uuid | undefined;
      const actorId = d['actorId'] as Uuid | undefined;
      const mailboxId = d['mailboxId'] as NonEmpty | undefined;
      const allocatedAt = d['allocatedAt'] as IsoTimestamp | undefined;
      const backendId = d['backendId'] as NonEmpty | undefined;
      if (!allocationId || !actorId || !mailboxId || !allocatedAt || !backendId) continue;
      map.set(actorId, {
        allocationId,
        runId,
        actorId,
        mailboxId,
        mailboxRole: 'agent_output',
        backendId,
        allocatedAt,
        allocationVersion: 'mailbox-pit/v1',
      });
    }
    return map;
  }
}
