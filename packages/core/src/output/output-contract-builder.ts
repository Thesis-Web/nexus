/**
 * Output Contract Builder — AMEND-spec §6.7, §3.7, §8.1
 *
 * File: packages/core/src/output/output-contract-builder.ts
 * Layer 1 — builds OutputContract from eligible mailbox items.
 *
 * Digest law:
 *   contractDigest = sha256(canonicalize({
 *     outputContractId, runId, mailboxId, mailboxItems,
 *     inputDataClasses, inheritedCompileDataClass, compileEligibility,
 *     runLedgerRefs, evidenceRefs, routingTrailRefs, createdAt
 *   }))
 */
import { randomUUID } from 'node:crypto';
import type {
  OutputContract,
  CompileEligibility,
  MailboxItem,
  NonEmpty,
  Uuid,
  DataClass,
} from '@nexus/contracts';
import { nowIso, DATA_CLASS_ORDER, isSensitiveDataClass, DENIAL_CODE } from '@nexus/contracts';
import { sha256Canonical } from './output-digest.js';

/**
 * Compute the compile OCT ceiling from input data classes (§8.1).
 * Returns the highest-sensitivity data class present.
 */
function computeCompileOctCeiling(inputDataClasses: DataClass[]): DataClass {
  if (inputDataClasses.length === 0) {
    throw new Error('inputDataClasses must be non-empty');
  }
  let maxIdx = 0;
  for (const dc of inputDataClasses) {
    const idx = DATA_CLASS_ORDER.indexOf(dc);
    if (idx < 0) {
      throw new Error(`Unknown data class: '${dc}'`);
    }
    if (idx > maxIdx) maxIdx = idx;
  }
  return DATA_CLASS_ORDER[maxIdx]!;
}

export function buildOutputContractFromItems(
  runId: Uuid,
  mailboxId: NonEmpty,
  items: MailboxItem[]
): OutputContract {
  const inputDataClasses = [...new Set(items.flatMap(i => i.resultClassifications))];

  const inherited = computeCompileOctCeiling(
    inputDataClasses.length > 0 ? inputDataClasses : ['internal']
  );

  const frontierAllowed = !inputDataClasses.some(isSensitiveDataClass);

  const compileEligibility: CompileEligibility = {
    deterministic: true,
    onPremSynthesis: true,
    frontierSynthesis: frontierAllowed,
  };

  if (!frontierAllowed) {
    compileEligibility.denialReason = DENIAL_CODE.COMPILE_FRONTIER_DENIED;
  }

  const outputContractId = randomUUID() as Uuid;
  const createdAt = nowIso();

  const runLedgerRefs = items.map(i => i.runLedgerEventId).filter((id): id is Uuid => id !== null);
  const evidenceRefs = items.map(i => i.evidenceRecordId).filter((id): id is Uuid => id !== null);
  const routingTrailRefs = items
    .map(i => i.routingTrailRecordId)
    .filter((id): id is Uuid => id !== null);

  const contractDigest = sha256Canonical({
    outputContractId,
    runId,
    mailboxId,
    mailboxItems: items.map(i => i.mailboxItemId),
    inputDataClasses,
    inheritedCompileDataClass: inherited,
    compileEligibility,
    runLedgerRefs,
    evidenceRefs,
    routingTrailRefs,
    createdAt,
  });

  return {
    outputContractId,
    runId,
    mailboxId,
    mailboxItems: items.map(i => i.mailboxItemId),
    inputDataClasses,
    inheritedCompileDataClass: inherited,
    compileEligibility,
    runLedgerRefs,
    evidenceRefs,
    routingTrailRefs,
    createdAt,
    contractDigest,
  };
}
