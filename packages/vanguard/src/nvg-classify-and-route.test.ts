/**
 * NVG classifyAndRoute — Composition Surface Tests
 *
 * NVG-PIPE-001 fix: proves the full wall invariant as a single executable checkpoint.
 * MODE-001 NVG: proves nvgMode consumption — non-enforcing evaluates but does not invoke.
 * NVG-RPT-001: proves outbound RPT entries are written on success.
 *
 * Spec pins: §7.5 (integration surface), §24.1–§24.6 (pipeline steps),
 *            §25 (routing policy), §27 (RPT), §9.1 (mode law)
 * Blueprint pins: §13.1–§13.8 (NVG wall law)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { NvgServiceImpl, type NvgServiceDeps } from './nvg-service.js';
import { TierRegistry } from './router/tier-registry.js';
import { JsonlRoutingTrailBackend } from './trail/jsonl-routing-trail.backend.js';

import {
  MODEL_TIER,
  OCT_LEVEL,
  DATA_CLASS,
  DENIAL_CODE,
  OPERATING_MODE,
  type NvgOutboundRequest,
  type NvgRoutingPolicy,
  type ModeConfiguration,
  type Uuid,
  type NonEmpty,
  type IsoTimestamp,
  type Base64Url,
  type OctLevel,
  type EnvironmentId,
  type ModelEndpoint,
} from '@nexus/contracts';

let tmpDir: string;
let trailBackend: JsonlRoutingTrailBackend;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), 'nexus-nvg-car-' + randomUUID());
  await fs.mkdir(tmpDir, { recursive: true });
  trailBackend = new JsonlRoutingTrailBackend(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Test Fixtures ───────────────────────────────────────────────────────────

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

function makeEndpoint(tier: string, id: string): ModelEndpoint {
  return {
    endpointId: id as NonEmpty,
    tier: tier as NonEmpty,
    url: `http://localhost:9000/${id}` as NonEmpty,
    adapterId: 'ollama-chat-v1' as NonEmpty,
    modelName: `test-model-${id}` as NonEmpty,
    auth: { kind: 'none' },
    healthy: true,
    lastCheckAt: new Date().toISOString() as IsoTimestamp,
  };
}

function makeRegistry(): TierRegistry {
  const registry = new TierRegistry();
  registry.registerEndpoint(makeEndpoint(MODEL_TIER.FRONTIER_GENERAL, 'ep-frontier'));
  registry.registerEndpoint(makeEndpoint(MODEL_TIER.ON_PREM_GENERAL, 'ep-onprem'));
  registry.registerEndpoint(makeEndpoint(MODEL_TIER.ON_PREM_SENSITIVE, 'ep-sensitive'));
  return registry;
}

function makeModeConfig(
  nxsMode = OPERATING_MODE.ENFORCING,
  nvgMode = OPERATING_MODE.ENFORCING
): ModeConfiguration {
  return {
    nxsMode,
    nvgMode,
    enforcingLocked: false,
    updatedAt: new Date().toISOString() as IsoTimestamp,
    updatedBy: {
      adminId: 'test-admin' as NonEmpty,
      publicKey: 'FIXTURE_SYNTHETIC_SECRET:test-pub' as Base64Url,
    },
    signature: 'FIXTURE_SYNTHETIC_SECRET:mode-sig' as Base64Url,
  };
}

function makeDeps(overrides: Partial<NvgServiceDeps> = {}): NvgServiceDeps {
  return {
    routingPolicy: makePolicy(),
    tierRegistry: makeRegistry(),
    trailWriter: trailBackend,
    modeConfig: makeModeConfig(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NVG classifyAndRoute — Full Wall Checkpoint (NVG-PIPE-001)', () => {
  it('routes public data from OCT-OPEN to frontier — full composition (§7.5)', async () => {
    const nvg = new NvgServiceImpl(makeDeps());
    const request = makeRequest();

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(true);
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.PUBLIC);
    expect(result.classification.isSensitive).toBe(false);
    expect(result.modelTierSelected).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(result.denialCode).toBeNull();
    expect(result.denialReason).toBeNull();
    expect(result.disposition).toBe('enforce');
    expect(result.trailCorrelationId).toBeTruthy();
    expect(result.completedAt).toBeTruthy();
    // Invocation present (stub path — no transportContext means stub success)
    expect(result.invocation).not.toBeNull();
    expect(result.invocation!.success).toBe(true);
  });

  it('denies when no routing rule matches — default deny (§25, blueprint §13.4)', async () => {
    const emptyPolicy = makePolicy({ rules: [] });
    const nvg = new NvgServiceImpl(makeDeps({ routingPolicy: emptyPolicy }));
    const request = makeRequest();

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_ROUTING_POLICY_DENIED);
    expect(result.denialReason).toContain('no matching routing rule');
    expect(result.modelTierSelected).toBeNull();
    expect(result.modelTierInvoked).toBeNull();
    expect(result.invocation).toBeNull();
  });

  it('denies sensitive data routed to frontier — hard wall (blueprint §13.3)', async () => {
    // Policy that routes PII to frontier (this is a routing rule that matches,
    // but ceiling enforcer denies because sensitive → frontier is hard-denied)
    const dangerousPolicy = makePolicy({
      rules: [
        {
          ruleId: 'bad-rule' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['pii'] },
          routeTo: MODEL_TIER.FRONTIER_GENERAL, // ← violated ceiling
        },
      ],
    });
    const nvg = new NvgServiceImpl(makeDeps({ routingPolicy: dangerousPolicy }));
    const request = makeRequest({
      dataLabels: [{ source: 'dlp' as NonEmpty, label: DATA_CLASS.PII, confidence: 0.99 }],
    });

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_CLASSIFICATION_DENIED);
    expect(result.denialReason).toContain('sensitive data cannot reach frontier');
    expect(result.invocation).toBeNull();
  });

  it('denies OCT-SECURE actor requesting frontier tier (§24.2 ceiling enforcement)', async () => {
    // Policy routes public data to frontier WITHOUT octLevel restriction —
    // the ceiling enforcer (not the routing policy) must deny OCT-SECURE → frontier.
    const policy = makePolicy({
      rules: [
        {
          ruleId: 'rule-public-any-oct' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['public'] },
          routeTo: MODEL_TIER.FRONTIER_GENERAL,
        },
      ],
    });
    const nvg = new NvgServiceImpl(makeDeps({ routingPolicy: policy }));
    const request = makeRequest({ octLevel: OCT_LEVEL.SECURE as OctLevel });

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
    expect(result.invocation).toBeNull();
  });

  it('uses fallback tier when primary is ceiling-denied but fallback is allowed', async () => {
    // OCT-SECURE can access on_prem_sensitive only, not frontier.
    // Policy routes to frontier with fallback to on_prem_sensitive.
    const policy = makePolicy({
      rules: [
        {
          ruleId: 'rule-with-fallback' as NonEmpty,
          priority: 100,
          conditions: { dataClasses: ['public'] },
          routeTo: MODEL_TIER.FRONTIER_GENERAL,
          fallbackTier: MODEL_TIER.ON_PREM_SENSITIVE,
        },
      ],
    });
    const nvg = new NvgServiceImpl(makeDeps({ routingPolicy: policy }));
    const request = makeRequest({ octLevel: OCT_LEVEL.SECURE as OctLevel });

    const result = await nvg.classifyAndRoute(request);

    // Primary (frontier) is ceiling-denied for OCT-SECURE.
    // Fallback (on_prem_sensitive) is allowed for OCT-SECURE.
    expect(result.allowed).toBe(true);
    expect(result.modelTierSelected).toBe(MODEL_TIER.ON_PREM_SENSITIVE);
    expect(result.denialCode).toBeNull();
    expect(result.invocation).not.toBeNull();
  });

  it('writes outbound RPT entry on allowed routing (NVG-RPT-001)', async () => {
    const runId = randomUUID() as Uuid;
    const nvg = new NvgServiceImpl(makeDeps());
    const request = makeRequest({ runId });

    await nvg.classifyAndRoute(request);

    // Read trail entries
    const entries = await trailBackend.getByRunId(runId);
    // Should have at least 2: one outbound (routing decision) + one inbound (response)
    const outbound = entries.filter(e => e.direction === 'outbound');
    const inbound = entries.filter(e => e.direction === 'inbound');
    expect(outbound.length).toBeGreaterThanOrEqual(1);
    expect(inbound.length).toBeGreaterThanOrEqual(1);
    // Outbound entry has model tier selected
    expect(outbound[0]!.modelTierSelected).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(outbound[0]!.denialCode).toBeNull();
  });

  it('writes denial RPT entry when routing denies (NVG-RPT-001)', async () => {
    const runId = randomUUID() as Uuid;
    const emptyPolicy = makePolicy({ rules: [] });
    const nvg = new NvgServiceImpl(makeDeps({ routingPolicy: emptyPolicy }));
    const request = makeRequest({ runId });

    await nvg.classifyAndRoute(request);

    const entries = await trailBackend.getByRunId(runId);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const denial = entries.find(e => e.denialCode !== null);
    expect(denial).toBeTruthy();
    expect(denial!.denialCode).toBe(DENIAL_CODE.NVG_ROUTING_POLICY_DENIED);
  });

  it('throws when classifyAndRoute called without constructor deps', async () => {
    const nvg = new NvgServiceImpl(); // no deps
    const request = makeRequest();

    await expect(nvg.classifyAndRoute(request)).rejects.toThrow(
      'classifyAndRoute requires constructor deps'
    );
  });
});

describe('NVG classifyAndRoute — Mode Consumption (MODE-001 NVG)', () => {
  it('observe mode: evaluates full decision chain but does NOT invoke model', async () => {
    const modeConfig = makeModeConfig(OPERATING_MODE.ENFORCING, OPERATING_MODE.OBSERVE);
    const nvg = new NvgServiceImpl(makeDeps({ modeConfig }));
    const request = makeRequest();

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(true);
    expect(result.disposition).toBe('observe');
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.PUBLIC);
    expect(result.modelTierSelected).toBe(MODEL_TIER.FRONTIER_GENERAL);
    // Invocation is null — observe mode does not invoke
    expect(result.invocation).toBeNull();
    expect(result.modelTierInvoked).toBeNull();
  });

  it('advisory mode: evaluates full decision chain but does NOT invoke model', async () => {
    const modeConfig = makeModeConfig(OPERATING_MODE.ENFORCING, OPERATING_MODE.ADVISORY);
    const nvg = new NvgServiceImpl(makeDeps({ modeConfig }));
    const request = makeRequest();

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(true);
    expect(result.disposition).toBe('advisory');
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.PUBLIC);
    expect(result.modelTierSelected).toBe(MODEL_TIER.FRONTIER_GENERAL);
    expect(result.invocation).toBeNull();
    expect(result.modelTierInvoked).toBeNull();
  });

  it('enforcing mode: evaluates AND invokes model (§9.1)', async () => {
    const modeConfig = makeModeConfig(OPERATING_MODE.ENFORCING, OPERATING_MODE.ENFORCING);
    const nvg = new NvgServiceImpl(makeDeps({ modeConfig }));
    const request = makeRequest();

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(true);
    expect(result.disposition).toBe('enforce');
    expect(result.invocation).not.toBeNull();
    expect(result.invocation!.success).toBe(true);
  });

  it('observe mode still writes outbound RPT entry for audit trail (§9.1, §27)', async () => {
    const runId = randomUUID() as Uuid;
    const modeConfig = makeModeConfig(OPERATING_MODE.ENFORCING, OPERATING_MODE.OBSERVE);
    const nvg = new NvgServiceImpl(makeDeps({ modeConfig }));
    const request = makeRequest({ runId });

    await nvg.classifyAndRoute(request);

    const entries = await trailBackend.getByRunId(runId);
    // Outbound entry written even in observe mode
    const outbound = entries.filter(e => e.direction === 'outbound');
    expect(outbound.length).toBeGreaterThanOrEqual(1);
    // But NO inbound entry — model was not invoked
    const inbound = entries.filter(e => e.direction === 'inbound');
    expect(inbound.length).toBe(0);
  });

  it('unknown nvgMode fails closed — enforces (§9.1)', async () => {
    const modeConfig = makeModeConfig(OPERATING_MODE.ENFORCING, 'garbage_mode' as string);
    const nvg = new NvgServiceImpl(makeDeps({ modeConfig }));
    const request = makeRequest();

    const result = await nvg.classifyAndRoute(request);

    // Unknown mode → enforce disposition (fail closed)
    expect(result.disposition).toBe('enforce');
    // Model is invoked because unknown mode maps to enforcing
    expect(result.invocation).not.toBeNull();
  });
});

describe('NVG classifyAndRoute — Individual Methods Backward Compat', () => {
  it('classify() works without constructor deps', () => {
    const nvg = new NvgServiceImpl();
    const result = nvg.classify([
      { source: 'dlp' as NonEmpty, label: DATA_CLASS.PII, confidence: 0.99 },
    ]);
    expect(result.isSensitive).toBe(true);
    expect(result.effectiveDataClass).toBe(DATA_CLASS.PII);
  });

  it('enforceOctCeiling() works without constructor deps', () => {
    const nvg = new NvgServiceImpl();
    const classification = nvg.classify([
      { source: 'dlp' as NonEmpty, label: DATA_CLASS.PUBLIC, confidence: 0.95 },
    ]);
    const result = nvg.enforceOctCeiling(
      OCT_LEVEL.OPEN as OctLevel,
      MODEL_TIER.FRONTIER_GENERAL,
      classification
    );
    expect(result.allowed).toBe(true);
  });
});

// ─── Label Validation Proof (NVG-CLASS-001 / D2-AUD-026) ──────────────────
// Proves readLabels() is wired into classifyAndRoute() before classifyOutboundData().

describe('NVG classifyAndRoute — Label Validation (NVG-CLASS-001)', () => {
  function makeDeps(trailDir: string): NvgServiceDeps {
    const tierReg = new TierRegistry();
    tierReg.registerEndpoint(makeEndpoint(MODEL_TIER.FRONTIER_GENERAL, 'ep-fg-1'));
    tierReg.registerEndpoint(makeEndpoint(MODEL_TIER.ON_PREM_SENSITIVE, 'ep-ops-1'));
    const tb = new JsonlRoutingTrailBackend(trailDir);
    return {
      routingPolicy: makePolicy(),
      tierRegistry: tierReg,
      trailWriter: tb,
      modeConfig: makeModeConfig(),
    };
  }

  it('denies when all labels are rejected (malformed) — fail closed', async () => {
    const deps = makeDeps(tmpDir);
    const nvg = new NvgServiceImpl(deps);

    const result = await nvg.classifyAndRoute(
      makeRequest({
        dataLabels: [
          // Missing source → rejected by readLabels
          { source: '' as NonEmpty, label: DATA_CLASS.PUBLIC, confidence: 0.9 },
          // Unknown data class → rejected by readLabels
          { source: 'dlp' as NonEmpty, label: 'INVALID_CLASS' as any, confidence: 0.9 },
        ],
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_CLASSIFICATION_DENIED);
    expect(result.denialReason).toContain('rejected');
  });

  it('passes valid labels through to classification after readLabels validation', async () => {
    const deps = makeDeps(tmpDir);
    const nvg = new NvgServiceImpl(deps);

    const result = await nvg.classifyAndRoute(
      makeRequest({
        dataLabels: [
          // One valid label + one invalid → readLabels keeps valid, rejects invalid
          { source: 'dlp' as NonEmpty, label: DATA_CLASS.PII, confidence: 0.95 },
          { source: '' as NonEmpty, label: DATA_CLASS.PUBLIC, confidence: 0.5 },
        ],
      })
    );

    // Should succeed — valid PII label survives validation
    // PII → sensitive → routed to on_prem_sensitive by policy
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.PII);
    expect(result.classification.isSensitive).toBe(true);
  });

  it('allows empty labels — classifies as public (no labels is not a rejection)', async () => {
    const deps = makeDeps(tmpDir);
    const nvg = new NvgServiceImpl(deps);

    const result = await nvg.classifyAndRoute(makeRequest({ dataLabels: [] }));

    // Empty labels → readLabels returns empty validLabels with 0 rejected
    // classifyOutboundData([]) → PUBLIC
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.PUBLIC);
  });
});
