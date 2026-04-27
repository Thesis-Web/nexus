/**
 * Redactor — spec §18
 * Applied at Gate 07 before write. rawPayload never stored.
 */
import { DATA_CLASS, type DataClass, type ExecutionResult } from '../types/index.js';

export const REDACTION_MARKERS = {
  PII: '[REDACTED:PII]',
  PHI: '[REDACTED:PHI]',
  FINANCIAL: '[REDACTED:FINANCIAL]',
  SECRET: '[REDACTED:SECRET]',
  PROMPT: '[REDACTED:RAW_PROMPT]',
  REASONING: '[REDACTED:REASONING]',
  OVERFLOW: '[TRUNCATED:OVERFLOW]',
} as const;

const SECRET_PATTERN = /(secret|password|key|token|credential)[=:\s][^\s,;]*/gi;

export function redactExecutionResult(
  result: ExecutionResult,
  dataClasses: DataClass[]
): ExecutionResult {
  let summary = result.redactedSummary;
  if (dataClasses.includes(DATA_CLASS.PHI)) summary = REDACTION_MARKERS.PHI;
  else if (dataClasses.includes(DATA_CLASS.PII)) summary = REDACTION_MARKERS.PII;
  else if (dataClasses.includes(DATA_CLASS.FINANCIAL)) summary = REDACTION_MARKERS.FINANCIAL;

  // REDACT-002 FIX: §18 requires secret-pattern fields replaced on full evidence surface
  if (summary) {
    summary = summary.replace(SECRET_PATTERN, '[REDACTED:SECRET]');
  }

  const errorMessage = result.errorMessage
    ? result.errorMessage.replace(SECRET_PATTERN, '[REDACTED:SECRET]')
    : null;

  return { ...result, redactedSummary: summary, errorMessage };
}
