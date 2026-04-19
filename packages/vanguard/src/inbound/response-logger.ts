/**
 * NVG Inbound Response Logger — spec §24.6
 * Log-and-normalize. No content inspection.
 * Layer 3 — imports from @nexus/contracts only.
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

export async function logInboundResponse(
  correlationId: Uuid,
  request: NvgOutboundRequest,
  invocation: NvgInvocationResult,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty
): Promise<void> {
  await trailWriter.append({
    entryId: crypto.randomUUID(),
    runId: request.runId,
    correlationId,
    direction: 'inbound',
    actorId: request.actorId,
    octLevel: request.octLevel,
    dataClassification:
      request.dataLabels.length > 0
        ? resolveHighestDataClass(request.dataLabels)
        : DATA_CLASS.PUBLIC,
    routingPolicyVersion,
    modelTierSelected: invocation.endpointUsed?.tier ?? null,
    modelTierInvoked: invocation.endpointUsed?.tier ?? null,
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

/** §24.7 — deny/quarantine handler */
export async function handleNvgDenial(
  request: NvgOutboundRequest,
  denialCode: string,
  reason: string,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty
): Promise<void> {
  await trailWriter.append({
    entryId: crypto.randomUUID(),
    runId: request.runId,
    correlationId: crypto.randomUUID(),
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
