// packages/contracts/src/constants/index.ts
// Spec: nexus-engineering-spec-v1-7-25.md §12.2 — Governed Constants
// Spec: nexus-engineering-spec-v1-7-25.md §12.4 — Capability Taxonomy v1.0.0
// Layer 2 — governed constant sets. Imports from types only.
//
// ALL governed types are open `string` aliases. Constants define the known set.
// The TypeScript type is `string` — NOT `typeof CONST[keyof typeof CONST]`.
// Treating any governed type as a closed TypeScript union is a build violation
// (MODULAR-002, MODULAR-006, MODULAR-011, MODULAR-015).

import type { SemVer, NonEmpty, Sha256Hex } from '../types/index.js';

// ─── Actor classes — open governed type ───
export const ACTOR_CLASS = {
  HUMAN: 'HUMAN',
  HUMAN_WITH_COPILOT: 'HUMAN_WITH_COPILOT',
  SUPERVISED_AGENT: 'SUPERVISED_AGENT',
  AUTONOMOUS_AGENT: 'AUTONOMOUS_AGENT',
  SCHEDULED_AGENT: 'SCHEDULED_AGENT',
  DELEGATED_SUBAGENT: 'DELEGATED_SUBAGENT',
  SERVICE_AUTOMATION: 'SERVICE_AUTOMATION',
} as const;
export type ActorClass = string;

// ─── Action verbs — open governed type (v1.4.12 production taxonomy) ───
export const ACTION_VERB = {
  READ: 'read',
  WRITE: 'write',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXECUTE: 'execute',
  QUERY: 'query',
  SEARCH: 'search',
  PUBLISH: 'publish',
  EXPORT: 'export',
  SEND: 'send',
  SYNTHESIZE: 'synthesize',
  TRANSMIT: 'transmit',
} as const;
export type ActionVerb = string;

// ─── Risk tiers — open governed type (ordered: low < medium < high < critical) ───
export const RISK_TIER = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const;
export type RiskTier = string;
export const RISK_TIER_ORDER: string[] = ['low', 'medium', 'high', 'critical'];
export function riskTierExceeds(a: RiskTier, ceiling: RiskTier): boolean {
  return RISK_TIER_ORDER.indexOf(a) > RISK_TIER_ORDER.indexOf(ceiling);
}

// ─── Data classes — open governed type ───
export const DATA_CLASS = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  PII: 'pii',
  PHI: 'phi',
  FINANCIAL: 'financial',
} as const;
export type DataClass = string;

// Governed sensitivity test — used by NVG classifier, policy validation, and compile mode.
// Any data class in this set triggers the hard wall: no frontier tier access.
// Single definition — all sensitivity checks MUST use this function.
const SENSITIVE_DATA_CLASSES: DataClass[] = [
  DATA_CLASS.PII,
  DATA_CLASS.PHI,
  DATA_CLASS.FINANCIAL,
  DATA_CLASS.CONFIDENTIAL,
];
export function isSensitiveDataClass(dc: DataClass): boolean {
  return SENSITIVE_DATA_CLASSES.includes(dc);
}

// ─── Environments — open governed type ───
export const ENVIRONMENT_ID = {
  DEV: 'dev',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;
export type EnvironmentId = string;

// ─── Model tiers — open governed type (new in v1.4.12) ───
export const MODEL_TIER = {
  ON_PREM_SENSITIVE: 'on_prem_sensitive',
  ON_PREM_GENERAL: 'on_prem_general',
  FRONTIER_GENERAL: 'frontier_general',
  FRONTIER_REASONING: 'frontier_reasoning',
  FRONTIER_LIVE: 'frontier_live',
  FALLBACK: 'fallback',
} as const;
export type ModelTier = string; // MODULAR-011: never a closed enum

// ─── OCT levels — open governed type (new in v1.4.12) ───
export const OCT_LEVEL = {
  SECURE: 'OCT-SECURE',
  CONFIDENTIAL: 'OCT-CONFIDENTIAL',
  OPEN: 'OCT-OPEN',
  COMPILE: 'OCT-COMPILE',
} as const;
export type OctLevel = string; // MODULAR-015: never a closed enum

// ─── Operating modes — open governed type (new in v1.4.12) ───
export const OPERATING_MODE = {
  OBSERVE: 'observe',
  ADVISORY: 'advisory',
  ENFORCING: 'enforcing',
} as const;
export type OperatingMode = string;

// ─── Outcome labels (policy gate output) — open governed type ───
export const OUTCOME_LABEL = {
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval',
  ESCALATE: 'escalate',
} as const;
export type OutcomeLabel = string;

// ─── Approval decision labels — open governed type ───
export const APPROVAL_DECISION_LABEL = {
  APPROVED: 'approved',
  DENIED: 'denied',
  TIMED_OUT: 'timed_out',
} as const;
export type ApprovalDecisionLabel = string;

// ─── Final outcome labels — open governed type ───
export const FINAL_OUTCOME = {
  EXECUTED: 'executed',
  DENIED_IDENTITY: 'denied_identity',
  DENIED_CLASSIF: 'denied_classification',
  DENIED_DELEGATION: 'denied_delegation',
  DENIED_POLICY: 'denied_policy',
  DENIED_APPROVAL: 'denied_approval',
  DENIED_TIMEOUT: 'denied_timeout',
  DENIED_THREAT: 'denied_threat',
  ERROR: 'error',
} as const;
export type FinalOutcome = string;

// ─── Gate identifiers (fixed order) — open governed type ───
export const GATE_ID = {
  G01: 'gate_01_identity',
  G02: 'gate_02_classification',
  G03: 'gate_03_delegation',
  G04: 'gate_04_policy',
  G05: 'gate_05_approval',
  G06: 'gate_06_execution',
  G07: 'gate_07_evidence',
} as const;
export type GateId = string;
export const GATE_ORDER: GateId[] = [
  GATE_ID.G01,
  GATE_ID.G02,
  GATE_ID.G03,
  GATE_ID.G04,
  GATE_ID.G05,
  GATE_ID.G06,
  GATE_ID.G07,
];

// ─── Expiry classes — open governed type ───
export const EXPIRY_CLASS = {
  ACTION_SCOPED: 'action_scoped', // max 30s
  SHORT_LIVED: 'short_lived', // max 60s
  SESSION_SCOPED: 'session_scoped', // max 300s
} as const;
export type ExpiryClass = string;
export const EXPIRY_CLASS_SECONDS: Record<string, number> = {
  action_scoped: 30,
  short_lived: 60,
  session_scoped: 300,
};

// ─── Denial codes — typed denial identifiers for programmatic mapping ───
export const DENIAL_CODE = {
  // Gate 01
  ACTOR_NOT_REGISTERED: 'actor_not_registered',
  SESSION_NOT_FOUND: 'session_not_found',
  SESSION_EXPIRED: 'session_expired',
  PRINCIPAL_NOT_RESOLVABLE: 'principal_not_resolvable',
  ACTOR_PRINCIPAL_MISMATCH: 'actor_principal_mismatch',
  NON_HUMAN_ACTOR_INCOMPLETE: 'non_human_actor_incomplete_registry',
  // Gate 02
  UNRESOLVABLE_VERB: 'unresolvable_action_verb',
  UNRESOLVABLE_TARGET: 'unresolvable_target',
  UNRESOLVABLE_CAPABILITY: 'unresolvable_capability',
  RISK_CEILING_EXCEEDED: 'risk_ceiling_exceeded',
  // Gate 03
  DELEGATION_SIG_INVALID: 'delegation_signature_invalid',
  DELEGATION_EXPIRED: 'delegation_expired',
  CAPABILITY_NOT_IN_DELEGATION: 'capability_not_in_delegation',
  CAPABILITY_FORBIDDEN: 'capability_explicitly_forbidden',
  SYSTEM_NOT_IN_DELEGATION: 'system_not_in_delegation',
  RISK_TIER_EXCEEDS_CEILING: 'risk_tier_exceeds_delegation_ceiling',
  OCT_CEILING_EXCEEDED: 'oct_action_risk_ceiling_exceeded',
  OCT_COMPILE_DENIED: 'oct_compile_no_system_actions',
  OCT_UNASSIGNED: 'oct_level_not_assigned',
  CHAIN_DEPTH_EXCEEDED: 'chain_depth_ceiling_exceeded',
  PROPAGATION_NOT_PERMITTED: 'downstream_propagation_not_permitted',
  ENVIRONMENT_MISMATCH: 'environment_mismatch',
  CHAIN_INTEGRITY_BROKEN: 'chain_integrity_broken',
  // Gate 04
  POLICY_DENY: 'policy_deny',
  DEFAULT_DENY: 'default_deny',
  // Gate 05
  APPROVAL_TIMEOUT: 'approval_timeout',
  APPROVAL_DENIED_BY_HUMAN: 'approval_denied_by_human',
  APPROVAL_SIG_INVALID: 'approval_response_signature_invalid',
  APPROVAL_CONFIG_MISSING: 'approval_config_missing',
  APPROVAL_CHANNEL_NOT_FOUND: 'approval_channel_not_found',
  // Gate 06
  CONNECTOR_NOT_REGISTERED: 'connector_not_registered',
  CONNECTOR_CAP_UNSUPPORTED: 'connector_capability_unsupported',
  // Security / ingress
  REPLAY_DETECTED: 'replay_detected',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  BROAD_TOKEN_BYPASS: 'broad_token_bypass',
  TEMPLATE_INTEGRITY_FAILED: 'template_integrity_failed',
  GRANT_EXPIRED: 'grant_expired',
  SEQUENCE_ANOMALY: 'sequence_anomaly', // chain verifier only — not ingress
  // NVG
  NVG_CLASSIFICATION_DENIED: 'nvg_classification_denied',
  NVG_OCT_CEILING_DENIED: 'nvg_oct_ceiling_denied',
  NVG_ROUTING_POLICY_DENIED: 'nvg_routing_policy_denied',
  NVG_QUARANTINE: 'nvg_quarantine',
  NVG_FALLBACK_DENIED: 'nvg_fallback_denied',
  NVG_ENDPOINT_TIMEOUT: 'nvg_endpoint_timeout',
  NVG_ENDPOINT_UNREACHABLE: 'nvg_endpoint_unreachable',
  NVG_POLICY_SIG_INVALID: 'nvg_routing_policy_signature_invalid',
} as const;
export type DenialCode = string;

// ─── Sentinel value for EvidenceRecord encoding (new in v1.4.12) ───
// See §34 for full applicability law.
export const EVIDENCE_SENTINEL = 'NOT_APPLICABLE' as const;
export type EvidenceSentinel = typeof EVIDENCE_SENTINEL;

// ─── Version constants ───
export const GENESIS_HASH: Sha256Hex =
  '0000000000000000000000000000000000000000000000000000000000000000';
export const BLUEPRINT_VERSION: SemVer = 'v1.5.13';
export const SPEC_VERSION: SemVer = 'v1.8.26';
export const RUNTIME_CONTRACT_VERSION: SemVer = 'v1.0.0';
export const CAPABILITY_TAXONOMY_VERSION: SemVer = 'v1.0.0';
export const COMPARISON_INPUT_VERSION: SemVer = 'v1.0.0';
export const NEXUS_VERSION: SemVer = 'v1.0.0';
export const DELEGATION_ENGINE_ID: NonEmpty = 'nexus-delegation-engine-v1';

// ─── Replay dedup TTL ───
export const REPLAY_DEDUP_TTL_SECONDS = 3600;

// ─── Lexical constants — Amendment J-S1 ───
export const LEXICAL_VERSION = 'v1' as const;
export type LexiconVersion = string;
// Min: 300s. Max: 86400s. Outside bounds: engine refuses to start.

// ─── Infrastructure run ID namespace (§9.3.1) ───
export const NEXUS_INFRA_NAMESPACE = 'nexus-infra-run' as const;

// ─── Capability taxonomy v1.0.0 (§12.4) ───
export const CAPABILITY_IDS = {
  READ_RECORD_SINGLE: 'read:record:single',
  READ_RECORD_BULK: 'read:record:bulk',
  READ_RECORD_PII: 'read:record:pii',
  READ_RECORD_BULK_PII: 'read:record:bulk:pii',
  CREATE_RECORD_INTERNAL: 'create:record:internal',
  CREATE_RECORD_EXTERNAL: 'create:record:external',
  UPDATE_RECORD_INTERNAL: 'update:record:internal',
  UPDATE_RECORD_EXTERNAL: 'update:record:external',
  DELETE_RECORD: 'delete:record',
  DELETE_RECORD_BULK: 'delete:record:bulk',
  SEND_MESSAGE_INTERNAL: 'send:message:internal',
  SEND_MESSAGE_EXTERNAL: 'send:message:external',
  PUBLISH_CONTENT_INTERNAL: 'publish:content:internal',
  PUBLISH_CONTENT_EXTERNAL: 'publish:content:external',
  EXPORT_DATA_SINGLE: 'export:data:single',
  EXPORT_DATA_BULK: 'export:data:bulk',
  EXPORT_DATA_BULK_PII: 'export:data:bulk:pii',
  EXECUTE_QUERY: 'execute:query',
  EXECUTE_AUTOMATION: 'execute:automation',
  // New v1.4.12 capabilities for expanded verb taxonomy:
  WRITE_RECORD_INTERNAL: 'write:record:internal',
  WRITE_RECORD_EXTERNAL: 'write:record:external',
  QUERY_DATA: 'query:data',
  SEARCH_DATA: 'search:data',
  SYNTHESIZE_CONTENT: 'synthesize:content',
  TRANSMIT_DATA: 'transmit:data',
} as const;

// ─── Scenario manifest ───
export const SCENARIO_MANIFEST = {
  '01-allow-read': {
    description: 'Low-risk read → ALLOWED → executed',
    fixturePath: 'fixtures/scenario-01-allow-read',
  },
  '02-allow-create': {
    description: 'Medium-risk create → ALLOWED → executed',
    fixturePath: 'fixtures/scenario-02-allow-create',
  },
  '03-approval-approved': {
    description: 'High-risk send → REQUIRE_APPROVAL → approved',
    fixturePath: 'fixtures/scenario-03-approval-approved',
  },
  '04-approval-denied': {
    description: 'High-risk send → REQUIRE_APPROVAL → denied',
    fixturePath: 'fixtures/scenario-04-approval-denied',
  },
  '05-approval-timeout': {
    description: 'High-risk send → REQUIRE_APPROVAL → timeout',
    fixturePath: 'fixtures/scenario-05-approval-timeout',
  },
  '06-replay-detected': {
    description: 'Replay of scenario-01 → REPLAY DETECTED',
    fixturePath: 'fixtures/scenario-06-replay-detected',
  },
  '07-default-deny': {
    description: 'No policy loaded → DEFAULT DENY',
    fixturePath: 'fixtures/scenario-07-default-deny',
  },
  '08-policy-unsigned': {
    description: 'Unsigned policy → REJECTED at load',
    fixturePath: 'fixtures/scenario-08-policy-unsigned',
  },
  '09-broad-token-bypass': {
    description: 'Broad static credential → DENIED threat',
    fixturePath: 'fixtures/scenario-09-broad-token-bypass',
  },
  '10-delegation-exceeded': {
    description: 'Sub-agent outside parent bounds → DENIED Gate 03',
    fixturePath: 'fixtures/scenario-10-delegation-exceeded',
  },
} as const;
export type ScenarioId = keyof typeof SCENARIO_MANIFEST;

// ─── Data class ordering (§11.4) ───
export const DATA_CLASS_ORDER: string[] = [
  'public',
  'internal',
  'confidential',
  'pii',
  'phi',
  'financial',
];

// ─── OCT Ceilings (§11.2) ───
// Inline type — the full OctCeiling interface is in interfaces/index.ts.
// This constant is used by Gate 02 and the delegation engine for ceiling enforcement.
export const OCT_CEILINGS: Record<
  string,
  {
    dataClassCeiling: string[];
    modelTierCeiling: string[];
    actionRiskCeiling: string;
    allowedSystems: string[];
    allowedCapabilities: string[];
    delegationCeiling: { maxChainDepth: number; maxRiskTier: string };
  }
> = {
  'OCT-SECURE': {
    dataClassCeiling: ['public', 'internal', 'confidential', 'pii', 'phi', 'financial'],
    modelTierCeiling: ['on_prem_sensitive'],
    actionRiskCeiling: 'critical',
    allowedSystems: ['*'],
    allowedCapabilities: ['*'],
    delegationCeiling: { maxChainDepth: 3, maxRiskTier: 'critical' },
  },
  'OCT-CONFIDENTIAL': {
    dataClassCeiling: ['public', 'internal', 'confidential'],
    modelTierCeiling: [
      'on_prem_sensitive',
      'on_prem_general',
      'frontier_general',
      'frontier_reasoning',
      'frontier_live',
      'fallback',
    ],
    actionRiskCeiling: 'high',
    allowedSystems: ['*'],
    allowedCapabilities: ['*'],
    delegationCeiling: { maxChainDepth: 2, maxRiskTier: 'high' },
  },
  'OCT-OPEN': {
    dataClassCeiling: ['public'],
    modelTierCeiling: [
      'on_prem_sensitive',
      'on_prem_general',
      'frontier_general',
      'frontier_reasoning',
      'frontier_live',
      'fallback',
    ],
    actionRiskCeiling: 'medium',
    allowedSystems: ['*'],
    allowedCapabilities: ['*'],
    delegationCeiling: { maxChainDepth: 1, maxRiskTier: 'medium' },
  },
  'OCT-COMPILE': {
    dataClassCeiling: [],
    modelTierCeiling: [],
    actionRiskCeiling: EVIDENCE_SENTINEL,
    allowedSystems: [],
    allowedCapabilities: [],
    delegationCeiling: { maxChainDepth: 0, maxRiskTier: EVIDENCE_SENTINEL },
  },
};
