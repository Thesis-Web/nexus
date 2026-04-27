/**
 * Ingress Schema Validator — unit tests
 * SECURITY-INGRESS-001: structural schema validation at pipeline ingress
 * Spec §8.1: "checkIngress → replay check, rate limit, schema validation"
 */

import { describe, it, expect } from 'vitest';
import { validateActionSchema } from '../security/ingress-validator.js';
import type { AgentAction } from '../types/index.js';

type RawAction = Omit<AgentAction, 'delegationSequence'>;

const NOW = new Date().toISOString();

function validAction(): RawAction {
  return {
    actionId: 'action-001',
    runId: 'run-001',
    receivedAt: NOW,
    protocol: 'mcp/1.0',
    adapterVersion: 'v0.1.0',
    actorId: 'actor-001',
    principalId: 'principal-001',
    sessionId: 'session-001',
    delegationId: 'delegation-001',
    tool: 'get_record',
    rawVerb: 'read',
    rawTarget: '{}',
    rawPayload: {},
    intent: {
      objectiveSummary: 'read a record',
      triggeringSource: 'user_request',
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
}

describe('Ingress Schema Validator — SECURITY-INGRESS-001', () => {
  it('accepts a valid action with null result', () => {
    expect(validateActionSchema(validAction())).toBeNull();
  });

  it('rejects missing actionId', () => {
    const a = validAction();
    (a as Record<string, unknown>).actionId = '';
    const result = validateActionSchema(a);
    expect(result).toContain('actionId');
  });

  it('rejects missing runId', () => {
    const a = validAction();
    (a as Record<string, unknown>).runId = '';
    const result = validateActionSchema(a);
    expect(result).toContain('runId');
  });

  it('rejects missing actorId', () => {
    const a = validAction();
    (a as Record<string, unknown>).actorId = '';
    const result = validateActionSchema(a);
    expect(result).toContain('actorId');
  });

  it('rejects missing sessionId', () => {
    const a = validAction();
    (a as Record<string, unknown>).sessionId = '';
    const result = validateActionSchema(a);
    expect(result).toContain('sessionId');
  });

  it('rejects missing delegationId', () => {
    const a = validAction();
    (a as Record<string, unknown>).delegationId = '';
    const result = validateActionSchema(a);
    expect(result).toContain('delegationId');
  });

  it('rejects missing rawVerb', () => {
    const a = validAction();
    (a as Record<string, unknown>).rawVerb = '';
    const result = validateActionSchema(a);
    expect(result).toContain('rawVerb');
  });

  it('rejects missing tool', () => {
    const a = validAction();
    (a as Record<string, unknown>).tool = '';
    const result = validateActionSchema(a);
    expect(result).toContain('tool');
  });

  it('rejects null intent', () => {
    const a = validAction();
    (a as Record<string, unknown>).intent = null;
    const result = validateActionSchema(a);
    expect(result).toContain('intent');
  });

  it('rejects intent with empty objectiveSummary', () => {
    const a = validAction();
    a.intent = { ...a.intent, objectiveSummary: '' };
    const result = validateActionSchema(a);
    expect(result).toContain('objectiveSummary');
  });

  it('rejects intent with empty triggeringSource', () => {
    const a = validAction();
    a.intent = { ...a.intent, triggeringSource: '' };
    const result = validateActionSchema(a);
    expect(result).toContain('triggeringSource');
  });

  it('rejects intent with empty extractedAt', () => {
    const a = validAction();
    a.intent = { ...a.intent, extractedAt: '' };
    const result = validateActionSchema(a);
    expect(result).toContain('extractedAt');
  });

  it('rejects non-array resolvedDataClasses', () => {
    const a = validAction();
    (a as Record<string, unknown>).resolvedDataClasses = 'not-an-array';
    const result = validateActionSchema(a);
    expect(result).toContain('resolvedDataClasses');
  });

  it('accepts action with null resolved fields (pre-classification)', () => {
    const a = validAction();
    a.resolvedVerb = null;
    a.resolvedCapability = null;
    a.resolvedTarget = null;
    a.resolvedRiskTier = null;
    expect(validateActionSchema(a)).toBeNull();
  });

  it('accepts action with rawPayload as null', () => {
    const a = validAction();
    a.rawPayload = null;
    expect(validateActionSchema(a)).toBeNull();
  });
});
