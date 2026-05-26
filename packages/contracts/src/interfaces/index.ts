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
// F4.15 / HL #15 — the user-side ceiling fed into the three-way
// intersection at delegation mint. Fields are optional in the contract
// for backward compatibility with persisted principals registered
// before F4.15; runtime construction of IdentityClaimsCapabilityCeiling
// (in scripts/nexus-main.ts) supplies them. Production principals
// SHOULD carry every field — RBAC populates the full envelope per
// outline §3 B (target systems + capabilities + firewall transit
// rights + permitted run types + OCT classification + capability
// ceiling + risk tier).
export interface Principal {
  principalId: Uuid;
  displayName: NonEmpty;
  email: NonEmpty;
  registeredAt: IsoTimestamp;
  maxDelegableRiskTier: RiskTier;
  allowedSystems: string[];
  /** F4.15 §2.1 — user-side capability ceiling (intersected at mint). */
  permittedCapabilities?: ReadonlyArray<NonEmpty>;
  /** F4.15 §2.1 — user-side firewall transit rights. */
  firewallTransitRights?: FirewallTransitMap;
  /** F4.15 §2.1 — user-side permitted run-type set. */
  permittedRunTypes?: ReadonlyArray<RunTypeKind>;
  /** F4.15 §2.1 — user-side OCT classification ceiling. */
  octLevel?: OctLevel;
}

// ─── §12.3.2 Actor ───
// ORCH-WIRE-001: allowedCapabilities + enabled — governed agent profile [§20.2].
// HOLE-A02: roles are part of the governed Actor record so the identity
// adapter can no longer hardcode admin for everyone. The identity provider
// maps `actor.roles ?? []` onto IdentityClaims.roleAssignments. Admin gating
// (`hasAdminRole()`) reads from those claims, so dropping a role here is the
// only way to grant admin — there is no longer an out-of-band master path.
export interface Actor {
  actorId: Uuid;
  actorClass: ActorClass;
  principalId: Uuid;
  displayName: NonEmpty;
  environment: EnvironmentId;
  octLevel: OctLevel | null;
  riskCeiling: RiskTier;
  allowedSystems: string[];
  allowedCapabilities?: string[];
  roles?: NonEmpty[];
  enabled?: boolean;
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
  /**
   * Scope this rule to specific target systems (connector systemType
   * values). When absent, the rule matches any target. When set, the
   * rule matches ONLY when `action.resolvedTarget.system` is one of
   * the listed systems. This is the field that makes per-connector
   * policy bundles work — a marketplace vendor's `connector-x.policy.json`
   * scopes its allow rules to `connector-x.systemType` only, so it
   * cannot inadvertently widen permission across unrelated connectors.
   * Backward compatible — pre-existing rules without targetSystems
   * keep their "any target" semantics.
   */
  targetSystems?: string[];
  /**
   * F4.2 §2.1 — OCT axis. MANDATORY in V1. The author MUST state which
   * OCT levels the rule applies to. To cover every level the author lists
   * them explicitly (e.g., ['OCT-OPEN','OCT-CONFIDENTIAL','OCT-SECURE']);
   * an empty array means the rule matches no actor at all (default-secure).
   * Hard Law #5 / #13 — explicit list required so a missing field cannot
   * silently match every actor.
   */
  octLevels: readonly OctLevel[];
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
  /**
   * Composer-attached, NOT authored. The bundle composer sets this on
   * each rule after loading so audit (Gate 04 decisions, run-ledger
   * partial_result events) can trace back to the source bundle.
   * Authored policy JSON files leave this field absent — the loader
   * fills it in. Required for marketplace-style multi-bundle setups
   * where two bundles may share a ruleId; bundleRef.bundleId
   * disambiguates.
   */
  bundleRef?: { bundleId: Uuid; bundleVersion: NonEmpty };
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
  runId: Uuid; // [OD-WS-002] — from AgentAction.runId
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
  /**
   * Authoritative data class served by this connector instance. Read by NVG
   * dispatch to floor the effective data class of any outbound model call
   * whose agent can reach this connector. Per-instance, not per-type:
   * postgres-warehouse and postgres-financial-prod use the same factory but
   * declare different classes.
   */
  readonly dataClass: DataClass;
  supportedCapabilities(): string[];
  canProduceDiff(): boolean;
  produceDiff?(action: AgentAction, template: ExecutionGrantTemplate): Promise<string | null>;
  execute(action: AgentAction, grant: ExecutionGrant, vault: GrantVault): Promise<ExecutionResult>;
  redeemGrant(grant: ExecutionGrant, vault: GrantVault): Promise<void>;
  /**
   * Provider-neutral tool descriptors that the orchestrator can attach
   * to NVG outbound payloads so the LLM knows which governed tools are
   * reachable through this connector. The composition root resolves an
   * agent's `allowedCapabilities` against this list to decide which
   * tools the model gets to see on a given turn — capabilities the
   * agent doesn't have are filtered out before the schema reaches the
   * provider. Returns an empty array for connectors that don't expose
   * tools (e.g. stub).
   */
  describeToolSchemas(): readonly ToolSchemaDescriptor[];
}

// ─── Tool-schema bridge (Phase C buildToolDefinitions) ───
// Provider-neutral descriptors. Per-provider translators map these onto
// OpenAI's `function.parameters`, Anthropic's `input_schema`, and
// Ollama's `function.parameters` — all three accept draft-07-compatible
// JSON-Schema shapes for tool input.
//
// Audit boundary: what we tell the LLM it can call is governance-
// relevant. Every NVG turn that ships a tools[] array fires a
// `tool_schemas_attached` run-ledger event (see RunEventType below)
// so replay can verify the exact tool surface presented to the model
// at any point in a run.

export type ToolInputType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface ToolInputProperty {
  readonly type: ToolInputType;
  readonly description?: string;
  /** For 'array' types: schema of items. */
  readonly items?: ToolInputProperty;
  /** Enum constraint — Phase 1 covers string-valued enums (e.g. SQL
   *  table names from the connector's allowedTables). */
  readonly enum?: readonly string[];
}

export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolInputProperty>>;
  readonly required: readonly string[];
}

export interface ToolSchemaDescriptor {
  /**
   * Tool name as the model will see it. Convention: `<verb>_<target>`
   * so the post-inference normalizer (§28.1) recovers the canonical
   * verb + target on the way back without re-parsing.
   */
  readonly name: NonEmpty;
  /** Operator-authored description shown to the model. */
  readonly description: NonEmpty;
  /** The capability this tool exercises — Gate 02 / Gate 03 enforce. */
  readonly capability: NonEmpty;
  /** Resolved target this tool acts on. */
  readonly target: {
    readonly system: NonEmpty;
    readonly resourceType: NonEmpty;
    readonly resourceScope: NonEmpty;
  };
  /** JSON-schema-shaped tool input. */
  readonly inputSchema: ToolInputSchema;
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
  getByClass(actorClass: ActorClass): Promise<Actor[]>;
  register(actor: Actor): Promise<void>;
  updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void>;
  list(): Promise<Actor[]>;
  /** Update a registered actor in-place. Throws if actorId not found. */
  update(actorId: Uuid, actor: Actor): Promise<void>;
  /** Hard-delete an actor from the registry. Throws if actorId not found. */
  delete(actorId: Uuid): Promise<void>;
}

export interface PrincipalRegistry {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<void>;
  /** Replace an existing principal record. Caller must `get` first.
   *  Used by bootstrap migrations to keep dev-admin's allowedSystems
   *  in sync with config drift across restarts. */
  update(principalId: Uuid, principal: Principal): Promise<void>;
  /** List all registered principals (admin/dashboard surfaces). */
  list(): Promise<Principal[]>;
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

// ─── F4.13 Admin Signed Mutation Envelopes — Hard Law #10 ─────────────────
// Every governance-relevant admin mutation requires a per-mutation
// Ed25519 admin signature; the route writes mandatory infra ledger
// events; the ledger writer being unavailable fails closed (503).
// Q13 InfraRunIdNamespace: daily bucket + monotonic seq (admin-side
// audit cross-correlation).
export type AdminMutationKind =
  | 'actor_register'
  | 'actor_deregister'
  | 'agent_config_update'
  | 'llm_config_update'
  | 'identity_provider_update'
  | 'connector_register'
  | 'connector_deregister'
  | 'secret_store'
  | 'secret_remove'
  | 'webhook_register'
  | 'webhook_deregister'
  | 'workspace_config_update'
  | 'orchestrator_config_update'
  | 'compile_config_update'
  | 'mailbox_config_update'
  | 'manifest_entry_add'
  | 'manifest_entry_update'
  | 'manifest_entry_remove'
  | 'policy_bundle_swap'
  | 'oct_assign'
  // ── Principal RBAC writes (HL #15 envelope intersection axis) ─────────────
  // Added 2026-05-23 (fix-spec post-consolidation §5) so the admin dashboard
  // can update user-persona allowedSystems / permittedCapabilities /
  // firewallTransitRights / permittedRunTypes / octLevel through the same
  // signed-mutation + audit-trail pipeline the rest of the writers use.
  // Required by the Mailpit corridor spec — adding `mailpit-local` to a
  // persona's allowedSystems is a principal_update, not a seed-script edit.
  | 'principal_register'
  | 'principal_update';

export interface SignedAdminMutation<TPayload> {
  readonly mutationKind: AdminMutationKind;
  readonly payload: TPayload;
  readonly opener: NonEmpty;
  readonly issuedAt: IsoTimestamp;
  readonly nonce: NonEmpty;
  readonly signature: Base64Url;
}

/** Q13 — daily-bucket + monotonic-sequence infrastructure run id. */
export interface InfraRunIdNamespace {
  next(date?: Date): NonEmpty; // returns 'infra-YYYY-MM-DD-NNNN'
}

// ─── F4.15 Delegation Mint — fail-closed, three-way symmetric intersection ─
// Hard Law #15: run effective permissions = (user current RBAC) ∩
// (agent declared per RBAC) ∩ (explicit delegation scope for this run).
// Lesser wins in every dimension. Any empty dimension → no mint;
// mint failure → no fabricated delegationId. The baked DelegationMintPort
// implementation owns the intersection arithmetic; orch consumers receive
// a DelegationMintResult discriminator and route per §3.3 of Spec F4.15.

/** Open-governed capability identifier (verb-scoped action name). */
export type Capability = NonEmpty;

/** Run-type identifier mirror of the workspace run types. */
export type RunTypeKind = 'chat' | 'sectioned' | 'secure_rails' | 'autonomous';

/**
 * Firewall transit rights per direction. NVG consumes these at outbound
 * + inbound payload checks (Hard Law #6).
 */
export interface FirewallTransitMap {
  readonly outbound: ReadonlyArray<NonEmpty>;
  readonly inbound: ReadonlyArray<NonEmpty>;
}

/** Identifies which dimension caused an empty intersection. */
export type IntersectionDimension =
  | 'target_systems'
  | 'capabilities'
  | 'oct_level'
  | 'firewall_rights'
  | 'run_types'
  | 'risk_tier';

/**
 * User-side ceiling consumed by the delegation mint. Populated by RBAC at
 * run-open (alongside the carried identity claims envelope). The
 * `permittedCapabilities` field is mandatory — the Phase B session 1
 * comment "Principal has no allowedCapabilities" (P0-018 evidence) is
 * retired; capability scope MUST flow from RBAC into the mint, not
 * default to the agent side.
 */
export interface IdentityClaimsCapabilityCeiling {
  readonly principalId: Uuid;
  readonly permittedTargetSystems: ReadonlyArray<NonEmpty>;
  readonly permittedCapabilities: ReadonlyArray<Capability>;
  readonly firewallTransitRights: FirewallTransitMap;
  readonly permittedRunTypes: ReadonlyArray<RunTypeKind>;
  readonly octLevel: OctLevel;
  readonly maxRiskTier: RiskTier;
}

/**
 * Agent-side ceiling consumed by the delegation mint. Derived from the
 * agent's registered Actor record (octLevel + riskCeiling +
 * allowedSystems + allowedCapabilities) plus per-agent registration
 * metadata (firewall transit rights, permitted run types). The mint
 * intersects this with the user side and the explicit scope.
 */
export interface AgentDeclaration {
  readonly agentId: Uuid;
  readonly visibleTargetSystems: ReadonlyArray<NonEmpty>;
  readonly allowedCapabilities: ReadonlyArray<Capability>;
  readonly firewallTransitRights: FirewallTransitMap;
  readonly permittedRunTypes: ReadonlyArray<RunTypeKind>;
  readonly maxOctLevel: OctLevel;
  readonly maxRiskTier: RiskTier;
}

/**
 * Explicit per-run delegation scope authored by the planner / orch when
 * dispatching a node. The third leg of the three-way intersection.
 * Named ExplicitDelegationScope rather than DelegationScope because the
 * orch-ref package already exports a DelegationScope for plan routing
 * metadata (taskSummary / requiresNvg / requiresNxs / nodeType /
 * expectedOutputSlots); the two concepts are distinct and renaming the
 * orch-ref one would ripple through every plan emitter (preserved per
 * owner ratification 2026-05-20: no upstream/downstream rename).
 */
export interface ExplicitDelegationScope {
  readonly targetSystems: ReadonlyArray<NonEmpty>;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly firewallTransitRights: FirewallTransitMap;
  readonly runTypes: ReadonlyArray<RunTypeKind>;
  readonly maxOctLevel: OctLevel;
  readonly maxRiskTier: RiskTier;
  /** Hard expiry — the mint stamps this onto the SignedDelegation. */
  readonly expiresAt: IsoTimestamp;
}

/**
 * Run-effective permissions = three-way intersection. Returned on the
 * `kind: 'success'` branch of DelegationMintResult.
 */
export interface EffectiveDelegationScope {
  readonly targetSystems: ReadonlyArray<NonEmpty>;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly firewallTransitRights: FirewallTransitMap;
  readonly runTypes: ReadonlyArray<RunTypeKind>;
  readonly octLevel: OctLevel;
  readonly riskTier: RiskTier;
}

/** Reason codes for {@link DelegationMintResult} `mint_error`. */
export type MintErrorReason = 'signing_unavailable' | 'signature_failed' | 'persistence_failed';

/** Stable opaque error reference for support / audit cross-correlation. */
export type DelegationMintErrorRef = NonEmpty;

/**
 * Discriminated result of one mint attempt. The mint never returns a
 * fabricated delegationId — only the `success` branch carries one (on a
 * fully-signed DelegationContext envelope).
 */
export type DelegationMintResult =
  | {
      readonly kind: 'success';
      readonly delegation: DelegationContext;
      readonly effectiveScope: EffectiveDelegationScope;
    }
  | {
      readonly kind: 'empty_intersection';
      readonly dimension: IntersectionDimension;
      readonly userValues: ReadonlyArray<unknown>;
      readonly agentValues: ReadonlyArray<unknown>;
      readonly explicitValues: ReadonlyArray<unknown>;
    }
  | {
      readonly kind: 'mint_error';
      readonly reason: MintErrorReason;
      readonly errorRef: DelegationMintErrorRef;
      readonly detail: NonEmpty;
    };

export interface DelegationMintInput {
  readonly runId: Uuid;
  readonly nodeId?: NonEmpty;
  readonly userClaims: IdentityClaimsCapabilityCeiling;
  readonly agentDeclaration: AgentDeclaration;
  readonly explicitDelegatedScope: ExplicitDelegationScope;
  readonly issuedAt: IsoTimestamp;
  readonly maxChainDepth: number;
  /**
   * F-15 owner ruling 2026-05-22: for model-bound tasks (`kind:nvg`,
   * free_chat, synthesize-only, no connector/system action), the
   * symmetric `target_systems` intersection MUST NOT fail-closed on
   * empty — those runs are governed by workspace identity, OCT, NVG
   * routing/data policy, model tier ceiling, and run ledger, not by
   * connector-system membership. For NXS / system-action tasks the
   * intersection stays symmetric and an empty result is still a hard
   * empty_intersection denial.
   *
   * `true`  → enforce target_systems intersection (NXS path).
   * `false` → compute the intersection (still used for the signed
   *           delegation body) but allow empty without erroring.
   *
   * Other dimensions — capabilities, oct_level, firewall_rights,
   * run_types, risk_tier — remain symmetric in all cases. No
   * wildcards, no empty-set widening, no fail-open.
   */
  readonly requiresSystemAction: boolean;
}

/**
 * Baked port owning the three-way intersection arithmetic + signing.
 * Plug-in orch reference impls call this through dependency injection.
 * The port itself never decides governance — it executes the lesser-wins
 * rule and signs the resulting envelope.
 */
export interface DelegationMintPort {
  mint(input: DelegationMintInput): Promise<DelegationMintResult>;
}

// ─── F4.9 Claim Drift Verification — Hard Law #14 ──────────────────────────
// NXS Gate 01 resolves identity claims once; downstream gates must call
// ClaimVerificationPort.verify(carried, gateName) before evaluation. A
// drift result fails the gate closed and emits claim_drift_detected with
// the carried-vs-current diff. Mirrored at NVG classify-and-route and
// return-precheck.
export interface ClaimsDiff {
  readonly principalId: Uuid;
  readonly fieldsChanged: ReadonlyArray<string>;
  readonly carriedHash: Sha256Hex;
  readonly currentHash: Sha256Hex;
  readonly detectedAt: IsoTimestamp;
}

export type ClaimVerificationResult =
  | { readonly kind: 'match'; readonly currentClaimsHash: Sha256Hex }
  | { readonly kind: 'drift'; readonly currentClaimsHash: Sha256Hex; readonly diff: ClaimsDiff };

export interface ClaimVerificationPort {
  /**
   * Re-resolve current claims for the principal at this moment and compare
   * to the carried snapshot via canonical SHA-256 hash. Returns 'match' or
   * 'drift' with the diff (fieldsChanged enumerates the surface-level
   * fields whose canonical representation differs).
   */
  verify(
    carriedClaims: Record<string, unknown>,
    principalId: Uuid,
    gateName: NonEmpty
  ): Promise<ClaimVerificationResult>;
}

// ─── F4.8 Lexicon Mutation — discriminated union for SigningCouncil payload ─
// Each mutation is the payload of SigningRequest(operation='lexicon_mutation').
// The 2-of-2 distinct admin signature threshold (Q4) plus the baked
// LexiconMutationExecutor are the only legitimate apply paths.
export interface LexiconEntity {
  readonly entityId: NonEmpty;
  readonly displayName: NonEmpty;
  readonly entityType: NonEmpty;
  readonly disabled?: boolean;
  readonly notes?: string;
}
export interface LexiconEdge {
  readonly edgeId: NonEmpty;
  readonly sourceEntityId: NonEmpty;
  readonly targetEntityId: NonEmpty;
  readonly relation: NonEmpty;
  readonly weight?: number;
  readonly disabled?: boolean;
}
export interface WorkflowTemplate {
  readonly templateId: NonEmpty;
  readonly slots: ReadonlyArray<{ slotId: NonEmpty; required: boolean }>;
}
export interface LexiconGuard {
  readonly guardId: NonEmpty;
  readonly when: string;
  readonly then: string;
}

// ─── AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0 (fourth-layer types) ──
//
// Read-model contracts for the path-layer substrate added by the fourth
// lexicon layer. All authoritative mutation of these records flows through
// the existing `lexicon_mutation` SigningCouncil 2-of-2 dispatcher — runtime
// prompt channel MUST NOT mutate them. Runtime may only emit review signals
// and outcome projections (§2.1 of the AMEND).

export type LexiconPathKind =
  | 'lexical_term'
  | 'alias_rule'
  | 'task_intent'
  | 'task_capability'
  | 'target_catalog'
  | 'workflow_template'
  | 'workflow_node'
  | 'workflow_edge'
  | 'entity'
  | 'edge'
  | 'guard'
  | 'checkback_template';

export type LexiconPathPromotionStatus =
  | 'candidate'
  | 'confirmed'
  | 'contradicted'
  | 'deprecated'
  | 'blocked';

export interface LexiconPathProfile {
  readonly pathId: NonEmpty;
  readonly pathKind: LexiconPathKind;
  readonly sourceRef: NonEmpty;
  readonly arenaId: NonEmpty;
  /** 0..1 inclusive. */
  readonly confidenceScore: number;
  /** 0..1 inclusive. */
  readonly completenessScore: number;
  /** 0..1 inclusive. */
  readonly failureLikelihood: number;
  readonly promotionStatus: LexiconPathPromotionStatus;
  readonly coverageCategory?: NonEmpty;
  readonly notes?: string;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly mutationId: NonEmpty;
}

export type LexiconPathEvidenceKind =
  | 'owner_ruling'
  | 'blueprint_pin'
  | 'engineering_spec_pin'
  | 'outline_pin'
  | 'signed_fixture'
  | 'unit_test'
  | 'integration_test'
  | 'e2e_test'
  | 'run_outcome'
  | 'admin_mutation'
  | 'wordnet_seed'
  | 'manual_seed';

export interface LexiconPathEvidence {
  readonly evidenceId: NonEmpty;
  readonly pathId: NonEmpty;
  readonly evidenceKind: LexiconPathEvidenceKind;
  readonly sourceRef: NonEmpty;
  readonly sourceDigest: NonEmpty;
  /**
   * Records from the same `independenceGroup` MUST NOT be counted as
   * independent confirmations (§4.3 of the AMEND).
   */
  readonly independenceGroup: NonEmpty;
  /** -1..1 inclusive. */
  readonly confidenceDelta: number;
  /** Never contains raw secrets or full raw prompt text (§4.3). */
  readonly evidenceSummary: NonEmpty;
  readonly createdAt: IsoTimestamp;
  readonly mutationId: NonEmpty;
}

export type LexiconPathContradictionKind =
  | 'semantic_conflict'
  | 'capability_conflict'
  | 'target_conflict'
  | 'slot_contract_conflict'
  | 'governance_class_conflict'
  | 'stale_superseded_path'
  | 'test_failure_conflict';

export type LexiconPathContradictionSeverity = 'low' | 'medium' | 'high' | 'critical';

export type LexiconPathContradictionResolverStatus =
  | 'open'
  | 'accepted_a'
  | 'accepted_b'
  | 'both_deprecated'
  | 'owner_ruling_required';

export interface LexiconPathContradiction {
  readonly contradictionId: NonEmpty;
  readonly pathIdA: NonEmpty;
  readonly pathIdB: NonEmpty;
  readonly contradictionKind: LexiconPathContradictionKind;
  readonly severity: LexiconPathContradictionSeverity;
  readonly resolverStatus: LexiconPathContradictionResolverStatus;
  readonly summary: NonEmpty;
  readonly createdAt: IsoTimestamp;
  readonly resolvedAt?: IsoTimestamp;
  readonly mutationId: NonEmpty;
}

export type LexiconPathRequirementKind =
  | 'capability'
  | 'agent'
  | 'target_system'
  | 'connector'
  | 'model_tier_hint'
  | 'mailbox'
  | 'compile_template'
  | 'slot_read'
  | 'slot_write'
  | 'approval_channel'
  | 'admin_signature'
  | 'policy_bundle'
  | 'identity_claim'
  | 'environment';

export interface LexiconPathRequirement {
  readonly requirementId: NonEmpty;
  readonly pathId: NonEmpty;
  readonly requirementKind: LexiconPathRequirementKind;
  readonly requirementRef: NonEmpty;
  readonly required: boolean;
  readonly checkbackIfMissing: boolean;
  readonly failureCode?: NonEmpty;
  readonly createdAt: IsoTimestamp;
  readonly mutationId: NonEmpty;
}

export type LexiconPathOutcomeKind =
  | 'planned'
  | 'executed'
  | 'checkback_sent'
  | 'checkback_accepted'
  | 'checkback_cancelled'
  | 'rejected_unmappable'
  | 'rejected_no_capable_agent'
  | 'rejected_capability_outside_ceiling'
  | 'rejected_structural_constraint'
  | 'rejected_malformed'
  | 'node_failed'
  | 'node_timed_out'
  | 'dag_failed'
  | 'dag_partial_complete'
  | 'compile_skipped'
  | 'final_response_emitted';

/**
 * Run-outcome projection tying a real run/plan back to the planner path
 * that produced it. Per AMEND §4.6 this is a projection of the Run
 * Ledger, not a replacement — raw evidence stays in the existing ledgers.
 */
export interface LexiconPathOutcome {
  readonly outcomeId: NonEmpty;
  readonly pathId: NonEmpty;
  readonly runId: NonEmpty;
  readonly planId?: NonEmpty;
  readonly outcomeKind: LexiconPathOutcomeKind;
  readonly failureCode?: NonEmpty;
  readonly failureSummary?: NonEmpty;
  readonly runLedgerRef?: NonEmpty;
  readonly evidenceRecordRef?: NonEmpty;
  readonly createdAt: IsoTimestamp;
}

export type LexiconCheckbackKind =
  | 'ambiguous_intent'
  | 'missing_capability'
  | 'missing_agent'
  | 'missing_connector'
  | 'missing_target_system'
  | 'missing_slot'
  | 'missing_compile_template'
  | 'missing_mailbox'
  | 'approval_required'
  | 'admin_signature_required'
  | 'likely_run_failure'
  | 'unsupported_path';

export type LexiconCheckbackDefaultAction =
  | 'cancel'
  | 'accept_suggestion'
  | 'choose_option'
  | 'open_admin_setup'
  | 'request_owner_ruling';

export interface LexiconCheckbackTemplate {
  readonly templateId: NonEmpty;
  readonly checkbackKind: LexiconCheckbackKind;
  readonly promptTitle: NonEmpty;
  readonly operatorQuestion: NonEmpty;
  /** Stringified JSON; safe_options_json in the spec — typed at the reader. */
  readonly safeOptionsJson: NonEmpty;
  readonly defaultAction: LexiconCheckbackDefaultAction;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  readonly mutationId: NonEmpty;
}

export type PathFeasibilityOutcome =
  | 'executable'
  | 'typed_checkback'
  | 'unsupported_path'
  | 'blocked_path'
  | 'contradicted_path'
  | 'likely_failure';

export interface PathFeasibilityMissingRequirement {
  readonly requirementKind: LexiconPathRequirementKind;
  readonly requirementRef: NonEmpty;
  readonly failureCode: NonEmpty | null;
}

/**
 * Scoring result emitted by the fourth-layer scorer (package-local in
 * `@nexus/planner-db-lexicon`) for a single candidate path. The planner
 * uses this to decide between executable plan, typed checkback, or
 * lawful unsupported-path. Per AMEND §5.3.
 */
export interface PathFeasibilityResult {
  readonly pathId: NonEmpty;
  readonly outcome: PathFeasibilityOutcome;
  readonly confidenceScore: number;
  readonly completenessScore: number;
  readonly failureLikelihood: number;
  readonly missingRequirements: ReadonlyArray<PathFeasibilityMissingRequirement>;
  readonly openContradictions: ReadonlyArray<NonEmpty>;
  readonly checkbackTemplateId: NonEmpty | null;
  readonly evidenceRefs: ReadonlyArray<NonEmpty>;
}

export type LexiconMutation =
  | { readonly kind: 'entity_add'; readonly entity: LexiconEntity }
  | {
      readonly kind: 'entity_update';
      readonly entityId: NonEmpty;
      readonly patch: Partial<LexiconEntity>;
    }
  | { readonly kind: 'entity_disable'; readonly entityId: NonEmpty }
  | { readonly kind: 'edge_add'; readonly edge: LexiconEdge }
  | {
      readonly kind: 'edge_update';
      readonly edgeId: NonEmpty;
      readonly patch: Partial<LexiconEdge>;
    }
  | { readonly kind: 'edge_disable'; readonly edgeId: NonEmpty }
  | {
      readonly kind: 'confidence_set';
      readonly entityId: NonEmpty;
      readonly arena: NonEmpty;
      readonly score: number;
    }
  | { readonly kind: 'workflow_template_add'; readonly template: WorkflowTemplate }
  | {
      readonly kind: 'workflow_template_update';
      readonly templateId: NonEmpty;
      readonly patch: Partial<WorkflowTemplate>;
    }
  | { readonly kind: 'guard_add'; readonly guard: LexiconGuard }
  | {
      readonly kind: 'guard_update';
      readonly guardId: NonEmpty;
      readonly patch: Partial<LexiconGuard>;
    }
  // ── Fourth-layer mutation variants (AMEND §6.1) ────────────────────────
  | { readonly kind: 'path_profile_add'; readonly profile: LexiconPathProfile }
  | {
      readonly kind: 'path_profile_update';
      readonly pathId: NonEmpty;
      readonly patch: Partial<LexiconPathProfile>;
    }
  | { readonly kind: 'path_profile_disable'; readonly pathId: NonEmpty }
  | { readonly kind: 'path_evidence_add'; readonly evidence: LexiconPathEvidence }
  | {
      readonly kind: 'path_contradiction_add';
      readonly contradiction: LexiconPathContradiction;
    }
  | {
      readonly kind: 'path_contradiction_resolve';
      readonly contradictionId: NonEmpty;
      readonly resolverStatus: LexiconPathContradictionResolverStatus;
    }
  | {
      readonly kind: 'path_requirement_add';
      readonly requirement: LexiconPathRequirement;
    }
  | {
      readonly kind: 'path_requirement_update';
      readonly requirementId: NonEmpty;
      readonly patch: Partial<LexiconPathRequirement>;
    }
  | {
      readonly kind: 'checkback_template_add';
      readonly template: LexiconCheckbackTemplate;
    }
  | {
      readonly kind: 'checkback_template_update';
      readonly templateId: NonEmpty;
      readonly patch: Partial<LexiconCheckbackTemplate>;
    };

export interface LexiconMutationResult {
  readonly mutationId: NonEmpty;
  readonly appliedAt: IsoTimestamp;
  readonly jsonlFile: NonEmpty;
  readonly jsonlSeqNo: number;
}

export interface LexiconMutationExecutor {
  apply(
    mutation: LexiconMutation,
    signers: ReadonlyArray<NonEmpty>
  ): Promise<LexiconMutationResult>;
}

// ─── F4.5 OCT Manager — signed OCT assignment surface ──────────────────────
// Plug-in admin-writer routes call into the baked OctManagerPort. The port
// itself is implemented in @nexus/core (oct-manager.ts) and registered with
// the API server via ApiDependencies.octManager.
export interface SignedOctAssignmentRequest {
  action: 'oct_assignment' | 'oct_change';
  actorId: Uuid;
  previousOctLevel: OctLevel | null;
  newOctLevel: OctLevel;
  operatorId: NonEmpty;
  requestedAt: IsoTimestamp;
  reason: NonEmpty;
  signature: Base64Url;
}

// ─── F4.1 SigningCouncil — federated operation aggregation ────────────────
// All governance-significant mutations (mode_unlock, policy_bundle_replace,
// signing_council_change, lexicon_mutation) flow through this council.
// Each operation requires 2 distinct registered admin signatures (Q4).
//
// A SigningRequest is the open envelope; admins add signatures one by one
// until the threshold is met, at which point the council dispatches to the
// operation-specific executor. Payloads are immutable after open — any
// edit forces a new requestId.

export interface SigningCouncilSignature {
  readonly principalId: NonEmpty;
  readonly signature: Base64Url;
  readonly signedAt: IsoTimestamp;
}

export interface SigningRequest {
  readonly requestId: NonEmpty;
  readonly operation: FederatedOperationName;
  readonly payload: Record<string, unknown>;
  readonly payloadDigest: Sha256Hex;
  readonly openedAt: IsoTimestamp;
  readonly openedBy: NonEmpty;
  readonly expiresAt: IsoTimestamp;
  readonly signatures: ReadonlyArray<SigningCouncilSignature>;
  readonly status: SigningRequestStatusName;
  readonly dispatchedAt?: IsoTimestamp;
  readonly denialReason?: NonEmpty;
}

/** Operation-name string mirror of FederatedOperation (see constants). */
export type FederatedOperationName =
  | 'mode_unlock'
  | 'policy_bundle_replace'
  | 'signing_council_change'
  | 'lexicon_mutation';

export type SigningRequestStatusName = 'pending' | 'executed' | 'denied' | 'expired';

/**
 * Operation-specific dispatcher. Called once the threshold of distinct
 * admin signatures is met. Throws on failure; the council marks the
 * request as denied and writes federated_operation_dispatch_failed.
 */
export interface SigningCouncilDispatcher {
  (request: SigningRequest): Promise<void>;
}

export interface SigningCouncilPort {
  open(input: {
    operation: FederatedOperationName;
    payload: Record<string, unknown>;
    openedBy: NonEmpty;
    expiresInSeconds?: number;
  }): Promise<SigningRequest>;
  sign(requestId: NonEmpty, principalId: NonEmpty, signature: Base64Url): Promise<SigningRequest>;
  get(requestId: NonEmpty): Promise<SigningRequest | null>;
  list(filter?: {
    status?: SigningRequestStatusName;
    operation?: FederatedOperationName;
  }): Promise<readonly SigningRequest[]>;
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
  // ── DB Lexicon Planner — explainability trace
  // (AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.6, log
  //  ADD-PLANNER-LEXICON-001). Coordinator-written via the
  //  PlannerTraceReader interface after each Planner.plan() call.
  //  Detail shape: PlannerPlanTrace (planner.ts). Fires once per plan
  //  attempt (success OR rejection). Carries promptDigest only — never
  //  raw prompt text.
  | 'planner_plan_trace'
  | 'plan_checkback_sent'
  | 'plan_checkback_required'
  | 'plan_checkback_resolved'
  | 'plan_confirmed'
  // ── HL#4 revision (component outline §HL #4, Owner-Ratified 2026-05-23) ─
  // `planner_infeasible` is the canonical orchestration-infeasibility event
  // the run coordinator emits when the planner cannot produce a valid plan.
  // Orch has zero governance authority, so a planner-side infeasibility is
  // not a governance-deny; it is an orchestration callback signal. The
  // legacy alias `plan_rejected` was removed 2026-05-23 (fix-spec post-
  // consolidation) — historical ledger files that still contain it are
  // handled by the default/unknown-event fallback path in the UI stage
  // reducer; new code MUST use `planner_infeasible`.
  | 'planner_infeasible'
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
  // `dag_step_error` is the canonical name under HL#4 revision; emitted by
  // the run coordinator when DAG execution surfaces a step-level error.
  // The legacy alias `dag_failed` was removed 2026-05-23 (fix-spec post-
  // consolidation); historical ledger files fall through the UI reducer's
  // unknown-event path.
  | 'dag_step_error'
  | 'compile_triggered'
  // `compile_not_applicable` is the canonical name under HL#4 revision —
  // compile is "not applicable" (pass-through path of HL#11) rather than
  // "skipped" (a status word that implied a skip-as-failure). The legacy
  // alias `compile_skipped` was removed 2026-05-23 (fix-spec post-
  // consolidation); historical ledger files fall through the UI reducer's
  // unknown-event path.
  | 'compile_not_applicable'
  // ── Workspace-Ref Run Ledger Events (AMEND-nexus-spec-workspace §8.1) ──────
  | 'workspace_vault_session_opened'
  | 'workspace_vault_session_closed'
  | 'workspace_secure_rail_selected'
  | 'workspace_secure_rail_submitted'
  | 'workspace_file_staged'
  | 'workspace_file_bound'
  | 'workspace_file_quarantined'
  // CLAUDE-CODE-FILE-ATTACH Phase A — emitted once per run after every
  // attached file has classified + bound + read successfully. Detail
  // carries metadata only (fileId, filename, mediaType, sizeChars) —
  // NEVER the content (Phase A §5: ledger entries stay bounded).
  | 'workspace_file_attached'
  // `user_cancelled_run` is the canonical name under HL#4 revision —
  // names the cancel as user-initiated (vs. governance-initiated, which
  // orch is forbidden from doing). The legacy alias `run_cancelled` was
  // removed 2026-05-23 (fix-spec post-consolidation); historical ledger
  // files fall through the UI reducer's unknown-event path.
  | 'user_cancelled_run'
  // ── Admin secret onboarding (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC) ──────────
  // Credential-lifecycle audit: emitted on successful POST/DELETE against
  // /workspace/admin/setup/secrets. Detail carries keyName + admin actor
  // + storageLabel only — NEVER the value or any derivative (length, hash,
  // prefix). Same adminOperation: true convention as template_ingested.
  | 'secret_stored'
  | 'secret_removed'
  // ── Admin diagnostic probes (MAILPIT-INTEGRATION-DRIFT-AUDIT-2026-05-22
  // OWNER RULING #3 / D-4 closure). Emitted by the admin connector probe
  // + test-connection routes. Detail shape:
  //   { connectorId, connectorType, diagnosticKind: 'admin_probe' |
  //     'admin_test_connection', hasTargetSideEffect: boolean,
  //     configDigest: 'sha256:<hex>', result: 'ok' | 'failed' | 'denied',
  //     resultDetail? }
  // These events are NOT NXS runtime successes and are NOT Evidence
  // Ledger records — they audit admin connectivity diagnostics so any
  // probe-side side-effect (e.g. a Mailpit-labeled admin SMTP send) is
  // attributable to a specific elevated admin + infra run id.
  | 'admin_probe'
  | 'admin_test_connection'
  // ── Tool-schema bridge (Phase C buildToolDefinitions) ──────────────────
  // Fired once per NVG turn before classifyAndRoute. Records the exact
  // tool surface presented to the LLM provider. The connector boundary
  // (Gate 07 / EvidenceRecord) audits what the model ASKED FOR; this
  // event audits what we AUTHORIZED THE MODEL TO CONSIDER. Detail
  // shape: { nodeId, agentId, turnIndex, endpointId, adapterId,
  //          toolCount, toolNames[], capabilityRefs[], targetSystems[],
  //          schemaDigest } — never the input values, never the
  //          resulting tool_calls.
  | 'tool_schemas_attached'
  // ── Mailbox Pit (AMEND-nexus-mailbox-pit-v0-2-1 §3.4) ─────────────────
  // Per-actor mailbox allocation, compile-time mailbox enumeration,
  // cross-actor slot resolution, and bypass partials. ADD-MAILBOX-PIT-001.
  // Fired once per (runId, actorId) pair the first time allocateForRun
  // records it. Detail: { mailboxId, runId, actorId, mailboxRole,
  //                       allocatedAt }
  | 'mailbox_allocated'
  // Fired once when compile begins assembly and enumerates source
  // mailboxes. Detail: { runId, mailboxCount, mailboxIds[] }
  | 'compile_mailboxes_listed'
  // Fired per mailbox item compile bypasses during assembly. Detail:
  //   { mailboxItemId, sourceMailboxId, sourceActorId, bypassReason,
  //     bypassDisposition: 'render_partial' | 'withhold_quarantine',
  //     workspacePartialRef }
  | 'compile_mailbox_item_bypassed'
  // Fired every time orch resolves a downstream node's inputSlotReads
  // entry into a concrete mailbox item. Cross-actor data movement
  // audit. Detail: { runId, readerActorId, sourceActorId, sourceMailboxId,
  //                  sourceTaskId, slotId, mailboxItemId, resolvedAt }
  | 'mailbox_slot_resolved_for_dispatch'
  // ── F4.1 SigningCouncil federated operations (Hard Law #10) ───────────
  // Fired during the open/sign/dispatch lifecycle of a federated mutation
  // (mode_unlock, policy_bundle_replace, signing_council_change,
  // lexicon_mutation). All carry the full requestId + operation + opener
  // principal + signature chain so audit can reconstruct the threshold
  // chain post hoc. Detail never contains private key material.
  | 'federated_operation_opened'
  | 'federated_operation_signature_added'
  | 'federated_operation_executed'
  | 'federated_operation_dispatch_failed'
  | 'federated_operation_expired'
  // ── F4.8 Lexicon (Phase 1 JSONL via SigningCouncil) ───────────────────
  // Emitted by LexiconMutationExecutor when 2-of-2 signatures applied; by
  // planner callback when a prompt is unmappable; by callback when a user
  // picks an intent under threshold. Detail carries digest-only — raw
  // prompt text never lands in the ledger.
  | 'lexicon_mutation_applied'
  | 'unmapped_prompt'
  | 'lexicon_signal'
  // ── F4.2 Policy bundle OCT axis (Hard Law #5 / #10 / #13) ─────────────
  // `policy_bundle_replaced` — emitted by the policy_bundle_replace
  //   SigningCouncil dispatcher on successful 2-of-2 application; detail
  //   carries bundle hash + signer chain.
  //
  // Note: Gate 04's fail-closed on missing actor.octLevel is signalled via
  // GateDecision.denialCode = DENIAL_CODE.POLICY_ENVELOPE_MISSING_OCT
  // (already in the constants), which flows through the standard pipeline
  // ledger emission path — no separate event type needed. Three-mode
  // would-deny logging is post-V1 (spec F4.2 §3.3 is a runtime model
  // description, not a §1 scope deliverable); the corresponding event
  // type will be added when the three-mode evaluator branch lands.
  | 'policy_bundle_replaced'
  // ── F4.9 Claim Drift Verification (Hard Law #14) ──────────────────────
  // Emitted by the gate runner when ClaimVerificationPort.verify returns
  // 'drift'. Detail carries the carried-vs-current diff (fields list +
  // both hashes) — the claim values themselves stay out of the ledger
  // (they live in the carried-claims-ref / current-claims-ref pointers).
  | 'claim_drift_detected'
  // ── F4.11 NVG Payload Labels (Hard Law #6) ────────────────────────────
  // Emitted by NVG classify-and-route when the §3.3 empty-labels case
  // split fires. `data_label_floored_internal` — empty labels with
  // trusted provenance (nxs_connector_result, workspace_upload,
  // planner_history, or trusted agent_output): the gate floors the
  // classification at `internal` and proceeds. `would_deny_data_labels`
  // — observe/advisory mode where enforce would have denied:
  // payload still crosses (per §3.4) but the gate records what enforce
  // would have done so the operator can preview before flipping mode.
  | 'data_label_floored_internal'
  | 'would_deny_data_labels'
  // ── F4.15 Delegation mint fail-closed (HL #15) ────────────────────────
  // Emitted when DelegationMintPort returns empty_intersection or
  // mint_error. The fabricated-UUID path is retired; mint failure
  // surfaces explicitly to orch + workspace.
  | 'delegation_empty_intersection'
  | 'delegation_mint_error'
  // Emitted when makeIssueDelegation widens a Principal's claims
  // envelope to satisfy F4.15 §2.1 (the principal record was
  // registered before permittedCapabilities/firewallTransitRights/
  // permittedRunTypes/octLevel were mandatory fields). Audit reads
  // this list to migrate the principal record to a fully-populated
  // claims envelope per outline §3 B.
  | 'delegation_user_claims_widened'
  // ── F4.20 LLM internal tools vs targeted systems (Q6 / HL #5/#7) ──────
  // Emitted by NVG return-precheck whenever a model response carries
  // tool_calls. The post-inference normalizer that previously dispatched
  // these to NXS is retired (P0-016, P0-027); model output cannot
  // trigger NXS. Targeted-system tool calls go through planner-authored
  // nxs_dispatch only.
  | 'unsolicited_model_tool_call'
  // ── F4.13 Admin Signed Mutation Envelopes (HL #10) ────────────────────
  // Pre/post infra audit pair around every signed admin mutation. The
  // intent event writes BEFORE the persistence step; commit/failure
  // writes AFTER. Both share the same mutationId so audit can pair them.
  | 'admin_mutation_intent'
  | 'admin_mutation_committed'
  | 'admin_mutation_failed'
  // ── F4.14 Orch callback timeout no-kill (Hard Law #4) ─────────────────
  // Emitted when a plan checkback times out. NOT plan_checkback_resolved
  // with decision='deny' — that conflated timeout with denial. The run
  // stays open; the user decides whether to dismiss/restart/extend.
  | 'plan_checkback_expired'
  // ── Phase 5 Canonical Gate Denial / Approval-Required Audit Surfaces ──
  // Each gate's specific decision gets its own audit-trail event in
  // addition to the existing nxs_action / nvg_outbound umbrella events.
  // Decision labels (DENIAL_CODE constants in @nexus/contracts/constants)
  // and audit event types (this union) are separate canonical layers —
  // DENIAL_CODE describes the gate's internal decision; eventType
  // describes the audit-trail surface that ledger consumers (UI reducer,
  // audit tools, tests, E2E wall) filter / route / display on.
  //
  // Owning gates:
  //   - gate_02_oct_denied, oct_ceiling_exceeded         → NXS Gate 02 (classification)
  //   - gate_02_risk_denied, risk_ceiling_exceeded       → NXS Gate 02 (classification)
  //   - chain_depth_exceeded                             → NXS Gate 03 (delegation chain)
  //   - environment_mismatch                             → NXS Gate 03 (delegation env)
  //   - gate_04_require_approval                         → NXS Gate 04 (policy approval pending)
  //   - gate_05_require_approval                         → NXS Gate 05 (approval orchestration pending)
  //   - tier_ceiling_exceeded                            → NVG (OCT model-tier ceiling exceeded)
  //
  // Naming note: `chain_depth_exceeded` is intentionally the canonical
  // audit-event name; `DENIAL_CODE.CHAIN_DEPTH_EXCEEDED` (the gate's
  // internal denial label) carries the longer historical string value
  // `'chain_depth_ceiling_exceeded'`. Two-layer model — both names refer
  // to the same Gate 03 decision; the audit surface uses the shorter
  // canonical form, the internal denial code is unchanged.
  //
  // Out of scope for Phase 5 (S7 deep-dive 2026-05-25T23:55):
  //   - firewall_egress_denied / firewall_transit_rights_denied
  //     NVG firewall transit-rights enforcement does not exist in production
  //     code yet (FirewallTransitMap + seeded TRANSIT_* maps in
  //     scripts/seeds/user-ladder-seeds.ts are threaded through
  //     scripts/nexus-main.ts:1611-1673 but never consumed for any deny
  //     decision in packages/vanguard/src). Adding union members without
  //     write sites would violate /mem2 (no orphans). They land when the
  //     NVG firewall arc gets built — separate scope.
  | 'gate_02_oct_denied'
  | 'gate_02_risk_denied'
  | 'oct_ceiling_exceeded'
  | 'risk_ceiling_exceeded'
  | 'chain_depth_exceeded'
  | 'environment_mismatch'
  | 'gate_04_require_approval'
  | 'gate_05_require_approval'
  | 'tier_ceiling_exceeded'
  // ── Phase 8 — NVG capacity routing audit surfaces ───────────────────────
  // Owning module: packages/vanguard/src/router/model-router.ts (BAKED).
  // Architecture note: orchestrator is plug-and-play; capacity retry MUST
  // NOT be hosted there. NVG returns one final result; orch waits. Any
  // plug-and-play orch swap inherits capacity routing for free.
  //
  //   nvg_endpoint_skipped_saturated — emitted per attempt when the
  //     in-flight counter for that endpoint is at maxConcurrentRequests.
  //     The router records the attempt + tries the next healthy endpoint
  //     in the lawful tier.
  //
  //   nvg_capacity_retry_waiting — emitted before each backoff wait when
  //     ALL endpoints in the lawful tier were saturated on the most
  //     recent pass. Detail carries `attemptIndex`, `nextWaitMs`,
  //     `endpointsAtCapacity[]`. The existing run-event-bus.ts SSE fanout
  //     automatically delivers these to the workspace stream so the UI
  //     can render a "models busy, waiting..." countdown.
  //
  //   nvg_capacity_exhausted — emitted ONCE when the retry budget is
  //     exhausted (default 3 attempts with 500/1000/2000ms backoff).
  //     The router returns DENIAL_CODE.NVG_CAPACITY_EXHAUSTED_TIER as
  //     the final result; orch closes the run cleanly with the canonical
  //     capacity-exhausted outcome.
  | 'nvg_endpoint_skipped_saturated'
  | 'nvg_capacity_retry_waiting'
  | 'nvg_capacity_exhausted';

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

/**
 * Thrown when a policy bundle's rules fail structural validation at load
 * time. F4.2 §2.3 makes `conditions.octLevels` a required field on every
 * rule; any bundle whose rules omit it is rejected here (fail-closed at
 * composition) so the evaluator at `policy/evaluator.ts:55` can rely on
 * `cond.octLevels.includes(...)` being safe. This catches drift at boot
 * — not as an eval-time TypeError that produces `error_dispatch` after
 * Gates 01-03 have already passed.
 */
export class PolicyRuleValidationError extends NexusError {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyRuleValidationError';
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

// ─── F4.11 NVG Payload Labels — provenance taxonomy (Hard Law #6) ─────────
// Every mailbox item and every NVG request must carry provenance so the
// classify-and-route gate can apply the §3.3 empty-labels case split
// (Spec F4.11). Untrusted/unknown provenance with empty labels → deny.
// Taxonomy ratified by component outline §C.2 (Owner-Ratified 2026-05-23).
export type ProvenanceSource =
  | 'workspace_prompt' // typed or pasted prompt text submitted through workspace
  | 'workspace_upload' // file/blob uploaded through workspace and bound to a run
  | 'nxs_connector_result' // output from governed NXS connector/action result
  | 'nvg_model_result' // normalized model return through NVG inbound
  | 'agent_output' // agent-produced result dropped to mailbox
  | 'planner_history' // prior plan/run context selected by orch/planner
  | 'unknown'; // quarantine / deny until classified

export interface NvgOutboundRequest {
  requestId: Uuid;
  runId: Uuid;
  actorId: Uuid;
  octLevel: OctLevel;
  environmentContext: EnvironmentId;
  taskIntent: NonEmpty;
  payload: unknown;
  dataLabels: DataLabel[];
  /**
   * Data classes contributed by the connectors this caller can reach. The
   * NVG classifier takes max across `dataLabels` (payload axis) and these
   * (binding axis). Empty array = no bindings → pure payload classification.
   * Populated by dispatch from the agent's allowedSystems → connector
   * registry → connector.dataClass.
   */
  boundConnectorClasses: DataClass[];
  costPreference: 'low' | 'standard' | 'high';
  latencyPreference: 'low' | 'standard' | 'high';
  /**
   * CLAUDE-CODE-MODEL-SELECTION-SPEC §2b. User's preferred endpoint surfaced
   * from the workspace dropdown. Routing treats this as a weighted suggestion
   * within the governed tier set:
   * - Healthy + within ceiling → invoke directly (skip primary-tier first pick)
   * - Outside OCT model-tier ceiling → DENY (terminal, like primary-tier denial)
   * - Unhealthy → fall through to policy-selected tier (which may itself
   *   trigger same-tier retry / fallback / pre-flight checkback)
   * `null` or undefined = Auto (policy) — original routing behavior.
   */
  preferredEndpointId?: NonEmpty | null;
  /**
   * F4.9 §3.2 — Carried claims envelope snapshot. The orchestrator populates
   * this from the principal's IdentityClaims at dispatch so the NVG gate
   * runner can verify against RBAC's current state (Hard Law #14). The
   * canonical-hash comparison is performed in NvgServiceImpl. If the field
   * is absent and a ClaimVerificationPort is wired into NVG, the gate
   * runner fails closed under enforce mode.
   */
  carriedClaims: Record<string, unknown>;
  /**
   * F4.11 §2.3 / Hard Law #6 — aggregated provenance of the payload. The
   * orchestrator computes this from the upstream mailbox items the
   * dispatch slice reads (max-trust selection across items). NVG's
   * classify-and-route gate applies the §3.3 empty-labels case split
   * against this field: empty labels + trusted provenance → floor
   * 'internal' + log; empty labels + untrusted/unknown → deny with
   * NVG_UNKNOWN_PROVENANCE_PAYLOAD. The provenance value here is the
   * aggregate across all upstream items contributing to the request;
   * per-item provenance is preserved on MailboxItem.provenance for
   * audit reconstruction.
   */
  provenance: ProvenanceSource;
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
  /**
   * Per-endpoint timeout override in ms. When absent, the adapter
   * resolves a tier-aware default: on-prem tiers (`on_prem_general`,
   * `on_prem_sensitive`) default to 120_000ms (Phase 8); frontier tiers
   * default to 30_000ms. Explicit per-endpoint value always wins.
   */
  timeoutMs?: number;
  /**
   * Phase 8 — maximum concurrent in-flight requests this endpoint will
   * accept before NVG considers it saturated and skips it for the next
   * healthy endpoint in the same lawful tier. When all endpoints in the
   * tier are saturated, NVG enters a bounded backoff retry loop
   * (`nvg_capacity_retry_waiting` events fan out via SSE for live UX);
   * after the retry budget is exhausted, NVG returns
   * `NVG_CAPACITY_EXHAUSTED_TIER`. NVG NEVER widens the tier because of
   * capacity — that would bypass the OCT ceiling.
   *
   * When absent, the runtime treats this endpoint as if the limit were
   * 4 (admin-configurable default; see admin model-endpoint-setup-panel).
   */
  maxConcurrentRequests?: number;
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
  /**
   * CLAUDE-CODE-MODEL-PREFERENCE-TRANSPARENCY §3 — every attempt that ran
   * (or was skipped) before this final outcome. Self-contained forensics so
   * a single trail entry shows the full preference / sibling / fallback
   * chain without cross-referencing per-attempt entries. Optional: only set
   * on the final-outcome inbound entry when at least one attempt failed.
   */
  priorAttempts?: InvocationAttempt[];
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
  /**
   * CHECKBACK-spec Part 1 — non-invoking routing preview. Runs
   * classify → route → ceiling but stops before invocation, then probes
   * tier-registry health so the orchestrator can pre-flight a plan and
   * surface a checkback to the user when the selected tier has no healthy
   * endpoints. NEVER invokes the model — pre-flight is metadata-only.
   */
  previewRouting(request: NvgOutboundRequest): Promise<NvgRoutingPreview>;
}

// ─── CHECKBACK-spec — Routing preview (non-invoking) ───
export interface NvgRoutingPreviewEndpoint {
  endpointId: NonEmpty;
  modelName: NonEmpty;
  tier: ModelTier;
}

export interface NvgRoutingPreview {
  /** Tier the routing policy selected for this request, or null on default-deny. */
  primaryTier: ModelTier | null;
  /** True iff the primary tier has at least one healthy or probationary endpoint. */
  primaryHealthy: boolean;
  /** Routing-policy-declared fallback tier, or null. */
  fallbackTier: ModelTier | null;
  /** True iff fallback tier exists and has a healthy/probationary endpoint. */
  fallbackHealthy: boolean;
  /**
   * First healthy/probationary tier within the request's OCT ceiling that is
   * NOT the primary tier — used as the user-facing alternative in the
   * checkback card. Null when no within-ceiling alternative exists.
   */
  alternativeTier: ModelTier | null;
  /** Concrete endpoint surfaced as the alternative, or null. */
  alternativeEndpoint: NvgRoutingPreviewEndpoint | null;
  /** Classification result derived from the request's data labels. */
  classification: NvgClassificationResult;
  /** True iff primary tier passed the OCT ceiling check. */
  ceilingAllowed: boolean;
  /** Denial code when ceilingAllowed=false or routing default-deny fires. */
  denialCode: DenialCode | null;
  /** Human-readable denial reason (paired with denialCode). */
  denialReason: string | null;
  /**
   * CLAUDE-CODE-MODEL-SELECTION-SPEC §4 — user-preference visibility for the
   * checkback card. All three fields are null/false when the request had no
   * preferredEndpointId or the id wasn't found in the registry.
   */
  /** The user's preferred endpoint — resolved against the registry. */
  preferredEndpoint: NvgRoutingPreviewEndpoint | null;
  /** True iff the preferred endpoint is currently invocable (healthy/probationary). */
  preferredEndpointHealthy: boolean;
  /** True iff the preferred endpoint's tier passes the OCT ceiling check. */
  preferredCeilingAllowed: boolean;
  /**
   * True iff the preferred endpoint's tier has at least one OTHER healthy
   * endpoint when the preferred itself is unhealthy. When this is true, the
   * router will silently fall through to a sibling on the same tier — no
   * checkback needed (spec §4 case 1c).
   */
  preferredTierHasHealthySibling: boolean;
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

// ─── F4.20 / Q6 — LLM internal tools vs targeted-system tools ─────────────
// The post-inference action normalizer (formerly §28.1) is RETIRED — model
// output cannot trigger NXS. Targeted-system actions go through the
// planner-authored nxs_dispatch node path only (Spec F4.7). LLMs may call
// internal tools (Claude Code MCP, Langgraph state, file_search, etc.); the
// LlmAdapterDeclaration documents those advertised internals, and the
// validation in @nexus/runtime-utils rejects any targeted-system tool name.
//
// NVG return-precheck (per F4.20 §4.1) inspects every model response; if a
// `tool_calls` shape is present, it emits `unsolicited_model_tool_call` and
// strips the field before handing the payload to the orch mailbox. Workspace
// receipt notes "treated as text per Nexus governance."

/** Open-governed LLM adapter identifier (one per provider wire-format family). */
export type LlmAdapterId = NonEmpty;

/**
 * Scope of an LLM-internal tool that an adapter may advertise to its LLM.
 * Internal tools never touch the customer's targeted internal systems —
 * they live entirely within the LLM runtime / adapter.
 */
export type InternalToolScope =
  | 'claude_code' // Claude Code's own MCP-mediated tools
  | 'mcp' // generic MCP server tools wired via shim
  | 'openai_internal' // OpenAI internal tools (file_search, code_interpreter, etc.)
  | 'langgraph' // Langgraph internal state/flow tools
  | 'reasoning' // model-internal scratchpad / thinking tools
  | 'custom_internal'; // customer-declared, audit-trailed internal tool

export interface InternalToolDescriptor {
  /** Provider tool name (e.g., 'mcp_file_search'). MUST NOT begin with a
   *  targeted-system verb (read_, write_, query_, etc.) — the validator
   *  in @nexus/runtime-utils rejects targeted-system shapes. */
  readonly toolName: NonEmpty;
  /** Which class of LLM-internal capability this tool belongs to. */
  readonly providerScope: InternalToolScope;
  /** Free-text description for admin audit + LlmAdapterDeclaration export. */
  readonly description: NonEmpty;
}

export interface LlmAdapterDeclaration {
  readonly adapterId: LlmAdapterId;
  readonly providerKind: 'ollama' | 'anthropic' | 'openai' | 'mcp' | 'custom';
  /** Internal-only tools advertised by this adapter. May be empty (an
   *  adapter that does not pass any tools to its LLM). MUST NOT contain
   *  any targeted-system tool descriptor (the validator rejects them). */
  readonly internalToolsAdvertised: ReadonlyArray<InternalToolDescriptor>;
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
