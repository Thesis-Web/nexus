/**
 * NVG return-precheck loop — composition-boundary helper.
 *
 * File: scripts/dispatch-round-trip.ts
 *
 * Per Spec F4.20 / Q6 / Hard Laws #5 + #7, the post-inference
 * tool-call dispatch pattern is RETIRED. LLMs cannot trigger NXS via
 * model `tool_calls`; targeted-system actions go through the
 * planner-authored `nxs_dispatch` node only. The legacy multi-turn
 * round-trip (NVG → tool_calls → NXS → bridge → tool_results → next
 * NVG) is gone.
 *
 * This module is now a SINGLE-TURN helper:
 *   1. Call NVG once.
 *   2. Inspect the opaque provider response for any `tool_calls` shape.
 *   3. If present → emit `unsolicited_model_tool_call` ledger event
 *      via `deps.emitUnsolicitedToolCall`; report the outcome as
 *      `unsolicited_tool_calls` so the caller treats the response as
 *      text only (the tool_calls field is dropped from the payload
 *      handed to the orch mailbox, per F4.20 §4.1).
 *   4. If absent → report as `final`.
 *
 * The "round-trip" name is preserved per owner ratification (no
 * upstream/downstream rename of established vocabulary, 2026-05-20).
 *
 * Lives at the composition boundary on purpose:
 *   - NVG/NXS payload inspection happens in `extract-tool-calls.ts`,
 *     not inside any adapter (transport-layer hygiene).
 *   - The function itself is pure orchestration over async deps, so it
 *     can be unit-tested without standing up the full bootstrap (see
 *     `dispatch-round-trip.test.ts`).
 */
import { extractToolCalls, type ExtractedToolCall } from './extract-tool-calls.js';

/** Result of one NVG turn from the loop's perspective. */
export type NvgTurnResult =
  | { kind: 'success'; opaqueResponse: unknown }
  | { kind: 'denied'; denialCode: string; reason: string }
  | { kind: 'invocation_failed'; code: string; reason: string };

export interface RoundTripDeps {
  /** Issue one NVG turn with the given messages. */
  readonly callNvgTurn: (messages: readonly unknown[]) => Promise<NvgTurnResult>;
  /**
   * Emit the `unsolicited_model_tool_call` ledger event when the NVG
   * return-precheck stage detects `tool_calls` in the model response.
   * Called at most once per round-trip (single-turn). The caller's
   * implementation MUST persist the event to the Run Ledger before
   * resolving; fail-closed propagates as a thrown error.
   */
  readonly emitUnsolicitedToolCall: (toolCalls: ReadonlyArray<ExtractedToolCall>) => Promise<void>;
}

export type RoundTripOutcome =
  /** Model returned a final assistant response with no `tool_calls`. */
  | {
      outcome: 'final';
      finalResponse: unknown;
    }
  /**
   * Model returned a response carrying `tool_calls`. NVG return-precheck
   * has emitted `unsolicited_model_tool_call`; the caller treats the
   * response as TEXT (the `tool_calls` field is dropped from the orch
   * mailbox payload per F4.20 §4.1). The detected calls are surfaced
   * here so the caller can quote names/digests on workspace receipts.
   */
  | {
      outcome: 'unsolicited_tool_calls';
      finalResponse: unknown;
      detectedToolCalls: ReadonlyArray<ExtractedToolCall>;
    }
  /** NVG denied the request (governance, ceiling, etc.). */
  | {
      outcome: 'denied';
      denialCode: string;
      reason: string;
    }
  /** NVG was allowed but the model invocation failed. */
  | {
      outcome: 'invocation_failed';
      code: string;
      reason: string;
    };

export async function runDispatchRoundTrip(
  initialMessages: readonly unknown[],
  deps: RoundTripDeps
): Promise<RoundTripOutcome> {
  const turnRes = await deps.callNvgTurn(initialMessages);

  if (turnRes.kind === 'denied') {
    return {
      outcome: 'denied',
      denialCode: turnRes.denialCode,
      reason: turnRes.reason,
    };
  }
  if (turnRes.kind === 'invocation_failed') {
    return {
      outcome: 'invocation_failed',
      code: turnRes.code,
      reason: turnRes.reason,
    };
  }

  const opaque = turnRes.opaqueResponse;
  const toolCalls = extractToolCalls(opaque);

  if (toolCalls.length === 0) {
    return {
      outcome: 'final',
      finalResponse: opaque,
    };
  }

  // F4.20 §4.1 — model response carries tool_calls shape. Emit the
  // unsolicited-model-tool-call event so audit + workspace receipt
  // both reflect the attempt. The caller treats the response as text
  // and drops the tool_calls field from the orch mailbox payload.
  await deps.emitUnsolicitedToolCall(toolCalls);
  return {
    outcome: 'unsolicited_tool_calls',
    finalResponse: opaque,
    detectedToolCalls: toolCalls,
  };
}
