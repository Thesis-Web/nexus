/**
 * @nexus/vanguard — Layer 3 barrel export
 * NVG wall enforcement engine.
 * Imports from @nexus/contracts (Layer 2) ONLY.
 * Never imports from @nexus/core (Layer 1).
 *
 * Spec: nexus-engineering-spec-v1-7-25.md §24-§27
 */

// §24.2 — Data classification
export { resolveHighestDataClass, classifyOutboundData } from './classifier/data-classifier.js';

// §24.3 — OCT ceiling enforcement
export { isFrontierTier, enforceOctModelCeiling } from './classifier/ceiling-enforcer.js';

// §24.4, §25 — Routing policy
export {
  evaluateRoutingPolicy,
  matchesRoutingCondition,
  validateRoutingPolicy,
} from './router/routing-policy.js';

// §24.5 — Model invocation
export { callEndpoint, invokeModel } from './router/model-invoker.js';

// §24.6, §24.7 — Inbound response logging + denial
export { logInboundResponse, handleNvgDenial } from './inbound/response-logger.js';

// §27 — Routing Provenance Trail
export { JsonlRoutingTrailWriter, JsonlRoutingTrailReader } from './trail/trail-writer.js';

// §24.5 — Model health
export { ModelHealthMonitor } from './health/model-health.js';

// §22.1/§23.2 — NvgService DI contract implementation (HOLE-S7-001)
export { NvgServiceImpl } from './nvg-service.js';

export { loadNvgRoutingPolicy } from './router/policy-loader.js';
export type { PolicyLoaderCrypto } from './router/policy-loader.js';
