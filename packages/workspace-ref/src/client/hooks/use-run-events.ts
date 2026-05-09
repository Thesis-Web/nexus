// packages/workspace-ref/src/client/hooks/use-run-events.ts
// AMEND-nexus-spec-workspace §3.6, §7.7 — SSE event consumer.
// Primary: SSE (preferred for browser). Fallback: GET polling.
// Event ticket: 60s TTL, single-use, minted after ACL check.
//
// CLAUDE-CODE-FIX-SSE-AND-PLAN-REVIEW BUG-1 lifecycle hardening:
//   - Each subscribe() bumps a token. EventSource handlers gate on the
//     token + identity, so a late onmessage / onerror from a prior
//     subscription cannot corrupt the current one.
//   - onerror checks staleness BEFORE side effects, so a stale es1.onerror
//     that fires after es2 has replaced sourceRef does NOT flip the new
//     subscription's connected state to false.
//   - mint failures stay surfaced via `error`; the polling fallback runs
//     until the next subscribe() call so the operator sees status updates
//     instead of a frozen timeline.

import { useState, useEffect, useCallback, useRef } from 'react';
import { mintEventTicket, getRunStatus, type RunStatus } from '../api.js';

export interface RunEvent {
  type: string;
  runId: string;
  /**
   * Run-ledger event payload. Matches the server-side `RunLedgerEntry.detail`
   * shape as broadcast by `/sse/runs/:runId` (run-event-bus.ts). Field name
   * was historically `data`; aligned to `detail` so the SSE wire and the
   * ledger schema use the same key.
   */
  detail?: Record<string, unknown>;
  timestamp?: string;
}

export interface UseRunEventsResult {
  events: RunEvent[];
  status: RunStatus | null;
  connected: boolean;
  error: string | null;
  subscribe: (runId: string) => void;
  unsubscribe: () => void;
  refresh: () => void;
}

export function useRunEvents(): UseRunEventsResult {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active EventSource (or null when polling-only / unsubscribed).
  const sourceRef = useRef<EventSource | null>(null);
  // The runId currently subscribed.
  const runIdRef = useRef<string | null>(null);
  // Polling fallback handle (used when the ticket mint fails).
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Subscription token — increments on every subscribe() call. Async
  // handlers (mint, onmessage, onerror) compare against this to detect
  // late callbacks from a previous subscription and discard them.
  const tokenRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const unsubscribe = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    stopPolling();
    setConnected(false);
    runIdRef.current = null;
  }, [stopPolling]);

  const refresh = useCallback(async () => {
    if (!runIdRef.current) return;
    try {
      const res = await getRunStatus(runIdRef.current);
      if (res.ok && res.data) setStatus(res.data);
    } catch {
      /* refresh is best-effort — the next tick will retry via SSE/poll */
    }
  }, []);

  const subscribe = useCallback(
    async (runId: string) => {
      // Bump the token FIRST so any in-flight async handlers from the
      // previous subscription bail out as soon as they wake up.
      const token = ++tokenRef.current;

      // Tear down the old subscription synchronously. Note: `unsubscribe`
      // also nulls runIdRef and clears `connected`, so the UI doesn't show
      // stale state during the awaited mint below.
      unsubscribe();

      runIdRef.current = runId;
      setEvents([]);
      setError(null);
      setStatus(null);

      let ticketRes: Awaited<ReturnType<typeof mintEventTicket>>;
      try {
        // Mint event ticket (60s TTL, single-use) [§7.7]
        ticketRes = await mintEventTicket(runId);
      } catch (err) {
        if (tokenRef.current !== token) return; // superseded mid-flight
        setError(
          'Event stream unavailable — falling back to status polling. ' +
            (err instanceof Error ? err.message : 'Network error.')
        );
        startPolling(token);
        return;
      }

      // A newer subscribe() call has superseded us — abandon quietly.
      if (tokenRef.current !== token) return;

      if (!ticketRes.ok || !ticketRes.data) {
        setError(
          'Event stream unavailable — falling back to status polling. ' +
            (ticketRes.error ?? 'Ticket mint failed.')
        );
        startPolling(token);
        return;
      }

      const { ticketId } = ticketRes.data;

      // SSE auth via `?ticket=` query string. EventSource can't set custom
      // headers, so the ticket rides the URL — server accepts header or
      // query param per spec §7.7 (same protocol-limit pattern as WS).
      const url = `/sse/runs/${runId}?ticket=${encodeURIComponent(ticketId)}`;
      const es = new EventSource(url);
      sourceRef.current = es;

      es.onopen = () => {
        // Ignore late open events from a stale EventSource (a faster
        // resubscribe replaced us before this fired).
        if (tokenRef.current !== token || sourceRef.current !== es) return;
        setConnected(true);
      };

      es.onmessage = ev => {
        // Reject events from stale subscriptions or after unsubscribe —
        // critical for run boundaries: an es1 message that arrives after
        // we've subscribed to run2 must NOT be mixed into run2's events.
        if (tokenRef.current !== token || sourceRef.current !== es) return;
        try {
          const event = JSON.parse(ev.data) as RunEvent;
          if (event.runId !== runIdRef.current) return; // wrong run; skip
          setEvents(prev => [...prev, event]);
          if (['run_status', 'compile_complete', 'final_response'].includes(event.type)) {
            void refresh();
          }
        } catch {
          /* skip malformed line — server-side fanout already validated structure */
        }
      };

      es.onerror = () => {
        // Staleness check FIRST. Without this, a delayed onerror from a
        // prior EventSource (es1) flips the new subscription's connected
        // state to false even though es2 is healthy — the operator sees a
        // dead timeline despite events flowing on the wire.
        if (tokenRef.current !== token || sourceRef.current !== es) {
          // Stale handler; close defensively (idempotent) but don't touch
          // shared state.
          es.close();
          return;
        }
        // Live error on the current subscription. The browser may auto-
        // reconnect EventSource, but our ticket is single-use so any
        // reconnect would 401. Close cleanly and let the next subscribe()
        // mint a fresh ticket.
        sourceRef.current = null;
        setConnected(false);
        es.close();
        // Surface the disconnect — the UI should know SSE has dropped, even
        // if the run is already complete and replay delivered all events.
        setError(prev => prev ?? 'Event stream disconnected.');
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [unsubscribe, refresh]
  );

  // Polling fallback — only runs when SSE is unavailable. Cancels itself
  // automatically when the subscription token bumps (next subscribe call).
  function startPolling(token: number): void {
    void refresh();
    pollRef.current = setInterval(() => {
      if (tokenRef.current !== token) {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        return;
      }
      void refresh();
    }, 3000);
  }

  // Cleanup on unmount — close any open EventSource and drop polling.
  useEffect(
    () => () => {
      tokenRef.current++;
      unsubscribe();
    },
    [unsubscribe]
  );

  return { events, status, connected, error, subscribe, unsubscribe, refresh };
}
