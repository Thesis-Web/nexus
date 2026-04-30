/**
 * Declared Output Slot Reader — AMEND-spec §6.7.1
 *
 * File: packages/core/src/output/declared-output-slot-reader.ts
 * Layer 1 — reads declared output slots from Run Ledger.
 *
 * Source of truth: Run Ledger orchestrator_dispatched.detail.selectedAgents[].expectedOutputSlots.
 * Nexus infra does not generate expected slots; it only validates actual slots
 * against what the orchestrator plugin declared.
 */
import type {
  Uuid,
  NonEmpty,
  DenialCode,
  OutputSlotPolicy,
  RunLedgerWriter,
} from '@nexus/contracts';
import { DENIAL_CODE } from '@nexus/contracts';

export interface SlotValidationResult {
  policy: OutputSlotPolicy;
  declared: boolean;
  matched: boolean;
  reason: DenialCode | null;
}

export interface DeclaredOutputSlotReader {
  validate(
    runId: Uuid,
    taskId: Uuid,
    slotId: NonEmpty,
    policy: OutputSlotPolicy
  ): Promise<SlotValidationResult>;
}

/**
 * Implementation that reads from Run Ledger orchestrator_dispatched events.
 */
export class RunLedgerSlotReader implements DeclaredOutputSlotReader {
  private readonly ledger: RunLedgerWriter;

  constructor(ledger: RunLedgerWriter) {
    this.ledger = ledger;
  }

  async validate(
    runId: Uuid,
    taskId: Uuid,
    slotId: NonEmpty,
    policy: OutputSlotPolicy
  ): Promise<SlotValidationResult> {
    if (policy === 'open_slots') {
      return { policy, declared: false, matched: true, reason: null };
    }

    const entries = await this.ledger.getByRunId(runId);
    const dispatchEntry = entries.find(e => e.eventType === 'orchestrator_dispatched');

    if (dispatchEntry === undefined) {
      // No dispatch record — cannot validate
      if (policy === 'strict_declared_slots') {
        return {
          policy,
          declared: false,
          matched: false,
          reason: DENIAL_CODE.UNDECLARED_OUTPUT_SLOT,
        };
      }
      return { policy, declared: false, matched: false, reason: null };
    }

    const detail = dispatchEntry.detail as Record<string, unknown>;
    const agents = (detail['selectedAgents'] ?? []) as Array<{
      taskId: string;
      expectedOutputSlots?: string[];
    }>;

    const taskAgent = agents.find(a => a.taskId === taskId);
    if (taskAgent === undefined || taskAgent.expectedOutputSlots === undefined) {
      if (policy === 'strict_declared_slots') {
        return {
          policy,
          declared: false,
          matched: false,
          reason: DENIAL_CODE.UNDECLARED_OUTPUT_SLOT,
        };
      }
      return { policy, declared: false, matched: false, reason: null };
    }

    const declared = taskAgent.expectedOutputSlots.includes(slotId);
    if (!declared && policy === 'strict_declared_slots') {
      return {
        policy,
        declared: false,
        matched: false,
        reason: DENIAL_CODE.UNDECLARED_OUTPUT_SLOT,
      };
    }

    return { policy, declared, matched: declared, reason: null };
  }
}
