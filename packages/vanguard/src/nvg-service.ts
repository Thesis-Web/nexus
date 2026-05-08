/**
 * NvgServiceImpl — spec §7.5, §22.1/§23.2, §24-§27
 *
 * NVG-PIPE-001 fix: classifyAndRoute() composes the full NVG wall —
 *   classify → route → ceiling → invoke → inbound → RPT
 * as a single executable checkpoint (spec §7.5 integration surface).
 *
 * HOLE-S7-001 solve: wraps vanguard pure functions behind NvgService interface.
 * MODE-001 NVG: nvgMode consumed — non-enforcing evaluates but does not invoke.
 * NVG-RPT-001 fix: outbound RPT entry written on every event.
 *
 * Layer 3 — imports from @nexus/contracts only + internal vanguard modules.
 */
import {
  DENIAL_CODE,
  OPERATING_MODE,
  OCT_CEILINGS,
  type NvgService,
  type NvgClassifyAndRouteResult,
  type NvgClassificationResult,
  type NvgCeilingResult,
  type NvgRoutingDecision,
  type NvgRoutingPolicy,
  type NvgOutboundRequest,
  type NvgInvocationResult,
  type NvgRoutingPreview,
  type NvgRoutingPreviewEndpoint,
  type RoutingTrailWriter,
  type NvgTransportContext,
  type ModeConfiguration,
  type DataLabel,
  type OctLevel,
  type ModelTier,
  type DenialCode,
  type Uuid,
  type NonEmpty,
  type IsoTimestamp,
  type RuntimeDisposition,
} from '@nexus/contracts';
import { classifyOutboundData } from './classifier/data-classifier.js';
import { enforceOctModelCeiling } from './classifier/ceiling-enforcer.js';
import { readLabels } from './classifier/label-reader.js';
import { evaluateRoutingPolicy, validateRoutingPolicy } from './router/policy-engine.js';
import { invokeModel } from './router/model-router.js';
import { handleInboundResponse, handleNvgDenial } from './inbound/response-logger.js';
import type { TierRegistry } from './router/tier-registry.js';

// ── NVG Service Dependencies ────────────────────────────────────────────────

/** Constructor deps for NvgServiceImpl. Layer 3 internal — not exported to Layer 2. */
export interface NvgServiceDeps {
  readonly routingPolicy: NvgRoutingPolicy;
  readonly tierRegistry: TierRegistry;
  readonly trailWriter: RoutingTrailWriter;
  readonly transportContext: NvgTransportContext; // T6-F03: mandatory — no stub-success path
  readonly modeConfig: ModeConfiguration;
}

// ── NVG Service Implementation ──────────────────────────────────────────────

export class NvgServiceImpl implements NvgService {
  private readonly deps: NvgServiceDeps | null;

  /**
   * Construct with full deps for classifyAndRoute composition.
   * If no deps provided, individual methods still work (backward compat).
   */
  constructor(deps?: NvgServiceDeps) {
    this.deps = deps ?? null;
  }

  // ── Individual methods (unchanged from HOLE-S7-001) ──────────────────────

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

  // ── §7.5 Composition Surface — classifyAndRoute ──────────────────────────

  /**
   * Full NVG wall checkpoint: classify → route → ceiling → invoke → inbound → RPT.
   *
   * Pipeline:
   *   1. Label validation (§24.1) — readLabels() validates structure, rejects invalid
   *   2. Data classification (§24.2) — label-driven, never infers content
   *   3. Policy-governed routing (§24.3, §25) — default-deny if no match
   *   4. OCT ceiling enforcement (§24.2, blueprint §13.3) — more restrictive wins
   *   4. Outbound RPT entry (§27) — written on every event
   *   5. Mode check — non-enforcing evaluates but does not invoke (MODE-001)
   *   6. Model invocation with same-tier retry + fallback (§24.5)
   *   7. Inbound return path logging (§24.6) — log + normalize
   *
   * Denials at any step terminate the pipeline and write a denial RPT entry.
   * Non-enforcing modes evaluate the full decision chain but skip invocation.
   *
   * @param request - NVG outbound request (§24.1)
   * @returns Full pipeline result including classification, routing, invocation, and trail IDs
   */
  async classifyAndRoute(request: NvgOutboundRequest): Promise<NvgClassifyAndRouteResult> {
    if (!this.deps) {
      throw new Error(
        'NvgServiceImpl: classifyAndRoute requires constructor deps (routingPolicy, tierRegistry, trailWriter, modeConfig)'
      );
    }
    const { routingPolicy, tierRegistry, trailWriter, transportContext, modeConfig } = this.deps;
    const correlationId = crypto.randomUUID() as Uuid;
    const policyVersion = routingPolicy.version;
    const disposition = this.resolveNvgDisposition();

    // ── Step 1: Label Validation (§24.1) ──────────────────────────────────────
    // readLabels validates structure, clamps confidence, rejects unknown data
    // classes, and flags unknown provenance. This is the canonical label-validation
    // boundary per spec §24.1, blueprint §13.2–§13.3.
    const labelResult = readLabels(request.dataLabels);

    if (labelResult.rejectedCount > 0 && labelResult.validLabels.length === 0) {
      // All labels rejected — fail closed. Cannot classify without valid labels.
      const reason = `all ${labelResult.rejectedCount} label(s) rejected: ${labelResult.notes.join('; ')}`;
      await handleNvgDenial(
        request,
        DENIAL_CODE.NVG_CLASSIFICATION_DENIED,
        reason,
        trailWriter,
        policyVersion,
        correlationId
      );
      return this.buildResult({
        allowed: false,
        classification: classifyOutboundData([]),
        modelTierSelected: null,
        modelTierInvoked: null,
        denialCode: DENIAL_CODE.NVG_CLASSIFICATION_DENIED as DenialCode,
        denialReason: reason,
        trailCorrelationId: correlationId,
        disposition,
        invocation: null,
      });
    }

    // ── Step 2: Data Classification (§24.2) ────────────────────────────────
    const classification = classifyOutboundData(labelResult.validLabels);

    // ── Step 3: Policy-Governed Model Router (§24.3, §25) ──────────────────
    const routingDecision = evaluateRoutingPolicy(routingPolicy, request, classification);

    if (!routingDecision.matched || routingDecision.routeTo === null) {
      // Default-deny — no matching routing rule (§25, blueprint §13.4)
      await handleNvgDenial(
        request,
        DENIAL_CODE.NVG_ROUTING_POLICY_DENIED,
        'no matching routing rule — default deny',
        trailWriter,
        policyVersion,
        correlationId
      );
      return this.buildResult({
        allowed: false,
        classification,
        modelTierSelected: null,
        modelTierInvoked: null,
        denialCode: DENIAL_CODE.NVG_ROUTING_POLICY_DENIED as DenialCode,
        denialReason: 'no matching routing rule — default deny',
        trailCorrelationId: correlationId,
        disposition,
        invocation: null,
      });
    }

    // ── Step 2b: OCT Ceiling Enforcement (§24.2, blueprint §13.3) ──────────
    // T6-F05 FIX: Primary OCT ceiling denial is TERMINAL per blueprint §13.5.
    // Fallback is for availability/health only (inside invokeModel), never for
    // escaping an OCT ceiling denial. If primary tier exceeds ceiling, deny.
    let approvedTier: ModelTier = routingDecision.routeTo;
    const fallbackTier: ModelTier | null = routingDecision.fallbackTier;

    const ceilingPrimary = enforceOctModelCeiling(request.octLevel, approvedTier, classification);

    if (!ceilingPrimary.allowed) {
      // OCT ceiling denied — terminal. Do NOT try fallback.
      const code = ceilingPrimary.denialCode ?? DENIAL_CODE.NVG_OCT_CEILING_DENIED;
      const reason = ceilingPrimary.reason ?? 'OCT ceiling denied primary tier';
      await handleNvgDenial(request, code, reason, trailWriter, policyVersion, correlationId);
      return this.buildResult({
        allowed: false,
        classification,
        modelTierSelected: routingDecision.routeTo,
        modelTierInvoked: null,
        denialCode: code as DenialCode,
        denialReason: reason,
        trailCorrelationId: correlationId,
        disposition,
        invocation: null,
      });
    }

    // ── Step 4: Outbound RPT entry (§27) — approved routing decision ───────
    // NVG-RPT-001 fix: write outbound trail entry on every allowed routing decision
    await trailWriter.append({
      entryId: crypto.randomUUID() as Uuid,
      runId: request.runId,
      correlationId,
      direction: 'outbound',
      actorId: request.actorId,
      octLevel: request.octLevel,
      dataClassification: classification.effectiveDataClass,
      routingPolicyVersion: policyVersion,
      modelTierSelected: approvedTier,
      modelTierInvoked: null, // not yet invoked
      endpointId: null,
      adapterId: null,
      modelName: null,
      providerModelNameReturned: null,
      denialCode: null,
      denialReason: null,
      fallbackApplied: approvedTier !== routingDecision.routeTo,
      fallbackFromTier: approvedTier !== routingDecision.routeTo ? routingDecision.routeTo : null,
      costMetrics: { requestCost: null, responseCost: null },
      latencyMs: 0,
      responseSize: null,
      timestamp: new Date().toISOString() as IsoTimestamp,
    });

    // ── Step 5: Mode check (MODE-001) ──────────────────────────────────────
    // Non-enforcing modes evaluate the full decision chain but skip invocation.
    // "Mode controls whether the decision is acted upon — not whether it is recorded." (§9.1)
    // Uses resolved disposition — unknown mode maps to 'enforce' (fail closed, §9.1).
    if (disposition !== 'enforce') {
      // T6-F04 / RULING-001: classification/routing evaluated but model NOT invoked.
      return this.buildResult({
        allowed: true,
        classification,
        modelTierSelected: approvedTier,
        modelTierInvoked: null, // not invoked in non-enforcing mode
        denialCode: null,
        denialReason: null,
        trailCorrelationId: correlationId,
        disposition,
        invocation: null,
        nonEnforcingDisposition: 'routed_not_invoked',
      });
    }

    // ── Step 6: Model Invocation (§24.5) — same-tier retry + fallback ──────
    const invocation = await invokeModel(
      approvedTier,
      fallbackTier,
      request,
      classification,
      tierRegistry,
      transportContext
    );

    // ── Step 7: Inbound Return Path Logging (§24.6) ────────────────────────
    await handleInboundResponse(correlationId, request, invocation, trailWriter, policyVersion);

    return this.buildResult({
      allowed: invocation.success,
      classification,
      modelTierSelected: approvedTier,
      modelTierInvoked: invocation.endpointUsed?.tier ?? null,
      denialCode: (invocation.denialCode as DenialCode) ?? null,
      denialReason: invocation.reason ?? null,
      trailCorrelationId: correlationId,
      disposition,
      invocation,
    });
  }

  // ── §CHECKBACK Pre-flight surface — previewRouting ──────────────────────

  /**
   * CHECKBACK-spec Part 1 — non-invoking routing preview.
   *
   * Runs classify → route → ceiling exactly as `classifyAndRoute` would,
   * then probes `tierRegistry` for endpoint health. Stops before invocation;
   * NEVER calls the model. Used by the orchestrator's pre-flight checkback
   * (sendPlanCheckback) so the user can be asked before the DAG executor
   * dispatches a request that will fail at the NVG wall.
   *
   * Returns enough information for the workspace to render a "Plan Review
   * Required" card that names the unhealthy primary tier and points at a
   * within-ceiling alternative tier (and the concrete endpoint that would
   * serve it).
   *
   * Determinism note: the alternative is the first within-OCT-ceiling tier
   * (in the order declared by `OCT_CEILINGS[octLevel].modelTierCeiling`)
   * that is not the primary tier and currently has a healthy or
   * probationary endpoint. No re-routing happens here — NVG itself runs
   * the real routing/fallback chain at dispatch time.
   */
  async previewRouting(request: NvgOutboundRequest): Promise<NvgRoutingPreview> {
    if (!this.deps) {
      throw new Error('NvgServiceImpl: previewRouting requires constructor deps');
    }
    const { routingPolicy, tierRegistry } = this.deps;

    const labelResult = readLabels(request.dataLabels);
    const classification = classifyOutboundData(labelResult.validLabels);

    const decision = evaluateRoutingPolicy(routingPolicy, request, classification);

    if (!decision.matched || decision.routeTo === null) {
      return {
        primaryTier: null,
        primaryHealthy: false,
        fallbackTier: null,
        fallbackHealthy: false,
        alternativeTier: this.findAlternativeTier(request.octLevel, null, tierRegistry),
        alternativeEndpoint: null,
        classification,
        ceilingAllowed: false,
        denialCode: DENIAL_CODE.NVG_ROUTING_POLICY_DENIED as DenialCode,
        denialReason: 'no matching routing rule — default deny',
      };
    }

    const primaryTier: ModelTier = decision.routeTo;
    const fallbackTier: ModelTier | null = decision.fallbackTier;

    const ceiling = enforceOctModelCeiling(request.octLevel, primaryTier, classification);
    const ceilingAllowed = ceiling.allowed;

    const primaryHealthy = ceilingAllowed && tierRegistry.isTierAvailable(primaryTier);
    const fallbackHealthy =
      fallbackTier !== null && tierRegistry.isTierAvailable(fallbackTier)
        ? this.fallbackPermitted(primaryTier, fallbackTier, classification, request.octLevel)
        : false;

    const alternativeTier = this.findAlternativeTier(request.octLevel, primaryTier, tierRegistry);
    let alternativeEndpoint: NvgRoutingPreviewEndpoint | null = null;
    if (alternativeTier !== null) {
      const candidates = tierRegistry.getHealthyEndpoints(alternativeTier);
      const ep = candidates[0];
      if (ep) {
        alternativeEndpoint = {
          endpointId: ep.endpointId,
          modelName: ep.modelName,
          tier: ep.tier,
        };
      }
    }

    return {
      primaryTier,
      primaryHealthy,
      fallbackTier,
      fallbackHealthy,
      alternativeTier,
      alternativeEndpoint,
      classification,
      ceilingAllowed,
      denialCode: ceilingAllowed ? null : ((ceiling.denialCode as DenialCode) ?? null),
      denialReason: ceilingAllowed ? null : (ceiling.reason ?? null),
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Find the first within-ceiling tier (other than `excludeTier`) that has at
   * least one healthy or probationary endpoint. Returns null if no such tier
   * exists. Order follows OCT_CEILINGS[octLevel].modelTierCeiling so the
   * preview is deterministic across runs.
   */
  private findAlternativeTier(
    octLevel: OctLevel,
    excludeTier: ModelTier | null,
    tierRegistry: NvgServiceDeps['tierRegistry']
  ): ModelTier | null {
    const ceiling = OCT_CEILINGS[octLevel];
    if (!ceiling) return null;
    for (const tier of ceiling.modelTierCeiling) {
      if (tier === excludeTier) continue;
      if (tierRegistry.isTierAvailable(tier)) return tier;
    }
    return null;
  }

  /**
   * Preview-time fallback eligibility check — mirrors the constraint logic
   * inside `model-router.invokeModel` so the preview's fallbackHealthy flag
   * matches what NVG would actually do at dispatch time.
   */
  private fallbackPermitted(
    primaryTier: ModelTier,
    fallbackTier: ModelTier,
    classification: NvgClassificationResult,
    octLevel: OctLevel
  ): boolean {
    const constraint = this.deps!.tierRegistry.checkFallbackConstraint(
      primaryTier,
      fallbackTier,
      classification.effectiveDataClass,
      octLevel
    );
    return constraint.allowed;
  }

  /**
   * Resolve nvgMode → RuntimeDisposition.
   * Mirrors mode-runtime.ts resolveDisposition() but uses Layer 2 constants only
   * (NVG cannot import from Layer 1 core).
   */
  private resolveNvgDisposition(): RuntimeDisposition {
    if (!this.deps) return 'enforce';
    const mode = this.deps.modeConfig.nvgMode;
    switch (mode) {
      case OPERATING_MODE.OBSERVE:
        return 'observe';
      case OPERATING_MODE.ADVISORY:
        return 'advisory';
      case OPERATING_MODE.ENFORCING:
        return 'enforce';
      default:
        // Unknown mode fails closed — never weaken enforcement posture (§9.1)
        return 'enforce';
    }
  }

  /** Build a complete NvgClassifyAndRouteResult with timestamp. */
  private buildResult(
    fields: Omit<NvgClassifyAndRouteResult, 'completedAt'>
  ): NvgClassifyAndRouteResult {
    return {
      ...fields,
      completedAt: new Date().toISOString() as IsoTimestamp,
    };
  }
}
