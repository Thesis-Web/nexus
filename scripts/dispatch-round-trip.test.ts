/**
 * Unit tests for the bounded LLM tool-call round-trip loop.
 *
 * Tests the loop in isolation from the real NVG/NXS/bridge plumbing by
 * stubbing the two deps callbacks. Each test scripts the NVG turn outcomes
 * + tool-call dispatch outcomes the loop will see, then asserts the
 * RoundTripOutcome and the messages array the loop built up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runDispatchRoundTrip,
  type NvgTurnResult,
  type ToolCallDispatchResult,
} from './dispatch-round-trip.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let workdir: string;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-roundtrip-'));
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

async function writeBridgePayload(name: string, body: string): Promise<string> {
  const p = path.join(workdir, name);
  await fs.writeFile(p, body, 'utf-8');
  return p;
}

/**
 * Build a deps object whose callNvgTurn returns the scripted responses in
 * order. Each call also captures the messages that were passed in so the
 * test can assert what the loop sent on each turn.
 */
function scriptedNvg(scripted: NvgTurnResult[]): {
  callNvgTurn: (messages: readonly unknown[]) => Promise<NvgTurnResult>;
  callsSeen: { messages: unknown[] }[];
} {
  let i = 0;
  const callsSeen: { messages: unknown[] }[] = [];
  return {
    callsSeen,
    callNvgTurn: async (messages: readonly unknown[]) => {
      callsSeen.push({ messages: [...messages] });
      const next = scripted[i++];
      if (next === undefined) {
        throw new Error(
          `scriptedNvg exhausted — loop tried to make NVG call #${i} but only ${scripted.length} were scripted`
        );
      }
      return next;
    },
  };
}

function scriptedDispatch(
  scripted: ToolCallDispatchResult[]
): (call: unknown, turnIndex: number) => Promise<ToolCallDispatchResult> {
  let i = 0;
  return async () => {
    const next = scripted[i++];
    if (next === undefined) {
      throw new Error(
        `scriptedDispatch exhausted — loop tried to dispatch tool #${i} but only ${scripted.length} were scripted`
      );
    }
    return next;
  };
}

// Build an Ollama-shaped response with tool_calls, used in several tests.
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

describe('runDispatchRoundTrip', () => {
  it('rejects an invalid maxToolTurnsPerNode', async () => {
    const nvg = scriptedNvg([]);
    await expect(
      runDispatchRoundTrip([], {
        callNvgTurn: nvg.callNvgTurn,
        dispatchToolCall: scriptedDispatch([]),
        maxToolTurnsPerNode: 0,
      })
    ).rejects.toThrow(/must be an integer/);
  });

  it('returns final on a single-turn text response (no tool calls)', async () => {
    const nvg = scriptedNvg([
      { kind: 'success', opaqueResponse: ollamaTextResponse('Hello world.') },
    ]);
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'Greet me' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: scriptedDispatch([]),
      maxToolTurnsPerNode: 6,
    });

    expect(result.outcome).toBe('final');
    if (result.outcome !== 'final') return;
    expect(result.toolTurnCount).toBe(0);
    expect(result.toolCallsPerTurn).toEqual([0]);
    // Only the user's initial message was sent — no extra messages added.
    expect(nvg.callsSeen).toHaveLength(1);
    expect(nvg.callsSeen[0]!.messages).toHaveLength(1);
  });

  it('does one tool round-trip then a final text turn', async () => {
    const payloadPath = await writeBridgePayload(
      'tool1.json',
      JSON.stringify({ rows: [{ sku: 'GADGET-Y', units: 150, warehouse: 'WH-WEST' }] })
    );
    const nvg = scriptedNvg([
      {
        kind: 'success',
        opaqueResponse: ollamaToolCallResponse('read_database', { sql: 'SELECT * FROM inventory' }),
      },
      { kind: 'success', opaqueResponse: ollamaTextResponse('GADGET-Y has 150 units in WH-WEST.') },
    ]);
    const result = await runDispatchRoundTrip(
      [{ role: 'user', content: 'How many GADGET-Y are in WH-WEST?' }],
      {
        callNvgTurn: nvg.callNvgTurn,
        dispatchToolCall: scriptedDispatch([{ ok: true, payloadPath, kind: 'data' }]),
        maxToolTurnsPerNode: 6,
      }
    );

    expect(result.outcome).toBe('final');
    if (result.outcome !== 'final') return;
    expect(result.toolTurnCount).toBe(1);
    expect(result.toolCallsPerTurn).toEqual([1, 0]);

    // Two NVG calls: turn 0 with [user], turn 1 with [user, assistant_with_tool_calls, tool_result].
    expect(nvg.callsSeen).toHaveLength(2);
    const turn1Messages = nvg.callsSeen[1]!.messages;
    expect(turn1Messages).toHaveLength(3);

    // The assistant tool-call turn is echoed back verbatim from the response.
    const echoed = turn1Messages[1] as Record<string, unknown>;
    expect(echoed.role).toBe('assistant');
    expect((echoed.tool_calls as unknown[])[0]).toMatchObject({
      function: { name: 'read_database' },
    });

    // The tool_result content is the bridged file body.
    const toolMsg = turn1Messages[2] as Record<string, unknown>;
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.tool_call_id).toBe('call_abc');
    expect(JSON.parse(toolMsg.content as string).rows[0].sku).toBe('GADGET-Y');
  });

  it('does multiple tool round-trips before the final text turn', async () => {
    const path1 = await writeBridgePayload('p1.json', '{"rows":[{"a":1}]}');
    const path2 = await writeBridgePayload('p2.json', '{"rows":[{"b":2}]}');
    const nvg = scriptedNvg([
      { kind: 'success', opaqueResponse: ollamaToolCallResponse('read_database', { q: 1 }, 'c1') },
      { kind: 'success', opaqueResponse: ollamaToolCallResponse('read_database', { q: 2 }, 'c2') },
      { kind: 'success', opaqueResponse: ollamaTextResponse('Done.') },
    ]);
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'multi' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: scriptedDispatch([
        { ok: true, payloadPath: path1, kind: 'data' },
        { ok: true, payloadPath: path2, kind: 'data' },
      ]),
      maxToolTurnsPerNode: 6,
    });

    expect(result.outcome).toBe('final');
    if (result.outcome !== 'final') return;
    expect(result.toolTurnCount).toBe(2);
    expect(result.toolCallsPerTurn).toEqual([1, 1, 0]);
    expect(nvg.callsSeen).toHaveLength(3);
  });

  it('returns cap_reached when the model still wants tools at the cap', async () => {
    // maxToolTurnsPerNode = 2 → up to 3 NVG calls. The model returns
    // tool_calls every time including the third call. The third call's
    // tools are NOT dispatched.
    const path1 = await writeBridgePayload('p1.json', '{}');
    const path2 = await writeBridgePayload('p2.json', '{}');
    const nvg = scriptedNvg([
      { kind: 'success', opaqueResponse: ollamaToolCallResponse('read', {}, 'c1') },
      { kind: 'success', opaqueResponse: ollamaToolCallResponse('read', {}, 'c2') },
      { kind: 'success', opaqueResponse: ollamaToolCallResponse('read', {}, 'c3') },
    ]);
    let dispatchCalls = 0;
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'go' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: async (_call, _turn) => {
        dispatchCalls++;
        return {
          ok: true,
          payloadPath: dispatchCalls === 1 ? path1 : path2,
          kind: 'data',
        };
      },
      maxToolTurnsPerNode: 2,
    });

    expect(result.outcome).toBe('cap_reached');
    if (result.outcome !== 'cap_reached') return;
    expect(result.toolTurnCount).toBe(2);
    expect(result.toolCallsPerTurn).toEqual([1, 1, 1]);
    // Only the first two turns' tool calls were dispatched (2 total).
    expect(dispatchCalls).toBe(2);
    expect(nvg.callsSeen).toHaveLength(3);
  });

  it('returns denied with the per-turn count when NVG denies a turn', async () => {
    const path1 = await writeBridgePayload('p1.json', '{}');
    const nvg = scriptedNvg([
      { kind: 'success', opaqueResponse: ollamaToolCallResponse('read', {}, 'c1') },
      { kind: 'denied', denialCode: 'POLICY_DENIED', reason: 'sensitive class on turn 2' },
    ]);
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'q' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: scriptedDispatch([{ ok: true, payloadPath: path1, kind: 'data' }]),
      maxToolTurnsPerNode: 6,
    });

    expect(result.outcome).toBe('denied');
    if (result.outcome !== 'denied') return;
    expect(result.denialCode).toBe('POLICY_DENIED');
    expect(result.toolTurnCount).toBe(1);
    // First turn already produced 1 tool call before the denied second turn.
    expect(result.toolCallsPerTurn).toEqual([1]);
  });

  it('returns invocation_failed on a turn where the model invocation failed', async () => {
    const nvg = scriptedNvg([
      { kind: 'invocation_failed', code: 'NO_HEALTHY_ENDPOINT', reason: 'all endpoints down' },
    ]);
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'q' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: scriptedDispatch([]),
      maxToolTurnsPerNode: 6,
    });
    expect(result.outcome).toBe('invocation_failed');
    if (result.outcome !== 'invocation_failed') return;
    expect(result.code).toBe('NO_HEALTHY_ENDPOINT');
    expect(result.toolTurnCount).toBe(0);
  });

  it('synthesizes a failure tool_result when a tool dispatch fails', async () => {
    const path1 = await writeBridgePayload('p1.json', '{"rows":[]}');
    const nvg = scriptedNvg([
      {
        kind: 'success',
        opaqueResponse: {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { id: 'c1', function: { name: 'read', arguments: {} } },
              { id: 'c2', function: { name: 'write', arguments: {} } },
            ],
          },
        },
      },
      { kind: 'success', opaqueResponse: ollamaTextResponse('Done.') },
    ]);
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'mix' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: scriptedDispatch([
        { ok: true, payloadPath: path1, kind: 'data' },
        { ok: false, reason: 'connector_error' },
      ]),
      maxToolTurnsPerNode: 6,
    });

    expect(result.outcome).toBe('final');
    if (result.outcome !== 'final') return;
    expect(result.toolTurnCount).toBe(1);

    // Both tool_results were appended — even the failed one. Conversation
    // stays well-formed (one tool_result per tool_call).
    const turn1Messages = nvg.callsSeen[1]!.messages;
    const toolMsgs = turn1Messages.filter(m => (m as Record<string, unknown>).role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    const failBody = JSON.parse((toolMsgs[1] as { content: string }).content);
    expect(failBody.status).toBe('failure');
    expect(failBody.summary).toBe('connector_error');
  });

  it('returns malformed_response when the assistant turn cannot be echoed back', async () => {
    // Provider returns a shape with tool_calls extractable from one position
    // but no recognisable assistant message envelope. The loop refuses to
    // continue rather than send a malformed follow-up.
    const nvg = scriptedNvg([
      {
        kind: 'success',
        // Anthropic-shaped tool_use block but with role: 'user' — extractor
        // pulls out the tool_use, but extractAssistantTurnMessage returns
        // null because role !== 'assistant'.
        opaqueResponse: {
          role: 'user',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'read', input: {} }],
        },
      },
    ]);
    const result = await runDispatchRoundTrip([{ role: 'user', content: 'q' }], {
      callNvgTurn: nvg.callNvgTurn,
      dispatchToolCall: scriptedDispatch([]),
      maxToolTurnsPerNode: 6,
    });
    expect(result.outcome).toBe('malformed_response');
    if (result.outcome !== 'malformed_response') return;
    expect(result.toolTurnCount).toBe(0);
  });
});
