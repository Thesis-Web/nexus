/**
 * Chain verifier — spec §16.2
 * Enforces hash linkage AND sequence continuity.
 * SEQUENCE_ANOMALY emitted here ONLY (SOLVE-010, CONTRA-509).
 */
import { GENESIS_HASH, DENIAL_CODE } from '../types/index.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';
import { verify } from '../crypto/verifier.js';
export async function verifyChain(backend, fromSeq, toSeq, publicKey) {
    const errors = [];
    const records = await backend.listRange(fromSeq, toSeq);
    let prevHash = fromSeq === 1
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
    return { ok: errors.length === 0, errors, checked: records.length };
}
