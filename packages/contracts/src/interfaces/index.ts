// packages/contracts/src/interfaces/index.ts
// Spec: nexus-engineering-spec-v1-8-26.md §12.3, §10.2, §14.1
// Layer 2 — all interface contracts. Imports from types and constants only.

import type { Uuid, IsoTimestamp, Sha256Hex, Base64Url, NonEmpty, SemVer } from '../types/index.js';
import type { ModelEndpointAuth } from './model-endpoint-auth.js';
import type { InvocationAttempt } from './invocation-attempt.js';

import type {
  ActorClass,
  ActionVerb,
  RiskTier,
  DataClass,
  EnvironmentId,
  ModelTier,
  OctLevel,
  OperatingMode,
  OutcomeLabel,
  ApprovalDecisionLabel,
  FinalOutcome,
  GateId,
  ExpiryClass,
  DenialCode,
  EvidenceSentinel,
  ScenarioId,
} from '../constants/index.js';

// ─── §12.3.1 Principal ───
export interface Principal {
  principalId: Uuid;
  displayName: NonEmpty;
  email: NonEmpty;
  registeredAt: IsoTimestamp;
  maxDelegableRiskTier: RiskTier;
  allowedSystems: string[];
}

// ─── §12.3.2 Actor ───
export interface Actor {
  actorId: Uuid;
  actorClass: ActorClass;
  principalId: Uuid;
  displayName: NonEmpty;
  environment: EnvironmentId;
  octLevel: OctLevel | null;
  riskCeiling: RiskTier;
  allowedSystems: string[];
  registeredAt: IsoTimestamp;
  owner?: NonEmpty;
  purpose?: NonEmpty;
  reviewCadence?: NonEmpty;
}

// ─── §12.3.3 DelegationContext ───
export interface DelegationContext {
  delegationId: Uuid;
  principalId: Uuid;
  actorId: Uuid;
  parentDelegationId: Uuid | null;
  chainDepth: number;
  maxChainDepth: number;
  allowedSystems: string[];
  allowedCapabilities: string[];
  forbiddenCapabilities: string[];
  maxRiskTier: RiskTier;
  allowDownstreamPropagation: boolean;
  environment: EnvironmentId;
  mintedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  mintedBy: NonEmpty;
  signature: Base64Url;
}

// ─── §12.3.4 Session ───
export interface Session {
  sessionId: Uuid;
  actorId: Uuid;
  principalId: Uuid;
  delegationId: Uuid;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

// ─── §12.3.6 IntentContext ───
export interface IntentContext {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId: string | null;
  modelConfidence: number | null;
  riskNote: string | null;
  extractedAt: IsoTimestamp;
}

// ─── §12.3.8 ResourceTarget ───
export interface ResourceTarget {
  system: NonEmpty;
  resourceType: NonEmpty;
  resourceScope: 'single' | 'bulk' | 'collection' | 'system';
  environment: EnvironmentId;
  externalFacing: boolean;
}

// ─── §12.3.5 AgentAction ───
export interface AgentAction {
  actionId: Uuid;
  runId: Uuid;
  receivedAt: IsoTimestamp;
  protocol: NonEmpty;
  adapterVersion: NonEmpty;
  actorId: Uuid;
  principalId: Uuid;
  sessionId: Uuid;
  delegationId: Uuid;
  delegationSequence: number;
  tool: NonEmpty;
  rawVerb: NonEmpty;
  rawTarget: NonEmpty;
  rawPayload: unknown;
  intent: IntentContext;
  resolvedVerb: ActionVerb | null;
  resolvedCapability: string | null;
  resolvedTarget: ResourceTarget | null;
  resolvedDataClasses: DataClass[];
  resolvedRiskTier: RiskTier | null;
}

// ─── §12.3.7 GateDecision ───
export interface GateDecision {
  gateId: GateId;
  gateOrder: number;
  plane: 'control' | 'data';
  outcome: string;
  reason: NonEmpty;
  denialCode: DenialCode | null;
  policyRuleId: string | null;
  evaluatedAt: IsoTimestamp;
  durationMs: number;
  metadata: Record<string, string | number | boolean | null>;
}

// ─── §12.3.10 ResourceBounds ───
export interface ResourceBounds {
  allowedResourceTypes: string[];
  maxRecords: number | null;
  allowBulk: boolean;
  allowExternalFacing: boolean;
}

// ─── §12.3.27 PolicyCondition, GrantTemplateHint, ApprovalConfig, PolicyRule, LoadedPolicyFile ───
export interface PolicyCondition {
  actorClasses?: ActorClass[];
  capabilities?: string[];
  actionVerbs?: ActionVerb[];
  riskTiers?: RiskTier[];
  dataClasses?: DataClass[];
  environments?: EnvironmentId[];
  externalFacing?: boolean;
  maxChainDepth?: number;
}

export interface GrantTemplateHint {
  expiryClass?: ExpiryClass;
  maxRecords?: number;
  allowBulk?: boolean;
  allowExternalFacing?: boolean;
}

export interface ApprovalConfig {
  timeoutSeconds: number;
  channelId: NonEmpty;
}

export interface PolicyRule {
  ruleId: NonEmpty;
  priority: number;
  conditions: PolicyCondition;
  outcome: OutcomeLabel;
  grantHint?: GrantTemplateHint;
  approvalConfig?: ApprovalConfig;
}

export interface PolicyFile {
  version: '1.0';
  bundleId: Uuid;
  bundleVersion: NonEmpty;
  issuer: NonEmpty;
  issuedAt: IsoTimestamp;
  signature: Base64Url;
  defaultOutcome: 'deny';
  rules: PolicyRule[];
}
export interface LoadedPolicyFile extends PolicyFile {
  filepath: NonEmpty;
  bundleHash: Sha256Hex;
  sortedRules: PolicyRule[];
  loadedAt: IsoTimestamp;
  signature: Base64Url;
}

// ─── §12.3.9 ExecutionGrantTemplate ───
export interface ExecutionGrantTemplate {
  templateId: Uuid;
  actionId: Uuid;
  computedAt: IsoTimestamp;
  capabilityId: string;
  scopeDescriptor: NonEmpty;
  credentialSubjectType: NonEmpty;
  resourceBounds: ResourceBounds;
  environmentBound: EnvironmentId;
  expiryClass: ExpiryClass;
  maxExpirySeconds: number;
  approvalRequired: boolean;
  approvalLinkage: Uuid | null;
  approvalConfig: ApprovalConfig | null;
  templateFingerprint: Sha256Hex;
}

// ─── §12.3.11 ApprovalRequest ───
export interface ApprovalRequest {
  approvalId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  actionSummary: NonEmpty;
  contextSummary: NonEmpty;
  proposedTarget: ResourceTarget;
  diff: string | null;
  estimatedImpact: NonEmpty;
  principalDisplayName: NonEmpty;
  actorDisplayName: NonEmpty;
  riskTier: RiskTier;
  dataClasses: DataClass[];
  modelConfidence: number | null;
  riskNote: string | null;
  signature: Base64Url;
}

// ─── §12.3.12 ApprovalResponse ───
export interface ApprovalResponse {
  approvalId: Uuid;
  decision: ApprovalDecisionLabel;
  decidedBy: NonEmpty;
  decidedAt: IsoTimestamp;
  channel: NonEmpty;
  note: string | null;
  signature: Base64Url;
}

// ─── §12.3.14 CredentialSubject ───
export interface CredentialSubject {
  subjectId: NonEmpty;
  subjectType: 'user_identity' | 'service_identity' | 'federated';
  system: NonEmpty;
}

// ─── §12.3.13 ExecutionGrant ───
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
  signature: Base64Url;
  // secretValue: NOT on this interface. Lives in grant-vault WeakMap only.
}

// ─── §12.3.15 ExecutionResult ───
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

// ─── §12.3.16 ExecutionGrantMetadata (evidence-safe, no secret) ───
export interface ExecutionGrantMetadata {
  grantId: Uuid | EvidenceSentinel;
  scopeDescriptor: NonEmpty | EvidenceSentinel;
  credentialSubjectId: NonEmpty | EvidenceSentinel;
  credentialSubjectType: string | EvidenceSentinel;
  issuedAt: IsoTimestamp | EvidenceSentinel;
  expiresAt: IsoTimestamp | EvidenceSentinel;
  expiryClass: ExpiryClass | EvidenceSentinel;
  templateFingerprint: Sha256Hex | EvidenceSentinel;
  approvalLinkage: Uuid | EvidenceSentinel;
}

// ─── §12.3.17 DelegationContextSnapshot ───
export interface DelegationContextSnapshot {
  delegationId: Uuid;
  principalId: Uuid;
  actorId: Uuid;
  chainDepth: number;
  chainAncestors: Uuid[];
  chainHash: Sha256Hex;
  allowedSystems: string[];
  maxRiskTier: RiskTier;
  environment: EnvironmentId;
  expiresAt: IsoTimestamp;
}

// ─── §12.3.18 ThreatEvent ───
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
  | 'security_violation'
  | 'nvg_wall_violation';

export interface ThreatEvent {
  threatType: ThreatType;
  detectedAt: IsoTimestamp;
  gateId: GateId | 'ingress' | 'nvg';
  detail: NonEmpty;
}

// ─── §12.3.19 IntentEvidence ───
export interface IntentEvidence {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId: string | null;
  modelConfidence: number | null;
  riskNote: string | null;
}

// ─── §14.1 CompilerComparisonView ───
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
    delegationContextId: Uuid;
    chainDepth: number;
    chainHash: Sha256Hex;
    maxRiskTier: RiskTier;
  };
  classification: {
    capabilityId: string | EvidenceSentinel;
    actionVerb: ActionVerb | EvidenceSentinel;
    dataClasses: DataClass[] | EvidenceSentinel;
    riskTier: RiskTier | EvidenceSentinel;
  };
  policyAndApproval: {
    policyRuleId: string | EvidenceSentinel;
    outcomeLabel: OutcomeLabel | EvidenceSentinel;
    approvalRequired: boolean | EvidenceSentinel;
    approvalDecisionLabel: ApprovalDecisionLabel | EvidenceSentinel;
  };
  authorityAndExecution: {
    executionGrantId: Uuid | EvidenceSentinel;
    credentialSubjectType: string | EvidenceSentinel;
    scopeDescriptor: string | EvidenceSentinel;
    expiryClass: ExpiryClass | EvidenceSentinel;
    grantTemplateFingerprint: Sha256Hex | EvidenceSentinel;
  };
  result: {
    finalOutcome: FinalOutcome;
    errorCodeFamily: string | null;
  };
}

// ─── §12.3.20 EvidenceRecord ───
export interface EvidenceRecord {
  recordId: Uuid;
  actionId: Uuid;
  sessionId: Uuid;
  runId: Uuid;
  ledgerSequence: number;
  actionSummary: {
    actionId: Uuid;
    receivedAt: IsoTimestamp;
    protocol: string;
    actorId: Uuid;
    actorClass: ActorClass;
    actorEnvironment: EnvironmentId;
    principalId: Uuid;
    delegationSequence: number;
    tool: string;
    resolvedVerb: ActionVerb | EvidenceSentinel;
    resolvedCapability: string | EvidenceSentinel;
    resolvedTarget: ResourceTarget | EvidenceSentinel;
    resolvedDataClasses: DataClass[] | EvidenceSentinel;
    resolvedRiskTier: RiskTier | EvidenceSentinel;
  };
  intentEvidence: IntentEvidence;
  delegationContextSnapshot: DelegationContextSnapshot;
  gateDecisions: GateDecision[];
  policyRuleId: string | EvidenceSentinel;
  policyOutcome: OutcomeLabel | EvidenceSentinel;
  approvalRequired: boolean | EvidenceSentinel;
  approvalRequest: ApprovalRequest | null;
  approvalResponse: ApprovalResponse | null;
  approvalDecisionLabel: ApprovalDecisionLabel | EvidenceSentinel;
  grantMetadata: ExecutionGrantMetadata;
  executionResult: ExecutionResult | null;
  finalOutcome: FinalOutcome;
  threatEvents: ThreatEvent[];
  compilerView: CompilerComparisonView;
  previousHash: Sha256Hex;
  recordHash: Sha256Hex;
  signature: Base64Url;
}

// ─── §12.3.21 Gate Interface ───
export interface Gate {
  readonly gateId: GateId;
  readonly gateOrder: number;
  readonly plane: 'control' | 'data';
  evaluate(
    action: AgentAction,
    context: PipelineContext,
    priorDecisions: GateDecision[]
  ): Promise<GateResult>;
  onDownstreamFailure?(action: AgentAction, failedGate: GateId): Promise<void>;
}

// ─── §12.3.22 GateResult ───
export interface GateResult {
  decision: GateDecision;
  actionMutations?: Partial<AgentAction>;
  grantTemplate?: ExecutionGrantTemplate;
  grant?: ExecutionGrant;
  executionResult?: ExecutionResult;
  delegationSnapshot?: DelegationContextSnapshot;
  approvalRequest?: ApprovalRequest;
  approvalResponse?: ApprovalResponse;
}

// ─── §12.3.23 PipelineContext ───
export interface PipelineContext {
  sessionId: Uuid;
  delegationContext: DelegationContext;
  delegationStore: DelegationStore;
  delegationSnapshot?: DelegationContextSnapshot;
  actor: Actor;
  principal: Principal;
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
  identityClaims?: IdentityClaims; // IDENTITY-001: populated by Gate01 via IdentityProviderInterface
  effectiveCeiling?: EffectiveCeiling; // T16-F01/RULING-005: populated by Gate 02 after resolveEffectiveCeiling
}

// ─── §12.3.24 LedgerBackend Interface ───
export interface LedgerBackend {
  readonly backendId: NonEmpty;
  readonly backendVersion: NonEmpty;
  append(record: EvidenceRecord): Promise<void>;
  getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null>;
  getBySequence(seq: number): Promise<EvidenceRecord | null>;
  getLatestSequence(): Promise<number>;
  listRange(from: number, to: number): Promise<EvidenceRecord[]>;
}

// ─── §12.3.24b GrantVault Interface (SOLVE-S6-001) ───
// Owner-approved: GrantVault as pure interface in Layer 2.
// Implementation (WeakMap singleton) stays in Layer 1 core.
// Passed to connectors via method injection from Gate 06.
export interface GrantVault {
  setSecret(grant: ExecutionGrant, secret: string): void;
  getSecret(grant: ExecutionGrant): string | undefined;
  clearSecret(grant: ExecutionGrant): void;
  assertPresent(grant: ExecutionGrant): void;
  assertNotExpired(grant: ExecutionGrant): void;
}

// ─── §12.3.25 Connector Interface ───
// DIFF-S6-001: Added vault parameter to execute() and redeemGrant().
// Spec §12.3.25 defines (action, grant) signatures, but spec §6.3 forbids
// connector imports from core. Owner approved GrantVault DI to resolve.
export interface Connector {
  readonly systemType: NonEmpty;
  readonly connectorVersion: NonEmpty;
  supportedCapabilities(): string[];
  canProduceDiff(): boolean;
  produceDiff?(action: AgentAction, template: ExecutionGrantTemplate): Promise<string | null>;
  execute(action: AgentAction, grant: ExecutionGrant, vault: GrantVault): Promise<ExecutionResult>;
  redeemGrant(grant: ExecutionGrant, vault: GrantVault): Promise<void>;
}

// ─── §12.3.26 ApprovalChannel Interface ───
export interface ApprovalChannel {
  readonly channelId: NonEmpty;
  readonly channelVersion: NonEmpty;
  dispatch(request: ApprovalRequest): Promise<void>;
  awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null>;
}

// ─── §12.3.28 PendingApprovalRecord ───
export interface PendingApprovalRecord {
  approvalId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  requestJson: string;
  channelId: NonEmpty;
  dispatchedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

// ─── §12.3.28b PendingApprovalStore Interface (DEF-007) ───
// Moved from core to contracts so API can import via DI pattern (§23.1).
export interface PendingApprovalStore {
  create(approval: {
    approvalId: Uuid;
    actionId: Uuid;
    templateId: Uuid;
    requestJson: string;
    channelId: string;
    dispatchedAt: IsoTimestamp;
    expiresAt: IsoTimestamp;
  }): Promise<void>;
  getStatus(approvalId: Uuid): Promise<{ status: string; responseJson: string | null } | null>;
  getRequest(approvalId: Uuid): Promise<string | null>;
  resolve(approvalId: Uuid, status: 'approved' | 'denied', responseJson: string): Promise<void>;
  markTimedOut(approvalId: Uuid): Promise<void>;
  listPending(): Promise<
    Array<{ approvalId: string; channelId: string; expiresAt: string; requestJson: string }>
  >;
}

// ─── §12.3.29 DelegationStore Interface ───
export interface DelegationStore {
  getById(delegationId: Uuid): Promise<DelegationContext | null>;
  save(dc: DelegationContext): Promise<void>;
  listForActor(actorId: Uuid): Promise<DelegationContext[]>;
}

// ─── §12.3.30 Registry Interfaces ───
export interface ActorRegistry {
  get(actorId: Uuid): Promise<Actor | null>;
  register(actor: Actor): Promise<void>;
  updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void>;
  list(): Promise<Actor[]>;
}

export interface PrincipalRegistry {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<void>;
}

export interface Approver {
  approverId: NonEmpty;
  displayName: NonEmpty;
  publicKey: Base64Url;
  channels: NonEmpty[];
  registeredAt: IsoTimestamp;
}
export interface ApproverRegistry {
  getPublicKey(approverId: NonEmpty): Promise<Base64Url | null>;
  register(actorId: Uuid, publicKey: Base64Url, channels: string[]): Promise<void>;
}

export interface ConnectorRegistry {
  get(systemType: NonEmpty): Connector | undefined;
  register(connector: Connector): void;
}

export interface ChannelRegistry {
  get(channelId: NonEmpty): ApprovalChannel | undefined;
  register(channel: ApprovalChannel): void;
}

// ─── §20.4 SessionStore Interface ───
export interface SessionStoreInterface {
  get(sessionId: Uuid): Promise<Session | null>;
  create(session: Session): Promise<void>;
  invalidate(sessionId: Uuid): Promise<void>;
}

// ─── §12.3.31 RunOptions and IngestEntry ───
export interface RunOptions {
  scenario?: ScenarioId;
  fixturesAll?: boolean;
  outDir?: string;
}

export interface IngestEntry {
  actionId: Uuid;
  receivedAt: IsoTimestamp;
  protocol: NonEmpty;
  actorId: Uuid;
  tool: NonEmpty;
  rawVerb: NonEmpty;
  rawTarget: NonEmpty;
  ingressResult: 'ok' | 'replay' | 'rate_limited' | 'injection_truncated';
  scenarioId: string;
}

// ─── §12.3.32 TokenPostureReport ───
export interface TokenPostureReport {
  generatedAt: IsoTimestamp;
  runId: string;
  actors: ActorPosture[];
  grantPatterns: GrantPatternSummary[];
  violations: PostureViolation[];
}

export interface ActorPosture {
  actorId: Uuid;
  actorClass: ActorClass;
  owner: string | null;
  environment: EnvironmentId;
  grantCount: number;
  maxRiskSeen: RiskTier;
  hasOwner: boolean;
}

export interface GrantPatternSummary {
  capabilityId: string;
  count: number;
  expiryClasses: ExpiryClass[];
  externalFacing: boolean;
  approvalRequired: boolean;
}

export interface PostureViolation {
  type: 'unowned_non_human_actor' | 'broad_scope_detected' | 'missing_review_cadence';
  detail: string;
  actorId: Uuid;
}

// ─── §12.3.33 CompileConfig ───
export interface CompileConfig {
  preferFrontierSynthesis: boolean;
}

// ─── §12.3.34 CrossLinkValidationResult ───
export interface CrossLinkValidationResult {
  ok: boolean;
  errors: string[];
}

// ─── §12.3.35 ChainVerificationResult ───
export interface ChainVerificationResult {
  ok: boolean;
  checkedFrom: number;
  checkedTo: number;
  recordCount: number;
  errors: ChainError[];
}

export interface ChainError {
  seq: number;
  type: 'hash_chain_break' | 'signature_invalid' | 'sequence_anomaly';
  denialCode: DenialCode;
  detail: string;
}

// ─── §12.3.36 Error Classes ───
export class ApprovalDecisionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// ─── §15 Error Classes ───
export class NexusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NexusError';
  }
}
export class DelegationError extends NexusError {
  constructor(message: string) {
    super(message);
  }
}

export class DelegationChainIntegrityError extends NexusError {
  constructor(missingId: Uuid) {
    super(`Delegation chain broken: parent ${missingId} not found in store`);
  }
}

// ─── §10.2 Identity Provider Interface ───
export interface IdentityClaims {
  principalIdentity: NonEmpty;
  roleAssignments: NonEmpty[];
  capabilityCeilings: CapabilityCeiling[];
  environmentContext: EnvironmentId;
  actorClass: ActorClass;
}

export interface CapabilityCeiling {
  allowedSystems: string[];
  allowedCapabilities: string[];
  maxRiskTier: RiskTier;
}

export interface AuthCredentials {
  type: 'api_key' | 'jwt' | 'oauth_token';
  value: NonEmpty;
}

export interface IdentityProviderInterface {
  readonly providerType: 'enterprise_iam' | 'enterprise_rbac' | 'reference_adapter';
  readonly providerVersion: NonEmpty;
  resolveIdentity(actorIdentifier: NonEmpty): Promise<IdentityClaims | null>;
  authenticate(credentials: AuthCredentials): Promise<NonEmpty>;
}

// ─── §11.2 OCT Ceilings ───
export interface DelegationCeilingDescriptor {
  maxChainDepth: number;
  maxRiskTier: RiskTier | EvidenceSentinel;
}

export interface OctCeiling {
  dataClassCeiling: DataClass[];
  modelTierCeiling: ModelTier[];
  actionRiskCeiling: RiskTier | EvidenceSentinel;
  allowedSystems: string[];
  allowedCapabilities: string[];
  delegationCeiling: DelegationCeilingDescriptor;
}

export interface EffectiveCeiling {
  maxRiskTier: RiskTier;
  allowedSystems: string[];
  allowedCapabilities: string[];
  modelTierCeiling: ModelTier[];
}

// ─── §9.2 ModeConfiguration ───
export interface ModeConfiguration {
  nxsMode: OperatingMode;
  nvgMode: OperatingMode;
  enforcingLocked: boolean;
  updatedAt: IsoTimestamp;
  updatedBy: { adminId: NonEmpty; publicKey: Base64Url };
  signature: Base64Url;
}

// ─── §30 RunLedger types ───
export type RunEventType =
  | 'run_opened'
  | 'orchestrator_dispatched'
  | 'delegation_issued'
  | 'nvg_outbound'
  | 'nvg_inbound'
  | 'nvg_denied'
  | 'nxs_action'
  | 'partial_result'
  | 'compile_started'
  | 'compile_mode_selected'
  | 'final_response'
  | 'run_closed'
  | 'oct_assignment'
  | 'mode_change'
  | 'enforcing_lock_disabled'
  | 'bypass_annotation'
  | 'mailbox_item_status_changed'
  // ── Compile-Ref Run Ledger Events (AMEND-spec-nexus-compile §11.1) ──────
  | 'template_ingested'
  | 'compile_template_loaded'
  | 'compile_slot_matched'
  | 'compile_slot_missing'
  | 'compile_guard_fired'
  | 'compile_guard_halt'
  | 'compile_assembly_complete'
  // ── Orch-Ref Run Ledger Events (AMEND-spec-nexus-orch §4.6) ──────
  | 'plan_created'
  | 'plan_checkback_sent'
  | 'plan_confirmed'
  | 'plan_rejected'
  | 'node_dispatched'
  | 'node_completed'
  | 'node_failed'
  | 'node_skipped'
  | 'node_timed_out'
  | 'dependency_resolved'
  | 'condition_evaluated'
  | 'plan_amended'
  | 'dag_completed'
  | 'dag_partial_complete'
  | 'dag_failed'
  | 'compile_triggered'
  | 'compile_skipped'
  | 'run_cancelled';

export interface RunLedgerEntry {
  entryId: Uuid;
  runId: Uuid;
  eventType: RunEventType;
  timestamp: IsoTimestamp;
  actorId: Uuid | null;
  detail: Record<string, unknown>;
}

export interface RunLedgerWriter {
  writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void>;
  getByRunId(runId: Uuid): Promise<RunLedgerEntry[]>;
  tail(n: number): Promise<RunLedgerEntry[]>;
  getLatestRunId(): Promise<Uuid | null>;
}

export class NexusSecurityViolation extends NexusError {
  public readonly denialCode: DenialCode;
  constructor(denialCode: DenialCode, message: string) {
    super(message);
    this.denialCode = denialCode;
  }
}

export class PolicySignatureError extends NexusError {
  constructor(message: string) {
    super(message);
    this.name = 'PolicySignatureError';
  }
}

export class ChainErrorClass extends NexusError {
  public readonly denialCode: DenialCode;
  constructor(message: string, denialCode: DenialCode) {
    super(message);
    this.name = 'ChainError';
    this.denialCode = denialCode;
  }
}

// ─── Classification sub-component interfaces (§13.3) ───
export interface VerbNormalizer {
  normalize(rawVerb: string): ActionVerb | null;
}

export interface TargetNormalizer {
  normalize(
    rawTarget: string,
    tool: string,
    actorEnvironment: EnvironmentId
  ): ResourceTarget | null;
}

export interface DataClassifier {
  classify(intent: IntentContext, target: ResourceTarget, verb: ActionVerb): DataClass[];
}

// ─── §24-§27 NVG Shared Interfaces ───

export interface DataLabel {
  source: NonEmpty;
  label: DataClass;
  confidence: number;
}

export interface NvgOutboundRequest {
  requestId: Uuid;
  runId: Uuid;
  actorId: Uuid;
  octLevel: OctLevel;
  environmentContext: EnvironmentId;
  taskIntent: NonEmpty;
  payload: unknown;
  dataLabels: DataLabel[];
  costPreference: 'low' | 'standard' | 'high';
  latencyPreference: 'low' | 'standard' | 'high';
}

export interface NvgClassificationResult {
  effectiveDataClass: DataClass;
  isSensitive: boolean;
  labels: DataLabel[];
  classifiedAt: IsoTimestamp;
}

export interface NvgCeilingResult {
  allowed: boolean;
  denialCode?: DenialCode;
  reason?: string;
}

export interface NvgRoutingDecision {
  matched: boolean;
  ruleId: NonEmpty | null;
  routeTo: ModelTier | null;
  fallbackTier: ModelTier | null;
}

export interface NvgRoutingPolicy {
  version: NonEmpty;
  policyId: Uuid;
  issuer: NonEmpty;
  issuedAt: IsoTimestamp;
  signature: Base64Url;
  defaultAction: 'deny';
  rules: NvgRoutingRule[];
}

export interface NvgRoutingRule {
  ruleId: NonEmpty;
  priority: number;
  conditions: {
    dataClasses?: DataClass[];
    octLevels?: OctLevel[];
    taskTypes?: string[];
    costCeiling?: number;
  };
  routeTo: ModelTier;
  fallbackTier?: ModelTier;
}

export interface ModelEndpoint {
  endpointId: NonEmpty;
  tier: NonEmpty;
  url: NonEmpty;
  /** §12.3.37 — which transport adapter wire-format family */
  adapterId: NonEmpty;
  /** Provider-side model identifier */
  modelName: NonEmpty;
  /** §12.3.38 — governed auth shape (discriminated by kind) */
  auth: ModelEndpointAuth;
  /** Per-endpoint timeout override in ms; default 30_000 */
  timeoutMs?: number;
  /** Per-adapter config, schema-validated at manifest load (§26.5 Step 6.5) */
  adapterConfig?: Record<string, unknown>;
  healthy: boolean;
  lastCheckAt: IsoTimestamp;
}

export interface ModelEndpointResponse {
  success: boolean;
  denialCode?: DenialCode;
  reason?: string;
  responseSize?: number;
  latencyMs?: number;
  /** Opaque parsed provider response body — never inspected downstream (§13.7.1) */
  opaqueProviderResponse?: unknown;
  /** Provider-returned model identifier, version, or alias (§22.1) */
  providerModelNameReturned?: NonEmpty;
}

export interface NvgInvocationResult {
  success: boolean;
  fallbackApplied: boolean;
  fallbackFromTier: ModelTier | null;
  endpointUsed: ModelEndpoint | null;
  denialCode?: DenialCode;
  reason?: string;
  responseSize?: number;
  latencyMs?: number;
  /** All same-tier + cross-tier failed attempts before final result (§12.3.44) */
  priorAttempts?: InvocationAttempt[];
  /** Opaque parsed provider response body — carried, never inspected (§13.7.1) */
  opaqueProviderResponse?: unknown;
  /** Provider-returned model identifier (§22.1) */
  providerModelNameReturned?: NonEmpty;
}

export interface RoutingProvenanceTrailEntry {
  entryId: Uuid;
  runId: Uuid;
  correlationId: Uuid;
  direction: 'outbound' | 'inbound';
  actorId: Uuid;
  octLevel: OctLevel;
  dataClassification: DataClass;
  routingPolicyVersion: NonEmpty;
  modelTierSelected: ModelTier | null;
  modelTierInvoked: ModelTier | null;
  /** Endpoint identity at event time (§22.1 — recorded at event time, not by mutable lookup) */
  endpointId: NonEmpty | null;
  /** Adapter wire-format family used */
  adapterId: NonEmpty | null;
  /** Provider-side model name from manifest */
  modelName: NonEmpty | null;
  /** Provider-returned model identifier, version, or alias */
  providerModelNameReturned: NonEmpty | null;
  denialCode: DenialCode | null;
  denialReason: string | null;
  fallbackApplied: boolean;
  fallbackFromTier: ModelTier | null;
  costMetrics: {
    requestCost: number | null;
    responseCost: number | null;
  };
  latencyMs: number;
  responseSize: number | null;
  timestamp: IsoTimestamp;
}

export interface RoutingTrailWriter {
  append(entry: RoutingProvenanceTrailEntry): Promise<void>;
}

export interface RoutingTrailReader {
  getByRunId(runId: Uuid): Promise<RoutingProvenanceTrailEntry[]>;
  getByCorrelationId(correlationId: Uuid): Promise<RoutingProvenanceTrailEntry[]>;
  tail(n: number): Promise<RoutingProvenanceTrailEntry[]>;
}

// ─── §22.1/§23.2 NvgService — DI contract for CLI/API NVG dispatch ───
// HOLE-S7-001 solve: Layer 2 interface for NVG surfaces.
// Implemented in vanguard (Layer 3). Injected by bootstrap into CLI/API.
export interface NvgService {
  classify(labels: DataLabel[]): NvgClassificationResult;
  enforceOctCeiling(
    octLevel: OctLevel,
    requestedTier: ModelTier,
    classification: NvgClassificationResult
  ): NvgCeilingResult;
  route(
    policy: NvgRoutingPolicy,
    request: NvgOutboundRequest,
    classification: NvgClassificationResult
  ): NvgRoutingDecision;
  validatePolicy(policy: NvgRoutingPolicy): void;
  /** §7.5 composition surface — full NVG wall: classify → route → ceiling → invoke → RPT */
  classifyAndRoute(request: NvgOutboundRequest): Promise<NvgClassifyAndRouteResult>;
}

// ─── §7.5 NvgClassifyAndRouteResult — composition surface return type ───
export interface NvgClassifyAndRouteResult {
  /** Whether the wall allowed this request through to model invocation */
  allowed: boolean;
  /** Data classification result — always present */
  classification: NvgClassificationResult;
  /** Model tier selected by routing policy (null if denied before routing) */
  modelTierSelected: ModelTier | null;
  /** Model tier actually invoked — may differ if fallback applied (null if denied/non-enforcing) */
  modelTierInvoked: ModelTier | null;
  /** Denial code if denied at any step */
  denialCode: DenialCode | null;
  /** Human-readable denial reason */
  denialReason: string | null;
  /** Trail correlation ID for cross-linking outbound/inbound RPT entries */
  trailCorrelationId: Uuid;
  /** Runtime disposition from mode config */
  disposition: RuntimeDisposition;
  /** Model invocation result (null if denied or non-enforcing mode) */
  invocation: NvgInvocationResult | null;
  // T6-F04 / RULING-001: explicit metadata when NVG mode is observe/advisory.
  // Classification and routing are evaluated but model is NOT invoked.
  nonEnforcingDisposition?: 'routed_not_invoked';
  /** Completion timestamp */
  completedAt: IsoTimestamp;
}

// ─── §19 Adapter Interface ───
export interface Adapter {
  readonly adapterProtocol: NonEmpty;
  readonly adapterVersion: NonEmpty;
  normalize(rawRequest: unknown): Promise<NormalizationResult>;
}

export interface NormalizationResult {
  ok: boolean;
  action?: AgentAction;
  error?: NonEmpty;
}

// ─── §28.1 Post-Inference Action Normalizer — NVG→NXS boundary plug point ───
// Pure normalization. Zero governance decisions. Any governance decision inside
// the normalizer is a build violation (blueprint §15.1, spec §28.1).
// External implementations provide this; Nexus defines the contract.
// The lexical-normalizer.ts is a subordinate helper, not the normalizer itself (§28.2).

/** Context carried from the governed workspace/orchestrator through NVG to the normalizer. */
export interface NormalizerContext {
  runId: Uuid;
  actorId: Uuid;
  principalId: Uuid;
  sessionId: Uuid;
  delegationId: Uuid;
  protocol: NonEmpty;
}

/**
 * Post-Inference Action Normalizer — converts model output to AgentAction format.
 * Sits at the NVG→NXS boundary. Makes zero governance decisions.
 * Produces a consistent AgentAction entering NXS regardless of model source.
 * External implementations register via bootstrap DI — Nexus never owns the implementation.
 */
export interface PostInferenceNormalizer {
  normalize(modelOutput: unknown, context: NormalizerContext): AgentAction;
}

// ─── §9.1 Runtime Disposition (MODE-001) ───
// Mode controls whether evaluated decisions are acted upon — not whether they are recorded.
// Callers of pipeline.process() use disposition to determine their response behavior.
export type RuntimeDisposition = 'enforce' | 'observe' | 'advisory';

// ─── §9.1 PipelineResult (MODE-001) ───
// Pipeline always returns the evidence record (written to ledger in every mode).
// Disposition tells the caller what to do with the result.
export interface PipelineResult {
  evidenceRecord: EvidenceRecord;
  disposition: RuntimeDisposition;
  // T4-F02 / RULING-001: explicit metadata when mode is observe/advisory.
  // Gates 01-04 evaluate identically. Gates 05/06 are skipped (not executed).
  // Gate 07 always runs. These fields tell the caller exactly what happened.
  nonEnforcingDisposition?: 'evaluated_not_executed';
  modeSkippedGates?: string[];
}

// ─── §12.3.38 PipelineInterface (DEF-001) ───
// Pure interface for the pipeline entry point. Adapters import this from
// contracts instead of the Pipeline class from core. Core Pipeline class
// implements this interface.
export interface PipelineInterface {
  process(
    rawAction: Omit<AgentAction, 'delegationSequence'>,
    context: PipelineContext
  ): Promise<PipelineResult>;
}

// ─── NISP-001.A Transport Layer Re-exports (§12.3.37–§12.3.51) ───
export type { AdapterConfigSchema } from './adapter-config-schema.js';
export type { ModelEndpointAuth } from './model-endpoint-auth.js';
export type { SecretSource } from './secret-source.js';
export type { ModelTransportAdapterId, ModelTransportAdapter } from './transport-adapter.js';
export type { SignedManifest } from './signed-manifest.js';
export type { InvocationAttempt } from './invocation-attempt.js';
export type {
  ModelTransportAdapterRegistry,
  NvgTransportContext,
  IdentityProviderFactoryRegistry,
  ConnectorFactoryRegistry,
  ApprovalChannelFactoryRegistry,
} from './transport-registries.js';
export type { IdentityProviderFactory } from './identity-provider-factory.js';
export type { ConnectorFactory } from './connector-factory.js';
export type { ApprovalChannelFactory } from './approval-channel-factory.js';
