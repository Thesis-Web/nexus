# Nexus — Agent Action Router and Authority Governance Layer

# Engineering Spec v0-4-6

# Owner: James Huson / Lake Area LLC

# Version: v0.4.6 | 2026-04-14

# Governing blueprint: nexus-blueprint-v0-3-6.md

# Supersedes: nexus-engineering-spec-v0-4-6.md

---

## Changelog from v0-4-5

CONTRA-001 and CONTRA-002 closed. No new gates, no new types, no new layers.

- CONTRA-001 (Critical): §13.6 Gate 05 signature corrected from
  `evaluateApproval(action, context, template, _prior)` to
  `evaluateApproval(action, context, _prior)`. Template consumed from
  `context.grantTemplate!` internally. Comment added: orchestrator invariant
  guarantees Gate 04 has set grantTemplate before Gate 05 is called.
  §13.7 Gate 06 signature corrected identically: `evaluateExecution(action, context, _prior)`.
  Template consumed from `context.grantTemplate!` internally.
  Both gate functions now satisfy the gate interface exactly:
  `evaluate(action, context, priorDecisions): Promise<GateResult>`.

- CONTRA-002 (Medium): §31.12 clean-clone assertion corrected from
  `npm install && npx nexus --help` to `pnpm install && pnpm exec nexus --help`.
  pnpm is the declared canonical package manager throughout the spec. The npm/npx
  form was an inconsistency introduced in an earlier draft.

- SPEC_VERSION constant updated to 'v0.4.6'. §32 final statement updated.

---

## Changelog from v0-4-4

Governance cleanup pass (OA-001, OA-002, OA-003, BS-101, BS-102, BS-103). All owner-approved.
No new gates, no new governed types, no new layers.

- OA-001: Header build-instructions line removed. Build instructions are not law.
- OA-002: §2 governing precedence law stack made fully explicit with fallback and conflict rules.
- OA-003: §32 final spec statement updated — stale "Nexus v0.1.0" replaced with pinned doc references.
- BS-101: §13.1 pipeline orchestrator replaced with explicit stateful control-flow branch.
  Generic gate loop removed. Gate 05 and Gate 06 no longer in the main loop array.
  Explicit branch after Gate 04: ALLOW → G06 → G07, REQUIRE_APPROVAL/ESCALATE → G05 → G06/G07, DENY/ERROR → G07.
- BS-102: §20.6 PendingApprovalStore interface updated — getRequest() method added.
  Shared decideApproval() service defined. §22.3 CLI handler calls shared service.
  §23.2 API approval routes call shared service. One signing path, no duplication.
- BS-103: §7.1 repo layout updated — scripts/ci-gate.ts, eslint.config.js,
  vitest.integration.config.ts, vitest.threat.config.ts declared explicitly.
  §7.2 format:check added as distinct script target. ci:gate calls tsx scripts/ci-gate.ts.
  §7.4 clean-clone assertion added.

---

## Changelog from v0-4-3

All 20 approved solve items (SOLVE-001 through SOLVE-020) plus CONTRA-509.

**Law corrections:**

- SOLVE-001 / CONTRA-501: §2 governing precedence and §7.1 /docs filenames updated to v0.3.5 + v0.4.4
- SOLVE-002 / CONTRA-502: Build instructions v0-2-0 is canonical; supersedes v0-1-0
- SOLVE-003 / CONTRA-503: §13.9.9–13.9.10 shared templateFingerprintPayload() helper; approvalLinkage excluded by field omission not undefined substitution
- SOLVE-004 (NEW): §15.5 canonicalize strips undefined-valued keys; throws on non-key undefined
- SOLVE-005 / CONTRA-504: §13.9.5 buildApprovalRequest expiresAt = approvalConfig.timeoutSeconds; invariant enforced by test
- SOLVE-006 / HOLE-501: §15.2 new Approver Key Contract; §22.3 new approver key loading law; --approver-id required on all approval commands
- SOLVE-007 / THREAT-501: §19.2 MCP auto-create path removed; §20.4 MCP auto-create law removed
- SOLVE-008 / THREAT-502: §23.1 Management API binds 127.0.0.1; admin bearer token at keys/admin.token; all routes gated
- SOLVE-009 / HOLE-502: §10.3.5 delegationSequence added to AgentAction; §10.3.20 actionSummary carries delegationSequence; §13.9.13 buildRedactedActionSummary updated; forensic only, not CCV
- SOLVE-010 / CONTRA-505 + CONTRA-509: §10.2 SEQUENCE_ANOMALY comment corrected; §16.2 chain verifier emits SEQUENCE_ANOMALY on discontinuity; §17.1 erroneous "satisfied by other mechanisms" note removed
- SOLVE-011 / CONTRA-506: §20.4 SessionStore.get() returns regardless of expiry; Gate 01 owns SESSION_EXPIRED denial (already correct in Gate 01 code; store contract fixed)
- SOLVE-012 / HOLE-503: §7.1 bin wiring contract added
- SOLVE-013 (NEW): §13.7 Gate 06 catches NexusSecurityViolation separately; ThreatEvent emitted; maps to denied_threat
- SOLVE-014 / CONTRA-507: §16.2 chain verifier enforces expectedSeq continuity; emits SEQUENCE_ANOMALY on gap/regression
- SOLVE-015 / CONTRA-508: §7.4 ci:gate text corrected to "all 11 steps in this exact order"
- SOLVE-016 (NEW): §12.1 ApprovalConfig.channels[] collapsed to channelId: string; §13.6 Gate 05 uses channelId directly
- SOLVE-017 (NEW): §20.4 POST /sessions body no longer accepts principalId; derived server-side from actor.principalId; mismatch with delegation.principalId throws
- SOLVE-018 (NEW): §21.1 mintRootDelegation validates environment == actor.environment; throws DelegationError on mismatch
- SOLVE-019 (NEW): §10.2 SCENARIO_MANIFEST governed constant; §22.1 --scenario validates against manifest
- SOLVE-020 (NEW): §10.2 NEXUS_VERSION + DELEGATION_ENGINE_ID constants; §21.1 mintedBy uses DELEGATION_ENGINE_ID

---

## 1. Purpose

This engineering spec translates the approved Nexus blueprint into deterministic build law.
The intent is to let a builder implement the system line by line without inventing architecture
during the build.

This spec is exhaustive for Layer 1 (Core Engine), Layer 2 (Runtime Contract), Layer 3
(MCP Adapter v1), Layer 4 (reference connectors: Vault + Stub), and minimum Layer 5
(CLI + management API) required for the POC.

---

## 2. Governing Precedence

1. nexus-blueprint-v0-3-6.md
2. this engineering spec (nexus-engineering-spec-v0-4-6.md)
3. owner-approved audit resolutions and owner-approved reference files
4. builder implementation details

If the spec has a hole, resolve by the blueprint first.
If the blueprint does not resolve the hole, a best-solve may be proposed and logged for owner approval.
No best-solve is canonical until owner approval.
If the spec contradicts the blueprint, the blueprint wins and the contradiction must be logged.

Blueprint wins all conflicts. Build instructions are not law. They govern builder-session
behavior only and are not fallback for holes in this spec.

---

## 3. Implementation Choice

### 3.1 Language

TypeScript strict on Node.js 20+. pnpm workspaces + Turborepo. Vitest for testing.

### 3.2 Strictness Rules

```json
{
  "strict": true,
  "noImplicitAny": true,
  "exactOptionalPropertyTypes": true,
  "noUncheckedIndexedAccess": true,
  "useUnknownInCatchVariables": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true
}
```

No `any` in production code except one isolated adapter ingress boundary.

### 3.3 Runtime Validation

Zod v3 for all external-input validation. Runtime parse-and-throw. JSON schema export from Zod schemas.

---

## 4. Build Scope

### 4.1 In Scope

- Layer 1 core engine (all 7 gates, crypto, ledger core, approval orchestrator, grant minting, security layer, CCV materialization)
- Layer 2 runtime contract (all types, governed constants, schemas, all interfaces)
- Layer 3 MCP proxy Adapter v1
- Layer 4 Vault connector (HashiCorp) + StubConnector (test double)
- Layer 5 CLI (all commands) + management REST API
- JSONL ledger backend (Backend v1)
- CLI approval channel (Channel v1)
- Ed25519 crypto layer
- Replay detector (SQLite-backed), injection guard, rate limiter, threat log
- Actor registry, principal registry, approver registry, session store, delegation store,
  pending approval store (all SQLite)
- Grant vault (WeakMap in-memory secret store)
- Delegation engine
- Capability registry and risk classifier
- All 10 POC fixture scenarios
- Unit tests for all 7 gates
- Threat test suite (10 cases)
- Integration tests (10-scenario matrix)
- Deterministic replay verification

### 4.2 Out of Scope for This Spec

Explicitly deferred:

- Dashboard UI
- Slack approval channel (Channel v3)
- Webhook approval channel (Channel v2) — NO webhook code, stub, or partial
  implementation exists in this POC. Channel v2 will be introduced in a later spec.
  The ApprovalChannel interface preserves the future extension point; no code is needed.
- REST adapter (Adapter v2)
- Okta/identity connector (deferred; Vault connector is the reference implementation)
- PostgreSQL ledger backend (Backend v2)
- S3 ledger backend (Backend v3)
- Multi-node ledger replication
- SOC 2 export formatting
- Production K8s manifests
- Self-service actor registration portal
- Connector marketplace
- MFA or SSO integration for approver identity
- Live rotation automation for base secrets

Test fixture carve-out: fixtures MAY contain synthetic secrets labeled with
`FIXTURE_SYNTHETIC_SECRET` prefix. Never used outside test harnesses.

---

## 5. Resolved Audit Carry-Forwards

### 5.1 All v0.3.2 Closures (carried forward)

Sessions, delegations, grant-vault, run orchestrator, webhook dead-end, string-matching
denial, SQLite blobs, 13 undefined helpers, PoC looseness items — all resolved in v0.3.2.
See §30.2 for full list.

### 5.2 CONTRA-402 — Gate Interface Signature (carried forward from v0.4.3)

Resolved: §11.1. Gate.evaluate signature is `(action, context, priorDecisions)`.

### 5.3 CONTRA-403 — Replay Sequence Anomaly (carried forward from v0.4.3)

Resolved: §10.3.5 delegationSequence on AgentAction, §17.1 nextSequence(), §20.1 delegation_sequences table.

### 5.4 CONTRA-404 — Delegation Chain Silent Truncation (carried forward from v0.4.3)

Resolved: §13.9.12 throws DelegationChainIntegrityError; §13.4 Gate 03 catches and returns CHAIN_INTEGRITY_BROKEN.

### 5.5–5.11 HOLE-401 through HOLE-406 and HOLE-205/CONTRA-001 (carried forward)

All resolved in v0.4.3. See §30.2.

### 5.12 New in v0.4.4 — SOLVE-001 through SOLVE-020 + CONTRA-509

All resolved in this spec version. See §30 for closure entries.

---

## 6. Product Identity

Nexus is: a policy-aware action router, an authority governance layer for AI agents,
a signed evidence ledger for agent actions, an execution-grant broker.

Nexus is not: a secrets vault, an IAM replacement, an OAuth server, an agent framework,
a compliance reporting suite, a chat interface, a certifier of any action.

---

## 7. Repository Contract

### 7.1 Repository Root Layout

```
nexus/
├── docs/
│   ├── nexus-blueprint-v0-3-6.md
│   └── nexus-engineering-spec-v0-4-6.md
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── engine/
│   │   │   │   ├── pipeline.ts
│   │   │   │   └── pipeline-context.ts
│   │   │   ├── gates/
│   │   │   │   ├── gate.interface.ts
│   │   │   │   ├── 01-identity.gate.ts
│   │   │   │   ├── 02-classification.gate.ts
│   │   │   │   ├── 03-delegation.gate.ts
│   │   │   │   ├── 04-policy.gate.ts
│   │   │   │   ├── 05-approval.gate.ts
│   │   │   │   ├── 06-execution.gate.ts
│   │   │   │   └── 07-evidence.gate.ts
│   │   │   ├── identity/
│   │   │   │   ├── actor-registry.ts
│   │   │   │   ├── principal-registry.ts
│   │   │   │   ├── approver-registry.ts
│   │   │   │   ├── session-store.ts
│   │   │   │   ├── delegation-store.ts
│   │   │   │   └── delegation-engine.ts
│   │   │   ├── classification/
│   │   │   │   ├── verb-normalizer.ts
│   │   │   │   ├── target-normalizer.ts
│   │   │   │   ├── capability-registry.ts
│   │   │   │   ├── data-classifier.ts
│   │   │   │   └── risk-classifier.ts
│   │   │   ├── policy/
│   │   │   │   ├── evaluator.ts
│   │   │   │   ├── rule-loader.ts
│   │   │   │   ├── grant-template-builder.ts
│   │   │   │   └── rules/
│   │   │   │       └── default.policy.json
│   │   │   ├── approval/
│   │   │   │   ├── orchestrator.ts
│   │   │   │   ├── packager.ts
│   │   │   │   ├── channel.interface.ts
│   │   │   │   ├── pending-approval-store.ts
│   │   │   │   └── channels/
│   │   │   │       └── cli.channel.ts
│   │   │   ├── execution/
│   │   │   │   ├── grant-minter.ts
│   │   │   │   └── grant-vault.ts
│   │   │   ├── ledger/
│   │   │   │   ├── ledger.ts
│   │   │   │   ├── chain-verifier.ts
│   │   │   │   ├── backend.interface.ts
│   │   │   │   └── backends/
│   │   │   │       └── jsonl.backend.ts
│   │   │   ├── crypto/
│   │   │   │   ├── signer.ts
│   │   │   │   ├── verifier.ts
│   │   │   │   ├── key-manager.ts
│   │   │   │   └── canonicalize.ts
│   │   │   ├── security/
│   │   │   │   ├── replay-detector.ts
│   │   │   │   ├── injection-guard.ts
│   │   │   │   ├── rate-limiter.ts
│   │   │   │   └── threat-log.ts
│   │   │   ├── redaction/
│   │   │   │   └── redactor.ts
│   │   │   ├── compiler-view/
│   │   │   │   └── ccv-builder.ts
│   │   │   ├── db/
│   │   │   │   └── schema.ts
│   │   │   ├── types/
│   │   │   │   └── index.ts
│   │   │   └── utils/
│   │   │       ├── time.ts
│   │   │       └── helpers.ts
│   │   └── package.json
│   ├── adapters/
│   │   └── mcp/
│   │       ├── mcp-proxy.ts
│   │       ├── mcp-normalizer.ts
│   │       ├── mcp-intent-extractor.ts
│   │       └── mcp-server.ts
│   ├── connectors/
│   │   ├── vault/
│   │   │   └── hashicorp.connector.ts
│   │   └── stub/
│   │       └── stub.connector.ts
│   └── interfaces/
│       ├── cli/
│       │   └── src/
│       │       └── index.ts
│       └── api/
│           └── src/
│               └── server.ts
├── keys/
│   ├── dev.keypair.json            (gitignored in production; committed for dev/CI)
│   ├── admin.token                 (gitignored; generated at nexus init)
│   └── approvers/                  (gitignored; per-approver keypairs)
│       └── <approverId>.keypair.json
├── fixtures/
│   ├── scenario-01-allow-read/
│   ├── scenario-02-allow-create/
│   ├── scenario-03-approval-approved/
│   ├── scenario-04-approval-denied/
│   ├── scenario-05-approval-timeout/
│   ├── scenario-06-replay-detected/
│   ├── scenario-07-default-deny/
│   ├── scenario-08-policy-unsigned/
│   ├── scenario-09-broad-token-bypass/
│   └── scenario-10-delegation-exceeded/
├── runs/
│   └── RUN-<id>/
├── schemas/
│   └── *.schema.json
├── scripts/
│   ├── ci-gate.ts
│   ├── gen-keys.ts
│   └── sign-policy.ts
├── package.json           (includes bin wiring — see §7.1.1)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.js
├── vitest.config.ts
├── vitest.integration.config.ts
├── vitest.threat.config.ts
├── README.md
├── LICENSE
├── .gitignore
├── .editorconfig
├── .prettierrc
└── .github/
    └── workflows/
        └── ci.yml
```

#### 7.1.1 Bin Wiring Law

Root `package.json` must include:

```json
{
  "bin": {
    "nexus": "packages/interfaces/cli/dist/index.js",
    "nexus-mcp-proxy": "packages/adapters/mcp/dist/mcp-server.js"
  }
}
```

Dev execution: `tsx packages/interfaces/cli/src/index.ts` for CLI;
`tsx packages/adapters/mcp/src/mcp-server.ts` for MCP proxy.
Production: built dist files via bin entries. Both must be executable from a clean clone.
Missing bin wiring is a ci:gate failure.

### 7.2 Required Package Scripts

```json
{
  "scripts": {
    "format:check": "prettier --check .",
    "lint": "eslint packages --ext .ts",
    "typecheck": "tsc --noEmit -p tsconfig.base.json",
    "test": "vitest run --reporter=verbose",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:threat": "vitest run --config vitest.threat.config.ts",
    "build": "turbo build",
    "ci:gate": "tsx scripts/ci-gate.ts",
    "nexus": "tsx packages/interfaces/cli/src/index.ts",
    "nexus:mcp": "tsx packages/adapters/mcp/src/mcp-server.ts"
  }
}
```

format:check and lint are distinct targets. They are not merged. ci:gate invokes
`tsx scripts/ci-gate.ts` — not `node scripts/ci-gate.ts`. tsx must be a declared
dev dependency. scripts/ci-gate.ts must exist in the repo layout.

### 7.3 turbo.json Pipeline

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["build"] }
  }
}
```

### 7.4 ci:gate Script — all 11 steps in this exact order

1.  format check (prettier --check)
2.  typecheck (tsc --noEmit)
3.  unit tests — all 7 gate unit test files
4.  threat test suite — all 10 threat test files
5.  integration tests — all 10 scenario integration tests
6.  deterministic replay test (scenarios 1, 2, 3 — CCV must be byte-identical)
7.  ledger chain integrity verification (chain-verifier on integration test ledger)
8.  CCV integrity gate (re-derive CCV from body; assert matches stored compilerView; re-hash)
9.  no-certification-language gate (scan all artifact outputs for prohibited strings)
10. policy signature gate (all fixture policy files have valid Ed25519 signatures)
11. fixture secret prefix gate (all secret-named fields in fixtures are empty, null,
    or prefixed with FIXTURE_SYNTHETIC_SECRET:)

All 11 steps must pass in this exact order. No step may be skipped. No gate may be waived
without owner approval and log entry.

**Clean-clone assertion**: A fresh clone must complete install → format:check → lint →
typecheck → test → ci:gate without inventing missing config files. Any file referenced
by a script must be present in the declared repo layout. Failure of this assertion is a
build contract violation.

---

## 8. Architecture Mapping

### 8.1 Layer 1 — Core Engine

`packages/core/src/`. Must not import from `packages/adapters`, `packages/connectors`,
or `packages/interfaces`.

### 8.2 Layer 2 — Runtime Contract

`packages/core/src/types/index.ts` and `schemas/*.schema.json`. All interfaces and governed
constants. Adapters, connectors, and interfaces import from core types.

### 8.3 Layer 3 — Protocol Adapters

`packages/adapters/`. Imports from core types only. Calls `pipeline.process(action)`.

### 8.4 Layer 4 — Connector Registry

`packages/connectors/`. Satisfies `connector.interface.ts`. Resolved by system type at runtime.

### 8.5 Layer 5 — Control Interface

`packages/interfaces/`. CLI and management API. Imports from core types and calls core services.

---

## 9. Canonical Runtime Flow

```
[Adapter receives incoming protocol request]
       │
       ▼
[AdapterNormalizer.normalize(raw)] → AgentAction (resolved fields null)
       │
       ▼
[SecurityLayer.checkIngress(action)] → replay check, rate limit, schema validation
  if threat → DENY + threat log + Gate 07
       │
       ▼
[Pipeline.process(action, context)]
       ├── Gate 01: Identity
       │     fail → denied_identity + Gate 07
       │
       ├── Gate 02: Classification
       │     fail → denied_classification + Gate 07
       │     sets: resolvedVerb, resolvedCapability, resolvedTarget,
       │           resolvedDataClasses, resolvedRiskTier
       │
       ├── Gate 03: Delegation
       │     fail → denied_delegation + Gate 07
       │     sets: context.delegationSnapshot
       │
       ├── Gate 04: Policy
       │     deny → denied_policy + Gate 07
       │     sets: policyOutcome, policyRuleId, ExecutionGrantTemplate (incl. approvalConfig)
       │     if REQUIRE_APPROVAL or ESCALATE → Gate 05
       │     if ALLOW → Gate 06
       │
       ├── Gate 05: Approval (conditional)
       │     fail/timeout/deny → denied_approval/denied_timeout + Gate 07
       │     sets: signedApprovalRequest, signedApprovalResponse
       │
       ├── Gate 06: Execution
       │     control: assertTemplateIntegrity → mint ExecutionGrant
       │     catch NexusSecurityViolation → denied_threat + ThreatEvent + Gate 07
       │     data: connector.execute(action, grant)
       │     fail → error + Gate 07 still runs
       │
       └── Gate 07: Evidence (always runs)
             compute CCV → build recordBody incl. CCV → hash → sign → append to ledger
```

---

## 10. Canonical Data Types

### 10.1 Primitive Aliases

```ts
type Uuid = string; // UUID v4 — from crypto.randomUUID()
type IsoTimestamp = string; // ISO 8601 UTC — from new Date().toISOString()
type Sha256Hex = string; // 64-char lowercase hex
type Base64Url = string; // URL-safe base64, no padding
type NonEmpty = string; // validated non-empty at construction
type SemVer = string; // e.g. "v0.3.5"
```

### 10.2 Governed Constants

All governed types are open `string` aliases. Constants define the known set.
New values may be added by spec update. No value removed or renamed without a blueprint
version bump. The TypeScript type is `string` — NOT `typeof CONST[keyof typeof CONST]`.

```ts
// Actor classes — open governed type
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

// Risk tiers — open governed type (ordered: low < medium < high < critical)
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
  SEQUENCE_ANOMALY: 'sequence_anomaly', // ledger sequence discontinuity — emitted by chain verifier
  CHAIN_INTEGRITY_BROKEN: 'chain_integrity_broken', // parent delegation not found in store
} as const;
export type DenialCode = string;

// Version constants
export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
export const BLUEPRINT_VERSION: SemVer = 'v0.3.6';
export const SPEC_VERSION: SemVer = 'v0.4.6';
export const CAPABILITY_TAXONOMY_VERSION: SemVer = 'v0.1.0';
export const COMPARISON_INPUT_VERSION: SemVer = 'v0.1.0';

// Component version constants — used in mintedBy and audit fields
// Never hardcode version strings in implementation code; use these constants.
export const NEXUS_VERSION: SemVer = 'v0.1.0';
export const DELEGATION_ENGINE_ID: NonEmpty = `nexus-delegation-engine/${NEXUS_VERSION}`;

// Replay dedup window — configurable at startup. Default 3600s (1 hour).
// Minimum: 300s (5 minutes). Maximum: 86400s (24 hours).
// Value outside bounds: engine refuses to start.
// Decrease below default: log as posture change in operator notes.
export const REPLAY_DEDUP_TTL_SECONDS = 3600;

// Canonical capability IDs — the v0.1.0 governed set.
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

// Scenario manifest — canonical map of all 10 POC fixture scenarios.
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
```

### 10.3 Core Interfaces

#### 10.3.1 Principal

```ts
interface Principal {
  principalId: Uuid;
  displayName: NonEmpty;
  email: NonEmpty;
  registeredAt: IsoTimestamp;
  maxDelegableRiskTier: RiskTier;
  allowedSystems: string[];
}
```

#### 10.3.2 Actor

```ts
interface Actor {
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
```

Validation: if actorClass is not HUMAN or HUMAN_WITH_COPILOT, owner/purpose/reviewCadence
must be present and non-empty. Missing fields → registry rejection.

#### 10.3.3 DelegationContext

```ts
interface DelegationContext {
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
```

#### 10.3.4 Session

```ts
interface Session {
  sessionId: Uuid;
  actorId: Uuid;
  principalId: Uuid; // derived server-side from actor.principalId; never caller-supplied
  delegationId: Uuid;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}
```

principalId is always derived from actor.principalId at session creation. Caller-supplied
principalId is rejected. See §20.4 for session creation law.

#### 10.3.5 AgentAction

```ts
interface AgentAction {
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
```

#### 10.3.6 IntentContext

```ts
interface IntentContext {
  objectiveSummary: NonEmpty; // max 500 chars, sanitized
  triggeringSource: NonEmpty; // 'user_request'|'schedule'|'event'|'sub_task'|'unknown'
  toolchainContext: NonEmpty; // adapter name + version
  modelId: string | null;
  modelConfidence: number | null; // [0,1]
  riskNote: string | null; // max 200 chars, sanitized
  extractedAt: IsoTimestamp;
}
```

#### 10.3.7 GateDecision

```ts
interface GateDecision {
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
```

`denialCode` is the machine-readable denial identifier. `computeFinalOutcome` maps on denialCode.
`reason` is the human-readable description. Never use `reason.includes(...)` for programmatic logic.

#### 10.3.8 ResourceTarget

```ts
interface ResourceTarget {
  system: NonEmpty;
  resourceType: NonEmpty;
  resourceScope: 'single' | 'bulk' | 'collection' | 'system';
  environment: EnvironmentId;
  externalFacing: boolean;
}
```

#### 10.3.9 ExecutionGrantTemplate

```ts
interface ExecutionGrantTemplate {
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
  // Both buildGrantTemplate and assertTemplateIntegrity use the same helper. See §13.9.10.
}
```

#### 10.3.10 ResourceBounds

```ts
interface ResourceBounds {
  allowedResourceTypes: string[];
  maxRecords: number | null;
  allowBulk: boolean;
  allowExternalFacing: boolean;
}
```

#### 10.3.11 ApprovalRequest

```ts
interface ApprovalRequest {
  approvalId: Uuid;
  actionId: Uuid;
  templateId: Uuid;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp; // = addSeconds(issuedAt, approvalConfig.timeoutSeconds)
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
```

Invariant: expiresAt must equal addSeconds(issuedAt, approvalConfig.timeoutSeconds).
Hardcoded expiry constants are prohibited. This invariant is tested explicitly.

#### 10.3.12 ApprovalResponse

```ts
interface ApprovalResponse {
  approvalId: Uuid;
  decision: ApprovalDecisionLabel;
  decidedBy: NonEmpty; // registered approver ID; 'system:timeout' for timeout responses
  decidedAt: IsoTimestamp;
  channel: NonEmpty;
  note: string | null;
  signature: Base64Url; // Ed25519 by approver key; '<none>' for timeout responses
}
```

Timeout responses are system-generated and must NEVER reach the external verification path.
See §13.6 for explicit guard.

#### 10.3.13 ExecutionGrant

```ts
interface ExecutionGrant {
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
```

#### 10.3.14 CredentialSubject

```ts
interface CredentialSubject {
  subjectId: NonEmpty;
  subjectType: 'user_identity' | 'service_identity' | 'federated';
  system: NonEmpty;
}
```

#### 10.3.15 ExecutionResult

```ts
interface ExecutionResult {
  grantId: Uuid;
  executedAt: IsoTimestamp;
  status: 'success' | 'failure' | 'partial';
  responseCode: string | null;
  durationMs: number;
  redactedSummary: string | null;
  errorType: string | null;
  errorMessage: string | null;
}
```

#### 10.3.16 ExecutionGrantMetadata (evidence-safe, no secret)

```ts
interface ExecutionGrantMetadata {
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
```

#### 10.3.17 DelegationContextSnapshot

```ts
interface DelegationContextSnapshot {
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
```

#### 10.3.18 ThreatEvent

```ts
type ThreatType =
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

interface ThreatEvent {
  threatType: ThreatType;
  detectedAt: IsoTimestamp;
  gateId: GateId | 'ingress';
  detail: NonEmpty; // max 300 chars, sanitized
}
```

`security_violation` is emitted when Gate 06 catches a NexusSecurityViolation from a
connector execution path. It maps to FINAL_OUTCOME.DENIED_THREAT.

#### 10.3.19 IntentEvidence (evidence-safe subset of IntentContext)

```ts
interface IntentEvidence {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId: string | null;
  modelConfidence: number | null;
  riskNote: string | null;
}
```

#### 10.3.20 EvidenceRecord

```ts
interface EvidenceRecord {
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
    delegationSequence: number; // engine-assigned per-delegation sequence; forensic ordering
    tool: string;
    resolvedVerb: ActionVerb | null;
    resolvedCapability: string | null;
    resolvedTarget: ResourceTarget | null;
    resolvedDataClasses: DataClass[];
    resolvedRiskTier: RiskTier | null;
  };
  intentEvidence: IntentEvidence;
  delegationContextSnapshot: DelegationContextSnapshot;
  gateDecisions: GateDecision[];
  policyRuleId: string | null;
  policyOutcome: OutcomeLabel | null;
  approvalRequest: ApprovalRequest | null;
  approvalResponse: ApprovalResponse | null;
  grantMetadata: ExecutionGrantMetadata | null;
  executionResult: ExecutionResult | null;
  finalOutcome: FinalOutcome;
  threatEvents: ThreatEvent[];
  compilerView: CompilerComparisonView; // inside signed body
  previousHash: Sha256Hex;
  recordHash: Sha256Hex; // sha256(canonicalize(record minus recordHash + signature))
  signature: Base64Url; // Ed25519 over recordHash
}
```

delegationSequence in actionSummary is forensic only. It is not in CCV and not part of
the comparison key.

---

## 10.4 Capability Taxonomy v0.1.0

| CapabilityId               | Verb    | Target Type  | ResourceScope      | ExternalFacing | DefaultRiskTier |
| -------------------------- | ------- | ------------ | ------------------ | -------------- | --------------- |
| `read:record:single`       | read    | any record   | single             | false          | low             |
| `read:record:bulk`         | read    | any record   | bulk or collection | false          | medium          |
| `read:record:pii`          | read    | pii-tagged   | single             | false          | medium          |
| `read:record:bulk:pii`     | read    | pii-tagged   | bulk               | false          | high            |
| `create:record:internal`   | create  | any record   | single             | false          | medium          |
| `create:record:external`   | create  | any record   | single             | true           | high            |
| `update:record:internal`   | update  | any record   | single             | false          | medium          |
| `update:record:external`   | update  | any record   | single             | true           | high            |
| `delete:record`            | delete  | any record   | single             | false          | high            |
| `delete:record:bulk`       | delete  | any record   | bulk               | false          | critical        |
| `send:message:internal`    | send    | message      | single             | false          | medium          |
| `send:message:external`    | send    | message      | single             | true           | high            |
| `publish:content:internal` | publish | content      | single             | false          | medium          |
| `publish:content:external` | publish | content      | single             | true           | high            |
| `export:data:single`       | export  | any data     | single             | false          | medium          |
| `export:data:bulk`         | export  | any data     | bulk               | false          | high            |
| `export:data:bulk:pii`     | export  | pii data     | bulk               | false          | critical        |
| `execute:query`            | execute | query/script | single             | false          | medium          |
| `execute:automation`       | execute | workflow/job | single             | false          | high            |

Capability resolution function: see §13.9.1.

---

## 11. Interface Contracts

### 11.1 Gate Interface

```ts
interface Gate {
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

interface PipelineContext {
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
}

interface GateResult {
  decision: GateDecision;
  actionMutations?: Partial<AgentAction>; // Gate 02 only
  grantTemplate?: ExecutionGrantTemplate; // Gate 04 only
  delegationSnapshot?: DelegationContextSnapshot; // Gate 03 only
  grant?: ExecutionGrant; // Gate 06 only
  executionResult?: ExecutionResult; // Gate 06 only
  approvalRequest?: ApprovalRequest; // Gate 05 only
  approvalResponse?: ApprovalResponse; // Gate 05 only
}
```

### 11.2 Adapter Interface

```ts
interface Adapter {
  readonly adapterProtocol: NonEmpty;
  readonly adapterVersion: NonEmpty;
  normalize(rawRequest: unknown): Promise<NormalizationResult>;
}

interface NormalizationResult {
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
```

### 11.3 Connector Interface

```ts
interface Connector {
  readonly systemType: NonEmpty;
  readonly connectorVersion: NonEmpty;
  supportedCapabilities(): string[];
  canProduceDiff(): boolean;
  produceDiff?(action: AgentAction, template: ExecutionGrantTemplate): Promise<string | null>;
  execute(action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult>;
  redeemGrant(grant: ExecutionGrant): Promise<void>;
}
```

Connector `execute` MUST call `assertGrantPresent(grant)` and `assertGrantNotExpired(grant)`.
These will throw `NexusSecurityViolation` if violated. Gate 06 catches NexusSecurityViolation
separately from generic errors — see §13.7.

**StubConnector** — test double for all 10 integration fixture scenarios:

```ts
// packages/connectors/stub/stub.connector.ts
class StubConnector implements Connector {
  readonly systemType = 'stub';
  readonly connectorVersion = 'v0.1.0';
  private calls: { action: AgentAction; grantId: Uuid }[] = [];

  supportedCapabilities(): string[] {
    return Object.values(CAPABILITY_IDS);
  }

  canProduceDiff(): boolean {
    return true;
  }

  async produceDiff(action: AgentAction): Promise<string> {
    return `[STUB DIFF] ${buildActionSummaryText(action)} — preview not available in stub`;
  }

  async redeemGrant(grant: ExecutionGrant): Promise<void> {
    setGrantSecret(grant, 'FIXTURE_SYNTHETIC_SECRET:stub-credential-' + grant.grantId);
  }

  async execute(action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult> {
    assertGrantPresent(grant);
    assertGrantNotExpired(grant);
    this.calls.push({ action, grantId: grant.grantId });
    return {
      grantId: grant.grantId,
      executedAt: nowIso(),
      status: 'success',
      responseCode: '200',
      durationMs: 1,
      redactedSummary: '[STUB] action executed successfully',
      errorType: null,
      errorMessage: null,
    };
  }

  getCalls() {
    return [...this.calls];
  }
  reset() {
    this.calls = [];
  }
}
```

All 10 integration fixture scenarios use StubConnector. The HashiCorp Vault connector is
the reference production connector but is NOT used in fixture scenarios.

### 11.4 Approval Channel Interface

```ts
interface ApprovalChannel {
  readonly channelId: NonEmpty;
  readonly channelVersion: NonEmpty;
  dispatch(request: ApprovalRequest): Promise<void>;
  awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null>;
}
```

### 11.5 Ledger Backend Interface

```ts
interface LedgerBackend {
  readonly backendId: NonEmpty;
  readonly backendVersion: NonEmpty;
  append(record: EvidenceRecord): Promise<void>;
  getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null>;
  getBySequence(seq: number): Promise<EvidenceRecord | null>;
  getLatestSequence(): Promise<number>;
  listRange(from: number, to: number): Promise<EvidenceRecord[]>;
}
```

No DELETE or UPDATE method may exist on this interface.

### 11.6 ApproverRegistry Interface

```ts
interface Approver {
  approverId: NonEmpty; // matches ApprovalResponse.decidedBy
  displayName: NonEmpty;
  publicKey: Base64Url; // Ed25519 public key, 32 bytes base64url
  channels: NonEmpty[];
  registeredAt: IsoTimestamp;
}

interface ApproverRegistry {
  get(approverId: NonEmpty): Promise<Approver | null>;
  list(): Promise<Approver[]>;
  register(approver: Omit<Approver, 'registeredAt'>): Promise<Approver>;
}

async function verifyApproverSignature(
  response: ApprovalResponse,
  registry: ApproverRegistry
): Promise<boolean> {
  if (response.decidedBy === 'system:timeout') return false;
  const approver = await registry.get(response.decidedBy);
  if (!approver) return false;
  const { signature, ...body } = response;
  return crypto.verify(canonicalize(body), signature, approver.publicKey);
}
```

### 11.7 DelegationStore Interface

```ts
interface DelegationStore {
  getById(delegationId: Uuid): Promise<DelegationContext | null>;
  save(dc: DelegationContext): Promise<void>;
  listForActor(actorId: Uuid): Promise<DelegationContext[]>;
}
```

---

## 12. Policy File Contract

### 12.1 PolicyFile Shape and LoadedPolicyFile

```ts
interface PolicyFile {
  version: '1.0';
  bundleId: Uuid;
  bundleVersion: NonEmpty;
  issuer: NonEmpty;
  issuedAt: IsoTimestamp;
  signature: Base64Url; // Ed25519 over canonicalize() of all fields except signature
  defaultOutcome: 'deny';
  rules: PolicyRule[];
}

interface LoadedPolicyFile extends PolicyFile {
  sortedRules: PolicyRule[]; // pre-sorted by priority ascending at load time; immutable
  bundleHash: Sha256Hex; // pre-computed at load time; written to CCV
}

interface PolicyRule {
  ruleId: NonEmpty;
  description: NonEmpty;
  priority: number; // lower number = higher priority; first match wins
  conditions: PolicyCondition;
  outcome: OutcomeLabel;
  approvalConfig: ApprovalConfig | null; // required when outcome === 'require_approval'
  grantHint: GrantTemplateHint | null;
}

interface PolicyCondition {
  actorClasses?: ActorClass[];
  capabilities?: string[];
  actionVerbs?: ActionVerb[];
  riskTiers?: RiskTier[];
  dataClasses?: DataClass[];
  // dataClasses matching is ANY (OR) logic.
  // AND/ALL matching reserved for a future spec version; not supported in v0.4.4.
  dataClassMatchMode?: 'any'; // fixed to 'any'; reserved
  environments?: EnvironmentId[];
  externalFacing?: boolean;
  maxChainDepth?: number;
}

interface ApprovalConfig {
  channelId: NonEmpty; // single channel ID for this POC — not a list
  timeoutSeconds: number; // 30 <= x <= 3600
  onTimeout: 'deny'; // always 'deny', non-configurable
}
// Note: channels[] array from v0.4.3 is replaced by channelId: string.
// Ordered multi-channel fallback is deferred to Channel v2 specification.
// Any code that treats channelId as an array is a build violation.

interface GrantTemplateHint {
  expiryClass?: ExpiryClass;
  allowBulk?: boolean;
  allowExternalFacing?: boolean;
  maxRecords?: number;
}
```

### 12.2 Policy Bundle Hash

```ts
function computePolicyBundleHash(policyFile: PolicyFile): Sha256Hex {
  const { signature, ...rest } = policyFile;
  return sha256(canonicalize(rest));
}
```

### 12.3 Policy File Loading Law

```ts
async function loadPolicyFile(filepath: string): Promise<LoadedPolicyFile> {
  const raw = await fs.readFile(filepath, 'utf-8');
  const parsed = PolicyFileSchema.parse(JSON.parse(raw));

  const { signature, ...body } = parsed;
  const isValid = await crypto.verify(canonicalize(body), signature, controlPlanePublicKey);

  if (!isValid) {
    throw new PolicySignatureError(`Policy file ${filepath} signature invalid — rejected`);
  }

  return {
    ...parsed,
    sortedRules: [...parsed.rules].sort((a, b) => a.priority - b.priority),
    bundleHash: computePolicyBundleHash(parsed),
  };
}
```

Policy loader behavior:

- **At startup**: if `loadPolicyFile` throws, the engine MUST NOT start. Exit non-zero.
- **At runtime reload**: if `loadPolicyFile` throws for a new file, keep current bundle active; log the rejection.
- **No valid bundle**: `policyFile` in PipelineContext is `null`. Gate 04 returns DENY with `denialCode: DENIAL_CODE.DEFAULT_DENY` on every action.

### 12.4 Default Policy File

```json
{
  "version": "1.0",
  "bundleId": "00000000-0000-0000-0000-000000000001",
  "bundleVersion": "v0.1.0-dev",
  "issuer": "nexus-dev",
  "issuedAt": "2026-04-14T00:00:00.000Z",
  "signature": "<signed-at-build-time>",
  "defaultOutcome": "deny",
  "rules": [
    {
      "ruleId": "allow-low-risk-read",
      "description": "Allow supervised agents to read single records in dev",
      "priority": 10,
      "conditions": {
        "actorClasses": ["SUPERVISED_AGENT"],
        "capabilities": ["read:record:single"],
        "riskTiers": ["low"],
        "environments": ["dev"]
      },
      "outcome": "allow",
      "approvalConfig": null,
      "grantHint": { "expiryClass": "action_scoped", "maxRecords": 1 }
    },
    {
      "ruleId": "require-approval-high-risk",
      "description": "Require approval for high-risk external sends",
      "priority": 20,
      "conditions": {
        "riskTiers": ["high", "critical"],
        "externalFacing": true
      },
      "outcome": "require_approval",
      "approvalConfig": {
        "channelId": "cli",
        "timeoutSeconds": 300,
        "onTimeout": "deny"
      },
      "grantHint": { "expiryClass": "short_lived", "allowExternalFacing": true }
    }
  ]
}
```

---

## 13. Gate Implementations

### 13.1 Pipeline Orchestrator — `packages/core/src/engine/pipeline.ts`

The orchestrator is an explicit stateful control-flow pipeline — NOT a generic gate loop.
Gate 05 and Gate 06 are not in the main gate array. They are invoked explicitly based
on Gate 04's outcome. Gate 07 always runs exactly once, unconditionally.

Invariants enforced by this structure:

- Gate 05 is never invoked on ALLOW paths.
- Gate 05 is invoked at most once per action.
- Gate 06 is never invoked before Gate 04 passes.
- Gate 06 is never invoked on approval-required paths without a resolved ApprovalResponse.
- Gate 07 runs exactly once per action regardless of all upstream outcomes.

```ts
async function process(action: AgentAction, context: PipelineContext): Promise<EvidenceRecord> {
  const decisions: GateDecision[] = [];

  // === GATES 01-04: fixed sequential pipeline ===
  const linearGates: Gate[] = [identityGate, classificationGate, delegationGate, policyGate];

  for (const gate of linearGates) {
    const result = await gate.evaluate(action, context, decisions);
    decisions.push(result.decision);

    // Apply Gate 02 action mutations
    if (result.actionMutations) Object.assign(action, result.actionMutations);
    // Capture Gate 03 delegation snapshot
    if (result.delegationSnapshot) context.delegationSnapshot = result.delegationSnapshot;
    // Capture Gate 04 grant template
    if (result.grantTemplate) context.grantTemplate = result.grantTemplate;

    const isDeny = result.decision.outcome === 'deny' || result.decision.outcome === 'error';
    if (isDeny) {
      // Skip to Gate 07 — no further gate evaluation
      return runGate07(action, context, decisions);
    }
  }

  // === POST-GATE-04 BRANCH — explicit on OutcomeLabel ===
  const policyOutcome = context.grantTemplate?.approvalRequired
    ? context.grantTemplate.approvalRequired
      ? 'require_approval'
      : 'allow'
    : decisions[decisions.length - 1]!.outcome;

  const outcome = decisions[decisions.length - 1]!.outcome; // Gate 04 outcome

  if (outcome === OUTCOME_LABEL.REQUIRE_APPROVAL || outcome === OUTCOME_LABEL.ESCALATE) {
    // === GATE 05: Approval ===
    const approvalResult = await approvalGate.evaluate(action, context, decisions);
    decisions.push(approvalResult.decision);
    if (approvalResult.approvalRequest) context.approvalRequest = approvalResult.approvalRequest;
    if (approvalResult.approvalResponse) context.approvalResponse = approvalResult.approvalResponse;

    const approvalDenied =
      approvalResult.decision.outcome === 'deny' || approvalResult.decision.outcome === 'error';
    if (approvalDenied) {
      // Gate 05 denied — skip Gate 06, run Gate 07
      return runGate07(action, context, decisions);
    }

    // Gate 05 passed — run Gate 06
    const execResult = await executionGate.evaluate(action, context, decisions);
    decisions.push(execResult.decision);
    if (execResult.grant) context.executionGrant = execResult.grant;
    if (execResult.executionResult) context.executionResult = execResult.executionResult;
  } else if (outcome === OUTCOME_LABEL.ALLOW) {
    // === GATE 06: Execution (no approval required) ===
    const execResult = await executionGate.evaluate(action, context, decisions);
    decisions.push(execResult.decision);
    if (execResult.grant) context.executionGrant = execResult.grant;
    if (execResult.executionResult) context.executionResult = execResult.executionResult;
  } else {
    // DENY or unknown outcome — run Gate 07 directly
    return runGate07(action, context, decisions);
  }

  // === GATE 07: Evidence (always runs) ===
  return runGate07(action, context, decisions);
}

// Gate 07 always runs exactly once per action. Extracted to prevent duplication.
async function runGate07(
  action: AgentAction,
  context: PipelineContext,
  decisions: GateDecision[]
): Promise<EvidenceRecord> {
  const evidenceResult = await evidenceGate.evaluate(action, context, decisions);
  decisions.push(evidenceResult.decision);
  if (!context.lastEvidenceRecord)
    throw new Error('invariant: lastEvidenceRecord must be set by Gate 07');
  return context.lastEvidenceRecord;
}
```

### 13.2 Gate 01 — Identity

```ts
async function evaluateIdentity(
  action: AgentAction,
  context: PipelineContext,
  _prior: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  const actor = await actorRegistry.get(action.actorId);
  if (!actor)
    return gateDeny(
      GATE_ID.G01,
      1,
      DENIAL_CODE.ACTOR_NOT_REGISTERED,
      'actor not registered',
      startMs
    );

  // SessionStore.get() returns the session regardless of expiry.
  // Gate 01 owns the expiry check — the store does not filter by expiry.
  const session = await sessionStore.get(action.sessionId);
  if (!session)
    return gateDeny(GATE_ID.G01, 1, DENIAL_CODE.SESSION_NOT_FOUND, 'session not found', startMs);
  if (new Date(session.expiresAt) <= new Date())
    return gateDeny(GATE_ID.G01, 1, DENIAL_CODE.SESSION_EXPIRED, 'session expired', startMs);

  const principal = await principalRegistry.get(action.principalId);
  if (!principal)
    return gateDeny(
      GATE_ID.G01,
      1,
      DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE,
      'principal not resolvable',
      startMs
    );
  if (actor.principalId !== principal.principalId)
    return gateDeny(
      GATE_ID.G01,
      1,
      DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH,
      'actor/principal mismatch',
      startMs
    );

  const isNonHuman =
    actor.actorClass !== ACTOR_CLASS.HUMAN && actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;
  if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
    return gateDeny(
      GATE_ID.G01,
      1,
      DENIAL_CODE.NON_HUMAN_ACTOR_INCOMPLETE,
      'non-human actor registry incomplete',
      startMs
    );
  }

  context.actor = actor;
  context.principal = principal;
  return gatePass(GATE_ID.G01, 1, startMs);
}
```

### 13.3 Gate 02 — Classification

```ts
async function evaluateClassification(
  action: AgentAction,
  context: PipelineContext,
  _prior: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  const verb = verbNormalizer.normalize(action.rawVerb);
  if (!verb)
    return gateClassifDeny(
      GATE_ID.G02,
      2,
      DENIAL_CODE.UNRESOLVABLE_VERB,
      'unresolvable action verb',
      startMs
    );

  const target = targetNormalizer.normalize(
    action.rawTarget,
    action.tool,
    context.actor.environment
  );
  if (!target)
    return gateClassifDeny(
      GATE_ID.G02,
      2,
      DENIAL_CODE.UNRESOLVABLE_TARGET,
      'unresolvable target',
      startMs
    );

  const dataClasses = dataClassifier.classify(action.intent, target, verb);
  const capabilityId = resolveCapability(verb, target, dataClasses);
  if (!capabilityId)
    return gateClassifDeny(
      GATE_ID.G02,
      2,
      DENIAL_CODE.UNRESOLVABLE_CAPABILITY,
      'unresolvable capability',
      startMs
    );

  const riskTier = riskClassifier.compute(
    capabilityId,
    dataClasses,
    target.environment,
    target.externalFacing
  );

  return {
    decision: gatePass(GATE_ID.G02, 2, startMs).decision,
    actionMutations: {
      resolvedVerb: verb,
      resolvedCapability: capabilityId,
      resolvedTarget: target,
      resolvedDataClasses: dataClasses,
      resolvedRiskTier: riskTier,
    },
  };
}
```

Risk tier computation rule: see §13.9.2.

### 13.4 Gate 03 — Delegation

```ts
async function evaluateDelegation(
  action: AgentAction,
  context: PipelineContext,
  _prior: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();
  const dc = context.delegationContext;

  const { signature, ...body } = dc;
  if (!(await crypto.verify(canonicalize(body), signature, controlPlanePublicKey))) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.DELEGATION_SIG_INVALID,
      'delegation signature invalid',
      startMs
    );
  }

  if (new Date(dc.expiresAt) <= new Date()) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.DELEGATION_EXPIRED, 'delegation expired', startMs);
  }

  if (!dc.allowedCapabilities.includes(action.resolvedCapability!)) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION,
      'capability not in delegation',
      startMs
    );
  }

  if (dc.forbiddenCapabilities.includes(action.resolvedCapability!)) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.CAPABILITY_FORBIDDEN,
      'capability explicitly forbidden',
      startMs
    );
  }

  if (!dc.allowedSystems.includes(action.resolvedTarget!.system)) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.SYSTEM_NOT_IN_DELEGATION,
      'system not in delegation',
      startMs
    );
  }

  if (riskTierExceeds(action.resolvedRiskTier!, dc.maxRiskTier)) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.RISK_TIER_EXCEEDS_CEILING,
      'risk tier exceeds delegation ceiling',
      startMs
    );
  }

  if (
    context.actor.actorClass === ACTOR_CLASS.DELEGATED_SUBAGENT &&
    dc.chainDepth >= dc.maxChainDepth
  ) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.CHAIN_DEPTH_EXCEEDED,
      'chain depth ceiling exceeded',
      startMs
    );
  }

  if (dc.parentDelegationId !== null && !dc.allowDownstreamPropagation) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.PROPAGATION_NOT_PERMITTED,
      'downstream propagation not permitted',
      startMs
    );
  }

  // Environment must match — blueprint §8.3 law
  if (action.resolvedTarget!.environment !== dc.environment) {
    return gateDeny(
      GATE_ID.G03,
      3,
      DENIAL_CODE.ENVIRONMENT_MISMATCH,
      `environment mismatch: delegation scoped to ${dc.environment}, ` +
        `action targets ${action.resolvedTarget!.environment}`,
      startMs
    );
  }

  // Build delegation snapshot — throws DelegationChainIntegrityError if parent missing
  let delegationSnapshot: DelegationContextSnapshot;
  try {
    delegationSnapshot = await buildDelegationSnapshotFromChain(dc, context.delegationStore);
  } catch (err) {
    if (err instanceof DelegationChainIntegrityError) {
      return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.CHAIN_INTEGRITY_BROKEN, err.message, startMs);
    }
    throw err;
  }

  return {
    decision: gatePass(GATE_ID.G03, 3, startMs).decision,
    delegationSnapshot,
  };
}
```

### 13.5 Gate 04 — Policy

```ts
async function evaluatePolicy(
  action: AgentAction,
  context: PipelineContext,
  _prior: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  if (!context.policyFile) {
    return gateDeny(
      GATE_ID.G04,
      4,
      DENIAL_CODE.DEFAULT_DENY,
      'no valid policy bundle loaded',
      startMs
    );
  }

  const envelope = {
    actorClass: context.actor.actorClass,
    capability: action.resolvedCapability!,
    verb: action.resolvedVerb!,
    riskTier: action.resolvedRiskTier!,
    dataClasses: action.resolvedDataClasses,
    environment: action.resolvedTarget!.environment,
    externalFacing: action.resolvedTarget!.externalFacing,
    chainDepth: context.delegationContext.chainDepth,
  };

  const matchedRule = context.policyFile.sortedRules.find(r =>
    matchesCondition(r.conditions, envelope)
  );
  const outcome = matchedRule?.outcome ?? OUTCOME_LABEL.DENY;
  const policyRuleId = matchedRule?.ruleId ?? 'default_deny';

  if (outcome === OUTCOME_LABEL.DENY) {
    return gateDeny(
      GATE_ID.G04,
      4,
      DENIAL_CODE.POLICY_DENY,
      `policy deny: rule ${policyRuleId}`,
      startMs,
      policyRuleId
    );
  }

  const template = buildGrantTemplate(action, matchedRule, context);

  return {
    decision: {
      gateId: GATE_ID.G04,
      gateOrder: 4,
      plane: 'control',
      outcome,
      reason: `policy rule matched: ${policyRuleId}`,
      denialCode: null,
      policyRuleId,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
    grantTemplate: template,
  };
}
```

### 13.6 Gate 05 — Approval

```ts
async function evaluateApproval(
  action: AgentAction,
  context: PipelineContext,
  _prior: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();
  // Gate 04 must have set context.grantTemplate before Gate 05 is invoked.
  // Orchestrator invariant: Gate 05 is never called unless Gate 04 passed.
  const template = context.grantTemplate!;
  const approvalConfig = template.approvalConfig;

  if (!approvalConfig) {
    return gateDeny(
      GATE_ID.G05,
      5,
      DENIAL_CODE.APPROVAL_CONFIG_MISSING,
      'approval required but template carries no config',
      startMs
    );
  }

  // Attempt diff from connector — non-fatal if unavailable
  let diff: string | null = null;
  const connector = context.connectorRegistry.get(action.resolvedTarget!.system);
  if (connector?.canProduceDiff()) {
    try {
      diff = await connector.produceDiff!(action, template);
      if (diff && diff.length > 2000) diff = diff.slice(0, 2000) + '...[TRUNCATED]';
    } catch {
      diff = null;
    }
  }

  const requestBody = await buildApprovalRequest(action, template, context, diff);
  const sig = await crypto.sign(canonicalize(requestBody), controlPlaneKey);
  const signedRequest: ApprovalRequest = { ...requestBody, signature: sig };

  // Use channelId (string) directly — not channels[0]
  const channelId = approvalConfig.channelId;
  const channel = context.channelRegistry.get(channelId);
  if (!channel) {
    return gateDeny(
      GATE_ID.G05,
      5,
      DENIAL_CODE.APPROVAL_CHANNEL_NOT_FOUND,
      `channel ${channelId} not registered`,
      startMs
    );
  }

  await channel.dispatch(signedRequest);

  const timeoutMs = approvalConfig.timeoutSeconds * 1000;
  const response = await channel.awaitDecision(signedRequest.approvalId, timeoutMs);

  if (!response) {
    const timeoutResponse: ApprovalResponse = {
      approvalId: signedRequest.approvalId,
      decision: APPROVAL_DECISION_LABEL.TIMED_OUT,
      decidedBy: 'system:timeout',
      decidedAt: nowIso(),
      channel: channelId,
      note: null,
      signature: '<none>',
    };
    return gateDenyWithApproval(
      GATE_ID.G05,
      5,
      DENIAL_CODE.APPROVAL_TIMEOUT,
      'approval timed out',
      startMs,
      signedRequest,
      timeoutResponse
    );
  }

  if (!(await verifyApproverSignature(response, context.approverRegistry))) {
    return gateDenyWithApproval(
      GATE_ID.G05,
      5,
      DENIAL_CODE.APPROVAL_SIG_INVALID,
      'approval response signature invalid',
      startMs,
      signedRequest,
      response
    );
  }

  if (response.decision === APPROVAL_DECISION_LABEL.DENIED) {
    return gateDenyWithApproval(
      GATE_ID.G05,
      5,
      DENIAL_CODE.APPROVAL_DENIED_BY_HUMAN,
      'approval denied by human',
      startMs,
      signedRequest,
      response
    );
  }

  template.approvalLinkage = signedRequest.approvalId;

  return {
    decision: {
      gateId: GATE_ID.G05,
      gateOrder: 5,
      plane: 'control',
      outcome: 'pass',
      reason: `approval granted by ${response.decidedBy}`,
      denialCode: null,
      policyRuleId: null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
    approvalRequest: signedRequest,
    approvalResponse: response,
  };
}

function gateDenyWithApproval(
  gateId: GateId,
  order: number,
  code: DenialCode,
  reason: string,
  startMs: number,
  req: ApprovalRequest,
  resp: ApprovalResponse
): GateResult {
  return {
    decision: {
      gateId,
      gateOrder: order,
      plane: 'control',
      outcome: 'deny',
      reason,
      denialCode: code,
      policyRuleId: null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
    approvalRequest: req,
    approvalResponse: resp,
  };
}
```

### 13.7 Gate 06 — Execution

```ts
async function evaluateExecution(
  action: AgentAction,
  context: PipelineContext,
  _prior: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();
  // Gate 04 must have set context.grantTemplate before Gate 06 is invoked.
  // Orchestrator invariant: Gate 06 is never called unless Gate 04 passed.
  const template = context.grantTemplate!;

  // === CONTROL PLANE: Verify template integrity and mint grant ===
  assertTemplateIntegrity(template);
  const grant = await mintGrant(action, template, context.approvalRequest ?? null);

  // === DATA PLANE: Connector forwarding ===
  const connector = context.connectorRegistry.get(action.resolvedTarget!.system);
  if (!connector) {
    return gateError(
      GATE_ID.G06,
      6,
      DENIAL_CODE.CONNECTOR_NOT_REGISTERED,
      'connector not registered for system: ' + action.resolvedTarget!.system,
      startMs
    );
  }
  if (!connector.supportedCapabilities().includes(action.resolvedCapability!)) {
    return gateError(
      GATE_ID.G06,
      6,
      DENIAL_CODE.CONNECTOR_CAP_UNSUPPORTED,
      'connector does not support capability: ' + action.resolvedCapability!,
      startMs
    );
  }

  await connector.redeemGrant(grant);

  let executionResult: ExecutionResult;
  try {
    executionResult = await connector.execute(action, grant);
  } catch (err) {
    // NexusSecurityViolation: governed security breach — emit ThreatEvent, map to denied_threat
    if (err instanceof NexusSecurityViolation) {
      const threatEvent: ThreatEvent = {
        threatType: 'security_violation',
        detectedAt: nowIso(),
        gateId: GATE_ID.G06,
        detail: `Security violation in connector execution: ${err.message}`.slice(0, 300),
      };
      context.threatLog.push(threatEvent);
      return {
        decision: {
          gateId: GATE_ID.G06,
          gateOrder: 6,
          plane: 'data',
          outcome: 'deny',
          reason: err.message,
          denialCode: err.denialCode,
          policyRuleId: null,
          evaluatedAt: nowIso(),
          durationMs: Date.now() - startMs,
          metadata: { violationType: err.violationType },
        },
      };
    }
    // Generic connector error — map to error outcome, no ThreatEvent
    executionResult = {
      grantId: grant.grantId,
      executedAt: nowIso(),
      status: 'failure',
      responseCode: null,
      durationMs: 0,
      redactedSummary: null,
      errorType: 'connector_execution_error',
      errorMessage: sanitizeError(err),
    };
  } finally {
    clearGrantSecret(grant); // always clear — even on NexusSecurityViolation, even on success
  }

  return {
    decision: {
      gateId: GATE_ID.G06,
      gateOrder: 6,
      plane: 'data',
      outcome: executionResult!.status === 'failure' ? 'error' : 'pass',
      reason: `connector execution: ${executionResult!.status}`,
      denialCode: null,
      policyRuleId: null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: { connectorStatus: executionResult!.status },
    },
    grant,
    executionResult: executionResult!,
  };
}

async function mintGrant(
  action: AgentAction,
  template: ExecutionGrantTemplate,
  approval: ApprovalRequest | null
): Promise<ExecutionGrant> {
  const expiresAt = addSeconds(nowIso(), template.maxExpirySeconds);
  const credSub = resolveCredentialSubject(template, action);
  const grantBody = {
    grantId: uuid(),
    actionId: action.actionId,
    templateId: template.templateId,
    approvalId: approval?.approvalId ?? null,
    mintedAt: nowIso(),
    expiresAt,
    capabilityId: template.capabilityId,
    scopeDescriptor: template.scopeDescriptor,
    credentialSubject: credSub,
    resourceBounds: template.resourceBounds,
    environmentBound: template.environmentBound,
  };
  const signature = await crypto.sign(canonicalize(grantBody), controlPlaneKey);
  return { ...grantBody, signature };
}
```

### 13.8 Gate 07 — Evidence

```ts
async function evaluateEvidence(
  action: AgentAction,
  context: PipelineContext,
  decisions: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  const prevRecord = await ledger.getBySequence(await ledger.getLatestSequence());
  const prevHash = prevRecord?.recordHash ?? GENESIS_HASH;
  const nextSequence = (prevRecord?.ledgerSequence ?? 0) + 1;

  const delegationSnapshot =
    context.delegationSnapshot ?? buildMinimalDelegationSnapshot(context.delegationContext);

  const actionSummary = buildRedactedActionSummary(action, context.actor);
  const grantMeta = context.executionGrant
    ? buildGrantMetadata(context.executionGrant, context.grantTemplate!)
    : null;
  const intentEv = buildIntentEvidence(action.intent);
  const finalOutcome = computeFinalOutcome(decisions);
  const policyDecision = decisions.find(d => d.gateId === GATE_ID.G04);

  const recordBodyPreCCV = {
    recordId: uuid(),
    actionId: action.actionId,
    sessionId: action.sessionId,
    ledgerSequence: nextSequence,
    actionSummary,
    intentEvidence: intentEv,
    delegationContextSnapshot: delegationSnapshot,
    gateDecisions: decisions,
    policyRuleId: policyDecision?.policyRuleId ?? null,
    policyOutcome: policyDecision ? (policyDecision.outcome as OutcomeLabel) : null,
    approvalRequest: context.approvalRequest ?? null,
    approvalResponse: context.approvalResponse ?? null,
    grantMetadata: grantMeta,
    executionResult: context.executionResult
      ? redactExecutionResult(context.executionResult, action.resolvedDataClasses)
      : null,
    finalOutcome,
    threatEvents: context.threatLog,
    previousHash: prevHash,
  };

  const compilerView = buildCCV(recordBodyPreCCV, context);
  const recordBodyFull = { ...recordBodyPreCCV, compilerView };

  const recordHash = sha256(canonicalize(recordBodyFull));
  const signature = await crypto.sign(recordHash, controlPlaneKey);
  const record: EvidenceRecord = { ...recordBodyFull, recordHash, signature };

  await ledger.append(record);
  context.lastEvidenceRecord = record;

  return {
    decision: {
      gateId: GATE_ID.G07,
      gateOrder: 7,
      plane: 'control',
      outcome: 'pass',
      reason: 'evidence record written',
      denialCode: null,
      policyRuleId: null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: { ledgerSequence: nextSequence },
    },
  };
}

function computeFinalOutcome(decisions: GateDecision[]): FinalOutcome {
  for (const d of decisions) {
    if (
      d.outcome === 'pass' ||
      d.outcome === 'allow' ||
      d.outcome === OUTCOME_LABEL.REQUIRE_APPROVAL ||
      d.outcome === OUTCOME_LABEL.ESCALATE
    )
      continue;
    if (d.outcome === 'error') return FINAL_OUTCOME.ERROR;

    const code = d.denialCode;
    if (code === DENIAL_CODE.APPROVAL_TIMEOUT) return FINAL_OUTCOME.DENIED_TIMEOUT;
    if (
      code === DENIAL_CODE.REPLAY_DETECTED ||
      code === DENIAL_CODE.RATE_LIMIT_EXCEEDED ||
      code === DENIAL_CODE.BROAD_TOKEN_BYPASS ||
      code === DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED ||
      code === DENIAL_CODE.GRANT_EXPIRED
    )
      return FINAL_OUTCOME.DENIED_THREAT;

    // Gate 06 NexusSecurityViolation — also denied_threat
    if (d.gateId === GATE_ID.G06 && d.outcome === 'deny') return FINAL_OUTCOME.DENIED_THREAT;

    if (d.gateId === GATE_ID.G01) return FINAL_OUTCOME.DENIED_IDENTITY;
    if (d.gateId === GATE_ID.G02) return FINAL_OUTCOME.DENIED_CLASSIF;
    if (d.gateId === GATE_ID.G03) return FINAL_OUTCOME.DENIED_DELEGATION;
    if (d.gateId === GATE_ID.G04) return FINAL_OUTCOME.DENIED_POLICY;
    if (d.gateId === GATE_ID.G05) return FINAL_OUTCOME.DENIED_APPROVAL;
  }
  return FINAL_OUTCOME.EXECUTED;
}
```

### 13.9 Gate Implementation Helpers

All helpers defined in `packages/core/src/utils/helpers.ts` unless noted otherwise.

### 13.9.1 resolveCapability

```ts
function resolveCapability(
  verb: ActionVerb,
  target: ResourceTarget,
  dataClasses: DataClass[]
): string | null {
  const hasPii = dataClasses.some(dc => dc === DATA_CLASS.PII || dc === DATA_CLASS.PHI);
  const isBulk = target.resourceScope === 'bulk' || target.resourceScope === 'collection';
  const isExt = target.externalFacing;
  if (verb === ACTION_VERB.READ) {
    if (hasPii && isBulk) return 'read:record:bulk:pii';
    if (hasPii) return 'read:record:pii';
    if (isBulk) return 'read:record:bulk';
    return 'read:record:single';
  }
  if (verb === ACTION_VERB.CREATE)
    return isExt ? 'create:record:external' : 'create:record:internal';
  if (verb === ACTION_VERB.UPDATE)
    return isExt ? 'update:record:external' : 'update:record:internal';
  if (verb === ACTION_VERB.DELETE) return isBulk ? 'delete:record:bulk' : 'delete:record';
  if (verb === ACTION_VERB.SEND) return isExt ? 'send:message:external' : 'send:message:internal';
  if (verb === ACTION_VERB.PUBLISH)
    return isExt ? 'publish:content:external' : 'publish:content:internal';
  if (verb === ACTION_VERB.EXPORT) {
    if (hasPii && isBulk) return 'export:data:bulk:pii';
    if (isBulk) return 'export:data:bulk';
    return 'export:data:single';
  }
  if (verb === ACTION_VERB.EXECUTE) {
    if (target.resourceType === 'automation' || target.resourceType === 'workflow') {
      return 'execute:automation';
    }
    return 'execute:query';
  }
  return null;
}
```

### 13.9.2 computeRiskTier

```ts
function computeRiskTier(
  capabilityId: string,
  dataClasses: DataClass[],
  environment: EnvironmentId,
  externalFacing: boolean
): RiskTier {
  const capEntry = capabilityRegistry.get(capabilityId);
  let tier = capEntry.defaultRiskTier;
  if (
    dataClasses.some(
      dc => dc === DATA_CLASS.PII || dc === DATA_CLASS.PHI || dc === DATA_CLASS.FINANCIAL
    )
  ) {
    tier = elevateRiskTier(tier, RISK_TIER.MEDIUM);
  }
  if (environment === ENVIRONMENT_ID.PRODUCTION) tier = elevateRiskTier(tier, RISK_TIER.MEDIUM);
  if (externalFacing) tier = elevateRiskTier(tier, RISK_TIER.HIGH);
  return tier;
}
function elevateRiskTier(current: RiskTier, minimum: RiskTier): RiskTier {
  return RISK_TIER_ORDER.indexOf(current) >= RISK_TIER_ORDER.indexOf(minimum) ? current : minimum;
}
```

### 13.9.3 buildActionSummaryText

```ts
function buildActionSummaryText(action: AgentAction): string {
  const verb = action.resolvedVerb ?? action.rawVerb;
  const target = action.resolvedTarget
    ? `${action.resolvedTarget.system}/${action.resolvedTarget.resourceType}`
    : action.rawTarget;
  const scope = action.resolvedTarget?.resourceScope ?? 'single';
  const ext = action.resolvedTarget?.externalFacing ? ' (external)' : '';
  return `${verb} ${target} [${scope}]${ext}`;
}
```

### 13.9.4 computeEstimatedImpact

```ts
function computeEstimatedImpact(
  riskTier: RiskTier,
  dataClasses: DataClass[],
  target: ResourceTarget
): NonEmpty {
  const parts: string[] = [`${riskTier.toUpperCase()} risk`];
  if (target.externalFacing) parts.push('external-facing');
  if (target.resourceScope === 'bulk' || target.resourceScope === 'collection')
    parts.push('bulk operation');
  if (dataClasses.length > 0) parts.push(`data: ${[...dataClasses].sort().join(', ')}`);
  return parts.join(' | ');
}
```

### 13.9.5 buildApprovalRequest (Gate 05)

```ts
async function buildApprovalRequest(
  action: AgentAction,
  template: ExecutionGrantTemplate,
  context: PipelineContext,
  diff: string | null
): Promise<Omit<ApprovalRequest, 'signature'>> {
  const issuedAt = nowIso();
  // expiresAt must equal addSeconds(issuedAt, approvalConfig.timeoutSeconds).
  // Hardcoded constants are prohibited. Invariant tested in §27.
  const expiresAt = addSeconds(issuedAt, template.approvalConfig!.timeoutSeconds);

  return {
    approvalId: uuid(),
    actionId: action.actionId,
    templateId: template.templateId,
    issuedAt,
    expiresAt,
    actionSummary: buildActionSummaryText(action).slice(0, 300),
    contextSummary: action.intent.objectiveSummary.slice(0, 500),
    proposedTarget: action.resolvedTarget!,
    diff,
    estimatedImpact: computeEstimatedImpact(
      action.resolvedRiskTier!,
      action.resolvedDataClasses,
      action.resolvedTarget!
    ),
    principalDisplayName: context.principal.displayName,
    actorDisplayName: context.actor.displayName,
    riskTier: action.resolvedRiskTier!,
    dataClasses: action.resolvedDataClasses,
    modelConfidence: action.intent.modelConfidence,
    riskNote: action.intent.riskNote,
  };
}
```

### 13.9.6 resolveCredentialSubjectType

```ts
function resolveCredentialSubjectType(
  actorClass: ActorClass,
  _system: string
): 'user_identity' | 'service_identity' | 'federated' {
  if (actorClass === ACTOR_CLASS.HUMAN || actorClass === ACTOR_CLASS.HUMAN_WITH_COPILOT) {
    return 'user_identity';
  }
  return 'service_identity';
}
```

### 13.9.7 buildScopeDescriptor

```ts
function buildScopeDescriptor(
  capabilityId: string,
  target: ResourceTarget,
  hint: GrantTemplateHint | null | undefined
): NonEmpty {
  const base = `${capabilityId}@${target.system}:${target.resourceType}:${target.resourceScope}`;
  const ext = hint?.allowExternalFacing || target.externalFacing ? ':external' : '';
  return base + ext;
}
```

### 13.9.8 resolveCredentialSubject (Gate 06)

```ts
function resolveCredentialSubject(
  template: ExecutionGrantTemplate,
  action: AgentAction
): CredentialSubject {
  const subjectType = template.credentialSubjectType as CredentialSubject['subjectType'];
  return {
    subjectId: subjectType === 'user_identity' ? action.actorId : `svc:${action.actorId}`,
    subjectType,
    system: action.resolvedTarget!.system,
  };
}
```

### 13.9.9 Fingerprint Projection Helper + assertTemplateIntegrity (Gate 06)

The fingerprint payload helper is the single source of truth for what gets fingerprinted.
Both buildGrantTemplate (§13.9.10) and assertTemplateIntegrity call this helper.
They must produce identical payloads or the integrity check will correctly fail.

```ts
// Shared projection helper — packages/core/src/utils/helpers.ts
// Omits templateFingerprint and approvalLinkage by field destructuring, not undefined substitution.
// undefined values are illegal in canonicalize(); omission is the correct approach.
function templateFingerprintPayload(
  template: Omit<ExecutionGrantTemplate, 'templateFingerprint' | 'approvalLinkage'>
): Record<string, unknown> {
  return { ...template };
}

function assertTemplateIntegrity(template: ExecutionGrantTemplate): void {
  // Destructure to omit fingerprint and approvalLinkage — exact mirror of buildGrantTemplate
  const { templateFingerprint, approvalLinkage, ...body } = template;
  const expected = sha256(canonicalize(templateFingerprintPayload(body)));
  if (expected !== template.templateFingerprint) {
    throw new NexusSecurityViolation(
      'template_fingerprint_mismatch',
      DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED
    );
  }
  if (template.approvalRequired && !template.approvalLinkage) {
    throw new NexusSecurityViolation(
      'approval_required_but_linkage_absent',
      DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED
    );
  }
}
```

### 13.9.10 buildGrantTemplate (Gate 04)

```ts
function buildGrantTemplate(
  action: AgentAction,
  rule: PolicyRule | undefined,
  context: PipelineContext
): ExecutionGrantTemplate {
  const hint = rule?.grantHint;
  const expiryClass = hint?.expiryClass ?? EXPIRY_CLASS.ACTION_SCOPED;
  const maxExpiry = EXPIRY_CLASS_SECONDS[expiryClass] ?? 30;
  const resourceBounds: ResourceBounds = {
    allowedResourceTypes: [action.resolvedTarget!.resourceType],
    maxRecords: hint?.maxRecords ?? 1,
    allowBulk: hint?.allowBulk ?? false,
    allowExternalFacing: hint?.allowExternalFacing ?? false,
  };
  const dc = context.delegationContext;
  if (!dc.allowedSystems.includes(action.resolvedTarget!.system)) {
    throw new NexusSecurityViolation(
      'grant_template_exceeds_delegation_scope',
      DENIAL_CODE.BROAD_TOKEN_BYPASS
    );
  }
  const credentialSubjectType = resolveCredentialSubjectType(
    context.actor.actorClass,
    action.resolvedTarget!.system
  );
  const scopeDescriptor = buildScopeDescriptor(
    action.resolvedCapability!,
    action.resolvedTarget!,
    hint
  );

  // Build the template body without fingerprint or approvalLinkage
  const templateBody = {
    templateId: uuid(),
    actionId: action.actionId,
    computedAt: nowIso(),
    capabilityId: action.resolvedCapability!,
    scopeDescriptor,
    credentialSubjectType,
    resourceBounds,
    environmentBound: action.resolvedTarget!.environment,
    expiryClass,
    maxExpirySeconds: maxExpiry,
    approvalRequired:
      rule?.outcome === OUTCOME_LABEL.REQUIRE_APPROVAL || rule?.outcome === OUTCOME_LABEL.ESCALATE,
    approvalConfig: rule?.approvalConfig ?? null,
  };

  // Fingerprint using shared helper — approvalLinkage omitted by not being in templateBody at all
  const templateFingerprint = sha256(canonicalize(templateFingerprintPayload(templateBody)));

  // approvalLinkage starts null; set by Gate 05 after approval
  return { ...templateBody, approvalLinkage: null, templateFingerprint };
}
```

### 13.9.11 buildIntentEvidence (Gate 07)

```ts
function buildIntentEvidence(intent: IntentContext): IntentEvidence {
  return {
    objectiveSummary: intent.objectiveSummary,
    triggeringSource: intent.triggeringSource,
    toolchainContext: intent.toolchainContext,
    modelId: intent.modelId,
    modelConfidence: intent.modelConfidence,
    riskNote: intent.riskNote,
  };
}
```

### 13.9.12 buildDelegationSnapshotFromChain (Gate 03)

```ts
class DelegationChainIntegrityError extends Error {
  constructor(missingId: Uuid) {
    super(`Delegation chain broken: parent ${missingId} not found in store`);
  }
}

async function buildDelegationSnapshotFromChain(
  dc: DelegationContext,
  store: DelegationStore
): Promise<DelegationContextSnapshot> {
  const ancestors: Uuid[] = [];
  let current = dc;
  while (current.parentDelegationId !== null) {
    ancestors.unshift(current.parentDelegationId);
    const parent = await store.getById(current.parentDelegationId);
    if (!parent) {
      throw new DelegationChainIntegrityError(current.parentDelegationId);
    }
    current = parent;
  }
  return {
    delegationId: dc.delegationId,
    principalId: dc.principalId,
    actorId: dc.actorId,
    chainDepth: dc.chainDepth,
    chainAncestors: ancestors,
    chainHash: sha256(canonicalize([dc.delegationId, ...ancestors])),
    allowedSystems: dc.allowedSystems,
    maxRiskTier: dc.maxRiskTier,
    environment: dc.environment,
    expiresAt: dc.expiresAt,
  };
}

function buildMinimalDelegationSnapshot(dc: DelegationContext): DelegationContextSnapshot {
  return {
    delegationId: dc.delegationId,
    principalId: dc.principalId,
    actorId: dc.actorId,
    chainDepth: dc.chainDepth,
    chainAncestors: [],
    chainHash: sha256(canonicalize([dc.delegationId])),
    allowedSystems: dc.allowedSystems,
    maxRiskTier: dc.maxRiskTier,
    environment: dc.environment,
    expiresAt: dc.expiresAt,
  };
}
```

### 13.9.13 buildRedactedActionSummary (Gate 07)

```ts
function buildRedactedActionSummary(
  action: AgentAction,
  actor: Actor
): EvidenceRecord['actionSummary'] {
  return {
    actionId: action.actionId,
    receivedAt: action.receivedAt,
    protocol: action.protocol,
    actorId: action.actorId,
    actorClass: actor.actorClass,
    actorEnvironment: actor.environment,
    principalId: action.principalId,
    delegationSequence: action.delegationSequence, // forensic ordering; not in CCV
    tool: action.tool,
    resolvedVerb: action.resolvedVerb,
    resolvedCapability: action.resolvedCapability,
    resolvedTarget: action.resolvedTarget,
    resolvedDataClasses: action.resolvedDataClasses,
    resolvedRiskTier: action.resolvedRiskTier,
  };
}
```

### 13.9.14 buildGrantMetadata (Gate 07)

```ts
function buildGrantMetadata(
  grant: ExecutionGrant,
  template: ExecutionGrantTemplate
): ExecutionGrantMetadata {
  return {
    grantId: grant.grantId,
    scopeDescriptor: grant.scopeDescriptor,
    credentialSubjectId: grant.credentialSubject.subjectId,
    credentialSubjectType: grant.credentialSubject.subjectType,
    issuedAt: grant.mintedAt,
    expiresAt: grant.expiresAt,
    expiryClass: template.expiryClass,
    templateFingerprint: template.templateFingerprint,
    approvalLinkage: grant.approvalId,
  };
}
```

### 13.9.15 redactExecutionResult (Gate 07)

```ts
function redactExecutionResult(result: ExecutionResult, dataClasses: DataClass[]): ExecutionResult {
  let summary = result.redactedSummary;
  if (dataClasses.includes(DATA_CLASS.PHI)) summary = REDACTION_MARKERS.PHI;
  else if (dataClasses.includes(DATA_CLASS.PII)) summary = REDACTION_MARKERS.PII;
  else if (dataClasses.includes(DATA_CLASS.FINANCIAL)) summary = REDACTION_MARKERS.FINANCIAL;
  const errorMessage = result.errorMessage
    ? result.errorMessage.replace(
        /(secret|password|key|token|credential)[=:\s][^\s,;]*/gi,
        '[REDACTED:SECRET]'
      )
    : null;
  return { ...result, redactedSummary: summary, errorMessage };
}
```

### 13.9.16 sanitizeError

```ts
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return 'connector_unknown_error';
  const msg = err.message
    .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED:SECRET]')
    .slice(0, 500);
  return msg || 'connector_error_no_message';
}
```

### 13.9.17 matchesCondition (Gate 04)

```ts
interface PolicyEvalEnvelope {
  actorClass: ActorClass;
  capability: string;
  verb: ActionVerb;
  riskTier: RiskTier;
  dataClasses: DataClass[];
  environment: EnvironmentId;
  externalFacing: boolean;
  chainDepth: number;
}
function matchesCondition(cond: PolicyCondition, env: PolicyEvalEnvelope): boolean {
  if (cond.actorClasses && !cond.actorClasses.includes(env.actorClass)) return false;
  if (cond.capabilities && !cond.capabilities.includes(env.capability)) return false;
  if (cond.actionVerbs && !cond.actionVerbs.includes(env.verb)) return false;
  if (cond.riskTiers && !cond.riskTiers.includes(env.riskTier)) return false;
  if (cond.dataClasses && !cond.dataClasses.some(dc => env.dataClasses.includes(dc))) return false;
  if (cond.environments && !cond.environments.includes(env.environment)) return false;
  if (cond.externalFacing !== undefined && cond.externalFacing !== env.externalFacing) return false;
  if (cond.maxChainDepth !== undefined && env.chainDepth > cond.maxChainDepth) return false;
  return true;
}
```

### 13.9.18 Gate pass/deny constructors

```ts
function gatePass(gateId: GateId, order: number, startMs: number): GateResult {
  return {
    decision: {
      gateId,
      gateOrder: order,
      plane: 'control',
      outcome: 'pass',
      reason: 'gate passed',
      denialCode: null,
      policyRuleId: null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
  };
}
function gateDeny(
  gateId: GateId,
  order: number,
  code: DenialCode,
  reason: string,
  startMs: number,
  ruleId?: string
): GateResult {
  return {
    decision: {
      gateId,
      gateOrder: order,
      plane: 'control',
      outcome: 'deny',
      reason,
      denialCode: code,
      policyRuleId: ruleId ?? null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
  };
}
function gateClassifDeny(
  gateId: GateId,
  order: number,
  code: DenialCode,
  reason: string,
  startMs: number
): GateResult {
  return gateDeny(gateId, order, code, reason, startMs);
}
function gateError(
  gateId: GateId,
  order: number,
  code: DenialCode,
  reason: string,
  startMs: number
): GateResult {
  return {
    decision: {
      gateId,
      gateOrder: order,
      plane: 'data',
      outcome: 'error',
      reason,
      denialCode: code,
      policyRuleId: null,
      evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs,
      metadata: {},
    },
  };
}
```

### 13.9.19 NexusSecurityViolation

```ts
// packages/core/src/types/errors.ts
class NexusSecurityViolation extends Error {
  constructor(
    public readonly violationType: string,
    public readonly denialCode: DenialCode
  ) {
    super(`Security violation [${denialCode}]: ${violationType}`);
  }
}
```

---

## 14. Compiler Comparison View Law

### 14.1 CompilerComparisonView Interface

```ts
interface CompilerComparisonView {
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
  result: { finalOutcome: FinalOutcome; errorCodeFamily: string | null };
}
```

delegationSequence is NOT a CCV field. It is forensic-only in actionSummary.

### 14.2 Normalized Action Hash

```ts
function computeNormalizedActionHash(action: EvidenceRecord['actionSummary']): Sha256Hex {
  const normalized = {
    tool: action.tool,
    resolvedVerb: action.resolvedVerb,
    resolvedCapability: action.resolvedCapability,
    targetSystem: action.resolvedTarget?.system ?? null,
    targetResourceType: action.resolvedTarget?.resourceType ?? null,
    targetScope: action.resolvedTarget?.resourceScope ?? null,
    externalFacing: action.resolvedTarget?.externalFacing ?? null,
    dataClasses: [...action.resolvedDataClasses].sort(),
    riskTier: action.resolvedRiskTier,
  };
  return sha256(canonicalize(normalized));
}
```

### 14.3 CCV Builder — no invented defaults

```ts
function buildCCV(
  record: Omit<EvidenceRecord, 'compilerView' | 'recordHash' | 'signature'>,
  context: PipelineContext
): CompilerComparisonView {
  const policyDecision = record.gateDecisions.find(d => d.gateId === GATE_ID.G04);
  return {
    meta: {
      blueprintVersion: BLUEPRINT_VERSION,
      runtimeContractVersion: SPEC_VERSION,
      capabilityTaxonomyVersion: CAPABILITY_TAXONOMY_VERSION,
      comparisonInputVersion: COMPARISON_INPUT_VERSION,
      normalizedActionHash: computeNormalizedActionHash(record.actionSummary),
      policyBundleHash: context.policyFile?.bundleHash ?? sha256(canonicalize('no_policy')),
    },
    identity: {
      actorId: record.actionSummary.actorId,
      actorClass: record.actionSummary.actorClass,
      principalId: record.actionSummary.principalId,
      environment: record.actionSummary.actorEnvironment,
    },
    delegation: {
      delegationContextId: record.delegationContextSnapshot.delegationId,
      chainDepth: record.delegationContextSnapshot.chainDepth,
      chainHash: record.delegationContextSnapshot.chainHash,
      maxRiskTier: record.delegationContextSnapshot.maxRiskTier,
    },
    classification: {
      capabilityId: record.actionSummary.resolvedCapability ?? '',
      actionVerb: record.actionSummary.resolvedVerb ?? '',
      dataClasses: [...record.actionSummary.resolvedDataClasses].sort(),
      riskTier: record.actionSummary.resolvedRiskTier ?? '',
    },
    policyAndApproval: {
      policyRuleId: record.policyRuleId,
      outcomeLabel: record.policyOutcome,
      approvalRequired: record.approvalRequest !== null,
      approvalDecisionLabel: record.approvalResponse?.decision ?? null,
    },
    authorityAndExecution: {
      executionGrantId: record.grantMetadata?.grantId ?? null,
      credentialSubjectType: record.grantMetadata?.credentialSubjectType ?? null,
      scopeDescriptor: record.grantMetadata?.scopeDescriptor ?? null,
      expiryClass: record.grantMetadata?.expiryClass ?? null,
      grantTemplateFingerprint: record.grantMetadata?.templateFingerprint ?? null,
    },
    result: {
      finalOutcome: record.finalOutcome,
      errorCodeFamily: record.executionResult?.errorType ?? null,
    },
  };
}
```

### 14.4 CCV Comparability Law

```ts
function areComparable(a: CompilerComparisonView, b: CompilerComparisonView): boolean {
  return (
    a.meta.blueprintVersion === b.meta.blueprintVersion &&
    a.meta.runtimeContractVersion === b.meta.runtimeContractVersion &&
    a.meta.capabilityTaxonomyVersion === b.meta.capabilityTaxonomyVersion &&
    a.meta.comparisonInputVersion === b.meta.comparisonInputVersion &&
    a.identity.actorClass === b.identity.actorClass &&
    a.identity.environment === b.identity.environment &&
    a.classification.capabilityId === b.classification.capabilityId &&
    a.meta.normalizedActionHash === b.meta.normalizedActionHash
  );
}
```

---

## 15. Crypto Law

### 15.1 Algorithm: Ed25519 + SHA-256. Library: `@noble/ed25519`.

### 15.2 Key Management

```ts
interface KeyPair {
  publicKey: Base64Url;
  privateKey: Base64Url;
  generatedAt: IsoTimestamp;
  purpose: 'control_plane' | 'approver' | 'dev';
}
```

**Control plane key**: `keys/dev.keypair.json` in dev; production uses separate secrets management.
Generated by `scripts/gen-keys.ts`. Gitignored in production.

**Admin token**: `keys/admin.token` — a securely generated random string. Created by
`nexus init`. Gitignored always. Required as `Authorization: Bearer <token>` on all
management API mutation routes.

**Approver Key Contract** (SOLVE-006): Per-approver keypairs stored at:

```
keys/approvers/<approverId>.keypair.json
```

The `keys/approvers/` directory is always gitignored. Keys are loaded exclusively by
`key-manager.ts` using the `approverId` as the lookup key. No other code path loads
approver private keys directly.

```ts
// packages/core/src/crypto/key-manager.ts
async function loadApproverKey(approverId: NonEmpty): Promise<KeyPair> {
  const keyPath = path.join('keys', 'approvers', `${approverId}.keypair.json`);
  try {
    const raw = await fs.readFile(keyPath, 'utf-8');
    const pair = JSON.parse(raw) as KeyPair;
    if (pair.purpose !== 'approver') {
      throw new Error(`key at ${keyPath} has purpose '${pair.purpose}', expected 'approver'`);
    }
    return pair;
  } catch (err) {
    throw new Error(
      `Approver key not found for approverId '${approverId}': ${(err as Error).message}`
    );
  }
}

async function loadControlPlaneKey(): Promise<KeyPair> {
  const keyPath = process.env.NEXUS_KEY_PATH ?? path.join('keys', 'dev.keypair.json');
  const raw = await fs.readFile(keyPath, 'utf-8');
  return JSON.parse(raw) as KeyPair;
}

async function generateApproverKeypair(approverId: NonEmpty): Promise<void> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  const pair: KeyPair = {
    publicKey: base64urlEncode(publicKey),
    privateKey: base64urlEncode(privateKey),
    generatedAt: nowIso(),
    purpose: 'approver',
  };
  const keyPath = path.join('keys', 'approvers', `${approverId}.keypair.json`);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, JSON.stringify(pair, null, 2), 'utf-8');
}
```

Dev key fallback for fixtures/tests only: `keys/dev.keypair.json`. Never used as an
approver key in production paths. Fixture usage must prefix any secret values with
`FIXTURE_SYNTHETIC_SECRET:`.

### 15.3 Signature Computation

```ts
async function sign(payload: string, keyPair: KeyPair): Promise<Base64Url> {
  const msgBytes = new TextEncoder().encode(payload);
  const privBytes = base64urlDecode(keyPair.privateKey);
  return base64urlEncode(await ed25519.sign(msgBytes, privBytes));
}
async function verify(
  payload: string,
  signature: Base64Url,
  publicKey: Base64Url
): Promise<boolean> {
  try {
    return await ed25519.verify(
      base64urlDecode(signature),
      new TextEncoder().encode(payload),
      base64urlDecode(publicKey)
    );
  } catch {
    return false;
  }
}
```

All callers pass `canonicalize(obj)` as payload. Never raw JSON.stringify.

### 15.4 Hash Computation

```ts
function sha256(payload: string): Sha256Hex {
  return nodeCrypto.createHash('sha256').update(new TextEncoder().encode(payload)).digest('hex');
}
```

### 15.5 Canonical Serialization — `packages/core/src/crypto/canonicalize.ts`

```ts
export function canonicalize(val: unknown): string {
  // undefined is illegal in canonical payloads.
  // Keys with undefined values are stripped. Non-key undefined throws.
  if (val === null) return 'null';
  if (val === undefined)
    throw new TypeError(
      'canonicalize: undefined is not a legal canonical value — use null or omit the field'
    );
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return (
      '[' +
      val
        .map(v => {
          if (v === undefined)
            throw new TypeError(
              'canonicalize: undefined element in array — use null or remove the element'
            );
          return canonicalize(v);
        })
        .join(',') +
      ']'
    );
  }
  const obj = val as Record<string, unknown>;
  // Strip keys whose value is undefined — they are not part of the canonical payload.
  const keys = Object.keys(obj)
    .filter(k => obj[k] !== undefined)
    .sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]!));
  return '{' + pairs.join(',') + '}';
}
```

`JSON.stringify(obj, Object.keys(obj).sort())` is PROHIBITED throughout the codebase.
All code that computes payloads for signing or hashing must use `canonicalize()`.
No payload passed to `canonicalize()` may contain `undefined` values — use `null` or
omit the field. This law applies to all signature, hash, and fingerprint computation paths.

### 15.6 Utility Functions — `packages/core/src/utils/time.ts`

```ts
import { randomUUID } from 'crypto';
export function uuid(): Uuid {
  return randomUUID();
}
export function nowIso(): IsoTimestamp {
  return new Date().toISOString();
}
export function addSeconds(iso: IsoTimestamp, seconds: number): IsoTimestamp {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 16. Ledger Law

### 16.1 JSONL Backend (Backend v1)

```ts
class JsonlLedgerBackend implements LedgerBackend {
  readonly backendId = 'jsonl-v1';
  readonly backendVersion = 'v0.1.0';
  constructor(private readonly ledgerPath: string) {}

  async append(record: EvidenceRecord): Promise<void> {
    await fs.appendFile(this.ledgerPath, JSON.stringify(record) + '\n', 'utf-8');
  }

  async listRange(from: number, to: number): Promise<EvidenceRecord[]> {
    const results: EvidenceRecord[] = [];
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf-8');
    } catch {
      return [];
    }
    for (const line of raw.split('\n').filter(Boolean)) {
      let record: EvidenceRecord;
      try {
        record = JSON.parse(line) as EvidenceRecord;
      } catch {
        continue;
      }
      if (record.ledgerSequence >= from && record.ledgerSequence <= to) results.push(record);
    }
    return results;
  }

  async getBySequence(seq: number): Promise<EvidenceRecord | null> {
    return (await this.listRange(seq, seq))[0] ?? null;
  }

  async getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf-8');
    } catch {
      return null;
    }
    for (const line of raw.split('\n').filter(Boolean)) {
      let record: EvidenceRecord;
      try {
        record = JSON.parse(line) as EvidenceRecord;
      } catch {
        continue;
      }
      if (record.recordId === recordId) return record;
    }
    return null;
  }

  async getLatestSequence(): Promise<number> {
    let raw: string;
    try {
      raw = await fs.readFile(this.ledgerPath, 'utf-8');
    } catch {
      return 0;
    }
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return 0;
    try {
      return (JSON.parse(lines[lines.length - 1]!) as EvidenceRecord).ledgerSequence;
    } catch {
      return 0;
    }
  }
}
```

### 16.2 Chain Integrity Verifier — O(n) via listRange

Enforces both hash linkage AND sequence continuity. SEQUENCE_ANOMALY is emitted for
any gap or regression in ledgerSequence. Blueprint §9.3 + §11.9 law.

```ts
interface ChainError {
  seq: number;
  type: 'hash_chain_break' | 'signature_invalid' | 'sequence_anomaly';
  denialCode: DenialCode; // CHAIN_INTEGRITY_BROKEN or SEQUENCE_ANOMALY
  detail: string;
}

async function verifyChain(
  backend: LedgerBackend,
  fromSeq: number,
  toSeq: number,
  publicKey: Base64Url
): Promise<ChainVerificationResult> {
  const errors: ChainError[] = [];
  const records = await backend.listRange(fromSeq, toSeq);
  let prevHash =
    fromSeq === 1
      ? GENESIS_HASH
      : ((await backend.getBySequence(fromSeq - 1))?.recordHash ?? GENESIS_HASH);

  let expectedSeq = fromSeq;

  for (const record of records) {
    // Sequence continuity check — emit SEQUENCE_ANOMALY on gap or regression
    if (record.ledgerSequence !== expectedSeq) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'sequence_anomaly',
        denialCode: DENIAL_CODE.SEQUENCE_ANOMALY,
        detail: `Expected ledgerSequence ${expectedSeq}, got ${record.ledgerSequence}`,
      });
      // Advance expectedSeq to record's actual value to continue checking from here
      expectedSeq = record.ledgerSequence;
    }

    // Hash chain check
    if (record.previousHash !== prevHash) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'hash_chain_break',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `Expected previousHash ${prevHash}, got ${record.previousHash}`,
      });
    }

    // Signature check
    const isValid = await verify(record.recordHash, record.signature, publicKey);
    if (!isValid) {
      errors.push({
        seq: record.ledgerSequence,
        type: 'signature_invalid',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `Signature invalid on sequence ${record.ledgerSequence}`,
      });
    }

    prevHash = record.recordHash;
    expectedSeq++;
  }

  return {
    ok: errors.length === 0,
    checkedFrom: fromSeq,
    checkedTo: toSeq,
    recordCount: records.length,
    errors,
  };
}
```

---

## 17. Security Layer

### 17.1 Replay Detector — `packages/core/src/security/replay-detector.ts`

SQLite-backed. Survives process restarts. Uses `REPLAY_DEDUP_TTL_SECONDS` constant.

```ts
class ReplayDetector {
  constructor(private readonly db: Database) {}

  async check(actionId: Uuid): Promise<'ok' | 'replay'> {
    await this.db.run(
      `DELETE FROM replay_cache WHERE seen_at < ?`,
      new Date(Date.now() - REPLAY_DEDUP_TTL_SECONDS * 1000).toISOString()
    );
    const hit = await this.db.get<{ action_id: string }>(
      `SELECT action_id FROM replay_cache WHERE action_id = ?`,
      actionId
    );
    if (hit) return 'replay';
    await this.db.run(
      `INSERT INTO replay_cache(action_id, seen_at) VALUES (?, ?)`,
      actionId,
      nowIso()
    );
    return 'ok';
  }

  // Assigns and returns the next monotonic sequence number for a delegationId.
  // Engine-assigned at ingress. Adapters never supply sequence numbers.
  // Satisfies blueprint §9.2 sequential numbering law.
  async nextSequence(delegationId: Uuid): Promise<number> {
    await this.db.run(
      `INSERT INTO delegation_sequences(delegation_id, last_sequence)
       VALUES (?, 1)
       ON CONFLICT(delegation_id) DO UPDATE SET last_sequence = last_sequence + 1`,
      delegationId
    );
    const row = await this.db.get<{ last_sequence: number }>(
      `SELECT last_sequence FROM delegation_sequences WHERE delegation_id = ?`,
      delegationId
    );
    return row?.last_sequence ?? 1;
  }
}
```

Ingress security layer calls both `replayDetector.check(action.actionId)` and
`action.delegationSequence = await replayDetector.nextSequence(action.delegationId)` before
the gate pipeline. A replayed `actionId` produces `denied_threat`.

SEQUENCE_ANOMALY is emitted by the chain verifier (§16.2), not by the ingress layer.
Sequences are engine-assigned atomically by `nextSequence()` — no ingress sequence anomaly
is possible under normal operation. Sequence discontinuities indicate post-write tamper
and are detected during verification, not during action processing.

### 17.2 Injection Guard

```ts
function sanitizeIntentField(raw: string | null | undefined, maxLen: number): string {
  if (!raw) return '';
  let s = raw.replace(/[^\x20-\x7E\n\t]/g, '');
  const truncated = s.length > maxLen;
  return truncated ? s.slice(0, maxLen) + ' [TRUNCATED]' : s;
}
```

### 17.3 Rate Limiter — single-process; documented limitation

Per-actor: max 60 actions/minute. Uses in-memory Map for v0.1.0.

**Documented limitation**: Single-process only. Provides no guarantee across process restarts
or multiple instances. SQLite-backed implementation deferred to post-POC. This limitation
must be documented in operator notes before production deployment.

```ts
class RateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();
  private readonly MAX_PER_MINUTE = 60;
  check(actorId: Uuid): 'ok' | 'rate_limited' {
    const now = Date.now();
    const b = this.buckets.get(actorId) ?? { count: 0, windowStart: now };
    if (now - b.windowStart > 60_000) {
      this.buckets.set(actorId, { count: 1, windowStart: now });
      return 'ok';
    }
    b.count++;
    this.buckets.set(actorId, b);
    return b.count > this.MAX_PER_MINUTE ? 'rate_limited' : 'ok';
  }
}
```

### 17.4 Broad Token Bypass Detection

```ts
function assertGrantPresent(grant: ExecutionGrant | undefined): asserts grant is ExecutionGrant {
  if (!grant)
    throw new NexusSecurityViolation('execution_without_grant', DENIAL_CODE.BROAD_TOKEN_BYPASS);
}
function assertGrantNotExpired(grant: ExecutionGrant): void {
  if (new Date(grant.expiresAt) <= new Date())
    throw new NexusSecurityViolation('execution_with_expired_grant', DENIAL_CODE.GRANT_EXPIRED);
}
```

### 17.5 Grant Vault — `packages/core/src/execution/grant-vault.ts`

```ts
const GRANT_SECRETS = new WeakMap<ExecutionGrant, string>();

export function setGrantSecret(grant: ExecutionGrant, secret: string): void {
  GRANT_SECRETS.set(grant, secret);
}
export function getGrantSecret(grant: ExecutionGrant): string | undefined {
  return GRANT_SECRETS.get(grant);
}
export function clearGrantSecret(grant: ExecutionGrant): void {
  GRANT_SECRETS.delete(grant);
}
```

Connectors: `setGrantSecret(grant, token)` in `redeemGrant()`. `getGrantSecret(grant)` for
API call. Gate 06 `finally`: `clearGrantSecret(grant)`. This applies even on NexusSecurityViolation.

---

## 18. Redaction Law

```ts
export const REDACTION_MARKERS = {
  PII: '[REDACTED:PII]',
  PHI: '[REDACTED:PHI]',
  FINANCIAL: '[REDACTED:FINANCIAL]',
  SECRET: '[REDACTED:SECRET]',
  PROMPT: '[REDACTED:RAW_PROMPT]',
  REASONING: '[REDACTED:REASONING]',
  OVERFLOW: '[TRUNCATED:OVERFLOW]',
} as const;
```

Rules (applied at Gate 07 before write): rawPayload never stored; executionResult redacted
via `redactExecutionResult(result, dataClasses)` (§13.9.15); secretValue never stored
(WeakMap cleared after execution); objectiveSummary sanitized/truncated; any field matching
`/(secret|password|key|token|credential)/i` in errorMessage → `[REDACTED:SECRET]`.

---

## 19. MCP Adapter Law (Adapter v1)

### 19.1 Architecture

HTTP server wrapping an upstream MCP server. Operator changes `mcpServer` URL to proxy address.

### 19.2 MCP Normalizer (complete — see §13.9.1 for inferVerbFromMcp, inferTargetFromMcp)

```ts
const VERB_PREFIX_MAP: [string[], ActionVerb][] = [
  [['get_', 'fetch_', 'read_', 'list_', 'search_', 'find_', 'retrieve_'], ACTION_VERB.READ],
  [['create_', 'add_', 'insert_', 'new_', 'post_'], ACTION_VERB.CREATE],
  [['update_', 'edit_', 'modify_', 'patch_', 'set_', 'put_'], ACTION_VERB.UPDATE],
  [['delete_', 'remove_', 'destroy_', 'purge_'], ACTION_VERB.DELETE],
  [['send_', 'message_', 'email_', 'notify_', 'alert_'], ACTION_VERB.SEND],
  [['publish_', 'broadcast_', 'release_'], ACTION_VERB.PUBLISH],
  [['export_', 'download_', 'dump_'], ACTION_VERB.EXPORT],
  [['execute_', 'run_', 'invoke_', 'trigger_', 'call_'], ACTION_VERB.EXECUTE],
];
function inferVerbFromMcp(mcp: McpRequest): string {
  const tool = (mcp.method ?? mcp.tool ?? '').toLowerCase();
  for (const [prefixes, verb] of VERB_PREFIX_MAP) {
    if (prefixes.some(p => tool.startsWith(p))) return verb;
  }
  return ACTION_VERB.EXECUTE;
}
function inferTargetFromMcp(mcp: McpRequest): string {
  const resourceType =
    mcp.params?.resourceType ??
    mcp.params?.resource ??
    extractToolNameSuffix(mcp.method ?? mcp.tool ?? '');
  const system = extractHeader(mcp, 'X-Nexus-Target-System') ?? 'unknown';
  const scope = inferResourceScope(mcp);
  // ADAPTER ENVIRONMENT LAW (blueprint §5.4):
  // Adapters MUST NOT set or override environment. Environment is authoritative from
  // actor registry only. X-Nexus-Environment header is intentionally NOT read.
  // ACTOR_ENVIRONMENT sentinel triggers Gate 02 to use actor.environment.
  const ext = isExternalFacingMcp(mcp);
  return JSON.stringify({
    system,
    resourceType,
    resourceScope: scope,
    environment: 'ACTOR_ENVIRONMENT',
    externalFacing: ext,
  });
}
function inferResourceScope(mcp: McpRequest): 'single' | 'bulk' | 'collection' | 'system' {
  if (Array.isArray(mcp.params?.ids)) return 'bulk';
  if (mcp.params?.filter !== undefined || mcp.params?.query !== undefined) return 'collection';
  if (mcp.params?.id !== undefined) return 'single';
  return 'single';
}
function isExternalFacingMcp(mcp: McpRequest): boolean {
  if (extractHeader(mcp, 'X-Nexus-External-Facing') === 'true') return true;
  const tool = (mcp.method ?? mcp.tool ?? '').toLowerCase();
  return (
    tool.includes('_external') ||
    tool.includes('_email') ||
    tool.includes('_webhook') ||
    tool.includes('_publish')
  );
}
function extractToolNameSuffix(toolName: string): string {
  const parts = toolName.toLowerCase().split('_').filter(Boolean);
  return parts[parts.length - 1] ?? 'resource';
}
```

**MCP Session Law**: Sessions MUST exist before any MCP action proceeds. The adapter does
NOT create sessions from caller-supplied headers. If `X-Nexus-Session-Id` references a
session that does not exist in the store, the action is normalized normally and Gate 01
returns SESSION_NOT_FOUND. There is no auto-create path.

**Adapter environment non-override law**: The `targetNormalizer` in Gate 02 is called as
`targetNormalizer.normalize(action.rawTarget, action.tool, context.actor.environment)`.
It uses `context.actor.environment` as the authoritative `ResourceTarget.environment`, replacing
any `ACTOR_ENVIRONMENT` sentinel from the raw target.

Required headers:

| Header                     | Required | Description                                            |
| -------------------------- | -------- | ------------------------------------------------------ |
| `X-Nexus-Actor-Id`         | Yes      | UUID of registered actor                               |
| `X-Nexus-Principal-Id`     | Yes      | UUID of principal                                      |
| `X-Nexus-Session-Id`       | Yes      | UUID of existing session — must already exist in store |
| `X-Nexus-Delegation-Id`    | Yes      | UUID of active delegation context                      |
| `X-Nexus-Target-System`    | No       | Target system identifier; defaults to 'unknown'        |
| `X-Nexus-External-Facing`  | No       | 'true' if action targets external systems              |
| `X-Nexus-Model-Id`         | No       | Model identifier for intent evidence                   |
| `X-Nexus-Model-Confidence` | No       | Float [0,1]                                            |
| `X-Nexus-Risk-Note`        | No       | Short risk note                                        |

`X-Nexus-Environment` is intentionally absent. Environment is not a header adapters may
provide. `X-Nexus-Session-Id` references an existing session — no auto-creation occurs.

---

## 20. Registry and Store Law

### 20.1 SQLite Schema — `packages/core/src/db/schema.ts`

Initialized at startup. All six tables. Column-by-column — no JSON blob storage for indexed fields.

```sql
CREATE TABLE IF NOT EXISTS principals (
  principal_id      TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  registered_at     TEXT NOT NULL,
  max_risk_tier     TEXT NOT NULL,
  allowed_systems   TEXT NOT NULL    -- JSON array ["system1","system2"]
);

CREATE TABLE IF NOT EXISTS actors (
  actor_id            TEXT PRIMARY KEY,
  actor_class         TEXT NOT NULL,
  principal_id        TEXT NOT NULL REFERENCES principals(principal_id),
  display_name        TEXT NOT NULL,
  environment         TEXT NOT NULL,
  risk_ceiling        TEXT NOT NULL,
  allowed_systems     TEXT NOT NULL,  -- JSON array
  registered_at       TEXT NOT NULL,
  owner               TEXT,           -- required for non-human; null for HUMAN
  purpose             TEXT,           -- required for non-human; null for HUMAN
  review_cadence      TEXT,           -- required for non-human; null for HUMAN
  approver_public_key TEXT,           -- Ed25519 base64url; null unless actor is an approver
  approver_channels   TEXT            -- JSON array of channel IDs; null unless approver
);
CREATE INDEX IF NOT EXISTS idx_actors_principal   ON actors(principal_id);
CREATE INDEX IF NOT EXISTS idx_actors_environment ON actors(environment);
CREATE INDEX IF NOT EXISTS idx_actors_class       ON actors(actor_class);

CREATE TABLE IF NOT EXISTS sessions (
  session_id    TEXT PRIMARY KEY,
  actor_id      TEXT NOT NULL REFERENCES actors(actor_id),
  principal_id  TEXT NOT NULL REFERENCES principals(principal_id),
  delegation_id TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_actor   ON sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS delegations (
  delegation_id               TEXT PRIMARY KEY,
  principal_id                TEXT NOT NULL REFERENCES principals(principal_id),
  actor_id                    TEXT NOT NULL REFERENCES actors(actor_id),
  parent_delegation_id        TEXT REFERENCES delegations(delegation_id),
  chain_depth                 INTEGER NOT NULL DEFAULT 0,
  max_chain_depth             INTEGER NOT NULL DEFAULT 3,
  allowed_systems             TEXT NOT NULL,       -- JSON array
  allowed_capabilities        TEXT NOT NULL,       -- JSON array
  forbidden_capabilities      TEXT NOT NULL,       -- JSON array
  max_risk_tier               TEXT NOT NULL,
  allow_downstream_propagation INTEGER NOT NULL DEFAULT 0,
  environment                 TEXT NOT NULL,
  minted_at                   TEXT NOT NULL,
  expires_at                  TEXT NOT NULL,
  minted_by                   TEXT NOT NULL,
  signature                   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegations_actor   ON delegations(actor_id);
CREATE INDEX IF NOT EXISTS idx_delegations_expires ON delegations(expires_at);
CREATE INDEX IF NOT EXISTS idx_delegations_parent  ON delegations(parent_delegation_id);

CREATE TABLE IF NOT EXISTS replay_cache (
  action_id TEXT PRIMARY KEY,
  seen_at   TEXT NOT NULL
);
-- TTL cleanup: DELETE WHERE seen_at < (now - REPLAY_DEDUP_TTL_SECONDS); run on each check

-- delegation_sequences: engine-assigned monotonic sequence counter per delegation context.
-- Satisfies blueprint §9.2 "sequential numbering within delegation context."
-- Engine calls nextSequence(delegationId) at ingress; result populates AgentAction.delegationSequence.
-- Adapters never supply sequence numbers.
CREATE TABLE IF NOT EXISTS delegation_sequences (
  delegation_id  TEXT PRIMARY KEY,
  last_sequence  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_approvals (
  approval_id   TEXT PRIMARY KEY,
  action_id     TEXT NOT NULL,
  template_id   TEXT NOT NULL,
  request_json  TEXT NOT NULL,   -- full signed ApprovalRequest JSON
  channel_id    TEXT NOT NULL,
  dispatched_at TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|denied|timed_out
  response_json TEXT                              -- full signed ApprovalResponse JSON; null until resolved
);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status   ON pending_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_expires  ON pending_approvals(expires_at);
```

### 20.2 Actor Registry

Reads/writes the `actors` table. Validation rules from §4.1 enforced at registration.
`listForPrincipal(principalId)` uses the `idx_actors_principal` index.

### 20.3 Approver Registry

Reads `actors` table filtering on `approver_public_key IS NOT NULL`.
`register(approver)` updates the actor row with `approver_public_key` and `approver_channels`.
Approvers must already be registered actors of class HUMAN or HUMAN_WITH_COPILOT.

### 20.4 Session Store Law

```ts
interface SessionStoreInterface {
  get(sessionId: Uuid): Promise<Session | null>;
  create(session: Session): Promise<void>;
  invalidate(sessionId: Uuid): Promise<void>;
}
```

**`get`**: reads `sessions` table by `session_id`. Returns `null` if not found.
Returns the `Session` record regardless of whether `expires_at` has passed.
**Gate 01 is the sole owner of the session expiry decision.** The store does not filter
by expiry. Filtering by expiry in `get()` would make `SESSION_EXPIRED` unreachable in
Gate 01 — that is the defect that existed in v0.4.3 and is corrected here.

**`create`**: inserts into `sessions` table. Throws if `sessionId` already exists.

**`invalidate`**: sets `expires_at = now()` — does not delete. Deleted sessions remain in
store for forensic audit.

**Explicit creation path (CLI)**:

```
nexus session start --actor <actorId> --delegation <delegationId> [--ttl <seconds>]
```

Implementation:

1. Look up actor from actorId — throw if not found.
2. Derive `principalId = actor.principalId` — never accept from CLI argument.
3. Load delegation by delegationId — throw if not found.
4. Validate `actor.principalId === delegation.principalId` — throw SessionCreationError if mismatch.
5. Call `sessionStore.create({ sessionId: uuid(), actorId, principalId, delegationId, createdAt: nowIso(), expiresAt: addSeconds(nowIso(), ttlSeconds) })`.
6. Return sessionId + expiresAt.

**Explicit creation path (Management API)**:

`POST /sessions` body:

```json
{ "actorId": "...", "delegationId": "...", "ttlSeconds": 3600 }
```

`principalId` is NOT in the request body. It is derived server-side from actor.principalId.
The server validates `actor.principalId === delegation.principalId` and rejects the request
with HTTP 400 if there is a mismatch. Returns:

```json
{ "ok": true, "data": { "sessionId": "...", "expiresAt": "..." } }
```

**MCP auto-create path**: REMOVED. This path is prohibited. Any code path that creates a
session from adapter headers is a trust boundary violation per blueprint §5.4 and §8.1.
Sessions must pre-exist before any MCP action is processed.

### 20.5 Delegation Store Law

```ts
interface DelegationStore {
  getById(delegationId: Uuid): Promise<DelegationContext | null>;
  save(dc: DelegationContext): Promise<void>;
  listForActor(actorId: Uuid): Promise<DelegationContext[]>;
}
```

`getById`: reads `delegations` table. Deserializes JSON array columns back to `string[]`.

`save`: inserts into `delegations` table. Serializes `string[]` columns to JSON.
Throws if `delegationId` already exists.

`listForActor`: uses `idx_delegations_actor` index. Returns all non-expired delegations for actor.

**Explicit creation path (CLI)**:

```
nexus delegate \
  --principal <id>  \
  --actor     <id>  \
  --systems   <csv> \
  --caps      <csv> \
  [--forbidden <csv>] \
  --max-risk  <tier>\
  --env       <env> \
  --ttl       <seconds> \
  [--max-chain-depth 3] \
  [--allow-propagation]
```

Calls `mintRootDelegation(principal, actor, params)` then `delegationStore.save(dc)`. Returns delegationId.

`POST /delegations` body:

```json
{
  "principalId": "...",
  "actorId": "...",
  "allowedSystems": ["system1"],
  "allowedCapabilities": ["read:record:single"],
  "forbiddenCapabilities": [],
  "maxRiskTier": "high",
  "allowDownstreamPropagation": false,
  "environment": "production",
  "ttlSeconds": 3600,
  "maxChainDepth": 3
}
```

Returns `{ "ok": true, "data": { "delegationId": "...", "expiresAt": "..." } }`.

`GET /delegations/:delegationId` — returns the delegation context (signature included).

### 20.6 Pending Approval Store Law

```ts
interface PendingApprovalStore {
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
  getRequest(approvalId: Uuid): Promise<string | null>; // returns stored requestJson or null
  resolve(approvalId: Uuid, status: 'approved' | 'denied', responseJson: string): Promise<void>;
  markTimedOut(approvalId: Uuid): Promise<void>;
}
```

`getRequest`: reads `request_json` from `pending_approvals` table by `approval_id`.
Returns the raw JSON string of the stored signed ApprovalRequest. Returns null if
the approval record does not exist.

**Shared Approval Decision Service** — `packages/core/src/approval/decision-service.ts`

Both CLI and management API approval handlers must call this single shared service.
No approval-signing logic may be duplicated across surfaces.

```ts
async function decideApproval(
  approvalId: Uuid,
  approverId: NonEmpty,
  decision: 'approved' | 'denied',
  note?: string
): Promise<ApprovalResponse> {
  // 1. Load pending record — reject if not found
  const row = await pendingApprovalStore.getStatus(approvalId);
  if (!row) throw new ApprovalDecisionError(`Approval ${approvalId} not found`);

  // 2. Reject if not pending
  if (row.status !== 'pending') {
    throw new ApprovalDecisionError(
      `Approval ${approvalId} status is '${row.status}', expected 'pending'`
    );
  }

  // 3. Parse stored ApprovalRequest via getRequest()
  const requestJson = await pendingApprovalStore.getRequest(approvalId);
  if (!requestJson) throw new ApprovalDecisionError(`Approval ${approvalId} request not found`);
  const request = JSON.parse(requestJson) as ApprovalRequest;

  // 4. Reject if expired
  if (new Date(request.expiresAt) <= new Date()) {
    throw new ApprovalDecisionError(`Approval ${approvalId} has expired`);
  }

  // 5. Load approver key via key-manager — only legal path
  const approverKey = await loadApproverKey(approverId);

  // 6. Build response body
  const responseBody: Omit<ApprovalResponse, 'signature'> = {
    approvalId,
    decision:
      decision === 'approved' ? APPROVAL_DECISION_LABEL.APPROVED : APPROVAL_DECISION_LABEL.DENIED,
    decidedBy: approverId,
    decidedAt: nowIso(),
    channel: 'cli',
    note: note ?? null,
  };

  // 7. Sign with approver key
  const signature = await crypto.sign(canonicalize(responseBody), approverKey);
  const response: ApprovalResponse = { ...responseBody, signature };

  // 8. Persist via store.resolve()
  await pendingApprovalStore.resolve(approvalId, decision, JSON.stringify(response));

  return response;
}

class ApprovalDecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalDecisionError';
  }
}
```

CLI and management API are thin shells that call `decideApproval()`. They do not
re-implement signing logic independently.

**CLI Channel implementation** (Channel v1) uses the pending approval store with SQLite polling:

```ts
class CliApprovalChannel implements ApprovalChannel {
  readonly channelId = 'cli';
  readonly channelVersion = 'v0.1.0';
  constructor(
    private readonly store: PendingApprovalStore,
    private readonly pollMs = 2000
  ) {}

  async dispatch(request: ApprovalRequest): Promise<void> {
    await this.store.create({
      approvalId: request.approvalId,
      actionId: request.actionId,
      templateId: request.templateId,
      requestJson: JSON.stringify(request),
      channelId: this.channelId,
      dispatchedAt: nowIso(),
      expiresAt: request.expiresAt,
    });
    printApprovalPrompt(request);
  }

  async awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = await this.store.getStatus(approvalId);
      if (row && row.status !== 'pending') {
        if (!row.responseJson) return null;
        return JSON.parse(row.responseJson) as ApprovalResponse;
      }
      await sleep(this.pollMs);
    }
    await this.store.markTimedOut(approvalId);
    return null;
  }
}
```

### 20.7 Run Orchestrator Law

`nexus run [--scenario <id> | --fixtures all] [--out-dir <path>]`

`--scenario <id>` validates the ID against SCENARIO_MANIFEST before any fixture loading.
Fixture path is derived from `SCENARIO_MANIFEST[id].fixturePath`. No string concatenation.

```ts
async function executeRun(options: RunOptions): Promise<void> {
  const runId = 'RUN-' + uuid().slice(0, 8).toUpperCase();
  const outDir = options.outDir ?? path.join('runs', runId);
  await fs.mkdir(outDir, { recursive: true });

  const runDb = await openDatabase(path.join(outDir, 'run.db'));
  await applySchema(runDb);
  const runLedger = new JsonlLedgerBackend(path.join(outDir, '08-evidence-ledger.jsonl'));

  // Load scenarios via SCENARIO_MANIFEST — never by string concatenation
  const scenarios = options.fixturesAll
    ? await loadAllFixtures(SCENARIO_MANIFEST)
    : [await loadFixture(SCENARIO_MANIFEST[options.scenario!].fixturePath)];

  const ingestLog: IngestEntry[] = [];
  for (const scenario of scenarios) {
    await bootstrapScenario(scenario, runDb);
    const result = await executeScenario(scenario, runDb, runLedger);
    ingestLog.push(...result.ingestEntries);
  }

  await writeRunArtifacts(outDir, runId, scenarios, runDb, runLedger, ingestLog);
  console.log(`Run ${runId} complete. Artifacts: ${outDir}`);
}
```

`bootstrapScenario` creates actors, principals, sessions, delegations from the fixture's
`setup.json` using the registry store interfaces. Uses `mintRootDelegation()` and
`sessionStore.create()` — not internal engine functions called directly.

`writeRunArtifacts` produces all 12 files in §24 from accumulated run data.

---

## 21. Delegation Engine Law

### 21.1 Minting a Root DelegationContext

```ts
async function mintRootDelegation(
  principal: Principal,
  actor: Actor,
  allowed: Omit<
    DelegationContext,
    'delegationId' | 'parentDelegationId' | 'chainDepth' | 'mintedAt' | 'mintedBy' | 'signature'
  >
): Promise<DelegationContext> {
  // Principal authority ceiling check
  if (riskTierExceeds(allowed.maxRiskTier, principal.maxDelegableRiskTier)) {
    throw new DelegationError('delegation_exceeds_principal_authority');
  }
  for (const sys of allowed.allowedSystems) {
    if (!principal.allowedSystems.includes(sys)) {
      throw new DelegationError(`system_not_in_principal_scope: ${sys}`);
    }
  }

  // Mint-time environment invariant (SOLVE-018):
  // Root delegation environment must equal actor.environment.
  // A principal may not mint a root delegation into an environment other than
  // the one the actor is registered in. This prevents environment drift attacks
  // where a dev actor gains a production-scoped delegation.
  if (allowed.environment !== actor.environment) {
    throw new DelegationError(
      `delegation_environment_mismatch: delegation environment '${allowed.environment}' ` +
        `does not match actor environment '${actor.environment}'`
    );
  }

  // mintedBy uses DELEGATION_ENGINE_ID constant — never a hardcoded string
  const body = {
    ...allowed,
    delegationId: uuid(),
    parentDelegationId: null,
    chainDepth: 0,
    mintedAt: nowIso(),
    mintedBy: DELEGATION_ENGINE_ID, // "nexus-delegation-engine/v0.1.0"
  };
  const signature = await crypto.sign(canonicalize(body), controlPlaneKey);
  return { ...body, signature };
}
```

### 21.2 Sub-Delegation Law

Permitted only if: `parentDelegation.allowDownstreamPropagation === true`,
sub-actor `maxRiskTier ≤ parent maxRiskTier`, sub-actor `allowedSystems ⊆ parent allowedSystems`,
sub-actor `allowedCapabilities ⊆ parent allowedCapabilities`, `chainDepth + 1 ≤ maxChainDepth`.
Violation throws `DelegationError`. mintedBy must use `DELEGATION_ENGINE_ID` constant.

---

## 22. CLI Contract

### 22.1 Required Commands

```
nexus session start --actor <id> --delegation <id> [--ttl <s>]
                              Create session; principalId derived server-side from actor.
                              Returns sessionId + expiresAt.

nexus delegate --principal <id> --actor <id> --systems <csv>
               --caps <csv> [--forbidden <csv>] --max-risk <tier>
               --env <env> --ttl <s> [--max-chain-depth 3] [--allow-propagation]
                              Mint and store root delegation; returns delegationId.
                              Validates environment == actor.environment.

nexus run [--scenario <id> | --fixtures all] [--out-dir <path>]
                              --scenario validates id against SCENARIO_MANIFEST.
                              Executes run orchestrator; writes run artifacts.

nexus approve <approvalId> --approver-id <approverId>
                              Load approver key from keys/approvers/<approverId>.keypair.json.
                              Dispatch APPROVED decision signed by approver key.

nexus deny <approvalId> --approver-id <approverId> [--note "reason"]
                              Load approver key from keys/approvers/<approverId>.keypair.json.
                              Dispatch DENIED decision signed by approver key.

nexus ledger tail [--n N]     Show last N evidence records (default 20)
nexus ledger verify [--from N --to N]  Verify ledger chain integrity + sequence continuity
nexus ledger get <recordId>   Get evidence record by ID

nexus policy validate <filepath>     Validate and verify policy file signature
nexus policy test <filepath> <action-json>  Test policy evaluation

nexus actor register <json>   Register actor
nexus actor list              List actors

nexus principal register <json>  Register principal

nexus approver keygen --approver-id <id>
                              Generate approver keypair at keys/approvers/<id>.keypair.json.
                              Prints public key for registry registration.

nexus posture                 Show token posture report
nexus replay <runDir>         Replay run and compare CCV outputs
nexus init                    Generate dev keypair + admin token. Writes keys/dev.keypair.json
                              and keys/admin.token (both gitignored in production).
```

All `nexus approve` and `nexus deny` commands require `--approver-id`. The approverId
identifies which keypair to load from `keys/approvers/`. The command fails with an error
if the keypair file does not exist. No dev key fallback on approval paths.

`--scenario` validates the provided id against `Object.keys(SCENARIO_MANIFEST)` before
fixture loading. Unknown scenario id → error with list of valid ids.

### 22.2 CLI Approval Prompt (Channel v1)

```
⚡ Approval required: cursor-agent (SUPERVISED_AGENT) → send:message:external

  Action:    send:message:external@email-api:message:single:external
  Impact:    HIGH risk | external-facing | data: internal
  Intent:    "User asked me to follow up with the client after today's meeting"
  Diff:      [stub: preview not available]
  Principal: James Huson
  Expires:   in 4m 52s

  [A] Approve    [D] Deny    [V] View full payload    [Q] Quit
```

Operator presses A → loads approver key via `loadApproverKey(approverId)` → builds and signs
`ApprovalResponse` → writes to pending_approvals store → `awaitDecision()` poll resolves.

### 22.3 Approver Key Loading Law

All approval signing operations must go through the shared `decideApproval()` service
in `packages/core/src/approval/decision-service.ts`. No other file may read from
`keys/approvers/` directly except `key-manager.ts`. The CLI handler is a thin shell:

```ts
// Approval command handler — packages/interfaces/cli/src/commands/approve.ts
async function handleApprove(
  approvalId: Uuid,
  approverId: NonEmpty,
  note?: string,
  decision: 'approved' | 'denied' = 'approved'
): Promise<void> {
  try {
    const response = await decideApproval(approvalId, approverId, decision, note);
    console.log(`✓ Approval ${approvalId} ${decision} by ${approverId}`);
  } catch (err) {
    if (err instanceof ApprovalDecisionError) {
      console.error(`✗ ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
```

The signing path, key loading, expiry check, and store write all live in `decideApproval()`.
The CLI does not duplicate any of that logic.

---

## 23. Management API Contract

### 23.1 Server — `packages/interfaces/api/src/server.ts`

Express on port 7701.

**Trust boundary law (SOLVE-008)**:

- Binds exclusively to `127.0.0.1`. Not `0.0.0.0`.
- All routes (GET and POST) require `Authorization: Bearer <admin-token>`.
- Admin token loaded from `keys/admin.token` at startup. If the file does not exist,
  the server refuses to start and instructs the operator to run `nexus init`.
- Token comparison uses `crypto.timingSafeEqual()` to prevent timing attacks.

```ts
const server = express();
server.listen(7701, '127.0.0.1', () => {
  console.log('Nexus management API listening on 127.0.0.1:7701');
});

// Admin token middleware — applied to all routes
function adminAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !timingSafeStringEqual(token, adminToken)) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}
server.use(adminAuthMiddleware);
```

### 23.2 Routes

```
POST   /principals                Register principal
GET    /principals/:id            Get principal

POST   /actors                    Register actor
GET    /actors                    List actors
GET    /actors/:id                Get actor

POST   /sessions                  Create session
                                  Body: { "actorId": "...", "delegationId": "...", "ttlSeconds": 3600 }
                                  principalId NOT in body — derived server-side from actor.principalId.
                                  Validates actor.principalId === delegation.principalId.
GET    /sessions/:id              Get session by ID

POST   /delegations               Mint root delegation
GET    /delegations/:id           Get delegation by ID

POST   /policies                  Load policy file (body: { filepath: string } — file path only)
GET    /policies/current          Get current loaded policy metadata

GET    /approvals/pending         List pending approvals
POST   /approvals/:id/approve     Approve (body: { decidedBy: string })
POST   /approvals/:id/deny        Deny (body: { decidedBy: string, note?: string })

GET    /ledger?from=N&to=N        Get ledger range
GET    /ledger/:recordId          Get evidence record
POST   /ledger/verify             Verify chain (body: { from: number, to: number })

GET    /posture                   Token posture report
```

All routes return `{ ok: boolean, data?: unknown, error?: string }`.

`POST /policies` rejects raw rule JSON (status 400). File path only.

`POST /delegations` calls `mintRootDelegation()` then `delegationStore.save()`.

`POST /sessions`:

```ts
app.post('/sessions', async (req, res) => {
  const { actorId, delegationId, ttlSeconds = 3600 } = req.body;
  // principalId is never accepted from the request body
  const actor = await actorRegistry.get(actorId);
  if (!actor) return res.status(400).json({ ok: false, error: 'actor not found' });
  const delegation = await delegationStore.getById(delegationId);
  if (!delegation) return res.status(400).json({ ok: false, error: 'delegation not found' });
  if (actor.principalId !== delegation.principalId) {
    return res
      .status(400)
      .json({ ok: false, error: 'actor.principalId does not match delegation.principalId' });
  }
  const session: Session = {
    sessionId: uuid(),
    actorId: actor.actorId,
    principalId: actor.principalId, // server-side derivation
    delegationId: delegation.delegationId,
    createdAt: nowIso(),
    expiresAt: addSeconds(nowIso(), ttlSeconds),
  };
  await sessionStore.create(session);
  return res.json({
    ok: true,
    data: { sessionId: session.sessionId, expiresAt: session.expiresAt },
  });
});
```

`POST /approvals/:id/approve` and `POST /approvals/:id/deny` accept `decidedBy` (approverId)
and call `decideApproval(approvalId, decidedBy, decision, note?)` from the shared decision
service. The API does not re-implement signing logic. Same signing path as CLI.

---

## 24. Run Artifact Contract

Every run produces these artifacts in `/runs/RUN-<id>/`:

| Filename                        | Description                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| `01-ingest-log.json`            | Actions received, timestamps, ingress results, adapter info    |
| `02-session-manifest.json`      | Sessions and actors active in this run                         |
| `03-actor-manifest.json`        | Actor registry snapshots at run time                           |
| `04-delegation-registry.json`   | Delegation contexts active, chain snapshots                    |
| `05-gate-decision-log.json`     | All gate decisions for all actions, ordered by ledger sequence |
| `06-policy-evaluation-log.json` | Policy rule evaluations with outcomes and matched rules        |
| `07-approval-record-log.json`   | All ApprovalRequests + ApprovalResponses (signed artifacts)    |
| `08-evidence-ledger.jsonl`      | Append-only hash-chained evidence records                      |
| `09-threat-detection-log.json`  | All ThreatEvents detected                                      |
| `10-execution-result-log.json`  | Execution results, redacted                                    |
| `11-token-posture-report.json`  | Token posture at run time                                      |
| `12-run-summary.md`             | Human-readable run summary with scenario outcomes              |
| `00-failure-log.json`           | Written on pipeline crash before graceful stop                 |

Artifact filenames must match exactly. Any deviation is a ci:gate failure.
`08-evidence-ledger.jsonl` is the canonical ledger for the run — chain verification
(hash chain + sequence continuity) runs on it.

---

## 25. Token Posture Report

```ts
interface TokenPostureReport {
  generatedAt: IsoTimestamp;
  runId: string;
  actors: ActorPosture[];
  grantPatterns: GrantPatternSummary[];
  violations: PostureViolation[];
}
interface ActorPosture {
  actorId: Uuid;
  actorClass: ActorClass;
  owner: string | null;
  environment: EnvironmentId;
  grantCount: number;
  maxRiskSeen: RiskTier;
  hasOwner: boolean;
}
interface GrantPatternSummary {
  capabilityId: string;
  count: number;
  expiryClasses: ExpiryClass[];
  externalFacing: boolean;
  approvalRequired: boolean;
}
interface PostureViolation {
  type: 'unowned_non_human_actor' | 'broad_scope_detected' | 'missing_review_cadence';
  detail: string;
  actorId: Uuid;
}
```

---

## 26. Validation Gates

### 26.1 Default-Deny Gate

`policyFile null` → Gate 04 returns DENY, `denialCode: DENIAL_CODE.DEFAULT_DENY`.

### 26.2 Grant Template Uniqueness Gate

`buildGrantTemplate` called more than once for same `actionId` → throws.

### 26.3 Evidence Always-Write Gate

Pipeline orchestrator enforces Gate 07 runs for every action. Null guard on
`lastEvidenceRecord` (§13.1).

### 26.4 No-Certification-Language Gate

Reject any artifact containing:
`"approved by system"` `"authorized by engine"` `"Nexus certifies"`
`"system confirms compliance"` `"this action is safe"` `"compliant action"`
Post-write validation during ci:gate.

### 26.5 Secret-In-Evidence Gate

Reject any EvidenceRecord with field named `secretValue`, `secret`, `password`, `privateKey`
carrying a non-empty string. Post-write Zod schema check during ci:gate.

### 26.6 Ledger Chain Gate

Chain verifier must pass from record 1 to final record. Any gap, hash break, sequence
anomaly, or signature failure = ci:gate failure.

### 26.7 Policy Signature Gate

All policy files in `fixtures/` must have valid Ed25519 signatures. Unsigned file = ci:gate failure.

### 26.8 CCV Integrity Gate

For each EvidenceRecord in integration test ledger: re-derive CCV from record body; assert
it matches stored `compilerView`; re-compute `recordHash` over full body including CCV;
assert matches stored `record.recordHash`. Any mismatch = ci:gate failure. Confirms CCV
inside the tamper-evident boundary.

### 26.9 Fixture Secret Prefix Gate

Run during ci:gate step 11.

```ts
const SECRET_FIELD_PATTERN = /(secret|password|key|token|credential|api_key|apikey|auth)/i;

function validateFixtureSecrets(fixtureDir: string): void {
  for (const file of walkJson(fixtureDir)) {
    for (const [fieldName, value] of flatEntries(file)) {
      if (SECRET_FIELD_PATTERN.test(fieldName) && typeof value === 'string' && value.length > 0) {
        if (!value.startsWith('FIXTURE_SYNTHETIC_SECRET:')) {
          throw new Error(
            `Fixture secret violation: field '${fieldName}' in ${file.path} ` +
              `must be empty, null, or prefixed with FIXTURE_SYNTHETIC_SECRET:`
          );
        }
      }
    }
  }
}
```

---

## 27. Testing Requirements

### 27.1 Unit Tests

One test file per gate. Nominal path, all denial paths, boundary conditions, error handling.
Min 95% line coverage on all files in `packages/core/src/gates/`.

### 27.2 Threat Tests — all 10 required

1. `replay-attack.test.ts` — same actionId twice → second must produce `denied_threat`
2. `injection.test.ts` — non-ASCII, overlong intent → truncate + ThreatEvent
3. `ledger-tamper.test.ts` — modify written record → chain verifier detects
4. `approval-bypass-forged.test.ts` — ApprovalResponse with invalid signature → `denied_approval`
5. `approval-bypass-timeout.test.ts` — null from channel → `denied_timeout` not `allow`
6. `approval-bypass-unsigned.test.ts` — empty signature string → deny
7. `policy-manipulation-unsigned.test.ts` — unsigned policy at load → `PolicySignatureError`
8. `policy-manipulation-injection.test.ts` — `POST /policies` with raw rule JSON → 400 rejected
9. `broad-token-bypass.test.ts` — `connector.execute()` without pipeline grant → `NexusSecurityViolation` → `denied_threat`
10. `delegation-expansion.test.ts` — DELEGATED_SUBAGENT with capability outside parent → deny at Gate 03

### 27.3 Integration Tests — all 10 required; all use StubConnector

```ts
test('scenario-03: high-risk send with approval', async () => {
  const { evidenceRecord } = await runScenario('03-approval-approved', {
    approvalDecision: 'approved',
  });
  expect(evidenceRecord.finalOutcome).toBe(FINAL_OUTCOME.EXECUTED);
  expect(evidenceRecord.approvalResponse?.decision).toBe(APPROVAL_DECISION_LABEL.APPROVED);
  expect(evidenceRecord.compilerView.policyAndApproval.approvalRequired).toBe(true);
  expect(evidenceRecord.actionSummary.actorClass).toBeTruthy();
  expect(evidenceRecord.actionSummary.actorEnvironment).toBeTruthy();
  expect(typeof evidenceRecord.actionSummary.delegationSequence).toBe('number');
  expect(evidenceRecord.actionSummary.delegationSequence).toBeGreaterThan(0);
  expect(evidenceRecord.grantMetadata).not.toBeNull();
  verifyChain(evidenceRecord);
  verifyCCVInsideHash(evidenceRecord);
});
```

Each integration test: load fixture via SCENARIO_MANIFEST path, run full pipeline via
StubConnector, assert finalOutcome, assert gate decisions, assert CCV fields (no fabricated
defaults), assert actorClass/actorEnvironment present, assert delegationSequence is a
positive number, verify ledger chain (hash + sequence continuity), verify CCV inside hash.

### 27.4 Approval Expiry Invariant Test

```ts
test('ApprovalRequest.expiresAt equals addSeconds(issuedAt, approvalConfig.timeoutSeconds)', async () => {
  const request = await buildApprovalRequest(mockAction, mockTemplate, mockContext, null);
  const expectedExpiry = addSeconds(request.issuedAt, mockTemplate.approvalConfig!.timeoutSeconds);
  expect(request.expiresAt).toBe(expectedExpiry);
  // Confirm it is NOT a hardcoded 300s constant if timeoutSeconds differs
  const altConfig = { ...mockTemplate.approvalConfig!, timeoutSeconds: 180 };
  const altTemplate = { ...mockTemplate, approvalConfig: altConfig };
  const altRequest = await buildApprovalRequest(mockAction, altTemplate, mockContext, null);
  expect(altRequest.expiresAt).toBe(addSeconds(altRequest.issuedAt, 180));
});
```

### 27.5 Sequence Continuity Test

```ts
test('chain verifier emits SEQUENCE_ANOMALY on ledger sequence gap', async () => {
  const backend = new JsonlLedgerBackend(tempLedgerPath);
  const record1 = buildMockRecord({ ledgerSequence: 1, previousHash: GENESIS_HASH });
  const record3 = buildMockRecord({ ledgerSequence: 3, previousHash: record1.recordHash });
  // seq 2 is missing
  await backend.append(record1);
  await backend.append(record3);
  const result = await verifyChain(backend, 1, 3, testPublicKey);
  expect(result.ok).toBe(false);
  expect(
    result.errors.some(
      e => e.type === 'sequence_anomaly' && e.denialCode === DENIAL_CODE.SEQUENCE_ANOMALY
    )
  ).toBe(true);
});
```

### 27.6 Deterministic Replay Test

```ts
test('replay produces identical CCV for scenarios 01, 02, 03', async () => {
  for (const id of ['01-allow-read', '02-allow-create', '03-approval-approved'] as ScenarioId[]) {
    const r1 = await runScenario(id, { approvalDecision: 'approved' });
    const r2 = await runScenario(id, { approvalDecision: 'approved' });
    expect(r1.evidenceRecord.compilerView).toEqual(r2.evidenceRecord.compilerView);
  }
});
```

### 27.7 Snapshot Policy

Markdown summaries may use normalized snapshots (timestamps stripped). JSON artifacts compared structurally.

---

## 28. Failure Handling

### 28.1 Pipeline Crash Recovery

Any unhandled exception in the gate pipeline: write a partial EvidenceRecord with available
fields, finalOutcome: 'error', to the ledger before re-throwing. Partial evidence beats no
evidence. Write `00-failure-log.json` to the run output dir.

### 28.2 Startup Failures

Policy file signature invalid → exit non-zero. DB init fails → exit non-zero.
Admin token file missing → exit non-zero with `nexus init` instructions.
Missing keypair → exit non-zero with keygen instructions.

### 28.3 Ledger Write Failure

If Gate 07 ledger write fails: emit to stderr, set process exit code non-zero after run
completes. Do not swallow ledger write errors.

---

## 29. Build Sequence

Fixed. No step starts before the prior step's tests pass.

1.  Types and contracts: all interfaces, governed constants, Zod schemas, error classes,
    NexusSecurityViolation, SCENARIO_MANIFEST
2.  Database schema: SQLite init, all six tables, migrations
3.  Crypto layer: canonicalize(), Ed25519 sign/verify, sha256, key-manager.ts,
    generateApproverKeypair(), admin token generation (nexus init)
4.  Registry implementations: principal registry, actor registry, approver registry,
    session store (with correct expiry law), delegation store, replay detector,
    delegation sequence table
5.  Delegation engine: mintRootDelegation() with environment == actor.environment
    invariant; mintedBy uses DELEGATION_ENGINE_ID constant
6.  Classification layer: verb normalizer, target normalizer, capability registry,
    data classifier, risk classifier
7.  Gate implementations: Gates 01–07 with all approved solve items wired
    - Gate 01: SessionStore.get() returns regardless of expiry; Gate 01 owns expiry check
    - Gate 05: channelId (string), not channels[0]
    - Gate 06: NexusSecurityViolation caught separately; ThreatEvent emitted; denied_threat
    - Gate 07: delegationSequence in actionSummary; not in CCV
    - All: shared templateFingerprintPayload() helper
8.  Policy layer: file loader, bundle hash, signature verification, rule evaluator,
    buildGrantTemplate using shared fingerprint helper
9.  Approval layer: packager, orchestrator, CLI channel, pending approval store,
    buildApprovalRequest with timeoutSeconds invariant
10. Ledger layer: JSONL backend, chain verifier with sequence continuity enforcement,
    SEQUENCE_ANOMALY on gap/regression
11. Security layer: replay detector, injection guard, rate limiter, threat log,
    assertGrantPresent/NotExpired, grant vault
12. CCV materialization: CCV builder, computeNormalizedActionHash (no delegationSequence)
13. Redaction layer: redact PII/PHI/financial/secrets
14. Pipeline orchestrator: 7-gate execution, Gate 07 always-write invariant
15. Connector implementations: StubConnector (all 19 capabilities), HashiCorp Vault
    (reference connector)
16. MCP adapter: normalizer (no auto-create session path), proxy server
17. JSONL ledger backend (finalize) + chain verifier unit tests
18. Fixture scenarios: all 10 via SCENARIO_MANIFEST paths; setup.json for each
19. CLI: all commands; --approver-id required on approve/deny; nexus init; approver keygen;
    --scenario validates against SCENARIO_MANIFEST; bin wiring in package.json
20. Management API: 127.0.0.1 bind; admin token middleware; /sessions without principalId
    in body; all routes; POST /approvals uses loadApproverKey()
21. Unit tests: one file per gate; 95% coverage
22. Threat tests: all 10
23. Integration tests: all 10; assert delegationSequence present; sequence continuity
24. Additional tests: approval expiry invariant, sequence anomaly detection, CCV inside hash
25. ci:gate script: all 11 steps in order

---

## 30. Known Holes Log

### 30.1 Open Holes — NONE

All holes from v0.4.3 and all new holes from the conical audit are resolved in this version.

### 30.2 Closed Holes — v0.4.4 closures (SOLVE-001 through SOLVE-020 + CONTRA-509)

```
SOLVE-001 / CONTRA-501 | CLOSED
  Finding: spec §2 + §7.1 referenced superseded filenames v0.3.4 / v0.4.3
  Resolution: §2 and §7.1 updated; carried forward to v0.3.6 + v0.4.6 in this version

SOLVE-002 / CONTRA-502 | SUPERSEDED by OA-001
  Finding: build instructions v0-1-0 had drift from approved solves
  Prior resolution: nexus-build-instructions-v0-2-0.md treated as canonical law
  OA-001 correction: build instructions are builder-operations law only — not product law,
  not blueprint fallback, not spec fallback. They are removed from canonical law headers
  in both blueprint and spec.

SOLVE-003 / CONTRA-503 | CLOSED
  Finding: buildGrantTemplate and assertTemplateIntegrity computed fingerprints over
           different payloads; approvalLinkage omitted via undefined substitution
  Resolution: §13.9.9–13.9.10 shared templateFingerprintPayload() helper;
              approvalLinkage excluded by field omission not undefined

SOLVE-004 (NEW) | CLOSED
  Finding: undefined could leak into canonicalize() payloads
  Resolution: §15.5 canonicalize strips undefined-valued keys; throws on non-key undefined

SOLVE-005 / CONTRA-504 | CLOSED
  Finding: buildApprovalRequest hardcoded expiresAt = now + 300s
  Resolution: §13.9.5 expiresAt = addSeconds(issuedAt, approvalConfig.timeoutSeconds);
              §27.4 invariant test added

SOLVE-006 / HOLE-501 | CLOSED
  Finding: approver private key sourcing undefined; no per-approver key contract
  Resolution: §15.2 approver key contract at keys/approvers/<approverId>.keypair.json;
              key-manager.ts is sole loading path; §22.1 --approver-id required;
              §22.3 approver key loading law

SOLVE-007 / THREAT-501 | CLOSED
  Finding: MCP adapter auto-created sessions from caller-supplied headers
  Resolution: §19.2 auto-create path removed; missing session → SESSION_NOT_FOUND at Gate 01;
              §20.4 MCP auto-create law removed

SOLVE-008 / THREAT-502 | CLOSED
  Finding: management API had no auth contract; no binding restriction
  Resolution: §23.1 127.0.0.1 bind; admin bearer token at keys/admin.token;
              all routes gated; timingSafeEqual comparison

SOLVE-009 / HOLE-502 | CLOSED
  Finding: delegationSequence missing from evidence
  Resolution: §10.3.5 delegationSequence on AgentAction; §10.3.20 actionSummary carries it;
              §13.9.13 buildRedactedActionSummary includes it; forensic only, not in CCV

SOLVE-010 / CONTRA-505 | CLOSED
  Finding: SEQUENCE_ANOMALY denial code never emitted; no code path produced it
  Resolution: §16.2 chain verifier emits SEQUENCE_ANOMALY on sequence discontinuity;
              absorbed into CONTRA-509 resolution; see below

CONTRA-509 (drift) | CLOSED
  Finding: §10.2 comment said "sequence anomaly at ingress"; §17.1 said requirement
           "satisfied by other mechanisms" — both were wrong and contradictory
  Resolution: §10.2 SEQUENCE_ANOMALY comment corrected to "ledger sequence
              discontinuity — emitted by chain verifier"; §17.1 erroneous note removed;
              §16.2 chain verifier enforces sequence continuity and emits SEQUENCE_ANOMALY;
              §27.5 sequence continuity test added

SOLVE-011 / CONTRA-506 | CLOSED
  Finding: SessionStore.get() returned null for both not-found and expired, making
           SESSION_EXPIRED denial code unreachable in Gate 01
  Resolution: §20.4 SessionStore.get() returns Session regardless of expiry;
              Gate 01 owns the expiry check (code already correct; store contract fixed)

SOLVE-012 / HOLE-503 | CLOSED
  Finding: no package.json bin wiring for nexus or nexus-mcp-proxy
  Resolution: §7.1.1 bin wiring law; bin entries required in root package.json;
              missing wiring is a ci:gate failure

SOLVE-013 (NEW) | CLOSED
  Finding: NexusSecurityViolation caught by generic connector error handler in Gate 06;
           lost denialCode and ThreatEvent; mapped to error not denied_threat
  Resolution: §13.7 Gate 06 catches NexusSecurityViolation separately before generic catch;
              ThreatEvent emitted; denialCode preserved; maps to denied_threat;
              §13.8 computeFinalOutcome updated to catch G06 deny as denied_threat

SOLVE-014 / CONTRA-507 | CLOSED
  Finding: chain verifier had no sequence continuity check; gaps not detected
  Resolution: §16.2 expectedSeq tracking; fail on gap or regression;
              emit SEQUENCE_ANOMALY ChainError

SOLVE-015 / CONTRA-508 | CLOSED
  Finding: ci:gate text said "all 10 steps" but listed 11 steps
  Resolution: §7.4 corrected to "all 11 steps in this exact order"

SOLVE-016 (NEW) | CLOSED
  Finding: ApprovalConfig.channels[] list type created misleading multi-channel semantics
           that did not exist; Gate 05 used channels[0] hackily
  Resolution: §12.1 ApprovalConfig.channelId: string; §13.6 Gate 05 uses channelId directly;
              multi-channel fallback deferred to Channel v2

SOLVE-017 (NEW) | CLOSED
  Finding: session creation accepted caller-supplied principalId; no server-side derivation
  Resolution: §20.4 POST /sessions body no longer includes principalId; derived from
              actor.principalId server-side; §23.2 /sessions endpoint updated;
              §22.1 nexus session start updated

SOLVE-018 (NEW) | CLOSED
  Finding: mintRootDelegation had no environment invariant; dev actors could receive
           production-scoped delegations
  Resolution: §21.1 validates allowed.environment === actor.environment at mint time;
              DelegationError thrown on mismatch

SOLVE-019 (NEW) | CLOSED
  Finding: fixture paths resolved by string concatenation; no governed manifest
  Resolution: §10.2 SCENARIO_MANIFEST constant with 10 entries and fixturePaths;
              §22.1 --scenario validates against manifest;
              §20.7 run orchestrator uses manifest for path resolution

SOLVE-020 (NEW) | CLOSED
  Finding: mintedBy hardcoded as literal string 'nexus-delegation-engine/v0.1.0';
           stale SemVer comment in spec
  Resolution: §10.2 NEXUS_VERSION + DELEGATION_ENGINE_ID constants;
              §21.1 mintedBy uses DELEGATION_ENGINE_ID; stale SemVer comment removed
```

### 30.3 Carried Forward — Closed in v0.4.3

All v0.3.2 closures and CONTRA-402 through HOLE-406 remain closed. No reopens.

---

## 31. Completion Criteria

POC is complete when all of the following pass with zero failures and zero waived items.

### 31.1 ci:gate

All 11 steps pass in order. No step skipped. No gate waived.

### 31.2 Unit Coverage

All 7 gate unit test files pass. Min 95% line coverage on `packages/core/src/gates/`.

### 31.3 Threat Suite

All 10 threat tests pass. Each test exercises its governed denial path end-to-end.

### 31.4 Integration Scenarios

All 10 fixture scenarios produce their expected finalOutcome. Scenarios verified by scenario ID via SCENARIO_MANIFEST — no ad-hoc path resolution.

### 31.5 Deterministic Replay

Scenarios 01, 02, 03 produce byte-identical CCV on independent re-runs.

### 31.6 Chain Integrity

Chain verifier passes from ledger sequence 1 to final record for the integration test ledger. Both hash continuity and sequence continuity verified.

### 31.7 CCV Inside Hash

Every EvidenceRecord in the integration test ledger: CCV re-derived from body matches stored compilerView; recordHash re-computed over full body including CCV matches stored recordHash.

### 31.8 Session Law Assertions

- MCP adapter does not create any sessions from caller-supplied headers.
- `nexus session start` derives principalId from actor.principalId — not from CLI argument.
- `POST /sessions` body does not accept principalId field.
- `GET /sessions/:id` returns session records regardless of expiry state (store contract).

### 31.9 Approval Law Assertions

- ApprovalRequest.expiresAt equals addSeconds(issuedAt, approvalConfig.timeoutSeconds).
- `nexus approve` and `nexus deny` require `--approver-id` and load key from `keys/approvers/<id>.keypair.json`.
- Management API approval routes load approver key via key-manager.ts.

### 31.10 Delegation Law Assertions

- mintRootDelegation throws DelegationError if allowed.environment !== actor.environment.
- All minted DelegationContexts carry `mintedBy = DELEGATION_ENGINE_ID`.

### 31.11 Security Assertions

- NexusSecurityViolation from connector paths produces denied_threat and emits ThreatEvent.
- Management API refuses connections on any interface other than 127.0.0.1.
- Management API returns 401 on missing or invalid admin token on all routes.

### 31.12 Build Wiring Assertions

- `nexus` and `nexus-mcp-proxy` bin entries present in root package.json.
- Both bins executable from a clean clone (`pnpm install && pnpm exec nexus --help`).

### 31.13 Run Artifacts

`nexus run --fixtures all` produces all 12 governed artifacts in a run directory with correct filenames.

### 31.14 Token Posture

`nexus posture` returns a valid TokenPostureReport. Any unowned non-human actor is flagged as a PostureViolation.

---

## 32. Final Spec Statement

This document is the complete engineering implementation law for the current Nexus law set
defined by `nexus-blueprint-v0-3-6.md` and this spec `nexus-engineering-spec-v0-4-6.md`.
The blueprint is authoritative on architecture, purpose, and boundaries.
This spec is authoritative on implementation detail, interfaces, data shapes, and algorithms.
If blueprint and spec conflict, blueprint wins.

All 20 approved solve items from the conical audit are incorporated. All governance cleanup
items from the owner-approval log are incorporated (OA-001, OA-002, OA-003, BS-101,
BS-102, BS-103). CONTRA-001 is closed: Gate 05 and Gate 06 now satisfy the gate interface
exactly — `evaluate(action, context, priorDecisions)` — template is consumed from
`context.grantTemplate!` internally. CONTRA-002 is closed: clean-clone assertion uses
`pnpm install && pnpm exec nexus --help` throughout. All known holes are closed.
All contradiction logs are resolved.

A builder following this spec line by line will produce: a seven-gate policy-aware action
router with an explicit stateful orchestrator; a tamper-evident, hash-chained,
sequence-continuous evidence ledger; an execution-grant authority broker with explicit scope
law; a signed human approval chain with a single shared signing path; a deterministic
compiler comparison view; a fully tested and verifiable POC ready to jump to production
architecture with additive connector, adapter, and channel implementations.

No workarounds. No toys. Canonical law.
