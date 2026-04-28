/**
 * NVG Inbound Response Normalizer — spec §6.1, §24.6
 * Inbound step 2 in the NVG pipeline.
 * Normalizes model response before it exits the NVG wall to the orchestrator.
 *
 * Pipeline position: model tier → response-logger (step 1) → response-normalizer (step 2) → trail → orchestrator
 *
 * Responsibilities:
 *   - Normalize invocation result into a clean NvgNormalizedResponse
 *   - Carry opaqueProviderResponse and providerModelNameReturned (§13.7.1, §22.1)
 *   - Strip internal transport details that should not leave NVG
 *   - Stamp normalization timestamp
 *   - Make zero governance decisions — pure normalization
 *
 * NVG-INBOUND-001 fix: opaqueProviderResponse and providerModelNameReturned
 * are now carried through to the orchestrator. Previously silently dropped.
 *
 * Does NOT own:
 *   - Trail writing → response-logger.ts + trail-writer
 *   - Denial/quarantine → response-logger.ts handleNvgDenial
 *   - Data classification → classifier/
 *   - Content inspection — NVG does not inspect model output content
 *
 * Layer 3 — imports from @nexus/contracts only (+ internal vanguard types).
 */
import type { NvgInvocationResult, IsoTimestamp } from '@nexus/contracts';
import type { NvgNormalizedResponse } from '../types/index.js';

/**
 * Normalize an NVG invocation result for return to the orchestrator.
 *
 * The orchestrator receives a clean response shape. Internal transport
 * details (endpoint URLs, health state, raw error objects) are stripped.
 * NVG does not inspect or modify model output content — only metadata.
 *
 * opaqueProviderResponse is carried as opaqueModelOutput (§13.7.1 — never inspected).
 * providerModelNameReturned is carried for audit linkage (§22.1).
 *
 * @param invocation - Raw invocation result from model-router
 */
export function normalizeInboundResponse(invocation: NvgInvocationResult): NvgNormalizedResponse {
  const result: NvgNormalizedResponse = {
    success: invocation.success,
    sourceTier: invocation.endpointUsed?.tier ?? null,
    fallbackApplied: invocation.fallbackApplied,
    responseSize: invocation.responseSize ?? null,
    latencyMs: invocation.latencyMs ?? 0,
    normalizedAt: new Date().toISOString() as IsoTimestamp,
  };

  // NVG-INBOUND-001: carry opaque response and provider model name through
  // to orchestrator. exactOptionalPropertyTypes: only set when defined.
  if (invocation.opaqueProviderResponse !== undefined) {
    result.opaqueModelOutput = invocation.opaqueProviderResponse;
  }
  if (invocation.providerModelNameReturned !== undefined) {
    result.providerModelNameReturned = invocation.providerModelNameReturned;
  }

  return result;
}

/**
 * Check whether a normalized response indicates a successful model call.
 * Convenience predicate for downstream consumers.
 */
export function isSuccessfulResponse(response: NvgNormalizedResponse): boolean {
  return response.success && response.sourceTier !== null;
}
