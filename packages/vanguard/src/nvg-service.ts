/**
 * NvgServiceImpl — spec §22.1/§23.2 DI contract implementation
 * HOLE-S7-001 solve: wraps vanguard pure functions behind NvgService interface.
 * Layer 3 — imports from @nexus/contracts only + internal vanguard modules.
 */
import type {
  NvgService,
  NvgClassificationResult,
  NvgCeilingResult,
  NvgRoutingDecision,
  NvgRoutingPolicy,
  NvgOutboundRequest,
  DataLabel,
  OctLevel,
  ModelTier,
} from '@nexus/contracts';
import { classifyOutboundData } from './classifier/data-classifier.js';
import { enforceOctModelCeiling } from './classifier/ceiling-enforcer.js';
import { evaluateRoutingPolicy, validateRoutingPolicy } from './router/policy-engine.js';

export class NvgServiceImpl implements NvgService {
  classify(labels: DataLabel[]): NvgClassificationResult {
    return classifyOutboundData(labels);
  }

  enforceOctCeiling(
    octLevel: OctLevel,
    requestedTier: ModelTier,
    classification: NvgClassificationResult
  ): NvgCeilingResult {
    return enforceOctModelCeiling(octLevel, requestedTier, classification);
  }

  route(
    policy: NvgRoutingPolicy,
    request: NvgOutboundRequest,
    classification: NvgClassificationResult
  ): NvgRoutingDecision {
    return evaluateRoutingPolicy(policy, request, classification);
  }

  validatePolicy(policy: NvgRoutingPolicy): void {
    validateRoutingPolicy(policy);
  }
}
