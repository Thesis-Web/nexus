/**
 * Redactor — REDACT-001 + REDACT-002 proof tests
 * REDACT-001: injection guard (guardString) applied at pipeline ingress — tested via guardString import
 * REDACT-002: secret-pattern replacement on redactedSummary and errorMessage
 */
import { describe, it, expect } from 'vitest';
import { redactExecutionResult, REDACTION_MARKERS } from './redactor.js';
import { DATA_CLASS } from '../types/index.js';
import { guardString } from '../security/injection-guard.js';
import type { ExecutionResult } from '../types/index.js';

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    connectorId: 'stub',
    system: 'stub',
    outcome: 'success',
    redactedSummary: 'operation completed',
    errorType: null,
    errorMessage: null,
    executedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as ExecutionResult;
}

describe('Redactor — REDACT-002 secret-pattern replacement', () => {
  it('replaces secret= pattern in redactedSummary', () => {
    const result = makeResult({ redactedSummary: 'connected with secret=abc123xyz' });
    const redacted = redactExecutionResult(result, [DATA_CLASS.PUBLIC]);
    expect(redacted.redactedSummary).toContain('[REDACTED:SECRET]');
    expect(redacted.redactedSummary).not.toContain('abc123xyz');
  });

  it('replaces password= pattern in errorMessage', () => {
    const result = makeResult({ errorMessage: 'auth failed password=hunter2' });
    const redacted = redactExecutionResult(result, [DATA_CLASS.PUBLIC]);
    expect(redacted.errorMessage).toContain('[REDACTED:SECRET]');
    expect(redacted.errorMessage).not.toContain('hunter2');
  });

  it('replaces token= and key= patterns', () => {
    const result = makeResult({ redactedSummary: 'using token=xyz key=abc123' });
    const redacted = redactExecutionResult(result, [DATA_CLASS.PUBLIC]);
    expect(redacted.redactedSummary).not.toContain('xyz');
    expect(redacted.redactedSummary).not.toContain('abc123');
  });

  it('PHI data class replaces entire summary with PHI marker', () => {
    const result = makeResult({ redactedSummary: 'patient record retrieved' });
    const redacted = redactExecutionResult(result, [DATA_CLASS.PHI]);
    expect(redacted.redactedSummary).toBe(REDACTION_MARKERS.PHI);
  });

  it('PII data class replaces entire summary with PII marker', () => {
    const result = makeResult({ redactedSummary: 'user profile loaded' });
    const redacted = redactExecutionResult(result, [DATA_CLASS.PII]);
    expect(redacted.redactedSummary).toBe(REDACTION_MARKERS.PII);
  });
});

describe('Injection Guard — REDACT-001 guardString proof', () => {
  it('truncates oversized input at pipeline ingress boundary', () => {
    const oversized = 'A'.repeat(600);
    const result = guardString(oversized, 500);
    expect(result.value.length).toBe(500);
    expect(result.truncated).toBe(true);
  });

  it('passes through normal input unchanged', () => {
    const result = guardString('normal intent summary', 500);
    expect(result.value).toBe('normal intent summary');
    expect(result.truncated).toBe(false);
  });
});
