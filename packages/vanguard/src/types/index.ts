/**
 * NVG-internal types — spec §6.1
 * Types used within the vanguard package that are NOT exported to contracts.
 * These are Layer 3 internal — consumers use contract interfaces only.
 *
 * Contracts (Layer 2) owns:
 *   NvgOutboundRequest, NvgClassificationResult, NvgCeilingResult,
 *   NvgRoutingDecision, NvgInvocationResult, RoutingProvenanceTrailEntry,
 *   DataLabel, ModelEndpoint, ModelTier, etc.
 *
 * This module owns:
 *   NVG pipeline step results, internal configuration, normalization shapes.
 */
import type {
  NvgClassificationResult,
  NvgCeilingResult,
  NvgRoutingDecision,
  NvgInvocationResult,
  DenialCode,
  ModelTier,
  IsoTimestamp,
} from '@nexus/contracts';

// ── NVG Pipeline Step Result ────────────────────────────────────────────────

/** Aggregated result of a complete NVG outbound pipeline pass. */
export interface NvgPipelineResult {
  classification: NvgClassificationResult;
  ceilingCheck: NvgCeilingResult;
  routingDecision: NvgRoutingDecision | null;
  invocation: NvgInvocationResult | null;
  denialCode: DenialCode | null;
  denialReason: string | null;
  pipelineCompletedAt: IsoTimestamp;
}

// ── NVG Inbound Response Shape ──────────────────────────────────────────────

/** Normalized inbound model response after NVG return path processing. */
export interface NvgNormalizedResponse {
  /** Whether the model response was received successfully */
  success: boolean;
  /** Model tier that produced the response */
  sourceTier: ModelTier | null;
  /** Whether fallback was applied */
  fallbackApplied: boolean;
  /** Response size in bytes (null if unavailable) */
  responseSize: number | null;
  /** Round-trip latency in milliseconds */
  latencyMs: number;
  /** Timestamp of normalization */
  normalizedAt: IsoTimestamp;
  /** Opaque model output — carried, never inspected by NVG (§13.7.1, drift D2) */
  opaqueModelOutput?: unknown;
  /** Provider-returned model identifier, version, or alias (§22.1, drift D2) */
  providerModelNameReturned?: string;
}

// ── NVG Denial Context ──────────────────────────────────────────────────────

/** Internal denial context passed to trail writer and deny/quarantine handler. */
export interface NvgDenialContext {
  denialCode: DenialCode;
  reason: string;
  /** Pipeline step where denial occurred */
  deniedAtStep: 'classification' | 'oct_ceiling' | 'routing_policy' | 'model_invocation';
}
