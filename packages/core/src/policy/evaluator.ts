/**
 * Policy evaluator — spec §13.5 + §13.9.17 matchesCondition
 *
 * F4.2 §2.2 — `octLevel` is mandatory on the envelope; F4.2 §2.3 — the
 * matcher applies the `cond.octLevels` check unconditionally because the
 * contract field is required. A missing/empty `octLevels` rejects every
 * actor by definition (default-secure).
 */
import type {
  PolicyCondition,
  ActorClass,
  ActionVerb,
  RiskTier,
  DataClass,
  EnvironmentId,
  OctLevel,
} from '../types/index.js';

export interface PolicyEvalEnvelope {
  actorClass: ActorClass;
  capability: string;
  verb: ActionVerb;
  riskTier: RiskTier;
  dataClasses: DataClass[];
  environment: EnvironmentId;
  externalFacing: boolean;
  chainDepth: number;
  /** Resolved target system (connector systemType). Threaded so
   *  PolicyCondition.targetSystems can scope rules per-connector. */
  targetSystem: string;
  /**
   * F4.2 §2.2 — actor's OCT classification. Required. Gate 04 sources
   * this from `context.actor.octLevel` (set at registration, verified by
   * Hard Law #14 callbacks at Gate 01 / Gate 02). If absent at Gate 04,
   * Gate 04 fails closed with denial code POLICY_ENVELOPE_MISSING_OCT
   * BEFORE building this envelope; the envelope itself never carries
   * null/undefined for this field.
   */
  octLevel: OctLevel;
}

export function matchesCondition(cond: PolicyCondition, env: PolicyEvalEnvelope): boolean {
  if (cond.actorClasses && !cond.actorClasses.includes(env.actorClass)) return false;
  if (cond.capabilities && !cond.capabilities.includes(env.capability)) return false;
  if (cond.actionVerbs && !cond.actionVerbs.includes(env.verb)) return false;
  if (cond.riskTiers && !cond.riskTiers.includes(env.riskTier)) return false;
  if (cond.dataClasses && !cond.dataClasses.some(dc => env.dataClasses.includes(dc))) return false;
  if (cond.environments && !cond.environments.includes(env.environment)) return false;
  if (cond.externalFacing !== undefined && cond.externalFacing !== env.externalFacing) return false;
  if (cond.maxChainDepth !== undefined && env.chainDepth > cond.maxChainDepth) return false;
  if (cond.targetSystems && !cond.targetSystems.includes(env.targetSystem)) return false;
  // F4.2 §2.3 — unconditional OCT check. Empty `octLevels` means no
  // actor matches (default-secure); to apply the rule to every level
  // the author lists them explicitly.
  if (!cond.octLevels.includes(env.octLevel)) return false;
  return true;
}
