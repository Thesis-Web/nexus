// packages/workspace-ref/src/client/components/admin/placeholder/placeholder-data.ts
//
// PLACEHOLDER DATA — Claude B turn 04, CONTRA-B02 path B2.
//
// Values transcribed from the actual repo `config/**/*.yaml` files at the time
// of Claude B build. Shape conforms to SPEC-addendum-beta1-admin-dashboard-v0-1
// §3.2 (`DashboardSurfaceStatus`).
//
// THIS DATA IS TEMPORARY. When Claude C lands `GET /workspace/admin/setup/status`,
// the dashboard shell switches to `await api.getSetupStatus()` and these
// constants become unused. They are deliberately structured to match the
// projection response shape so the swap is a single-line change per panel.
//
// HONESTY POSTURE (per OR-DASH-003): every surface declares its true readiness.
// The reference adapter line items show `configured` (loaded + enabled) but
// surfaces whose runtime proof or projection route isn't yet present show
// `partial`, `blocked`, `candidate`, or `future` per SPEC §3.2 vocabulary.

import type { DashboardSurfaceStatus, DashboardSetupStatusResponse } from '@nexus/contracts';

// ─── identity ──────────────────────────────────────────────────────────────
export const IDENTITY_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'identity',
  title: 'Identity Providers',
  category: 'identity',
  state: 'configured',
  sourcePaths: [
    'config/identity/providers.v1.yaml',
    'packages/core/src/manifest/identity/identity-manifest-loader.ts',
    'packages/core/src/manifest/identity/identity-manifest-schema.ts',
  ],
  currentConfiguredValue: {
    entries: [
      {
        providerId: 'ria',
        providerType: 'reference_adapter',
        configuration: {},
        enabled: true,
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [
    {
      label: 'Manifest loaded',
      pathOrRoute: 'config/identity/providers.v1.yaml',
      status: 'configured',
    },
    {
      label: 'Factory registered',
      pathOrRoute: 'IdentityProviderFactoryRegistry',
      status: 'configured',
    },
  ],
  allowedActions: ['view'],
};

// ─── connectors_targets ────────────────────────────────────────────────────
export const CONNECTORS_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'connectors_targets',
  title: 'Connectors & Target Systems',
  category: 'connectors_targets',
  state: 'partial',
  sourcePaths: [
    'config/connectors/connectors.v1.yaml',
    'packages/core/src/manifest/connectors/connector-manifest-loader.ts',
    'packages/core/src/manifest/connectors/connector-factory-registry.ts',
  ],
  currentConfiguredValue: {
    entries: [
      {
        connectorId: 'stub',
        connectorType: 'stub',
        allowedSystems: ['*'],
        configuration: {},
        enabled: true,
      },
      {
        connectorId: 'vault',
        connectorType: 'vault',
        allowedSystems: ['*'],
        configuration: {},
        enabled: false,
      },
    ],
  },
  secretFields: [],
  blockers: ['vault connector: factory + runtime registry instantiation pending'],
  evidence: [
    {
      label: 'stub connector enabled',
      pathOrRoute: 'connectors.v1.yaml#stub',
      status: 'configured',
    },
    {
      label: 'vault connector disabled',
      pathOrRoute: 'connectors.v1.yaml#vault',
      status: 'disabled',
    },
  ],
  allowedActions: ['view'],
};

// ─── models_nvg ────────────────────────────────────────────────────────────
export const MODELS_NVG_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'models_nvg',
  title: 'Model Endpoints & Routing',
  category: 'models_nvg',
  state: 'partial',
  sourcePaths: [
    'config/nvg/endpoints.v1.yaml',
    'packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.ts',
    'packages/vanguard/src/transport/endpoints/endpoint-manifest-schema.ts',
    'fixtures/nvg/default.routing-policy.yaml',
  ],
  currentConfiguredValue: {
    entries: [
      {
        endpointId: 'local-ollama',
        tier: 'on_prem_general',
        url: 'http://localhost:11434/api/chat',
        adapterId: 'ollama-chat-v1',
        modelName: 'llama3.2',
        auth: { kind: 'none' },
        enabled: true,
      },
      {
        endpointId: 'anthropic-claude',
        tier: 'frontier_general',
        url: 'https://api.anthropic.com/v1/messages',
        adapterId: 'anthropic-messages-v1',
        modelName: 'claude-sonnet-4-20250514',
        auth: { kind: 'api_key', headerName: 'x-api-key' },
        adapterConfig: { max_tokens: 4096 },
        enabled: false,
      },
      {
        endpointId: 'openai-gpt',
        tier: 'frontier_general',
        url: 'https://api.openai.com/v1/chat/completions',
        adapterId: 'openai-chat-v1',
        modelName: 'gpt-4o',
        auth: { kind: 'bearer', headerName: 'Authorization', prefix: 'Bearer ' },
        enabled: false,
      },
    ],
  },
  secretFields: [
    { fieldPath: 'endpoints[anthropic-claude].auth.secretRef', status: 'present' },
    { fieldPath: 'endpoints[openai-gpt].auth.secretRef', status: 'present' },
  ],
  blockers: ['frontier endpoints disabled pending owner decision (OR-DASH-008 candidate gating)'],
  evidence: [
    {
      label: 'local-ollama enabled',
      pathOrRoute: 'endpoints.v1.yaml#local-ollama',
      status: 'configured',
    },
    {
      label: 'anthropic disabled',
      pathOrRoute: 'endpoints.v1.yaml#anthropic-claude',
      status: 'disabled',
    },
    { label: 'openai disabled', pathOrRoute: 'endpoints.v1.yaml#openai-gpt', status: 'disabled' },
  ],
  allowedActions: ['view'],
};

// ─── channels_approval ─────────────────────────────────────────────────────
export const CHANNELS_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'channels_approval',
  title: 'Approval Channels',
  category: 'channels_approval',
  state: 'configured',
  sourcePaths: [
    'config/channels/channels.v1.yaml',
    'packages/core/src/manifest/channels/channel-manifest-loader.ts',
  ],
  currentConfiguredValue: {
    entries: [
      {
        channelId: 'cli',
        channelType: 'cli',
        configuration: {},
        enabled: true,
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [
    { label: 'cli channel enabled', pathOrRoute: 'channels.v1.yaml#cli', status: 'configured' },
  ],
  allowedActions: ['view'],
};

// ─── actors_agents ─────────────────────────────────────────────────────────
export const ACTORS_AGENTS_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'actors_agents',
  title: 'Actors & Agents',
  category: 'actors_agents',
  state: 'partial',
  sourcePaths: [
    'scripts/nexus-bootstrap.ts (dev-admin + nexus-default-agent seeds)',
    'packages/core/src/identity/actor-registry.ts',
    'packages/core/src/identity/principal-registry.ts',
  ],
  currentConfiguredValue: {
    entries: [
      {
        actorId: '00000000-0000-4000-a000-000000000000',
        actorClass: 'HUMAN',
        displayName: 'dev-admin',
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'critical',
        allowedSystems: ['*'],
        allowedCapabilities: ['*'],
        enabled: true,
      },
      {
        actorId: '00000000-0000-4000-a000-000000000002',
        actorClass: 'SUPERVISED_AGENT',
        displayName: 'nexus-default-agent',
        environment: 'reference',
        octLevel: 'OCT-OPEN',
        riskCeiling: 'medium',
        allowedSystems: ['stub'],
        allowedCapabilities: ['read:record:single', 'search:data', 'synthesize:content'],
        enabled: true,
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [
    {
      label: 'dev-admin seeded',
      pathOrRoute: 'scripts/nexus-bootstrap.ts:990',
      status: 'configured',
    },
    {
      label: 'default agent seeded',
      pathOrRoute: 'scripts/nexus-bootstrap.ts:1011',
      status: 'configured',
    },
    {
      label: 'Actor.roles contract',
      pathOrRoute: 'packages/contracts/src/interfaces/index.ts',
      status: 'blocked',
    },
  ],
  allowedActions: ['view'],
};

// ─── orchestrator ──────────────────────────────────────────────────────────
export const ORCHESTRATOR_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'orchestrator',
  title: 'Orchestrators',
  category: 'orchestrator',
  state: 'configured',
  sourcePaths: [
    'config/orchestrators/orchestrators.v1.yaml',
    'packages/core/src/manifest/orchestrators/orchestrator-manifest-loader.ts',
  ],
  currentConfiguredValue: {
    entries: [
      {
        orchestratorSocketId: 'reference-orchestrator',
        orchestratorType: 'reference_deterministic',
        enabled: true,
        plannerMode: 'deterministic_first',
        maxSplitDepth: 1,
        planCheckbackDefault: true,
        secureMode: {
          octSecureDefault: 'single_agent_no_helper',
          allowSecureMultiAgentOnlyBySignedPolicy: true,
        },
        retryPolicy: { transientAutoRetryCount: 1 },
        timeouts: { systemActionMs: 30000, modelCallMs: 60000 },
        outputSlotPolicy: 'strict_declared_slots',
        plannerType: 'ref-deterministic',
        plannerVersion: '1.0.0',
        planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: false },
        partialCompletion: { enabled: true, minRequiredCompletedNodes: 1, compileOnPartial: true },
        maxToolTurnsPerNode: 6,
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [
    {
      label: 'reference orchestrator enabled',
      pathOrRoute: 'orchestrators.v1.yaml#reference-orchestrator',
      status: 'configured',
    },
    {
      label: 'OCT default per OR-006',
      pathOrRoute: 'octSecureDefault=single_agent_no_helper',
      status: 'configured',
    },
  ],
  allowedActions: ['view'],
};

// ─── workspace ─────────────────────────────────────────────────────────────
export const WORKSPACE_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'workspace',
  title: 'Workspaces',
  category: 'workspace',
  state: 'configured',
  sourcePaths: [
    'config/workspace/workspaces.v1.yaml',
    'packages/core/src/manifest/workspace/workspace-manifest-loader.ts',
  ],
  currentConfiguredValue: {
    entries: [
      {
        workspaceSocketId: 'reference-workspace',
        workspaceType: 'reference_http',
        enabled: true,
        entryMode: 'governed_only',
        baseUrl: 'http://localhost:4100',
        returnEndpointId: 'reference-workspace-return',
        capabilities: {
          promptEntry: true,
          planReview: true,
          finalDisplay: true,
          fileSpace: false,
        },
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [
    {
      label: 'reference workspace enabled',
      pathOrRoute: 'workspaces.v1.yaml#reference-workspace',
      status: 'configured',
    },
    {
      label: 'entryMode locked governed_only',
      pathOrRoute: 'spec §29 / OR-DASH-005',
      status: 'configured',
    },
  ],
  allowedActions: ['view'],
};

// ─── mailbox_compile_return ────────────────────────────────────────────────
export const MAILBOX_COMPILE_RETURN_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'mailbox_compile_return',
  title: 'Mailbox / Compile / Return',
  category: 'mailbox_compile_return',
  state: 'partial',
  sourcePaths: [
    'config/mailbox/mailboxes.v1.yaml',
    'config/compile/compilers.v1.yaml',
    'config/output/compile-return.v1.yaml',
  ],
  currentConfiguredValue: {
    mailboxes: [
      {
        mailboxId: 'core-return-mailbox',
        mailboxType: 'local_jsonl_reference',
        enabled: true,
        required: true,
        storageRoot: 'runs/mailbox',
        retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
        classificationRequired: true,
        digestRequired: true,
      },
    ],
    compilers: [
      {
        compilerSocketId: 'reference-deterministic-compiler',
        compilerType: 'reference_deterministic_renderer',
        enabled: true,
        actorRegistration: 'exempt_reference_deterministic_renderer',
        octMode: 'OCT-COMPILE',
        allowedModes: ['deterministic_render'],
        readsFromMailboxId: 'core-return-mailbox',
        outputContractVersion: 'v1',
        artifactSigning: { kind: 'control_plane' },
      },
      {
        compilerSocketId: 'customer-onprem-compiler',
        compilerType: 'customer_onprem_synthesis',
        enabled: false,
        actorRegistration: 'required',
        octMode: 'OCT-COMPILE',
        allowedModes: ['on_prem_synthesis'],
        readsFromMailboxId: 'core-return-mailbox',
        outputContractVersion: 'v1',
        artifactSigning: { kind: 'actor_registry_key', keyId: 'dev-compiler-actor-key' },
      },
    ],
    returnEndpoints: [
      {
        returnEndpointId: 'reference-workspace-return',
        endpointType: 'http_callback',
        enabled: true,
        targetWorkspaceSocketId: 'reference-workspace',
        url: 'http://localhost:4100/nexus/compile-return',
        auth: { kind: 'signed_callback', keyId: 'dev-compile-return-key' },
        acceptedArtifactTypes: ['final_response.v1'],
      },
    ],
  },
  secretFields: [],
  blockers: ['compile-return target /nexus/compile-return harness routing pending (OR-DASH-010)'],
  evidence: [
    {
      label: 'core mailbox enabled+required',
      pathOrRoute: 'mailboxes.v1.yaml#core-return-mailbox',
      status: 'configured',
    },
    {
      label: 'reference deterministic compiler enabled',
      pathOrRoute: 'compilers.v1.yaml#reference-deterministic-compiler',
      status: 'configured',
    },
    {
      label: 'on-prem compiler disabled',
      pathOrRoute: 'compilers.v1.yaml#customer-onprem-compiler',
      status: 'disabled',
    },
    {
      label: 'workspace return endpoint configured',
      pathOrRoute: 'compile-return.v1.yaml#reference-workspace-return',
      status: 'configured',
    },
  ],
  allowedActions: ['view'],
};

// ─── modes_policy_oct ──────────────────────────────────────────────────────
export const MODES_POLICY_OCT_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'modes_policy_oct',
  title: 'Modes, Policy & OCT',
  category: 'modes_policy_oct',
  state: 'partial',
  sourcePaths: ['(mode config — runtime resolved)', '(policy files — runtime resolved)'],
  currentConfiguredValue: {
    nxsMode: 'observe',
    nvgMode: 'observe',
    enforcingLocked: false,
    octDefault: 'OCT-CONFIDENTIAL',
    notes: 'Mode mutation is CLI-only per OR-DASH-007. No HTTP write route in Beta1.',
  },
  secretFields: [],
  blockers: [
    'Read projection route GET /workspace/admin/setup/surfaces/modes_policy_oct pending (Claude C)',
    'Mode change submit disabled — CLI-only per OR-DASH-007',
  ],
  evidence: [
    {
      label: 'CLI mode set route',
      pathOrRoute: 'nexus mode set <observe|advise|deny>',
      status: 'configured',
    },
    { label: 'HTTP mode write', pathOrRoute: 'POST /mode (501 by design)', status: 'disabled' },
  ],
  allowedActions: ['view'],
};

// ─── observability ─────────────────────────────────────────────────────────
export const OBSERVABILITY_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'observability',
  title: 'Ledgers & Trails',
  category: 'observability',
  state: 'partial',
  sourcePaths: [
    'packages/interfaces/api/src/routes/run-ledger.ts',
    'packages/interfaces/api/src/routes/ledger.ts',
    '(routing trail / evidence — server-side only)',
  ],
  currentConfiguredValue: {
    runLedger: {
      route: 'GET /run-ledger',
      auth: 'admin bearer (server-side)',
      visibleInDashboard: false,
    },
    evidenceLedger: {
      route: 'GET /ledger',
      auth: 'admin bearer (server-side)',
      visibleInDashboard: false,
    },
    routingTrail: { route: '(internal)', visibleInDashboard: false },
    notes: 'Browser-side ledger viewing requires workspace-JWT projection routes (Claude C).',
  },
  secretFields: [],
  blockers: [
    'Browser cannot call /run-ledger or /ledger directly (admin bearer forbidden in browser per OR-DASH-004)',
    'Workspace-JWT projection of ledger views pending (Claude C / OR-007)',
  ],
  evidence: [
    {
      label: 'Run Ledger route exists',
      pathOrRoute: '/run-ledger (admin bearer)',
      status: 'partial',
    },
    {
      label: 'Evidence Ledger route exists',
      pathOrRoute: '/ledger (admin bearer)',
      status: 'partial',
    },
  ],
  allowedActions: ['view'],
};

// ─── toolchain ─────────────────────────────────────────────────────────────
export const TOOLCHAIN_PLACEHOLDER: DashboardSurfaceStatus = {
  surfaceId: 'toolchain',
  title: 'Toolchain & Keys',
  category: 'toolchain',
  state: 'partial',
  sourcePaths: [
    '(env + keys/ + secret store — runtime resolved)',
    'keys/ (control-plane signing material)',
  ],
  currentConfiguredValue: {
    controlPlane: {
      signingKey: { fieldPath: 'keys/control-plane.priv', status: 'present' },
      publicKey: { fieldPath: 'keys/control-plane.pub', status: 'present' },
    },
    secretStore: {
      kind: 'fixture-synthetic',
      notes: 'Secret presence only — never raw values (OR-DASH-009).',
    },
  },
  secretFields: [
    { fieldPath: 'keys/control-plane.priv', status: 'present' },
    { fieldPath: 'env.ANTHROPIC_API_KEY', status: 'unknown' },
    { fieldPath: 'env.OPENAI_API_KEY', status: 'unknown' },
    { fieldPath: 'env.NEXUS_DEV_ADMIN_KEY', status: 'present' },
  ],
  blockers: [
    'Secret-presence projection route pending Claude C',
    'Secret store source-priority owner ruling pending (OR-DASH-009)',
  ],
  evidence: [
    { label: 'Control-plane keys exist on disk', pathOrRoute: 'keys/', status: 'configured' },
    {
      label: 'API key env detection',
      pathOrRoute: 'process.env (not browser-visible)',
      status: 'partial',
    },
  ],
  allowedActions: ['view'],
};

// ─── aggregate placeholder response (mimics Claude C's eventual response) ──
export const PLACEHOLDER_SURFACES: readonly DashboardSurfaceStatus[] = [
  IDENTITY_PLACEHOLDER,
  ACTORS_AGENTS_PLACEHOLDER,
  CONNECTORS_PLACEHOLDER,
  MODELS_NVG_PLACEHOLDER,
  CHANNELS_PLACEHOLDER,
  WORKSPACE_PLACEHOLDER,
  ORCHESTRATOR_PLACEHOLDER,
  MAILBOX_COMPILE_RETURN_PLACEHOLDER,
  MODES_POLICY_OCT_PLACEHOLDER,
  OBSERVABILITY_PLACEHOLDER,
  TOOLCHAIN_PLACEHOLDER,
];

export const PLACEHOLDER_SETUP_STATUS_RESPONSE: DashboardSetupStatusResponse = {
  ok: true,
  generatedAt: '2026-05-06T00:00:00.000Z',
  generatedBy: { actorId: '(placeholder)', principalId: '(placeholder)' },
  mode: {
    nxsMode: 'observe',
    nvgMode: 'observe',
    enforcingLocked: false,
    state: 'partial',
  },
  surfaces: PLACEHOLDER_SURFACES,
  summary: {
    ready: 0,
    configured: 5,
    missing: 0,
    disabled: 0,
    blocked: 0,
    partial: 6,
    conditional: 0,
    candidate: 0,
    future: 0,
  },
};

export const PLACEHOLDER_BANNER_REASON =
  'Read-only — placeholder data pending Claude C projection at GET /workspace/admin/setup/surfaces/<id>. Save/apply disabled until writer windows are ratified.';
