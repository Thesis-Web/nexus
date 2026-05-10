/**
 * Policy evaluator — spec §13.5 + §13.9.17 matchesCondition
 */
import type {
  PolicyCondition,
  ActorClass,
  ActionVerb,
  RiskTier,
  DataClass,
  EnvironmentId,
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
  return true;
}
