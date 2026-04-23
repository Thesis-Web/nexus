/**
 * NVG Cross-Link Tests — spec §38.7
 * Verify all audit streams carry same runId for governed runs.
 * Run a scenario, collect entries from trail, assert every entry has correct runId.
 *
 * Full 3-stream cross-link (Evidence Ledger + Run Ledger + Routing Provenance Trail)
 * is verified in ci-gate Step 14. This test verifies the NVG trail stream independently.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { classifyOutboundData } from './classifier/data-classifier.js';
import { evaluateRoutingPolicy } from './router/policy-engine.js';
import { invokeModel } from './router/model-router.js';
import { TierRegistry } from './router/tier-registry.js';
import { handleInboundResponse, handleNvgDenial } from './inbound/response-logger.js';
import { JsonlRoutingTrailBackend } from './trail/jsonl-routing-trail.backend.js';

import {
  MODEL_TIER,
  OCT_LEVEL,
  DATA_CLASS,
  DENIAL_CODE,
  type NvgOutboundRequest,
  type NvgRoutingPolicy,
  type Uuid,
  type NonEmpty,
  type IsoTimestamp,
  type Base64Url,
  type DataLabel,
  type OctLevel,
  type EnvironmentId,
} from '@nexus/contracts';

let tmpDir: string;
let trailBackend: JsonlRoutingTrailBackend;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), 'nexus-nvg-xlink-' + randomUUID());
  await fs.mkdir(tmpDir, { recursive: true });
  trailBackend = new JsonlRoutingTrailBackend(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRequest(runId: Uuid, overrides: Partial<NvgOutboundRequest> = {}): NvgOutboundRequest {
  return {
    requestId: randomUUID() as Uuid,
    runId,
    actorId: randomUUID() as Uuid,
    octLevel: OCT_LEVEL.OPEN as OctLevel,
    environmentContext: 'dev' as EnvironmentId,
    taskIntent: 'summarize' as NonEmpty,
    payload: null,
    dataLabels: [{ source: 'dlp' as NonEmpty, label: DATA_CLASS.PUBLIC, confidence: 0.9 }],
    costPreference: 'standard',
    latencyPreference: 'standard',
    ...overrides,
  };
}

function makePolicy(): NvgRoutingPolicy {
  return {
    version: 'v0.1.0' as NonEmpty,
    policyId: randomUUID() as Uuid,
    issuer: 'nexus-admin' as NonEmpty,
    issuedAt: new Date().toISOString() as IsoTimestamp,
    defaultAction: 'deny',
    rules: [
      {
        ruleId: 'allow-public' as NonEmpty,
        priority: 100,
        conditions: { dataClasses: ['public'] },
        routeTo: MODEL_TIER.FRONTIER_GENERAL,
      },
    ],
    signature: 'FIXTURE_SYNTHETIC_SECRET:xlink-sig' as Base64Url,
  };
}

function makeRegistry(): TierRegistry {
  const now = new Date().toISOString() as IsoTimestamp;
  const registry = new TierRegistry();
  registry.registerEndpoint({
    endpointId: 'ep-fg' as NonEmpty,
    tier: MODEL_TIER.FRONTIER_GENERAL,
    url: 'http://localhost:9001' as NonEmpty,
    healthy: true,
    lastCheckAt: now,
  });
  return registry;
}

describe('NVG Cross-Link: runId consistency (§38.7)', () => {
  it('all trail entries from a single run share the same runId', async () => {
    const runId = randomUUID() as Uuid;
    const policy = makePolicy();
    const registry = makeRegistry();

    // Multiple NVG calls within the same run
    for (let i = 0; i < 3; i++) {
      const req = makeRequest(runId);
      const classification = classifyOutboundData(req.dataLabels);
      const decision = evaluateRoutingPolicy(policy, req, classification);

      if (decision.matched) {
        const invocation = await invokeModel(
          decision.routeTo!,
          decision.fallbackTier,
          req,
          classification,
          registry
        );
        const correlationId = randomUUID() as Uuid;
        await handleInboundResponse(correlationId, req, invocation, trailBackend, policy.version);
      }
    }

    // Add a denial for the same run
    const deniedReq = makeRequest(runId, {
      dataLabels: [],
      taskIntent: 'no_match' as NonEmpty,
    });
    await handleNvgDenial(
      deniedReq,
      DENIAL_CODE.NVG_ROUTING_POLICY_DENIED,
      'no match',
      trailBackend,
      policy.version
    );

    const entries = await trailBackend.getByRunId(runId);
    expect(entries.length).toBe(4); // 3 inbound + 1 outbound denial
    for (const entry of entries) {
      expect(entry.runId).toBe(runId);
    }
  });

  it('entries from different runs are not mixed', async () => {
    const runId1 = randomUUID() as Uuid;
    const runId2 = randomUUID() as Uuid;
    const policy = makePolicy();
    const registry = makeRegistry();

    // Run 1
    const req1 = makeRequest(runId1);
    const c1 = classifyOutboundData(req1.dataLabels);
    const d1 = evaluateRoutingPolicy(policy, req1, c1);
    const inv1 = await invokeModel(d1.routeTo!, d1.fallbackTier, req1, c1, registry);
    await handleInboundResponse(randomUUID() as Uuid, req1, inv1, trailBackend, policy.version);

    // Run 2
    const req2 = makeRequest(runId2);
    const c2 = classifyOutboundData(req2.dataLabels);
    const d2 = evaluateRoutingPolicy(policy, req2, c2);
    const inv2 = await invokeModel(d2.routeTo!, d2.fallbackTier, req2, c2, registry);
    await handleInboundResponse(randomUUID() as Uuid, req2, inv2, trailBackend, policy.version);

    const run1Entries = await trailBackend.getByRunId(runId1);
    const run2Entries = await trailBackend.getByRunId(runId2);

    expect(run1Entries.length).toBe(1);
    expect(run2Entries.length).toBe(1);
    expect(run1Entries[0]!.runId).toBe(runId1);
    expect(run2Entries[0]!.runId).toBe(runId2);
  });

  it('correlationId links outbound and inbound entries', async () => {
    const runId = randomUUID() as Uuid;
    const correlationId = randomUUID() as Uuid;
    const policy = makePolicy();
    const registry = makeRegistry();

    const req = makeRequest(runId);
    const classification = classifyOutboundData(req.dataLabels);
    const decision = evaluateRoutingPolicy(policy, req, classification);
    const invocation = await invokeModel(
      decision.routeTo!,
      decision.fallbackTier,
      req,
      classification,
      registry
    );

    // Log inbound with specific correlationId
    await handleInboundResponse(correlationId, req, invocation, trailBackend, policy.version);

    const byCorrelation = await trailBackend.getByCorrelationId(correlationId);
    expect(byCorrelation.length).toBe(1);
    expect(byCorrelation[0]!.correlationId).toBe(correlationId);
    expect(byCorrelation[0]!.runId).toBe(runId);
  });
});
