/**
 * Tier-aware default timeout — Phase 8 (Q3 owner ruling 2026-05-26).
 *
 * On-prem models (Ollama, local inference) routinely take much longer
 * than frontier providers — 30s is an aggressive ceiling for an on-prem
 * inference of any complexity. Adopt a tier-aware default so admins
 * don't have to set per-endpoint timeoutMs on every on-prem entry.
 *
 * Explicit per-endpoint `timeoutMs` always wins; this helper is the
 * fallback when the field is absent. The three adapters
 * (ollama/openai/anthropic) call this when `endpoint.timeoutMs` is
 * undefined.
 *
 * Tier defaults:
 *   on_prem_* → 120_000 ms (local inference + on-prem hardware variance)
 *   frontier_* → 30_000 ms (vendor SLA; if a frontier call legitimately
 *                            needs >30s, admins set timeoutMs per-endpoint)
 *   fallback   → 60_000 ms (middle ground)
 *
 * The tier string is the manifest's open governed type (NonEmpty).
 * Unknown tier strings fall through to the historic 30_000 ms default
 * — adds a new tier without breaking the timeout behavior of older
 * deployments until the table is updated.
 */
import { MODEL_TIER, type ModelTier } from '@nexus/contracts';

const HISTORIC_DEFAULT_MS = 30_000;

const TIER_DEFAULT_TIMEOUT_MS: Readonly<Record<string, number>> = {
  [MODEL_TIER.ON_PREM_GENERAL]: 120_000,
  [MODEL_TIER.ON_PREM_SENSITIVE]: 120_000,
  [MODEL_TIER.FRONTIER_GENERAL]: 30_000,
  [MODEL_TIER.FRONTIER_REASONING]: 30_000,
  [MODEL_TIER.FRONTIER_LIVE]: 30_000,
  [MODEL_TIER.FALLBACK]: 60_000,
};

export function getDefaultTimeoutMsForTier(tier: ModelTier | string): number {
  const t = TIER_DEFAULT_TIMEOUT_MS[tier];
  return t ?? HISTORIC_DEFAULT_MS;
}
