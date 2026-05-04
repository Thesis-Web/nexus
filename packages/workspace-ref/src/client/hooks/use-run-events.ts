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
    } catch { /* ignore */ }
  }, []);

  const subscribe = useCallback(async (runId: string) => {
    unsubscribe();
    runIdRef.current = runId;
    setEvents([]);
    setError(null);

    try {
      // Mint event ticket (60s TTL, single-use)
      const ticketRes = await mintEventTicket(runId);
      if (!ticketRes.ok || !ticketRes.data) {
        // Fallback to polling if ticket mint fails
        setError('Event ticket failed — using polling');
        pollRef.current = setInterval(() => void refresh(), 3000);
        void refresh();
        return;
      }

      const { ticketId } = ticketRes.data;

      // SSE connection with ticket as Bearer auth
      const url = `/sse/runs/${runId}`;
      const es = new EventSource(url, {
        // Note: EventSource doesn't support custom headers natively.
        // We fall back to query param for the reference implementation.
      });

      // For reference impl: use fetch-based SSE since EventSource can't set headers
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${ticketId}` },
      });

      if (!response.ok || !response.body) {
        setError('SSE connection failed — using polling');
        pollRef.current = setInterval(() => void refresh(), 3000);
        void refresh();
        return;
      }

      setConnected(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const readLoop = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6)) as RunEvent;
                setEvents(prev => [...prev, event]);

                // Auto-refresh status on key events
                if (['run_status', 'compile_complete', 'final_response'].includes(event.type)) {
                  void refresh();
                }
              } catch { /* skip malformed */ }
            }
          }
        }
        setConnected(false);
      };

      void readLoop();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSE setup failed');
      // Fallback to polling
      pollRef.current = setInterval(() => void refresh(), 3000);
      void refresh();
    }
  }, [unsubscribe, refresh]);

  // Initial status fetch when subscribed
  useEffect(() => {
    if (runIdRef.current) void refresh();
  }, [refresh]);

  // Cleanup on unmount
  useEffect(() => () => unsubscribe(), [unsubscribe]);

  return { events, status, connected, error, subscribe, unsubscribe, refresh };
}
