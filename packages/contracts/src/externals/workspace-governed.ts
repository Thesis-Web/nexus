// packages/contracts/src/externals/workspace-governed.ts
// AMEND-nexus-spec-workspace-v1-1-1 §1.4, §2, §3
// Layer 2 — workspace governed contract types and port interfaces.
//
// All workspace-specific types and port interfaces for the governed workspace
// reference implementation. Blueprint-pinned types materialized per
// B-NOTE-WS-TYPES-001 (owner-authorized).
//
// This file MUST NOT import from @nexus/core, @nexus/vanguard, or any
// implementation package. Internal contract imports only.

import type { Uuid, IsoTimestamp, Sha256Hex } from '../types/index.js';
import type { ModelTier, OctLevel } from '../constants/index.js';
import type { IdentityClaims, ApprovalResponse } from '../interfaces/index.js';
import type { CompileFormat } from './compile-template.js';

// ═══════════════════════════════════════════════════════════════════════════════
// §2.2 — Spec-Defined Types
// ═══════════════════════════════════════════════════════════════════════════════

/** OutputFormat alias — bound to CompileFormat [§2.2] */
export type OutputFormat = CompileFormat;
export const OUTPUT_FORMAT_VALUES = ['prose', 'table', 'raw', 'mixed', 'file_bundle'] as const;

/** Workspace session [§2.2, GWS2-AUD-02] */
export interface WorkspaceSession {
  workspaceAuthSessionId: Uuid;
  principalId: string;
  actorId: Uuid;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

/** Catalog item [§2.2, GWS-F11] */
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  selectable: boolean;
  reason?: string;
}

/** Template section configuration [§2.2] */
export interface TemplateSectionConfig {
  sectionId: string;
  label: string;
  description: string;
  inputType: 'free_text' | 'select' | 'multi_select' | 'readonly';
  required: boolean;
  options?: string[];
  defaultValue?: string;
}

/** Constrained field definition [§2.2] */
export interface ConstrainedFieldDef {
  fieldId: string;
  label: string;
  inputType: 'text' | 'select' | 'readonly';
  required: boolean;
  options?: string[];
  maxLength?: number;
  pattern?: string;
}

/** Template signature [§2.2] */
export interface TemplateSignature {
  signedBy: string;
  publicKey: string;
  signature: string;
  signedAt: IsoTimestamp;
}

/** Rail signature [§2.2] */
export interface RailSignature {
  signedBy: string;
  publicKey: string;
  signature: string;
  signedAt: IsoTimestamp;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §2.1 — Blueprint-Pinned Types (materialized per B-NOTE-WS-TYPES-001)
// ═══════════════════════════════════════════════════════════════════════════════

// ── [blueprint §3.4.2] ModelPreference ──────────────────────────────────────

export interface ModelPreference {
  agentId: Uuid;
  modelTier: ModelTier;
  mode: 'available' | 'preferred';
}

// ── [blueprint §3.7.1] WorkspaceFileReference — AMENDED §2.3 ───────────────

export interface WorkspaceFileReference {
  fileId: Uuid;
  sha256: Sha256Hex;
  declaredFilename: string;
  mediaType: string;
  sizeBytes: number;
  classificationLabels: string[];
  provenance: 'user_upload';
  storedAt: string;
  runId: Uuid | null;
  uploadedByPrincipalId: string;
  uploadedAt: IsoTimestamp;
  /** [GWS3-AUD-06] lifecycle status */
  status: 'staged' | 'bound' | 'quarantined';
  /** [GWS3-AUD-06] reason for quarantine, if quarantined */
  quarantineReason?: string;
}

// ── [blueprint §3.8.1] WorkspacePromptInput (discriminated union) ───────────

export interface FreeTextPromptInput {
  promptMode: 'free_text';
  prompt: string;
  agents?: Uuid[];
  modelPreferences?: ModelPreference[];
  attachmentIds?: Uuid[];
}

export interface SectionedPromptInput {
  promptMode: 'sectioned';
  prompt: string;
  templateId: string;
  templateVersion: string;
  outputFormat?: OutputFormat;
  connectors?: string[];
  executionMode?: 'human_in_the_loop' | 'autonomous';
  agents?: Uuid[];
  modelPreferences?: ModelPreference[];
  attachmentIds?: Uuid[];
}

export interface SecureRailsPromptInput {
  promptMode: 'secure_rails';
  railId: string;
  railVersion: string;
  elevatedSessionId: Uuid;
  constrainedInputs?: Record<string, string>;
  attachmentIds?: Uuid[];
}

export type WorkspacePromptInput =
  | FreeTextPromptInput
  | SectionedPromptInput
  | SecureRailsPromptInput;

// ── [blueprint §3.8.2] WorkspaceRunEnvelope ─────────────────────────────────

export interface WorkspaceRunEnvelope {
  runId: Uuid;
  principalId: string;
  actorId: Uuid;
  prompt: string;
  promptDigest: Sha256Hex;
  promptMode: 'free_text' | 'sectioned' | 'secure_rails';
  enteredAt: IsoTimestamp;
  resolvedClaims: IdentityClaims;
  workspaceAuthSessionId: Uuid;
}

// ── [blueprint §3.9] ElevatedAuth types — AMENDED §2.4 ─────────────────────

export const ELEVATED_AUTH_METHOD = {
  PASSWORD_REAUTH: 'password_reauth',
  API_KEY_REAUTH: 'api_key_reauth',
} as const;

/** Open string type — enterprise adds custom methods [GWB4-F05] */
export type ElevatedAuthMethod = string;

export interface ElevatedAuthChallengeRequest {
  principalId: string;
  method: ElevatedAuthMethod;
}

/** B-NOTE-WS-TYPES-001: materialized from blueprint §3.9 challenge() return */
export interface ElevatedAuthChallenge {
  challengeId: Uuid;
  method: ElevatedAuthMethod;
  expiresAt: IsoTimestamp;
  prompt: string;
}

/** B-NOTE-WS-TYPES-001: materialized from blueprint §3.9 verify() input */
export interface ElevatedAuthVerifyRequest {
  challengeId: Uuid;
  principalId: string;
  method: ElevatedAuthMethod;
  response: string;
}

export interface ElevatedSession {
  elevatedSessionId: Uuid;
  principalId: string;
  method: ElevatedAuthMethod;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  timeoutSeconds: number;
}

export interface ElevatedSessionStatus {
  valid: boolean;
  remainingSeconds: number;
  reason?: string;
}

/** [blueprint §3.9] — AMENDED §2.4: validateSession requires principalId */
export interface ElevatedAuthProvider {
  challenge(input: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge>;
  verify(input: ElevatedAuthVerifyRequest): Promise<ElevatedSession>;
  validateSession(elevatedSessionId: Uuid, principalId: string): Promise<ElevatedSessionStatus>;
}

// ── [blueprint §3.5.3] WorkspaceApprovalBridge ──────────────────────────────

export interface WorkspaceApprovalBridge {
  submitDecision(input: {
    approvalId: Uuid;
    runId: Uuid;
    principalId: string;
    decision: 'approved' | 'denied';
    note?: string;
    workspaceAuthSessionId: Uuid;
  }): Promise<ApprovalResponse>;
}

// ── [blueprint §3.6] WorkspaceUiEvent — B-NOTE-WS-TYPES-001 ────────────────

export type WorkspaceUiEventKind =
  | 'run_status'
  | 'agent_preview'
  | 'compile_complete'
  | 'approval_prompt';

/** Derived projection — not Run Ledger. For WS/SSE event channel. */
export interface WorkspaceUiEvent {
  kind: WorkspaceUiEventKind;
  runId: Uuid;
  timestamp: IsoTimestamp;
  data: Record<string, unknown>;
}

// ── [blueprint §4.1] PromptTemplate ─────────────────────────────────────────

export interface PromptTemplate {
  templateId: string;
  name: string;
  description: string;
  version: string;
  sections: TemplateSectionConfig[];
  defaultAgents: Uuid[];
  defaultModelPreferences: ModelPreference[];
  defaultConnectors: string[];
  defaultOutputFormat: OutputFormat;
  defaultExecutionMode: 'human_in_the_loop' | 'autonomous';
  requiredPrincipalPermissions: string[];
  requiredRunnableAgentOctLevels?: OctLevel[];
  requiredAgentCapabilities?: string[];
  createdBy: string;
  createdAt: IsoTimestamp;
  disabled: boolean;
  signatures: TemplateSignature[];
}

// ── [blueprint §4.5] SecureRail — AMENDED §2.5 ─────────────────────────────

export interface SecureRail {
  railId: string;
  name: string;
  description: string;
  version: string;
  agentId: Uuid;
  modelTier: ModelTier;
  connectors: string[];
  constrainedFields?: ConstrainedFieldDef[];
  requiredPermissions: string[];
  requiredAgentOctLevels: OctLevel[];
  requiredModelTierCeiling: ModelTier[];
  requiredDataClasses?: string[];
  requiredApprovalChain?: string[];
  disabled: boolean;
  signatures: RailSignature[];
  /** [GWS-F15] attachment constraints */
  allowAttachments: boolean;
  allowedAttachmentMediaTypes?: string[];
  maxAttachmentCount?: number;
  maxAttachmentSizeBytes?: number;
}

// ── [blueprint §5.3–5.4] RunAcl — B-NOTE-WS-TYPES-001 ──────────────────────

export interface RunAcl {
  runId: Uuid;
  principalId: string;
  actorId: Uuid;
  permittedViewers: string[];
}

// ── [blueprint §5.4] WorkspaceEventTicket — B-NOTE-WS-TYPES-001 ─────────────

export interface WorkspaceEventTicket {
  ticketId: Uuid;
  runId: Uuid;
  principalId: string;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  consumed: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// §3 — Store Port Interfaces
// API imports ONLY these — never concrete implementations.
// ═══════════════════════════════════════════════════════════════════════════════

export interface WorkspaceFileStorePort {
  store(file: WorkspaceFileReference): Promise<void> | void;
  get(fileId: Uuid): Promise<WorkspaceFileReference | null> | WorkspaceFileReference | null;
  getByPrincipal(principalId: string): Promise<WorkspaceFileReference[]> | WorkspaceFileReference[];
  bindToRun(fileId: Uuid, runId: Uuid, labels: string[]): Promise<void> | void;
  markQuarantined(fileId: Uuid, reason: string, labels: string[]): Promise<void> | void;
}

export interface WorkspaceBlobStorePort {
  write(input: {
    fileId: Uuid;
    stream: NodeJS.ReadableStream;
    declaredMediaType: string;
    maxSizeBytes: number;
  }): Promise<{ storedAt: string; sha256: string; sizeBytes: number }>;
  read(storedAt: string): Promise<NodeJS.ReadableStream | null>;
  quarantine(storedAt: string): Promise<void>;
  delete(storedAt: string): Promise<void>;
}

export interface WorkspaceRunAclStorePort {
  store(acl: RunAcl): Promise<void> | void;
  get(runId: Uuid): Promise<RunAcl | null> | RunAcl | null;
  isAuthorized(runId: Uuid, principalId: string): Promise<boolean> | boolean;
}

export interface WorkspaceEventTicketStorePort {
  store(ticket: WorkspaceEventTicket): Promise<void> | void;
  consume(
    ticketId: Uuid,
    runId: Uuid
  ): Promise<WorkspaceEventTicket | null> | WorkspaceEventTicket | null;
}

export interface WorkspaceSessionStorePort {
  create(session: WorkspaceSession): Promise<void> | void;
  get(sid: Uuid): Promise<WorkspaceSession | null> | WorkspaceSession | null;
  revoke(sid: Uuid): Promise<void> | void;
}

export interface PromptTemplateStorePort {
  list(): Promise<PromptTemplate[]>;
  get(id: string, version: string): Promise<PromptTemplate | null>;
  save(t: PromptTemplate): Promise<void>;
  disable(id: string, version: string): Promise<void>;
  exists(id: string, version: string): Promise<boolean>;
}

export interface SecureRailStorePort {
  list(): Promise<SecureRail[]>;
  get(id: string, version: string): Promise<SecureRail | null>;
  save(r: SecureRail): Promise<void>;
  disable(id: string, version: string): Promise<void>;
  exists(id: string, version: string): Promise<boolean>;
}

export interface WorkspaceCatalogReaderPort {
  listAgents(claims: IdentityClaims): Promise<CatalogItem[]>;
  listModels(claims: IdentityClaims): Promise<CatalogItem[]>;
  listConnectors(claims: IdentityClaims): Promise<CatalogItem[]>;
}

export interface AdminSignerRegistry {
  getPublicKey(signerId: string): Promise<string | null>;
  isRegistered(signerId: string): Promise<boolean>;
}
