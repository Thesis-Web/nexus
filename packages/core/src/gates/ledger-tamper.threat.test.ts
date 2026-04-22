/**
 * Threat test 3 — Ledger Tamper Detection
 * Spec §16.2, §27.2 item 3
 * verifyChain(backend, fromSeq, toSeq, publicKey) — result.errors[] is the anomaly list.
 * SEQUENCE_ANOMALY emitted here only (SOLVE-010).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedgerBackend } from '../ledger/backends/jsonl.backend.js';
import { verifyChain } from '../ledger/chain-verifier.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { nowIso } from '../utils/time.js';
import type { EvidenceRecord, KeyPair } from '../types/index.js';

let controlPlanePair: KeyPair;
beforeAll(async () => {
  controlPlanePair = await loadControlPlaneKey();
});

const tmpPaths: string[] = [];
afterEach(async () => {
  for (const p of tmpPaths) await fs.unlink(p).catch(() => {});
  tmpPaths.length = 0;
});

function makeLedgerPath(): string {
  const p = path.join(os.tmpdir(), 'nexus-ledger-tamper-' + randomUUID() + '.jsonl');
  tmpPaths.push(p);
  return p;
}

function makeRecord(seq: number, prevHash: string | null, recordHash: string): EvidenceRecord {
  return {
    recordId: randomUUID(),
    ledgerSequence: seq,
    actionSummary: {
      actionId: randomUUID(),
      receivedAt: nowIso(),
      protocol: 'test',
      actorId: randomUUID(),
      actorClass: 'SUPERVISED_AGENT',
      actorEnvironment: 'dev',
      principalId: randomUUID(),
      delegationSequence: seq,
    },
    gateDecisions: [],
    policyRuleId: null,
    policyOutcome: null,
    approvalRequest: null,
    approvalResponse: null,
    grantMetadata: null,
    executionResult: null,
    finalOutcome: 'executed',
    threatEvents: [],
    previousHash: prevHash,
    compilerView: null as any,
    recordHash,
    signature: 'fixture-sig',
  } as unknown as EvidenceRecord;
}

describe('Threat: Ledger Tamper Detection (spec §16.2)', () => {
  it('detects sequence gap between records (SEQUENCE_ANOMALY)', async () => {
    const backend = new JsonlLedgerBackend(makeLedgerPath());
    await backend.append(makeRecord(1, null, 'hash-001'));
    await backend.append(makeRecord(3, 'hash-001', 'hash-003')); // gap: seq 2 missing
    const result = await verifyChain(backend, 1, 3, controlPlanePair.publicKey);
    expect(result.errors.filter(e => e.type === 'sequence_anomaly').length).toBeGreaterThan(0);
  });

  it('detects previousHash mismatch (tampered link)', async () => {
    const backend = new JsonlLedgerBackend(makeLedgerPath());
    await backend.append(makeRecord(1, null, 'hash-001'));
    await backend.append(makeRecord(2, 'TAMPERED-PREV-HASH', 'hash-002'));
    const result = await verifyChain(backend, 1, 2, controlPlanePair.publicKey);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('sequence regression is detected', async () => {
    const backend = new JsonlLedgerBackend(makeLedgerPath());
    await backend.append(makeRecord(1, null, 'hash-001'));
    await backend.append(makeRecord(2, 'hash-001', 'hash-002'));
    await backend.append(makeRecord(1, 'hash-002', 'hash-001b')); // regression
    const result = await verifyChain(backend, 1, 2, controlPlanePair.publicKey);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
