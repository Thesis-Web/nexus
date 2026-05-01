/**
 * NVG Integration Tests — spec §38.5
 * Test NVG outbound classification, routing, denial, inbound logging.
 * Verify Routing Provenance Trail entries are written and cross-linked by runId.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { classifyOutboundData, resolveHighestDataClass } from './classifier/data-classifier.js';
import { enforceOctModelCeiling, isFrontierTier } from './classifier/ceiling-enforcer.js';
import { evaluateRoutingPolicy, validateRoutingPolicy } from './router/policy-engine.js';
import { invokeModel } from './router/model-router.js';
import { TierRegistry } from './router/tier-registry.js';
import { handleInboundResponse, handleNvgDenial } from './inbound/response-logger.js';
import { normalizeInboundResponse } from './inbound/response-normalizer.js';
import { JsonlRoutingTrailBackend } from './trail/jsonl-routing-trail.backend.js';
import { ModelHealthMonitor } from './health/model-health-monitor.js';

import {
  MODEL_TIER,
  OCT_LEVEL,
  DATA_CLASS,
  DENIAL_CODE,
  type NvgOutboundRequest,
  type NvgRoutingPolicy,
  type NvgTransportContext,
  type ModelTransportAdapter,
  type ModelEndpointResponse,
  type SecretSource,
  type Uuid,
  type NonEmpty,
  type IsoTimestamp,
  type Base64Url,
  type DataLabel,
  type OctLevel,
  type EnvironmentId,
} from '@nexus/contracts';

// T6-F03 FIX: Tests must inject an explicit fixture transport adapter.
// The stub-success path in model-router was removed — transportContext is mandatory.
function makeFixtureTransportContext(): NvgTransportContext {
  const fixtureAdapter: ModelTransportAdapter = {
    adapterId: 'fixture-adapter' as NonEmpty,
    adapterVersion: 'v0.0.1' as NonEmpty,
    configSchema: { parse: (v: unknown) => v } as any,
    async invoke(): Promise<ModelEndpointResponse> {
      return { success: true, responseSize: 0, latencyMs: 1 };
    },
  };
  const registry = {
    register() {},
    get(): ModelTransportAdapter | null {
      return fixtureAdapter;
    },
    list(): ModelTransportAdapter[] {
      return [fixtureAdapter];
    },
  };
  const secretSource: SecretSource = {
    async canResolve() {
      return true;
    },
    async resolve() {
      return 'FIXTURE_SECRET';
    },
  };
  return { registry, secretSource };
}

const fixtureTransport = makeFixtureTransportContext();

let tmpDir: string;
let trailBackend: JsonlRoutingTrailBackend;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), 'nexus-nvg-int-' + randomUUID());
  await fs.mkdir(tmpDir, { recursive: true });
  trailBackend = new JsonlRoutingTrailBackend(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRequest(overrides: Partial<NvgOutboundRequest> = {}): NvgOutboundRequest {
  return {
    requestId: randomUUID() as Uuid,
    runId: randomUUID() as Uuid,
    actorId: randomUUID() as Uuid,
    octLevel: OCT_LEVEL.OPEN as OctLevel,
    environmentContext: 'dev' as EnvironmentId,
    taskIntent: 'summarize document' as NonEmpty,
    payload: { text: 'test payload' },
    dataLabels: [{ source: 'dlp' as NonEmpty, label: DATA_CLASS.PUBLIC, confidence: 0.95 }],
    costPreference: 'standard',
    latencyPreference: 'standard',
    ...overrides,
  };
}

function makePolicy(overrides: Partial<NvgRoutingPolicy> = {}): NvgRoutingPolicy {
  return {
    version: 'v0.1.0' as NonEmpty,
    policyId: randomUUID() as Uuid,
    issuer: 'nexus-admin' as NonEmpty,
    issuedAt: new Date().toISOString() as IsoTimestamp,
    defaultAction: 'deny',
    rules: [
      {
        ruleId: 'rule-public-frontier' as NonEmpty,
        priority: 100,
        conditions: { dataClasses: ['public'], octLevels: ['OCT-OPEN', 'OCT-CONFIDENTIAL'] },
        routeTo: MODEL_TIER.FRONTIER_GENERAL,
        fallbackTier: MODEL_TIER.ON_PREM_GENERAL,
      },
      {
        ruleId: 'rule-internal-onprem' as NonEmpty,
        priority: 200,
        conditions: { dataClasses: ['internal'] },
        routeTo: MODEL_TIER.ON_PREM_GENERAL,
      },
      {
        ruleId: 'rule-sensitive-onprem' as NonEmpty,
        priority: 300,
        conditions: { dataClasses: ['pii', 'phi', 'financial', 'confidential'] },
        routeTo: MODEL_TIER.ON_PREM_SENSITIVE,
      },
    ],
    signature: 'FIXTURE_SYNTHETIC_SECRET:test-sig' as Base64Url,
    ...overrides,
  };
}

function makeRegistry(): TierRegistry {
  const now = new Date().toISOString() as IsoTimestamp;
  const registry = new TierRegistry();
  registry.registerEndpoint({
    endpointId: 'ep-frontier-general' as NonEmpty,
    tier: MODEL_TIER.FRONTIER_GENERAL,
    url: 'http://localhost:9001' as NonEmpty,
    healthy: true,
    lastCheckAt: now,
  });
  registry.registerEndpoint({
    endpointId: 'ep-onprem-general' as NonEmpty,
    tier: MODEL_TIER.ON_PREM_GENERAL,
    url: 'http://localhost:9002' as NonEmpty,
    healthy: true,
    lastCheckAt: now,
  });
  registry.registerEndpoint({
    endpointId: 'ep-onprem-sensitive' as NonEmpty,
    tier: MODEL_TIER.ON_PREM_SENSITIVE,
    url: 'http://localhost:9003' as NonEmpty,
    healthy: true,
    lastCheckAt: now,
  });
  return registry;
}

describe('NVG Integration: Full Pipeline (§38.5)', () => {
  it('routes public data from OCT-OPEN actor to frontier_general — full flow', async () => {
    const runId = randomUUID() as Uuid;
    const request = makeRequest({ runId, octLevel: OCT_LEVEL.OPEN });
    const policy = makePolicy();
    const registry = makeRegistry();

    // Step 2: Classify
    const classification = classifyOutboundData(request.dataLabels);
    expect(classification.isSensitive).toBe(false);
    expect(classification.effectiveDataClass).toBe(DATA_CLASS.PUBLIC);

    // Step 3: OCT ceiling
    const ceilingResult = enforceOctModelCeiling(
      request.octLevel,
      MODEL_TIER.FRONTIER_GENERAL,
      classification
    );
    expect(ceilingResult.allowed).toBe(true);

    // Step 4: Routing policy
    validateRoutingPolicy(policy);
    const routingDecision = evaluateRoutingPolicy(policy, request, classification);
    expect(routingDecision.matched).toBe(true);
    expect(routingDecision.routeTo).toBe(MODEL_TIER.FRONTIER_GENERAL);

    // Step 5: Model invocation (stub)
    const invocation = await invokeModel(
      routingDecision.routeTo!,
      routingDecision.fallbackTier,
      request,
      classification,
      registry,
      fixtureTransport
    );
    expect(invocation.success).toBe(true);
    expect(invocation.fallbackApplied).toBe(false);

    // Step 6: Log inbound response
    const correlationId = randomUUID() as Uuid;
    await handleInboundResponse(correlationId, request, invocation, trailBackend, policy.version);

    // Step 7: Normalize inbound response (§24.6 — inbound step 2)
    const normalized = normalizeInboundResponse(invocation);
    expect(normalized.success).toBe(true);
    expect(normalized.sourceTier).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(normalized.fallbackApplied).toBe(false);

    // Verify trail entries
    const entries = await trailBackend.getByRunId(runId);
    expect(entries.length).toBe(1);
    expect(entries[0]!.runId).toBe(runId);
    expect(entries[0]!.direction).toBe('inbound');
    expect(entries[0]!.denialCode).toBeNull();
    expect(entries[0]!.modelTierInvoked).toBe(MODEL_TIER.FRONTIER_GENERAL);
  });

  it('routes sensitive data (PII) to on_prem_sensitive — never frontier', async () => {
    const runId = randomUUID() as Uuid;
    const request = makeRequest({
      runId,
      octLevel: OCT_LEVEL.CONFIDENTIAL,
      dataLabels: [{ source: 'dlp' as NonEmpty, label: DATA_CLASS.PII, confidence: 0.99 }],
    });
    const policy = makePolicy();
    const registry = makeRegistry();

    // Classify
    const classification = classifyOutboundData(request.dataLabels);
    expect(classification.isSensitive).toBe(true);

    // OCT ceiling — hard wall blocks frontier for sensitive data
    const ceilingFrontier = enforceOctModelCeiling(
      request.octLevel,
      MODEL_TIER.FRONTIER_GENERAL,
      classification
    );
    expect(ceilingFrontier.allowed).toBe(false);

    // Routing policy routes PII → on_prem_sensitive
    const routingDecision = evaluateRoutingPolicy(policy, request, classification);
    expect(routingDecision.matched).toBe(true);
    expect(routingDecision.routeTo).toBe(MODEL_TIER.ON_PREM_SENSITIVE);

    // Verify on_prem_sensitive passes OCT ceiling for OCT-CONFIDENTIAL
    const ceilingOnprem = enforceOctModelCeiling(
      request.octLevel,
      MODEL_TIER.ON_PREM_SENSITIVE,
      classification
    );
    expect(ceilingOnprem.allowed).toBe(true);

    // Invoke
    const invocation = await invokeModel(
      routingDecision.routeTo!,
      routingDecision.fallbackTier ?? null,
      request,
      classification,
      registry,
      fixtureTransport
    );
    expect(invocation.success).toBe(true);

    // Log
    const correlationId = randomUUID() as Uuid;
    await handleInboundResponse(correlationId, request, invocation, trailBackend, policy.version);

    const entries = await trailBackend.getByRunId(runId);
    expect(entries.length).toBe(1);
    expect(entries[0]!.modelTierInvoked).toBe(MODEL_TIER.ON_PREM_SENSITIVE);
  });

  it('denies when no routing rule matches — default deny', async () => {
    const runId = randomUUID() as Uuid;
    const request = makeRequest({
      runId,
      dataLabels: [],
      taskIntent: 'unknown_task' as NonEmpty,
    });
    const classification = classifyOutboundData(request.dataLabels);

    // Empty policy → no matching rule
    const emptyPolicy = makePolicy({ rules: [] });
    const routingDecision = evaluateRoutingPolicy(emptyPolicy, request, classification);
    expect(routingDecision.matched).toBe(false);
    expect(routingDecision.routeTo).toBeNull();

    // Log denial
    await handleNvgDenial(
      request,
      DENIAL_CODE.NVG_ROUTING_POLICY_DENIED,
      'no matching routing rule',
      trailBackend,
      emptyPolicy.version
    );

    const entries = await trailBackend.getByRunId(runId);
    expect(entries.length).toBe(1);
    expect(entries[0]!.denialCode).toBe(DENIAL_CODE.NVG_ROUTING_POLICY_DENIED);
    expect(entries[0]!.modelTierSelected).toBeNull();
    expect(entries[0]!.modelTierInvoked).toBeNull();
  });

  it('falls back when primary endpoint is unhealthy', async () => {
    const runId = randomUUID() as Uuid;
    const request = makeRequest({ runId });
    const policy = makePolicy();
    const classification = classifyOutboundData(request.dataLabels);

    const routingDecision = evaluateRoutingPolicy(policy, request, classification);
    expect(routingDecision.routeTo).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(routingDecision.fallbackTier).toBe(MODEL_TIER.ON_PREM_GENERAL);

    // Make primary unhealthy
    const registry = makeRegistry();
    registry.getEndpoints(MODEL_TIER.FRONTIER_GENERAL)[0]!.healthy = false;

    const invocation = await invokeModel(
      routingDecision.routeTo!,
      routingDecision.fallbackTier,
      request,
      classification,
      registry,
      fixtureTransport
    );
    expect(invocation.success).toBe(true);
    expect(invocation.fallbackApplied).toBe(true);
    expect(invocation.fallbackFromTier).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(invocation.endpointUsed?.tier).toBe(MODEL_TIER.ON_PREM_GENERAL);
  });

  it('denies fallback when it would violate sensitive data ceiling', async () => {
    const runId = randomUUID() as Uuid;
    const request = makeRequest({
      runId,
      octLevel: OCT_LEVEL.CONFIDENTIAL,
      dataLabels: [{ source: 'dlp' as NonEmpty, label: DATA_CLASS.PII, confidence: 0.99 }],
    });
    const classification = classifyOutboundData(request.dataLabels);

    // Policy with on_prem_sensitive primary, frontier fallback (should be blocked)
    const dangerousPolicy = makePolicy({
      rules: [
        {
          ruleId: 'sensitive-with-bad-fallback' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['pii'] },
          routeTo: MODEL_TIER.ON_PREM_SENSITIVE,
          fallbackTier: MODEL_TIER.FRONTIER_GENERAL,
        },
      ],
    });

    const routingDecision = evaluateRoutingPolicy(dangerousPolicy, request, classification);
    expect(routingDecision.routeTo).toBe(MODEL_TIER.ON_PREM_SENSITIVE);

    // Make primary unhealthy to force fallback attempt
    const registry = makeRegistry();
    registry.getEndpoints(MODEL_TIER.ON_PREM_SENSITIVE)[0]!.healthy = false;

    const invocation = await invokeModel(
      routingDecision.routeTo!,
      routingDecision.fallbackTier,
      request,
      classification,
      registry,
      fixtureTransport
    );
    expect(invocation.success).toBe(false);
    expect(invocation.denialCode).toBe(DENIAL_CODE.NVG_FALLBACK_DENIED);
    expect(invocation.fallbackApplied).toBe(false);
  });

  it('trail entries are cross-linked by runId across outbound and inbound', async () => {
    const runId = randomUUID() as Uuid;
    const request = makeRequest({ runId });
    const policy = makePolicy();
    const registry = makeRegistry();
    const classification = classifyOutboundData(request.dataLabels);

    const routingDecision = evaluateRoutingPolicy(policy, request, classification);
    const invocation = await invokeModel(
      routingDecision.routeTo!,
      routingDecision.fallbackTier,
      request,
      classification,
      registry,
      fixtureTransport
    );

    // Log both outbound denial for another request and inbound for this one
    const request2 = makeRequest({
      runId, // same runId
      dataLabels: [],
      taskIntent: 'no_match' as NonEmpty,
    });
    const classification2 = classifyOutboundData(request2.dataLabels);
    const routingDecision2 = evaluateRoutingPolicy(
      makePolicy({ rules: [] }),
      request2,
      classification2
    );
    expect(routingDecision2.matched).toBe(false);

    await handleNvgDenial(
      request2,
      DENIAL_CODE.NVG_ROUTING_POLICY_DENIED,
      'no match',
      trailBackend,
      policy.version
    );

    const correlationId = randomUUID() as Uuid;
    await handleInboundResponse(correlationId, request, invocation, trailBackend, policy.version);

    // All entries for this runId
    const entries = await trailBackend.getByRunId(runId);
    expect(entries.length).toBe(2);
    for (const entry of entries) {
      expect(entry.runId).toBe(runId);
    }
    expect(entries.some(e => e.direction === 'outbound')).toBe(true);
    expect(entries.some(e => e.direction === 'inbound')).toBe(true);
  });

  it('ModelHealthMonitor tracks endpoint health', () => {
    const monitor = new ModelHealthMonitor();
    const now = new Date().toISOString() as IsoTimestamp;
    const ep: ModelEndpoint = {
      endpointId: 'ep-1' as NonEmpty,
      tier: MODEL_TIER.FRONTIER_GENERAL,
      url: 'http://localhost:9001' as NonEmpty,
      healthy: true,
      lastCheckAt: now,
    };
    monitor.register(ep);
    expect(monitor.getHealthy().length).toBe(1);
    monitor.markUnhealthy('ep-1');
    expect(monitor.getHealthy().length).toBe(0);
    expect(monitor.getEndpoints().length).toBe(1);
    monitor.markHealthy('ep-1');
    expect(monitor.getHealthy().length).toBe(1);
  });
});
