/**
 * Risk classifier — spec §13.9.2 computeRiskTier
 */
import {
  DATA_CLASS,
  ENVIRONMENT_ID,
  RISK_TIER,
  RISK_TIER_ORDER,
  type DataClass,
  type EnvironmentId,
  type RiskTier,
} from '../types/index.js';
import type { CapabilityRegistry } from './capability-registry.js';

function elevateRiskTier(current: RiskTier, minimum: RiskTier): RiskTier {
  return RISK_TIER_ORDER.indexOf(current) >= RISK_TIER_ORDER.indexOf(minimum) ? current : minimum;
}

export class RiskClassifier {
  constructor(private readonly capabilityRegistry: CapabilityRegistry) {}

  compute(
    capabilityId: string,
    dataClasses: DataClass[],
    environment: EnvironmentId,
    externalFacing: boolean
  ): RiskTier {
    const capEntry = this.capabilityRegistry.get(capabilityId);
    let tier = capEntry.defaultRiskTier;

    const hasSensitive = dataClasses.some(
      dc => dc === DATA_CLASS.PII || dc === DATA_CLASS.PHI || dc === DATA_CLASS.FINANCIAL
    );
    if (hasSensitive) tier = elevateRiskTier(tier, RISK_TIER.MEDIUM);
    if (environment === ENVIRONMENT_ID.PRODUCTION) tier = elevateRiskTier(tier, RISK_TIER.MEDIUM);
    if (externalFacing) tier = elevateRiskTier(tier, RISK_TIER.HIGH);

    return tier;
  }
}
