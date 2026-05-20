/**
 * Unit tests for JsonlLexiconMutationExecutor — F4.8 Phase 1.
 *
 * The executor is called by SigningCouncil once 2-of-2 distinct admin
 * signatures are reached. These tests verify the executor itself: it
 * rejects below-threshold and duplicate-signer signer arrays, appends
 * a canonical JSONL line, and emits the lexicon_mutation_applied
 * ledger event with the signer chain.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { LexiconMutation, NonEmpty, RunLedgerEntry, RunLedgerWriter } from '@nexus/contracts';
import { JsonlLexiconMutationExecutor } from './lexicon-mutation-executor.js';

class MockRunLedger implements RunLedgerWriter {
  public events: RunLedgerEntry[] = [];
  async writeEvent(e: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
    this.events.push({ ...e, entryId: 'mock-entry' as never });
  }
}

describe('JsonlLexiconMutationExecutor (F4.8 Phase 1)', () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lex-exec-'));
  });
  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  const goodMutation: LexiconMutation = {
    kind: 'entity_add',
    entity: {
      entityId: 'demo-entity' as NonEmpty,
      displayName: 'Demo' as NonEmpty,
      entityType: 'concept' as NonEmpty,
    },
  };
  const adminA = 'admin-a' as NonEmpty;
  const adminB = 'admin-b' as NonEmpty;

  it('LEX-MUT-03: 2 distinct signers → JSONL appended + ledger event written', async () => {
    const ledger = new MockRunLedger();
    const exec = new JsonlLexiconMutationExecutor({ runLedger: ledger, fixturesRoot: tmpRoot });
    const result = await exec.apply(goodMutation, [adminA, adminB]);
    expect(result.jsonlSeqNo).toBe(0);
    const file = path.join(tmpRoot, 'fixtures', 'lexicon', 'lexicon_entity.jsonl');
    const txt = await fs.readFile(file, 'utf-8');
    const lines = txt.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.mutation.kind).toBe('entity_add');
    expect(parsed.signers).toEqual([adminA, adminB]);
    expect(ledger.events.map(e => e.eventType)).toContain('lexicon_mutation_applied');
  });

  it('LEX-MUT-02 (mirror): below-threshold signers rejected; JSONL untouched', async () => {
    const ledger = new MockRunLedger();
    const exec = new JsonlLexiconMutationExecutor({ runLedger: ledger, fixturesRoot: tmpRoot });
    await expect(exec.apply(goodMutation, [adminA])).rejects.toThrow('LEXICON_BELOW_THRESHOLD');
    expect(ledger.events).toHaveLength(0);
  });

  it('LEX-MUT-04: duplicate signers rejected', async () => {
    const ledger = new MockRunLedger();
    const exec = new JsonlLexiconMutationExecutor({ runLedger: ledger, fixturesRoot: tmpRoot });
    await expect(exec.apply(goodMutation, [adminA, adminA])).rejects.toThrow(
      'LEXICON_DUPLICATE_SIGNERS'
    );
  });

  it('sequential applies increment jsonlSeqNo', async () => {
    const ledger = new MockRunLedger();
    const exec = new JsonlLexiconMutationExecutor({ runLedger: ledger, fixturesRoot: tmpRoot });
    const r1 = await exec.apply(goodMutation, [adminA, adminB]);
    const r2 = await exec.apply(goodMutation, [adminA, adminB]);
    expect(r2.jsonlSeqNo).toBe(r1.jsonlSeqNo + 1);
  });
});
