/**
 * Run Ledger Writer (JSONL) — spec §30
 * Append-only. Cross-linked by runId. JSONL format matches evidence ledger pattern.
 * Layer 1 — implements RunLedgerWriter from contracts (Layer 2).
 *
 * §30.1: RunLedgerWriter interface (writeEvent, getByRunId, tail, getLatestRunId)
 * §30.2: Mandatory for all runs including NVG-bypass
 * §30.3: NVG bypass annotation via 'bypass_annotation' event
 */
import { promises as fs } from 'fs';
import type { RunLedgerWriter, RunLedgerEntry, Uuid } from '../types/index.js';
import { newUuid } from '../utils/time.js';

export class JsonlRunLedgerWriter implements RunLedgerWriter {
  constructor(private readonly filePath: string) {}

  async writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
    const full: RunLedgerEntry = {
      entryId: newUuid() as Uuid,
      ...entry,
    };
    await fs.appendFile(this.filePath, JSON.stringify(full) + '\n', 'utf-8');
  }

  async getByRunId(runId: Uuid): Promise<RunLedgerEntry[]> {
    const all = await this.readAll();
    return all.filter(e => e.runId === runId);
  }

  async tail(n: number): Promise<RunLedgerEntry[]> {
    const all = await this.readAll();
    return all.slice(-n);
  }

  async getLatestRunId(): Promise<Uuid | null> {
    const all = await this.readAll();
    if (all.length === 0) return null;
    return all[all.length - 1]!.runId;
  }

  private async readAll(): Promise<RunLedgerEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf-8');
    } catch {
      return [];
    }
    const results: RunLedgerEntry[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        results.push(JSON.parse(line) as RunLedgerEntry);
      } catch (err) {
        // RUNLEDGER-003 FIX: log malformed line instead of silent skip
        console.error(
          `[JsonlRunLedgerWriter] malformed run-ledger line skipped: ${(err as Error).message}`
        );
        continue;
      }
    }
    return results;
  }
}
