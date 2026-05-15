/**
 * Admin Dashboard Setup Routes — SPEC-addendum-beta1-admin-dashboard-v0-1 §3
 *
 * File: packages/interfaces/api/src/routes/admin-setup.ts
 * Layer 7 — workspace-attached admin projection (NOT bearer-token /admin/*).
 *
 * Routes:
 *   GET /workspace/admin/setup/status              (full 11-surface response)
 *   GET /workspace/admin/setup/surfaces/:surfaceId (single-surface response)
 *
 * Auth chain (per SPEC §3.1, OR-DASH-002, OR-DASH-004):
 *   1. Workspace JWT — applied by the blanket /workspace/* middleware
 *      registered in registerWorkspaceRoutes (workspace.ts:326). These
 *      routes are registered AFTER that middleware, so JWT enforcement is
 *      automatic. res.locals.claims is populated.
 *   2. Admin role — claims.roleAssignments contains ADMIN_ROLE
 *      ('nexus-admin') or ADMIN_ROLE_LOCAL_ALIAS ('admin'). Single mapping
 *      function `hasAdminRole` from @nexus/contracts (OR-DASH-001).
 *   3. Elevated session — X-Elevated-Session header validated via
 *      ElevatedAuthProvider.validateSession with principal-bound check
 *      (hard rule 30, OR-DASH-002).
 *
 * Read-only law (SPEC §3.3, OR-DASH-005):
 *   - Never mutate files.
 *   - Never sign manifests.
 *   - Never call NXS/NVG decision paths as a side effect.
 *   - Never echo raw secrets — status pill only (OR-DASH-009).
 *   - Treat loader failure as honest blocked/partial, not green.
 *
 * Surface count (SPEC §3.2): every response carries 11 surfaces (one per
 * DashboardSurfaceCategory). Empty / blocked / partial states are surfaced
 * truthfully — no fake readiness.
 *
 * Owner ruling DRIFT-A01 (2026-05-06): readiness states lowercase always.
 */
import type { Express, Request, Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  RunLedgerWriter,
  ModeConfiguration,
  NvgRoutingPolicy,
  IdentityClaims,
  ActorRegistry,
  ElevatedAuthProvider,
  IdentityProviderInterface,
  ModelEndpoint,
  IdentityProviderManifestRecord,
  ConnectorManifestRecord,
  ChannelManifestRecord,
  WorkspaceManifestRecord,
  OrchestratorManifestRecord,
  MailboxManifestRecord,
  CompilerManifestRecord,
  CompileReturnEndpointRecord,
  Uuid,
  DashboardSetupStatusResponse,
  DashboardSurfaceStatus,
  DashboardReadinessState,
  DashboardModeSummary,
  DashboardSecretField,
  DashboardEvidenceEntry,
} from '@nexus/contracts';
import {
  ALL_SURFACE_CATEGORIES,
  hasAdminRole,
} from '../../../../contracts/src/externals/dashboard-setup.js';
import { san } from './shared.js';

// ─── DI deps ────────────────────────────────────────────────────────────────

/**
 * CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3c — public-safe summary of the
 * signed NXS policy file. Bundle id and version are public; rule
 * outcomes are aggregated as counts so the panel can show "6 rules
 * (3 allow, 2 require_approval, 1 escalate)" without exposing the
 * full policy body to the dashboard projection.
 */
export interface NxsPolicySummary {
  readonly bundleId: string;
  readonly version: string;
  readonly issuer: string;
  readonly defaultOutcome: string;
  readonly ruleCount: number;
  /** outcome → count, e.g. {"allow":3,"require_approval":2,"escalate":1}. */
  readonly outcomeCounts: Readonly<Record<string, number>>;
}

/**
 * Per-surface dependency surface. All optional — the route handler reports
 * missing deps as `blocked`/`partial` rather than 501. Operators get a
 * truthful projection even before runtime is fully wired.
 */
export interface AdminSetupRouteDeps {
  /** Required for elevated-session check (OR-DASH-002 / hard rule 30). */
  readonly elevatedAuthProvider?: ElevatedAuthProvider;

  // ── Identity surface ──
  readonly identityProvider?: IdentityProviderInterface;
  readonly identityRecords?: readonly IdentityProviderManifestRecord[];

  // ── Connectors surface ──
  readonly connectorRecords?: readonly ConnectorManifestRecord[];
  /**
   * CLAUDE-CODE-ADMIN-PANELS-PHASE-D §1a — capabilities reported by
   * each connector implementation, keyed by `systemType` (which
   * matches `ConnectorManifestRecord.connectorType`). Built once at
   * bootstrap from the SimpleConnectorRegistry; the surface composer
   * looks each connector entry up by type so the dashboard can show
   * what the connector advertises (vs. the manifest's wire-shape).
   */
  readonly connectorCapabilities?: ReadonlyMap<string, readonly string[]>;

  // ── Channels surface ──
  readonly channelRecords?: readonly ChannelManifestRecord[];

  // ── Models / NVG surface ──
  readonly endpoints?: readonly ModelEndpoint[];
  readonly loadNvgRoutingPolicy?: () => Promise<NvgRoutingPolicy>;

  // ── Actors / agents surface ──
  readonly actorRegistry?: ActorRegistry;

  // ── Workspace surface ──
  readonly workspaceSockets?: readonly WorkspaceManifestRecord[];
  readonly workspaceJwtSecret?: string;

  // ── Orchestrator surface ──
  readonly orchestratorSockets?: readonly OrchestratorManifestRecord[];

  // ── Mailbox / compile / compile-return surface ──
  readonly mailboxRecords?: readonly MailboxManifestRecord[];
  readonly compilerRecords?: readonly CompilerManifestRecord[];
  readonly compileReturnRecords?: readonly CompileReturnEndpointRecord[];

  // ── Modes / OCT / policy surface ──
  readonly loadModeConfig?: () => Promise<ModeConfiguration>;
  /**
   * CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3c — read-only summary of the
   * loaded NXS policy file (bundle id, version, default outcome, rule
   * counts by outcome). Computed once at bootstrap from the signed
   * default policy so the panel can render it without re-reading the
   * file. Null when the policy hasn't loaded.
   */
  readonly nxsPolicySummary?: NxsPolicySummary | null;
  /**
   * AMEND-nexus-admin-dashboard-full-buildout §4.1 — whether the
   * elevated admin's signing keypair file exists on disk. Drives the
   * mode-policy panel's fallback CLI-instructions block when missing.
   * The hook receives no arguments — composition root closes over the
   * elevated admin principal id resolution. Tests pass a constant
   * predicate. Best-effort; absence is not a blocker.
   */
  readonly hasAdminSigningKeypair?: () => Promise<boolean>;

  // ── Observability surface ──
  readonly runLedgerWriter?: RunLedgerWriter;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Return secret presence status WITHOUT ever returning the value.
 *
 * Recognizes the prefix-routed scheme used by ChainedSecretSource:
 *   - 'file:KEY'  → keys/secrets.json (admin-managed at runtime)
 *   - 'env:KEY'   → process.env (env-driven deployments)
 *   - bare 'KEY'  → process.env (legacy / explicit-env)
 *   - 'FIXTURE_SYNTHETIC_SECRET:*' → always 'missing' by convention
 *
 * Returns 'present' if the corresponding source has a non-empty value,
 * 'missing' otherwise, 'unknown' for shapes we cannot introspect (vault
 * URIs, non-conforming refs).
 *
 * Note: the file branch returns 'unknown' here because admin-setup is the
 * read-only projection layer (no backing-store handle). The
 * /workspace/admin/setup/secrets/status route is the authoritative
 * presence check for file: refs.
 */
function secretStatusForRef(secretRef: string): DashboardSecretField['status'] {
  // Fixture/synthetic prefix — never resolves to a real key by convention.
  if (secretRef.startsWith('FIXTURE_SYNTHETIC_SECRET:')) return 'missing';
  // file:KEY — defer to /workspace/admin/setup/secrets/status for authoritative
  // presence (admin-setup has no FileSecretSource handle).
  if (secretRef.startsWith('file:')) return 'unknown';
  // env:KEY — explicit env-prefix.
  if (secretRef.startsWith('env:')) {
    const key = secretRef.slice('env:'.length);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) return 'unknown';
    const v = process.env[key];
    return v && v.length > 0 ? 'present' : 'missing';
  }
  // Bare KEY — legacy upper-snake-case env reference.
  if (/^[A-Z][A-Z0-9_]*$/.test(secretRef)) {
    const v = process.env[secretRef];
    return v && v.length > 0 ? 'present' : 'missing';
  }
  // Unknown reference shape — never echo, never claim present.
  return 'unknown';
}

/** Worst-case state aggregator for multi-entry surfaces. */
function aggregateState(states: readonly DashboardReadinessState[]): DashboardReadinessState {
  if (states.length === 0) return 'missing';
  // Severity ranking: blocked > missing > partial > disabled > conditional > candidate > future > configured > ready
  const rank = (s: DashboardReadinessState): number => {
    switch (s) {
      case 'blocked':
        return 8;
      case 'missing':
        return 7;
      case 'partial':
        return 6;
      case 'disabled':
        return 5;
      case 'conditional':
        return 4;
      case 'candidate':
        return 3;
      case 'future':
        return 2;
      case 'configured':
        return 1;
      case 'ready':
        return 0;
    }
  };
  let worst: DashboardReadinessState = states[0]!;
  let worstRank = rank(worst);
  for (let i = 1; i < states.length; i++) {
    const s = states[i]!;
    const r = rank(s);
    if (r > worstRank) {
      worst = s;
      worstRank = r;
    }
  }
  return worst;
}

/** File-existence evidence (no contents read, no leak). */
function fileEvidence(label: string, relPath: string): DashboardEvidenceEntry {
  const abs = path.resolve(process.cwd(), relPath);
  const exists = fs.existsSync(abs);
  return {
    label,
    pathOrRoute: relPath,
    status: exists ? 'configured' : 'missing',
  };
}

// ─── Surface composers (one per category) ──────────────────────────────────

function composeIdentitySurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const records = deps.identityRecords ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Manifest file', 'config/identity/providers.v1.yaml'),
  ];
  if (records.length === 0) {
    blockers.push('Bootstrap not loaded or zero enabled identity providers');
  } else {
    evidence.push({
      label: 'Manifest loaded',
      pathOrRoute: 'IdentityManifestLoader',
      status: 'configured',
    });
    if (deps.identityProvider) {
      evidence.push({
        label: 'Factory registered',
        pathOrRoute: `IdentityProviderFactoryRegistry::${deps.identityProvider.providerType}`,
        status: 'configured',
      });
    }
  }
  const state: DashboardReadinessState = records.length === 0 ? 'missing' : 'configured';
  return {
    surfaceId: 'identity',
    title: 'Identity Providers',
    category: 'identity',
    state,
    sourcePaths: [
      'config/identity/providers.v1.yaml',
      'packages/core/src/manifest/identity/identity-manifest-loader.ts',
      'packages/core/src/manifest/identity/identity-manifest-schema.ts',
    ],
    currentConfiguredValue: {
      entries: records.map(r => ({
        providerId: r.providerId,
        providerType: r.providerType,
        configuration: r.configuration,
        enabled: true, // loader filters disabled rows; HOLE-C01 partial visibility
      })),
    },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeConnectorsSurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const records = deps.connectorRecords ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Manifest file', 'config/connectors/connectors.v1.yaml'),
  ];
  if (records.length === 0) {
    blockers.push('Bootstrap not loaded or zero enabled connectors');
  } else {
    evidence.push({
      label: 'Manifest loaded',
      pathOrRoute: 'ConnectorManifestLoader',
      status: 'configured',
    });
  }
  // Vault connector is deferred per OR-DASH; if a `vault` connector ever
  // appears in records here, it's enabled — but since the loader filters
  // disabled rows out, vault never appears unless operator enabled it.
  const state: DashboardReadinessState = records.length === 0 ? 'missing' : 'configured';
  return {
    surfaceId: 'connectors_targets',
    title: 'Connectors & Target Systems',
    category: 'connectors_targets',
    state,
    sourcePaths: [
      'config/connectors/connectors.v1.yaml',
      'packages/core/src/manifest/connectors/connector-manifest-loader.ts',
    ],
    currentConfiguredValue: {
      entries: records.map(r => ({
        connectorId: r.connectorId,
        connectorType: r.connectorType,
        allowedSystems: r.allowedSystems,
        enabled: true, // HOLE-C01 partial visibility — loader-filtered
        // CLAUDE-CODE-ADMIN-PANELS-PHASE-D §1a — capabilities the
        // connector implementation advertises at runtime. Empty array
        // when the type isn't registered (e.g. Vault connector
        // declared in the manifest but not enabled).
        capabilities: deps.connectorCapabilities?.get(r.connectorType) ?? [],
      })),
    },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeChannelsSurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const records = deps.channelRecords ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Manifest file', 'config/channels/channels.v1.yaml'),
  ];
  if (records.length === 0) {
    blockers.push('Bootstrap not loaded or zero enabled approval channels');
  } else {
    evidence.push({
      label: 'Manifest loaded',
      pathOrRoute: 'ChannelManifestLoader',
      status: 'configured',
    });
  }
  const state: DashboardReadinessState = records.length === 0 ? 'missing' : 'configured';
  return {
    surfaceId: 'channels_approval',
    title: 'Approval Channels',
    category: 'channels_approval',
    state,
    sourcePaths: [
      'config/channels/channels.v1.yaml',
      'packages/core/src/manifest/channels/channel-manifest-loader.ts',
    ],
    currentConfiguredValue: {
      entries: records.map(r => ({
        channelId: r.channelId,
        channelType: r.channelType,
        enabled: true, // HOLE-C01 partial visibility
      })),
    },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeModelsNvgSurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const endpoints = deps.endpoints ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Endpoints manifest', 'config/nvg/endpoints.v1.yaml'),
    fileEvidence('Routing policy', 'fixtures/nvg/default.routing-policy.yaml'),
  ];
  const secretFields: DashboardSecretField[] = [];

  for (const ep of endpoints) {
    if (ep.auth.kind !== 'none') {
      secretFields.push({
        fieldPath: `${ep.endpointId as string}.auth.secretRef`,
        status: secretStatusForRef(ep.auth.secretRef as string),
      });
    }
  }

  let routingPolicyOk = false;
  if (deps.loadNvgRoutingPolicy) {
    routingPolicyOk = true;
    evidence.push({
      label: 'Routing policy loader',
      pathOrRoute: 'loadNvgRoutingPolicy',
      status: 'configured',
    });
  } else {
    blockers.push('NVG routing policy loader not wired');
  }

  if (endpoints.length === 0) {
    blockers.push('No model endpoints loaded');
  }

  // Partial state if any endpoint is unhealthy or any required secret missing.
  const anyUnhealthy = endpoints.some(ep => !ep.healthy);
  const anyMissingSecret = secretFields.some(f => f.status === 'missing');
  let state: DashboardReadinessState = 'configured';
  if (endpoints.length === 0 || !routingPolicyOk) state = 'missing';
  else if (anyUnhealthy || anyMissingSecret) state = 'partial';
  if (blockers.length > 0 && state !== 'missing') state = 'partial';

  return {
    surfaceId: 'models_nvg',
    title: 'Model Endpoints & NVG',
    category: 'models_nvg',
    state,
    sourcePaths: [
      'config/nvg/endpoints.v1.yaml',
      'packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.ts',
      'fixtures/nvg/default.routing-policy.yaml',
    ],
    currentConfiguredValue: {
      entries: endpoints.map(ep => ({
        endpointId: ep.endpointId,
        tier: ep.tier,
        url: ep.url,
        adapterId: ep.adapterId,
        modelName: ep.modelName,
        authKind: ep.auth.kind,
        timeoutMs: ep.timeoutMs ?? null,
        adapterConfig: ep.adapterConfig ?? null,
        healthy: ep.healthy,
        lastCheckAt: ep.lastCheckAt,
      })),
    },
    secretFields,
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

async function composeActorsAgentsSurface(
  deps: AdminSetupRouteDeps
): Promise<DashboardSurfaceStatus> {
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [];
  let entries: Array<Record<string, unknown>> = [];

  if (!deps.actorRegistry) {
    blockers.push('Actor registry not wired into admin-setup deps');
  } else {
    try {
      const actors = await deps.actorRegistry.list();
      entries = actors.map(a => ({
        actorId: a.actorId,
        actorClass: a.actorClass,
        principalId: a.principalId,
        displayName: a.displayName,
        environment: a.environment,
        octLevel: a.octLevel,
        riskCeiling: a.riskCeiling,
        allowedSystems: a.allowedSystems,
        // Surface allowedCapabilities + roles so the dashboard's actor
        // table mirrors what's in SQLite. Roles drive admin gating
        // (HOLE-A02 cb1e07c) and operators need to see them.
        allowedCapabilities: a.allowedCapabilities ?? [],
        roles: a.roles ?? [],
        enabled: a.enabled !== false,
        registeredAt: a.registeredAt,
        ...(a.owner ? { owner: a.owner } : {}),
        ...(a.purpose ? { purpose: a.purpose } : {}),
        ...(a.reviewCadence ? { reviewCadence: a.reviewCadence } : {}),
      }));
      evidence.push({
        label: 'Actor registry list()',
        pathOrRoute: 'ActorRegistry::list',
        status: 'configured',
      });
    } catch (err) {
      blockers.push(`Actor registry list failed: ${san(err)}`);
    }
  }

  // HOLE-A02 closed: Actor.roles is now a Layer-2 contract field, persisted
  // by SqliteActorRegistry, projected by RegistryBackedIdentityProvider and
  // by the bootstrap canonical adapter. Admin gating reads the governed
  // record; no adapter-level injection.

  const state: DashboardReadinessState =
    entries.length === 0 ? 'missing' : blockers.length > 0 ? 'partial' : 'configured';
  return {
    surfaceId: 'actors_agents',
    title: 'Actors & Agents',
    category: 'actors_agents',
    state,
    sourcePaths: [
      'packages/contracts/src/interfaces/index.ts (Actor)',
      'packages/core/src/identity/actor-registry-sqlite.ts',
      'scripts/nexus-bootstrap.ts (seed)',
    ],
    currentConfiguredValue: { entries },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeWorkspaceSurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const sockets = deps.workspaceSockets ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Manifest file', 'config/workspace/workspaces.v1.yaml'),
  ];
  if (sockets.length === 0) {
    blockers.push('No workspace sockets loaded');
  } else {
    evidence.push({
      label: 'Workspace sockets loaded',
      pathOrRoute: 'WorkspaceManifestLoader',
      status: 'configured',
    });
  }
  // Workspace JWT secret presence — never echoed.
  const jwtSecretField: DashboardSecretField = {
    fieldPath: 'workspaceJwtSecret',
    status: deps.workspaceJwtSecret && deps.workspaceJwtSecret.length > 0 ? 'present' : 'missing',
  };
  if (jwtSecretField.status === 'missing') {
    blockers.push('Workspace JWT secret missing — login fails closed (501)');
  }

  const state: DashboardReadinessState =
    sockets.length === 0 || jwtSecretField.status === 'missing' ? 'partial' : 'configured';

  return {
    surfaceId: 'workspace',
    title: 'Workspace',
    category: 'workspace',
    state,
    sourcePaths: [
      'config/workspace/workspaces.v1.yaml',
      'packages/core/src/manifest/workspace/workspace-manifest-loader.ts',
    ],
    currentConfiguredValue: {
      entries: sockets.map(s => ({
        workspaceSocketId: s.workspaceSocketId,
        workspaceType: s.workspaceType,
        enabled: s.enabled,
        entryMode: s.entryMode,
        baseUrl: s.baseUrl,
        returnEndpointId: s.returnEndpointId,
        capabilities: s.capabilities,
      })),
    },
    secretFields: [jwtSecretField],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeOrchestratorSurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const sockets = deps.orchestratorSockets ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Manifest file', 'config/orchestrators/orchestrators.v1.yaml'),
  ];
  if (sockets.length === 0) {
    blockers.push('No orchestrator sockets loaded');
  } else {
    evidence.push({
      label: 'Orchestrator sockets loaded',
      pathOrRoute: 'OrchestratorManifestLoader',
      status: 'configured',
    });
  }
  const state: DashboardReadinessState = sockets.length === 0 ? 'partial' : 'configured';
  return {
    surfaceId: 'orchestrator',
    title: 'Orchestrator',
    category: 'orchestrator',
    state,
    sourcePaths: [
      'config/orchestrators/orchestrators.v1.yaml',
      'packages/core/src/manifest/orchestrators/orchestrator-manifest-loader.ts',
    ],
    currentConfiguredValue: {
      entries: sockets.map(s => ({
        orchestratorSocketId: s.orchestratorSocketId,
        orchestratorType: s.orchestratorType,
        enabled: s.enabled,
        orchestratorActorId: s.orchestratorActorId,
        plannerMode: s.plannerMode,
        plannerType: s.plannerType,
        plannerVersion: s.plannerVersion,
        secureMode: s.secureMode,
        outputSlotPolicy: s.outputSlotPolicy,
        // Bringing the live surface up to parity with the placeholder
        // shape so operators see the full manifest record on the
        // dashboard, not a half-projection. The dashboard read-form
        // primitive auto-renders any field on the entry, so adding
        // them here is sufficient — no panel changes needed.
        maxSplitDepth: s.maxSplitDepth,
        planCheckbackDefault: s.planCheckbackDefault,
        retryPolicy: s.retryPolicy,
        timeouts: s.timeouts,
        planAmendment: s.planAmendment,
        partialCompletion: s.partialCompletion,
        maxToolTurnsPerNode: s.maxToolTurnsPerNode,
      })),
    },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeMailboxCompileReturnSurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const mailboxes = deps.mailboxRecords ?? [];
  const compilers = deps.compilerRecords ?? [];
  const returns = deps.compileReturnRecords ?? [];
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Mailbox manifest', 'config/mailbox/mailboxes.v1.yaml'),
    fileEvidence('Compiler manifest', 'config/compile/compilers.v1.yaml'),
    fileEvidence('Compile-return manifest', 'config/output/compile-return.v1.yaml'),
  ];
  if (mailboxes.length === 0) blockers.push('No mailbox sockets loaded');
  if (compilers.length === 0) blockers.push('No compiler sockets loaded');
  if (returns.length === 0) blockers.push('No compile-return endpoints loaded');

  // OR-DASH-010: known partial — surface honestly.
  blockers.push(
    'OR-DASH-010: compile-return URL alignment unresolved (workspace-bridge vs /compile-return/:id)'
  );

  const state: DashboardReadinessState =
    mailboxes.length === 0 || compilers.length === 0 || returns.length === 0
      ? 'partial'
      : 'partial';

  return {
    surfaceId: 'mailbox_compile_return',
    title: 'Mailbox / Compile / Return',
    category: 'mailbox_compile_return',
    state,
    sourcePaths: [
      'config/mailbox/mailboxes.v1.yaml',
      'config/compile/compilers.v1.yaml',
      'config/output/compile-return.v1.yaml',
    ],
    currentConfiguredValue: {
      mailboxes: mailboxes.map(m => ({
        mailboxId: m.mailboxId,
        mailboxType: m.mailboxType,
        enabled: m.enabled,
        required: m.required,
        storageRoot: m.storageRoot,
        retentionPolicy: m.retentionPolicy,
        classificationRequired: m.classificationRequired,
        digestRequired: m.digestRequired,
      })),
      compilers: compilers.map(c => ({
        compilerSocketId: c.compilerSocketId,
        compilerType: c.compilerType,
        enabled: c.enabled,
        actorRegistration: c.actorRegistration,
        compilerActorId: c.compilerActorId,
        octMode: c.octMode,
        allowedModes: c.allowedModes,
        readsFromMailboxId: c.readsFromMailboxId,
        outputContractVersion: c.outputContractVersion,
        artifactSigningKind: c.artifactSigning.kind,
      })),
      returnEndpoints: returns.map(r => ({
        returnEndpointId: r.returnEndpointId,
        endpointType: r.endpointType,
        enabled: r.enabled,
        targetWorkspaceSocketId: r.targetWorkspaceSocketId,
        url: r.url,
        authKind: r.auth.kind,
      })),
    },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

async function composeModesPolicyOctSurface(
  deps: AdminSetupRouteDeps
): Promise<DashboardSurfaceStatus> {
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Mode config (signed)', 'keys/mode-config.json'),
  ];
  let modeConfig: ModeConfiguration | null = null;
  let policyLoadable = false;

  if (deps.loadModeConfig) {
    try {
      modeConfig = await deps.loadModeConfig();
      evidence.push({
        label: 'Mode config loaded + signature verified',
        pathOrRoute: 'loadModeConfig',
        status: 'configured',
      });
    } catch (err) {
      blockers.push(`Mode config load failed: ${san(err)}`);
    }
  } else {
    blockers.push('Mode config loader not wired');
  }

  if (deps.loadNvgRoutingPolicy) {
    try {
      await deps.loadNvgRoutingPolicy();
      policyLoadable = true;
      evidence.push({
        label: 'NVG routing policy signature verified',
        pathOrRoute: 'loadNvgRoutingPolicy',
        status: 'configured',
      });
    } catch (err) {
      blockers.push(`NVG routing policy load failed: ${san(err)}`);
    }
  } else {
    blockers.push('NVG routing policy loader not wired');
  }

  // AMEND-nexus-admin-dashboard-full-buildout §3.6 — dashboard mode
  // mutation IS now writer-enabled through /workspace/admin/setup/mode
  // (server-side signed envelope). OR-DASH-007 superseded; the legacy
  // /mode HTTP route stays 501 as a deliberate dead end for third-party
  // clients.

  // §4.1 — surface whether the elevated admin's signing keypair is
  // present on disk. Drives the panel's fallback CLI-instructions block
  // when missing. Hook is best-effort; absence does not promote the
  // surface to 'partial'.
  const signingKeypairPresent = deps.hasAdminSigningKeypair
    ? await deps.hasAdminSigningKeypair().catch(() => false)
    : false;

  const state: DashboardReadinessState =
    modeConfig === null || !policyLoadable ? 'partial' : 'configured';

  return {
    surfaceId: 'modes_policy_oct',
    title: 'Modes / OCT / Policy',
    category: 'modes_policy_oct',
    state,
    sourcePaths: [
      'keys/mode-config.json',
      'fixtures/nvg/default.routing-policy.yaml',
      'packages/core/src/modes/mode-manager.ts',
    ],
    currentConfiguredValue: {
      ...(modeConfig !== null
        ? {
            nxsMode: modeConfig.nxsMode,
            nvgMode: modeConfig.nvgMode,
            enforcingLocked: modeConfig.enforcingLocked,
            updatedAt: modeConfig.updatedAt,
            updatedBy: modeConfig.updatedBy?.adminId ?? null,
          }
        : {}),
      // CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3c — the panel displays a
      // bundle/version/rule-count summary so operators can see what
      // policy the engine is enforcing without reading the JSON file.
      // Null when the policy hasn't loaded.
      nxsPolicySummary: deps.nxsPolicySummary ?? null,
      signingKeypairPresent,
    },
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeObservabilitySurface(deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  const blockers: string[] = [];
  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('Evidence ledger', 'nexus.ledger.jsonl'),
    fileEvidence('Run ledger', 'runs/infra.run-ledger.jsonl'),
    fileEvidence('NVG trail dir', 'runs'),
  ];
  if (!deps.runLedgerWriter) {
    blockers.push('Run ledger writer not wired into admin-setup deps');
  }
  // Honest pending-projection: no browser-callable JWT route exists for
  // run-ledger / evidence — those routes are admin-bearer (legacy admin auth).
  blockers.push(
    'No browser-callable JWT route for run-ledger / evidence stream; existing /run-ledger and /ledger routes are admin-bearer only (server-side use)'
  );
  const state: DashboardReadinessState = 'partial';
  return {
    surfaceId: 'observability',
    title: 'Observability (Ledgers & Trail)',
    category: 'observability',
    state,
    sourcePaths: [
      'packages/interfaces/api/src/routes/run-ledger.ts',
      'packages/interfaces/api/src/routes/ledger.ts',
      'packages/interfaces/api/src/routes/nvg.ts',
    ],
    currentConfiguredValue: {},
    secretFields: [],
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

function composeToolchainSurface(_deps: AdminSetupRouteDeps): DashboardSurfaceStatus {
  // Server-side file/env presence checks. NEVER echo values (OR-DASH-009).
  const blockers: string[] = [];
  const secretFields: DashboardSecretField[] = [
    {
      fieldPath: 'keys/admin.token',
      status: fs.existsSync(path.resolve(process.cwd(), 'keys', 'admin.token'))
        ? 'present'
        : 'missing',
    },
    {
      fieldPath: 'keys/dev.keypair.json',
      status: fs.existsSync(path.resolve(process.cwd(), 'keys', 'dev.keypair.json'))
        ? 'present'
        : 'missing',
    },
    {
      fieldPath: 'keys/mode-config.json',
      status: fs.existsSync(path.resolve(process.cwd(), 'keys', 'mode-config.json'))
        ? 'present'
        : 'missing',
    },
  ];
  // Workspace JWT secret: env-or-file precedence. Reported on workspace
  // surface, but mirrored here as a toolchain dependency.
  const wsJwtEnv = process.env['NEXUS_WORKSPACE_JWT_SECRET'];
  const wsJwtFile = fs.existsSync(path.resolve(process.cwd(), 'keys', 'workspace-jwt.secret'));
  secretFields.push({
    fieldPath: 'NEXUS_WORKSPACE_JWT_SECRET (env) / keys/workspace-jwt.secret (file)',
    status: (wsJwtEnv && wsJwtEnv.length > 0) || wsJwtFile ? 'present' : 'missing',
  });

  const evidence: DashboardEvidenceEntry[] = [
    fileEvidence('keys/ directory', 'keys'),
    fileEvidence('package.json', 'package.json'),
    fileEvidence('pnpm-lock.yaml', 'pnpm-lock.yaml'),
  ];

  const anyMissing = secretFields.some(f => f.status === 'missing');
  if (anyMissing) blockers.push('One or more required toolchain secrets/keys are missing');

  const state: DashboardReadinessState = anyMissing ? 'partial' : 'configured';

  return {
    surfaceId: 'toolchain',
    title: 'Toolchain & Keys',
    category: 'toolchain',
    state,
    sourcePaths: ['keys/', 'package.json', 'pnpm-lock.yaml'],
    currentConfiguredValue: {},
    secretFields,
    blockers,
    evidence,
    allowedActions: ['view'],
  };
}

// ─── Mode summary (top-level, separate from modes_policy_oct surface) ──────

async function composeModeSummary(deps: AdminSetupRouteDeps): Promise<DashboardModeSummary | null> {
  if (!deps.loadModeConfig) return null;
  try {
    const cfg = await deps.loadModeConfig();
    const nxsMode = String(cfg.nxsMode ?? 'unknown');
    const nvgMode = String(cfg.nvgMode ?? 'unknown');
    const enforcingLocked = Boolean(cfg.enforcingLocked);
    const state: DashboardReadinessState = nxsMode === 'unknown' ? 'missing' : 'configured';
    return { nxsMode, nvgMode, enforcingLocked, state };
  } catch {
    return null;
  }
}

// ─── Aggregate composition + summary counts ────────────────────────────────

async function composeAllSurfaces(
  deps: AdminSetupRouteDeps
): Promise<readonly DashboardSurfaceStatus[]> {
  const surfaces: DashboardSurfaceStatus[] = [];
  surfaces.push(composeIdentitySurface(deps));
  surfaces.push(await composeActorsAgentsSurface(deps));
  surfaces.push(composeConnectorsSurface(deps));
  surfaces.push(composeModelsNvgSurface(deps));
  surfaces.push(composeChannelsSurface(deps));
  surfaces.push(composeWorkspaceSurface(deps));
  surfaces.push(composeOrchestratorSurface(deps));
  surfaces.push(composeMailboxCompileReturnSurface(deps));
  surfaces.push(await composeModesPolicyOctSurface(deps));
  surfaces.push(composeObservabilitySurface(deps));
  surfaces.push(composeToolchainSurface(deps));
  return surfaces;
}

function summarizeStates(
  surfaces: readonly DashboardSurfaceStatus[]
): DashboardSetupStatusResponse['summary'] {
  const counts = {
    ready: 0,
    configured: 0,
    missing: 0,
    disabled: 0,
    blocked: 0,
    partial: 0,
    conditional: 0,
    candidate: 0,
    future: 0,
  };
  for (const s of surfaces) {
    counts[s.state]++;
  }
  return counts;
}

function aggregateStateOf(surfaces: readonly DashboardSurfaceStatus[]): DashboardReadinessState {
  return aggregateState(surfaces.map(s => s.state));
}

// ─── Auth helpers ──────────────────────────────────────────────────────────

interface AuthOk {
  readonly ok: true;
  readonly claims: IdentityClaims;
  readonly actorId: string;
  readonly principalId: string;
}
interface AuthFail {
  readonly ok: false;
  readonly status: 401 | 403;
  readonly error: string;
}

async function checkAdminAndElevatedSession(
  req: Request,
  res: Response,
  deps: AdminSetupRouteDeps
): Promise<AuthOk | AuthFail> {
  const claims = res.locals['claims'] as IdentityClaims | undefined;
  const actorId = res.locals['actorId'] as string | undefined;
  const principalId = res.locals['principalId'] as string | undefined;

  if (!claims || !actorId || !principalId) {
    // JWT middleware should have populated these — if not, the request didn't
    // go through it (defensive). Treat as 401.
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  if (!hasAdminRole(claims.roleAssignments)) {
    return { ok: false, status: 403, error: 'Admin role required' };
  }

  if (!deps.elevatedAuthProvider) {
    return { ok: false, status: 403, error: 'Elevated session validator not configured' };
  }
  const elevatedSessionId = req.headers['x-elevated-session'] as string | undefined;
  if (!elevatedSessionId) {
    return { ok: false, status: 403, error: 'X-Elevated-Session header required' };
  }
  try {
    const status = await deps.elevatedAuthProvider.validateSession(
      elevatedSessionId as Uuid,
      principalId
    );
    if (!status.valid) {
      return { ok: false, status: 403, error: 'Elevated session invalid or expired' };
    }
  } catch {
    return { ok: false, status: 403, error: 'Elevated session validation failed' };
  }

  return { ok: true, claims, actorId, principalId };
}

// ─── Route registration ────────────────────────────────────────────────────

export function registerAdminSetupRoutes(app: Express, deps: AdminSetupRouteDeps): void {
  // ─── GET /workspace/admin/setup/status ─────────────────────────────────
  app.get('/workspace/admin/setup/status', async (req: Request, res: Response) => {
    const auth = await checkAdminAndElevatedSession(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    try {
      const surfaces = await composeAllSurfaces(deps);
      const mode = await composeModeSummary(deps);
      const response: DashboardSetupStatusResponse = {
        ok: true,
        generatedAt: new Date().toISOString(),
        generatedBy: { actorId: auth.actorId, principalId: auth.principalId },
        mode,
        surfaces,
        summary: summarizeStates(surfaces),
      };
      res.json(response);
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });

  // ─── GET /workspace/admin/setup/surfaces/:surfaceId ────────────────────
  app.get('/workspace/admin/setup/surfaces/:surfaceId', async (req: Request, res: Response) => {
    const auth = await checkAdminAndElevatedSession(req, res, deps);
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }
    const surfaceId = String(req.params['surfaceId'] ?? '');
    if (!surfaceId) {
      res.status(400).json({ ok: false, error: 'surfaceId required' });
      return;
    }
    try {
      const surfaces = await composeAllSurfaces(deps);
      const found = surfaces.find(s => s.surfaceId === surfaceId);
      if (!found) {
        res.status(404).json({ ok: false, error: `Unknown surfaceId: ${surfaceId}` });
        return;
      }
      res.json({ ok: true, data: found });
    } catch (err) {
      res.status(500).json({ ok: false, error: san(err) });
    }
  });
}

// ─── Test seam exports ──────────────────────────────────────────────────────
// Exposed for unit tests; not part of the public API.
export const __test = {
  composeIdentitySurface,
  composeConnectorsSurface,
  composeChannelsSurface,
  composeModelsNvgSurface,
  composeActorsAgentsSurface,
  composeWorkspaceSurface,
  composeOrchestratorSurface,
  composeMailboxCompileReturnSurface,
  composeModesPolicyOctSurface,
  composeObservabilitySurface,
  composeToolchainSurface,
  composeAllSurfaces,
  summarizeStates,
  aggregateStateOf,
  ALL_SURFACE_CATEGORIES,
  secretStatusForRef,
  fileEvidence,
};
