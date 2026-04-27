/**
 * Chain verifier — spec §16.2
 * Enforces hash linkage AND sequence continuity.
 * SEQUENCE_ANOMALY emitted here ONLY (SOLVE-010, CONTRA-509).
 */
import {
  GENESIS_HASH,
  DENIAL_CODE,
  type LedgerBackend,
  type Base64Url,
  type ChainVerificationResult,
  type ChainError,
} from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';
import { verify } from '../crypto/verifier.js';

export async function verifyChain(
  backend: LedgerBackend,
  fromSeq: number,
  toSeq: number,
  publicKey: Base64Url
): Promise<ChainVerificationResult> {
  const errors: ChainError[] = [];
  const records = await backend.listRange(fromSeq, toSeq);
  let prevHash =
    fromSeq === 1
      ? GENESIS_HASH
      : ((await backend.getBySequence(fromSeq - 1))?.recordHash ?? GENESIS_HASH);

  let expectedSeq = fromSeq;

  for (const record of records) {
    // Sequence continuity — SEQUENCE_ANOMALY emitted here only
    if (record.ledgerSequence !== expectedSeq) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'sequence_anomaly',
        denialCode: DENIAL_CODE.SEQUENCE_ANOMALY,
        detail: `Expected ledgerSequence ${expectedSeq}, got ${record.ledgerSequence}`,
      });
      expectedSeq = record.ledgerSequence;
    }

    // Hash chain
    if (record.previousHash !== prevHash) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'hash_chain_break',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `Hash chain break at seq ${record.ledgerSequence}`,
      });
    }

    // Signature — sig is over recordHash
    const sigValid = await verify(record.recordHash, record.signature, publicKey);
    if (!sigValid) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'signature_invalid',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `Signature invalid at seq ${record.ledgerSequence}`,
      });
    }

    // Re-compute recordHash
    const { recordHash: _, signature: __, ...body } = record;
    const computed = sha256(canonicalize(body));
    if (computed !== record.recordHash) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'hash_chain_break',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `recordHash mismatch at seq ${record.ledgerSequence}`,
      });
    }

    prevHash = record.recordHash;
    expectedSeq++;
  }

  // ─── Range completeness check (CHAIN-001) ─────────────────────────────────
  // A missing or corrupted terminal record must not silently pass.
  const expectedCount = toSeq - fromSeq + 1;
  if (records.length !== expectedCount) {
    errors.push({
      seq: toSeq,
      type: 'sequence_anomaly',
      denialCode: DENIAL_CODE.SEQUENCE_ANOMALY,
      detail: `Range incomplete: expected ${expectedCount} records (${fromSeq}–${toSeq}), got ${records.length}`,
    });
  }
  if (records.length > 0 && records[0]!.ledgerSequence !== fromSeq) {
    errors.push({
      seq: records[0]!.ledgerSequence,
      type: 'sequence_anomaly',
      denialCode: DENIAL_CODE.SEQUENCE_ANOMALY,
      detail: `First record sequence is ${records[0]!.ledgerSequence}, expected ${fromSeq}`,
    });
  }
  if (records.length > 0 && records[records.length - 1]!.ledgerSequence !== toSeq) {
    errors.push({
      seq: records[records.length - 1]!.ledgerSequence,
      type: 'sequence_anomaly',
      denialCode: DENIAL_CODE.SEQUENCE_ANOMALY,
      detail: `Last record sequence is ${records[records.length - 1]!.ledgerSequence}, expected ${toSeq}`,
    });
  }

  return {
    ok: errors.length === 0,
    checkedFrom: fromSeq,
    checkedTo: toSeq,
    recordCount: records.length,
    errors,
  };
}
