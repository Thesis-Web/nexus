/**
 * Bounded LLM tool-call round-trip — composition-boundary helper.
 *
 * File: scripts/dispatch-round-trip.ts
 *
 * The orchestrator's `nvg_dispatch` per-node dispatch may need more than one
 * NVG turn to produce a final answer: the model may return tool_calls, which
 * have to be dispatched through NXS, the resulting payloads landed in the
 * mailbox via the bridge, and then fed back to the model as tool_results so
 * it can produce the next turn. This loop coordinates that round-trip.
 *
 * Bounded by `maxToolTurnsPerNode` (orchestrator manifest §4.2 sibling to
 * `maxSplitDepth`). One "tool turn" = one full cycle of
 *   NVG → tool_calls → NXS → bridge → tool_results → next NVG.
 * If the cap is reached and the model is STILL asking for tools, the loop
 * surfaces `cap_reached` and the caller marks the node failed.
 *
 * Lives at the composition boundary on purpose:
 *   - NVG/NXS payload inspection happens in `extract-tool-calls.ts` and
 *     `extract-assistant-turn-message.ts`, not inside any adapter.
 *   - The loop itself is pure orchestration over async deps, so it can be
 *     unit-tested without standing up the full bootstrap (see
 *     `dispatch-round-trip.test.ts`).
 *
 * The loop never throws on bounded recoverable conditions (denied turns,
 * invocation failures, malformed responses). The caller decides how to
 * surface those — the orchestrator turns them into `NodeDispatchResult`.
 * Unexpected errors from the deps DO propagate.
 */
import { promises as fs } from 'node:fs';
import type { ExtractedToolCall } from '@nexus/core';
import { extractToolCalls } from './extract-tool-calls.js';
import { extractAssistantTurnMessage } from './extract-assistant-turn-message.js';

/** Result of one NVG turn from the loop's perspective. */
export type NvgTurnResult =
  | { kind: 'success'; opaqueResponse: unknown }
  | { kind: 'denied'; denialCode: string; reason: string }
  | { kind: 'invocation_failed'; code: string; reason: string };

/**
 * Outcome of one tool-call dispatch from the loop's perspective. The loop
 * reads `payloadPath` to build the next turn's tool_result message body.
 * Returning null tells the loop the dispatch failed structurally and to
 * synthesize an inline failure tool_result so the conversation stays
 * well-formed.
 */
export type ToolCallDispatchResult =
  | { ok: true; payloadPath: string; kind: 'data' | 'receipt' }
  | { ok: false; reason: string };

export interface RoundTripDeps {
  /** Issue one NVG turn with the given messages. */
  readonly callNvgTurn: (messages: readonly unknown[]) => Promise<NvgTurnResult>;
  /**
   * Dispatch one extracted tool call (NXS + bridge). Called sequentially
   * in the order extractToolCalls returned. The `turnIndex` is the
   * 0-based tool-turn index this call belongs to — useful for logging,
   * bracketing, or per-turn evidence linkage.
   */
  readonly dispatchToolCall: (
    call: ExtractedToolCall,
    turnIndex: number
  ) => Promise<ToolCallDispatchResult>;
  /** From OrchestratorManifestRecord.maxToolTurnsPerNode. */
  readonly maxToolTurnsPerNode: number;
}

export type RoundTripOutcome =
  /** Model returned a final assistant response (no more tool_calls). */
  | {
      outcome: 'final';
      finalResponse: unknown;
      toolTurnCount: number;
      toolCallsPerTurn: readonly number[];
    }
  /** Cap reached and the model still wanted tools. */
  | {
      outcome: 'cap_reached';
      lastResponse: unknown;
      toolTurnCount: number;
      toolCallsPerTurn: readonly number[];
    }
  /** NVG denied the request on some turn (governance, ceiling, etc.). */
  | {
      outcome: 'denied';
      denialCode: string;
      reason: string;
      toolTurnCount: number;
      toolCallsPerTurn: readonly number[];
    }
  /** NVG was allowed but the model invocation failed on some turn. */
  | {
      outcome: 'invocation_failed';
      code: string;
      reason: string;
      toolTurnCount: number;
      toolCallsPerTurn: readonly number[];
    }
  /** Provider returned tool_calls but the assistant turn shape was
   * unrecognised and could not be echoed back — round-trip impossible. */
  | {
      outcome: 'malformed_response';
      lastResponse: unknown;
      toolTurnCount: number;
      toolCallsPerTurn: readonly number[];
    };

export async function runDispatchRoundTrip(
  initialMessages: readonly unknown[],
  deps: RoundTripDeps
): Promise<RoundTripOutcome> {
  if (!Number.isInteger(deps.maxToolTurnsPerNode) || deps.maxToolTurnsPerNode < 1) {
    throw new Error(
      `runDispatchRoundTrip: maxToolTurnsPerNode must be an integer ≥ 1, got ${deps.maxToolTurnsPerNode}`
    );
  }

  const messages: unknown[] = [...initialMessages];
  const toolCallsPerTurn: number[] = [];

  // turn = number of tool-dispatch rounds completed when entering this NVG
  // call. So with maxToolTurnsPerNode = 6 we make up to 7 NVG calls; the
  // last one (turn === max) returns either text (final) or more tool_calls
  // (cap_reached).
  for (let turn = 0; turn <= deps.maxToolTurnsPerNode; turn++) {
    const turnRes = await deps.callNvgTurn(messages);

    if (turnRes.kind === 'denied') {
      return {
        outcome: 'denied',
        denialCode: turnRes.denialCode,
        reason: turnRes.reason,
        toolTurnCount: turn,
        toolCallsPerTurn,
      };
    }
    if (turnRes.kind === 'invocation_failed') {
      return {
        outcome: 'invocation_failed',
        code: turnRes.code,
        reason: turnRes.reason,
        toolTurnCount: turn,
        toolCallsPerTurn,
      };
    }

    const opaque = turnRes.opaqueResponse;
    const toolCalls = extractToolCalls(opaque);
    toolCallsPerTurn.push(toolCalls.length);

    if (toolCalls.length === 0) {
      return {
        outcome: 'final',
        finalResponse: opaque,
        toolTurnCount: turn,
        toolCallsPerTurn,
      };
    }

    // The model wants more tools. Are we at the cap?
    if (turn === deps.maxToolTurnsPerNode) {
      return {
        outcome: 'cap_reached',
        lastResponse: opaque,
        toolTurnCount: turn,
        toolCallsPerTurn,
      };
    }

    // Echo the assistant tool-call turn back so the next NVG call has the
    // tool_use blocks the tool_results correlate against. Without this the
    // provider rejects the follow-up.
    const assistantTurn = extractAssistantTurnMessage(opaque);
    if (assistantTurn === null) {
      return {
        outcome: 'malformed_response',
        lastResponse: opaque,
        toolTurnCount: turn,
        toolCallsPerTurn,
      };
    }
    messages.push(assistantTurn);

    // Dispatch each tool call. Read the bridged file body to use as the
    // tool_result content. A null dispatched-result means the dispatch
    // failed structurally — synthesize a tiny failure body so the
    // conversation stays well-formed (one tool_result per tool_call).
    for (const tc of toolCalls) {
      const dispatched = await deps.dispatchToolCall(tc, turn);
      let toolContent: string;
      if (!dispatched.ok) {
        toolContent = JSON.stringify({
          status: 'failure',
          summary: dispatched.reason,
        });
      } else {
        toolContent = await fs.readFile(dispatched.payloadPath, 'utf-8');
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.providerCallId,
        content: toolContent,
      });
    }
  }

  // Defensive — the for-loop bound makes this unreachable in a correctly
  // configured run, but a thrown sentinel beats a silent infinite loop if a
  // future refactor breaks the invariant.
  /* istanbul ignore next */
  throw new Error('runDispatchRoundTrip: loop exited without returning a RoundTripOutcome');
}
