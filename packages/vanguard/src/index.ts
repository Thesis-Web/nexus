/**
 * @nexus/vanguard — Layer 3 barrel export
 * NVG wall enforcement engine.
 * Imports from @nexus/contracts (Layer 2) ONLY.
 * Never imports from @nexus/core (Layer 1).
 *
 * Spec: nexus-engineering-spec-v1-8-26.md §24-§27
 */

// §24.1–24.2 — Label reading (intake)
export { readLabels, type LabelReadResult } from './classifier/label-reader.js';

// §24.2 — Data classification
export { resolveHighestDataClass, classifyOutboundData } from './classifier/data-classifier.js';

// §24.3 — OCT ceiling enforcement
export { isFrontierTier, enforceOctModelCeiling } from './classifier/ceiling-enforcer.js';

// §24.4, §25 — Routing policy engine (load + validate + evaluate)
export {
  loadNvgRoutingPolicy,
  evaluateRoutingPolicy,
  matchesRoutingCondition,
  validateRoutingPolicy,
} from './router/policy-engine.js';
export type { PolicyLoaderCrypto } from './router/policy-engine.js';

// §26 — Model tier registry
export { TierRegistry, type FallbackConstraintResult } from './router/tier-registry.js';

// §24.5 — Model invocation
export { callEndpoint, invokeModel } from './router/model-router.js';

// §24.6, §24.7 — Inbound response logging + denial
export { logInboundResponse, handleNvgDenial } from './inbound/response-logger.js';

// §24.6 — Inbound response normalization
export { normalizeInboundResponse, isSuccessfulResponse } from './inbound/response-normalizer.js';

// §27 — Routing Provenance Trail
export {
  JsonlRoutingTrailWriter,
  JsonlRoutingTrailReader,
} from './trail/routing-provenance-trail-writer.js';

// §27.2 — Trail JSONL backend (combined writer+reader)
export { JsonlRoutingTrailBackend } from './trail/jsonl-routing-trail.backend.js';

// §24.5 — Model health
export { ModelHealthMonitor } from './health/model-health-monitor.js';

// §22.1/§23.2 — NvgService DI contract implementation (HOLE-S7-001)
export { NvgServiceImpl } from './nvg-service.js';

// NVG-internal types (§6.1 types/ directory)
export type { NvgPipelineResult, NvgNormalizedResponse, NvgDenialContext } from './types/index.js';
