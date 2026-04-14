/**
 * Gate 01 — Identity — unit tests
 * Spec: nexus-engineering-spec-v0-4-6.md §13.2
 * SOLVE-011: session store returns regardless of expiry; Gate 01 owns expiry semantics.
 * HOLE-002: Gate 01 resolves delegationContext as part of identity tuple.
 */

import { describe, it, expect, vi } from 'vitest';
import { IdentityGate } from '../gates/01-identity.gate.js';
import {
  DENIAL_CODE, ACTOR_CLASS,
  type Actor, type Session, type Principal, type DelegationContext,
  type AgentAction, type PipelineContext,
} from '../types/index.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const NOW    = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();
const PAST   = new Date(Date.now() - 300_000).toISOString();

const ACTOR: Actor = {
  actorId:       'actor-001',
  actorClass:    ACTOR_CLASS.HUMAN,
  principalId:   'principal-001',
  displayName:   'Test User',
  environment:   'dev',
  riskCeiling:   'high',
  allowedSystems: ['stub'],
  registeredAt:  NOW,
  owner:         null,
  purpose:       null,
  reviewCadence: null,
};

const PRINCIPAL: Principal = {
  principalId:          'principal-001',
  displayName:          'Test Principal',
  email:                'test@example.com',
  registeredAt:         NOW,
  maxDelegableRiskTier: 'high',
  allowedSystems:       ['stub'],
};

const SESSION: Session = {
  sessionId:    'session-001',
  actorId:      'actor-001',
  principalId:  'principal-001',
  delegationId: 'delegation-001',
  createdAt:    NOW,
  expiresAt:    FUTURE,
};

const DELEGATION: DelegationContext = {
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
  signature:                  'test-sig',
};

const ACTION: AgentAction = {
  actionId:            'action-001',
  receivedAt:          NOW,
  protocol:            'mcp/1.0',
  adapterVersion:      'v0.1.0',
  actorId:             'actor-001',
  principalId:         'principal-001',
  sessionId:           'session-001',
  delegationId:        'delegation-001',
  delegationSequence:  1,
  tool:                'get_record',
  rawVerb:             'read',
  rawTarget:           '{}',
  rawPayload:          {},
  intent: {
    objectiveSummary: 'read a record',
    triggeringSource: 'unknown',
    toolchainContext: 'test',
    modelId:          null,
    modelConfidence:  null,
    riskNote:         null,
    extractedAt:      NOW,
  },
  resolvedVerb:        null,
  resolvedCapability:  null,
  resolvedTarget:      null,
  resolvedDataClasses: [],
  resolvedRiskTier:    null,
};

function makeContext(): PipelineContext {
  return {
    sessionId:        'session-001',
    delegationStore:  { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile:       null,
    approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry:  { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog:        [],
    startedAt:        NOW,
  } as unknown as PipelineContext;
}

function makeGate(overrides: {
  actor?: Actor | null;
  session?: Session | null;
  principal?: Principal | null;
  delegation?: DelegationContext | null;
}) {
  const actorRegistry     = { get: vi.fn().mockResolvedValue(overrides.actor ?? ACTOR) };
  const sessionStore      = { get: vi.fn().mockResolvedValue(overrides.session ?? SESSION), create: vi.fn(), invalidate: vi.fn() };
  const principalRegistry = { get: vi.fn().mockResolvedValue(overrides.principal ?? PRINCIPAL), save: vi.fn() };
  const delegationStore   = { getById: vi.fn().mockResolvedValue(overrides.delegation ?? DELEGATION), save: vi.fn(), listForActor: vi.fn() };
  const gate = new IdentityGate(
    actorRegistry as never,
    sessionStore as never,
    principalRegistry as never,
    delegationStore as never
  );
  return { gate, actorRegistry, sessionStore, principalRegistry, delegationStore };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Gate 01 — Identity', () => {
  it('passes on valid identity tuple', async () => {
    const { gate } = makeGate({});
    const ctx = makeContext();
    const result = await gate.evaluate(ACTION, ctx, []);
    expect(result.decision.outcome).toBe('pass');
    expect(ctx.actor).toEqual(ACTOR);
    expect(ctx.principal).toEqual(PRINCIPAL);
    expect(ctx.delegationContext).toEqual(DELEGATION);
  });

  it('denies ACTOR_NOT_REGISTERED when actor not found', async () => {
    const { gate } = makeGate({ actor: null });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.ACTOR_NOT_REGISTERED);
  });

  it('denies SESSION_NOT_FOUND when session not found', async () => {
    const { gate } = makeGate({ session: null });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SESSION_NOT_FOUND);
  });

  it('denies SESSION_EXPIRED when session is past expiresAt (SOLVE-011)', async () => {
    const { gate } = makeGate({ session: { ...SESSION, expiresAt: PAST } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SESSION_EXPIRED);
  });

  it('denies PRINCIPAL_NOT_RESOLVABLE when principal not found', async () => {
    const { gate } = makeGate({ principal: null });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE);
  });

  it('denies ACTOR_PRINCIPAL_MISMATCH when actor.principalId != principal.principalId', async () => {
    const { gate } = makeGate({ principal: { ...PRINCIPAL, principalId: 'different-principal' } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH);
  });

  it('denies NON_HUMAN_ACTOR_INCOMPLETE when non-human actor missing registry fields', async () => {
    const nonHuman: Actor = { ...ACTOR, actorClass: ACTOR_CLASS.AUTONOMOUS_AGENT, owner: null, purpose: null, reviewCadence: null };
    const { gate } = makeGate({ actor: nonHuman });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.NON_HUMAN_ACTOR_INCOMPLETE);
  });

  it('passes for non-human actor when owner/purpose/reviewCadence are present', async () => {
    const nonHuman: Actor = { ...ACTOR, actorClass: ACTOR_CLASS.AUTONOMOUS_AGENT, owner: 'owner', purpose: 'testing', reviewCadence: 'monthly' };
    const { gate } = makeGate({ actor: nonHuman });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('pass');
  });

  it('denies CHAIN_INTEGRITY_BROKEN when delegation not found (HOLE-002)', async () => {
    const { gate } = makeGate({ delegation: null });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_INTEGRITY_BROKEN);
  });

  it('gate is gate_01_identity with gateOrder 1', () => {
    const { gate } = makeGate({});
    expect(gate.gateId).toBe('gate_01_identity');
    expect(gate.gateOrder).toBe(1);
    expect(gate.plane).toBe('control');
  });
});
