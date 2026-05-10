/**
 * Output Collector — AMEND-spec §6.7, §3.8
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
 */
import { randomUUID } from 'node:crypto';
import type {
  OutputCollector as IOutputCollector,
  OutputContract,
  MailboxItem,
  MailboxService,
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
  mailboxId: NonEmpty;
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

  async writeMailboxItemFromNvgResult(input: NvgOutputReference): Promise<MailboxItem> {
    if (input.sourceType !== 'nvg_result') {
      throw new Error('Expected sourceType nvg_result');
    }
    await this.verifyDigest(input.resultRef, input.resultDigest);
    await this.validateSlot(input.runId, input.taskId, input.slotId);

    const item = await this.deps.mailboxService.writeFromOutput({
      mailboxId: this.deps.mailboxId,
      output: input,
      expiresAt: this.getExpiresAt(),
      runLedgerEventId: null,
    });

    await this.writePartialResultEvent(item, input);
    return item;
  }

  async writeMailboxItemFromNxsResult(input: NxsOutputReference): Promise<MailboxItem> {
    if (input.sourceType !== 'nxs_execution_result') {
      throw new Error('Expected sourceType nxs_execution_result');
    }
    await this.verifyDigest(input.resultRef, input.resultDigest);
    await this.validateSlot(input.runId, input.taskId, input.slotId);

    const item = await this.deps.mailboxService.writeFromOutput({
      mailboxId: this.deps.mailboxId,
      output: input,
      expiresAt: this.getExpiresAt(),
      runLedgerEventId: null,
    });

    await this.writePartialResultEvent(item, input);
    return item;
  }

  async writeMailboxItemFromAgentPartial(input: AgentPartialOutputReference): Promise<MailboxItem> {
    if (input.sourceType !== 'agent_partial') {
      throw new Error('Expected sourceType agent_partial');
    }
    await this.verifyDigest(input.resultRef, input.resultDigest);
    await this.validateSlot(input.runId, input.taskId, input.slotId);

    const item = await this.deps.mailboxService.writeFromOutput({
      mailboxId: this.deps.mailboxId,
      output: input,
      expiresAt: this.getExpiresAt(),
      runLedgerEventId: null,
    });

    await this.writePartialResultEvent(item, input);
    return item;
  }

  async buildOutputContract(runId: Uuid): Promise<OutputContract> {
    const items = await this.deps.mailboxService.listEligibleForCompile(this.deps.mailboxId, runId);

    if (items.length === 0) {
      throw new Error(
        `${DENIAL_CODE.OUTPUT_CONTRACT_EMPTY}: no eligible mailbox items for run '${runId}'`
      );
    }

    const contract = buildOutputContractFromItems(runId, this.deps.mailboxId, items);

    // Write compile_started ledger event (§6.7)
    await this.deps.ledgerWriter.writeEvent({
      runId,
      eventType: 'compile_started',
      timestamp: nowIso(),
      actorId: null,
      detail: {
        compilerSocketId: null,
        mailboxId: this.deps.mailboxId,
        outputContractId: contract.outputContractId,
        contractDigest: contract.contractDigest,
        mailboxItemCount: items.length,
        inputDataClasses: contract.inputDataClasses,
        inheritedCompileDataClass: contract.inheritedCompileDataClass,
      },
    });

    return contract;
  }

  // ─── Private helpers ───

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
