/**
 * Gate 03 — Delegation — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.4
 */

import { describe, it, expect, vi } from 'vitest';
import { DelegationGate } from '../gates/03-delegation.gate.js';
import {
  DENIAL_CODE, ACTOR_CLASS,
  type AgentAction, type PipelineContext, type DelegationContext,
} from '../types/index.js';

const NOW    = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();
const PAST   = new Date(Date.now() - 300_000).toISOString();

// Valid Ed25519 keys for signing — we'll use a mock verifier approach
// Gate 03 imports `verify` from crypto/verifier. We'll inject via a test key pair
// that we canonicalize and sign ourselves.
// Simpler approach: mock the gate's internal verify call by using the real crypto layer.
import { generateControlPlaneKeypair } from '../crypto/key-manager.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';

async function makeSignedDelegation(overrides: Partial<DelegationContext> = {}): Promise<{ dc: DelegationContext; keyPair: Awaited<ReturnType<typeof generateControlPlaneKeypair>> }> {
  const keyPair = await generateControlPlaneKeypair();
  const base: Omit<DelegationContext, 'signature'> = {
    delegationId:               'delegation-001',
    principalId:                'principal-001',
    actorId:                    'actor-001',
    parentDelegationId:         null,
    chainDepth:                 0,
    maxChainDepth:              3,
    allowedSystems:             ['stub'],
    allowedCapabilities:        ['read:record:single'],
    forbiddenCapabilities:      [],
    maxRiskTier:                'high',
    allowDownstreamPropagation: false,
    environment:                'dev',
    mintedAt:                   NOW,
    expiresAt:                  FUTURE,
    mintedBy:                   'nexus-delegation-engine/v0.1.0',
    ...overrides,
  };
  const signature = await sign(canonicalize(base), keyPair.privateKey);
  return { dc: { ...base, signature }, keyPair };
}

function makeAction(resolvedTarget: { system: string; environment: string; resourceType: string; resourceScope: string; externalFacing: boolean } | null, capability = 'read:record:single'): AgentAction {
  return {
    actionId: 'a-003', receivedAt: NOW, protocol: 'mcp/1.0', adapterVersion: 'v0.1.0',
    actorId: 'actor-001', principalId: 'p-001', sessionId: 's-001', delegationId: 'delegation-001',
    delegationSequence: 1, tool: 'get_record', rawVerb: 'read', rawTarget: '{}', rawPayload: {},
    intent: { objectiveSummary: 'test', triggeringSource: 'unknown', toolchainContext: 'test', modelId: null, modelConfidence: null, riskNote: null, extractedAt: NOW },
    resolvedVerb: 'read', resolvedCapability: capability,
    resolvedTarget: resolvedTarget as never,
    resolvedDataClasses: [], resolvedRiskTier: 'low',
  };
}

function makeCtx(dc: DelegationContext): PipelineContext {
  return {
    sessionId: 's-001',
    actor: { actorId: 'actor-001', actorClass: ACTOR_CLASS.HUMAN, principalId: 'p-001', displayName: 'T', environment: 'dev', riskCeiling: 'high', allowedSystems: ['stub'], registeredAt: NOW, owner: null, purpose: null, reviewCadence: null },
    principal: { principalId: 'p-001', displayName: 'P', email: 'p@test.com', registeredAt: NOW, maxDelegableRiskTier: 'high', allowedSystems: ['stub'] },
    delegationContext: dc,
    delegationStore: { getById: vi.fn().mockResolvedValue(dc), save: vi.fn(), listForActor: vi.fn() },
    policyFile: null, approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [], startedAt: NOW,
  } as unknown as PipelineContext;
}

describe('Gate 03 — Delegation', () => {
  it('passes on valid delegation with correct signature', async () => {
    const { dc, keyPair } = await makeSignedDelegation();
    const gate = new DelegationGate(keyPair);
    const action = makeAction({ system: 'stub', environment: 'dev', resourceType: 'record', resourceScope: 'single', externalFacing: false });
    const result = await gate.evaluate(action, makeCtx(dc), []);
    expect(result.decision.outcome).toBe('pass');
  });

  it('denies DELEGATION_SIG_INVALID when signature does not verify', async () => {
    const { dc, keyPair } = await makeSignedDelegation();
    const tampered = { ...dc, signature: 'invalidsig' };
    const gate = new DelegationGate(keyPair);
    const action = makeAction({ system: 'stub', environment: 'dev', resourceType: 'record', resourceScope: 'single', externalFacing: false });
    const result = await gate.evaluate(action, makeCtx(tampered), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_SIG_INVALID);
  });

  it('denies DELEGATION_EXPIRED when delegation is past expiresAt', async () => {
    const { dc, keyPair } = await makeSignedDelegation({ expiresAt: PAST });
    const gate = new DelegationGate(keyPair);
    const action = makeAction({ system: 'stub', environment: 'dev', resourceType: 'record', resourceScope: 'single', externalFacing: false });
    const result = await gate.evaluate(action, makeCtx(dc), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_EXPIRED);
  });

  it('denies CAPABILITY_NOT_IN_DELEGATION when capability not allowed', async () => {
    const { dc, keyPair } = await makeSignedDelegation();
    const gate = new DelegationGate(keyPair);
    const action = makeAction({ system: 'stub', environment: 'dev', resourceType: 'record', resourceScope: 'single', externalFacing: false }, 'delete:record');
    const result = await gate.evaluate(action, makeCtx(dc), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION);
  });

  it('denies ENVIRONMENT_MISMATCH when action target env differs from delegation env', async () => {
    const { dc, keyPair } = await makeSignedDelegation();
    const gate = new DelegationGate(keyPair);
    const action = makeAction({ system: 'stub', environment: 'production', resourceType: 'record', resourceScope: 'single', externalFacing: false });
    const result = await gate.evaluate(action, makeCtx(dc), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.ENVIRONMENT_MISMATCH);
  });

  it('denies SYSTEM_NOT_IN_DELEGATION when action system not in allowedSystems', async () => {
    const { dc, keyPair } = await makeSignedDelegation();
    const gate = new DelegationGate(keyPair);
    const action = makeAction({ system: 'vault', environment: 'dev', resourceType: 'record', resourceScope: 'single', externalFacing: false });
    const result = await gate.evaluate(action, makeCtx(dc), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SYSTEM_NOT_IN_DELEGATION);
  });

  it('has gateId gate_03_delegation and gateOrder 3', async () => {
    const { keyPair } = await makeSignedDelegation();
    const gate = new DelegationGate(keyPair);
    expect(gate.gateId).toBe('gate_03_delegation');
    expect(gate.gateOrder).toBe(3);
    expect(gate.plane).toBe('control');
  });
});
