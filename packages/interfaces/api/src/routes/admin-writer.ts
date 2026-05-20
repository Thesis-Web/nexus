/**
 * Admin Dashboard Writer Routes — SPEC-ADMIN-WRITER §4–§6
 *
 * File: packages/interfaces/api/src/routes/admin-writer.ts
 * Layer 7 — workspace-attached admin mutation routes.
 *
 * Three surfaces:
 *   1. Model endpoints — YAML manifest writer (requires restart)
 *   2. Actors & agents — SQLite ActorRegistry (immediate)
 *   3. Connectors — YAML manifest writer (requires restart)
 *
 * Auth chain: workspace JWT → nexus-admin role → X-Elevated-Session.
 *
 * Import law: This file is Layer 7. It imports ONLY from @nexus/contracts
 * (types + value imports via project references) and local route helpers.
 * The ManifestWriter implementation is injected via DI from the composition
 * root — no direct import of core classes.
 *
 * Owner rulings: WRITER-001 through WRITER-004.
 */
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Express, Request, Response } from 'express';
import type {
  ActorRegistry,
  Base64Url,
  ElevatedAuthProvider,
  InfraRunIdNamespace,
  LexiconMutation,
  ModeConfiguration,
  NonEmpty,
  PrincipalRegistry,
  RunLedgerWriter,
  Uuid,
} from '@nexus/contracts';
import {
  ACTOR_CLASS,
  CAPABILITY_IDS,
  MODEL_TIER,
  OCT_CEILINGS,
  OCT_LEVEL,
  RISK_TIER,
  RISK_TIER_ORDER,
  nowIso,
} from '@nexus/contracts';
import { z } from 'zod';
import { san } from './shared.js';
import { checkAdminAuth } from './admin-auth.js';
import {
  withAdminMutation,
  type AdminMutationHandlerOutcome,
  type AdminMutationNonceStorePort,
  type AdminMutationServerSignerPort,
  type AdminMutationVerifierPort,
} from '../middleware/signed-admin-mutation.js';

// ── CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §2 — Zod boundary validation ─────────
//
// Every mutation route below validates `req.body` through one of these schemas
// BEFORE handing data to the manifest writer or registry. The previous
// hand-rolled `if (!entry?.x)` checks let through anything not explicitly
// listed; Zod gives us:
//   - Strict shape enforcement (`.strict()` rejects unknown fields).
//   - Explicit wildcard rejection (allowedSystems must be concrete IDs).
//   - Structured error responses (`details: [{path, message}]`) so admins
//     see exactly which field failed instead of "endpointId required".
//
// Schemas describe what the route ACCEPTS at the boundary — not the full
// downstream contract. The manifest schemas + registry update logic still
// validate the persisted shape; this layer is the first line.

/** Reject the literal '*' as a member of an allowedSystems list. */
const concreteSystem = z
  .string()
  .min(1)
  .refine(s => s !== '*', {
    message: 'Wildcard (*) not permitted in allowedSystems — use concrete system identifiers',
  });

/** Auth shape per ModelEndpointAuth (kind discriminator + per-kind fields). */
const EndpointAuthSchema = z
  .object({
    kind: z.enum(['none', 'bearer', 'api_key']),
    secretRef: z.string().min(1).optional(),
    headerName: z.string().min(1).optional(),
    prefix: z.string().optional(),
  })
  .strict();

const EndpointCreateSchema = z
  .object({
    endpointId: z.string().min(1),
    tier: z.string().min(1).optional(),
    url: z.string().url(),
    adapterId: z.string().min(1),
    modelName: z.string().min(1),
    auth: EndpointAuthSchema.optional(),
    healthy: z.boolean().optional(),
    enabled: z.boolean().optional(),
    adapterConfig: z.record(z.unknown()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

/**
 * PUT update schema — every field optional EXCEPT the path-segment id
 * (asserted by the route handler from req.params). Passing extra unknown
 * fields rejects via .strict() so a typo doesn't silently no-op.
 */
const EndpointUpdateSchema = z
  .object({
    tier: z.string().min(1).optional(),
    url: z.string().url().optional(),
    adapterId: z.string().min(1).optional(),
    modelName: z.string().min(1).optional(),
    auth: EndpointAuthSchema.optional(),
    healthy: z.boolean().optional(),
    enabled: z.boolean().optional(),
    adapterConfig: z.record(z.unknown()).optional(),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const ActorCreateSchema = z
  .object({
    actorId: z.string().uuid(),
    actorClass: z.string().min(1),
    displayName: z.string().min(1),
    principalId: z.string().uuid(),
    environment: z.string().min(1),
    riskCeiling: z.string().min(1),
    octLevel: z.string().min(1).optional(),
    allowedSystems: z.array(concreteSystem).min(1),
    allowedCapabilities: z.array(z.string().min(1)).optional(),
    enabled: z.boolean().optional(),
    registeredAt: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
    reviewCadence: z.string().min(1).optional(),
  })
  .strict();

// F4.16 / Q2 / HL #10: octLevel is removed from generic actor update.
// OCT can only be mutated through the signed assignOct flow (Spec F4.5);
// downward equivalents are deregister-then-register-new. The .strict()
// wrapper makes any client that still sends octLevel fail validation —
// the lawful path lives elsewhere.
const ActorUpdateSchema = z
  .object({
    actorClass: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    principalId: z.string().uuid().optional(),
    environment: z.string().min(1).optional(),
    riskCeiling: z.string().min(1).optional(),
    allowedSystems: z.array(concreteSystem).min(1).optional(),
    allowedCapabilities: z.array(z.string().min(1)).optional(),
    enabled: z.boolean().optional(),
    owner: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
    reviewCadence: z.string().min(1).optional(),
  })
  .strict();

const ConnectorCreateSchema = z
  .object({
    connectorId: z.string().min(1),
    connectorType: z.string().min(1),
    allowedSystems: z.array(concreteSystem).min(1),
    configuration: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const ConnectorUpdateSchema = z
  .object({
    connectorType: z.string().min(1).optional(),
    allowedSystems: z.array(concreteSystem).min(1).optional(),
    configuration: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const DiscoverSchema = z
  .object({
    baseUrl: z.string().url(),
    adapterId: z.string().min(1).optional(),
  })
  .strict();

// ── AMEND-nexus-admin-dashboard-full-buildout §3.1 — Identity providers ────
//
// Schema mirrors IdentityProviderManifestEntrySchema (loader-side) so the
// writer never produces a manifest the loader can't parse. providerType is
// an open NonEmpty string per the loader's factory-registry-validated
// convention; the spec's discriminated union (local/oidc/saml/api-token)
// lives in the UI as form-shape guidance, not as a writer-side type narrowing
// (a stricter writer schema would reject the existing seed `reference_adapter`
// entry that the loader already accepts).
const IdentityProviderCreateSchema = z
  .object({
    providerId: z.string().min(1),
    providerType: z.string().min(1),
    configuration: z.record(z.unknown()),
    enabled: z.boolean(),
  })
  .strict();

const IdentityProviderUpdateSchema = z
  .object({
    providerType: z.string().min(1).optional(),
    configuration: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// ── AMEND-nexus-admin-dashboard-full-buildout §3.2 — Approval channels ─────
//
// channelType is an open NonEmpty string (loader uses a factory registry).
// Panel renders the four canonical discriminator types cli/webhook/slack/
// dashboard; configuration is record(unknown) at the writer boundary so
// other factory-registered types stay editable.
const ApprovalChannelCreateSchema = z
  .object({
    channelId: z.string().min(1),
    channelType: z.string().min(1),
    configuration: z.record(z.unknown()),
    enabled: z.boolean(),
  })
  .strict();

const ApprovalChannelUpdateSchema = z
  .object({
    channelType: z.string().min(1).optional(),
    configuration: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// ── AMEND-nexus-admin-dashboard-full-buildout §3.3 — Orchestrators ─────────
//
// Schema mirrors OrchestratorManifestEntrySchema fully — the loader is
// .strict() on every nested object so a thinner writer schema would
// produce manifests the loader rejects. Spec §3.3 calls out
// maxToolTurnsPerNode (0-10) and plannerMode enum('deterministic'); the
// loader requires int ≥ 1 and the existing enum
// (deterministic_first|policy_template|llm_assisted). Spec values are
// best-solve overridden by loader law (/mem2 names literal).
const OrchestratorSecureModeSchema = z
  .object({
    octSecureDefault: z.literal('single_agent_no_helper'),
    allowSecureMultiAgentOnlyBySignedPolicy: z.boolean(),
  })
  .strict();
const OrchestratorRetryPolicySchema = z
  .object({ transientAutoRetryCount: z.number().int().min(0) })
  .strict();
const OrchestratorTimeoutsSchema = z
  .object({
    systemActionMs: z.number().int().min(1),
    modelCallMs: z.number().int().min(1),
  })
  .strict();
const OrchestratorPlanAmendmentSchema = z
  .object({
    enabled: z.boolean(),
    maxAmendments: z.number().int().min(0),
    requiresCheckback: z.boolean(),
  })
  .strict();
const OrchestratorPartialCompletionSchema = z
  .object({
    enabled: z.boolean(),
    minRequiredCompletedNodes: z.number().int().min(0),
    compileOnPartial: z.boolean(),
  })
  .strict();

const OrchestratorCreateSchema = z
  .object({
    orchestratorSocketId: z.string().min(1),
    orchestratorType: z.string().min(1),
    enabled: z.boolean(),
    orchestratorActorId: z.string().min(1),
    plannerMode: z.enum(['deterministic_first', 'policy_template', 'llm_assisted']),
    maxSplitDepth: z.number().int().min(0),
    planCheckbackDefault: z.boolean(),
    secureMode: OrchestratorSecureModeSchema,
    retryPolicy: OrchestratorRetryPolicySchema,
    timeouts: OrchestratorTimeoutsSchema,
    outputSlotPolicy: z.enum(['strict_declared_slots', 'advisory_declared_slots', 'open_slots']),
    configuration: z.record(z.unknown()),
    plannerType: z.string().min(1),
    plannerVersion: z.string().min(1),
    plannerConfiguration: z.record(z.unknown()),
    planAmendment: OrchestratorPlanAmendmentSchema,
    partialCompletion: OrchestratorPartialCompletionSchema,
    maxToolTurnsPerNode: z.number().int().min(1),
  })
  .strict();

const OrchestratorUpdateSchema = z
  .object({
    orchestratorType: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    orchestratorActorId: z.string().min(1).optional(),
    plannerMode: z.enum(['deterministic_first', 'policy_template', 'llm_assisted']).optional(),
    maxSplitDepth: z.number().int().min(0).optional(),
    planCheckbackDefault: z.boolean().optional(),
    secureMode: OrchestratorSecureModeSchema.optional(),
    retryPolicy: OrchestratorRetryPolicySchema.optional(),
    timeouts: OrchestratorTimeoutsSchema.optional(),
    outputSlotPolicy: z
      .enum(['strict_declared_slots', 'advisory_declared_slots', 'open_slots'])
      .optional(),
    configuration: z.record(z.unknown()).optional(),
    plannerType: z.string().min(1).optional(),
    plannerVersion: z.string().min(1).optional(),
    plannerConfiguration: z.record(z.unknown()).optional(),
    planAmendment: OrchestratorPlanAmendmentSchema.optional(),
    partialCompletion: OrchestratorPartialCompletionSchema.optional(),
    maxToolTurnsPerNode: z.number().int().min(1).optional(),
  })
  .strict();

// ── AMEND-nexus-admin-dashboard-full-buildout §3.4 — Workspaces ────────────
// ── AMEND-nexus-planner-chat-tier-v0-2-0.md §3.7 — entryMode unlock ─────────
//
// Schema mirrors WorkspaceManifestEntrySchema. entryMode widens to
// enum(['governed_only', 'free_chat']) per chat-tier amendment. The
// pre-create / pre-update guards enforce the cross-field rules (chat
// requires single-node-shaped capabilities + configuration.defaultChatAgentId)
// before persisting so the loader never sees an invalid manifest.
//
// capabilities keys match the loader (promptEntry/planReview/finalDisplay/
// fileSpace); the spec's looser names (prompts/runDisplay/...) are
// reconciled to the loader's law (/mem2). workspaceType remains an open
// string so factory-registered types beyond http/cli/mcp/chat_workspace
// stay editable.
const WorkspaceCapabilitiesSchema = z
  .object({
    promptEntry: z.boolean(),
    planReview: z.boolean(),
    finalDisplay: z.boolean(),
    fileSpace: z.boolean(),
  })
  .strict();

const WorkspaceCreateSchema = z
  .object({
    workspaceSocketId: z.string().min(1),
    workspaceType: z.string().min(1),
    enabled: z.boolean(),
    entryMode: z.enum(['governed_only', 'free_chat']),
    baseUrl: z.string().url(),
    returnEndpointId: z.string().min(1),
    capabilities: WorkspaceCapabilitiesSchema,
    configuration: z.record(z.unknown()),
  })
  .strict();

const WorkspaceUpdateSchema = z
  .object({
    workspaceType: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    entryMode: z.enum(['governed_only', 'free_chat']).optional(),
    baseUrl: z.string().url().optional(),
    returnEndpointId: z.string().min(1).optional(),
    capabilities: WorkspaceCapabilitiesSchema.optional(),
    configuration: z.record(z.unknown()).optional(),
  })
  .strict();

// AMEND-nexus-planner-chat-tier-v0-2-0.md §3.5 — cross-field validation
// for free_chat workspaces. Mirrors the loader rules so the admin writer
// rejects bad shapes before the manifest is signed + reloaded.
function assertFreeChatCrossField(body: {
  entryMode?: string;
  capabilities?: {
    promptEntry?: boolean;
    planReview?: boolean;
    finalDisplay?: boolean;
    fileSpace?: boolean;
  };
  configuration?: Record<string, unknown>;
}): void {
  if (body.entryMode !== 'free_chat') return;
  const caps = body.capabilities;
  if (caps) {
    if (caps.planReview !== false) {
      throw Object.assign(
        new Error('free_chat workspace requires capabilities.planReview === false'),
        { statusCode: 400 }
      );
    }
    if (caps.promptEntry !== true) {
      throw Object.assign(
        new Error('free_chat workspace requires capabilities.promptEntry === true'),
        { statusCode: 400 }
      );
    }
    if (caps.fileSpace !== false) {
      throw Object.assign(
        new Error('free_chat workspace requires capabilities.fileSpace === false'),
        { statusCode: 400 }
      );
    }
    if (caps.finalDisplay !== true) {
      throw Object.assign(
        new Error('free_chat workspace requires capabilities.finalDisplay === true'),
        { statusCode: 400 }
      );
    }
  }
  const defaultChatAgentId = body.configuration?.['defaultChatAgentId'];
  if (typeof defaultChatAgentId !== 'string' || defaultChatAgentId.length === 0) {
    throw Object.assign(
      new Error(
        'free_chat workspace requires configuration.defaultChatAgentId as a non-empty string'
      ),
      { statusCode: 400 }
    );
  }
}

// ── AMEND-nexus-admin-dashboard-full-buildout §3.5.a — Mailboxes ───────────
//
// Schema mirrors MailboxManifestEntrySchema. mailboxType is open NonEmpty
// (loader convention); the spec's enum jsonl-file/sqlite/memory is
// reconciled to include the existing seed 'local_jsonl_reference'.
// At-least-one-file-backed-mailbox invariant enforced server-side: removing
// or disabling the last file-backed mailbox would silently break per-actor
// allocation in RefRunCoordinator step 3.6 (mailbox-pit law).
const MailboxRetentionPolicySchema = z
  .object({
    payloadTtlSeconds: z.number().int().min(60).max(86400),
    metadataRetention: z.literal('run_ledger'),
  })
  .strict();

const MailboxCreateSchema = z
  .object({
    mailboxId: z.string().min(1),
    mailboxType: z.string().min(1),
    enabled: z.boolean(),
    required: z.boolean(),
    storageRoot: z.string().min(1),
    retentionPolicy: MailboxRetentionPolicySchema,
    classificationRequired: z.boolean(),
    digestRequired: z.boolean(),
    configuration: z.record(z.unknown()),
  })
  .strict();

const MailboxUpdateSchema = z
  .object({
    mailboxType: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    required: z.boolean().optional(),
    storageRoot: z.string().min(1).optional(),
    retentionPolicy: MailboxRetentionPolicySchema.optional(),
    classificationRequired: z.boolean().optional(),
    digestRequired: z.boolean().optional(),
    configuration: z.record(z.unknown()).optional(),
  })
  .strict();

/**
 * File-backed mailbox types. Bootstrap step 3.6 (RefRunCoordinator) allocates
 * per-actor mailboxes; an in-memory-only manifest would break isolation. The
 * existing seed uses 'local_jsonl_reference'; the spec defines 'jsonl-file' /
 * 'sqlite'. Either ancestor counts as file-backed.
 */
const FILE_BACKED_MAILBOX_TYPES = new Set(['jsonl-file', 'sqlite', 'local_jsonl_reference']);

function assertAtLeastOneFileBackedMailboxRemains(
  mutatingId: string,
  entries: Record<string, unknown>[],
  willBeEnabled: boolean
): void {
  // Compute the post-mutation set: replace the mutating entry's enabled state
  // (delete = enabled false), then count file-backed-enabled entries.
  const remainingFileBacked = entries.filter(e => {
    const isTarget = e['mailboxId'] === mutatingId;
    const enabledAfter = isTarget ? willBeEnabled : e['enabled'] === true;
    return enabledAfter && FILE_BACKED_MAILBOX_TYPES.has(String(e['mailboxType']));
  });
  if (remainingFileBacked.length === 0) {
    throw Object.assign(
      new Error(
        'cannot leave zero enabled file-backed mailboxes — per-actor allocation requires at least one jsonl-file/sqlite mailbox'
      ),
      { statusCode: 409 }
    );
  }
}

// ── AMEND-nexus-admin-dashboard-full-buildout §3.5.b — Compilers ───────────
const CompilerArtifactSigningSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('control_plane') }).strict(),
  z.object({ kind: z.literal('actor_registry_key'), keyId: z.string().min(1) }).strict(),
]);

const CompilerCreateSchema = z
  .object({
    compilerSocketId: z.string().min(1),
    compilerType: z.string().min(1),
    enabled: z.boolean(),
    actorRegistration: z.enum(['exempt_reference_deterministic_renderer', 'required']),
    compilerActorId: z.union([z.string().min(1), z.null()]),
    octMode: z.literal('OCT-COMPILE'),
    allowedModes: z
      .array(z.enum(['deterministic_render', 'on_prem_synthesis', 'frontier_synthesis']))
      .min(1),
    readsFromMailboxId: z.string().min(1),
    outputContractVersion: z.literal('v1'),
    artifactSigning: CompilerArtifactSigningSchema,
    configuration: z.record(z.unknown()),
  })
  .strict();

const CompilerUpdateSchema = z
  .object({
    compilerType: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    actorRegistration: z.enum(['exempt_reference_deterministic_renderer', 'required']).optional(),
    compilerActorId: z.union([z.string().min(1), z.null()]).optional(),
    octMode: z.literal('OCT-COMPILE').optional(),
    allowedModes: z
      .array(z.enum(['deterministic_render', 'on_prem_synthesis', 'frontier_synthesis']))
      .min(1)
      .optional(),
    readsFromMailboxId: z.string().min(1).optional(),
    outputContractVersion: z.literal('v1').optional(),
    artifactSigning: CompilerArtifactSigningSchema.optional(),
    configuration: z.record(z.unknown()).optional(),
  })
  .strict();

// ── AMEND-nexus-admin-dashboard-full-buildout §3.5.c — Return endpoints ────
// Schema mirrors CompileReturnEndpointEntrySchema. endpointType is locked
// to 'http_callback' (the only loader-supported variant today); spec's
// 'http'/'cli'/'mcp' values are reconciled to the loader's literal.
const ReturnEndpointAuthSchema = z
  .object({ kind: z.literal('signed_callback'), keyId: z.string().min(1) })
  .strict();

const ReturnEndpointCreateSchema = z
  .object({
    returnEndpointId: z.string().min(1),
    endpointType: z.literal('http_callback'),
    enabled: z.boolean(),
    targetWorkspaceSocketId: z.string().min(1),
    url: z.string().url(),
    auth: ReturnEndpointAuthSchema,
    acceptedArtifactTypes: z.array(z.string().min(1)).min(1),
    configuration: z.record(z.unknown()),
  })
  .strict();

const ReturnEndpointUpdateSchema = z
  .object({
    endpointType: z.literal('http_callback').optional(),
    enabled: z.boolean().optional(),
    targetWorkspaceSocketId: z.string().min(1).optional(),
    url: z.string().url().optional(),
    auth: ReturnEndpointAuthSchema.optional(),
    acceptedArtifactTypes: z.array(z.string().min(1)).min(1).optional(),
    configuration: z.record(z.unknown()).optional(),
  })
  .strict();

// ── AMEND-nexus-admin-dashboard-full-buildout §3.7 — Admin keys ────────────
//
// JSON-based upload (NOT multipart — spec asked for multipart but JSON
// avoids adding a multer-equivalent dep; functionally equivalent, the
// admin pastes the keypair JSON). The route validates the keypair is a
// well-formed Ed25519 keypair JSON (publicKey + privateKey base64url
// strings) before writing. Existing files are renamed
// '<path>.replaced-<iso8601>' for one-rotation backup.
const AdminKeypairContentSchema = z
  .object({
    publicKey: z.string().min(1),
    privateKey: z.string().min(1),
    generatedAt: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
  })
  .strict();

/**
 * Body shape:
 *   - admin-signing: { keyKind:'admin-signing', keyId:<UUID-principalId>, content:{publicKey,privateKey,...} }
 *   - control-plane: { keyKind:'control-plane', content:{publicKey,privateKey,...} }  (keyId fixed to 'dev')
 *   - vault:         { keyKind:'vault', content:<base64url-string> } (keyId fixed to 'vault')
 */
const AdminKeyUploadSchema = z.discriminatedUnion('keyKind', [
  z
    .object({
      keyKind: z.literal('admin-signing'),
      keyId: z.string().uuid(),
      content: AdminKeypairContentSchema,
    })
    .strict(),
  z
    .object({
      keyKind: z.literal('control-plane'),
      content: AdminKeypairContentSchema,
    })
    .strict(),
  z
    .object({
      keyKind: z.literal('vault'),
      content: z.string().min(16), // base64url-ish symmetric key
    })
    .strict(),
]);

interface AdminKeyEntry {
  readonly keyId: string;
  readonly keyKind: 'admin-signing' | 'control-plane' | 'vault';
  readonly fingerprint: string | null;
  readonly present: boolean;
  readonly lastModified: string | null;
}

function fingerprintForPublicKey(publicKey: string): string {
  const hash = createHash('sha256').update(publicKey).digest('base64url');
  return `sha256:${hash.slice(0, 24)}`;
}

function fingerprintForVaultBytes(content: string): string {
  const hash = createHash('sha256').update(content).digest('base64url');
  return `sha256:${hash.slice(0, 24)}`;
}

async function listAdminKeyEntries(keyDir: string): Promise<readonly AdminKeyEntry[]> {
  const entries: AdminKeyEntry[] = [];
  // admin-signing keys: keyDir/admins/*.keypair.json
  const adminsDir = path.join(keyDir, 'admins');
  try {
    const files = await fs.readdir(adminsDir);
    for (const f of files) {
      if (!f.endsWith('.keypair.json')) continue;
      const principalId = f.slice(0, -'.keypair.json'.length);
      const filePath = path.join(adminsDir, f);
      try {
        const stat = await fs.stat(filePath);
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as { publicKey?: string };
        entries.push({
          keyId: principalId,
          keyKind: 'admin-signing',
          fingerprint: parsed.publicKey ? fingerprintForPublicKey(parsed.publicKey) : null,
          present: true,
          lastModified: stat.mtime.toISOString(),
        });
      } catch {
        // Skip files we can't parse — they're noise, not actionable in the list.
      }
    }
  } catch {
    // Directory missing — no admin-signing keys yet.
  }
  // control-plane key: keyDir/dev.keypair.json
  const cpPath = path.join(keyDir, 'dev.keypair.json');
  try {
    const stat = await fs.stat(cpPath);
    const raw = await fs.readFile(cpPath, 'utf-8');
    const parsed = JSON.parse(raw) as { publicKey?: string };
    entries.push({
      keyId: 'dev',
      keyKind: 'control-plane',
      fingerprint: parsed.publicKey ? fingerprintForPublicKey(parsed.publicKey) : null,
      present: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch {
    entries.push({
      keyId: 'dev',
      keyKind: 'control-plane',
      fingerprint: null,
      present: false,
      lastModified: null,
    });
  }
  // vault key: keyDir/vault.key
  const vaultPath = path.join(keyDir, 'vault.key');
  try {
    const stat = await fs.stat(vaultPath);
    const raw = await fs.readFile(vaultPath, 'utf-8');
    entries.push({
      keyId: 'vault',
      keyKind: 'vault',
      fingerprint: fingerprintForVaultBytes(raw.trim()),
      present: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch {
    entries.push({
      keyId: 'vault',
      keyKind: 'vault',
      fingerprint: null,
      present: false,
      lastModified: null,
    });
  }
  return entries;
}

function adminKeyFilePath(keyDir: string, keyKind: string, keyId: string): string | null {
  if (keyKind === 'admin-signing') return path.join(keyDir, 'admins', `${keyId}.keypair.json`);
  if (keyKind === 'control-plane') return path.join(keyDir, 'dev.keypair.json');
  if (keyKind === 'vault') return path.join(keyDir, 'vault.key');
  return null;
}

async function writeAdminKeyFile(
  filePath: string,
  content: unknown,
  isVaultRawString: boolean
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // One-rotation backup: rename any existing file before write.
  try {
    await fs.stat(filePath);
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.rename(filePath, `${filePath}.replaced-${iso}`);
  } catch {
    // No existing file — fresh write.
  }
  const body = isVaultRawString ? String(content) : JSON.stringify(content, null, 2);
  await fs.writeFile(filePath, body, { encoding: 'utf-8', mode: 0o600 });
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // chmod may be a no-op on some platforms (Windows-WSL edge); the
    // initial writeFile mode arg covers the common case.
  }
}

/**
 * AMEND-nexus-admin-arc4-fixups §1.1 — admin-signing companion public.json.
 *
 * Writes a `{ publicKey }` JSON file at 0644 alongside the keypair so
 * `loadAdminPublicKey` (mode-manager.ts:184-192) can resolve the signer
 * without loading private material. One-rotation backup matches the
 * keypair file behavior so the two files stay in sync across rotation.
 */
async function writeAdminPublicKeyFile(filePath: string, publicKey: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.stat(filePath);
    const iso = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.rename(filePath, `${filePath}.replaced-${iso}`);
  } catch {
    // No existing file — fresh write.
  }
  const body = JSON.stringify({ publicKey }, null, 2);
  await fs.writeFile(filePath, body, { encoding: 'utf-8', mode: 0o644 });
}

/**
 * Secret schemas. keyName format (UPPER_SNAKE_CASE, ≤128 chars) is enforced
 * at the Zod boundary so F4.13's `withAdminMutation` wrapper rejects the
 * request at parsePayload (400) — BEFORE writing `admin_mutation_intent`.
 * The ledger only sees attempted mutations with structurally valid input.
 */
const SECRET_KEY_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const SECRET_MAX_KEY_NAME_LEN = 128;
const SECRET_MAX_KEY_VALUE_LEN = 8 * 1024;
const SecretCreateSchema = z
  .object({
    keyName: z
      .string()
      .min(1)
      .max(SECRET_MAX_KEY_NAME_LEN)
      .refine(s => SECRET_KEY_NAME_RE.test(s), {
        message: 'keyName must be upper-snake-case ([A-Z][A-Z0-9_]*) and ≤128 chars',
      }),
    keyValue: z.string().min(1).max(SECRET_MAX_KEY_VALUE_LEN),
  })
  .strict();

/**
 * Format a ZodError as a `{ ok: false, error, details }` response and
 * write it. Centralized so every route uses the same wire shape.
 */
function sendValidationError(res: Response, err: z.ZodError): void {
  res.status(400).json({
    ok: false,
    error: 'Validation failed',
    details: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
  });
}

/**
 * F4.13 §3.1 — bridge a Zod schema into the `withAdminMutation` parsePayload
 * signature. Mirrors the wire shape of `sendValidationError` so existing
 * callers that asserted on the `{ error: 'Validation failed', details }`
 * response continue to pass after the wrapper merges the failure into a
 * 400 response.
 */
function parsePayloadWithZod<T>(schema: z.ZodType<T>): (body: unknown) =>
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      details: ReadonlyArray<{ path: string; message: string }>;
    } {
  return body => {
    const parsed = schema.safeParse(body);
    if (parsed.success) return { ok: true, data: parsed.data };
    return {
      ok: false,
      status: 400,
      error: 'Validation failed',
      details: parsed.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  };
}

/**
 * F4.13 — translate a thrown error into an AdminMutationHandlerOutcome.
 * Preserves the `statusCode` convention used by the manifest writer + lock
 * helpers so existing 423 / 409 / 412 / 404 status codes flow through the
 * wrapper without remapping.
 */
function failureFromError(err: unknown): AdminMutationHandlerOutcome {
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  return { kind: 'failed', reason: san(err), statusCode };
}

/**
 * Drop `undefined`-valued keys from an object so spreading the result
 * onto a typed target doesn't violate `exactOptionalPropertyTypes`.
 * Zod's `.optional()` produces `T | undefined` types whose `undefined`
 * values can't be explicitly assigned to a strict target.
 */
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<T>;
}

// ── ManifestWriter interface (Layer 7 contract for DI) ──────────────────────

export interface ManifestWriter {
  /** Read raw manifest entries (ALL entries, including disabled). */
  readEntries(manifestPath: string, arrayKey: string): Promise<Record<string, unknown>[]>;
  addEntry(
    manifestPath: string,
    arrayKey: string,
    entry: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
  updateEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    updates: Record<string, unknown>,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
  removeEntry(
    manifestPath: string,
    arrayKey: string,
    entryId: string,
    idKey: string
  ): Promise<Record<string, unknown>[]>;
}

// ── SecretWriter interface — admin secret onboarding ──────────────────────
//
// Layer 7 cannot import the FileSecretSource directly (Layer 3). Bootstrap
// constructs a FileSecretSource and adapts it to this minimal write+presence
// surface so the admin secret routes never touch values they don't own.
//
// NEVER add a "readSecret" method here. Status routes return presence, not
// value (CLAUDE-CODE-SECRET-MANAGEMENT-SPEC §"WHAT'S FORBIDDEN").

export interface SecretWriter {
  /** Write a key. Throws on invalid input or unrecoverable backend errors. */
  writeSecret(keyName: string, keyValue: string): Promise<void>;
  /** Delete a key. Returns true if a key was removed. */
  deleteSecret(keyName: string): Promise<boolean>;
  /** List stored key names — names ONLY, never values. */
  listKeyNames(): Promise<readonly string[]>;
  /** Backing storage label for evidence display (e.g. "keys/secrets.json"). */
  readonly storageLabel: string;
}

// ── File lock (WRITER-004) — in-memory, single-process ──────────────────────

interface FileLock {
  readonly adminUserId: string;
  readonly acquiredAt: number;
}

const locks = new Map<string, FileLock>();
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function acquireLock(
  filePath: string,
  adminUserId: string
): { ok: true } | { ok: false; heldBy: string } {
  const existing = locks.get(filePath);
  if (existing) {
    if (existing.adminUserId === adminUserId) {
      locks.set(filePath, { adminUserId, acquiredAt: Date.now() });
      return { ok: true };
    }
    if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
      locks.delete(filePath);
    } else {
      return { ok: false, heldBy: existing.adminUserId };
    }
  }
  locks.set(filePath, { adminUserId, acquiredAt: Date.now() });
  return { ok: true };
}

function releaseLock(filePath: string, adminUserId: string): void {
  const existing = locks.get(filePath);
  if (existing && existing.adminUserId === adminUserId) {
    locks.delete(filePath);
  }
}

function checkLockStatus(filePath: string): FileLock | null {
  const existing = locks.get(filePath);
  if (!existing) return null;
  if (Date.now() - existing.acquiredAt > LOCK_TIMEOUT_MS) {
    locks.delete(filePath);
    return null;
  }
  return existing;
}

const MANIFEST_ENDPOINTS = 'config/nvg/endpoints.v1.yaml';
const MANIFEST_CONNECTORS = 'config/connectors/connectors.v1.yaml';
// ── AMEND-nexus-admin-dashboard-full-buildout §4.2 — catalog all* arrays ────
// The catalog handler reads these seven manifests so panels can drive their
// own dropdowns / cross-surface FK validation without round-trips per panel.
//
// Note on §3.5.c path: spec calls the path `return-endpoints.v1.yaml`; the
// codebase has used `compile-return.v1.yaml` since AMEND-spec §4.6 — the
// loader + signed manifest live there. Keeping the existing path here keeps
// the manifest loadable; the catalog field name (`allReturnEndpoints`) and
// array key (`returnEndpoints`) match the spec.
const MANIFEST_IDENTITY_PROVIDERS = 'config/identity/providers.v1.yaml';
const MANIFEST_CHANNELS = 'config/channels/channels.v1.yaml';
const MANIFEST_ORCHESTRATORS = 'config/orchestrators/orchestrators.v1.yaml';
const MANIFEST_WORKSPACES = 'config/workspace/workspaces.v1.yaml';
const MANIFEST_MAILBOXES = 'config/mailbox/mailboxes.v1.yaml';
const MANIFEST_COMPILERS = 'config/compile/compilers.v1.yaml';
const MANIFEST_RETURN_ENDPOINTS = 'config/output/compile-return.v1.yaml';

export interface AdminWriterRouteDeps {
  readonly elevatedAuthProvider?: ElevatedAuthProvider;
  readonly manifestWriter?: ManifestWriter;
  readonly actorRegistry?: ActorRegistry;
  /** Registered principals — used by the catalog route for the principalId dropdown. */
  readonly principalRegistry?: PrincipalRegistry;
  /**
   * Admin secret store (file-backed). When omitted, the secret routes return
   * 501 — the rest of the writer surface keeps working.
   */
  readonly secretWriter?: SecretWriter;
  /**
   * Run ledger writer for credential-lifecycle audit events
   * (`secret_stored` / `secret_removed`). When omitted, secret writes still
   * succeed but no audit entry is emitted — operators in production should
   * treat that as a misconfiguration. Same shape as templates.ts wiring.
   */
  readonly runLedgerWriter?: RunLedgerWriter;
  /**
   * Override the on-disk admin-key directory + mode-config path for tests.
   * Production defaults: 'keys/' and 'keys/mode-config.json'. AMEND §3.7
   * uses these for admin-signing/control-plane/vault key files; AMEND §3.6
   * uses the mode-config path for the signed mode envelope.
   */
  readonly keyDirectory?: string;
  readonly modeConfigPath?: string;
  /**
   * Mode signer for AMEND §3.6. Production: composition root wraps
   * @nexus/core's changeMode + loadModeConfig + saveModeConfig with the
   * admin signing keypair loaded from keys/admins/<principalId>.keypair.json.
   * Tests inject a mock.
   *
   * When omitted, mode routes return 501.
   */
  readonly modeSigner?: ModeSigner;
  /**
   * F4.1 SigningCouncil port. When provided, the `/workspace/admin/signing/*`
   * routes are wired; when omitted, those routes return 501.
   */
  readonly signingCouncil?: import('@nexus/contracts').SigningCouncilPort;
  /**
   * F4.1 / feedback_signing_keys_server_side — server-side Ed25519 signer
   * for admins that POST to /workspace/admin/signing/requests/:id/signatures
   * without a pre-computed signature (the browser never holds the admin
   * keypair). The wrapper loads the elevated admin's keypair, signs the
   * canonical envelope, and feeds the bytes to `signingCouncil.sign()`.
   * Absent → external (pre-signed) clients still work; UI clients get 403.
   */
  readonly signingCouncilServerSigner?: SigningCouncilServerSignerPort;
  /**
   * F4.5 OCT manager port. Production wires this to @nexus/core's
   * assignOct(req, registry, ledger) closure; tests inject a mock. When
   * omitted, /workspace/admin/oct/assign returns 501.
   */
  readonly octManager?: AdminOctManagerPort;
  // ── F4.13 SignedAdminMutation enforcement (HL #10) ───────────────────────
  // The four ports below back the `withAdminMutation` wrapper that gates
  // every mutation route. Their absence triggers a 503 with denial code
  // AUDIT_UNAVAILABLE at request time — the wrapper fails closed.
  /** Q13 baked port — daily-bucket + monotonic-sequence run id namespace. */
  readonly infraRunIdNamespace?: InfraRunIdNamespace;
  /** F4.13 §2.1 — Ed25519 verifier for SignedAdminMutation envelopes. */
  readonly adminMutationVerifier?: AdminMutationVerifierPort;
  /** F4.13 §3.1 — nonce replay store (per-process in-memory by default). */
  readonly adminMutationNonceStore?: AdminMutationNonceStorePort;
  /**
   * F4.13 §3.1 — server-side signer for UI sessions that post a plain
   * payload (per feedback_signing_keys_server_side: browser never holds
   * the admin keypair). The wrapper forges a SignedAdminMutation envelope
   * from the elevated admin's server-side keypair when the request body
   * does not carry one.
   */
  readonly adminMutationServerSigner?: AdminMutationServerSignerPort;
  /**
   * F4.13 §3.5 — current ModeConfiguration loader. The wrapper reads
   * `nxsMode` to decide whether observe-mode should short-circuit the
   * mutation. Absent loader → default enforcing (most-strict).
   */
  readonly loadModeConfig?: () => Promise<ModeConfiguration>;
  /**
   * F4.13 §3.2 — true when the run ledger backend supports transactional
   * rollback on post-mutation write failure. JsonlRunLedgerWriter is NOT
   * transactional → false. SQLite-backed variant → true.
   */
  readonly runLedgerSupportsTransactionalRollback?: boolean;
}

/**
 * F4.5 OctManagerPort facade. Plug-in admin-writer calls into this port;
 * production binds it to the baked @nexus/core assignOct closure (the
 * server has both an ActorRegistry and a RunLedgerWriter in its scope).
 */
export interface AdminOctManagerPort {
  assignOct(req: import('@nexus/contracts').SignedOctAssignmentRequest): Promise<{
    actorId: string;
    octLevel: string;
  }>;
}

// ── F4.1 SigningCouncil server-side signer (feedback_signing_keys_server_side) ─
//
// UI clients post to /workspace/admin/signing/requests/:id/signatures
// without an Ed25519 signature; the browser MUST NOT hold the admin
// keypair. This port loads the elevated admin's keypair server-side and
// signs the canonical envelope the council expects (envelope = canonicalize
// of {requestId, operation, payloadDigest, openedAt}). The route forwards
// the resulting bytes to `signingCouncil.sign(requestId, principalId, sig)`.
//
// External clients (CLI, scripts, third parties) can bypass this port by
// pre-signing and posting the signature in the request body; the route
// honors a pre-supplied signature when present and only invokes the
// server-side signer when the body omits `signature`.
export interface SigningCouncilServerSignerPort {
  /**
   * Sign the council's canonical envelope using the elevated admin's
   * keypair. Returns base64url-encoded Ed25519 signature bytes. Throws
   * with statusCode set when the principal has no keypair on disk
   * (manifests as 403/412 from the route).
   */
  signEnvelope(input: {
    readonly principalId: import('@nexus/contracts').NonEmpty;
    readonly canonicalEnvelope: string;
  }): Promise<import('@nexus/contracts').Base64Url>;
}

// ── AMEND §3.6 — ModeSigner port ────────────────────────────────────────────
//
// Layer 7 cannot import @nexus/core directly. The port encapsulates the
// signing operation (load current → check enforcing-lock → sign envelope →
// save + emit run-ledger event) behind a minimal interface.
export interface ModeSignerState {
  readonly nxsMode: 'observe' | 'advisory' | 'enforcing';
  readonly nvgMode: 'observe' | 'advisory' | 'enforcing';
  readonly enforcingLocked: boolean;
  readonly updatedAt: string;
  readonly updatedBy: { adminId: string; publicKey: string };
  /** First 32 chars of the signature (display only — never the private key). */
  readonly signatureFingerprint: string;
}

export interface ModeSigner {
  /**
   * Whether keys/admins/<principalId>.keypair.json exists. Drives the
   * panel's fallback CLI-instructions block when the elevated admin has
   * not provisioned a keypair.
   */
  hasSigningKeypair(adminPrincipalId: string): Promise<boolean>;
  /** Read + verify the current mode envelope. */
  loadCurrentState(): Promise<ModeSignerState>;
  /**
   * Change a mode using the admin's signing keypair. Throws with
   * .statusCode=412 if the keypair is missing, 409 if enforcing-lock
   * blocks the downgrade, or 400 if mode is invalid.
   */
  changeMode(input: {
    engine: 'nxs' | 'nvg';
    mode: 'observe' | 'advisory' | 'enforcing';
    adminPrincipalId: string;
  }): Promise<ModeSignerState>;
  /**
   * F4.17: Enforcing-lock unlock from the dashboard now requires
   * SigningCouncil 2-of-2 (Spec F4.1, operation='mode_unlock'). The
   * single-admin override is retired (P0-023, P0-034). This method
   * remains in the interface for backwards-compat of dependent code
   * but throws 409 until SigningCouncil ratifies the request.
   */
  unlockEnforcing(adminPrincipalId: string): Promise<ModeSignerState>;
}

// ── Generic manifest CRUD route helper ──────────────────────────────────────
//
// AMEND-nexus-admin-dashboard-full-buildout §3.1–§3.5 — seven new manifest
// surfaces share the same shape (Zod-validate body → acquire lock → mutate
// via injected ManifestWriter → release lock → respond). Without this
// helper, each surface would be ~150 lines of near-duplicate route code.
//
// Surfaces with cross-surface or last-enabled invariants pass a guard via
// `extraCheck` / `extraDeleteCheck`; everything else uses the default.
interface ManifestCrudConfig<TCreate, TUpdate> {
  /** REST path prefix, e.g. '/workspace/admin/setup/identity-providers'. */
  readonly basePath: string;
  /** Manifest YAML path, e.g. 'config/identity/providers.v1.yaml'. */
  readonly manifestPath: string;
  /** Body array key, e.g. 'providers'. */
  readonly arrayKey: string;
  /** Path-segment id and entry primary key, e.g. 'providerId'. */
  readonly idKey: string;
  /** URL path-param name (defaults to idKey). */
  readonly paramName?: string;
  /** Zod schema for POST body. */
  readonly createSchema: z.ZodType<TCreate>;
  /** Zod schema for PUT body. */
  readonly updateSchema: z.ZodType<TUpdate>;
  /**
   * Pre-write hook for CREATE. Receives the validated body + current
   * entries; throws an Error (optionally with .statusCode) to reject.
   */
  readonly preCreate?: (body: TCreate, entries: Record<string, unknown>[]) => void | Promise<void>;
  /**
   * Pre-write hook for UPDATE. Receives the path id, validated body, and
   * current entries. Throws to reject.
   */
  readonly preUpdate?: (
    id: string,
    body: TUpdate,
    entries: Record<string, unknown>[]
  ) => void | Promise<void>;
  /**
   * Pre-write hook for DELETE — used for last-enabled and cross-surface
   * referential-integrity guards. Throws to reject.
   */
  readonly preDelete?: (id: string, entries: Record<string, unknown>[]) => void | Promise<void>;
}

function registerManifestCrud<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
>(app: Express, deps: AdminWriterRouteDeps, cfg: ManifestCrudConfig<TCreate, TUpdate>): void {
  const paramName = cfg.paramName ?? cfg.idKey;

  app.post(
    cfg.basePath,
    withAdminMutation<TCreate>(deps, {
      mutationKind: 'manifest_entry_add',
      parsePayload: parsePayloadWithZod(cfg.createSchema),
      handler: async (payload, ctx) => {
        if (!deps.manifestWriter) {
          return {
            kind: 'failed',
            reason: 'Manifest writer not configured',
            statusCode: 501,
          };
        }
        const lock = acquireLock(cfg.manifestPath, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const current = await deps
            .manifestWriter!.readEntries(cfg.manifestPath, cfg.arrayKey)
            .catch(() => [] as Record<string, unknown>[]);
          if (cfg.preCreate) await cfg.preCreate(payload, current);
          const entry = payload as Record<string, unknown>;
          await deps.manifestWriter!.addEntry(cfg.manifestPath, cfg.arrayKey, entry, cfg.idKey);
          releaseLock(cfg.manifestPath, ctx.opener);
          return {
            kind: 'ok',
            result: { [cfg.idKey]: entry[cfg.idKey], requiresRestart: true },
          };
        } catch (err) {
          releaseLock(cfg.manifestPath, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  app.put(
    `${cfg.basePath}/:${paramName}`,
    withAdminMutation<TUpdate>(deps, {
      mutationKind: 'manifest_entry_update',
      parsePayload: parsePayloadWithZod(cfg.updateSchema),
      handler: async (payload, ctx) => {
        if (!deps.manifestWriter) {
          return {
            kind: 'failed',
            reason: 'Manifest writer not configured',
            statusCode: 501,
          };
        }
        const lock = acquireLock(cfg.manifestPath, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          // The wrapper does not surface req.params, so the route handler
          // reads the id from the raw request via a stash inside the
          // outcome path. Express attaches params to the underlying req
          // object; the wrapper's parsePayload also receives req.body
          // only. We recover the path id through res.req.params here.
          // (See res.req in Express's typings — bidirectional reference.)
          const id = String(ctx.req.params?.[paramName] ?? '');
          if (!id) {
            return {
              kind: 'failed',
              reason: `missing path parameter ${paramName}`,
              statusCode: 400,
            };
          }
          const current = await deps
            .manifestWriter!.readEntries(cfg.manifestPath, cfg.arrayKey)
            .catch(() => [] as Record<string, unknown>[]);
          if (cfg.preUpdate) await cfg.preUpdate(id, payload, current);
          await deps.manifestWriter!.updateEntry(
            cfg.manifestPath,
            cfg.arrayKey,
            id,
            payload,
            cfg.idKey
          );
          releaseLock(cfg.manifestPath, ctx.opener);
          return { kind: 'ok', result: { [cfg.idKey]: id, requiresRestart: true } };
        } catch (err) {
          releaseLock(cfg.manifestPath, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  app.delete(
    `${cfg.basePath}/:${paramName}`,
    withAdminMutation<TUpdate>(deps, {
      mutationKind: 'manifest_entry_remove',
      // DELETE has no body payload — the wrapper still requires a
      // parsePayload (so the same envelope path applies); pass-through
      // returns an empty marker object.
      parsePayload: () => ({ ok: true, data: {} as TUpdate }),
      handler: async (_payload, ctx) => {
        if (!deps.manifestWriter) {
          return {
            kind: 'failed',
            reason: 'Manifest writer not configured',
            statusCode: 501,
          };
        }
        const lock = acquireLock(cfg.manifestPath, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const id = String(ctx.req.params?.[paramName] ?? '');
          if (!id) {
            return {
              kind: 'failed',
              reason: `missing path parameter ${paramName}`,
              statusCode: 400,
            };
          }
          const current = await deps
            .manifestWriter!.readEntries(cfg.manifestPath, cfg.arrayKey)
            .catch(() => [] as Record<string, unknown>[]);
          if (cfg.preDelete) await cfg.preDelete(id, current);
          await deps.manifestWriter!.removeEntry(cfg.manifestPath, cfg.arrayKey, id, cfg.idKey);
          releaseLock(cfg.manifestPath, ctx.opener);
          return {
            kind: 'ok',
            result: { [cfg.idKey]: id, removed: true, requiresRestart: true },
          };
        } catch (err) {
          releaseLock(cfg.manifestPath, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );
}

/**
 * Last-enabled-of-kind guard helper. Throws a 409 if removing this entry
 * would leave zero enabled entries. Used by identity-provider (must always
 * have at least one provider an admin can sign in through), approval-channel
 * (under NXS enforcing — but applied unconditionally per §3.2: at least one
 * approval surface must exist), orchestrator (server must have an orch
 * socket), workspace (server must accept some workspace traffic), mailbox
 * (per-actor allocation requires a file-backed mailbox).
 */
function assertNotLastEnabled(
  id: string,
  entries: Record<string, unknown>[],
  idKey: string,
  errMsg: string
): void {
  const target = entries.find(e => e[idKey] === id);
  if (!target || target['enabled'] !== true) return; // already disabled or missing — no guard
  const enabledCount = entries.filter(e => e['enabled'] === true).length;
  if (enabledCount <= 1) {
    throw Object.assign(new Error(errMsg), { statusCode: 409 });
  }
}

async function probeEndpointHealth(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    return false;
  }
}

// F4.13 §3.4 / P0-024 — the legacy `emitSecretAuditEvent` helper was retired
// when the SignedAdminMutation wrapper became the sole audit path for
// credential-lifecycle mutations. The wrapper emits admin_mutation_intent +
// admin_mutation_committed (or _failed) around every secret_store /
// secret_remove call and FAILS CLOSED with DENIAL_CODE.AUDIT_UNAVAILABLE
// when the run ledger writer is unavailable — no silent no-op, no
// best-effort console.warn, no ledger-gap that operators have to detect
// out-of-band.

export function registerAdminWriterRoutes(app: Express, deps: AdminWriterRouteDeps): void {
  // ═══ SURFACE 1: Model Endpoints (YAML manifest) ═══
  app.post(
    '/workspace/admin/setup/endpoints',
    withAdminMutation<z.infer<typeof EndpointCreateSchema>>(deps, {
      mutationKind: 'manifest_entry_add',
      parsePayload: parsePayloadWithZod(EndpointCreateSchema),
      handler: async (payload, ctx) => {
        if (!deps.manifestWriter) {
          return { kind: 'failed', reason: 'Manifest writer not configured', statusCode: 501 };
        }
        const lock = acquireLock(MANIFEST_ENDPOINTS, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const entry: Record<string, unknown> = {
            ...payload,
            enabled: payload.enabled ?? true,
            auth: payload.auth ?? { kind: 'none' },
          };
          await deps.manifestWriter.addEntry(MANIFEST_ENDPOINTS, 'endpoints', entry, 'endpointId');
          const healthy = await probeEndpointHealth(payload.url);
          releaseLock(MANIFEST_ENDPOINTS, ctx.opener);
          return {
            kind: 'ok',
            result: { endpointId: payload.endpointId, healthy, requiresRestart: true },
          };
        } catch (err) {
          releaseLock(MANIFEST_ENDPOINTS, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  app.put(
    '/workspace/admin/setup/endpoints/:endpointId',
    withAdminMutation<z.infer<typeof EndpointUpdateSchema>>(deps, {
      mutationKind: 'manifest_entry_update',
      parsePayload: parsePayloadWithZod(EndpointUpdateSchema),
      handler: async (payload, ctx) => {
        if (!deps.manifestWriter) {
          return { kind: 'failed', reason: 'Manifest writer not configured', statusCode: 501 };
        }
        const lock = acquireLock(MANIFEST_ENDPOINTS, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const eid = String(ctx.req.params['endpointId']);
          const entries = await deps.manifestWriter.updateEntry(
            MANIFEST_ENDPOINTS,
            'endpoints',
            eid,
            payload,
            'endpointId'
          );
          const updated = entries.find(e => e['endpointId'] === eid);
          const healthy = updated?.['url']
            ? await probeEndpointHealth(String(updated['url']))
            : undefined;
          releaseLock(MANIFEST_ENDPOINTS, ctx.opener);
          return {
            kind: 'ok',
            result: { endpointId: eid, healthy, requiresRestart: true },
          };
        } catch (err) {
          releaseLock(MANIFEST_ENDPOINTS, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  app.delete(
    '/workspace/admin/setup/endpoints/:endpointId',
    withAdminMutation<Record<string, never>>(deps, {
      mutationKind: 'manifest_entry_remove',
      parsePayload: () => ({ ok: true, data: {} as Record<string, never> }),
      handler: async (_payload, ctx) => {
        if (!deps.manifestWriter) {
          return { kind: 'failed', reason: 'Manifest writer not configured', statusCode: 501 };
        }
        const lock = acquireLock(MANIFEST_ENDPOINTS, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const eid = String(ctx.req.params['endpointId']);
          await deps.manifestWriter.removeEntry(MANIFEST_ENDPOINTS, 'endpoints', eid, 'endpointId');
          releaseLock(MANIFEST_ENDPOINTS, ctx.opener);
          return {
            kind: 'ok',
            result: { endpointId: eid, removed: true, requiresRestart: true },
          };
        } catch (err) {
          releaseLock(MANIFEST_ENDPOINTS, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  // ═══ SURFACE 2: Actors & Agents (SQLite — immediate) ═══
  app.post(
    '/workspace/admin/setup/actors',
    withAdminMutation<z.infer<typeof ActorCreateSchema>>(deps, {
      mutationKind: 'actor_register',
      parsePayload: parsePayloadWithZod(ActorCreateSchema),
      handler: async (payload, _ctx) => {
        if (!deps.actorRegistry) {
          return { kind: 'failed', reason: 'Actor registry not configured', statusCode: 501 };
        }
        try {
          // Strip undefined optional fields before handing to the registry —
          // it shapes its own typed Actor record from the input. The cast
          // through `unknown` is the documented bridge between the schema's
          // structural type and the registry's nominal Actor type; runtime
          // validation in `register` is the authoritative gate.
          const actor: Record<string, unknown> = {
            ...omitUndefined(payload),
            enabled: payload.enabled ?? true,
            registeredAt: payload.registeredAt ?? nowIso(),
          };
          await deps.actorRegistry.register(
            actor as unknown as Parameters<typeof deps.actorRegistry.register>[0]
          );
          return {
            kind: 'ok',
            result: { actorId: payload.actorId, requiresRestart: false },
          };
        } catch (err) {
          return failureFromError(err);
        }
      },
    })
  );

  app.put(
    '/workspace/admin/setup/actors/:actorId',
    withAdminMutation<z.infer<typeof ActorUpdateSchema>>(deps, {
      mutationKind: 'agent_config_update',
      parsePayload: parsePayloadWithZod(ActorUpdateSchema),
      handler: async (payload, ctx) => {
        if (!deps.actorRegistry) {
          return { kind: 'failed', reason: 'Actor registry not configured', statusCode: 501 };
        }
        try {
          const actorId = String(ctx.req.params['actorId']);
          const existing = await deps.actorRegistry.get(actorId as Uuid);
          if (!existing) {
            return {
              kind: 'failed',
              reason: 'Actor ' + actorId + ' not found',
              statusCode: 404,
            };
          }
          const updated = {
            ...existing,
            ...omitUndefined(payload),
            actorId: existing.actorId,
          };
          await deps.actorRegistry.update(
            actorId as Uuid,
            updated as unknown as Parameters<typeof deps.actorRegistry.update>[1]
          );
          return { kind: 'ok', result: { actorId, requiresRestart: false } };
        } catch (err) {
          return failureFromError(err);
        }
      },
    })
  );

  app.delete(
    '/workspace/admin/setup/actors/:actorId',
    withAdminMutation<Record<string, never>>(deps, {
      mutationKind: 'actor_deregister',
      parsePayload: () => ({ ok: true, data: {} as Record<string, never> }),
      handler: async (_payload, ctx) => {
        if (!deps.actorRegistry) {
          return { kind: 'failed', reason: 'Actor registry not configured', statusCode: 501 };
        }
        try {
          const actorId = String(ctx.req.params['actorId']);
          const existing = await deps.actorRegistry.get(actorId as Uuid);
          if (!existing) {
            return {
              kind: 'failed',
              reason: 'Actor ' + actorId + ' not found',
              statusCode: 404,
            };
          }
          await deps.actorRegistry.delete(actorId as Uuid);
          return {
            kind: 'ok',
            result: { actorId, deleted: true, requiresRestart: false },
          };
        } catch (err) {
          return failureFromError(err);
        }
      },
    })
  );

  // ═══ SURFACE 3: Connectors (YAML manifest) ═══
  app.post(
    '/workspace/admin/setup/connectors',
    withAdminMutation<z.infer<typeof ConnectorCreateSchema>>(deps, {
      mutationKind: 'connector_register',
      parsePayload: parsePayloadWithZod(ConnectorCreateSchema),
      handler: async (payload, ctx) => {
        if (!deps.manifestWriter) {
          return { kind: 'failed', reason: 'Manifest writer not configured', statusCode: 501 };
        }
        const lock = acquireLock(MANIFEST_CONNECTORS, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const entry: Record<string, unknown> = {
            ...payload,
            enabled: payload.enabled ?? true,
            configuration: payload.configuration ?? {},
          };
          await deps.manifestWriter.addEntry(
            MANIFEST_CONNECTORS,
            'connectors',
            entry,
            'connectorId'
          );
          releaseLock(MANIFEST_CONNECTORS, ctx.opener);
          return {
            kind: 'ok',
            result: { connectorId: payload.connectorId, requiresRestart: true },
          };
        } catch (err) {
          releaseLock(MANIFEST_CONNECTORS, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  app.put(
    '/workspace/admin/setup/connectors/:connectorId',
    withAdminMutation<z.infer<typeof ConnectorUpdateSchema>>(deps, {
      mutationKind: 'manifest_entry_update',
      parsePayload: parsePayloadWithZod(ConnectorUpdateSchema),
      handler: async (payload, ctx) => {
        if (!deps.manifestWriter) {
          return { kind: 'failed', reason: 'Manifest writer not configured', statusCode: 501 };
        }
        const lock = acquireLock(MANIFEST_CONNECTORS, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const cid = String(ctx.req.params['connectorId']);
          await deps.manifestWriter.updateEntry(
            MANIFEST_CONNECTORS,
            'connectors',
            cid,
            payload,
            'connectorId'
          );
          releaseLock(MANIFEST_CONNECTORS, ctx.opener);
          return { kind: 'ok', result: { connectorId: cid, requiresRestart: true } };
        } catch (err) {
          releaseLock(MANIFEST_CONNECTORS, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  app.delete(
    '/workspace/admin/setup/connectors/:connectorId',
    withAdminMutation<Record<string, never>>(deps, {
      mutationKind: 'connector_deregister',
      parsePayload: () => ({ ok: true, data: {} as Record<string, never> }),
      handler: async (_payload, ctx) => {
        if (!deps.manifestWriter) {
          return { kind: 'failed', reason: 'Manifest writer not configured', statusCode: 501 };
        }
        const lock = acquireLock(MANIFEST_CONNECTORS, ctx.opener);
        if (!lock.ok) {
          return {
            kind: 'failed',
            reason: 'Manifest locked by ' + lock.heldBy,
            statusCode: 423,
          };
        }
        try {
          const cid = String(ctx.req.params['connectorId']);
          await deps.manifestWriter.removeEntry(
            MANIFEST_CONNECTORS,
            'connectors',
            cid,
            'connectorId'
          );
          releaseLock(MANIFEST_CONNECTORS, ctx.opener);
          return {
            kind: 'ok',
            result: { connectorId: cid, removed: true, requiresRestart: true },
          };
        } catch (err) {
          releaseLock(MANIFEST_CONNECTORS, ctx.opener);
          return failureFromError(err);
        }
      },
    })
  );

  // ═══ SURFACE 5: Identity providers — AMEND-nexus-admin-dashboard §3.1 ═══
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/identity-providers',
    manifestPath: MANIFEST_IDENTITY_PROVIDERS,
    arrayKey: 'providers',
    idKey: 'providerId',
    createSchema: IdentityProviderCreateSchema,
    updateSchema: IdentityProviderUpdateSchema,
    preDelete: (id, entries) =>
      assertNotLastEnabled(
        id,
        entries,
        'providerId',
        'cannot remove last enabled identity provider'
      ),
  });

  // ═══ SURFACE 10: Compilers — AMEND-nexus-admin-dashboard §3.5.b ═══
  // Last-enabled-compiler guard: at least one enabled compiler must remain.
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/compilers',
    manifestPath: MANIFEST_COMPILERS,
    arrayKey: 'compilers',
    idKey: 'compilerSocketId',
    paramName: 'socketId',
    createSchema: CompilerCreateSchema,
    updateSchema: CompilerUpdateSchema,
    preDelete: (id, entries) =>
      assertNotLastEnabled(id, entries, 'compilerSocketId', 'cannot remove last enabled compiler'),
  });

  // ═══ SURFACE 11: Return endpoints — AMEND-nexus-admin-dashboard §3.5.c ═══
  // Cross-surface FK validation: targetWorkspaceSocketId must reference an
  // enabled workspace in MANIFEST_WORKSPACES. Per §8 best-solve decision,
  // cardinality is N:1 (multiple workspaces can share one return endpoint;
  // multiple return endpoints can also target the same workspace).
  const assertTargetWorkspaceExists = async (
    body: { targetWorkspaceSocketId?: string },
    label: 'create' | 'update'
  ): Promise<void> => {
    if (!body.targetWorkspaceSocketId) return;
    if (!deps.manifestWriter) return;
    const workspaces = await deps.manifestWriter
      .readEntries(MANIFEST_WORKSPACES, 'workspaces')
      .catch(() => [] as Record<string, unknown>[]);
    const target = workspaces.find(w => w['workspaceSocketId'] === body.targetWorkspaceSocketId);
    if (!target) {
      throw Object.assign(
        new Error(
          `cannot ${label}: workspace ${body.targetWorkspaceSocketId} not found in workspace manifest`
        ),
        { statusCode: 409 }
      );
    }
    if (target['enabled'] !== true) {
      throw Object.assign(
        new Error(`cannot ${label}: workspace ${body.targetWorkspaceSocketId} is not enabled`),
        { statusCode: 409 }
      );
    }
  };
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/return-endpoints',
    manifestPath: MANIFEST_RETURN_ENDPOINTS,
    arrayKey: 'returnEndpoints',
    idKey: 'returnEndpointId',
    paramName: 'returnEndpointId',
    createSchema: ReturnEndpointCreateSchema,
    updateSchema: ReturnEndpointUpdateSchema,
    preCreate: body =>
      assertTargetWorkspaceExists(body as { targetWorkspaceSocketId?: string }, 'create'),
    preUpdate: (_id, body) =>
      assertTargetWorkspaceExists(body as { targetWorkspaceSocketId?: string }, 'update'),
    preDelete: (id, entries) =>
      assertNotLastEnabled(
        id,
        entries,
        'returnEndpointId',
        'cannot remove last enabled return endpoint'
      ),
  });

  // ═══ SURFACE 9: Mailboxes — AMEND-nexus-admin-dashboard §3.5.a ═══
  // Per-actor allocation requires at least one enabled file-backed mailbox.
  // The invariant guard fires on UPDATE (when disabling or changing type
  // away from file-backed) and on DELETE.
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/mailboxes',
    manifestPath: MANIFEST_MAILBOXES,
    arrayKey: 'mailboxes',
    idKey: 'mailboxId',
    paramName: 'mailboxId',
    createSchema: MailboxCreateSchema,
    updateSchema: MailboxUpdateSchema,
    preUpdate: (id, body, entries) => {
      const next = body as {
        enabled?: boolean;
        mailboxType?: string;
      };
      if (next.enabled === undefined && next.mailboxType === undefined) return;
      const target = entries.find(e => e['mailboxId'] === id);
      if (!target) return;
      const wasFileBacked = FILE_BACKED_MAILBOX_TYPES.has(String(target['mailboxType']));
      const willBeFileBacked =
        next.mailboxType !== undefined
          ? FILE_BACKED_MAILBOX_TYPES.has(next.mailboxType)
          : wasFileBacked;
      const willBeEnabled = next.enabled !== undefined ? next.enabled : target['enabled'] === true;
      // Build the post-mutation projection
      const projected = entries.map(e =>
        e['mailboxId'] === id
          ? {
              ...e,
              enabled: willBeEnabled,
              mailboxType: next.mailboxType ?? e['mailboxType'],
            }
          : e
      );
      const remaining = projected.filter(
        e => e['enabled'] === true && FILE_BACKED_MAILBOX_TYPES.has(String(e['mailboxType']))
      );
      if (remaining.length === 0) {
        throw Object.assign(
          new Error('cannot disable/retype: would leave zero enabled file-backed mailboxes'),
          { statusCode: 409 }
        );
      }
      // Suppress unused-variable warning
      void willBeFileBacked;
    },
    preDelete: (id, entries) => assertAtLeastOneFileBackedMailboxRemains(id, entries, false),
  });

  // ═══ SURFACE 8: Workspaces — AMEND-nexus-admin-dashboard §3.4 ═══
  // ═══ AMEND-nexus-planner-chat-tier-v0-2-0.md §3.7 — entryMode unlock ═══
  // entryMode widens to enum(['governed_only', 'free_chat']); pre-create
  // / pre-update apply the cross-field rules for free_chat shapes before
  // the manifest is signed and reloaded.
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/workspaces',
    manifestPath: MANIFEST_WORKSPACES,
    arrayKey: 'workspaces',
    idKey: 'workspaceSocketId',
    paramName: 'socketId',
    createSchema: WorkspaceCreateSchema,
    updateSchema: WorkspaceUpdateSchema,
    preCreate: body => {
      assertFreeChatCrossField(
        body as {
          entryMode?: string;
          capabilities?: {
            promptEntry?: boolean;
            planReview?: boolean;
            finalDisplay?: boolean;
            fileSpace?: boolean;
          };
          configuration?: Record<string, unknown>;
        }
      );
    },
    preUpdate: (_id, body) => {
      assertFreeChatCrossField(
        body as {
          entryMode?: string;
          capabilities?: {
            promptEntry?: boolean;
            planReview?: boolean;
            finalDisplay?: boolean;
            fileSpace?: boolean;
          };
          configuration?: Record<string, unknown>;
        }
      );
    },
    preDelete: async (id, entries) => {
      assertNotLastEnabled(
        id,
        entries,
        'workspaceSocketId',
        'cannot remove last enabled workspace'
      );

      // AMEND-nexus-admin-dashboard §7 R2 mitigation completion (Arc 2 fixup).
      // Reverse direction of §3.5.c FK validation: §3.5.c rejects new return
      // endpoints whose targetWorkspaceSocketId is missing/disabled, but the
      // workspace-side delete left existing return endpoints orphaned. This
      // check refuses workspace deletion when any return endpoint targets it,
      // listing the dependents so the operator can clean up first.
      if (deps.manifestWriter) {
        const returnEndpoints = await deps.manifestWriter
          .readEntries(MANIFEST_RETURN_ENDPOINTS, 'returnEndpoints')
          .catch(() => [] as Record<string, unknown>[]);
        const dependents = returnEndpoints
          .filter(re => re['targetWorkspaceSocketId'] === id)
          .map(re => String(re['returnEndpointId']));
        if (dependents.length > 0) {
          throw Object.assign(
            new Error(
              `cannot delete workspace ${id}: in use by return endpoint${dependents.length === 1 ? '' : 's'} [${dependents.join(', ')}]`
            ),
            { statusCode: 409 }
          );
        }
      }
    },
  });

  // ═══ SURFACE 7: Orchestrators — AMEND-nexus-admin-dashboard §3.3 ═══
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/orchestrators',
    manifestPath: MANIFEST_ORCHESTRATORS,
    arrayKey: 'orchestrators',
    idKey: 'orchestratorSocketId',
    paramName: 'socketId',
    createSchema: OrchestratorCreateSchema,
    updateSchema: OrchestratorUpdateSchema,
    preDelete: (id, entries) =>
      assertNotLastEnabled(
        id,
        entries,
        'orchestratorSocketId',
        'cannot remove last enabled orchestrator'
      ),
  });

  // ═══ SURFACE 6: Approval channels — AMEND-nexus-admin-dashboard §3.2 ═══
  // §8 decision (best-solve): the last-enabled-channel guard applies
  // unconditionally, not only under NXS enforcing. Enforcing requires
  // human approval; zero enabled channels would deadlock approvals.
  registerManifestCrud(app, deps, {
    basePath: '/workspace/admin/setup/approval-channels',
    manifestPath: MANIFEST_CHANNELS,
    arrayKey: 'channels',
    idKey: 'channelId',
    createSchema: ApprovalChannelCreateSchema,
    updateSchema: ApprovalChannelUpdateSchema,
    preDelete: (id, entries) =>
      assertNotLastEnabled(id, entries, 'channelId', 'cannot remove last enabled approval channel'),
  });

  // ═══ SURFACE 12: Admin signing keys — AMEND-nexus-admin-dashboard §3.7 ═══
  // OR-DASH-009 preserved: list returns fingerprint + presence + lastModified;
  // never raw private material. Upload accepts a keypair JSON; vault uses
  // a raw symmetric-key string. Deletion is admin-signing-only and refuses
  // to delete the elevated admin's own keypair (self-lockout guard).
  const KEY_DIR = deps.keyDirectory ?? 'keys';

  app.get('/workspace/admin/setup/admin-keys', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      const entries = await listAdminKeyEntries(KEY_DIR);
      res.json({ ok: true, data: { keys: entries } });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.post(
    '/workspace/admin/setup/admin-keys',
    withAdminMutation<z.infer<typeof AdminKeyUploadSchema>>(deps, {
      mutationKind: 'manifest_entry_add',
      parsePayload: parsePayloadWithZod(AdminKeyUploadSchema),
      handler: async (payload, _ctx) => {
        try {
          const body = payload;
          const keyId =
            body.keyKind === 'admin-signing'
              ? body.keyId
              : body.keyKind === 'control-plane'
                ? 'dev'
                : 'vault';
          const filePath = adminKeyFilePath(KEY_DIR, body.keyKind, keyId);
          if (!filePath) {
            return { kind: 'failed', reason: 'unknown keyKind', statusCode: 400 };
          }
          // Validate keypair shape for admin-signing/control-plane: publicKey +
          // privateKey base64url strings. The Zod schema enforces structure;
          // additionally check base64url-ish charset to catch obvious pastes.
          if (body.keyKind === 'admin-signing' || body.keyKind === 'control-plane') {
            const { publicKey, privateKey } = body.content;
            const b64Re = /^[A-Za-z0-9_-]+$/;
            if (!b64Re.test(publicKey) || !b64Re.test(privateKey)) {
              return {
                kind: 'failed',
                reason: 'publicKey/privateKey must be base64url-encoded',
                statusCode: 400,
              };
            }
          }
          await writeAdminKeyFile(filePath, body.content, body.keyKind === 'vault');
          // AMEND-nexus-admin-arc4-fixups §1.1 — admin-signing keypair MUST also
          // write a sibling `<keyId>.public.json` so `loadAdminPublicKey`
          // (mode-manager.ts:184-192, used by the unlock route's multi-party
          // verify) can resolve the signer without loading private material.
          // public.json is 0644 by definition — pubkeys are publishable;
          // only the keypair file stays 0600.
          if (body.keyKind === 'admin-signing') {
            const publicPath = path.join(KEY_DIR, 'admins', `${keyId}.public.json`);
            await writeAdminPublicKeyFile(publicPath, body.content.publicKey);
          }
          const fingerprint =
            body.keyKind === 'vault'
              ? fingerprintForVaultBytes(String(body.content))
              : fingerprintForPublicKey(body.content.publicKey);
          return {
            kind: 'ok',
            result: {
              keyId,
              keyKind: body.keyKind,
              fingerprint,
              present: true,
              requiresRestart: body.keyKind !== 'admin-signing',
            },
          };
        } catch (err) {
          return failureFromError(err);
        }
      },
    })
  );

  app.delete(
    '/workspace/admin/setup/admin-keys/:keyId',
    withAdminMutation<Record<string, never>>(deps, {
      mutationKind: 'manifest_entry_remove',
      parsePayload: () => ({ ok: true, data: {} as Record<string, never> }),
      handler: async (_payload, ctx) => {
        const keyId = String(ctx.req.params['keyId']);
        if (!keyId) {
          return { kind: 'failed', reason: 'keyId required', statusCode: 400 };
        }
        // Self-lockout guard: cannot delete the elevated admin's own signing keypair.
        if (keyId === ctx.opener) {
          return {
            kind: 'failed',
            reason: "cannot delete the elevated admin's own signing keypair",
            statusCode: 409,
          };
        }
        // Only admin-signing keys are deletable from this surface (control-plane
        // and vault are singletons rotated via POST). Path resolution:
        const filePath = path.join(KEY_DIR, 'admins', `${keyId}.keypair.json`);
        try {
          await fs.unlink(filePath);
          return { kind: 'ok', result: { keyId, removed: true } };
        } catch (err) {
          const errno = (err as { code?: string }).code;
          if (errno === 'ENOENT') {
            return { kind: 'failed', reason: `key ${keyId} not found`, statusCode: 404 };
          }
          return failureFromError(err);
        }
      },
    })
  );

  // ═══ SURFACE 13: Mode (signed envelope) — AMEND-nexus-admin-dashboard §3.6
  // The legacy POST /mode route stays 501; mode mutations always go through
  // /workspace/admin/setup/mode (elevated session + server-side admin
  // keypair). The browser NEVER holds the signing key
  // (feedback_signing_keys_server_side memory).
  const ModeChangeSchema = z
    .object({
      engine: z.enum(['nxs', 'nvg']),
      mode: z.enum(['observe', 'advisory', 'enforcing']),
    })
    .strict();
  const ModeUnlockSchema = z.object({ confirm: z.literal(true) }).strict();

  app.post(
    '/workspace/admin/setup/mode',
    withAdminMutation<z.infer<typeof ModeChangeSchema>>(deps, {
      mutationKind: 'manifest_entry_update',
      parsePayload: parsePayloadWithZod(ModeChangeSchema),
      handler: async (payload, ctx) => {
        if (!deps.modeSigner) {
          return { kind: 'failed', reason: 'Mode signer not configured', statusCode: 501 };
        }
        try {
          const hasKey = await deps.modeSigner.hasSigningKeypair(ctx.opener);
          if (!hasKey) {
            return {
              kind: 'failed',
              reason:
                'missing admin signing keypair — provision via Toolchain & Keys (admin-signing kind) or run nexus init',
              statusCode: 412,
            };
          }
          const next = await deps.modeSigner.changeMode({
            engine: payload.engine,
            mode: payload.mode,
            adminPrincipalId: ctx.opener,
          });
          return { kind: 'ok', result: { currentConfig: next } };
        } catch (err) {
          const sc = (err as { statusCode?: number }).statusCode ?? 500;
          const msg = san(err);
          // Surface enforcing-lock-blocks-downgrade as 409 with the spec-required
          // error hint pointing at the unlock route.
          if (/enforcing-lock/i.test(msg) || /MODE_DOWNGRADE_BLOCKED/.test(msg)) {
            return {
              kind: 'failed',
              reason: 'enforcing-lock active; POST /workspace/admin/setup/mode/unlock first',
              statusCode: 409,
            };
          }
          return { kind: 'failed', reason: msg, statusCode: sc };
        }
      },
    })
  );

  // F4.17 / Q4 / HL #10 — single-admin dashboard unlock is retired.
  // The lawful path is SigningCouncil 2-of-2 (Spec F4.1, operation
  // 'mode_unlock'); the request must be opened via the SigningCouncil
  // route. Until that route lands in Patch 6, this endpoint rejects all
  // attempts with 409 so the safety rail can never be lowered by a
  // single admin via the dashboard. The CLI multi-party path
  // (disableEnforcingLock with ≥2 signatures) remains available.
  app.post('/workspace/admin/setup/mode/unlock', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.modeSigner) {
      res.status(501).json({ ok: false, error: 'Mode signer not configured' });
      return;
    }
    const parsed = ModeUnlockSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    res.status(409).json({
      ok: false,
      error:
        'unlock_requires_two_distinct_admins — open a SigningCouncil mode_unlock request (Spec F4.1)',
    });
  });

  // ─── F4.5 OCT signed assign surface ────────────────────────────────────
  // POST /workspace/admin/oct/assign — apply a signed OCT change to an
  // actor. The body is a SignedOctAssignmentRequest envelope (signature
  // produced server-side per feedback_signing_keys_server_side.md; the
  // browser never holds the operator's private key). The baked
  // OctManagerPort enforces strict-higher rank (Q2 / HL #10); downward
  // equivalents are deregister-then-register-new (§3.3).
  const OctAssignSchema = z
    .object({
      action: z.enum(['oct_assignment', 'oct_change']),
      actorId: z.string().uuid(),
      previousOctLevel: z.string().min(1).nullable(),
      newOctLevel: z.string().min(1),
      operatorId: z.string().min(1),
      requestedAt: z.string().min(1),
      reason: z.string().min(1),
      signature: z.string().min(1),
    })
    .strict();

  app.post(
    '/workspace/admin/oct/assign',
    withAdminMutation<z.infer<typeof OctAssignSchema>>(deps, {
      mutationKind: 'oct_assign',
      parsePayload: parsePayloadWithZod(OctAssignSchema),
      handler: async (payload, _ctx) => {
        if (!deps.actorRegistry) {
          return { kind: 'failed', reason: 'Actor registry not configured', statusCode: 501 };
        }
        if (!deps.octManager) {
          return { kind: 'failed', reason: 'OCT manager not configured', statusCode: 501 };
        }
        try {
          const updated = await deps.octManager.assignOct(payload as never);
          return { kind: 'ok', result: updated };
        } catch (err) {
          const msg = san(err);
          const status =
            /OCT_DOWNWARD_OR_EQUAL_FORBIDDEN|OCT_PREVIOUS_MISMATCH|OCT_NULL_LEVEL|OCT_UNRANKED/.test(
              msg
            )
              ? 409
              : /OCT_SELF_ASSIGNMENT|OCT_INVALID_SIGNATURE|OCT_UNKNOWN_OPERATOR/.test(msg)
                ? 403
                : /ACTOR_NOT_FOUND/.test(msg)
                  ? 404
                  : 400;
          return { kind: 'failed', reason: msg, statusCode: status };
        }
      },
    })
  );

  // ─── F4.1 SigningCouncil HTTP surface ─────────────────────────────────
  // POST /workspace/admin/signing/requests              — open a request
  // POST /workspace/admin/signing/requests/:id/signatures — add a signature
  // GET  /workspace/admin/signing/requests              — list
  // GET  /workspace/admin/signing/requests/:id          — get one
  //
  // All routes check checkAdminAuth (admin role + elevated session); the
  // baked SigningCouncilPort handles signature verification, threshold
  // check, and dispatch on threshold-met.
  const SigningOpenSchema = z
    .object({
      operation: z.enum([
        'mode_unlock',
        'policy_bundle_replace',
        'signing_council_change',
        'lexicon_mutation',
      ]),
      payload: z.record(z.unknown()),
      expiresInSeconds: z.number().int().positive().optional(),
    })
    .strict();
  // F4.1 / feedback_signing_keys_server_side — the SigningSignSchema's
  // `signature` field is OPTIONAL because production UI clients post
  // without a signature; the route then loads the elevated admin's
  // server-side keypair via `signingCouncilServerSigner` and forges the
  // Ed25519 signature itself. External clients (CLI, scripts, third
  // parties) MAY pre-sign and post the bytes directly. When neither is
  // available the route returns 403.
  const SigningSignSchema = z
    .object({
      signature: z.string().min(1).optional(),
    })
    .strict();

  app.post('/workspace/admin/signing/requests', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.signingCouncil) {
      res.status(501).json({ ok: false, error: 'SigningCouncil not configured' });
      return;
    }
    const parsed = SigningOpenSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    try {
      const opened = await deps.signingCouncil.open({
        operation: parsed.data.operation,
        payload: parsed.data.payload,
        openedBy: auth.principalId as NonEmpty,
        ...(parsed.data.expiresInSeconds !== undefined
          ? { expiresInSeconds: parsed.data.expiresInSeconds }
          : {}),
      });
      res.json({ ok: true, data: opened });
    } catch (err) {
      const sc = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(sc).json({ ok: false, error: san(err) });
    }
  });

  app.post(
    '/workspace/admin/signing/requests/:requestId/signatures',
    async (req: Request, res: Response) => {
      const auth = await checkAdminAuth(req, res, deps);
      if (!auth.ok) {
        res.status(auth.status).json({ ok: false, error: auth.error });
        return;
      }
      if (!deps.signingCouncil) {
        res.status(501).json({ ok: false, error: 'SigningCouncil not configured' });
        return;
      }
      const parsed = SigningSignSchema.safeParse(req.body);
      if (!parsed.success) {
        sendValidationError(res, parsed.error);
        return;
      }
      try {
        const requestId = String(req.params['requestId']) as NonEmpty;
        // F4.1 / feedback_signing_keys_server_side — two paths:
        //   1. External (CLI/script) client posted a pre-computed
        //      signature → forward to council.sign() as-is.
        //   2. UI client omitted `signature` → the route loads the
        //      elevated admin's keypair via signingCouncilServerSigner
        //      and signs the canonical envelope server-side. Browser
        //      never holds the admin keypair.
        let signature: Base64Url;
        if (parsed.data.signature !== undefined) {
          signature = parsed.data.signature as Base64Url;
        } else {
          if (!deps.signingCouncilServerSigner) {
            res.status(403).json({
              ok: false,
              error:
                'signature_required: server-side signer not configured; supply a pre-computed signature or wire SigningCouncilServerSigner',
            });
            return;
          }
          const pending = await deps.signingCouncil.get(requestId);
          if (!pending) {
            res.status(404).json({ ok: false, error: 'request_not_found' });
            return;
          }
          // The council is a SigningCouncilPort with a single concrete
          // implementation (SigningCouncil in @nexus/core); both the
          // implementation and the port expose `canonicalSigningEnvelope`.
          // Route consumers downcast to read the envelope so the server
          // signer can produce a verifier-compatible signature.
          const envelopeBuilder = deps.signingCouncil as {
            canonicalSigningEnvelope?: (req: typeof pending) => string;
          };
          if (typeof envelopeBuilder.canonicalSigningEnvelope !== 'function') {
            res.status(500).json({
              ok: false,
              error:
                'signing_council_envelope_unavailable: configured SigningCouncil implementation does not expose canonicalSigningEnvelope',
            });
            return;
          }
          const canonicalEnvelope = envelopeBuilder.canonicalSigningEnvelope(pending);
          signature = await deps.signingCouncilServerSigner.signEnvelope({
            principalId: auth.principalId as NonEmpty,
            canonicalEnvelope,
          });
        }
        const updated = await deps.signingCouncil.sign(
          requestId,
          auth.principalId as NonEmpty,
          signature
        );
        res.json({ ok: true, data: updated });
      } catch (err) {
        const sc = (err as { statusCode?: number }).statusCode ?? 500;
        res.status(sc).json({ ok: false, error: san(err) });
      }
    }
  );

  app.get('/workspace/admin/signing/requests', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.signingCouncil) {
      res.status(501).json({ ok: false, error: 'SigningCouncil not configured' });
      return;
    }
    try {
      const status =
        typeof req.query['status'] === 'string'
          ? (req.query['status'] as 'pending' | 'executed' | 'denied' | 'expired')
          : undefined;
      const operation =
        typeof req.query['operation'] === 'string'
          ? (req.query['operation'] as
              | 'mode_unlock'
              | 'policy_bundle_replace'
              | 'signing_council_change'
              | 'lexicon_mutation')
          : undefined;
      const filter: Parameters<typeof deps.signingCouncil.list>[0] = {};
      if (status !== undefined) filter!.status = status;
      if (operation !== undefined) filter!.operation = operation;
      const list = await deps.signingCouncil.list(filter);
      res.json({ ok: true, data: list });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/signing/requests/:requestId', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.signingCouncil) {
      res.status(501).json({ ok: false, error: 'SigningCouncil not configured' });
      return;
    }
    try {
      const requestId = String(req.params['requestId']) as NonEmpty;
      const r = await deps.signingCouncil.get(requestId);
      if (!r) {
        res.status(404).json({ ok: false, error: 'request_not_found' });
        return;
      }
      res.json({ ok: true, data: r });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── F4.8 Lexicon admin-writer surface ────────────────────────────────────
  // Five POST routes that author lexicon mutations (entity / edge /
  // confidence / template / guard). Each route Zod-validates the payload,
  // builds a `LexiconMutation` discriminated-union member, and opens a
  // SigningRequest(operation='lexicon_mutation', payload={mutation}) via
  // the SigningCouncil. **No route applies a mutation directly**; the
  // SigningCouncil dispatches to JsonlLexiconMutationExecutor.apply only
  // after 2 distinct admin signatures are aggregated. Hard Law #10 / Q4.
  //
  // GOV-14 invariant #5 enforces these five routes via AST scan.
  //
  // Lifecycle:
  //   1. Admin POSTs e.g. /workspace/admin/lexicon/entities with
  //      { displayName, entityType, ... }.
  //   2. Route wraps as { kind: 'entity_add', entity: {...} } and opens a
  //      SigningRequest.
  //   3. Response: { requestId, status: 'pending', signaturesNeeded: 2 }.
  //   4. UI presents "Awaiting second signer"; second admin signs at
  //      POST /workspace/admin/signing/requests/:id/signatures.
  //   5. Threshold met → executor applies → status: 'executed'.

  const LexEntityCreateSchema = z
    .object({
      entityId: z.string().min(1),
      displayName: z.string().min(1),
      entityType: z.string().min(1),
      disabled: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .strict();

  const LexEntityUpdateSchema = z
    .object({
      displayName: z.string().min(1).optional(),
      entityType: z.string().min(1).optional(),
      disabled: z.boolean().optional(),
      notes: z.string().optional(),
    })
    .strict();

  const LexEdgeCreateSchema = z
    .object({
      edgeId: z.string().min(1),
      sourceEntityId: z.string().min(1),
      targetEntityId: z.string().min(1),
      relation: z.string().min(1),
      weight: z.number().optional(),
      disabled: z.boolean().optional(),
    })
    .strict();

  const LexConfidenceSchema = z
    .object({
      entityId: z.string().min(1),
      arena: z.string().min(1),
      score: z.number().min(0).max(1),
    })
    .strict();

  const LexTemplateCreateSchema = z
    .object({
      templateId: z.string().min(1),
      slots: z
        .array(z.object({ slotId: z.string().min(1), required: z.boolean() }).strict())
        .min(1),
    })
    .strict();

  const LexGuardCreateSchema = z
    .object({
      guardId: z.string().min(1),
      when: z.string().min(1),
      then: z.string().min(1),
    })
    .strict();

  async function openLexiconMutationRequest(
    req: Request,
    res: Response,
    mutation: LexiconMutation
  ): Promise<void> {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.signingCouncil) {
      res.status(501).json({ ok: false, error: 'SigningCouncil not configured' });
      return;
    }
    try {
      const opened = await deps.signingCouncil.open({
        operation: 'lexicon_mutation',
        payload: { mutation } as unknown as Record<string, unknown>,
        openedBy: auth.principalId as NonEmpty,
      });
      res.status(202).json({ ok: true, data: opened });
    } catch (err) {
      const sc = (err as { statusCode?: number }).statusCode ?? 500;
      res.status(sc).json({ ok: false, error: san(err) });
    }
  }

  app.post('/workspace/admin/lexicon/entities', async (req: Request, res: Response) => {
    const parsed = LexEntityCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const entity = parsed.data as Parameters<typeof openLexiconMutationRequest>[2] extends never
      ? never
      : {
          entityId: NonEmpty;
          displayName: NonEmpty;
          entityType: NonEmpty;
          disabled?: boolean;
          notes?: string;
        };
    await openLexiconMutationRequest(req, res, {
      kind: 'entity_add',
      entity: {
        entityId: entity.entityId as NonEmpty,
        displayName: entity.displayName as NonEmpty,
        entityType: entity.entityType as NonEmpty,
        ...(entity.disabled !== undefined ? { disabled: entity.disabled } : {}),
        ...(entity.notes !== undefined ? { notes: entity.notes } : {}),
      },
    });
  });

  app.put('/workspace/admin/lexicon/entities/:entityId', async (req: Request, res: Response) => {
    const parsed = LexEntityUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const entityId = String(req.params['entityId']) as NonEmpty;
    const patch: {
      displayName?: NonEmpty;
      entityType?: NonEmpty;
      disabled?: boolean;
      notes?: string;
    } = {};
    if (parsed.data.displayName !== undefined)
      patch.displayName = parsed.data.displayName as NonEmpty;
    if (parsed.data.entityType !== undefined) patch.entityType = parsed.data.entityType as NonEmpty;
    if (parsed.data.disabled !== undefined) patch.disabled = parsed.data.disabled;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
    await openLexiconMutationRequest(req, res, {
      kind: 'entity_update',
      entityId,
      patch,
    });
  });

  app.delete('/workspace/admin/lexicon/entities/:entityId', async (req: Request, res: Response) => {
    const entityId = String(req.params['entityId']) as NonEmpty;
    await openLexiconMutationRequest(req, res, {
      kind: 'entity_disable',
      entityId,
    });
  });

  app.post('/workspace/admin/lexicon/edges', async (req: Request, res: Response) => {
    const parsed = LexEdgeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const edge = parsed.data;
    await openLexiconMutationRequest(req, res, {
      kind: 'edge_add',
      edge: {
        edgeId: edge.edgeId as NonEmpty,
        sourceEntityId: edge.sourceEntityId as NonEmpty,
        targetEntityId: edge.targetEntityId as NonEmpty,
        relation: edge.relation as NonEmpty,
        ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
        ...(edge.disabled !== undefined ? { disabled: edge.disabled } : {}),
      },
    });
  });

  app.delete('/workspace/admin/lexicon/edges/:edgeId', async (req: Request, res: Response) => {
    const edgeId = String(req.params['edgeId']) as NonEmpty;
    await openLexiconMutationRequest(req, res, {
      kind: 'edge_disable',
      edgeId,
    });
  });

  app.post('/workspace/admin/lexicon/confidence', async (req: Request, res: Response) => {
    const parsed = LexConfidenceSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    await openLexiconMutationRequest(req, res, {
      kind: 'confidence_set',
      entityId: parsed.data.entityId as NonEmpty,
      arena: parsed.data.arena as NonEmpty,
      score: parsed.data.score,
    });
  });

  app.post('/workspace/admin/lexicon/templates', async (req: Request, res: Response) => {
    const parsed = LexTemplateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    await openLexiconMutationRequest(req, res, {
      kind: 'workflow_template_add',
      template: {
        templateId: parsed.data.templateId as NonEmpty,
        slots: parsed.data.slots.map(s => ({
          slotId: s.slotId as NonEmpty,
          required: s.required,
        })),
      },
    });
  });

  app.post('/workspace/admin/lexicon/guards', async (req: Request, res: Response) => {
    const parsed = LexGuardCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    await openLexiconMutationRequest(req, res, {
      kind: 'guard_add',
      guard: {
        guardId: parsed.data.guardId as NonEmpty,
        when: parsed.data.when,
        then: parsed.data.then,
      },
    });
  });

  // ─── Lexicon read views (admin dashboard reads canonical state) ──────────
  // The admin dashboard editors read these endpoints to populate the
  // listing tables. The source of truth is the JSONL fixture set under
  // fixtures/lexicon/ — same files the planner reads at boot. Each line is
  // a canonical record; the latest record per id wins (mutations append).

  async function readLexiconFixture(filename: string): Promise<ReadonlyArray<unknown>> {
    const fixturePath = path.join(process.cwd(), 'fixtures', 'lexicon', filename);
    try {
      const raw = await fs.readFile(fixturePath, 'utf-8');
      return raw
        .split(/\r?\n/)
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  app.get('/workspace/admin/lexicon/entities', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      res.json({ ok: true, data: await readLexiconFixture('lexicon_entity.jsonl') });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/lexicon/edges', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      res.json({ ok: true, data: await readLexiconFixture('lexicon_edge.jsonl') });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/lexicon/confidence', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      res.json({ ok: true, data: await readLexiconFixture('lexicon_confidence.jsonl') });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/lexicon/templates', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      res.json({ ok: true, data: await readLexiconFixture('workflow_template.jsonl') });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/lexicon/guards', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      res.json({ ok: true, data: await readLexiconFixture('lexicon_guard.jsonl') });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  app.get('/workspace/admin/setup/mode', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.modeSigner) {
      res.status(501).json({ ok: false, error: 'Mode signer not configured' });
      return;
    }
    try {
      const [state, signingKeypairPresent] = await Promise.all([
        deps.modeSigner.loadCurrentState(),
        deps.modeSigner.hasSigningKeypair(auth.principalId),
      ]);
      res.json({
        ok: true,
        data: { currentConfig: state, signingKeypairPresent },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══ CATALOG (governed constants + raw manifest entries) ═══
  // SPEC-ADMIN-CATALOG-EDITABLE-FORMS §3 — drives every dynamic dropdown in the
  // admin dashboard. Reads constants from @nexus/contracts (Layer 2) and raw
  // manifest entries via the injected ManifestWriter (already on disk).
  app.get('/workspace/admin/setup/catalog', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    if (!deps.manifestWriter) {
      res.status(501).json({ ok: false, error: 'Manifest writer not configured' });
      return;
    }
    try {
      const actorClasses = Object.values(ACTOR_CLASS).map(id => ({ id, label: id }));
      const octLevels = Object.values(OCT_LEVEL).map(id => {
        const ceiling = OCT_CEILINGS[id];
        return {
          id,
          label: id,
          actionRiskCeiling: ceiling?.actionRiskCeiling ?? '',
          modelTierCeiling: ceiling?.modelTierCeiling ?? [],
          dataClassCeiling: ceiling?.dataClassCeiling ?? [],
        };
      });
      const riskTiers = Object.values(RISK_TIER).map(id => ({
        id,
        label: id,
        order: RISK_TIER_ORDER.indexOf(id),
      }));
      const modelTiers = Object.values(MODEL_TIER).map(id => ({ id, label: id }));
      const capabilityIds = Object.values(CAPABILITY_IDS);
      const authKinds = [
        { id: 'none', label: 'none', requiresSecret: false },
        { id: 'api_key', label: 'api_key', requiresSecret: true },
        { id: 'bearer', label: 'bearer', requiresSecret: true },
      ];
      const readOrEmpty = (path: string, key: string): Promise<Record<string, unknown>[]> =>
        deps.manifestWriter
          ? deps.manifestWriter.readEntries(path, key).catch(() => [] as Record<string, unknown>[])
          : Promise.resolve([]);
      const [
        allEndpoints,
        allConnectors,
        allActors,
        principals,
        allIdentityProviders,
        allChannels,
        allOrchestrators,
        allWorkspaces,
        allMailboxes,
        allCompilers,
        allReturnEndpoints,
      ] = await Promise.all([
        deps.manifestWriter.readEntries(MANIFEST_ENDPOINTS, 'endpoints'),
        readOrEmpty(MANIFEST_CONNECTORS, 'connectors'),
        deps.actorRegistry ? deps.actorRegistry.list() : Promise.resolve([]),
        deps.principalRegistry ? deps.principalRegistry.list() : Promise.resolve([]),
        readOrEmpty(MANIFEST_IDENTITY_PROVIDERS, 'providers'),
        readOrEmpty(MANIFEST_CHANNELS, 'channels'),
        readOrEmpty(MANIFEST_ORCHESTRATORS, 'orchestrators'),
        readOrEmpty(MANIFEST_WORKSPACES, 'workspaces'),
        readOrEmpty(MANIFEST_MAILBOXES, 'mailboxes'),
        readOrEmpty(MANIFEST_COMPILERS, 'compilers'),
        readOrEmpty(MANIFEST_RETURN_ENDPOINTS, 'returnEndpoints'),
      ]);
      res.json({
        ok: true,
        data: {
          actorClasses,
          octLevels,
          riskTiers,
          modelTiers,
          capabilityIds,
          authKinds,
          allEndpoints,
          allConnectors,
          allActors,
          principals,
          allIdentityProviders,
          allChannels,
          allOrchestrators,
          allWorkspaces,
          allMailboxes,
          allCompilers,
          allReturnEndpoints,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ═══ DISCOVER (probe ollama node for available models) ═══
  // POST { baseUrl, adapterId? } → GET {baseUrl}/api/tags → return models[].
  // Used by the admin "Add endpoint" form to populate a model dropdown after
  // the admin enters a node URL.
  app.post(
    '/workspace/admin/setup/discover',
    withAdminMutation<z.infer<typeof DiscoverSchema>>(deps, {
      mutationKind: 'manifest_entry_update',
      parsePayload: parsePayloadWithZod(DiscoverSchema),
      handler: async (payload, _ctx) => {
        let probeUrl: URL;
        try {
          probeUrl = new URL(payload.baseUrl);
        } catch {
          // Zod's z.string().url() catches most bad URLs, but defense-in-depth:
          // node's URL parser is the authoritative validator before we use it.
          return { kind: 'failed', reason: 'baseUrl must be a valid URL', statusCode: 400 };
        }
        if (probeUrl.protocol !== 'http:' && probeUrl.protocol !== 'https:') {
          return { kind: 'failed', reason: 'baseUrl must be http or https', statusCode: 400 };
        }
        // Strip trailing path components — admin may paste either the bare host or
        // the full /api/chat URL. We always probe /api/tags on the origin.
        const tagsUrl = new URL('/api/tags', probeUrl.origin).toString();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const probe = await fetch(tagsUrl, {
            method: 'GET',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!probe.ok) {
            return {
              kind: 'failed',
              reason: `Probe failed: HTTP ${probe.status} from ${tagsUrl}`,
              statusCode: 502,
            };
          }
          const body = (await probe.json()) as { models?: Array<Record<string, unknown>> };
          const models = Array.isArray(body?.models) ? body.models : [];
          return {
            kind: 'ok',
            result: {
              probedUrl: tagsUrl,
              models: models.map(m => ({
                name: typeof m['name'] === 'string' ? m['name'] : String(m['name'] ?? ''),
                model: typeof m['model'] === 'string' ? m['model'] : undefined,
                size: typeof m['size'] === 'number' ? m['size'] : undefined,
                modifiedAt: typeof m['modified_at'] === 'string' ? m['modified_at'] : undefined,
              })),
            },
          };
        } catch (err) {
          clearTimeout(timer);
          const msg =
            (err as { name?: string }).name === 'AbortError'
              ? `Probe timed out after 5s: ${tagsUrl}`
              : san(err);
          return { kind: 'failed', reason: msg, statusCode: 502 };
        }
      },
    })
  );

  // ═══ LOCK STATUS ═══
  app.get('/workspace/admin/setup/lock/:surface', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    const surface = String(req.params['surface']);
    const filePath =
      surface === 'endpoints'
        ? MANIFEST_ENDPOINTS
        : surface === 'connectors'
          ? MANIFEST_CONNECTORS
          : null;
    if (!filePath) {
      res.json({ ok: true, data: { locked: false, surface } });
      return;
    }
    const lock = checkLockStatus(filePath);
    res.json({
      ok: true,
      data: { locked: lock !== null, surface, ...(lock ? { heldBy: lock.adminUserId } : {}) },
    });
  });

  // ═══ SURFACE 4: Admin secret onboarding ═══
  // CLAUDE-CODE-SECRET-MANAGEMENT-SPEC — operators paste API keys directly
  // from the dashboard. Keys are persisted to keys/secrets.json (gitignored)
  // and then resolved at invoke-time via the chained SecretSource. Status
  // returns presence + source per key, NEVER values.
  //
  // Auth posture matches the rest of admin-writer (JWT + nexus-admin role +
  // X-Elevated-Session). Forbidden surfaces (per spec):
  //   - never echo the key back in any response
  //   - never log the key
  //   - never persist it in SQLite, the manifest YAML, or git
  //
  // KEY_NAME validation: upper-snake-case, max 128 chars. Anything else is
  // rejected so a stray colon or path separator can't smuggle a foreign
  // identifier into the file map.
  app.post(
    '/workspace/admin/setup/secrets',
    withAdminMutation<z.infer<typeof SecretCreateSchema>>(deps, {
      mutationKind: 'secret_store',
      parsePayload: parsePayloadWithZod(SecretCreateSchema),
      handler: async (payload, _ctx) => {
        if (!deps.secretWriter) {
          return { kind: 'failed', reason: 'Secret writer not configured', statusCode: 501 };
        }
        const { keyName, keyValue } = payload;
        try {
          await deps.secretWriter.writeSecret(keyName, keyValue);
          // Response is intentionally write-only — keyName + stored=true. No value echo.
          // F4.13: the SignedAdminMutation wrapper emits admin_mutation_intent
          // (with keyName + opener + payloadDigest) BEFORE this handler runs
          // and admin_mutation_committed AFTER it returns ok. The legacy
          // best-effort `emitSecretAuditEvent` write was retired (P0-024 / spec
          // §3.4) — the wrapper is the sole audit path and fails closed.
          return {
            kind: 'ok',
            result: {
              keyName,
              stored: true,
              source: 'file',
              storageLabel: deps.secretWriter.storageLabel,
            },
          };
        } catch (err) {
          // Don't leak the key value via the error message either — sanitizer
          // already handles strings, but keyValue isn't in the error path.
          return { kind: 'failed', reason: san(err), statusCode: 500 };
        }
      },
    })
  );

  app.delete(
    '/workspace/admin/setup/secrets/:keyName',
    withAdminMutation<Record<string, never>>(deps, {
      mutationKind: 'secret_remove',
      parsePayload: () => ({ ok: true, data: {} as Record<string, never> }),
      handler: async (_payload, ctx) => {
        if (!deps.secretWriter) {
          return { kind: 'failed', reason: 'Secret writer not configured', statusCode: 501 };
        }
        const keyName = String(ctx.req.params['keyName'] ?? '');
        if (
          !keyName ||
          keyName.length > SECRET_MAX_KEY_NAME_LEN ||
          !SECRET_KEY_NAME_RE.test(keyName)
        ) {
          return {
            kind: 'failed',
            reason: 'keyName must be upper-snake-case ([A-Z][A-Z0-9_]*) and ≤128 chars',
            statusCode: 400,
          };
        }
        try {
          const removed = await deps.secretWriter.deleteSecret(keyName);
          // F4.13: the wrapper writes admin_mutation_committed regardless of
          // whether the delete was a no-op (key already absent). The detail
          // includes the removed flag so audit can distinguish actual removals
          // from no-ops.
          return { kind: 'ok', result: { keyName, removed } };
        } catch (err) {
          return { kind: 'failed', reason: san(err), statusCode: 500 };
        }
      },
    })
  );

  app.get('/workspace/admin/setup/secrets/status', async (req: Request, res: Response) => {
    const auth = await checkAdminAuth(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    // Always returns presence + source; NEVER values. Works without
    // secretWriter, in which case we report only the env-side picture.
    const fileNames = deps.secretWriter ? await deps.secretWriter.listKeyNames() : [];
    const fileSet = new Set(fileNames);

    // The well-known provider keys are the ones the form pre-suggests.
    // We surface their status even when the operator hasn't stored a key yet,
    // so the dashboard can render the amber "Key required" indicator.
    const KNOWN_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'] as const;
    const seen = new Set<string>([...KNOWN_KEYS, ...fileSet]);

    const keys: Array<{
      keyName: string;
      present: boolean;
      source: 'file' | 'env' | null;
    }> = [];
    for (const name of seen) {
      if (fileSet.has(name)) {
        keys.push({ keyName: name, present: true, source: 'file' });
        continue;
      }
      const envValue = process.env[name];
      if (typeof envValue === 'string' && envValue.length > 0) {
        keys.push({ keyName: name, present: true, source: 'env' });
        continue;
      }
      keys.push({ keyName: name, present: false, source: null });
    }
    keys.sort((a, b) => a.keyName.localeCompare(b.keyName));

    res.json({
      ok: true,
      data: {
        keys,
        storageLabel: deps.secretWriter?.storageLabel ?? null,
      },
    });
  });
}
