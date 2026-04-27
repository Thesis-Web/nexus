import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { JsonlLedgerBackend } from './backends/jsonl.backend.js';
import { JsonlRunLedgerWriter } from './run-ledger.js';
import type { EvidenceRecord, RunLedgerEntry, Uuid } from '../types/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexus-ledger-malformed-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function evidenceRecord(): EvidenceRecord {
  return {
    recordId: '11111111-1111-4111-8111-111111111111' as Uuid,
    runId: '22222222-2222-4222-8222-222222222222' as Uuid,
    actionId: '33333333-3333-4333-8333-333333333333' as Uuid,
    gateId: 'gate-07',
    gateOrder: 7,
    plane: 'control',
    outcome: 'allow',
    reason: 'test',
    denialCode: null,
    policyRuleId: null,
    evaluatedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1,
    metadata: {},
    ledgerSequence: 1,
    previousHash: null,
    recordHash: 'hash',
    signature: 'sig',
  } as EvidenceRecord;
}

function runEntry(): RunLedgerEntry {
  return {
    entryId: '44444444-4444-4444-8444-444444444444' as Uuid,
    runId: '22222222-2222-4222-8222-222222222222' as Uuid,
    eventType: 'mode_change',
    timestamp: '2026-01-01T00:00:00.000Z',
    actorId: null,
    detail: { ok: true },
  } as RunLedgerEntry;
}

describe('LEDGER-001 — malformed JSONL fail-closed', () => {
  it('evidence ledger listRange throws on malformed non-empty line', async () => {
    const file = join(dir, 'evidence.jsonl');
    await writeFile(file, `${JSON.stringify(evidenceRecord())}\n{bad-json}\n`, 'utf-8');

    const backend = new JsonlLedgerBackend(file);
    await expect(backend.listRange(1, 10)).rejects.toThrow(
      'malformed evidence ledger line in listRange'
    );
  });

  it('evidence ledger getByRecordId throws on malformed non-empty line', async () => {
    const file = join(dir, 'evidence.jsonl');
    await writeFile(file, `${JSON.stringify(evidenceRecord())}\n{bad-json}\n`, 'utf-8');

    const backend = new JsonlLedgerBackend(file);
    await expect(
      backend.getByRecordId('99999999-9999-4999-8999-999999999999' as Uuid)
    ).rejects.toThrow('malformed evidence ledger line in getByRecordId');
  });

  it('evidence ledger getLatestSequence throws when latest non-empty line is malformed', async () => {
    const file = join(dir, 'evidence.jsonl');
    await writeFile(file, `${JSON.stringify(evidenceRecord())}\n{bad-json}\n`, 'utf-8');

    const backend = new JsonlLedgerBackend(file);
    await expect(backend.getLatestSequence()).rejects.toThrow(
      'malformed evidence ledger line in getLatestSequence'
    );
  });

  it('run ledger reader throws on malformed non-empty line', async () => {
    const file = join(dir, 'run.jsonl');
    await writeFile(file, `${JSON.stringify(runEntry())}\n{bad-json}\n`, 'utf-8');

    const writer = new JsonlRunLedgerWriter(file);
    await expect(writer.getByRunId('22222222-2222-4222-8222-222222222222' as Uuid)).rejects.toThrow(
      'malformed run-ledger line'
    );
  });

  it('blank lines are still ignored', async () => {
    const evidenceFile = join(dir, 'evidence.jsonl');
    const runFile = join(dir, 'run.jsonl');

    await writeFile(evidenceFile, `\n${JSON.stringify(evidenceRecord())}\n\n`, 'utf-8');
    await writeFile(runFile, `\n${JSON.stringify(runEntry())}\n\n`, 'utf-8');

    const backend = new JsonlLedgerBackend(evidenceFile);
    const writer = new JsonlRunLedgerWriter(runFile);

    await expect(backend.listRange(1, 10)).resolves.toHaveLength(1);
    await expect(
      writer.getByRunId('22222222-2222-4222-8222-222222222222' as Uuid)
    ).resolves.toHaveLength(1);
  });
});
