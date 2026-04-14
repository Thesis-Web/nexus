/**
 * Capability registry — spec §10.4 Capability Taxonomy v0.1.0
 * resolveCapability — spec §13.9.1
 */
import {
  CAPABILITY_IDS, ACTION_VERB, DATA_CLASS, RISK_TIER,
  type ActionVerb, type ResourceTarget, type DataClass, type RiskTier,
} from '../types/index.js';

export interface CapabilityEntry {
  capabilityId:    string;
  verb:            ActionVerb;
  defaultRiskTier: RiskTier;
  externalFacing:  boolean;
  resourceScope:   'single' | 'bulk' | 'collection' | 'system';
}

const CAPABILITY_TABLE: CapabilityEntry[] = [
  { capabilityId: CAPABILITY_IDS.READ_RECORD_SINGLE,       verb: ACTION_VERB.READ,    defaultRiskTier: RISK_TIER.LOW,      externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.READ_RECORD_BULK,         verb: ACTION_VERB.READ,    defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'bulk'       },
  { capabilityId: CAPABILITY_IDS.READ_RECORD_PII,          verb: ACTION_VERB.READ,    defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.READ_RECORD_BULK_PII,     verb: ACTION_VERB.READ,    defaultRiskTier: RISK_TIER.HIGH,     externalFacing: false, resourceScope: 'bulk'       },
  { capabilityId: CAPABILITY_IDS.CREATE_RECORD_INTERNAL,   verb: ACTION_VERB.CREATE,  defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.CREATE_RECORD_EXTERNAL,   verb: ACTION_VERB.CREATE,  defaultRiskTier: RISK_TIER.HIGH,     externalFacing: true,  resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.UPDATE_RECORD_INTERNAL,   verb: ACTION_VERB.UPDATE,  defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.UPDATE_RECORD_EXTERNAL,   verb: ACTION_VERB.UPDATE,  defaultRiskTier: RISK_TIER.HIGH,     externalFacing: true,  resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.DELETE_RECORD,            verb: ACTION_VERB.DELETE,  defaultRiskTier: RISK_TIER.HIGH,     externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.DELETE_RECORD_BULK,       verb: ACTION_VERB.DELETE,  defaultRiskTier: RISK_TIER.CRITICAL, externalFacing: false, resourceScope: 'bulk'       },
  { capabilityId: CAPABILITY_IDS.SEND_MESSAGE_INTERNAL,    verb: ACTION_VERB.SEND,    defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.SEND_MESSAGE_EXTERNAL,    verb: ACTION_VERB.SEND,    defaultRiskTier: RISK_TIER.HIGH,     externalFacing: true,  resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.PUBLISH_CONTENT_INTERNAL, verb: ACTION_VERB.PUBLISH, defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.PUBLISH_CONTENT_EXTERNAL, verb: ACTION_VERB.PUBLISH, defaultRiskTier: RISK_TIER.HIGH,     externalFacing: true,  resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.EXPORT_DATA_SINGLE,       verb: ACTION_VERB.EXPORT,  defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.EXPORT_DATA_BULK,         verb: ACTION_VERB.EXPORT,  defaultRiskTier: RISK_TIER.HIGH,     externalFacing: false, resourceScope: 'bulk'       },
  { capabilityId: CAPABILITY_IDS.EXPORT_DATA_BULK_PII,     verb: ACTION_VERB.EXPORT,  defaultRiskTier: RISK_TIER.CRITICAL, externalFacing: false, resourceScope: 'bulk'       },
  { capabilityId: CAPABILITY_IDS.EXECUTE_QUERY,            verb: ACTION_VERB.EXECUTE, defaultRiskTier: RISK_TIER.MEDIUM,   externalFacing: false, resourceScope: 'single'     },
  { capabilityId: CAPABILITY_IDS.EXECUTE_AUTOMATION,       verb: ACTION_VERB.EXECUTE, defaultRiskTier: RISK_TIER.HIGH,     externalFacing: false, resourceScope: 'single'     },
];

const BY_ID = new Map<string, CapabilityEntry>(
  CAPABILITY_TABLE.map(e => [e.capabilityId, e])
);

export class CapabilityRegistry {
  get(capabilityId: string): CapabilityEntry {
    const entry = BY_ID.get(capabilityId);
    if (!entry) throw new Error(`Unknown capabilityId: ${capabilityId}`);
    return entry;
  }

  list(): CapabilityEntry[] {
    return [...CAPABILITY_TABLE];
  }
}

/** spec §13.9.1 — resolveCapability */
export function resolveCapability(
  verb: ActionVerb,
  target: ResourceTarget,
  dataClasses: DataClass[]
): string | null {
  const hasPii = dataClasses.some(dc => dc === DATA_CLASS.PII || dc === DATA_CLASS.PHI);
  const isBulk = target.resourceScope === 'bulk' || target.resourceScope === 'collection';
  const isExt  = target.externalFacing;

  if (verb === ACTION_VERB.READ) {
    if (hasPii && isBulk) return CAPABILITY_IDS.READ_RECORD_BULK_PII;
    if (hasPii)           return CAPABILITY_IDS.READ_RECORD_PII;
    if (isBulk)           return CAPABILITY_IDS.READ_RECORD_BULK;
    return CAPABILITY_IDS.READ_RECORD_SINGLE;
  }
  if (verb === ACTION_VERB.CREATE)  return isExt ? CAPABILITY_IDS.CREATE_RECORD_EXTERNAL  : CAPABILITY_IDS.CREATE_RECORD_INTERNAL;
  if (verb === ACTION_VERB.UPDATE)  return isExt ? CAPABILITY_IDS.UPDATE_RECORD_EXTERNAL  : CAPABILITY_IDS.UPDATE_RECORD_INTERNAL;
  if (verb === ACTION_VERB.DELETE)  return isBulk ? CAPABILITY_IDS.DELETE_RECORD_BULK     : CAPABILITY_IDS.DELETE_RECORD;
  if (verb === ACTION_VERB.SEND)    return isExt ? CAPABILITY_IDS.SEND_MESSAGE_EXTERNAL   : CAPABILITY_IDS.SEND_MESSAGE_INTERNAL;
  if (verb === ACTION_VERB.PUBLISH) return isExt ? CAPABILITY_IDS.PUBLISH_CONTENT_EXTERNAL: CAPABILITY_IDS.PUBLISH_CONTENT_INTERNAL;
  if (verb === ACTION_VERB.EXPORT) {
    if (hasPii && isBulk) return CAPABILITY_IDS.EXPORT_DATA_BULK_PII;
    if (isBulk)           return CAPABILITY_IDS.EXPORT_DATA_BULK;
    return CAPABILITY_IDS.EXPORT_DATA_SINGLE;
  }
  if (verb === ACTION_VERB.EXECUTE) {
    if (target.resourceType === 'automation' || target.resourceType === 'workflow') {
      return CAPABILITY_IDS.EXECUTE_AUTOMATION;
    }
    return CAPABILITY_IDS.EXECUTE_QUERY;
  }
  return null;
}
