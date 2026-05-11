/**
 * Post-Inference Action Normalizer — spec §28.1, blueprint §15.1.
 *
 * File: packages/core/src/normalization/post-inference-normalizer.ts
 * Layer 3 (core) — implementation of the canonical
 * `PostInferenceNormalizer` interface from `@nexus/contracts`.
 *
 * Sits at the NVG → NXS boundary. Converts ONE extracted tool call
 * into ONE `AgentAction` envelope so the 7-gate pipeline can govern
 * it consistently regardless of which provider produced it.
 *
 * Pure normalization. ZERO governance decisions. Per §28.1 hard rules:
 *   - resolvedVerb, resolvedCapability, resolvedTarget,
 *     resolvedDataClasses, resolvedRiskTier are ALL null.
 *     Gate 02 (Classification) is the authority; populating any of
 *     these here is a build violation.
 *   - delegationSequence is 0 (the pipeline assigns the real
 *     monotonic sequence at gate-entry time).
 *
 * Multi-tool-call semantics (per canonical interface):
 *   The interface is `normalize(modelOutput, context): AgentAction`
 *   — SINGLE action. When a model response carries multiple tool
 *   calls, the caller (composition root) extracts them and invokes
 *   `normalize()` once per tool call.
 */

import type {
  AgentAction,
  IsoTimestamp,
  NonEmpty,
  NormalizerContext,
  PostInferenceNormalizer,
  Uuid,
} from '@nexus/contracts';
import { LexicalNormalizer } from './lexical-normalizer.js';

/**
 * Intermediate representation of a tool call extracted from the
 * provider's opaque response. The composition root converts each
 * provider-specific shape (OpenAI tool_calls / Anthropic tool_use /
 * Ollama message.tool_calls) into this uniform shape before handing
 * a single instance to `normalize()`.
 *
 * Exported so the composition root can declare the type of the
 * `extractToolCalls` helper without redefining it.
 */
export interface ExtractedToolCall {
  /** Provider tool name. Convention: `verb_target` (e.g. `read_database`). */
  readonly toolName: string;
  /** Tool arguments — opaque to the normalizer; flows into rawPayload. */
  readonly arguments: unknown;
  /** Provider-side ID (call_id / tool_use id). Used by callers that need to
   *  correlate tool results back to the originating call; the normalizer
   *  doesn't use it but preserves it on the action's rawPayload envelope. */
  readonly providerCallId: string | null;
}

/** Reference implementation of the canonical PostInferenceNormalizer. */
export class PostInferenceNormalizerImpl implements PostInferenceNormalizer {
  constructor(private readonly lexical: LexicalNormalizer) {}

  /**
   * Convert one extracted tool call into one AgentAction.
   *
   * `modelOutput` MUST be an `ExtractedToolCall` instance (the caller
   * extracted it from the opaque provider response). The normalizer
   * never inspects raw provider response bodies — that's the
   * composition root's job.
   */
  normalize(modelOutput: unknown, context: NormalizerContext): AgentAction {
    if (modelOutput === null || modelOutput === undefined || typeof modelOutput !== 'object') {
      throw new Error(
        '[post-inference-normalizer] modelOutput must be an ExtractedToolCall object'
      );
    }
    const tc = modelOutput as Partial<ExtractedToolCall>;
    if (typeof tc.toolName !== 'string' || tc.toolName.length === 0) {
      throw new Error(
        '[post-inference-normalizer] modelOutput.toolName must be a non-empty string'
      );
    }

    // Tool naming convention: `verb_target` → split on the FIRST
    // underscore. A tool name without an underscore (`search`,
    // `lookup`) is treated as both verb and target so Gate 02 has a
    // verb to resolve; Gate 02 will handle ambiguity through its
    // verb resolver.
    const idx = tc.toolName.indexOf('_');
    const rawVerb = idx < 0 ? tc.toolName : tc.toolName.slice(0, idx);
    const rawTarget = idx < 0 ? tc.toolName : tc.toolName.slice(idx + 1);

    // Lexical cleanup ONLY. If the raw verb is unresolvable Gate 02
    // emits UNRESOLVABLE_VERB; we never guess and never deny.
    const cleanVerb = this.lexical.normalizeVerb(rawVerb);

    const action: AgentAction = {
      actionId: crypto.randomUUID() as Uuid,
      runId: context.runId,
      receivedAt: new Date().toISOString() as IsoTimestamp,
      protocol: context.protocol,
      adapterVersion: 'post-inference-v1' as NonEmpty,
      actorId: context.actorId,
      principalId: context.principalId,
      sessionId: context.sessionId,
      delegationId: context.delegationId,
      // Pipeline assigns the real sequence at gate entry — see the
      // PipelineInterface contract: callers pass `Omit<AgentAction,
      // 'delegationSequence'>` so the field is declared here only to
      // satisfy the strict shape; the pipeline overwrites it.
      delegationSequence: 0,
      tool: tc.toolName as NonEmpty,
      rawVerb: cleanVerb as NonEmpty,
      rawTarget: rawTarget as NonEmpty,
      // Pass the model's tool_call arguments through as the bare
      // rawPayload so connectors can read their declared input
      // schema directly (e.g. postgres reads `payload.sql` /
      // `payload.params`). The provider's call id lives on the
      // ExtractedToolCall itself; the round-trip loop reads it
      // from there for tool_result correlation, so we don't need
      // to fold it into rawPayload.
      rawPayload: (tc.arguments ?? {}) as unknown,
      intent: {
        objectiveSummary: `${rawVerb} ${rawTarget}` as NonEmpty,
        triggeringSource: 'post-inference-tool-call' as NonEmpty,
        toolchainContext: context.protocol,
        modelId: null,
        modelConfidence: null,
        riskNote: null,
        extractedAt: new Date().toISOString() as IsoTimestamp,
      },
      // Governance fields explicitly null — Gate 02 is the authority.
      resolvedVerb: null,
      resolvedCapability: null,
      resolvedTarget: null,
      resolvedDataClasses: [],
      resolvedRiskTier: null,
    };
    return action;
  }
}
