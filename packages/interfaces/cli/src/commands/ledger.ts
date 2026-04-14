import { JsonlLedgerBackend, verifyChain, loadControlPlaneKey } from '@nexus/core';
import path from 'node:path';
export async function cmdLedgerTail(opts: { n?: number }): Promise<void> {
  const n = opts.n ?? 20;
  const ledger = new JsonlLedgerBackend(path.join(process.cwd(), 'nexus.ledger.jsonl'));
  const latest = await ledger.getLatestSequence();
  const from = Math.max(1, latest - n + 1);
  const records = await ledger.listRange(from, latest);
  console.log(JSON.stringify({ ok: true, data: records }, null, 2));
}
export async function cmdLedgerVerify(opts: { from?: number; to?: number }): Promise<void> {
  const ledger = new JsonlLedgerBackend(path.join(process.cwd(), 'nexus.ledger.jsonl'));
  const kp = await loadControlPlaneKey();
  const from = opts.from ?? 1;
  const to = opts.to ?? (await ledger.getLatestSequence());
  const result = await verifyChain(ledger, from, to, kp.publicKey);
  console.log(JSON.stringify({ ok: true, data: result }, null, 2));
}
export async function cmdLedgerGet(recordId: string): Promise<void> {
  const ledger = new JsonlLedgerBackend(path.join(process.cwd(), 'nexus.ledger.jsonl'));
  const record = await ledger.getByRecordId(recordId);
  if (!record) {
    console.error(`✗ Record not found: ${recordId}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, data: record }, null, 2));
}
