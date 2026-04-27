/**
 * JSONL ledger backend (Backend v1) — spec §16.1
 * Append-only. No DELETE or UPDATE. MODULAR-003.
 */
import { promises as fs } from 'fs';
import type { LedgerBackend, EvidenceRecord, Uuid } from '../../types/index.js';

export class JsonlLedgerBackend implements LedgerBackend {
  readonly backendId = 'jsonl-v1';
  readonly backendVersion = 'v1.0.0'; // LEDGER-002 FIX: align with spec §16.1

  constructor(private readonly ledgerPath: string) {}

  async append(record: EvidenceRecord): Promise<void> {
    await fs.appendFile(this.ledgerPath, JSON.stringify(record) + '\n', 'utf-8');
  }

  async listRange(from: number, to: number): Promise<EvidenceRecord[]> {
    const results: EvidenceRecord[] = [];
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf-8');
    } catch {
      return [];
    }
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const record = JSON.parse(line) as EvidenceRecord;
        if (record.ledgerSequence >= from && record.ledgerSequence <= to) results.push(record);
      } catch (err) {
        // LEDGER-001 FIX: log malformed line instead of silent skip
        console.error(
          `[JsonlLedgerBackend] malformed ledger line skipped in listRange: ${(err as Error).message}`
        );
        continue;
      }
    }
    return results;
  }

  async getBySequence(seq: number): Promise<EvidenceRecord | null> {
    return (await this.listRange(seq, seq))[0] ?? null;
  }

  async getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf-8');
    } catch {
      return null;
    }
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        const record = JSON.parse(line) as EvidenceRecord;
        if (record.recordId === recordId) return record;
      } catch (err) {
        // LEDGER-001 FIX: log malformed line instead of silent skip
        console.error(
          `[JsonlLedgerBackend] malformed ledger line skipped in getByRecordId: ${(err as Error).message}`
        );
        continue;
      }
    }
    return null;
  }

  async getLatestSequence(): Promise<number> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf-8');
    } catch {
      return 0;
    }
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return 0;
    try {
      return (JSON.parse(lines[lines.length - 1]!) as EvidenceRecord).ledgerSequence;
    } catch (err) {
      // LEDGER-001 FIX: log malformed last line instead of silent fallback
      console.error(
        `[JsonlLedgerBackend] malformed last ledger line in getLatestSequence: ${(err as Error).message}`
      );
      return 0;
    }
  }
}
