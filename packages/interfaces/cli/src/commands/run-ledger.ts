/**
 * CLI run-ledger commands — spec §22.1
 * nexus run-ledger tail [--n N]   — show last N run ledger entries
 * nexus run-ledger get <run-id>   — get run ledger for specific run
 */
import { JsonlRunLedgerWriter } from '@nexus/core';
import type { Uuid } from '@nexus/core';
import * as path from 'path';

// Default run ledger path — integration tests write here, cmdRun writes per-run.
// For tail/get we scan the most recent run directory or infra ledger.
const INFRA_RUN_LEDGER_PATH = path.join('runs', 'infra.run-ledger.jsonl');

export async function cmdRunLedgerTail(opts: { n?: number }): Promise<void> {
  const n = opts.n ?? 20;
  const ledger = new JsonlRunLedgerWriter(INFRA_RUN_LEDGER_PATH);
  const entries = await ledger.tail(n);
  if (entries.length === 0) {
    console.log('No run ledger entries found.');
    return;
  }
  for (const entry of entries) {
    console.log(
      `[${entry.timestamp}] ${entry.eventType} | run=${entry.runId.slice(0, 12)}... | ${JSON.stringify(entry.detail)}`
    );
  }
  console.log(`\n${entries.length} entries shown (of last ${n} requested)`);
}

export async function cmdRunLedgerGet(runId: string): Promise<void> {
  const ledger = new JsonlRunLedgerWriter(INFRA_RUN_LEDGER_PATH);
  const entries = await ledger.getByRunId(runId as Uuid);
  if (entries.length === 0) {
    console.log(`No entries found for run ${runId}`);
    return;
  }
  for (const entry of entries) {
    console.log(JSON.stringify(entry, null, 2));
  }
  console.log(`\n${entries.length} entries for run ${runId}`);
}
