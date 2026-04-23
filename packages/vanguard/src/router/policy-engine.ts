/**
 * NVG Routing Policy Engine — spec §24.4, §25.1, §25.2, blueprint §14.4
 *
 * Complete policy lifecycle:
 *   1. Load — read signed YAML, verify Ed25519 signature
 *   2. Validate — reject sensitive→frontier rules at load time (§25.2)
 *   3. Evaluate — first matching rule governs, default-deny posture (§24.4)
 *
 * CONTRA-S29-001: Versioned, signed YAML with signature validation.
 * Crypto injected via DI — Layer 3 stays Layer 2-only.
 * Layer 3 — imports from @nexus/contracts only.
 */
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import {
  isSensitiveDataClass,
  type Base64Url,
  type NvgOutboundRequest,
  type NvgClassificationResult,
  type NvgRoutingPolicy,
  type NvgRoutingRule,
  type NvgRoutingDecision,
} from '@nexus/contracts';
import { isFrontierTier } from '../classifier/ceiling-enforcer.js';

// ── Policy loader ───────────────────────────────────────────────────────────

export interface PolicyLoaderCrypto {
  verify: (data: string, signature: string, publicKey: string) => Promise<boolean>;
  canonicalize: (obj: unknown) => string;
}

/** §25.1 — Load, verify signature, validate classification constraints. */
export async function loadNvgRoutingPolicy(
  filepath: string,
  publicKey: Base64Url,
  crypto: PolicyLoaderCrypto
): Promise<NvgRoutingPolicy> {
  let raw: string;
  try {
    raw = readFileSync(filepath, 'utf-8');
  } catch {
    throw new Error(`NVG_POLICY_NOT_FOUND: ${filepath}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `NVG_POLICY_INVALID_YAML: ${filepath} — ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`NVG_POLICY_INVALID_YAML: ${filepath} — not a YAML object`);
  }

  const policy = parsed as unknown as NvgRoutingPolicy;

  const signature = policy.signature;
  if (!signature || typeof signature !== 'string' || signature.length === 0) {
    throw new Error(`NVG_POLICY_UNSIGNED: ${filepath} — signature missing or empty`);
  }

  const { signature: _sig, ...body } = policy;
  const valid = await crypto.verify(crypto.canonicalize(body), signature, publicKey);
  if (!valid) {
    throw new Error(`NVG_POLICY_SIG_INVALID: ${filepath} — Ed25519 signature verification failed`);
  }

  validateRoutingPolicy(policy);

  return policy;
}

// ── Policy validation (§25.2) ───────────────────────────────────────────────

/** §25.2 — Reject policies that route sensitive data to frontier tiers at load time. */
export function validateRoutingPolicy(policy: NvgRoutingPolicy): void {
  for (const rule of policy.rules) {
    const hasSensitive = rule.conditions.dataClasses?.some(isSensitiveDataClass);
    if (hasSensitive && isFrontierTier(rule.routeTo)) {
      throw new Error(
        `ROUTING_POLICY_VIOLATION: rule ${rule.ruleId} routes sensitive data to frontier tier ${rule.routeTo}`
      );
    }
    if (hasSensitive && rule.fallbackTier && isFrontierTier(rule.fallbackTier)) {
      throw new Error(
        `ROUTING_POLICY_VIOLATION: rule ${rule.ruleId} fallback routes sensitive data to frontier tier ${rule.fallbackTier}`
      );
    }
  }
}

// ── Policy evaluation (§24.4) ───────────────────────────────────────────────

/** §24.4 — Match a single rule's conditions against request + classification. */
export function matchesRoutingCondition(
  cond: NvgRoutingRule['conditions'],
  request: NvgOutboundRequest,
  classification: NvgClassificationResult
): boolean {
  if (cond.dataClasses && !cond.dataClasses.includes(classification.effectiveDataClass))
    return false;
  if (cond.octLevels && !cond.octLevels.includes(request.octLevel)) return false;
  if (cond.taskTypes && !cond.taskTypes.includes(request.taskIntent)) return false;
  if (cond.costCeiling !== undefined && request.costPreference === 'high') return false;
  return true;
}

/** §24.4 — First matching rule governs. No match → deny (default-deny posture). */
export function evaluateRoutingPolicy(
  policy: NvgRoutingPolicy,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult
): NvgRoutingDecision {
  for (const rule of [...policy.rules].sort((a, b) => a.priority - b.priority)) {
    if (matchesRoutingCondition(rule.conditions, request, classification)) {
      return {
        matched: true,
        ruleId: rule.ruleId,
        routeTo: rule.routeTo,
        fallbackTier: rule.fallbackTier ?? null,
      };
    }
  }
  // Default deny — no matching rule
  return { matched: false, ruleId: null, routeTo: null, fallbackTier: null };
}
