// packages/contracts/src/externals/output-contract.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.7, §3.8 — OutputContract + OutputCollector
// Layer 2 — output contract metadata and output collector interface.
//
// OutputContract is metadata, not payload. Run Ledger stores OutputContract
// reference/digest by runId. Payloads live behind MailboxItem resultRef.
//
// Digest law:
//   contractDigest = sha256(canonicalize({
//     outputContractId, runId, mailboxId, mailboxItems,
//     inputDataClasses, inheritedCompileDataClass, compileEligibility,
//     runLedgerRefs, evidenceRefs, routingTrailRefs, createdAt
//   }))
//
// OutputCollector law:
// - Only lawful writer from engine/orchestrator results into mailbox.
// - Engine outputs are adapted into output references at the composition boundary.
// - Must write or cause a Run Ledger partial_result event for every
//   successful mailbox write.

import type { Uuid, IsoTimestamp, Sha256Hex, NonEmpty } from '../types/index.js';
import type { DataClass, DenialCode } from '../constants/index.js';
import type { MailboxItem, MailboxWriteContext } from './mailbox.js';
import type {
  NvgOutputReference,
  NxsOutputReference,
  AgentPartialOutputReference,
} from './output-references.js';

// ─── CompileEligibility ───

export interface CompileEligibility {
  deterministic: true;
  onPremSynthesis: boolean;
  frontierSynthesis: boolean;
  denialReason?: DenialCode;
}

// ─── OutputContract ───

export interface OutputContract {
  outputContractId: Uuid;
  runId: Uuid;
  mailboxId: NonEmpty;
  mailboxItems: Uuid[];
  inputDataClasses: DataClass[];
  inheritedCompileDataClass: DataClass;
  compileEligibility: CompileEligibility;
  runLedgerRefs: Uuid[];
  evidenceRefs: Uuid[];
  routingTrailRefs: Uuid[];
  createdAt: IsoTimestamp;
  contractDigest: Sha256Hex;
}

// ─── OutputCollector ───

export interface OutputCollector {
  // AMEND-nexus-mailbox-pit-v0-2-1 §3.6 — every write carries a typed
  // MailboxWriteContext so the callsite explicitly declares which mailbox
  // + actor it is writing for. The underlying MailboxService.writeFromOutput
  // call asserts the mailboxId belongs to the producerActorId under runId
  // (fail-closed on mismatch).
  writeMailboxItemFromNvgResult(
    input: NvgOutputReference,
    ctx: MailboxWriteContext
  ): Promise<MailboxItem>;
  writeMailboxItemFromNxsResult(
    input: NxsOutputReference,
    ctx: MailboxWriteContext
  ): Promise<MailboxItem>;
  writeMailboxItemFromAgentPartial(
    input: AgentPartialOutputReference,
    ctx: MailboxWriteContext
  ): Promise<MailboxItem>;
  buildOutputContract(runId: Uuid): Promise<OutputContract>;
}
