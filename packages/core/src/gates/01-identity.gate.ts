/**
 * Gate 01 — Identity — spec §13.2
 * Resolves actor, session, principal. Enforces expiry. Non-human registry completeness.
 * SOLVE-011: SessionStore.get() returns regardless of expiry. Gate 01 owns expiry check.
 */
import {
  GATE_ID, ACTOR_CLASS, DENIAL_CODE,
  type Gate, type GateResult, type AgentAction,
  type PipelineContext, type GateDecision,
} from '../types/index.js';
import type { ActorRegistryStore } from '../types/index.js';
import type { SqliteSessionStore } from '../identity/session-store.js';
import type { PrincipalRegistryStore } from '../types/index.js';

function gateDeny(code: string, reason: string, startMs: number): GateResult {
  return {
    decision: {
      gateId: GATE_ID.G01, gateOrder: 1, plane: 'control',
      outcome: 'deny', reason, denialCode: code,
      policyRuleId: null, evaluatedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs, metadata: {},
    },
  };
}

export class IdentityGate implements Gate {
  readonly gateId    = GATE_ID.G01;
  readonly gateOrder = 1;
  readonly plane     = 'control' as const;

  constructor(
    private readonly actorRegistry:     ActorRegistryStore,
    private readonly sessionStore:      SqliteSessionStore,
    private readonly principalRegistry: PrincipalRegistryStore
  ) {}

  async evaluate(
    action:   AgentAction,
    context:  PipelineContext,
    _prior:   GateDecision[]
  ): Promise<GateResult> {
    const startMs = Date.now();

    const actor = await this.actorRegistry.get(action.actorId);
    if (!actor) return gateDeny(DENIAL_CODE.ACTOR_NOT_REGISTERED, 'actor not registered', startMs);

    // SessionStore.get() returns the record regardless of expiry — Gate 01 owns expiry semantics.
    const session = await this.sessionStore.get(action.sessionId);
    if (!session) return gateDeny(DENIAL_CODE.SESSION_NOT_FOUND, 'session not found', startMs);
    if (new Date(session.expiresAt) <= new Date()) {
      return gateDeny(DENIAL_CODE.SESSION_EXPIRED, 'session expired', startMs);
    }

    const principal = await this.principalRegistry.get(action.principalId);
    if (!principal) return gateDeny(DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE, 'principal not resolvable', startMs);
    if (actor.principalId !== principal.principalId) {
      return gateDeny(DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH, 'actor/principal mismatch', startMs);
    }

    const isNonHuman =
      actor.actorClass !== ACTOR_CLASS.HUMAN &&
      actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;
    if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
      return gateDeny(DENIAL_CODE.NON_HUMAN_ACTOR_INCOMPLETE, 'non-human actor registry incomplete', startMs);
    }

    context.actor     = actor;
    context.principal = principal;

    return {
      decision: {
        gateId: GATE_ID.G01, gateOrder: 1, plane: 'control',
        outcome: 'pass', reason: 'identity verified',
        denialCode: null, policyRuleId: null,
        evaluatedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs, metadata: {},
      },
    };
  }
}
