/**
 * Gate 01 — Identity — unit tests
 * Spec: nexus-engineering-spec-v1-8-26.md §13.2
 * SOLVE-011: session store returns regardless of expiry; Gate 01 owns expiry semantics.
 * HOLE-002: Gate 01 resolves delegationContext as the fourth item of the identity tuple.
 * IDENTITY-001 HARDENED: identityProvider is REQUIRED. Null claims → DENY.
 */

import { describe, it, expect, vi } from 'vitest';
import { IdentityGate } from '../gates/01-identity.gate.js';
import {
  DENIAL_CODE,
  ACTOR_CLASS,
  type Actor,
  type Session,
  type Principal,
  type DelegationContext,
  type AgentAction,
  type PipelineContext,
  type IdentityClaims,
} from '../types/index.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 300_000).toISOString();
const PAST = new Date(Date.now() - 300_000).toISOString();

const ACTOR: Actor = {
  actorId: 'actor-001',
  actorClass: ACTOR_CLASS.HUMAN,
  principalId: 'principal-001',
  displayName: 'Test User',
  environment: 'dev',
  riskCeiling: 'high',
  octLevel: 'OCT-CONFIDENTIAL' as any,
  allowedSystems: ['stub'],
  registeredAt: NOW,
  owner: null,
  purpose: null,
  reviewCadence: null,
};
const PRINCIPAL: Principal = {
  principalId: 'principal-001',
  displayName: 'Test Principal',
  email: 'test@example.com',
  registeredAt: NOW,
  maxDelegableRiskTier: 'high',
  allowedSystems: ['stub'],
};
const SESSION: Session = {
  sessionId: 'session-001',
  actorId: 'actor-001',
  principalId: 'principal-001',
  delegationId: 'delegation-001',
  createdAt: NOW,
  expiresAt: FUTURE,
};
const DELEGATION: DelegationContext = {
  delegationId: 'delegation-001',
  principalId: 'principal-001',
  actorId: 'actor-001',
  parentDelegationId: null,
  chainDepth: 0,
  maxChainDepth: 3,
  allowedSystems: ['stub'],
  allowedCapabilities: ['read:record:single'],
  forbiddenCapabilities: [],
  maxRiskTier: 'high',
  allowDownstreamPropagation: false,
  environment: 'dev',
  mintedAt: NOW,
  expiresAt: FUTURE,
  mintedBy: 'nexus-delegation-engine/v0.1.0',
  signature: 'test-sig',
};
const IDENTITY_CLAIMS: IdentityClaims = {
  principalIdentity: 'principal-001',
  roleAssignments: [],
  capabilityCeilings: [
    {
      allowedSystems: ['stub'],
      allowedCapabilities: ['*'],
      maxRiskTier: 'high',
    },
  ],
  environmentContext: 'dev',
  actorClass: ACTOR_CLASS.HUMAN,
};
const ACTION: AgentAction = {
  actionId: 'action-001',
  receivedAt: NOW,
  protocol: 'mcp/1.0',
  adapterVersion: 'v0.1.0',
  actorId: 'actor-001',
  principalId: 'principal-001',
  sessionId: 'session-001',
  delegationId: 'delegation-001',
  delegationSequence: 1,
  tool: 'get_record',
  rawVerb: 'read',
  rawTarget: '{}',
  rawPayload: {},
  intent: {
    objectiveSummary: 'read a record',
    triggeringSource: 'unknown',
    toolchainContext: 'test',
    modelId: null,
    modelConfidence: null,
    riskNote: null,
    extractedAt: NOW,
  },
  resolvedVerb: null,
  resolvedCapability: null,
  resolvedTarget: null,
  resolvedDataClasses: [],
  resolvedRiskTier: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(): PipelineContext {
  return {
    sessionId: 'session-001',
    delegationStore: { getById: vi.fn(), save: vi.fn(), listForActor: vi.fn() },
    policyFile: null,
    approverRegistry: {} as never,
    connectorRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    channelRegistry: { get: vi.fn(), register: vi.fn(), list: vi.fn() },
    threatLog: [],
    startedAt: NOW,
  } as unknown as PipelineContext;
}

interface GateOverrides {
  actor?: Actor | null;
  session?: Session | null;
  principal?: Principal | null;
  delegation?: DelegationContext | null;
  identityClaims?: IdentityClaims | null; // null = provider returns null → DENY
}

function makeGate(overrides: GateOverrides) {
  // Use Object.hasOwn so that passing null explicitly returns null from the mock,
  // not the default value. (null ?? DEFAULT returns DEFAULT — Object.hasOwn avoids this.)
  const actorVal = Object.hasOwn(overrides, 'actor') ? overrides.actor : ACTOR;
  const sessionVal = Object.hasOwn(overrides, 'session') ? overrides.session : SESSION;
  const principalVal = Object.hasOwn(overrides, 'principal') ? overrides.principal : PRINCIPAL;
  const delegationVal = Object.hasOwn(overrides, 'delegation') ? overrides.delegation : DELEGATION;
  const claimsVal = Object.hasOwn(overrides, 'identityClaims')
    ? overrides.identityClaims
    : IDENTITY_CLAIMS;

  const actorRegistry = { get: vi.fn().mockResolvedValue(actorVal) };
  const sessionStore = {
    get: vi.fn().mockResolvedValue(sessionVal),
    create: vi.fn(),
    invalidate: vi.fn(),
  };
  const principalRegistry = { get: vi.fn().mockResolvedValue(principalVal), save: vi.fn() };
  const delegationStore = {
    getById: vi.fn().mockResolvedValue(delegationVal),
    save: vi.fn(),
    listForActor: vi.fn(),
  };
  const identityProvider = {
    providerType: 'reference_adapter' as const,
    providerVersion: 'v1.0.0',
    resolveIdentity: vi.fn().mockResolvedValue(claimsVal),
    authenticate: vi.fn(),
  };

  return {
    gate: new IdentityGate(
      actorRegistry as never,
      sessionStore as never,
      principalRegistry as never,
      delegationStore as never,
      identityProvider as never
    ),
    identityProvider,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Gate 01 — Identity', () => {
  it('passes on valid identity tuple and populates context', async () => {
    const { gate } = makeGate({});
    const ctx = makeContext();
    const result = await gate.evaluate(ACTION, ctx, []);
    expect(result.decision.outcome).toBe('pass');
    expect(ctx.actor).toEqual(ACTOR);
    expect(ctx.principal).toEqual(PRINCIPAL);
    expect(ctx.delegationContext).toEqual(DELEGATION);
    expect(ctx.identityClaims).toEqual(IDENTITY_CLAIMS);
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

  it('denies NON_HUMAN_ACTOR_INCOMPLETE when non-human actor missing owner/purpose/reviewCadence', async () => {
    const nonHuman: Actor = {
      ...ACTOR,
      actorClass: ACTOR_CLASS.AUTONOMOUS_AGENT,
      owner: null,
      purpose: null,
      reviewCadence: null,
    };
    const { gate } = makeGate({ actor: nonHuman });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.NON_HUMAN_ACTOR_INCOMPLETE);
  });

  it('passes for non-human actor when owner/purpose/reviewCadence are present', async () => {
    const nonHuman: Actor = {
      ...ACTOR,
      actorClass: ACTOR_CLASS.AUTONOMOUS_AGENT,
      owner: 'owner-team',
      purpose: 'testing',
      reviewCadence: 'monthly',
    };
    const { gate } = makeGate({ actor: nonHuman });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('pass');
  });

  it('denies CHAIN_INTEGRITY_BROKEN when delegation not found in store (HOLE-002)', async () => {
    const { gate } = makeGate({ delegation: null });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.CHAIN_INTEGRITY_BROKEN);
  });

  // ─── IDENTITY-001 HARDENED: provider-required, null-claims → DENY ─────────

  it('denies IDENTITY_CLAIMS_UNRESOLVABLE when identity provider returns null', async () => {
    const { gate } = makeGate({ identityClaims: null });
    const ctx = makeContext();
    const result = await gate.evaluate(ACTION, ctx, []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.IDENTITY_CLAIMS_UNRESOLVABLE);
    expect(result.decision.reason).toContain('identity provider could not resolve claims');
  });

  // ─── Tuple binding tests (DEF-GATE01-001) ──────────────────────────────────

  it('denies SESSION_ACTOR_MISMATCH when session.actorId != action.actorId', async () => {
    const { gate } = makeGate({ session: { ...SESSION, actorId: 'other-actor' } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SESSION_ACTOR_MISMATCH);
  });

  it('denies SESSION_PRINCIPAL_MISMATCH when session.principalId != action.principalId', async () => {
    const { gate } = makeGate({ session: { ...SESSION, principalId: 'other-principal' } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SESSION_PRINCIPAL_MISMATCH);
  });

  it('denies SESSION_DELEGATION_MISMATCH when session.delegationId != action.delegationId', async () => {
    const { gate } = makeGate({ session: { ...SESSION, delegationId: 'other-delegation' } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.SESSION_DELEGATION_MISMATCH);
  });

  it('denies DELEGATION_ACTOR_MISMATCH when delegation.actorId != action.actorId', async () => {
    const { gate } = makeGate({ delegation: { ...DELEGATION, actorId: 'other-actor' } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_ACTOR_MISMATCH);
  });

  it('denies DELEGATION_PRINCIPAL_MISMATCH when delegation.principalId != action.principalId', async () => {
    const { gate } = makeGate({ delegation: { ...DELEGATION, principalId: 'other-principal' } });
    const result = await gate.evaluate(ACTION, makeContext(), []);
    expect(result.decision.outcome).toBe('deny');
    expect(result.decision.denialCode).toBe(DENIAL_CODE.DELEGATION_PRINCIPAL_MISMATCH);
  });

  it('has gateId gate_01_identity, gateOrder 1, plane control', () => {
    const { gate } = makeGate({});
    expect(gate.gateId).toBe('gate_01_identity');
    expect(gate.gateOrder).toBe(1);
    expect(gate.plane).toBe('control');
  });
});
