/**
 * Ingress Schema Validator — SECURITY-INGRESS-001
 *
 * Structural validation of incoming action at pipeline ingress.
 * Spec §8.1: "Security Layer: checkIngress → replay check, rate limit, schema validation"
 *
 * This is a structural check — required fields present, correct types.
 * No Zod in core (Layer 1). Enterprise deployments may add deeper validation
 * at the adapter boundary.
 *
 * Returns null if valid, or a string describing the first violation found.
 *
 * Layer 1 — no external dependencies.
 */
import type { AgentAction } from '../types/index.js';

type RawAction = Omit<AgentAction, 'delegationSequence'>;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Validate the structural shape of an incoming action before it enters the gate pipeline.
 * Returns null if valid, or a human-readable violation string if invalid.
 */
export function validateActionSchema(action: RawAction): string | null {
  // Required string fields — must be non-empty strings
  const requiredStrings: Array<[keyof RawAction, string]> = [
    ['actionId', 'actionId'],
    ['runId', 'runId'],
    ['receivedAt', 'receivedAt'],
    ['protocol', 'protocol'],
    ['adapterVersion', 'adapterVersion'],
    ['actorId', 'actorId'],
    ['principalId', 'principalId'],
    ['sessionId', 'sessionId'],
    ['delegationId', 'delegationId'],
    ['tool', 'tool'],
    ['rawVerb', 'rawVerb'],
    ['rawTarget', 'rawTarget'],
  ];

  for (const [key, label] of requiredStrings) {
    if (!isNonEmptyString(action[key])) {
      return `missing or empty required field: ${label}`;
    }
  }

  // rawPayload must be present (can be any type including null)
  if (!('rawPayload' in action)) {
    return 'missing required field: rawPayload';
  }

  // intent must be an object with required sub-fields
  if (action.intent == null || typeof action.intent !== 'object') {
    return 'missing or invalid required field: intent';
  }
  const intent = action.intent;
  if (!isNonEmptyString(intent.objectiveSummary)) {
    return 'missing or empty required field: intent.objectiveSummary';
  }
  if (!isNonEmptyString(intent.triggeringSource)) {
    return 'missing or empty required field: intent.triggeringSource';
  }
  if (!isNonEmptyString(intent.toolchainContext)) {
    return 'missing or empty required field: intent.toolchainContext';
  }
  if (!isNonEmptyString(intent.extractedAt)) {
    return 'missing or empty required field: intent.extractedAt';
  }

  // resolvedDataClasses must be an array (empty is fine — pre-classification)
  if (!Array.isArray(action.resolvedDataClasses)) {
    return 'missing or invalid required field: resolvedDataClasses (must be array)';
  }

  return null;
}
