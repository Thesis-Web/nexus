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
// §10.1 Primitive Aliases
// ============================================================

export type Uuid = string; // UUID v4 — from crypto.randomUUID()
export type IsoTimestamp = string; // ISO 8601 UTC — from new Date().toISOString()
export type Sha256Hex = string; // 64-char lowercase hex
export type Base64Url = string; // URL-safe base64, no padding
export type NonEmpty = string; // validated non-empty at construction
export type SemVer = string; // e.g. "v0.3.6"

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
} as const;
export type ActorClass = string;

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
} as const;
export type ActionVerb = string;

// Risk tiers — open governed type (ordered: low < medium < high < critical) (MODULAR-006)
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

// Data classes — open governed type
export const DATA_CLASS = {
  PUBLIC: 'public',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  PII: 'pii',
  PHI: 'phi',
  FINANCIAL: 'financial',
} as const;
export type DataClass = string;

// Environments — open governed type
export const ENVIRONMENT_ID = {
  DEV: 'dev',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;
export type EnvironmentId = string;

// Outcome labels (policy gate output) — open governed type
export const OUTCOME_LABEL = {
  ALLOW: 'allow',
  DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval',
  ESCALATE: 'escalate',
} as const;
export type OutcomeLabel = string;

// Approval decision labels — open governed type
export const APPROVAL_DECISION_LABEL = {
  APPROVED: 'approved',
  DENIED: 'denied',
  TIMED_OUT: 'timed_out',
} as const;
export type ApprovalDecisionLabel = string;

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
} as const;
export type FinalOutcome = string;

// Gate identifiers (fixed order) — open governed type
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

// Expiry classes — open governed type
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
} as const;
export type DenialCode = string;

// Version constants
export const GENESIS_HASH: Sha256Hex =
  '0000000000000000000000000000000000000000000000000000000000000000';
export const BLUEPRINT_VERSION: SemVer = 'v0.3.6';
export const SPEC_VERSION: SemVer = 'v0.4.6';
export const CAPABILITY_TAXONOMY_VERSION: SemVer = 'v0.1.0';
export const COMPARISON_INPUT_VERSION: SemVer = 'v0.1.0';

// Component version constants — used in mintedBy and audit fields.
// Never hardcode version strings in implementation code; use these constants. (SOLVE-020)
export const NEXUS_VERSION: SemVer = 'v0.1.0';
export const DELEGATION_ENGINE_ID: NonEmpty = `nexus-delegation-engine/${NEXUS_VERSION}`;

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
} as const;

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
} as const;
export type ScenarioId = keyof typeof SCENARIO_MANIFEST;

// ============================================================
// §10.3 Core Interfaces
// ============================================================

// §10.3.1
export interface Principal {
  principalId: Uuid;
  displayName: NonEmpty;
  email: NonEmpty;
  registeredAt: IsoTimestamp;
  maxDelegableRiskTier: RiskTier;
  allowedSystems: string[];
}

// §10.3.2
export interface Actor {
  actorId: Uuid;
  actorClass: ActorClass;
  principalId: Uuid;
  displayName: NonEmpty;
  environment: EnvironmentId;
  riskCeiling: RiskTier;
  allowedSystems: string[];
  registeredAt: IsoTimestamp;
  owner?: NonEmpty; // required for non-human actors
  purpose?: NonEmpty; // required for non-human actors
  reviewCadence?: NonEmpty; // required for non-human actors
}

// §10.3.3
export interface DelegationContext {
  delegationId: Uuid;
  principalId: Uuid;
  actorId: Uuid;
  parentDelegationId: Uuid | null; // null = root
  chainDepth: number; // 0 = root
  maxChainDepth: number; // never increased by sub-delegation
  allowedSystems: string[];
  allowedCapabilities: string[]; // CapabilityId[]
  forbiddenCapabilities: string[];
  maxRiskTier: RiskTier;
  allowDownstreamPropagation: boolean;
  environment: EnvironmentId; // scoped to this environment only
  mintedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  mintedBy: NonEmpty; // must use DELEGATION_ENGINE_ID constant
  signature: Base64Url; // Ed25519 over canonicalize() of all fields except signature
}

// §10.3.4
export interface Session {
  sessionId: Uuid;
  actorId: Uuid;
  principalId: Uuid; // derived server-side from actor.principalId; never caller-supplied
  delegationId: Uuid;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

// §10.3.5
export interface AgentAction {
  actionId: Uuid; // assigned at ingress, never mutated
  receivedAt: IsoTimestamp;
  protocol: NonEmpty; // e.g. 'mcp/1.0'
  adapterVersion: NonEmpty;
  actorId: Uuid;
  principalId: Uuid;
  sessionId: Uuid;
  delegationId: Uuid;
  delegationSequence: number; // engine-assigned monotonic counter per delegationId
  // forensic ordering; never adapter-provided
  tool: NonEmpty;
  rawVerb: NonEmpty;
  rawTarget: NonEmpty;
  rawPayload: unknown; // in-memory only; never stored
  intent: IntentContext;
  resolvedVerb: ActionVerb | null;
  resolvedCapability: string | null;
  resolvedTarget: ResourceTarget | null;
  resolvedDataClasses: DataClass[];
  resolvedRiskTier: RiskTier | null;
}

// §10.3.6
export interface IntentContext {
  objectiveSummary: NonEmpty; // max 500 chars, sanitized
  triggeringSource: NonEmpty; // 'user_request'|'schedule'|'event'|'sub_task'|'unknown'
  toolchainContext: NonEmpty; // adapter name + version
  modelId: string | null;
  modelConfidence: number | null; // [0,1]
  riskNote: string | null; // max 200 chars, sanitized
  extractedAt: IsoTimestamp;
}

// §10.3.7
export interface GateDecision {
  gateId: GateId;
  gateOrder: number; // 1–7
  plane: 'control' | 'data';
  outcome: string; // OutcomeLabel | 'pass' | 'error'
  reason: NonEmpty; // human-readable prose
  denialCode: DenialCode | null; // typed denial code; null on pass/allow
  policyRuleId: string | null; // Gate 04 only
  evaluatedAt: IsoTimestamp;
  durationMs: number; // real elapsed ms from gate entry to decision
  metadata: Record<string, string | number | boolean | null>;
}

// §10.3.8
export interface ResourceTarget {
  system: NonEmpty;
  resourceType: NonEmpty;
  resourceScope: 'single' | 'bulk' | 'collection' | 'system';
  environment: EnvironmentId;
  externalFacing: boolean;
}

// §10.3.9
export interface ExecutionGrantTemplate {
  templateId: Uuid;
  actionId: Uuid;
  computedAt: IsoTimestamp;
  capabilityId: string;
  scopeDescriptor: NonEmpty;
  credentialSubjectType: NonEmpty; // 'user_identity'|'service_identity'|'federated'
  resourceBounds: ResourceBounds;
  environmentBound: EnvironmentId;
  expiryClass: ExpiryClass;
  maxExpirySeconds: number;
  approvalRequired: boolean;
  approvalLinkage: Uuid | null; // set by Gate 05 after approval
  approvalConfig: ApprovalConfig | null; // from matched policy rule
  templateFingerprint: Sha256Hex;
  // fingerprint = sha256(canonicalize(templateFingerprintPayload(template)))
  // templateFingerprintPayload omits templateFingerprint AND approvalLinkage by field removal.
  // Both buildGrantTemplate and assertTemplateIntegrity use the same helper. (SOLVE-003)
}

// §10.3.10
export interface ResourceBounds {
  allowedResourceTypes: string[];
  maxRecords: number | null;
  allowBulk: boolean;
  allowExternalFacing: boolean;
}

// §10.3.11
export interface ApprovalRequest {
  approvalId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp; // = addSeconds(issuedAt, approvalConfig.timeoutSeconds) — SOLVE-005
  actionSummary: NonEmpty; // max 300 chars
  contextSummary: NonEmpty; // max 500 chars
  proposedTarget: ResourceTarget;
  diff: string | null; // connector-produced preview, max 2000 chars
  estimatedImpact: NonEmpty;
  principalDisplayName: NonEmpty;
  actorDisplayName: NonEmpty;
  riskTier: RiskTier;
  dataClasses: DataClass[];
  modelConfidence: number | null;
  riskNote: string | null;
  signature: Base64Url; // Ed25519 over canonicalize() of all fields except signature
}

// §10.3.12
export interface ApprovalResponse {
  approvalId: Uuid;
  decision: ApprovalDecisionLabel;
  decidedBy: NonEmpty; // registered approver ID; 'system:timeout' for timeout responses
  decidedAt: IsoTimestamp;
  channel: NonEmpty;
  note: string | null;
  signature: Base64Url; // Ed25519 by approver key; '<none>' for timeout responses
}

// §10.3.13
export interface ExecutionGrant {
  grantId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  approvalId: Uuid | null;
  mintedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  capabilityId: string;
  scopeDescriptor: NonEmpty;
  credentialSubject: CredentialSubject;
  resourceBounds: ResourceBounds;
  environmentBound: EnvironmentId;
  signature: Base64Url; // Ed25519 over canonicalize() of all fields except signature
  // secretValue: NOT on this interface. Lives in grant-vault.ts WeakMap only.
}

// §10.3.14
export interface CredentialSubject {
  subjectId: NonEmpty;
  subjectType: 'user_identity' | 'service_identity' | 'federated';
  system: NonEmpty;
}

// §10.3.15
export interface ExecutionResult {
  grantId: Uuid;
  executedAt: IsoTimestamp;
  status: 'success' | 'failure' | 'partial';
  responseCode: string | null;
  durationMs: number;
  redactedSummary: string | null;
  errorType: string | null;
  errorMessage: string | null;
}

// §10.3.16 — evidence-safe, no secret
export interface ExecutionGrantMetadata {
  grantId: Uuid;
  scopeDescriptor: NonEmpty;
  credentialSubjectId: NonEmpty;
  credentialSubjectType: string;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  expiryClass: ExpiryClass;
  templateFingerprint: Sha256Hex;
  approvalLinkage: Uuid | null;
}

// §10.3.17
export interface DelegationContextSnapshot {
  delegationId: Uuid;
  principalId: Uuid;
  actorId: Uuid;
  chainDepth: number;
  chainAncestors: Uuid[]; // all parent delegation IDs, root first
  chainHash: Sha256Hex; // sha256(canonicalize([delegationId, ...chainAncestors]))
  allowedSystems: string[];
  maxRiskTier: RiskTier;
  environment: EnvironmentId; // delegation-scoped environment; aids environment-mismatch forensics
  expiresAt: IsoTimestamp;
}

// §10.3.18
export type ThreatType =
  | 'replay_detected'
  | 'injection_truncated'
  | 'broad_token_bypass'
  | 'scope_expansion_attempt'
  | 'policy_signature_invalid'
  | 'approval_response_invalid'
  | 'rate_limit_exceeded'
  | 'intent_overflow'
  | 'environment_mismatch'
  | 'security_violation';

export interface ThreatEvent {
  threatType: ThreatType;
  detectedAt: IsoTimestamp;
  gateId: GateId | 'ingress';
  detail: NonEmpty; // max 300 chars, sanitized
}

// §10.3.19 — evidence-safe subset of IntentContext
export interface IntentEvidence {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId: string | null;
  modelConfidence: number | null;
  riskNote: string | null;
}

// §10.3.20
export interface EvidenceRecord {
  recordId: Uuid;
  actionId: Uuid;
  sessionId: Uuid;
  ledgerSequence: number;
  actionSummary: {
    actionId: Uuid;
    receivedAt: IsoTimestamp;
    protocol: string;
    actorId: Uuid;
    actorClass: ActorClass; // from actor.actorClass — guaranteed present
    actorEnvironment: EnvironmentId; // from actor.environment — guaranteed present
    principalId: Uuid;
    delegationSequence: number; // engine-assigned per-delegation sequence; forensic only
    tool: string;
    resolvedVerb: ActionVerb | null;
    resolvedCapability: string | null;
    resolvedTarget: ResourceTarget | null;
    resolvedDataClasses: DataClass[];
    resolvedRiskTier: RiskTier | null;
  };
  intentEvidence: IntentEvidence;
  delegationContextSnapshot: DelegationContextSnapshot | null;
  gateDecisions: GateDecision[];
  policyRuleId: string | null;
  policyOutcome: OutcomeLabel | null;
  approvalRequest: ApprovalRequest | null;
  approvalResponse: ApprovalResponse | null;
  grantMetadata: ExecutionGrantMetadata | null;
  executionResult: ExecutionResult | null;
  finalOutcome: FinalOutcome;
  threatEvents: ThreatEvent[];
  compilerView: CompilerComparisonView; // inside signed body — MODULAR-009
  previousHash: Sha256Hex;
  recordHash: Sha256Hex; // sha256(canonicalize(record minus recordHash + signature))
  signature: Base64Url; // Ed25519 over recordHash
}

// ============================================================
// §11 Interface Contracts
// ============================================================

// §11.1 Gate Interface
export interface Gate {
  readonly gateId: GateId;
  readonly gateOrder: number;
  readonly plane: 'control' | 'data';
  // priorDecisions passed explicitly — not via context — so no context spread occurs.
  evaluate(
    action: AgentAction,
    context: PipelineContext,
    priorDecisions: GateDecision[]
  ): Promise<GateResult>;
  onDownstreamFailure?(action: AgentAction, failedGate: GateId): Promise<void>;
}

export interface PipelineContext {
  sessionId: Uuid;
  delegationContext?: DelegationContext;
  delegationStore: DelegationStore;
  delegationSnapshot?: DelegationContextSnapshot;
  actor?: Actor;
  principal?: Principal;
  policyFile: LoadedPolicyFile | null;
  approverRegistry: ApproverRegistry;
  connectorRegistry: ConnectorRegistry;
  channelRegistry: ChannelRegistry;
  threatLog: ThreatEvent[];
  startedAt: IsoTimestamp;
  grantTemplate?: ExecutionGrantTemplate;
  executionGrant?: ExecutionGrant;
  executionResult?: ExecutionResult;
  approvalRequest?: ApprovalRequest;
  approvalResponse?: ApprovalResponse;
  lastEvidenceRecord?: EvidenceRecord;
}

export interface GateResult {
  decision: GateDecision;
  actionMutations?: Partial<AgentAction>; // Gate 02 only
  grantTemplate?: ExecutionGrantTemplate; // Gate 04 only
  delegationSnapshot?: DelegationContextSnapshot; // Gate 03 only
  grant?: ExecutionGrant; // Gate 06 only
  executionResult?: ExecutionResult; // Gate 06 only
  approvalRequest?: ApprovalRequest; // Gate 05 only
  approvalResponse?: ApprovalResponse; // Gate 05 only
}

// §11.2 Adapter Interface
export interface Adapter {
  readonly adapterProtocol: NonEmpty;
  readonly adapterVersion: NonEmpty;
  normalize(rawRequest: unknown): Promise<NormalizationResult>;
}

export interface NormalizationResult {
  ok: boolean;
  action?: Omit<
    AgentAction,
    | 'resolvedVerb'
    | 'resolvedCapability'
    | 'resolvedTarget'
    | 'resolvedDataClasses'
    | 'resolvedRiskTier'
  > & {
    resolvedVerb: null;
    resolvedCapability: null;
    resolvedTarget: null;
    resolvedDataClasses: [];
    resolvedRiskTier: null;
  };
  error?: NonEmpty;
}

// §11.3 Connector Interface (MODULAR-005)
export interface Connector {
  readonly systemType: NonEmpty;
  readonly connectorVersion: NonEmpty;
  supportedCapabilities(): string[];
  canProduceDiff(): boolean;
  produceDiff?(action: AgentAction, template: ExecutionGrantTemplate): Promise<string | null>;
  execute(action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult>;
  redeemGrant(grant: ExecutionGrant): Promise<void>;
}

// §11.4 Approval Channel Interface (MODULAR-004)
export interface ApprovalChannel {
  readonly channelId: NonEmpty;
  readonly channelVersion: NonEmpty;
  dispatch(request: ApprovalRequest): Promise<void>;
  awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null>;
}

// §11.5 Ledger Backend Interface (MODULAR-003)
// No DELETE or UPDATE method may exist on this interface.
export interface LedgerBackend {
  readonly backendId: NonEmpty;
  readonly backendVersion: NonEmpty;
  append(record: EvidenceRecord): Promise<void>;
  getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null>;
  getBySequence(seq: number): Promise<EvidenceRecord | null>;
  getLatestSequence(): Promise<number>;
  listRange(from: number, to: number): Promise<EvidenceRecord[]>;
}

// §11.6 Approver types
export interface Approver {
  approverId: NonEmpty; // matches ApprovalResponse.decidedBy
  displayName: NonEmpty;
  publicKey: Base64Url; // Ed25519 public key, 32 bytes base64url
  channels: NonEmpty[];
  registeredAt: IsoTimestamp;
}

export interface ApproverRegistry {
  get(approverId: NonEmpty): Promise<Approver | null>;
  list(): Promise<Approver[]>;
  register(approver: Omit<Approver, 'registeredAt'>): Promise<Approver>;
}

// §11.7 DelegationStore Interface
export interface DelegationStore {
  getById(delegationId: Uuid): Promise<DelegationContext | null>;
  save(dc: DelegationContext): Promise<void>;
  listForActor(actorId: Uuid): Promise<DelegationContext[]>;
}

// Registry interfaces (used in PipelineContext)
export interface ConnectorRegistry {
  get(systemType: NonEmpty): Connector | null;
  register(connector: Connector): void;
  list(): Connector[];
}

export interface ChannelRegistry {
  get(channelId: NonEmpty): ApprovalChannel | null;
  register(channel: ApprovalChannel): void;
  list(): ApprovalChannel[];
}

// ============================================================
// §12 Policy File Contract
// ============================================================

// §12.1
export interface PolicyFile {
  version: '1.0';
  bundleId: Uuid;
  bundleVersion: NonEmpty;
  issuer: NonEmpty;
  issuedAt: IsoTimestamp;
  signature: Base64Url; // Ed25519 over canonicalize() of all fields except signature
  defaultOutcome: 'deny';
  rules: PolicyRule[];
}

export interface LoadedPolicyFile extends PolicyFile {
  sortedRules: PolicyRule[]; // pre-sorted by priority ascending at load time; immutable
  bundleHash: Sha256Hex; // pre-computed at load time; written to CCV
}

export interface PolicyRule {
  ruleId: NonEmpty;
  description: NonEmpty;
  priority: number; // lower = higher priority; first match wins
  conditions: PolicyCondition;
  outcome: OutcomeLabel;
  approvalConfig: ApprovalConfig | null; // required when outcome === 'require_approval'
  grantHint: GrantTemplateHint | null;
}

// §12.1 — MODULAR-007: versioned and extensible
export interface PolicyCondition {
  actorClasses?: ActorClass[];
  capabilities?: string[];
  actionVerbs?: ActionVerb[];
  riskTiers?: RiskTier[];
  dataClasses?: DataClass[];
  dataClassMatchMode?: 'any'; // fixed to 'any'; reserved — AND/ALL deferred
  environments?: EnvironmentId[];
  externalFacing?: boolean;
  maxChainDepth?: number;
}

export interface ApprovalConfig {
  channelId: NonEmpty; // single channel ID — NOT a list (SOLVE-016)
  timeoutSeconds: number; // 30 <= x <= 3600
  onTimeout: 'deny'; // always 'deny', non-configurable
}

export interface GrantTemplateHint {
  expiryClass?: ExpiryClass;
  allowBulk?: boolean;
  allowExternalFacing?: boolean;
  maxRecords?: number;
}

// ============================================================
// §13 CCV — Compiler Comparison View (MODULAR-009)
// CCV is blueprint law. Stored within the signed EvidenceRecord body only.
// ============================================================

export interface CompilerComparisonView {
  meta: {
    blueprintVersion: SemVer;
    runtimeContractVersion: SemVer;
    capabilityTaxonomyVersion: SemVer;
    comparisonInputVersion: SemVer;
    normalizedActionHash: Sha256Hex;
    policyBundleHash: Sha256Hex;
  };
  identity: {
    actorId: Uuid;
    actorClass: ActorClass;
    principalId: Uuid;
    environment: EnvironmentId;
  };
  delegation: {
    delegationContextId: Uuid | null;
    chainDepth: number | null;
    chainHash: Sha256Hex | null;
    maxRiskTier: RiskTier | null;
  };
  classification: {
    capabilityId: string;
    actionVerb: ActionVerb;
    dataClasses: DataClass[];
    riskTier: RiskTier;
  };
  policyAndApproval: {
    policyRuleId: string | null;
    outcomeLabel: OutcomeLabel | null;
    approvalRequired: boolean;
    approvalDecisionLabel: ApprovalDecisionLabel | null;
  };
  authorityAndExecution: {
    executionGrantId: Uuid | null;
    credentialSubjectType: string | null;
    scopeDescriptor: string | null;
    expiryClass: ExpiryClass | null;
    grantTemplateFingerprint: Sha256Hex | null;
  };
  result: {
    finalOutcome: FinalOutcome;
    errorCodeFamily: string | null;
  };
}

// ============================================================
// §15 Error types — named error classes for deterministic routing
// ============================================================

export class NexusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NexusError';
  }
}

export class NexusSecurityViolation extends NexusError {
  readonly denialCode: DenialCode;
  constructor(message: string, denialCode: DenialCode) {
    super(message);
    this.name = 'NexusSecurityViolation';
    this.denialCode = denialCode;
  }
}

export class PolicySignatureError extends NexusError {
  constructor(message: string) {
    super(message);
    this.name = 'PolicySignatureError';
  }
}

export class DelegationError extends NexusError {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationError';
  }
}

export class DelegationChainIntegrityError extends NexusError {
  constructor(message: string) {
    super(message);
    this.name = 'DelegationChainIntegrityError';
  }
}

export class ChainError extends NexusError {
  readonly denialCode: DenialCode;
  constructor(message: string, denialCode: DenialCode) {
    super(message);
    this.name = 'ChainError';
    this.denialCode = denialCode;
  }
}

// ============================================================
// §20 Registry helpers
// ============================================================

export interface SessionStore {
  // Returns session regardless of expiry state — Gate 01 owns expiry semantics (SOLVE-011)
  get(sessionId: Uuid): Promise<Session | null>;
  create(session: Session): Promise<Session>;
  list(): Promise<Session[]>;
}

export interface ActorRegistryStore {
  get(actorId: Uuid): Promise<Actor | null>;
  getByClass(actorClass: ActorClass): Promise<Actor[]>;
  register(actor: Actor): Promise<Actor>;
  list(): Promise<Actor[]>;
}

export interface PrincipalRegistryStore {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<Principal>;
  list(): Promise<Principal[]>;
}

export interface PendingApprovalStore {
  save(request: ApprovalRequest): Promise<void>;
  // getRequest() is required — used by shared decideApproval service (BS-102)
  getRequest(approvalId: Uuid): Promise<ApprovalRequest | null>;
  delete(approvalId: Uuid): Promise<void>;
  listPending(): Promise<ApprovalRequest[]>;
}

// ============================================================
// §28 Token Posture Report
// ============================================================

export interface PostureViolation {
  actorId: Uuid;
  actorClass: ActorClass;
  reason: NonEmpty;
  detectedAt: IsoTimestamp;
}

export interface TokenPostureReport {
  generatedAt: IsoTimestamp;
  totalActors: number;
  violations: PostureViolation[];
  postureScore: number; // 0.0–1.0; 1.0 = no violations
}
