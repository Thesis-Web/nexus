/**
 * NVG Inbound Response Logger — spec §24.6
 * Log-and-normalize. No content inspection.
 * Layer 3 — imports from @nexus/contracts only.
 *
 * NVG-RPT-002 fix: priorAttempts trail entries now carry tier, adapterId,
 * modelName from enriched InvocationAttempt (§12.3.44) for self-contained
 * forensic visibility. Previously these fields were null.
 */
import {
  DATA_CLASS,
  type Uuid,
  type NonEmpty,
  type NvgOutboundRequest,
  type NvgInvocationResult,
  type RoutingTrailWriter,
} from '@nexus/contracts';
import { resolveHighestDataClass } from '../classifier/data-classifier.js';
import { normalizeInboundResponse } from './response-normalizer.js';
import type { NvgNormalizedResponse } from '../types/index.js';

export async function logInboundResponse(
  correlationId: Uuid,
  request: NvgOutboundRequest,
  invocation: NvgInvocationResult,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty
): Promise<void> {
  const dataClassification =
    request.dataLabels.length > 0 ? resolveHighestDataClass(request.dataLabels) : DATA_CLASS.PUBLIC;

  // §24.6 — write one trail entry per prior attempt before the final-outcome entry
  // NVG-RPT-002: tier, adapterId, modelName now populated from enriched InvocationAttempt
  if (invocation.priorAttempts) {
    for (const attempt of invocation.priorAttempts) {
      await trailWriter.append({
        entryId: crypto.randomUUID(),
        runId: request.runId,
        correlationId,
        direction: 'inbound',
        actorId: request.actorId,
        octLevel: request.octLevel,
        dataClassification,
        routingPolicyVersion,
        modelTierSelected: attempt.tier ?? null,
        modelTierInvoked: attempt.tier ?? null,
        endpointId: attempt.endpointUsed,
        adapterId: attempt.adapterId ?? null,
        modelName: attempt.modelName ?? null,
        providerModelNameReturned: null,
        denialCode: attempt.denialCode,
        denialReason: attempt.reason,
        fallbackApplied: false,
        fallbackFromTier: null,
        costMetrics: { requestCost: null, responseCost: null },
        latencyMs: attempt.latencyMs,
        responseSize: attempt.responseSize ?? null,
        timestamp: attempt.attemptedAt,
      });
    }
  }

  // Final-outcome trail entry
  await trailWriter.append({
    entryId: crypto.randomUUID(),
    runId: request.runId,
    correlationId,
    direction: 'inbound',
    actorId: request.actorId,
    octLevel: request.octLevel,
    dataClassification,
    routingPolicyVersion,
    modelTierSelected: invocation.endpointUsed?.tier ?? null,
    modelTierInvoked: invocation.endpointUsed?.tier ?? null,
    endpointId: invocation.endpointUsed?.endpointId ?? null,
    adapterId: invocation.endpointUsed?.adapterId ?? null,
    modelName: invocation.endpointUsed?.modelName ?? null,
    providerModelNameReturned: invocation.providerModelNameReturned ?? null,
    denialCode: invocation.denialCode ?? null,
    denialReason: invocation.reason ?? null,
    fallbackApplied: invocation.fallbackApplied,
    fallbackFromTier: invocation.fallbackFromTier,
    costMetrics: { requestCost: null, responseCost: null },
    latencyMs: invocation.latencyMs ?? 0,
    responseSize: invocation.responseSize ?? null,
    timestamp: new Date().toISOString(),
  });
}

/**
 * §24.6 — Complete inbound handler: log trail entry + normalize response.
 * This is the runtime inbound path that callers should use.
 * Returns the normalized response for the orchestrator.
 */
export async function handleInboundResponse(
  correlationId: Uuid,
  request: NvgOutboundRequest,
  invocation: NvgInvocationResult,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty
): Promise<NvgNormalizedResponse> {
  await logInboundResponse(correlationId, request, invocation, trailWriter, routingPolicyVersion);
  return normalizeInboundResponse(invocation);
}

/** §24.7 — deny/quarantine handler */
export async function handleNvgDenial(
  request: NvgOutboundRequest,
  denialCode: string,
  reason: string,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty,
  correlationId?: Uuid
): Promise<void> {
  await trailWriter.append({
    entryId: crypto.randomUUID(),
    runId: request.runId,
    correlationId: correlationId ?? (crypto.randomUUID() as Uuid),
    direction: 'outbound',
    actorId: request.actorId,
    octLevel: request.octLevel,
    dataClassification:
      request.dataLabels.length > 0
        ? resolveHighestDataClass(request.dataLabels)
        : DATA_CLASS.PUBLIC,
    routingPolicyVersion,
    modelTierSelected: null,
    modelTierInvoked: null,
    endpointId: null,
    adapterId: null,
    modelName: null,
    providerModelNameReturned: null,
    denialCode,
    denialReason: reason,
    fallbackApplied: false,
    fallbackFromTier: null,
    costMetrics: { requestCost: null, responseCost: null },
    latencyMs: 0,
    responseSize: null,
    timestamp: new Date().toISOString(),
  });
}
