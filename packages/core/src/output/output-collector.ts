/**
 * Output Collector — AMEND-spec §6.7, §3.8
 * Extended for Mailbox-pit V1 — AMEND-nexus-mailbox-pit-v0-2-1 §3.6.
 *
 * File: packages/core/src/output/output-collector.ts
 * Layer 1 — baked infrastructure. NOT a replaceable plugin.
 *
 * The only lawful writer from engine/orchestrator results into mailbox.
 * Engine outputs are adapted into output references at the composition boundary.
 *
 * Law:
 * - Must verify payload digest before mailbox write.
 * - Must validate slot against declared slots when policy requires.
 * - Must write Run Ledger partial_result for every successful mailbox write.
 * - Must fail closed with OUTPUT_CONTRACT_EMPTY when no eligible items exist.
 *
 * Mailbox-pit V1 additions:
 * - Every writeMailboxItemFromXxx call takes a typed MailboxWriteContext
 *   that explicitly declares (runId, producerActorId, mailboxId, taskId,
 *   slotId). The callsite is grep-able for the write destination.
 * - The collector cross-checks ctx fields against the OutputReference's
 *   internal runId/agentId/taskId/slotId before writing. Mismatch throws.
 * - The mailboxId comes from the ctx (not a constructor field) so per-
 *   actor mailboxes work without per-instance OutputCollector copies.
 * - MailboxService.writeFromOutput runs assertMailboxBelongsToActor on
 *   every write (fail-closed boundary). The collector relies on that
 *   assertion as the authoritative ownership check; this collector's
 *   cross-check is defense-in-depth for ctx↔output consistency.
 * - buildOutputContract aggregates eligible items across EVERY mailbox
 *   allocated for the run (listMailboxesForRun → iterate
 *   listEligibleForCompile). Per spec §2.6 — no dedicated compile mailbox
 *   in V1; provenance comes from per-actor mailbox source.
 */
import { randomUUID } from 'node:crypto';
import type {
  OutputCollector as IOutputCollector,
  OutputContract,
  MailboxItem,
  MailboxService,
  MailboxWriteContext,
  NvgOutputReference,
  NxsOutputReference,
  AgentPartialOutputReference,
  OutputSlotPolicy,
  RunLedgerWriter,
  Uuid,
  NonEmpty,
} from '@nexus/contracts';
import { nowIso, DENIAL_CODE } from '@nexus/contracts';
import type { PayloadResolverRegistry } from './payload-resolver.js';
import type { DeclaredOutputSlotReader } from './declared-output-slot-reader.js';
import { buildOutputContractFromItems } from './output-contract-builder.js';

export interface OutputCollectorDeps {
  mailboxService: MailboxService;
  resolverRegistry: PayloadResolverRegistry;
  slotReader: DeclaredOutputSlotReader;
  ledgerWriter: RunLedgerWriter;
  outputSlotPolicy: OutputSlotPolicy;
  expiresAt: (() => string | null) | null;
}

export class OutputCollectorImpl implements IOutputCollector {
  private readonly deps: OutputCollectorDeps;

  constructor(deps: OutputCollectorDeps) {
    this.deps = deps;
  }

  async writeMailboxItemFromNvgResult(
    input: NvgOutputReference,
    ctx: MailboxWriteContext
  ): Promise<MailboxItem> {
    if (input.sourceType !== 'nvg_result') {
      throw new Error('Expected sourceType nvg_result');
    }
    this.assertContextMatchesOutput(input, ctx);
    await this.verifyDigest(input.resultRef, input.resultDigest);
    await this.validateSlot(input.runId, input.taskId, input.slotId);

    const item = await this.deps.mailboxService.writeFromOutput({
      mailboxId: ctx.mailboxId,
      output: input,
      expiresAt: this.getExpiresAt(),
      runLedgerEventId: null,
    });

    await this.writePartialResultEvent(item, input);
    return item;
  }

  async writeMailboxItemFromNxsResult(
    input: NxsOutputReference,
    ctx: MailboxWriteContext
  ): Promise<MailboxItem> {
    if (input.sourceType !== 'nxs_execution_result') {
      throw new Error('Expected sourceType nxs_execution_result');
    }
    this.assertContextMatchesOutput(input, ctx);
    await this.verifyDigest(input.resultRef, input.resultDigest);
    await this.validateSlot(input.runId, input.taskId, input.slotId);

    const item = await this.deps.mailboxService.writeFromOutput({
      mailboxId: ctx.mailboxId,
      output: input,
      expiresAt: this.getExpiresAt(),
      runLedgerEventId: null,
    });

    await this.writePartialResultEvent(item, input);
    return item;
  }

  async writeMailboxItemFromAgentPartial(
    input: AgentPartialOutputReference,
    ctx: MailboxWriteContext
  ): Promise<MailboxItem> {
    if (input.sourceType !== 'agent_partial') {
      throw new Error('Expected sourceType agent_partial');
    }
    this.assertContextMatchesOutput(input, ctx);
    await this.verifyDigest(input.resultRef, input.resultDigest);
    await this.validateSlot(input.runId, input.taskId, input.slotId);

    const item = await this.deps.mailboxService.writeFromOutput({
      mailboxId: ctx.mailboxId,
      output: input,
      expiresAt: this.getExpiresAt(),
      runLedgerEventId: null,
    });

    await this.writePartialResultEvent(item, input);
    return item;
  }

  async buildOutputContract(runId: Uuid): Promise<OutputContract> {
    // AMEND-nexus-mailbox-pit-v0-2-1 §3.5 + HOLE-002 closure: compile
    // reads from every allocated actor mailbox for the run. The full
    // (actorId → mailboxId) map travels on the OutputContract via
    // `mailboxAllocations` so downstream consumers receive the same
    // provenance information they would get from calling
    // listMailboxesForRun themselves — no representative, no lossy
    // compression.
    const mailboxAllocations = await this.deps.mailboxService.listMailboxesForRun(runId);
    const allItems: MailboxItem[] = [];
    const sourceMailboxIds: NonEmpty[] = [];
    for (const [, mailboxId] of mailboxAllocations.entries()) {
      const items = await this.deps.mailboxService.listEligibleForCompile(mailboxId, runId);
      if (items.length > 0) sourceMailboxIds.push(mailboxId);
      for (const it of items) allItems.push(it);
    }

    if (allItems.length === 0) {
      throw new Error(
        `${DENIAL_CODE.OUTPUT_CONTRACT_EMPTY}: no eligible mailbox items for run '${runId}'`
      );
    }

    const contract = buildOutputContractFromItems(runId, mailboxAllocations, allItems);

    // Write compile_started ledger event (§6.7).
    await this.deps.ledgerWriter.writeEvent({
      runId,
      eventType: 'compile_started',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        compilerSocketId: null,
        sourceMailboxIds,
        allocationCount: mailboxAllocations.size,
        outputContractId: contract.outputContractId,
        contractDigest: contract.contractDigest,
        mailboxItemCount: allItems.length,
        inputDataClasses: contract.inputDataClasses,
        inheritedCompileDataClass: contract.inheritedCompileDataClass,
      },
    });

    return contract;
  }

  // ─── Private helpers ───

  /** Defense-in-depth: the MailboxWriteContext is supplied by the dispatch
   *  callsite and asserts its own view of (runId, taskId, slotId,
   *  producerActorId). The output reference carries the same fields
   *  internally (the engine adapter built it). They MUST agree — any
   *  drift between the dispatcher's view and the engine's view is a
   *  callsite bug we want to catch before the mailbox boundary, not
   *  after. */
  private assertContextMatchesOutput(
    output: NvgOutputReference | NxsOutputReference | AgentPartialOutputReference,
    ctx: MailboxWriteContext
  ): void {
    if (ctx.runId !== output.runId) {
      throw new Error(
        `MailboxWriteContext.runId '${ctx.runId}' disagrees with output.runId '${output.runId}'`
      );
    }
    if (ctx.taskId !== output.taskId) {
      throw new Error(
        `MailboxWriteContext.taskId '${ctx.taskId}' disagrees with output.taskId '${output.taskId}'`
      );
    }
    if (ctx.slotId !== output.slotId) {
      throw new Error(
        `MailboxWriteContext.slotId '${ctx.slotId}' disagrees with output.slotId '${output.slotId}'`
      );
    }
    if (ctx.producerActorId !== output.agentId) {
      throw new Error(
        `MailboxWriteContext.producerActorId '${ctx.producerActorId}' disagrees with output.agentId '${output.agentId}'`
      );
    }
  }

  private async verifyDigest(resultRef: NonEmpty, expectedDigest: string): Promise<void> {
    const valid = await this.deps.resolverRegistry.verifyDigest(resultRef, expectedDigest);
    if (!valid) {
      throw new Error(
        `${DENIAL_CODE.MAILBOX_DIGEST_MISMATCH}: digest mismatch for resultRef '${resultRef}'`
      );
    }
  }

  private async validateSlot(runId: Uuid, taskId: Uuid, slotId: NonEmpty): Promise<void> {
    const result = await this.deps.slotReader.validate(
      runId,
      taskId,
      slotId,
      this.deps.outputSlotPolicy
    );
    if (!result.matched && result.reason === DENIAL_CODE.UNDECLARED_OUTPUT_SLOT) {
      throw new Error(
        `${DENIAL_CODE.UNDECLARED_OUTPUT_SLOT}: slot '${slotId}' not declared for task '${taskId}'`
      );
    }
  }

  private async writePartialResultEvent(
    item: MailboxItem,
    input: NvgOutputReference | NxsOutputReference | AgentPartialOutputReference
  ): Promise<void> {
    // Touch the parameter to keep tsc happy — input is the typed
    // reference but partial_result is built from the persisted item.
    void input;
    const slotValidation = await this.deps.slotReader.validate(
      item.runId,
      item.taskId,
      item.slotId,
      this.deps.outputSlotPolicy
    );

    await this.deps.ledgerWriter.writeEvent({
      runId: item.runId,
      eventType: 'partial_result',
      timestamp: nowIso(),
      actorId: item.agentId,
      detail: {
        sourceType: item.sourceType,
        mailboxId: item.mailboxId,
        mailboxItemId: item.mailboxItemId,
        taskId: item.taskId,
        agentId: item.agentId,
        slotId: item.slotId,
        // The mailbox item's resultRef. Surfaced here so audit consumers
        // (ledger viewer in particular) can distinguish a connector
        // data payload from a synthesized NXS receipt without walking
        // back through the bridge — receipts use the convention
        // <actionId>.receipt.json. Phase 2 may replace this with a
        // structured `kind: 'data' | 'receipt'` field if path-based
        // detection ever needs to cope with non-file:// resolvers.
        resultRef: item.resultRef,
        resultDigest: item.resultDigest,
        resultClassifications: item.resultClassifications,
        evidenceRecordId: item.evidenceRecordId,
        routingTrailRecordId: item.routingTrailRecordId,
        slotValidation: {
          policy: slotValidation.policy,
          declared: slotValidation.declared,
          matched: slotValidation.matched,
          reason: slotValidation.reason,
        },
      },
    });
  }

  private getExpiresAt(): string | null {
    if (this.deps.expiresAt === null) return null;
    return this.deps.expiresAt();
  }
}

// Silence unused-import lint when randomUUID isn't used directly; the
// import is preserved for symmetry with the prior shape and may be used
// in upcoming sub-mailbox utilities.
void randomUUID;
