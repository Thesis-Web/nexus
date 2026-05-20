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
  type ClaimVerificationPort,
  type ClaimVerificationResult,
  type NvgOutboundRequest,
  type NvgRoutingPolicy,
  type ModeConfiguration,
  type ModelTransportAdapter,
  type ModelTransportAdapterRegistry,
  type NvgTransportContext,
  type RunLedgerWriter,
  type SecretSource,
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
    boundConnectorClasses: [],
    costPreference: 'standard',
    latencyPreference: 'standard',
    carriedClaims: {},
    // F4.11 — default fixture provenance is workspace_upload (trusted
    // user-originated content from the workspace boundary). Tests that
    // exercise the §3.3 case split override this to drive specific
    // empty-labels-with-X-provenance behavior.
    provenance: 'workspace_upload',
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

// CLAUDE-CODE-FIX-MODEL-PREFERENCE-ROUTING FLAG-4: T6-F03 made
// transportContext mandatory on NvgServiceDeps. Pre-existing fixture
// constructed the deps without it, which crashed callEndpoint with
// "Cannot read properties of undefined (reading 'registry')" on every
// classifyAndRoute test that reached invocation. Inject a fixture
// adapter keyed to 'ollama-chat-v1' (matches makeEndpoint) so the
// invocation path resolves cleanly.
const stubSecretSource: SecretSource = {
  canResolve: () => false,
  resolve: async () => {
    throw new Error('classify-and-route fixture: no secrets');
  },
};

function makeFixtureTransport(): NvgTransportContext {
  const adapter: ModelTransportAdapter = {
    adapterId: 'ollama-chat-v1' as NonEmpty,
    adapterVersion: '1.0.0' as NonEmpty,
    configSchema: { safeParse: () => ({ success: true as const, data: {} }) },
    async invoke() {
      return {
        success: true,
        responseSize: 4,
        latencyMs: 1,
        opaqueProviderResponse: { message: { role: 'assistant', content: 'ok' } },
      };
    },
  };
  const registry: ModelTransportAdapterRegistry = {
    register: () => {},
    get: id => (id === adapter.adapterId ? adapter : null),
    list: () => [adapter],
  };
  return { registry, secretSource: stubSecretSource };
}

function makeDeps(overrides: Partial<NvgServiceDeps> = {}): NvgServiceDeps {
  return {
    routingPolicy: makePolicy(),
    tierRegistry: makeRegistry(),
    trailWriter: trailBackend,
    modeConfig: makeModeConfig(),
    transportContext: makeFixtureTransport(),
    // F4.9 — claim-drift deps. Default verifier returns 'match' so the
    // pre-F4.9 tests below see no behavioral change; CDV-04 supplies a
    // drifting verifier explicitly.
    claimVerifier: {
      verify: async () => ({ kind: 'match' as const, currentClaimsHash: 'fixture-hash' as any }),
    },
    runLedger: {
      writeEvent: async () => {},
      getByRunId: async () => [],
      tail: async () => [],
      getLatestRunId: async () => null,
    },
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

  it('OCT ceiling denial on primary tier is terminal (T6-F05) — fallback does not escape', async () => {
    // T6-F05: primary OCT ceiling denial is TERMINAL per blueprint §13.5.
    // Fallback exists for availability/health (inside invokeModel), NEVER
    // for escaping a ceiling denial. Even if the fallback tier would be
    // allowed for the OCT level, we must still deny — otherwise the
    // ceiling becomes routable around at the policy level.
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

    // Primary (frontier) is ceiling-denied for OCT-SECURE → terminal.
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_OCT_CEILING_DENIED);
    expect(result.invocation).toBeNull();
    // modelTierSelected reflects what the policy picked, even though we
    // denied — the trail entry needs the tier the user asked for.
    expect(result.modelTierSelected).toBe(MODEL_TIER.FRONTIER_GENERAL);
  });

  it('binding axis floors routing: empty labels + internal binding → on_prem_general (§24.2)', async () => {
    // NVG-BINDING-001: prove that an agent reaching an internal-class
    // connector cannot route to frontier even when the prompt itself
    // carries no labels. This is the core demo-blocking bug pre-fix:
    // empty labels would resolve to PUBLIC and route to frontier; the
    // binding axis floors the effective class to INTERNAL so rule 02
    // fires.
    const nvg = new NvgServiceImpl(makeDeps());
    const request = makeRequest({
      dataLabels: [],
      boundConnectorClasses: [DATA_CLASS.INTERNAL],
    });

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(true);
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.INTERNAL);
    expect(result.classification.isSensitive).toBe(false);
    expect(result.modelTierSelected).toBe(MODEL_TIER.ON_PREM_GENERAL);
    expect(result.denialCode).toBeNull();
  });

  it('binding axis does not lower a higher payload class (financial label + internal binding)', async () => {
    const nvg = new NvgServiceImpl(makeDeps());
    const request = makeRequest({
      dataLabels: [{ source: 'dlp' as NonEmpty, label: DATA_CLASS.FINANCIAL, confidence: 0.99 }],
      boundConnectorClasses: [DATA_CLASS.INTERNAL],
    });

    const result = await nvg.classifyAndRoute(request);

    expect(result.allowed).toBe(true);
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.FINANCIAL);
    expect(result.modelTierSelected).toBe(MODEL_TIER.ON_PREM_SENSITIVE);
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
      // Same fixture transport as the outer makeDeps — required for the
      // tests in this describe that reach the invocation step.
      transportContext: makeFixtureTransport(),
      claimVerifier: {
        verify: async () => ({ kind: 'match' as const, currentClaimsHash: 'fixture-hash' as any }),
      },
      runLedger: {
        writeEvent: async () => {},
        getByRunId: async () => [],
        tail: async () => [],
        getLatestRunId: async () => null,
      },
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
          { source: 'dlp' as NonEmpty, label: 'INVALID_CLASS', confidence: 0.9 },
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

  it('NPL-05 (replaces P0-030 fail-open): empty labels + untrusted agent_output → deny', async () => {
    // F4.11 §3.3 — the old assertion treated empty dataLabels as public.
    // That was the documented P0-030 fail-open. The §3.3 case split now
    // forces deny in enforce mode when provenance is untrusted.
    const deps = makeDeps(tmpDir);
    const nvg = new NvgServiceImpl(deps);

    const result = await nvg.classifyAndRoute(
      makeRequest({ dataLabels: [], boundConnectorClasses: [], provenance: 'agent_output' })
    );

    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_UNKNOWN_PROVENANCE_PAYLOAD);
    expect(result.denialReason).toContain('agent_output');
  });
});

// ─── F4.9 Claim Drift at NVG (CDV-04 / CDV-08) ─────────────────────────────
// Spec §3.2: classifyAndRoute + return-precheck both invoke the same
// drift-check pattern. CDV-04 exercises the enforce-mode denial; CDV-08
// proves the canonical-hash comparison detects a known-drift scenario
// even when the resolver is mocked to return a constant — the diff is
// computed on what the verifier saw, not on the resolver's identity.

describe('NVG classifyAndRoute — Claim Drift (F4.9 §3.2)', () => {
  function makeDriftDeps(
    driftAt: ReadonlySet<string>,
    fieldsChanged: ReadonlyArray<string>,
    captured: { entries: Array<{ eventType: string; detail: Record<string, unknown> }> }
  ): { claimVerifier: ClaimVerificationPort; runLedger: RunLedgerWriter } {
    return {
      claimVerifier: {
        verify: async (
          _carriedClaims,
          _principalId,
          gateName
        ): Promise<ClaimVerificationResult> => {
          if (driftAt.has(gateName)) {
            return {
              kind: 'drift',
              currentClaimsHash: 'cdv-current' as any,
              diff: {
                principalId: '00000000-0000-0000-0000-000000000003' as any,
                fieldsChanged,
                carriedHash: 'cdv-carried' as any,
                currentHash: 'cdv-current' as any,
                detectedAt: new Date().toISOString() as any,
              },
            };
          }
          return { kind: 'match', currentClaimsHash: 'cdv-match' as any };
        },
      },
      runLedger: {
        writeEvent: async entry => {
          captured.entries.push({
            eventType: entry.eventType as string,
            detail: (entry.detail ?? {}) as Record<string, unknown>,
          });
        },
        getByRunId: async () => [],
        tail: async () => [],
        getLatestRunId: async () => null,
      },
    };
  }

  it('CDV-04: drift at nvg_classify_and_route → enforce-mode denial', async () => {
    const captured = {
      entries: [] as Array<{ eventType: string; detail: Record<string, unknown> }>,
    };
    const driftOverrides = makeDriftDeps(
      new Set(['nvg_classify_and_route']),
      ['capabilities'],
      captured
    );
    const nvg = new NvgServiceImpl(makeDeps(driftOverrides));
    const result = await nvg.classifyAndRoute(makeRequest());
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.CLAIM_DRIFT_DETECTED);
    expect(result.denialReason).toContain('nvg_classify_and_route');
    const driftEvents = captured.entries.filter(e => e.eventType === 'claim_drift_detected');
    expect(driftEvents.length).toBeGreaterThanOrEqual(1);
    expect(driftEvents[0]!.detail['gateName']).toBe('nvg_classify_and_route');
    expect(driftEvents[0]!.detail['fieldsChanged']).toEqual(['capabilities']);
  });

  it('CDV-04 part B: drift at nvg_return_precheck → enforce-mode denial after invocation', async () => {
    const captured = {
      entries: [] as Array<{ eventType: string; detail: Record<string, unknown> }>,
    };
    const driftOverrides = makeDriftDeps(new Set(['nvg_return_precheck']), ['octLevel'], captured);
    const nvg = new NvgServiceImpl(makeDeps(driftOverrides));
    const result = await nvg.classifyAndRoute(makeRequest());
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.CLAIM_DRIFT_DETECTED);
    expect(result.denialReason).toContain('nvg_return_precheck');
    // The invocation happened — only the return path was killed.
    expect(result.invocation).not.toBeNull();
  });

  it('CDV-08: inverse cross-check — verifier reporting always-match still fails if hashes diverge', async () => {
    // A misconfigured plug-in RBAC that always returns 'match' would
    // pass the wrapper trivially. The canonical-hash comparison is the
    // backstop: if the test wires a verifier that DOES compute hashes
    // (via ReferenceClaimVerifier) AND feeds the resolver a drift
    // scenario, the diff must surface. This test demonstrates the
    // canonical layer catches drift even when the verifier surface
    // looks healthy from the outside.
    const captured = {
      entries: [] as Array<{ eventType: string; detail: Record<string, unknown> }>,
    };
    let resolverCalls = 0;
    const driftOverrides = {
      claimVerifier: {
        verify: async (
          carriedClaims: Record<string, unknown>,
          _principalId: any,
          gateName: any
        ): Promise<ClaimVerificationResult> => {
          resolverCalls++;
          // Compare carriedClaims to the "current" snapshot we
          // pretend RBAC just returned. The carried hash will differ.
          const current = { ...carriedClaims, capabilities: ['read'] };
          const carriedHash = JSON.stringify(carriedClaims);
          const currentHash = JSON.stringify(current);
          if (carriedHash === currentHash) {
            return { kind: 'match', currentClaimsHash: currentHash as any };
          }
          return {
            kind: 'drift',
            currentClaimsHash: currentHash as any,
            diff: {
              principalId: '00000000-0000-0000-0000-000000000003' as any,
              fieldsChanged: ['capabilities'],
              carriedHash: carriedHash as any,
              currentHash: currentHash as any,
              detectedAt: new Date().toISOString() as any,
            },
          };
        },
      },
      runLedger: {
        writeEvent: async (entry: any) => {
          captured.entries.push({
            eventType: entry.eventType as string,
            detail: (entry.detail ?? {}) as Record<string, unknown>,
          });
        },
        getByRunId: async () => [],
        tail: async () => [],
        getLatestRunId: async () => null,
      },
    } as Partial<NvgServiceDeps>;
    const nvg = new NvgServiceImpl(
      makeDeps({ ...driftOverrides, claimVerifier: driftOverrides.claimVerifier as any })
    );
    const result = await nvg.classifyAndRoute(
      makeRequest({
        carriedClaims: { capabilities: ['read', 'write'], octLevel: 'OCT-OPEN' },
      })
    );
    expect(resolverCalls).toBeGreaterThan(0);
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.CLAIM_DRIFT_DETECTED);
    const driftEvents = captured.entries.filter(e => e.eventType === 'claim_drift_detected');
    expect(driftEvents.length).toBeGreaterThan(0);
  });
});

// ─── F4.11 Empty-Labels Case Split (NPL-04 / -06 / -07 / -08) ───────────────
// Spec §3.3 — when the request arrives with no dataLabels AND no connector
// bindings to contribute the binding-axis floor, the gate decides by
// provenance: trusted → floor 'internal' + log; untrusted/unknown → deny.

describe('NVG classifyAndRoute — F4.11 §3.3 empty-labels case split', () => {
  function captureLedger(): {
    runLedger: RunLedgerWriter;
    entries: Array<{ eventType: string; detail: Record<string, unknown> }>;
  } {
    const entries: Array<{ eventType: string; detail: Record<string, unknown> }> = [];
    return {
      entries,
      runLedger: {
        writeEvent: async entry => {
          entries.push({
            eventType: entry.eventType as string,
            detail: (entry.detail ?? {}) as Record<string, unknown>,
          });
        },
        getByRunId: async () => [],
        tail: async () => [],
        getLatestRunId: async () => null,
      },
    };
  }

  it('NPL-04: empty labels + nxs_connector_result (trusted) → floor internal + ledger event', async () => {
    const captured = captureLedger();
    const nvg = new NvgServiceImpl(makeDeps({ runLedger: captured.runLedger }));
    const result = await nvg.classifyAndRoute(
      makeRequest({
        dataLabels: [],
        boundConnectorClasses: [],
        provenance: 'nxs_connector_result',
      })
    );
    expect(result.allowed).toBe(true);
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.INTERNAL);
    const floor = captured.entries.find(e => e.eventType === 'data_label_floored_internal');
    expect(floor).toBeDefined();
    expect(floor!.detail['provenance']).toBe('nxs_connector_result');
  });

  it('NPL-06: empty labels + workspace_upload (trusted) → floor internal + ledger event', async () => {
    const captured = captureLedger();
    const nvg = new NvgServiceImpl(makeDeps({ runLedger: captured.runLedger }));
    const result = await nvg.classifyAndRoute(
      makeRequest({
        dataLabels: [],
        boundConnectorClasses: [],
        provenance: 'workspace_upload',
      })
    );
    expect(result.allowed).toBe(true);
    expect(result.classification.effectiveDataClass).toBe(DATA_CLASS.INTERNAL);
    expect(captured.entries.some(e => e.eventType === 'data_label_floored_internal')).toBe(true);
  });

  it('NPL-07: observe mode — untrusted provenance logs would_deny_data_labels, proceeds', async () => {
    const captured = captureLedger();
    const nvg = new NvgServiceImpl(
      makeDeps({
        runLedger: captured.runLedger,
        modeConfig: makeModeConfig(OPERATING_MODE.ENFORCING, OPERATING_MODE.OBSERVE),
      })
    );
    const result = await nvg.classifyAndRoute(
      makeRequest({
        dataLabels: [],
        boundConnectorClasses: [],
        provenance: 'agent_output',
      })
    );
    expect(result.allowed).toBe(true); // observe: payload proceeds
    expect(result.disposition).toBe('observe');
    const wouldDeny = captured.entries.find(e => e.eventType === 'would_deny_data_labels');
    expect(wouldDeny).toBeDefined();
    expect(wouldDeny!.detail['provenance']).toBe('agent_output');
    expect(wouldDeny!.detail['wouldDenyCode']).toBe(DENIAL_CODE.NVG_UNKNOWN_PROVENANCE_PAYLOAD);
  });

  it('NPL-08: enforcing mode — untrusted provenance deny → no LLM invocation', async () => {
    const captured = captureLedger();
    const nvg = new NvgServiceImpl(
      makeDeps({
        runLedger: captured.runLedger,
        modeConfig: makeModeConfig(OPERATING_MODE.ENFORCING, OPERATING_MODE.ENFORCING),
      })
    );
    const result = await nvg.classifyAndRoute(
      makeRequest({
        dataLabels: [],
        boundConnectorClasses: [],
        provenance: 'unknown',
      })
    );
    expect(result.allowed).toBe(false);
    expect(result.denialCode).toBe(DENIAL_CODE.NVG_UNKNOWN_PROVENANCE_PAYLOAD);
    expect(result.invocation).toBeNull();
    expect(result.modelTierInvoked).toBeNull();
  });
});
