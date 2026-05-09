// @vitest-environment jsdom
//
// CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §3 — useRunEvents hook tests.
// Three real behaviors exercised:
//   1. subscribe() mints a ticket and opens an EventSource at the
//      correct URL, then flips `connected` true on onopen.
//   2. Cross-run isolation — a stale onmessage from es1 cannot leak
//      into events after subscribe(run2).
//   3. Mint failure surfaces via `error` and the polling fallback
//      kicks in instead of leaving the UI dead.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useRunEvents } from './use-run-events.js';

// ── EventSource shim ──────────────────────────────────────────────────────
// jsdom doesn't ship EventSource. The hook constructs `new EventSource(url)`
// and assigns onopen/onmessage/onerror callbacks; the test exposes those
// callbacks via a global registry so we can drive them deterministically.

interface EventSourceFake {
  url: string;
  readyState: number;
  close: () => void;
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
}
const eventSourcesByOrder: EventSourceFake[] = [];

class EventSourceMock implements EventSourceFake {
  url: string;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    eventSourcesByOrder.push(this);
  }
  close(): void {
    this.readyState = 2;
  }
}

// Mock the api module so mintEventTicket and getRunStatus are controllable
// per-test.
const mintEventTicketMock = vi.fn();
const getRunStatusMock = vi.fn();
vi.mock('../api.js', () => ({
  mintEventTicket: (...args: unknown[]) => mintEventTicketMock(...args),
  getRunStatus: (...args: unknown[]) => getRunStatusMock(...args),
}));

beforeEach(() => {
  eventSourcesByOrder.length = 0;
  // Default: ticket mint succeeds.
  mintEventTicketMock.mockResolvedValue({
    ok: true,
    data: { ticketId: 'ticket-1', expiresAt: '2099-01-01T00:00:00.000Z' },
  });
  getRunStatusMock.mockResolvedValue({ ok: true, data: null });
  // Install our EventSource on the global so the hook picks it up.
  (globalThis as unknown as { EventSource: typeof EventSourceMock }).EventSource = EventSourceMock;
});

afterEach(() => {
  cleanup();
  mintEventTicketMock.mockReset();
  getRunStatusMock.mockReset();
});

// Wait for any pending microtasks (including the awaited mintEventTicket
// inside subscribe). renderHook + act don't flush promises automatically.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useRunEvents', () => {
  it('subscribe mints ticket, opens EventSource at /sse/runs/<runId>?ticket=, flips connected on onopen', async () => {
    const { result } = renderHook(() => useRunEvents());

    await act(async () => {
      result.current.subscribe('run-aaa');
      await flush();
    });

    expect(mintEventTicketMock).toHaveBeenCalledWith('run-aaa');
    expect(eventSourcesByOrder).toHaveLength(1);
    const es = eventSourcesByOrder[0]!;
    expect(es.url).toBe('/sse/runs/run-aaa?ticket=ticket-1');

    // Drive onopen to confirm the connected flag flips.
    await act(async () => {
      es.onopen?.(new Event('open'));
    });
    expect(result.current.connected).toBe(true);
  });

  it('clears events between runs and rejects late messages from a stale subscription', async () => {
    const { result } = renderHook(() => useRunEvents());

    // Subscribe to run-A, drive an event in.
    await act(async () => {
      result.current.subscribe('run-A');
      await flush();
    });
    const esA = eventSourcesByOrder[0]!;
    await act(async () => {
      esA.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'run_opened',
            runId: 'run-A',
            timestamp: '2026-05-09T00:00:00.000Z',
          }),
        })
      );
    });
    expect(result.current.events.length).toBe(1);
    expect(result.current.events[0]!.runId).toBe('run-A');

    // Now subscribe to run-B. setEvents([]) should fire synchronously
    // before the new EventSource opens, AND a stale message from esA
    // arriving afterwards must be rejected.
    await act(async () => {
      result.current.subscribe('run-B');
      await flush();
    });
    expect(eventSourcesByOrder).toHaveLength(2);
    expect(result.current.events).toEqual([]);

    // Stale onmessage from esA — token mismatch in the hook's gate.
    await act(async () => {
      esA.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'plan_created',
            runId: 'run-A',
            timestamp: '2026-05-09T00:00:01.000Z',
          }),
        })
      );
    });
    // The stale message did NOT leak into run-B's events.
    expect(result.current.events).toEqual([]);

    // Real run-B message arrives — should be accepted.
    const esB = eventSourcesByOrder[1]!;
    await act(async () => {
      esB.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'run_opened',
            runId: 'run-B',
            timestamp: '2026-05-09T00:00:02.000Z',
          }),
        })
      );
    });
    expect(result.current.events.length).toBe(1);
    expect(result.current.events[0]!.runId).toBe('run-B');
  });

  it('surfaces mint failure as error and falls back to polling instead of opening EventSource', async () => {
    mintEventTicketMock.mockResolvedValueOnce({
      ok: false,
      error: 'Event tickets not configured',
    });

    const { result } = renderHook(() => useRunEvents());
    await act(async () => {
      result.current.subscribe('run-fail');
      await flush();
    });

    // No EventSource was opened.
    expect(eventSourcesByOrder).toHaveLength(0);
    // Error surfaces with the mint reason in the text.
    expect(result.current.error).not.toBeNull();
    expect(result.current.error!).toMatch(/event stream unavailable/i);
    // Polling fallback called getRunStatus at least once.
    expect(getRunStatusMock).toHaveBeenCalled();
  });

  it('stale onerror from a prior subscription does not flip the new run connected:false', async () => {
    const { result } = renderHook(() => useRunEvents());

    await act(async () => {
      result.current.subscribe('run-A');
      await flush();
    });
    const esA = eventSourcesByOrder[0]!;
    await act(async () => {
      esA.onopen?.(new Event('open'));
    });
    expect(result.current.connected).toBe(true);

    // Resubscribe to run-B before es1 fully tears down.
    await act(async () => {
      result.current.subscribe('run-B');
      await flush();
    });
    const esB = eventSourcesByOrder[1]!;
    await act(async () => {
      esB.onopen?.(new Event('open'));
    });
    expect(result.current.connected).toBe(true);

    // A late onerror from esA fires (server EOF, browser auto-reconnect
    // race). The hook must ignore it because the token / sourceRef
    // don't match — esB is healthy.
    await act(async () => {
      esA.onerror?.(new Event('error'));
    });
    expect(result.current.connected).toBe(true);
  });
});
