// packages/orch-ref/src/condition-evaluator.test.ts
//
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 5.5 + §9.5 parity
// table. Migrates ORCH-13 (Dispatch branching — `determineNodeType`) +
// ORCH-14 (Condition evaluation — `evaluateCondition` type-coercion law)
// out of the soon-to-be-deleted `ref-deterministic-planner.test.ts`
// into the home that matches the §9.5 spec parity row ("moves with
// extraction"). No behavior change vs. the originating tests.
//
// Log: INFRA-PLANNER-PARITY-BRIDGE-001.
//
// AMEND-spec-nexus-orch §11 — ORCH-13, ORCH-14.

import { describe, it, expect } from 'vitest';
import type { NonEmpty, PlanCondition, Uuid } from '@nexus/contracts';
import { evaluateCondition, determineNodeType } from './condition-evaluator.js';

const ORCH_ACTOR_ID = '00000000-0000-4000-a000-000000000001' as Uuid;

// ─── ORCH-13: Dispatch branching — `determineNodeType` semantics ───

describe('ORCH-13: Dispatch branching', () => {
  it('nvg_dispatch: requiresNvg=true, requiresNxs=false', () => {
    const result = determineNodeType(true, false, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('nvg_dispatch');
  });

  it('nxs_dispatch: requiresNvg=false, requiresNxs=true', () => {
    const result = determineNodeType(false, true, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('nxs_dispatch');
  });

  it('local_control: both false, agentId = orchestratorActorId', () => {
    const result = determineNodeType(false, false, ORCH_ACTOR_ID, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('local_control');
  });

  it('secure_agent_handoff: both false, isSecureHandoff=true', () => {
    const result = determineNodeType(false, false, 'agent-x' as Uuid, ORCH_ACTOR_ID, true);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.nodeType).toBe('secure_agent_handoff');
  });

  it('both-true rejected', () => {
    const result = determineNodeType(true, true, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(false);
  });

  it('local_control rejects when agentId != orchestratorActorId', () => {
    const result = determineNodeType(false, false, 'agent-x' as Uuid, ORCH_ACTOR_ID, false);
    expect(result.valid).toBe(false);
  });
});

// ─── ORCH-14: Condition evaluation — type coercion law ───

describe('ORCH-14: Condition evaluation', () => {
  const cond = (op: string, value: string | number | boolean | null): PlanCondition => ({
    conditionId: 'cond-001' as Uuid,
    sourceField: 'field' as NonEmpty,
    operator: op as PlanCondition['operator'],
    value,
  });

  it('equals: strict equality', () => {
    expect(evaluateCondition(cond('equals', 'hello'), { field: 'hello' }).result).toBe(true);
    expect(evaluateCondition(cond('equals', 'hello'), { field: 'world' }).result).toBe(false);
    expect(evaluateCondition(cond('equals', 42), { field: 42 }).result).toBe(true);
    expect(evaluateCondition(cond('equals', 42), { field: '42' }).result).toBe(false); // strict
  });

  it('not_equals: strict inequality', () => {
    expect(evaluateCondition(cond('not_equals', 'hello'), { field: 'world' }).result).toBe(true);
    expect(evaluateCondition(cond('not_equals', 'hello'), { field: 'hello' }).result).toBe(false);
  });

  it('exists: value !== undefined && value !== null', () => {
    expect(evaluateCondition(cond('exists', null), { field: 'present' }).result).toBe(true);
    expect(evaluateCondition(cond('exists', null), { field: null }).result).toBe(false);
    expect(evaluateCondition(cond('exists', null), {}).result).toBe(false);
  });

  it('not_exists: value === undefined || value === null', () => {
    expect(evaluateCondition(cond('not_exists', null), {}).result).toBe(true);
    expect(evaluateCondition(cond('not_exists', null), { field: null }).result).toBe(true);
    expect(evaluateCondition(cond('not_exists', null), { field: 'val' }).result).toBe(false);
  });

  it('gt: number-only, type_mismatch on non-number', () => {
    expect(evaluateCondition(cond('gt', 10), { field: 20 }).result).toBe(true);
    expect(evaluateCondition(cond('gt', 10), { field: 5 }).result).toBe(false);
    const mismatch = evaluateCondition(cond('gt', 10), { field: 'string' });
    expect(mismatch.result).toBe(false);
    expect(mismatch.reason).toBe('type_mismatch');
  });

  it('lt: number-only, type_mismatch on non-number', () => {
    expect(evaluateCondition(cond('lt', 10), { field: 5 }).result).toBe(true);
    expect(evaluateCondition(cond('lt', 10), { field: 20 }).result).toBe(false);
    const mismatch = evaluateCondition(cond('lt', 10), { field: true });
    expect(mismatch.result).toBe(false);
    expect(mismatch.reason).toBe('type_mismatch');
  });

  it('gt/lt: NaN and Infinity are type_mismatch', () => {
    expect(evaluateCondition(cond('gt', 10), { field: NaN }).reason).toBe('type_mismatch');
    expect(evaluateCondition(cond('gt', 10), { field: Infinity }).reason).toBe('type_mismatch');
    expect(evaluateCondition(cond('lt', NaN), { field: 5 }).reason).toBe('type_mismatch');
  });

  it('unknown operator returns type_mismatch', () => {
    const c: PlanCondition = {
      conditionId: 'cond-001' as Uuid,
      sourceField: 'field' as NonEmpty,
      operator: 'not_a_real_op' as PlanCondition['operator'],
      value: 'x',
    };
    expect(evaluateCondition(c, { field: 'x' }).reason).toBe('type_mismatch');
  });
});
