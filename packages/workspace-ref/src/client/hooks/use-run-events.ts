// packages/workspace-ref/src/client/hooks/use-run-events.ts
// AMEND-nexus-spec-workspace §3.6, §7.7 — SSE event consumer.
// Primary: SSE (preferred for browser). Fallback: GET polling.
// Event ticket: 60s TTL, single-use, minted after ACL check.

import { useState, useEffect, useCallback, useRef } from 'react';
import { mintEventTicket, getRunStatus, type RunStatus } from '../api.js';

export interface RunEvent {
  type: string;
  runId: string;
  data?: Record<string, unknown>;
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
  const sourceRef = useRef<EventSource | null>(null);
  const runIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const unsubscribe = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setConnected(false);
    runIdRef.current = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!runIdRef.current) return;
    try {
      const res = await getRunStatus(runIdRef.current);
      if (res.ok && res.data) setStatus(res.data);
    } catch {
      /* ignore */
    }
  }, []);

  const subscribe = useCallback(
    async (runId: string) => {
      unsubscribe();
      runIdRef.current = runId;
      setEvents([]);
      setError(null);

      try {
        // Mint event ticket (60s TTL, single-use) [§7.7]
        const ticketRes = await mintEventTicket(runId);
        if (!ticketRes.ok || !ticketRes.data) {
          // Fallback to polling if ticket mint fails
          setError('Event ticket failed — using polling');
          pollRef.current = setInterval(() => void refresh(), 3000);
          void refresh();
          return;
        }

        const { ticketId } = ticketRes.data;

        // SSE auth via `?ticket=` query string. EventSource can't set custom
        // headers, so the ticket rides the URL — server accepts header or
        // query param per spec §7.7 (same protocol-limit pattern as WS).
        const url = `/sse/runs/${runId}?ticket=${encodeURIComponent(ticketId)}`;
        const es = new EventSource(url);
        sourceRef.current = es;

        es.onopen = () => setConnected(true);
        es.onmessage = ev => {
          try {
            const event = JSON.parse(ev.data) as RunEvent;
            setEvents(prev => [...prev, event]);
            if (['run_status', 'compile_complete', 'final_response'].includes(event.type)) {
              void refresh();
            }
          } catch {
            /* skip malformed */
          }
        };
        es.onerror = () => {
          // EventSource auto-reconnects on transient drops, but the ticket
          // is single-use — once the server has consumed it the reconnect
          // will 401. Close cleanly and surface the state to the caller.
          setConnected(false);
          es.close();
          if (sourceRef.current === es) sourceRef.current = null;
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'SSE setup failed');
        // Fallback to polling
        pollRef.current = setInterval(() => void refresh(), 3000);
        void refresh();
      }
    },
    [unsubscribe, refresh]
  );

  // Initial status fetch when subscribed
  useEffect(() => {
    if (runIdRef.current) void refresh();
  }, [refresh]);

  // Cleanup on unmount
  useEffect(() => () => unsubscribe(), [unsubscribe]);

  return { events, status, connected, error, subscribe, unsubscribe, refresh };
}
