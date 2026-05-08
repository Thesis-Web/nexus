/**
 * Run Event Bus — Layer 7 reference harness.
 *
 * Per-runId fanout for the workspace SSE stream. Every RunLedgerWriter that
 * is wrapped with `wrapWriterWithFanout` will, after persisting an event,
 * broadcast a `data: { type, runId, timestamp, detail }` line to every
 * Express response currently subscribed to that runId.
 *
 * Why two writers, one bus: bootstrap and serve each construct their own
 * `JsonlRunLedgerWriter`. They write to the same file but they are distinct
 * instances (OutputCollector + reference compile chain hold the bootstrap
 * one; the workspace + orchestrator coordinator hold the serve one). To
 * deliver every event to the SSE stream, BOTH writers are wrapped against
 * this shared, module-level subscribers Map.
 *
 * The bus broadcasts the event payload synchronously after the underlying
 * writer's append resolves. Fanout failures are swallowed so a dead
 * EventSource never poisons the writer.
 */
import type { Response } from 'express';
import type { RunLedgerEntry, RunLedgerWriter, Uuid } from '@nexus/contracts';

const subscribers = new Map<string, Set<Response>>();

/**
 * Register an SSE response for fanout on a given runId. Returns an
 * unsubscribe function — call it from the request's close handler.
 */
export function subscribeToRun(runId: string, res: Response): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(res);
  return () => {
    const current = subscribers.get(runId);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) subscribers.delete(runId);
  };
}

/**
 * Push one ledger event out to every subscriber for that runId. Each
 * dropped/dead connection is ignored — connection cleanup happens via the
 * Express request close handler that called subscribeToRun.
 */
export function broadcastRunEvent(entry: Omit<RunLedgerEntry, 'entryId'>): void {
  const subs = subscribers.get(entry.runId);
  if (!subs || subs.size === 0) return;
  const payload = JSON.stringify({
    type: entry.eventType,
    runId: entry.runId,
    timestamp: entry.timestamp,
    detail: entry.detail,
  });
  const line = 'data: ' + payload + '\n\n';
  for (const res of subs) {
    try {
      res.write(line);
    } catch {
      // dead writable — request close handler will reap on its own
    }
  }
}

/**
 * Decorate a RunLedgerWriter so every successful writeEvent call also
 * broadcasts to the bus. The wrapper is structural — getByRunId, tail, and
 * getLatestRunId are passed through unchanged.
 */
export function wrapWriterWithFanout(writer: RunLedgerWriter): RunLedgerWriter {
  return {
    async writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
      await writer.writeEvent(entry);
      try {
        broadcastRunEvent(entry);
      } catch {
        // never let fanout failure block the persisted write
      }
    },
    getByRunId: (runId: Uuid) => writer.getByRunId(runId),
    tail: (n: number) => writer.tail(n),
    getLatestRunId: () => writer.getLatestRunId(),
  };
}
