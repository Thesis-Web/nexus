/**
 * Nexus — Agent Action Router and Authority Governance Layer
 * Runtime Contract — Layer 2
 *
 * This file is the single authoritative source for all governed constants,
 * primitive aliases, interfaces, and contract shapes.
 *
 * Law: nexus-blueprint-v0-3-6.md §4, §7, §8, §9, §10, §11, §12
 * Spec: nexus-engineering-spec-v0-4-6.md §10, §11, §12
 *
 * MODULAR-002: ActorClass is an open governed string type — never a closed union ceiling.
 * MODULAR-006: RiskTier is an open governed string type.
 * MODULAR-007: PolicyCondition is versioned and extensible.
 */
// ============================================================
// §10.2 Governed Constants
// All governed types are open string aliases.
// New values may be added by spec update. No value removed or renamed
// without a blueprint version bump.
// TypeScript type is `string` — NOT typeof CONST[keyof typeof CONST].
// ============================================================
// Actor classes — open governed type (MODULAR-002)
export const ACTOR_CLASS = {
    HUMAN: 'HUMAN',
    HUMAN_WITH_COPILOT: 'HUMAN_WITH_COPILOT',
    SUPERVISED_AGENT: 'SUPERVISED_AGENT',
    AUTONOMOUS_AGENT: 'AUTONOMOUS_AGENT',
    SCHEDULED_AGENT: 'SCHEDULED_AGENT',
    DELEGATED_SUBAGENT: 'DELEGATED_SUBAGENT',
    SERVICE_AUTOMATION: 'SERVICE_AUTOMATION',
};
// Action verbs — open governed type
export const ACTION_VERB = {
    READ: 'read',
    CREATE: 'create',
    UPDATE: 'update',
    DELETE: 'delete',
    SEND: 'send',
    PUBLISH: 'publish',
    EXPORT: 'export',
    EXECUTE: 'execute',
};
// Risk tiers — open governed type (ordered: low < medium < high < critical) (MODULAR-006)
export const RISK_TIER = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
};
export const RISK_TIER_ORDER = ['low', 'medium', 'high', 'critical'];
export function riskTierExceeds(a, ceiling) {
    return RISK_TIER_ORDER.indexOf(a) > RISK_TIER_ORDER.indexOf(ceiling);
}
// Data classes — open governed type
export const DATA_CLASS = {
    PUBLIC: 'public',
    INTERNAL: 'internal',
    CONFIDENTIAL: 'confidential',
    PII: 'pii',
    PHI: 'phi',
    FINANCIAL: 'financial',
};
// Environments — open governed type
export const ENVIRONMENT_ID = {
    DEV: 'dev',
    STAGING: 'staging',
    PRODUCTION: 'production',
};
// Outcome labels (policy gate output) — open governed type
export const OUTCOME_LABEL = {
    ALLOW: 'allow',
    DENY: 'deny',
    REQUIRE_APPROVAL: 'require_approval',
    ESCALATE: 'escalate',
};
// Approval decision labels — open governed type
export const APPROVAL_DECISION_LABEL = {
    APPROVED: 'approved',
    DENIED: 'denied',
    TIMED_OUT: 'timed_out',
};
// Final outcome labels — open governed type
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
};
// Gate identifiers (fixed order) — open governed type
export const GATE_ID = {
    G01: 'gate_01_identity',
    G02: 'gate_02_classification',
    G03: 'gate_03_delegation',
    G04: 'gate_04_policy',
    G05: 'gate_05_approval',
    G06: 'gate_06_execution',
    G07: 'gate_07_evidence',
};
export const GATE_ORDER = [
    GATE_ID.G01,
    GATE_ID.G02,
    GATE_ID.G03,
    GATE_ID.G04,
    GATE_ID.G05,
    GATE_ID.G06,
    GATE_ID.G07,
];
// Expiry classes — open governed type
export const EXPIRY_CLASS = {
    ACTION_SCOPED: 'action_scoped', // max 30s
    SHORT_LIVED: 'short_lived', // max 60s
    SESSION_SCOPED: 'session_scoped', // max 300s
};
export const EXPIRY_CLASS_SECONDS = {
    action_scoped: 30,
    short_lived: 60,
    session_scoped: 300,
};
// Denial codes — typed denial identifiers for programmatic mapping
// Used on GateDecision.denialCode. computeFinalOutcome maps on these, not on reason string.
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
    // Gate 03
    DELEGATION_SIG_INVALID: 'delegation_signature_invalid',
    DELEGATION_EXPIRED: 'delegation_expired',
    CAPABILITY_NOT_IN_DELEGATION: 'capability_not_in_delegation',
    CAPABILITY_FORBIDDEN: 'capability_explicitly_forbidden',
    SYSTEM_NOT_IN_DELEGATION: 'system_not_in_delegation',
    RISK_TIER_EXCEEDS_CEILING: 'risk_tier_exceeds_delegation_ceiling',
    CHAIN_DEPTH_EXCEEDED: 'chain_depth_ceiling_exceeded',
    PROPAGATION_NOT_PERMITTED: 'downstream_propagation_not_permitted',
    ENVIRONMENT_MISMATCH: 'environment_mismatch',
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
    // ledger sequence discontinuity — emitted by chain verifier ONLY (SOLVE-010)
    SEQUENCE_ANOMALY: 'sequence_anomaly',
    // parent delegation not found in store
    CHAIN_INTEGRITY_BROKEN: 'chain_integrity_broken',
};
// Version constants
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
export const BLUEPRINT_VERSION = 'v0.3.6';
export const SPEC_VERSION = 'v0.4.6';
export const CAPABILITY_TAXONOMY_VERSION = 'v0.1.0';
export const COMPARISON_INPUT_VERSION = 'v0.1.0';
// Component version constants — used in mintedBy and audit fields.
// Never hardcode version strings in implementation code; use these constants. (SOLVE-020)
export const NEXUS_VERSION = 'v0.1.0';
export const DELEGATION_ENGINE_ID = `nexus-delegation-engine/${NEXUS_VERSION}`;
// Replay dedup window. Default 3600s (1 hour). Min 300s. Max 86400s.
export const REPLAY_DEDUP_TTL_SECONDS = 3600;
// Canonical capability IDs — v0.1.0 governed set
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
};
// Scenario manifest — canonical map of all 10 POC fixture scenarios. (SOLVE-019)
// CLI --scenario validates against this manifest. No string concatenation for paths.
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
};
// ============================================================
// §15 Error types — named error classes for deterministic routing
// ============================================================
export class NexusError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NexusError';
    }
}
export class NexusSecurityViolation extends NexusError {
    denialCode;
    constructor(message, denialCode) {
        super(message);
        this.name = 'NexusSecurityViolation';
        this.denialCode = denialCode;
    }
}
export class PolicySignatureError extends NexusError {
    constructor(message) {
        super(message);
        this.name = 'PolicySignatureError';
    }
}
export class DelegationError extends NexusError {
    constructor(message) {
        super(message);
        this.name = 'DelegationError';
    }
}
export class DelegationChainIntegrityError extends NexusError {
    constructor(message) {
        super(message);
        this.name = 'DelegationChainIntegrityError';
    }
}
export class ChainError extends NexusError {
    denialCode;
    constructor(message, denialCode) {
        super(message);
        this.name = 'ChainError';
        this.denialCode = denialCode;
    }
}
