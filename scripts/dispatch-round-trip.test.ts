/**
 * Unit tests — NVG return-precheck single-turn loop.
 *
 * Acceptance gates F4.20 §6 (this module is the NVG-return-precheck
 * surface; the inverted test asserts the round-trip NEVER dispatches a
 * model tool-call to NXS):
 *
 *   LIT-01: NVG receives model response with `tool_calls` field →
 *           emits `unsolicited_model_tool_call`; treats payload as text.
 *   LIT-02: Orch reads orch-input mailbox with model response → does
 *           NOT dispatch any tool call extracted from response.
 *           (Covered structurally — `dispatchToolCall` does not exist
 *           in this module after F4.20.)
 *   LIT-07: Static gate detects `dispatchToolCall` invocation in
 *           production runtime path → CI fails (GOV-02 in ci-gate).
 *
 * Per HANDOFF §C.3, this is an inversion of the prior-arc tests that
 * asserted dispatch happens — owner-pre-ratified via Spec F4.20 §5.4.
 * The old multi-turn / cap_reached / malformed_response / tool_result-
 * synthesis paths are removed because the loop is single-turn.
 */
import { describe, it, expect } from 'vitest';
import {
  runDispatchRoundTrip,
  type NvgTurnResult,
  type RoundTripDeps,
} from './dispatch-round-trip.js';
import type { ExtractedToolCall } from './extract-tool-calls.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a deps object whose callNvgTurn returns the scripted response
 * AND captures the messages the loop sent. Since the loop is single-
 * turn, exactly one scripted response is expected per run.
 */
function scriptedNvg(scripted: NvgTurnResult): {
  callNvgTurn: (messages: readonly unknown[]) => Promise<NvgTurnResult>;
  callsSeen: { messages: unknown[] }[];
} {
  const callsSeen: { messages: unknown[] }[] = [];
  return {
    callsSeen,
    callNvgTurn: async (messages: readonly unknown[]) => {
      callsSeen.push({ messages: [...messages] });
      return scripted;
    },
  };
}

/** Spy on the unsolicited-tool-call emission. */
function emissionSpy(): {
  emitUnsolicitedToolCall: RoundTripDeps['emitUnsolicitedToolCall'];
  emissions: ReadonlyArray<ExtractedToolCall>[];
} {
  const emissions: ReadonlyArray<ExtractedToolCall>[] = [];
  return {
    emissions,
    emitUnsolicitedToolCall: async toolCalls => {
      emissions.push(toolCalls);
    },
  };
}

// Ollama-shaped responses used in several tests.
function ollamaToolCallResponse(toolName: string, args: unknown, callId = 'call_abc') {
  return {
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: callId, function: { name: toolName, arguments: args } }],
    },
  };
}

function ollamaTextResponse(text: string) {
  return { message: { role: 'assistant', content: text } };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runDispatchRoundTrip — F4.20 single-turn return-precheck', () => {
  it('returns final on a text response (no tool_calls)', async () => {
    const nvg = scriptedNvg({
      kind: 'success',
      opaqueResponse: ollamaTextResponse('Hello world.'),
    });
    const spy = emissionSpy();
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'Greet me' }], {
      callNvgTurn: nvg.callNvgTurn,
      emitUnsolicitedToolCall: spy.emitUnsolicitedToolCall,
    });

    expect(result.outcome).toBe('final');
    if (result.outcome !== 'final') return;
    // The text response is passed through verbatim — no transformation.
    expect((result.finalResponse as { message: { content: string } }).message.content).toBe(
      'Hello world.'
    );
    // No unsolicited emission because no tool_calls were present.
    expect(spy.emissions).toHaveLength(0);
    // Exactly one NVG call (single-turn).
    expect(nvg.callsSeen).toHaveLength(1);
  });

  it('LIT-01 — emits unsolicited_model_tool_call when tool_calls present; does NOT dispatch', async () => {
    const nvg = scriptedNvg({
      kind: 'success',
      opaqueResponse: ollamaToolCallResponse('read_database', { sql: 'SELECT 1' }, 'call_xyz'),
    });
    const spy = emissionSpy();
    const result = await runDispatchRoundTrip(
      [{ role: 'user', content: 'How many GADGET-Y are in WH-WEST?' }],
      {
        callNvgTurn: nvg.callNvgTurn,
        emitUnsolicitedToolCall: spy.emitUnsolicitedToolCall,
      }
    );

    expect(result.outcome).toBe('unsolicited_tool_calls');
    if (result.outcome !== 'unsolicited_tool_calls') return;

    // The emission carries the detected tool calls verbatim.
    expect(spy.emissions).toHaveLength(1);
    expect(spy.emissions[0]).toHaveLength(1);
    expect(spy.emissions[0]?.[0]).toMatchObject({
      toolName: 'read_database',
      providerCallId: 'call_xyz',
    });

    // The detected calls are surfaced on the outcome so the caller can
    // quote names on workspace receipts.
    expect(result.detectedToolCalls).toHaveLength(1);
    expect(result.detectedToolCalls[0]?.toolName).toBe('read_database');

    // No multi-turn — exactly one NVG call.
    expect(nvg.callsSeen).toHaveLength(1);

    // Defense in depth — the response is returned as-is to the caller,
    // which is responsible for treating it as text-only when dropping
    // into the orch mailbox (per F4.20 §4.1). The round-trip does NOT
    // re-prompt the model with tool_results; it never enters a second
    // turn. This is the inversion from the retired dispatch loop.
  });

  it('emits exactly one event even when multiple tool_calls are present', async () => {
    const nvg = scriptedNvg({
      kind: 'success',
      opaqueResponse: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'c1', function: { name: 'read_database', arguments: {} } },
            { id: 'c2', function: { name: 'send_email', arguments: {} } },
          ],
        },
      },
    });
    const spy = emissionSpy();
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'multi' }], {
      callNvgTurn: nvg.callNvgTurn,
      emitUnsolicitedToolCall: spy.emitUnsolicitedToolCall,
    });

    expect(result.outcome).toBe('unsolicited_tool_calls');
    if (result.outcome !== 'unsolicited_tool_calls') return;

    // Single emission, but it carries BOTH tool calls so audit sees the
    // entire attempt batch in one ledger row.
    expect(spy.emissions).toHaveLength(1);
    expect(spy.emissions[0]).toHaveLength(2);
    expect(spy.emissions[0]?.[0]?.toolName).toBe('read_database');
    expect(spy.emissions[0]?.[1]?.toolName).toBe('send_email');
  });

  it('returns denied when NVG denies the turn', async () => {
    const nvg = scriptedNvg({
      kind: 'denied',
      denialCode: 'POLICY_DENIED',
      reason: 'sensitive class on outbound',
    });
    const spy = emissionSpy();
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'q' }], {
      callNvgTurn: nvg.callNvgTurn,
      emitUnsolicitedToolCall: spy.emitUnsolicitedToolCall,
    });

    expect(result.outcome).toBe('denied');
    if (result.outcome !== 'denied') return;
    expect(result.denialCode).toBe('POLICY_DENIED');
    // No emission — the turn never produced a response to inspect.
    expect(spy.emissions).toHaveLength(0);
  });

  it('returns invocation_failed when the model invocation fails', async () => {
    const nvg = scriptedNvg({
      kind: 'invocation_failed',
      code: 'NO_HEALTHY_ENDPOINT',
      reason: 'all endpoints down',
    });
    const spy = emissionSpy();
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'q' }], {
      callNvgTurn: nvg.callNvgTurn,
      emitUnsolicitedToolCall: spy.emitUnsolicitedToolCall,
    });

    expect(result.outcome).toBe('invocation_failed');
    if (result.outcome !== 'invocation_failed') return;
    expect(result.code).toBe('NO_HEALTHY_ENDPOINT');
    expect(spy.emissions).toHaveLength(0);
  });

  it('does NOT dispatch even when the emission callback throws — fail-closed propagates', async () => {
    // Defense in depth: if the unsolicited-emission persistence fails,
    // the error propagates to the caller. The loop never substitutes a
    // dispatch fallback (the dispatch path no longer exists).
    const nvg = scriptedNvg({
      kind: 'success',
      opaqueResponse: ollamaToolCallResponse('write_file', { path: '/etc/secrets' }),
    });
    const erroring: RoundTripDeps['emitUnsolicitedToolCall'] = async () => {
      throw new Error('ledger_unavailable');
    };
    await expect(
      runDispatchRoundTrip([{ role: 'user', content: 'q' }], {
        callNvgTurn: nvg.callNvgTurn,
        emitUnsolicitedToolCall: erroring,
      })
    ).rejects.toThrow(/ledger_unavailable/);
  });
});
