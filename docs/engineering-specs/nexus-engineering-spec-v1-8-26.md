# Nexus Stack — Engineering Spec
# Version: v1.8.26
# Status: CANONICAL — governing law / build not yet build-cleared
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-21
# Governing blueprint: nexus-blueprint-v1-5-13.md
# Governing ratification: nexus-owner-ratification-v1-4-12.md
# Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (LOCKED)
# Supersedes: nexus-engineering-spec-v1-7-25.md
# This document is the canonical engineering spec for the Nexus Stack build.
# Incorporates: Amendment J-S1 — WordNet Build-Time Lexical Integration (merged, superseded)

---

> **Governing precedence:** see docs/alignment/nexus-component-outline-v0-1-0.md §Governing Precedence. This document is level 5 (spec) in the precedence chain.

---

## Changelog from v0-4-6

Major version jump. This spec implements blueprint v1.5.13 (which carries all v1.4.12 law)
and expanded scope from single authority engine (Nexus) to full two-checkpoint governed
stack (Nexus Stack: NVG + NXS). All NXS law is present in this spec. New sections added
for NVG, OCT, workspace, orchestration, identity provider interface, compile/return path,
three audit streams, operating modes, and Run Ledger.

Owner ratification: nexus-owner-ratification-v1-4-12.md (RAT-001 through RAT-007).

Key changes:
1. Scope expanded to full Nexus Stack (NVG + NXS)
2. Seven-layer architecture replaces five-layer (RAT-002)
3. nexus-contracts package added as Layer 2 shared types
4. packages/vanguard added as Layer 3 wall enforcement engine
5. packages/identity-ref added as Layer 6 reference identity adapter
6. OCT system — four tiers, four ceilings, assignment law
7. Operating modes — Observe, Advisory, Enforcing + enforcing-lock
8. Workspace / user surface — hard-rule entry point, run ID assignment
9. Orchestration plane — governed actor, agent registry, delegation
10. NVG architecture — outbound classification, egress policy, model routing,
    inbound return logging, Routing Provenance Trail
11. Model tier registry — six governed tiers, fallback law
12. Normalization boundary — Post-Inference Action Normalizer
13. Compile / return path — three modes, OCT-COMPILE inheritance
14. Three audit streams — Routing Provenance Trail, Evidence Ledger, Run Ledger
15. EvidenceRecord field-type law — union types for sentinel encoding
16. Expanded evidence minimums — approval-field applicability, grant-metadata applicability
17. All NXS gate law from prior spec versions is present in this spec
18. All approval law from prior spec versions is present in this spec
19. All crypto law from prior spec versions is present in this spec
20. All ledger law from prior spec versions is present in this spec
21. WordNet build-time lexical integration (Amendment J-S1) — governed lexical types,
    build-time lexical fixture generation law, Gate 02 lexical resolver order, hard
    separation rule, lexical-normalizer.ts as subordinate helper to Post-Inference Action
    Normalizer, validation gates 37.14–37.18, lexical unit and consistency tests

---

## 1. Purpose

This engineering spec translates the approved Nexus Stack blueprint (v1.5.13, incorporating
all v1.4.12 law) into deterministic build law. The intent is to let a builder implement
the system line by line without inventing architecture during the build.

This spec is exhaustive for:
- Layer 2 (Shared Contracts — nexus-contracts)
- Layer 1 (NXS Core Engine — seven gates, ledger, crypto, security)
- Layer 3 (NVG Wall Enforcement Engine — classification, routing, audit trail)
- Layer 4 (Protocol Adapters — MCP Adapter v1)
- Layer 5 (Connectors — Vault + Stub)
- Layer 6 (Reference Identity Adapter — optional starter)
- Layer 7 (Control Interface — CLI + Management API)

Every type, every interface, every gate, every test, every CI/CD checkpoint is defined
here. No builder invention is permitted except through the best-solve protocol.

---

## 2. Governing Precedence

1. nexus-complete-end-to-end-flow-v4.8.md (canonical outline — LOCKED)
2. nexus-owner-ratification-v1-4-12.md (owner decisions — LOCKED)
3. nexus-blueprint-v1-5-13.md (current blueprint — derived from #1 and #2)
4. this engineering spec (nexus-engineering-spec-v1-8-26.md — derived from #3)
5. owner-approved audit resolutions and reference files
6. builder implementation details

No document lower in this hierarchy may contradict a document higher. Conflicts are
resolved upward. The canonical outline and ratification are LOCKED — they do not change.

If spec and blueprint conflict: blueprint wins. Log the conflict before resolving.
If a hole cannot be resolved by spec or blueprint: fall back to the canonical outline
and ratification. If still unresolved, best-solve permitted only if logged with
spec+blueprint section pins, reason explained, downstream affected named, and NOT
canonical until owner approves. No downstream work proceeds on unapproved best-solves.

Files outside /docs that contradict /docs files: /docs wins. Log the conflict.

---

## 3. Implementation Choice

Language: TypeScript strict (ES2022 target, strict: true, all strict flags enabled)
Runtime: Node.js 20+
Package manager: pnpm workspaces (pinned version in packageManager field)
Build orchestration: Turborepo v2 (tasks key, not pipeline)
Testing: Vitest
Database: better-sqlite3 (replay detection, session store)
Crypto: @noble/ed25519 for Ed25519 sign/verify; Node.js crypto.createHash for SHA-256
Execution: tsx for dev; compiled dist for production

TypeScript strict is the sole implementation language for the entire stack (RAT-001,
blueprint §2). REST API is the polyglot integration surface.

---

## 4. Build Scope

### 4.1 In Scope — This Build

- Full NXS authority engine (seven gates, all supporting subsystems)
- Full NVG wall enforcement engine (classification, routing, audit trail)
- nexus-contracts shared type package
- Reference Identity Adapter (optional starter)
- MCP Adapter v1 (fully implemented)
- StubConnector (test reference) + Vault connector (production reference)
- CLI control interface (full implementation)
- Management API (localhost-only, full implementation)
- Ten NXS scenario fixtures + integration tests
- NVG scenario fixtures + integration tests
- Deterministic replay tests
- All CI/CD gates

### 4.2 Out of Scope — This Build

> **Historical scope note (2026-05-23):** The out-of-scope list below was
> written for the original NXS-only build phase. Several surfaces listed as
> out of scope (Dashboard UI, admin writers, workspace reference implementation)
> are now in active scope under the component outline and owner-ratified AMENDs.
> Current active scope is governed by the precedence chain above, not by this
> historical list. When this list conflicts with the component outline or
> ratified AMENDs, those higher-precedence documents govern.

- REST Adapter v2 (interface contract locked; implementation next cycle)
- Webhook Approval Channel v2 (interface contract locked; implementation next cycle)
- Dashboard UI
- Slack Approval Channel v3
- PostgreSQL ledger backend v2
- S3 ledger backend v3
- Multi-node ledger replication
- SOC 2 export formatting
- Production Kubernetes manifests
- Connector marketplace
- MFA/SSO for approver identity
- Live credential rotation automation
- Advanced NVG content classification (ML-assisted labeling deferred)
- Multi-party orchestrator
- Cross-enterprise run ledger federation

No code, stub, or partial implementation for any out-of-scope item.

---

## 5. Product Identity

```typescript
const PRODUCT_NAME = 'nexus-stack' as const;
const NXS_ENGINE_NAME = 'nexus' as const;
const NVG_ENGINE_NAME = 'nexus-vanguard' as const;
const BLUEPRINT_VERSION = 'v1.5.13' as const;
const SPEC_VERSION = 'v1.8.26' as const;
const RUNTIME_CONTRACT_VERSION = 'v1.0.0' as const;
const CAPABILITY_TAXONOMY_VERSION = 'v1.0.0' as const;
const COMPARISON_INPUT_VERSION = 'v1.0.0' as const;
const DELEGATION_ENGINE_ID = 'nexus-delegation-engine-v1' as const;
```

These constants are governed. Changes require a spec version bump.

---

## 6. Repository Contract

### 6.1 Canonical Repo Layout

```
nexus/
  packages/
    contracts/        Layer 2 — shared types, interfaces, governed constants
      src/
        types/        all governed type definitions
        interfaces/   all interface contracts
        constants/    all governed constant sets
        schemas/      AgentAction schema, RunLedger schema
        lexicon/      governed lexical types (Amendment J-S1)
    core/             Layer 1 — NXS authority engine
      src/
        engine/       pipeline orchestrator
        gates/        01-identity through 07-evidence
        identity/     actor resolution, principal resolution
        classification/ verb normalizer, target normalizer, capability registry,
                       data classifier, risk classifier, lexical-verb-resolver (Amendment J-S1)
        normalization/ lexical-normalizer (subordinate helper to Post-Inference Action
                       Normalizer — Amendment J-S1; see §28)
        policy/       evaluator, rule-loader, grant-template-builder
          rules/      default.policy.json (signed)
        approval/     packager, channel interface, pending-approval-store,
                      cli channel, approval-decision-service
        execution/    grant-minter, grant-vault
        ledger/       jsonl backend, chain-verifier
        crypto/       canonicalize, signer, verifier, key-manager
        security/     replay-detector, injection-guard, rate-limiter, threat-log
        redaction/    redactor
        compiler-view/ ccv-builder
        db/           schema (SQLite)
        types/        core-internal types (not exported to contracts)
        utils/        uuid, nowIso, addSeconds, sleep
    vanguard/         Layer 3 — NVG wall enforcement engine
      src/
        classifier/   data-classifier, label-reader
        router/       policy-engine, model-router, tier-registry
        health/       model-health-monitor
        trail/        routing-provenance-trail-writer
        inbound/      response-logger, response-normalizer
        types/        NVG-internal types
    adapters/
      mcp/            Layer 4 — MCP Adapter v1
        src/
          mcp-proxy.ts
          mcp-normalizer.ts
          mcp-intent-extractor.ts
          mcp-server.ts
    connectors/
      stub/           Layer 5 — StubConnector
        stub.connector.ts
      vault/          Layer 5 — HashiCorp Vault connector
        hashicorp.connector.ts
    identity-ref/     Layer 6 — Reference Identity Adapter
      src/
        identity-provider.ts
        actor-store.ts
        principal-store.ts
        auth/
          api-key.ts
          jwt.ts
    interfaces/
      cli/            Layer 7 — CLI
        src/
          index.ts
          commands/
      api/            Layer 7 — Management API
        src/
          server.ts
          routes/
  docs/
    nexus-blueprint-v1-5-13.md
    nexus-engineering-spec-v1-8-26.md
    nexus-owner-ratification-v1-4-12.md
    nexus-complete-end-to-end-flow-v4.8.md
  keys/
    dev.keypair.json
    admin.token
    approvers/
  config/
    lexicon/                         (Amendment J-S1)
      governed-verb-overrides.v1.yaml
      governed-verb-hard-separations.v1.yaml
  fixtures/
    scenario-01-allow-read/
    scenario-02-allow-create/
    scenario-03-approval-approved/
    scenario-04-approval-denied/
    scenario-05-approval-timeout/
    scenario-06-replay-detected/
    scenario-07-default-deny/
    scenario-08-policy-unsigned/
    scenario-09-broad-token-bypass/
    scenario-10-delegation-exceeded/
    lexicon/                         (Amendment J-S1)
      wordnet-candidate-aliases.v1.json
      governed-verb-lexicon.v1.json
  runs/
    RUN-<id>/
  schemas/
    *.schema.json
  scripts/
    ci-gate.ts
    gen-keys.ts
    sign-policy.ts
    build-wordnet-lexicon.ts         (Amendment J-S1)
    validate-governed-lexicon.ts     (Amendment J-S1)
  package.json
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  eslint.config.js
  vitest.config.ts
  vitest.integration.config.ts
  vitest.threat.config.ts
  README.md
  LICENSE
  .gitignore
  .editorconfig
  .prettierrc
  .github/
    workflows/
      ci.yml
```

### 6.2 Package Scripts

```json
{
  "format:check": "pnpm exec prettier --check .",
  "lint": "pnpm exec eslint packages --ext .ts",
  "typecheck": "pnpm exec tsc --noEmit -p tsconfig.base.json",
  "test": "pnpm exec vitest run --reporter=verbose",
  "test:integration": "pnpm exec vitest run --config vitest.integration.config.ts",
  "test:threat": "pnpm exec vitest run --config vitest.threat.config.ts",
  "build": "pnpm exec turbo build",
  "ci:gate": "pnpm exec tsx scripts/ci-gate.ts",
  "nexus": "pnpm exec tsx packages/interfaces/cli/src/index.ts",
  "nexus:mcp": "pnpm exec tsx packages/adapters/mcp/src/mcp-server.ts",
  "lexicon:build": "pnpm exec tsx scripts/build-wordnet-lexicon.ts",
  "lexicon:validate": "pnpm exec tsx scripts/validate-governed-lexicon.ts"
}
```

format:check and lint are distinct script targets. They are never merged.

### 6.3 Package Dependency Law

```
contracts/  ← imported by ALL other packages — never the reverse
core/       ← Layer 1; imports contracts/ only; never imports vanguard/
vanguard/   ← Layer 3; imports contracts/ only; never imports core/
adapters/*  ← imports contracts/ only; never core/ or vanguard/ internals
connectors/*← imports contracts/ only; never core/ or vanguard/ internals
identity-ref/← implements identity-provider interface from contracts/
interfaces/cli/ ← imports contracts/ for types; imports core/ engine entry
                  points for command dispatch (sole cross-layer exception,
                  RAT-003); must not expose engine internals
interfaces/api/ ← imports contracts/ for types and interfaces ONLY;
                  receives pre-constructed core service instances via
                  dependency injection at startup (see §23.1); never imports
                  core/ or vanguard/ directly
```

**Management API invocation path**: The API server receives service instances
(actor registry, session store, delegation store, ledger backend, approval service,
etc.) as constructor parameters. These instances implement interfaces defined in
Layer 2 (contracts). The API imports only the interface types from contracts — never
the implementation classes from core. The bootstrap entry point (CLI `nexus serve`
command or standalone server script) constructs core implementations and injects them
into the API server. This preserves Layer 7's dependency law while enabling full API
functionality.

Violation of any dependency rule is a MODULAR violation. Build must not proceed.

### 6.4 CI Gate Contract

ci:gate executes IN ORDER (all steps must pass):

```
Step  1: format:check (prettier)
Step  2: typecheck (tsc --noEmit)
Step  3: unit tests — all gate unit test files
Step  4: threat test suite — all threat cases
Step  5: integration tests — all scenario tests
Step  6: deterministic replay test (CCV byte-identical across runs)
Step  7: ledger chain integrity verification (Ed25519 signature check)
Step  8: CCV integrity gate (re-derive from record body; assert match; re-hash)
Step  9: no-certification-language gate
Step 10: policy signature gate
Step 11: fixture secret prefix gate (FIXTURE_SYNTHETIC_SECRET enforcement)
Step 12: NVG routing policy signature gate
Step 13: NVG classification enforcement gate (sensitive → frontier = reject)
Step 14: Run Ledger cross-link gate (runId present in all three streams)
Step 15: bypass annotation gate (NVG-bypass runs annotated)
Step 16: lexical runtime bundle exclusion gate (wordnet-candidate-aliases.v1.json absent from production output)
```

All 16 steps must pass. No step may be skipped. No gate waived without owner approval.

### 6.5 CI/CD Push Checkpoints

The builder pushes to the repo at these defined states. Each push must pass all gates
that are buildable at that point. Gates are cumulative — once a gate is passable, it
stays in the gate set for all subsequent pushes.

```
PUSH-01: After Layer 2 contracts + Layer 1 core types     → Steps 1-2
PUSH-02: After crypto layer + key generation               → Steps 1-2
PUSH-03: After Gates 01-04 + unit tests                    → Steps 1-3
PUSH-04: After Gates 05-07 + approval + evidence           → Steps 1-3
PUSH-05: After pipeline orchestrator + ledger               → Steps 1-3, 7-8
PUSH-06: After security layer + threat tests                → Steps 1-4
PUSH-07: After fixtures + integration tests                 → Steps 1-8
PUSH-08: After policy signing + certification gate          → Steps 1-11
PUSH-09: After NVG engine + routing + classification        → Steps 1-13
PUSH-10: After Run Ledger + cross-linking                   → Steps 1-15 (FULL GATE)
PUSH-11: After CLI + Management API                         → Steps 1-15 (FULL GATE)
PUSH-12: After lexical fixture committed + validated         → Steps 1-16 (FULL GATE)
PUSH-13: After clean-clone assertion verified               → Steps 1-16 (FULL GATE)
```

A push that fails any passable gate is rejected. No downstream work on a failed push.

### 6.6 Clean-Clone Assertion

A fresh clone must complete: `pnpm install → format:check → lint → typecheck → test →
ci:gate` without inventing missing config files. Every file referenced by a script must
exist in the repo layout. A build that cannot pass ci:gate from a clean clone is not
conformant.

---

## 7. Architecture Mapping

### 7.1 Seven-Layer Stack

Blueprint §6, §24. The Nexus Stack is a seven-layer architecture. Each layer has explicit
import rules. Violations are MODULAR log entries.

| Layer | Package Path | Responsibility |
|-------|-------------|----------------|
| Layer 1 | `packages/core/` | NXS authority engine — seven gates, ledger, crypto, security |
| Layer 2 | `packages/contracts/` | Shared types, interfaces, governed constants, AgentAction schema |
| Layer 3 | `packages/vanguard/` | NVG wall enforcement engine — classification, routing, audit trail |
| Layer 4 | `packages/adapters/` | Protocol adapters — MCP Adapter v1 |
| Layer 5 | `packages/connectors/` | Target system connectors — Vault + Stub |
| Layer 6 | `packages/identity-ref/` | Reference Identity Adapter (optional starter) |
| Layer 7 | `packages/interfaces/` | CLI + Management API |

### 7.2 Layer Import Rules

```
Layer 2 (contracts):   imports NOTHING inside the monorepo
Layer 1 (core):        imports Layer 2 ONLY
Layer 3 (vanguard):    imports Layer 2 ONLY — never Layer 1
Layer 4 (adapters):    imports Layer 2 ONLY — never Layer 1 or Layer 3
Layer 5 (connectors):  imports Layer 2 ONLY — never Layer 1 or Layer 3
Layer 6 (identity-ref):imports Layer 2 ONLY — implements identity-provider interface
Layer 7 (interfaces):  imports Layer 2 for types
                       CLI MAY import Layer 1 engine entry points for dispatch (RAT-003)
                       CLI MUST NOT expose engine internals through its public surface
                       API imports Layer 2 ONLY
```

Violation of any import rule is a MODULAR violation. Build must not proceed.

### 7.3 Control Plane and Data Plane

Blueprint §24.1. The architecture is split across two planes. Each plane spans both engines.

**Control Plane**: every decision in both engines.

NVG control: data classification, egress policy evaluation, model tier routing decision,
denial/quarantine routing, Routing Provenance Trail write.

NXS control: actor resolution, delegation verification, policy evaluation,
ExecutionGrantTemplate computation, approval orchestration, approval signature verification,
execution-grant minting, Evidence Ledger write and chain management, CCV materialization.

**Data Plane**: every forwarding operation.

NVG data: model invocation, inbound response normalization, cost/latency tracking.

NXS data: ingress normalization, protocol translation, connector forwarding, result
capture, redaction before evidence write.

### 7.4 Gate-to-Plane Assignment

| Gate | Plane |
|------|-------|
| Gate 01 — Identity | Control |
| Gate 02 — Classification | Control |
| Gate 03 — Delegation | Control |
| Gate 04 — Policy | Control |
| Gate 05 — Approval | Control |
| Gate 06 — Execution | Control (grant minting) + Data (connector forwarding) |
| Gate 07 — Evidence | Control |

Gate 06 is hybrid. Grant minting is control-plane law. Connector forwarding is data-plane
operation. These two sub-steps must be physically distinct and must not share mutable state.

### 7.5 Two-Checkpoint Independence

Blueprint §6. NVG (Checkpoint 1) and NXS (Checkpoint 2) are independent:

- NVG and NXS never import each other's internals (MODULAR-010)
- Both import from Layer 2 (contracts) only
- An agent may call NVG without subsequently calling NXS (model-only interaction)
- An agent may call NXS without a prior NVG call (NVG-bypass path, §13.9 of blueprint)
- Neither engine's gate or enforcement logic depends on the other's internal state
- Both engines write to their respective audit streams independently
- Both audit streams are cross-linked by run ID — not by engine coupling

```typescript
// Checkpoint 1 — NVG integration surface
const nvgResult = await nvg.classifyAndRoute(request);
// Returns: egress decision, model tier selected, reason codes, trail record ID

// Checkpoint 2 — NXS integration surface
const nxsResult = await nexus.authorizeAction(agentAction);
// Returns: ALLOW | REQUIRE_APPROVAL | DENY + signed evidence record ID
```

---

## 8. Canonical Runtime Flow

### 8.1 Full Governed Loop

Blueprint §16, §17, §31. This section defines the complete runtime flow for spec
implementation. The flow includes both NVG and NXS paths. Agents may traverse one or
both checkpoints depending on their task.

```
[Workspace receives user request — identity-provider-gated]
       │
       ▼
[Run ID assigned at workspace entry]
[Run Ledger opened at workspace entry]
       │
       ▼
[Orchestrator receives request from workspace]
  → selects agents from governed agent registry
  → issues scoped, signed delegation to each agent
  → dispatches sub-tasks
       │
       ▼
FOR EACH AGENT:

  If model call needed:
    [NVG OUTBOUND — Checkpoint 1]
      → intake and normalization (actor claims from identity provider)
      → data classification (label-driven — reads enterprise labels)
      → OCT model tier ceiling enforcement
      → egress policy evaluation (signed YAML)
      → if denied: Routing Provenance Trail entry, no model called
      → if approved: route to selected model tier
    [Model executes — on-prem or frontier per classification + OCT]
    [NVG INBOUND]
      → log return event (actor, model tier, run ID, timestamp, response size)
      → normalize response into standard result schema
      → pass normalized result to orchestrator boundary
    [Result returned to orchestrator, Run Ledger updated]

  If system action needed:
    [Post-Inference Action Normalizer — if action triggered by model response]
      → convert model output to AgentAction format
      → zero governance decisions — pure normalization
    [Adapter normalizes raw request to AgentAction — if direct adapter path]
    [Security Layer: checkIngress]
      → replay check, rate limit, schema validation
      → if threat: DENY + threat log + Gate 07
    [NXS Pipeline — Checkpoint 2]
      Gate 01: Identity — actor, principal, session, delegation
        fail → denied_identity + Gate 07
      Gate 02: Classification — verb, target, capability, risk tier
        fail → denied_classification + Gate 07
        sets: resolvedVerb, resolvedCapability, resolvedTarget,
              resolvedDataClasses, resolvedRiskTier
      Gate 03: Delegation — signature, scope, chain integrity
        fail → denied_delegation + Gate 07
        sets: context.delegationSnapshot
      Gate 04: Policy — rule evaluation, outcome, grant template
        deny → denied_policy + Gate 07
        sets: policyOutcome, policyRuleId, grantTemplate
        REQUIRE_APPROVAL or ESCALATE → Gate 05
        ALLOW → Gate 06
      Gate 05: Approval (conditional — never on ALLOW paths)
        fail/timeout/deny → denied_approval/denied_timeout + Gate 07
        sets: signedApprovalRequest, signedApprovalResponse
      Gate 06: Execution
        control: assertTemplateIntegrity → mint ExecutionGrant
        catch NexusSecurityViolation → denied_threat + ThreatEvent + Gate 07
        data: connector.execute(action, grant)
        fail → error + Gate 07 still runs
      Gate 07: Evidence (always runs — every path)
        compute CCV → build recordBody incl. CCV → hash → sign → append to ledger
    [Result returned to orchestrator, Run Ledger updated]

  If agent bypasses NVG (on-prem pre-classified only):
    → NXS directly (same seven gates, no gates skipped)
    → Run Ledger records the run (bypass annotated, no NVG entries)
    → Agent must have active session from governed workspace

[Orchestrator collects all agent results]
  → invokes compile step
[Compile Actor — OCT-COMPILE]
  → OCT ceiling inherited from highest-class input (hard rule)
  → Mode 1 (deterministic render): no model call, inside wall
  → Mode 2 (on-prem synthesis): inside wall, no NVG outbound
  → Mode 3 (frontier synthesis): routes through NVG if inputs permit
  → assembles final answer
[Final Response → Workspace → User]
[Run Ledger closed]
[Three audit streams cross-linked by run ID: complete forensic record]
```

### 8.2 Pipeline Branch Law

Blueprint §17.8. The pipeline branch after Gate 04 is an explicit stateful control-flow
decision inside the orchestrator. The orchestrator is NOT a generic gate loop. It branches
deterministically on Gate 04's OutcomeLabel.

```typescript
// Pipeline orchestrator — explicit branch, not a loop
const gates01to04 = [gate01, gate02, gate03, gate04];

for (const gate of gates01to04) {
  const result = await gate.evaluate(action, context, priorDecisions);
  priorDecisions.push(result.decision);

  if (result.decision.outcome !== 'pass' && result.decision.outcome !== 'allow') {
    // Early denial — skip to Gate 07
    break;
  }
  // Apply gate-specific mutations (Gate 02 sets resolved fields, Gate 03 sets snapshot, etc.)
}

// Branch on Gate 04 outcome
const g04Outcome = context.grantTemplate ? getG04Outcome(priorDecisions) : null;

if (g04Outcome === 'allow') {
  // ALLOW path: Gate 06 → Gate 07
  const g06Result = await gate06.evaluate(action, context, priorDecisions);
  priorDecisions.push(g06Result.decision);
} else if (g04Outcome === 'require_approval' || g04Outcome === 'escalate') {
  // Approval path: Gate 05 → (pass → Gate 06 → Gate 07 | deny/timeout → Gate 07)
  const g05Result = await gate05.evaluate(action, context, priorDecisions);
  priorDecisions.push(g05Result.decision);

  if (g05Result.decision.outcome === 'pass') {
    const g06Result = await gate06.evaluate(action, context, priorDecisions);
    priorDecisions.push(g06Result.decision);
  }
}
// else: DENY or ERROR — straight to Gate 07

// Gate 07 ALWAYS runs — no condition
const g07Result = await gate07.evaluate(action, context, priorDecisions);
```

Gate sequence invariants (all absolute — no exceptions):
- Gate 01 through Gate 04 always execute in order before any branch
- Gate 05 executes only on REQUIRE_APPROVAL or ESCALATE — never on ALLOW
- Gate 06 executes only after Gate 04 ALLOW or Gate 05 PASS — never before Gate 04
- Gate 07 executes exactly once per action, regardless of all upstream outcomes
- No gate may be skipped by outcome state, exception, or orchestrator design

---

## 9. Operating Modes

### 9.1 Three Modes

Blueprint §9. Both NVG and NXS support three operating modes. Mode is signed infrastructure
configuration. It is not an agent-level setting and cannot be changed by agents, adapters,
or any interface that agents use.

In all three modes, every decision is fully evaluated and logged as if Enforcing.
Mode controls whether the decision is acted upon — not whether it is recorded.

```typescript
// Canonical definition: §12.2 Governed Constants. Shown here for context.
export const OPERATING_MODE = {
  OBSERVE:   'observe',    // evaluate and log — never block
  ADVISORY:  'advisory',   // return decisions — caller decides enforcement
  ENFORCING: 'enforcing',  // full enforcement — block on DENY, route to approval
} as const;
export type OperatingMode = string;  // open governed type
```

| Mode | Behavior | Use When |
|------|----------|----------|
| observe | Evaluate and log all decisions. Never block. | Day 1 trial. Zero production risk. |
| advisory | Return decisions. Caller decides enforcement. | Gradual rollout. Policy testing. |
| enforcing | Full enforcement. Block on DENY. Route to approval. | Production. The correct posture. |

Recommended onboarding path: observe (week 1) → advisory (week 2) → enforcing (production).

### 9.2 Mode Configuration Shape

```typescript
interface ModeConfiguration {
  nxsMode:         OperatingMode;
  nvgMode:         OperatingMode;
  enforcingLocked: boolean;        // prevents downgrade from enforcing
  updatedAt:       IsoTimestamp;
  updatedBy:       { adminId: NonEmpty; publicKey: Base64Url };  // admin identity binding
  signature:       Base64Url;      // Ed25519 over canonicalize() of all fields except signature
}
```

Mode configuration is stored in a signed infrastructure config file. The engine validates
the signature at startup. An invalid signature prevents engine start.

### 9.3 Mode Change Law

Mode changes require:
- A signed admin command (Ed25519 admin keypair — separate from agent credentials)
- A mandatory audit event in the Run Ledger (§9.3.1 — infrastructure events are not
  Evidence Ledger or Trail records)
- No mode change is possible through agent interfaces, adapters, or approval channels

```typescript
async function changeMode(
  engine: 'nxs' | 'nvg',
  newMode: OperatingMode,
  adminId: NonEmpty,
  adminKeypair: KeyPair,
  currentConfig: ModeConfiguration
): Promise<ModeConfiguration> {
  // Enforcing-lock check
  if (currentConfig.enforcingLocked && newMode !== 'enforcing') {
    throw new Error('MODE_DOWNGRADE_BLOCKED: enforcing-lock is active');
  }

  const updated: ModeConfiguration = {
    ...currentConfig,
    [engine === 'nxs' ? 'nxsMode' : 'nvgMode']: newMode,
    updatedAt: nowIso(),
    updatedBy: { adminId, publicKey: adminKeypair.publicKey },
    signature: '', // placeholder
  };

  const { signature: _, ...body } = updated;
  updated.signature = await sign(canonicalize(body), adminKeypair);

  // Emit mandatory infrastructure audit event (Run Ledger — §9.3.1)
  await emitInfrastructureAuditEvent('mode_change', {
    engine, newMode,
    updatedBy: updated.updatedBy,
    updatedAt: updated.updatedAt,
  });

  return updated;
}
```

### 9.3.1 Infrastructure Audit Events

Mode changes, OCT assignments, enforcing-lock changes, and other infrastructure operations
are not part of a user run. They use a governed infrastructure run ID mechanism:

```typescript
// Governed namespace constant for infrastructure run ID derivation.
// All infrastructure events on the same calendar day share the same run ID,
// enabling cross-link continuity without requiring a user workspace entry.
const NEXUS_INFRA_NAMESPACE = 'nexus-infra-run' as const;

function getInfraRunId(): Uuid {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const hash = sha256(`${NEXUS_INFRA_NAMESPACE}:${today}`); // hex string, 64 chars
  // Format as UUID v4-shaped: 8-4-4-4-12 from first 32 hex chars
  const h = hash.slice(0, 32);
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}` as Uuid;
}

async function emitInfrastructureAuditEvent(
  eventType: string,
  detail: Record<string, unknown>
): Promise<void> {
  const infraRunId = getInfraRunId();
  const timestamp  = nowIso();

  // 1. Run Ledger entry
  await globalRunLedgerWriter.writeEvent({
    runId: infraRunId,
    eventType: eventType as RunEventType,  // valid: RunEventType includes all infrastructure events
    timestamp,
    actorId: null,
    detail,
  });

  // 2. Evidence Ledger: infrastructure events do not produce EvidenceRecords.
  //    They are recorded in the Run Ledger only. The Evidence Ledger is reserved
  //    for AgentAction pipeline records (Gate 07 output).

  // 3. Routing Provenance Trail: infrastructure events do not produce trail entries.
  //    The trail is reserved for NVG routing decisions.
}
```

Infrastructure events are cross-linked via Run Ledger only. Evidence Ledger and Routing
Provenance Trail do not carry infrastructure events — they are reserved for their respective
engine outputs. This is not a violation of the three-stream cross-link rule (§33): the rule
applies to governed run events, not infrastructure configuration changes.

### 9.4 Enforcing-Lock

An enforcing-lock flag in signed infrastructure configuration prevents any downgrade from
Enforcing mode without multi-party admin approval. The enforcing-lock is the intended
production configuration. Disabling the enforcing-lock requires multi-party admin signatures
and produces a mandatory infrastructure audit event in the Run Ledger (§9.3.1).

```typescript
async function disableEnforcingLock(
  adminSignatures: Array<{ adminId: NonEmpty; signature: Base64Url }>,
  currentConfig: ModeConfiguration,
  primaryAdminId: NonEmpty,
  primaryAdminKeypair: KeyPair,
  minRequired: number // minimum number of admin signatures required (default: 2)
): Promise<ModeConfiguration> {
  if (adminSignatures.length < minRequired) {
    throw new Error('MULTI_PARTY_REQUIRED: need ' + minRequired + ' admin signatures');
  }
  // Verify each admin signature over a canonical unlock-request payload
  const unlockPayload = canonicalize({
    action: 'disable_enforcing_lock',
    configSignature: currentConfig.signature,
    requestedAt: nowIso(),
  });
  for (const sig of adminSignatures) {
    const adminKey = await loadAdminPublicKey(sig.adminId);
    if (!adminKey) throw new Error('UNKNOWN_ADMIN: ' + sig.adminId);
    const valid = await verify(unlockPayload, sig.signature, adminKey);
    if (!valid) throw new Error('INVALID_ADMIN_SIGNATURE: ' + sig.adminId);
  }

  const updated: ModeConfiguration = {
    ...currentConfig,
    enforcingLocked: false,
    updatedAt: nowIso(),
    updatedBy: { adminId: primaryAdminId, publicKey: primaryAdminKeypair.publicKey },
    signature: '', // placeholder for re-sign
  };
  const { signature: _, ...body } = updated;
  updated.signature = await sign(canonicalize(body), primaryAdminKeypair);

  // Mandatory infrastructure audit event (Run Ledger — §9.3.1)
  await emitInfrastructureAuditEvent('enforcing_lock_disabled', {
    adminSigners: adminSignatures.map(s => s.adminId),
    minRequired,
    disabledAt: updated.updatedAt,
  });

  return updated;
}

// loadAdminPublicKey: loads admin public key from admin registry by adminId.
// Admin registry is separate from approver registry — admin keys govern
// infrastructure operations, not approval decisions.
async function loadAdminPublicKey(adminId: NonEmpty): Promise<Base64Url | null> {
  const keyPath = path.join('keys', 'admins', `${adminId}.public.json`);
  try {
    const raw = await fs.readFile(keyPath, 'utf-8');
    return JSON.parse(raw).publicKey;
  } catch { return null; }
}
```

---

## 10. Identity Provider Interface

### 10.1 Three Valid Sources

Blueprint §7. Before any request enters the stack, an identity provider supplies the
required claims. Any of three valid sources may supply these claims:

1. **Enterprise IAM** (Okta / Azure AD / AWS IAM) — full identity lifecycle, SSO, MFA,
   role management, and capability ceilings
2. **Enterprise RBAC** — roles and capability ceilings without a full IAM platform
3. **Reference Identity Adapter** — optional starter bootstrapper (see §32 for
   implementation)

The runtime contract is identical regardless of source.

### 10.2 Identity Provider Interface Contract

```typescript
// Defined in packages/contracts/src/interfaces/identity-provider.interface.ts

interface IdentityProviderInterface {
  readonly providerType: 'enterprise_iam' | 'enterprise_rbac' | 'reference_adapter';
  readonly providerVersion: NonEmpty;

  /**
   * Resolve identity claims for an actor.
   * Returns null if actor is not found in the provider.
   */
  resolveIdentity(actorIdentifier: NonEmpty): Promise<IdentityClaims | null>;

  /**
   * Validate authentication credentials.
   * Returns the authenticated actor identifier or throws.
   */
  authenticate(credentials: AuthCredentials): Promise<NonEmpty>;
}

interface IdentityClaims {
  principalIdentity:    NonEmpty;       // who the actor is
  roleAssignments:      NonEmpty[];     // what roles they hold
  capabilityCeilings:   CapabilityCeiling[];  // max scope of systems and actions
  environmentContext:   EnvironmentId;  // production, staging, or development
  actorClass:           ActorClass;     // governed actor class
}

interface CapabilityCeiling {
  allowedSystems:       string[];
  allowedCapabilities:  string[];
  maxRiskTier:          RiskTier;
}

interface AuthCredentials {
  type:  'api_key' | 'jwt' | 'oauth_token';
  value: NonEmpty;
}
```

### 10.3 Five Required Claims

Regardless of source, the identity provider must supply five claims for every actor:

1. **Principal identity** — who the actor is
2. **Role assignments** — what roles they hold in the organization
3. **Capability ceilings** — maximum scope of systems and actions permitted
4. **Environment context** — production, staging, or development
5. **Actor class** — the governed actor class from the v1.4.12 set

Both NVG and NXS consume these five claims and enforce within their respective boundaries.
Neither engine replaces the identity provider. The identity provider sets the org-level
ceiling; OCT sets the runtime ceiling within that; more restrictive wins.

### 10.4 OCT vs Identity-Provider Ceiling Conflict Rule

Blueprint §7.3. The more restrictive of the identity-provider capability ceiling and the
OCT ceiling always governs. This rule is not configurable and requires no runtime decision.

```typescript
function resolveEffectiveCeiling(
  identityProviderCeiling: CapabilityCeiling,
  octCeiling: OctCeiling
): EffectiveCeiling {
  // OCT-COMPILE has sentinel for actionRiskCeiling — it does not execute system actions.
  // If OCT-COMPILE reaches this function, Gate 02 should deny before ceiling resolution
  // is needed. However, for defensive completeness:
  const octRisk = octCeiling.actionRiskCeiling;
  const effectiveRisk = octRisk === EVIDENCE_SENTINEL
    ? identityProviderCeiling.maxRiskTier  // OCT-COMPILE: identity ceiling governs (moot — Gate 02 denies)
    : riskTierMin(identityProviderCeiling.maxRiskTier, octRisk);

  // OCT allowedSystems/allowedCapabilities: ['*'] means "no OCT restriction — identity ceiling governs"
  // Empty array means "no systems/capabilities permitted" (OCT-COMPILE)
  const octSystems = octCeiling.allowedSystems.includes('*')
    ? identityProviderCeiling.allowedSystems
    : octCeiling.allowedSystems;
  const octCaps = octCeiling.allowedCapabilities.includes('*')
    ? identityProviderCeiling.allowedCapabilities
    : octCeiling.allowedCapabilities;

  return {
    maxRiskTier: effectiveRisk,
    allowedSystems: intersect(identityProviderCeiling.allowedSystems, octSystems),
    allowedCapabilities: intersect(identityProviderCeiling.allowedCapabilities, octCaps),
    modelTierCeiling: octCeiling.modelTierCeiling,  // OCT owns model tier ceiling exclusively
  };
}

function intersect(a: string[], b: string[]): string[] {
  return a.filter(item => b.includes(item));
}

function riskTierMin(a: RiskTier, b: RiskTier): RiskTier {
  const idxA = RISK_TIER_ORDER.indexOf(a);
  const idxB = RISK_TIER_ORDER.indexOf(b);
  return idxA <= idxB ? a : b;
}
```

---

## 11. Agent Operational Classification Tiers (OCT)

### 11.1 Four OCT Levels

Blueprint §8. OCT is a governed envelope assigned to every actor. OCT is assigned at
registration by the enterprise operator. The actor has no visibility into its OCT. OCT
is immutable during a run.

```typescript
// Canonical definition: §12.2 Governed Constants. Shown here for context.
export const OCT_LEVEL = {
  SECURE:       'OCT-SECURE',
  CONFIDENTIAL: 'OCT-CONFIDENTIAL',
  OPEN:         'OCT-OPEN',
  COMPILE:      'OCT-COMPILE',
} as const;
export type OctLevel = string;  // open governed type
```

| OCT Level | Data Class Ceiling | Model Tier Ceiling | Action Risk Ceiling | Typical Actors |
|-----------|-------------------|-------------------|-------------------|---------------|
| OCT-SECURE | sensitive/restricted | on_prem_sensitive only — frontier hard-denied | critical | PII/PHI/financial agents |
| OCT-CONFIDENTIAL | internal/general | frontier-eligible per routing policy | high | analytics, workflow agents |
| OCT-OPEN | public/unclassified | any configured frontier tier | medium/low | public-facing agents |
| OCT-COMPILE | inherited from highest input (hard rule) | derived from inherited class | none — no system actions | result assembly only |

### 11.2 Four Ceilings per OCT

```typescript
interface DelegationCeilingDescriptor {
  maxChainDepth:        number;
  maxRiskTier:          RiskTier | EvidenceSentinel;  // sentinel for OCT-COMPILE only
}

interface OctCeiling {
  dataClassCeiling:     DataClass[];      // highest data classifications permitted
  modelTierCeiling:     ModelTier[];      // highest model tiers permitted
  actionRiskCeiling:    RiskTier | EvidenceSentinel;  // sentinel for OCT-COMPILE only
  allowedSystems:       string[];         // systems this OCT level may access
  allowedCapabilities:  string[];         // capabilities this OCT level may invoke
  delegationCeiling:    DelegationCeilingDescriptor;  // max delegation scope
}

// EffectiveCeiling: the resolved intersection of identity-provider ceiling and OCT ceiling.
// Used by Gate 02 and the delegation engine for enforcement.
interface EffectiveCeiling {
  maxRiskTier:          RiskTier;
  allowedSystems:       string[];
  allowedCapabilities:  string[];
  modelTierCeiling:     ModelTier[];      // OCT owns model tier ceiling exclusively
}

const OCT_CEILINGS: Record<string, OctCeiling> = {
  'OCT-SECURE': {
    dataClassCeiling:    ['public', 'internal', 'confidential', 'pii', 'phi', 'financial'],
    modelTierCeiling:    ['on_prem_sensitive'],  // frontier hard-denied
    actionRiskCeiling:   'critical',
    allowedSystems:      ['*'],           // all systems — identity-provider ceiling intersects
    allowedCapabilities: ['*'],           // all capabilities — identity-provider ceiling intersects
    delegationCeiling:   { maxChainDepth: 3, maxRiskTier: 'critical' },
  },
  'OCT-CONFIDENTIAL': {
    dataClassCeiling:    ['public', 'internal', 'confidential'],
    modelTierCeiling:    ['on_prem_sensitive', 'on_prem_general', 'frontier_general',
                          'frontier_reasoning', 'frontier_live', 'fallback'],
    actionRiskCeiling:   'high',
    allowedSystems:      ['*'],
    allowedCapabilities: ['*'],
    delegationCeiling:   { maxChainDepth: 2, maxRiskTier: 'high' },
  },
  'OCT-OPEN': {
    dataClassCeiling:    ['public'],
    modelTierCeiling:    ['on_prem_sensitive', 'on_prem_general', 'frontier_general',
                          'frontier_reasoning', 'frontier_live', 'fallback'],
    actionRiskCeiling:   'medium',
    allowedSystems:      ['*'],
    allowedCapabilities: ['*'],
    delegationCeiling:   { maxChainDepth: 1, maxRiskTier: 'medium' },
  },
  'OCT-COMPILE': {
    dataClassCeiling:    [],  // inherited at runtime — hard rule
    modelTierCeiling:    [],  // derived at runtime from inherited class
    actionRiskCeiling:   EVIDENCE_SENTINEL,  // NOT a RiskTier — OCT-COMPILE actors do not
                                             // execute system actions. Any NXS gate entry
                                             // with OCT-COMPILE is denied at Gate 02.
    allowedSystems:      [],  // no system actions permitted
    allowedCapabilities: [],  // no capabilities permitted
    delegationCeiling:   { maxChainDepth: 0, maxRiskTier: EVIDENCE_SENTINEL },
  },
};
```

### 11.3 OCT Assignment Law

OCT is assigned at actor registration by the enterprise operator. OCT assignment
produces a mandatory audit event in the Run Ledger.

```typescript
async function assignOct(
  actorId: Uuid,
  octLevel: OctLevel,
  operatorId: NonEmpty,
  runId: Uuid,
  runLedger: RunLedgerWriter
): Promise<void> {
  // Validate OCT level is in governed set
  if (!Object.values(OCT_LEVEL).includes(octLevel)) {
    throw new Error('INVALID_OCT_LEVEL: ' + octLevel);
  }

  // Update actor registry
  await actorRegistry.updateOct(actorId, octLevel);

  // Mandatory audit event — conforms to RunLedgerEntry shape
  await runLedger.writeEvent({
    runId,
    eventType: 'oct_assignment',
    timestamp: nowIso(),
    actorId,
    detail: { octLevel, operatorId },
  });
}
```

OCT change requires a signed operator action and produces a mandatory audit event.
An actor cannot request its own OCT assignment or change.

### 11.4 OCT-COMPILE Inheritance Rule

Blueprint §21.3. The compile actor's effective data class ceiling at runtime equals the
highest data class of all its inputs. This rule is not operator-configurable and not
overridable.

```typescript
const DATA_CLASS_ORDER: string[] = [
  'public', 'internal', 'confidential', 'pii', 'phi', 'financial'
];

function computeCompileOctCeiling(inputDataClasses: DataClass[]): DataClass {
  let maxIdx = 0;
  for (const dc of inputDataClasses) {
    const idx = DATA_CLASS_ORDER.indexOf(dc);
    if (idx > maxIdx) maxIdx = idx;
  }
  return DATA_CLASS_ORDER[maxIdx]!;
}
```

If inherited ceiling is sensitive per `isSensitiveDataClass()` (§12.2):
- Mode 3 (frontier synthesis) is hard-denied
- Only Mode 1 (deterministic render) or Mode 2 (on-prem synthesis) permitted

### 11.5 Hard Operational Constraint

Enterprises with no on-prem models cannot run OCT-SECURE inference jobs. This is an
explicit operational limit — not a silent fallback, not a configuration override, and
not a policy exception.

---

## 12. Canonical Data Types — Shared Contracts

All types in this section are defined in `packages/contracts/src/` (Layer 2).
Every other layer imports from contracts. Contracts imports nothing inside the monorepo.

### 12.1 Primitive Aliases

```typescript
type Uuid         = string;   // UUID v4 — from crypto.randomUUID()
type IsoTimestamp = string;   // ISO 8601 UTC — from new Date().toISOString()
type Sha256Hex    = string;   // 64-char lowercase hex
type Base64Url    = string;   // URL-safe base64, no padding
type NonEmpty     = string;   // validated non-empty at construction
type SemVer       = string;   // e.g. "v1.4.12"
```

### 12.2 Governed Constants

All governed types are open `string` aliases. Constants define the known set. New values
may be added by spec update. No value removed or renamed without a blueprint version bump.
The TypeScript type is `string` — NOT `typeof CONST[keyof typeof CONST]`.

Treating any governed type as a closed TypeScript union is a build violation (MODULAR-002,
MODULAR-006, MODULAR-011, MODULAR-015).

```typescript
// ─── Actor classes — open governed type ───
export const ACTOR_CLASS = {
  HUMAN:              'HUMAN',
  HUMAN_WITH_COPILOT: 'HUMAN_WITH_COPILOT',
  SUPERVISED_AGENT:   'SUPERVISED_AGENT',
  AUTONOMOUS_AGENT:   'AUTONOMOUS_AGENT',
  SCHEDULED_AGENT:    'SCHEDULED_AGENT',
  DELEGATED_SUBAGENT: 'DELEGATED_SUBAGENT',
  SERVICE_AUTOMATION: 'SERVICE_AUTOMATION',
} as const;
export type ActorClass = string;

// ─── Action verbs — open governed type (v1.4.12 production taxonomy) ───
// Expanded from 8 (v0.4.6) to 13 per Amendment C ratified taxonomy.
export const ACTION_VERB = {
  READ:        'read',
  WRITE:       'write',       // new in v1.4.12
  CREATE:      'create',
  UPDATE:      'update',
  DELETE:      'delete',
  EXECUTE:     'execute',
  QUERY:       'query',       // new in v1.4.12
  SEARCH:      'search',      // new in v1.4.12
  PUBLISH:     'publish',
  EXPORT:      'export',
  SEND:        'send',
  SYNTHESIZE:  'synthesize',  // new in v1.4.12
  TRANSMIT:    'transmit',    // new in v1.4.12
} as const;
export type ActionVerb = string;

// ─── Risk tiers — open governed type (ordered: low < medium < high < critical) ───
export const RISK_TIER = {
  LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical',
} as const;
export type RiskTier = string;
export const RISK_TIER_ORDER: string[] = ['low', 'medium', 'high', 'critical'];
export function riskTierExceeds(a: RiskTier, ceiling: RiskTier): boolean {
  return RISK_TIER_ORDER.indexOf(a) > RISK_TIER_ORDER.indexOf(ceiling);
}

// ─── Data classes — open governed type ───
export const DATA_CLASS = {
  PUBLIC: 'public', INTERNAL: 'internal', CONFIDENTIAL: 'confidential',
  PII: 'pii', PHI: 'phi', FINANCIAL: 'financial',
} as const;
export type DataClass = string;

// Governed sensitivity test — used by NVG classifier, policy validation, and compile mode.
// Any data class in this set triggers the hard wall: no frontier tier access.
// Single definition — all sensitivity checks MUST use this function.
const SENSITIVE_DATA_CLASSES: DataClass[] = [
  DATA_CLASS.PII, DATA_CLASS.PHI, DATA_CLASS.FINANCIAL, DATA_CLASS.CONFIDENTIAL,
];
export function isSensitiveDataClass(dc: DataClass): boolean {
  return SENSITIVE_DATA_CLASSES.includes(dc);
}

// ─── Environments — open governed type ───
export const ENVIRONMENT_ID = {
  DEV: 'dev', STAGING: 'staging', PRODUCTION: 'production',
} as const;
export type EnvironmentId = string;

// ─── Model tiers — open governed type (new in v1.4.12) ───
export const MODEL_TIER = {
  ON_PREM_SENSITIVE:  'on_prem_sensitive',
  ON_PREM_GENERAL:    'on_prem_general',
  FRONTIER_GENERAL:   'frontier_general',
  FRONTIER_REASONING: 'frontier_reasoning',
  FRONTIER_LIVE:      'frontier_live',
  FALLBACK:           'fallback',
} as const;
export type ModelTier = string;  // MODULAR-011: never a closed enum

// ─── OCT levels — open governed type (new in v1.4.12) ───
export const OCT_LEVEL = {
  SECURE:       'OCT-SECURE',
  CONFIDENTIAL: 'OCT-CONFIDENTIAL',
  OPEN:         'OCT-OPEN',
  COMPILE:      'OCT-COMPILE',
} as const;
export type OctLevel = string;  // MODULAR-015: never a closed enum

// ─── Operating modes — open governed type (new in v1.4.12) ───
export const OPERATING_MODE = {
  OBSERVE:   'observe',
  ADVISORY:  'advisory',
  ENFORCING: 'enforcing',
} as const;
export type OperatingMode = string;

// ─── Outcome labels (policy gate output) — open governed type ───
export const OUTCOME_LABEL = {
  ALLOW: 'allow', DENY: 'deny',
  REQUIRE_APPROVAL: 'require_approval', ESCALATE: 'escalate',
} as const;
export type OutcomeLabel = string;

// ─── Approval decision labels — open governed type ───
export const APPROVAL_DECISION_LABEL = {
  APPROVED: 'approved', DENIED: 'denied', TIMED_OUT: 'timed_out',
} as const;
export type ApprovalDecisionLabel = string;

// ─── Final outcome labels — open governed type ───
export const FINAL_OUTCOME = {
  EXECUTED:            'executed',
  DENIED_IDENTITY:     'denied_identity',
  DENIED_CLASSIF:      'denied_classification',
  DENIED_DELEGATION:   'denied_delegation',
  DENIED_POLICY:       'denied_policy',
  DENIED_APPROVAL:     'denied_approval',
  DENIED_TIMEOUT:      'denied_timeout',
  DENIED_THREAT:       'denied_threat',
  ERROR:               'error',
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
  GATE_ID.G01, GATE_ID.G02, GATE_ID.G03, GATE_ID.G04,
  GATE_ID.G05, GATE_ID.G06, GATE_ID.G07,
];

// ─── Expiry classes — open governed type ───
export const EXPIRY_CLASS = {
  ACTION_SCOPED:  'action_scoped',   // max 30s
  SHORT_LIVED:    'short_lived',     // max 60s
  SESSION_SCOPED: 'session_scoped',  // max 300s
} as const;
export type ExpiryClass = string;
export const EXPIRY_CLASS_SECONDS: Record<string, number> = {
  action_scoped: 30, short_lived: 60, session_scoped: 300,
};

// ─── Denial codes — typed denial identifiers for programmatic mapping ───
export const DENIAL_CODE = {
  // Gate 01
  ACTOR_NOT_REGISTERED:          'actor_not_registered',
  SESSION_NOT_FOUND:             'session_not_found',
  SESSION_EXPIRED:               'session_expired',
  PRINCIPAL_NOT_RESOLVABLE:      'principal_not_resolvable',
  ACTOR_PRINCIPAL_MISMATCH:      'actor_principal_mismatch',
  NON_HUMAN_ACTOR_INCOMPLETE:    'non_human_actor_incomplete_registry',
  // Gate 02
  UNRESOLVABLE_VERB:             'unresolvable_action_verb',
  UNRESOLVABLE_TARGET:           'unresolvable_target',
  UNRESOLVABLE_CAPABILITY:       'unresolvable_capability',
  RISK_CEILING_EXCEEDED:         'risk_ceiling_exceeded',  // new: OCT risk ceiling
  // Gate 03
  DELEGATION_SIG_INVALID:        'delegation_signature_invalid',
  DELEGATION_EXPIRED:            'delegation_expired',
  CAPABILITY_NOT_IN_DELEGATION:  'capability_not_in_delegation',
  CAPABILITY_FORBIDDEN:          'capability_explicitly_forbidden',
  SYSTEM_NOT_IN_DELEGATION:      'system_not_in_delegation',
  RISK_TIER_EXCEEDS_CEILING:     'risk_tier_exceeds_delegation_ceiling',
  CHAIN_DEPTH_EXCEEDED:          'chain_depth_ceiling_exceeded',
  PROPAGATION_NOT_PERMITTED:     'downstream_propagation_not_permitted',
  ENVIRONMENT_MISMATCH:          'environment_mismatch',
  CHAIN_INTEGRITY_BROKEN:        'chain_integrity_broken',
  // Gate 04
  POLICY_DENY:                   'policy_deny',
  DEFAULT_DENY:                  'default_deny',
  // Gate 05
  APPROVAL_TIMEOUT:              'approval_timeout',
  APPROVAL_DENIED_BY_HUMAN:      'approval_denied_by_human',
  APPROVAL_SIG_INVALID:          'approval_response_signature_invalid',
  APPROVAL_CONFIG_MISSING:       'approval_config_missing',
  APPROVAL_CHANNEL_NOT_FOUND:    'approval_channel_not_found',
  // Gate 06
  CONNECTOR_NOT_REGISTERED:      'connector_not_registered',
  CONNECTOR_CAP_UNSUPPORTED:     'connector_capability_unsupported',
  // Security / ingress
  REPLAY_DETECTED:               'replay_detected',
  RATE_LIMIT_EXCEEDED:           'rate_limit_exceeded',
  BROAD_TOKEN_BYPASS:            'broad_token_bypass',
  TEMPLATE_INTEGRITY_FAILED:     'template_integrity_failed',
  GRANT_EXPIRED:                 'grant_expired',
  SEQUENCE_ANOMALY:              'sequence_anomaly',  // chain verifier only — not ingress
  // NVG
  NVG_CLASSIFICATION_DENIED:     'nvg_classification_denied',      // new
  NVG_OCT_CEILING_DENIED:        'nvg_oct_ceiling_denied',         // new
  NVG_ROUTING_POLICY_DENIED:     'nvg_routing_policy_denied',      // new
  NVG_QUARANTINE:                'nvg_quarantine',                  // new
  NVG_FALLBACK_DENIED:           'nvg_fallback_denied',            // new
  NVG_ENDPOINT_TIMEOUT:          'nvg_endpoint_timeout',           // transport timeout (§24.5)
  NVG_ENDPOINT_UNREACHABLE:      'nvg_endpoint_unreachable',       // transport failure (§24.5)
  NVG_POLICY_SIG_INVALID:        'nvg_routing_policy_signature_invalid', // new
} as const;
export type DenialCode = string;

// ─── Sentinel value for EvidenceRecord encoding (new in v1.4.12) ───
// See §34 for full applicability law.
export const EVIDENCE_SENTINEL = 'NOT_APPLICABLE' as const;
export type EvidenceSentinel = typeof EVIDENCE_SENTINEL;

// ─── Version constants ───
export const GENESIS_HASH                        = '0000000000000000000000000000000000000000000000000000000000000000';
export const BLUEPRINT_VERSION: SemVer           = 'v1.5.13';
export const SPEC_VERSION: SemVer                = 'v1.8.26';
export const RUNTIME_CONTRACT_VERSION: SemVer    = 'v1.0.0';
export const CAPABILITY_TAXONOMY_VERSION: SemVer = 'v1.0.0';
export const COMPARISON_INPUT_VERSION: SemVer    = 'v1.0.0';
export const NEXUS_VERSION: SemVer               = 'v1.0.0';
export const DELEGATION_ENGINE_ID: NonEmpty      = 'nexus-delegation-engine-v1';

// ─── Replay dedup TTL ───
export const REPLAY_DEDUP_TTL_SECONDS = 3600;
// Min: 300s. Max: 86400s. Outside bounds: engine refuses to start.

// ─── Infrastructure run ID namespace (§9.3.1) ───
export const NEXUS_INFRA_NAMESPACE = 'nexus-infra-run' as const;

// ─── Capability taxonomy v1.0.0 ───
export const CAPABILITY_IDS = {
  READ_RECORD_SINGLE:       'read:record:single',
  READ_RECORD_BULK:         'read:record:bulk',
  READ_RECORD_PII:          'read:record:pii',
  READ_RECORD_BULK_PII:     'read:record:bulk:pii',
  CREATE_RECORD_INTERNAL:   'create:record:internal',
  CREATE_RECORD_EXTERNAL:   'create:record:external',
  UPDATE_RECORD_INTERNAL:   'update:record:internal',
  UPDATE_RECORD_EXTERNAL:   'update:record:external',
  DELETE_RECORD:            'delete:record',
  DELETE_RECORD_BULK:       'delete:record:bulk',
  SEND_MESSAGE_INTERNAL:    'send:message:internal',
  SEND_MESSAGE_EXTERNAL:    'send:message:external',
  PUBLISH_CONTENT_INTERNAL: 'publish:content:internal',
  PUBLISH_CONTENT_EXTERNAL: 'publish:content:external',
  EXPORT_DATA_SINGLE:       'export:data:single',
  EXPORT_DATA_BULK:         'export:data:bulk',
  EXPORT_DATA_BULK_PII:     'export:data:bulk:pii',
  EXECUTE_QUERY:            'execute:query',
  EXECUTE_AUTOMATION:       'execute:automation',
  // New v1.4.12 capabilities for expanded verb taxonomy:
  WRITE_RECORD_INTERNAL:    'write:record:internal',
  WRITE_RECORD_EXTERNAL:    'write:record:external',
  QUERY_DATA:               'query:data',
  SEARCH_DATA:              'search:data',
  SYNTHESIZE_CONTENT:       'synthesize:content',
  TRANSMIT_DATA:            'transmit:data',
} as const;

// ─── Lexical constants — Amendment J-S1 ───
export const LEXICAL_VERSION = 'v1' as const;
export type LexiconVersion = string;

// ─── Scenario manifest ───
export const SCENARIO_MANIFEST = {
  '01-allow-read':          { description: 'Low-risk read → ALLOWED → executed',             fixturePath: 'fixtures/scenario-01-allow-read' },
  '02-allow-create':        { description: 'Medium-risk create → ALLOWED → executed',        fixturePath: 'fixtures/scenario-02-allow-create' },
  '03-approval-approved':   { description: 'High-risk send → REQUIRE_APPROVAL → approved',   fixturePath: 'fixtures/scenario-03-approval-approved' },
  '04-approval-denied':     { description: 'High-risk send → REQUIRE_APPROVAL → denied',     fixturePath: 'fixtures/scenario-04-approval-denied' },
  '05-approval-timeout':    { description: 'High-risk send → REQUIRE_APPROVAL → timeout',    fixturePath: 'fixtures/scenario-05-approval-timeout' },
  '06-replay-detected':     { description: 'Replay of scenario-01 → REPLAY DETECTED',        fixturePath: 'fixtures/scenario-06-replay-detected' },
  '07-default-deny':        { description: 'No policy loaded → DEFAULT DENY',                fixturePath: 'fixtures/scenario-07-default-deny' },
  '08-policy-unsigned':     { description: 'Unsigned policy → REJECTED at load',             fixturePath: 'fixtures/scenario-08-policy-unsigned' },
  '09-broad-token-bypass':  { description: 'Broad static credential → DENIED threat',        fixturePath: 'fixtures/scenario-09-broad-token-bypass' },
  '10-delegation-exceeded': { description: 'Sub-agent outside parent bounds → DENIED Gate 03', fixturePath: 'fixtures/scenario-10-delegation-exceeded' },
} as const;
export type ScenarioId = keyof typeof SCENARIO_MANIFEST;
```

### 12.3 Core Interfaces

All interfaces defined in `packages/contracts/src/interfaces/`.

#### 12.3.1 Principal

```typescript
interface Principal {
  principalId:          Uuid;
  displayName:          NonEmpty;
  email:                NonEmpty;
  registeredAt:         IsoTimestamp;
  maxDelegableRiskTier: RiskTier;
  allowedSystems:       string[];
}
```

#### 12.3.2 Actor

```typescript
interface Actor {
  actorId:        Uuid;
  actorClass:     ActorClass;
  principalId:    Uuid;
  displayName:    NonEmpty;
  environment:    EnvironmentId;
  octLevel:       OctLevel;          // new in v1.4.12 — assigned at registration
  riskCeiling:    RiskTier;
  allowedSystems: string[];
  registeredAt:   IsoTimestamp;
  owner?:          NonEmpty;         // required for non-human actors
  purpose?:        NonEmpty;         // required for non-human actors
  reviewCadence?:  NonEmpty;         // required for non-human actors
}
```

Validation: if actorClass is not HUMAN or HUMAN_WITH_COPILOT, owner/purpose/reviewCadence
must be present and non-empty. Missing fields → registry rejection.

#### 12.3.3 DelegationContext

```typescript
interface DelegationContext {
  delegationId:               Uuid;
  principalId:                Uuid;
  actorId:                    Uuid;
  parentDelegationId:         Uuid | null;   // null = root
  chainDepth:                 number;        // 0 = root
  maxChainDepth:              number;        // never increased by sub-delegation
  allowedSystems:             string[];
  allowedCapabilities:        string[];      // CapabilityId[]
  forbiddenCapabilities:      string[];
  maxRiskTier:                RiskTier;
  allowDownstreamPropagation: boolean;
  environment:                EnvironmentId; // scoped to this environment only
  mintedAt:                   IsoTimestamp;
  expiresAt:                  IsoTimestamp;
  mintedBy:                   NonEmpty;      // must use DELEGATION_ENGINE_ID constant
  signature:                  Base64Url;     // Ed25519 over canonicalize() of all fields except signature
}
```

#### 12.3.4 Session

```typescript
interface Session {
  sessionId:    Uuid;
  actorId:      Uuid;
  principalId:  Uuid;          // derived server-side from actor.principalId; never caller-supplied
  delegationId: Uuid;
  createdAt:    IsoTimestamp;
  expiresAt:    IsoTimestamp;
}
```

principalId is always derived from actor.principalId at session creation. Caller-supplied
principalId is rejected. See §20 for session creation law.

#### 12.3.5 AgentAction

```typescript
interface AgentAction {
  actionId:        Uuid;           // assigned at ingress, never mutated
  runId:           Uuid;           // new in v1.4.12 — propagated from workspace
  receivedAt:      IsoTimestamp;
  protocol:        NonEmpty;       // e.g. 'mcp/1.0'
  adapterVersion:  NonEmpty;
  actorId:         Uuid;
  principalId:     Uuid;
  sessionId:       Uuid;
  delegationId:    Uuid;
  delegationSequence: number;      // engine-assigned monotonic counter per delegationId
                                   // forensic ordering; never adapter-provided
  tool:            NonEmpty;
  rawVerb:         NonEmpty;
  rawTarget:       NonEmpty;
  rawPayload:      unknown;        // in-memory only; never stored
  intent:          IntentContext;
  resolvedVerb:        ActionVerb | null;
  resolvedCapability:  string | null;
  resolvedTarget:      ResourceTarget | null;
  resolvedDataClasses: DataClass[];
  resolvedRiskTier:    RiskTier | null;
}
```

AgentAction is the boundary contract between adapters/normalizers and the NXS engine.
AgentAction schema is defined in contracts and is shared across all layers.

#### 12.3.6 IntentContext

```typescript
interface IntentContext {
  objectiveSummary: NonEmpty;      // max 500 chars, sanitized
  triggeringSource: NonEmpty;      // 'user_request'|'schedule'|'event'|'sub_task'|'unknown'
  toolchainContext: NonEmpty;      // adapter name + version
  modelId:          string | null;
  modelConfidence:  number | null; // [0,1]
  riskNote:         string | null; // max 200 chars, sanitized
  extractedAt:      IsoTimestamp;
}
```

#### 12.3.7 GateDecision

```typescript
interface GateDecision {
  gateId:      GateId;
  gateOrder:   number;            // 1–7
  plane:      'control' | 'data';
  outcome:     string;            // OutcomeLabel | 'pass' | 'error'
  reason:      NonEmpty;          // human-readable prose
  denialCode:  DenialCode | null; // typed denial code; null on pass/allow
  policyRuleId:string | null;     // Gate 04 only
  evaluatedAt: IsoTimestamp;
  durationMs:  number;            // real elapsed ms from gate entry to decision
  metadata:    Record<string, string | number | boolean | null>;
}
```

`denialCode` is the machine-readable denial identifier. `computeFinalOutcome` maps on
denialCode. `reason` is human-readable. Never use `reason.includes(...)` for logic.

#### 12.3.8 ResourceTarget

```typescript
interface ResourceTarget {
  system:         NonEmpty;
  resourceType:   NonEmpty;
  resourceScope: 'single' | 'bulk' | 'collection' | 'system';
  environment:   EnvironmentId;
  externalFacing:boolean;
}
```

#### 12.3.9 ExecutionGrantTemplate

```typescript
interface ExecutionGrantTemplate {
  templateId:            Uuid;
  actionId:              Uuid;
  computedAt:            IsoTimestamp;
  capabilityId:          string;
  scopeDescriptor:       NonEmpty;
  credentialSubjectType: NonEmpty;
  resourceBounds:        ResourceBounds;
  environmentBound:      EnvironmentId;
  expiryClass:           ExpiryClass;
  maxExpirySeconds:      number;
  approvalRequired:      boolean;
  approvalLinkage:       Uuid | null;  // set by Gate 05 after approval
  approvalConfig:        ApprovalConfig | null;
  templateFingerprint:   Sha256Hex;
  // fingerprint = sha256(canonicalize(templateFingerprintPayload(template)))
  // omits templateFingerprint AND approvalLinkage by field removal.
}
```

#### 12.3.10 ResourceBounds

```typescript
interface ResourceBounds {
  allowedResourceTypes: string[];
  maxRecords:           number | null;
  allowBulk:            boolean;
  allowExternalFacing:  boolean;
}
```

#### 12.3.11 ApprovalRequest

```typescript
interface ApprovalRequest {
  approvalId:           Uuid;
  actionId:             Uuid;
  templateId:           Uuid;
  issuedAt:             IsoTimestamp;
  expiresAt:            IsoTimestamp;  // = addSeconds(issuedAt, approvalConfig.timeoutSeconds)
  actionSummary:        NonEmpty;
  contextSummary:       NonEmpty;
  proposedTarget:       ResourceTarget;
  diff:                 string | null;
  estimatedImpact:      NonEmpty;
  principalDisplayName: NonEmpty;
  actorDisplayName:     NonEmpty;
  riskTier:             RiskTier;
  dataClasses:          DataClass[];
  modelConfidence:      number | null;
  riskNote:             string | null;
  signature:            Base64Url;     // Ed25519 over canonicalize() of all fields except signature
}
```

Invariant: expiresAt must equal addSeconds(issuedAt, approvalConfig.timeoutSeconds).

#### 12.3.12 ApprovalResponse

```typescript
interface ApprovalResponse {
  approvalId: Uuid;
  decision:   ApprovalDecisionLabel;
  decidedBy:  NonEmpty;          // approver ID; 'system:timeout' for timeout responses
  decidedAt:  IsoTimestamp;
  channel:    NonEmpty;
  note:       string | null;
  signature:  Base64Url;         // Ed25519 by approver key; '<none>' for timeout
}
```

Timeout responses: system-generated, decidedBy = 'system:timeout', never reach external
signature verification path.

#### 12.3.13 ExecutionGrant

```typescript
interface ExecutionGrant {
  grantId:           Uuid;
  actionId:          Uuid;
  templateId:        Uuid;
  approvalId:        Uuid | null;
  mintedAt:          IsoTimestamp;
  expiresAt:         IsoTimestamp;
  capabilityId:      string;
  scopeDescriptor:   NonEmpty;
  credentialSubject: CredentialSubject;
  resourceBounds:    ResourceBounds;
  environmentBound:  EnvironmentId;
  signature:         Base64Url;
  // secretValue: NOT on this interface. Lives in grant-vault WeakMap only.
}
```

#### 12.3.14 CredentialSubject

```typescript
interface CredentialSubject {
  subjectId:   NonEmpty;
  subjectType: 'user_identity' | 'service_identity' | 'federated';
  system:      NonEmpty;
}
```

#### 12.3.15 ExecutionResult

```typescript
interface ExecutionResult {
  grantId:         Uuid;
  executedAt:      IsoTimestamp;
  status:         'success' | 'failure' | 'partial';
  responseCode:    string | null;
  durationMs:      number;
  redactedSummary: string | null;
  errorType:       string | null;
  errorMessage:    string | null;
}
```

#### 12.3.16 ExecutionGrantMetadata (evidence-safe, no secret)

```typescript
interface ExecutionGrantMetadata {
  grantId:               Uuid | EvidenceSentinel;
  scopeDescriptor:       NonEmpty | EvidenceSentinel;
  credentialSubjectId:   NonEmpty | EvidenceSentinel;
  credentialSubjectType: string | EvidenceSentinel;
  issuedAt:              IsoTimestamp | EvidenceSentinel;
  expiresAt:             IsoTimestamp | EvidenceSentinel;
  expiryClass:           ExpiryClass | EvidenceSentinel;
  templateFingerprint:   Sha256Hex | EvidenceSentinel;
  approvalLinkage:       Uuid | EvidenceSentinel;  // sentinel on direct-ALLOW and no-grant paths
}
```

On paths where no grant was minted (denials before Gate 06, approval timeout, policy deny),
all fields carry EVIDENCE_SENTINEL. On paths where a grant was minted, fields carry actual
values. On direct-ALLOW paths where a grant was minted without approval, approvalLinkage
carries EVIDENCE_SENTINEL — the grant exists but no approval artifact is linked. Fields
are never null and never omitted — structurally complete in all cases.

#### 12.3.17 DelegationContextSnapshot

```typescript
interface DelegationContextSnapshot {
  delegationId:   Uuid;
  principalId:    Uuid;
  actorId:        Uuid;
  chainDepth:     number;
  chainAncestors: Uuid[];     // all parent delegation IDs, root first
  chainHash:      Sha256Hex;  // sha256(canonicalize([delegationId, ...chainAncestors]))
  allowedSystems: string[];
  maxRiskTier:    RiskTier;
  environment:    EnvironmentId;
  expiresAt:      IsoTimestamp;
}
```

#### 12.3.18 ThreatEvent

```typescript
type ThreatType =
  | 'replay_detected'         | 'injection_truncated'      | 'broad_token_bypass'
  | 'scope_expansion_attempt' | 'policy_signature_invalid'
  | 'approval_response_invalid'                             | 'rate_limit_exceeded'
  | 'intent_overflow'         | 'environment_mismatch'      | 'security_violation'
  | 'nvg_wall_violation';     // new in v1.4.12

interface ThreatEvent {
  threatType: ThreatType;
  detectedAt: IsoTimestamp;
  gateId:     GateId | 'ingress' | 'nvg';   // 'nvg' new in v1.4.12
  detail:     NonEmpty;       // max 300 chars, sanitized
}
```

#### 12.3.19 IntentEvidence (evidence-safe subset of IntentContext)

```typescript
interface IntentEvidence {
  objectiveSummary: NonEmpty;
  triggeringSource: NonEmpty;
  toolchainContext: NonEmpty;
  modelId:          string | null;
  modelConfidence:  number | null;
  riskNote:         string | null;
}
```

#### 12.3.20 EvidenceRecord

See §34 for full sentinel/applicability law. Fields marked with union type carry
sentinel value on paths where the producing gate did not execute.

```typescript
interface EvidenceRecord {
  recordId:       Uuid;
  actionId:       Uuid;
  sessionId:      Uuid;
  runId:          Uuid;           // new in v1.4.12 — cross-link key
  ledgerSequence: number;
  actionSummary: {
    actionId:             Uuid;
    receivedAt:           IsoTimestamp;
    protocol:             string;
    actorId:              Uuid;
    actorClass:           ActorClass;
    actorEnvironment:     EnvironmentId;
    principalId:          Uuid;
    delegationSequence:   number;          // forensic ordering; not in CCV
    tool:                 string;
    resolvedVerb:         ActionVerb | EvidenceSentinel;
    resolvedCapability:   string | EvidenceSentinel;
    resolvedTarget:       ResourceTarget | EvidenceSentinel; // sentinel on pre-classification denial
    resolvedDataClasses:  DataClass[] | EvidenceSentinel;
    resolvedRiskTier:     RiskTier | EvidenceSentinel;
  };
  intentEvidence:            IntentEvidence;
  delegationContextSnapshot: DelegationContextSnapshot;
  gateDecisions:             GateDecision[];
  policyRuleId:              string | EvidenceSentinel;
  policyOutcome:             OutcomeLabel | EvidenceSentinel;
  approvalRequired:          boolean | EvidenceSentinel;
  approvalRequest:           ApprovalRequest | null;
  approvalResponse:          ApprovalResponse | null;
  approvalDecisionLabel:     ApprovalDecisionLabel | EvidenceSentinel;
  grantMetadata:             ExecutionGrantMetadata;  // always present; sentinel-encoded per §34
  executionResult:           ExecutionResult | null;
  finalOutcome:              FinalOutcome;
  threatEvents:              ThreatEvent[];
  compilerView:              CompilerComparisonView;  // inside signed body
  previousHash:              Sha256Hex;
  recordHash:                Sha256Hex;
  signature:                 Base64Url;
}
```

delegationSequence in actionSummary is forensic only — not in CCV, not a comparison key.

#### 12.3.21 Gate Interface

```typescript
// packages/contracts/src/interfaces/gate.interface.ts

interface Gate {
  readonly gateId:    GateId;
  readonly gateOrder: number;
  readonly plane:    'control' | 'data';
  evaluate(
    action: AgentAction,
    context: PipelineContext,
    priorDecisions: GateDecision[]
  ): Promise<GateResult>;
  onDownstreamFailure?(action: AgentAction, failedGate: GateId): Promise<void>;
}
```

priorDecisions passed explicitly — not via context — so no context spread occurs.

#### 12.3.22 GateResult

```typescript
interface GateResult {
  decision:            GateDecision;
  actionMutations?:    Partial<AgentAction>;    // Gate 02 only
  grantTemplate?:      ExecutionGrantTemplate;  // Gate 04 only
  grant?:              ExecutionGrant;           // Gate 06 only
  executionResult?:    ExecutionResult;          // Gate 06 only
  delegationSnapshot?: DelegationContextSnapshot; // Gate 03 only
  approvalRequest?:    ApprovalRequest;          // Gate 05 only
  approvalResponse?:   ApprovalResponse;         // Gate 05 only
}
```

#### 12.3.23 PipelineContext

```typescript
interface PipelineContext {
  sessionId:            Uuid;
  delegationContext:    DelegationContext;
  delegationStore:      DelegationStore;
  delegationSnapshot?:  DelegationContextSnapshot;
  actor:                Actor;
  principal:            Principal;
  policyFile:           LoadedPolicyFile | null;
  approverRegistry:     ApproverRegistry;
  connectorRegistry:    ConnectorRegistry;
  channelRegistry:      ChannelRegistry;
  threatLog:            ThreatEvent[];
  startedAt:            IsoTimestamp;
  grantTemplate?:       ExecutionGrantTemplate;
  executionGrant?:      ExecutionGrant;
  executionResult?:     ExecutionResult;
  approvalRequest?:     ApprovalRequest;
  approvalResponse?:    ApprovalResponse;
  lastEvidenceRecord?:  EvidenceRecord;
}
```

Optional fields are set by gate side-effects during pipeline execution. They are undefined
before their producing gate runs. The orchestrator is responsible for copying gate result
fields into context after each gate evaluation.

#### 12.3.24 LedgerBackend Interface

```typescript
// packages/contracts/src/interfaces/ledger-backend.interface.ts

interface LedgerBackend {
  readonly backendId:      NonEmpty;
  readonly backendVersion: NonEmpty;
  append(record: EvidenceRecord): Promise<void>;
  getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null>;
  getBySequence(seq: number): Promise<EvidenceRecord | null>;
  getLatestSequence(): Promise<number>;
  listRange(from: number, to: number): Promise<EvidenceRecord[]>;
}
```

No DELETE or UPDATE method may exist on this interface. Append-only is law (MODULAR-003).

#### 12.3.25 Connector Interface

```typescript
// packages/contracts/src/interfaces/connector.interface.ts

interface Connector {
  readonly systemType:       NonEmpty;
  readonly connectorVersion: NonEmpty;
  supportedCapabilities(): string[];
  canProduceDiff(): boolean;
  produceDiff?(action: AgentAction, template: ExecutionGrantTemplate): Promise<string | null>;
  execute(action: AgentAction, grant: ExecutionGrant): Promise<ExecutionResult>;
  redeemGrant(grant: ExecutionGrant): Promise<void>;
}
```

Connector `execute` MUST call `assertGrantPresent(grant)` and `assertGrantNotExpired(grant)`.
These throw `NexusSecurityViolation` if violated. Gate 06 catches NexusSecurityViolation
separately from generic errors (SOLVE-013).

#### 12.3.26 ApprovalChannel Interface

```typescript
// packages/contracts/src/interfaces/approval-channel.interface.ts

interface ApprovalChannel {
  readonly channelId:      NonEmpty;
  readonly channelVersion: NonEmpty;
  dispatch(request: ApprovalRequest): Promise<void>;
  awaitDecision(approvalId: Uuid, timeoutMs: number): Promise<ApprovalResponse | null>;
}
```

CLI is Channel v1 (MODULAR-004). No channel-specific transport logic belongs in the
approval orchestrator core.

#### 12.3.27 PolicyRule and PolicyCondition

```typescript
interface PolicyCondition {
  actorClasses?:    ActorClass[];
  capabilities?:    string[];
  actionVerbs?:     ActionVerb[];
  riskTiers?:       RiskTier[];
  dataClasses?:     DataClass[];
  environments?:    EnvironmentId[];
  externalFacing?:  boolean;
  maxChainDepth?:   number;
}

interface GrantTemplateHint {
  expiryClass?:         ExpiryClass;
  maxRecords?:          number;
  allowBulk?:           boolean;
  allowExternalFacing?: boolean;
}

interface ApprovalConfig {
  timeoutSeconds: number;
  channelId:      NonEmpty;   // string, not array — POC (SOLVE-016)
}

interface PolicyRule {
  ruleId:        NonEmpty;
  priority:      number;       // lower = higher priority
  conditions:    PolicyCondition;
  outcome:       OutcomeLabel;
  grantHint?:    GrantTemplateHint;
  approvalConfig?: ApprovalConfig;
}

interface LoadedPolicyFile {
  filepath:    NonEmpty;
  bundleHash:  Sha256Hex;
  sortedRules: PolicyRule[];   // sorted by priority ascending
  loadedAt:    IsoTimestamp;
  signature:   Base64Url;
}
```

#### 12.3.28 PendingApprovalRecord

```typescript
interface PendingApprovalRecord {
  approvalId:   Uuid;
  actionId:     Uuid;
  templateId:   Uuid;
  requestJson:  string;        // serialized signed ApprovalRequest
  channelId:    NonEmpty;
  dispatchedAt: IsoTimestamp;
  expiresAt:    IsoTimestamp;
}
```

#### 12.3.29 DelegationStore Interface

```typescript
interface DelegationStore {
  getById(delegationId: Uuid): Promise<DelegationContext | null>;
  save(dc: DelegationContext): Promise<void>;
  listForActor(actorId: Uuid): Promise<DelegationContext[]>;
}
```

#### 12.3.30 Registry Interfaces

```typescript
interface ActorRegistry {
  get(actorId: Uuid): Promise<Actor | null>;
  register(actor: Actor): Promise<void>;
  updateOct(actorId: Uuid, octLevel: OctLevel): Promise<void>;
  list(): Promise<Actor[]>;
}

interface PrincipalRegistry {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<void>;
}

interface ApproverRegistry {
  getPublicKey(approverId: NonEmpty): Promise<Base64Url | null>;
  register(actorId: Uuid, publicKey: Base64Url, channels: string[]): Promise<void>;
}

interface ConnectorRegistry {
  get(systemType: NonEmpty): Connector | undefined;
  register(connector: Connector): void;
}

interface ChannelRegistry {
  get(channelId: NonEmpty): ApprovalChannel | undefined;
  register(channel: ApprovalChannel): void;
}
```

#### 12.3.31 RunOptions and IngestEntry

```typescript
interface RunOptions {
  scenario?:    ScenarioId;
  fixturesAll?: boolean;
  outDir?:      string;
}

interface IngestEntry {
  actionId:      Uuid;
  receivedAt:    IsoTimestamp;
  protocol:      NonEmpty;
  actorId:       Uuid;
  tool:          NonEmpty;
  rawVerb:       NonEmpty;
  rawTarget:     NonEmpty;
  ingressResult: 'ok' | 'replay' | 'rate_limited' | 'injection_truncated';
  scenarioId:    string;
}
```

#### 12.3.32 TokenPostureReport

```typescript
interface TokenPostureReport {
  generatedAt:    IsoTimestamp;
  runId:          string;
  actors:         ActorPosture[];
  grantPatterns:  GrantPatternSummary[];
  violations:     PostureViolation[];
}

interface ActorPosture {
  actorId:        Uuid;
  actorClass:     ActorClass;
  owner:          string | null;
  environment:    EnvironmentId;
  grantCount:     number;
  maxRiskSeen:    RiskTier;
  hasOwner:       boolean;
}

interface GrantPatternSummary {
  capabilityId:      string;
  count:             number;
  expiryClasses:     ExpiryClass[];
  externalFacing:    boolean;
  approvalRequired:  boolean;
}

interface PostureViolation {
  type:   'unowned_non_human_actor' | 'broad_scope_detected' | 'missing_review_cadence';
  detail: string;
  actorId: Uuid;
}
```

#### 12.3.33 CompileConfig

```typescript
interface CompileConfig {
  preferFrontierSynthesis: boolean;   // operator preference for Mode 3
}
```

#### 12.3.34 CrossLinkValidationResult

```typescript
interface CrossLinkValidationResult {
  ok:     boolean;
  errors: string[];
}
```

#### 12.3.35 ChainVerificationResult

```typescript
interface ChainVerificationResult {
  ok:          boolean;
  checkedFrom: number;
  checkedTo:   number;
  recordCount: number;
  errors:      ChainError[];
}
```

#### 12.3.36 Error Classes

```typescript
class ApprovalDecisionError extends Error {
  constructor(message: string) { super(message); }
}

class DelegationError extends Error {
  constructor(message: string) { super(message); }
}

class DelegationChainIntegrityError extends Error {
  constructor(missingId: Uuid) {
    super(`Delegation chain broken: parent ${missingId} not found in store`);
  }
}
```

### 12.4 Capability Taxonomy v1.0.0

See resolveCapability in §13.9.1 for resolution logic.

| CapabilityId | Verb | Target Type | ResourceScope | ExternalFacing | DefaultRiskTier |
|---|---|---|---|---|---|
| `read:record:single` | read | any record | single | false | low |
| `read:record:bulk` | read | any record | bulk/collection | false | medium |
| `read:record:pii` | read | pii-tagged | single | false | medium |
| `read:record:bulk:pii` | read | pii-tagged | bulk | false | high |
| `create:record:internal` | create | any record | single | false | medium |
| `create:record:external` | create | any record | single | true | high |
| `update:record:internal` | update | any record | single | false | medium |
| `update:record:external` | update | any record | single | true | high |
| `delete:record` | delete | any record | single | false | high |
| `delete:record:bulk` | delete | any record | bulk | false | critical |
| `send:message:internal` | send | message | single | false | medium |
| `send:message:external` | send | message | single | true | high |
| `publish:content:internal` | publish | content | single | false | medium |
| `publish:content:external` | publish | content | single | true | high |
| `export:data:single` | export | any data | single | false | medium |
| `export:data:bulk` | export | any data | bulk | false | high |
| `export:data:bulk:pii` | export | pii data | bulk | false | critical |
| `execute:query` | execute | query/script | single | false | medium |
| `execute:automation` | execute | workflow/job | single | false | high |
| `write:record:internal` | write | any record | single | false | medium |
| `write:record:external` | write | any record | single | true | high |
| `query:data` | query | any data | single | false | low |
| `search:data` | search | any data | collection | false | low |
| `synthesize:content` | synthesize | content | single | false | medium |
| `transmit:data` | transmit | any data | single | true | high |

---

## 12.5 Governed Lexical Types — Amendment J-S1

All types in this section are defined in `packages/contracts/src/lexicon/governed-verb-lexicon.ts`.
These types are build-time and fixture contracts only. Runtime code loads only the generated
governed lexical fixture — never WordNet source files.

```typescript
// ─── Lexical alias candidate — build-time only ───
// Produced by scripts/build-wordnet-lexicon.ts from WordNet source data.
// Never used at runtime. Stored only in fixtures/lexicon/wordnet-candidate-aliases.v1.json.
export interface LexicalAliasCandidate {
  rawTerm:                 string;
  candidateCanonicalVerb:  string;
  source:                  'wordnet';
  relation:                'synonym' | 'troponym' | 'hypernym' | 'derivational' | 'related';
  confidenceClass:         'direct' | 'near' | 'ambiguous';
  sourceVersion:           string;
}

// ─── Governed verb alias rule — runtime law ───
// Produced by applying governance override files to LexicalAliasCandidates.
// Stored in fixtures/lexicon/governed-verb-lexicon.v1.json.
// This is the runtime authority artifact for lexical resolution.
export interface GovernedVerbAliasRule {
  rawTerm:        string;
  canonicalVerb:  string | null;
  decision:       'approve' | 'forbid' | 'hard_separate' | 'review_required';
  rationale:      string;
  source:         'governance_override';
}

// ─── Governed verb lexicon — the runtime fixture ───
// The complete versioned output of the build-time lexicon generation pipeline.
// Runtime resolver loads this file only. WordNet is never consulted at runtime.
export interface GovernedVerbLexicon {
  lexiconVersion:              string;
  canonicalVerbTaxonomyVersion: string;
  wordnetSourceVersion:        string;
  generatedAt:                 string;
  approved:    Record<string, string>;    // rawTerm → canonicalVerb
  forbidden:   Record<string, string[]>;  // canonicalVerb → forbidden raw terms
  hardSeparated: Record<string, string[]>; // canonicalVerb → hard-separated raw terms
  reviewRequired: string[];               // raw terms requiring operator review
}
```

---

## 13. NXS Gate Implementations

All gate implementations live in
`packages/core/src/gates/`. Pipeline orchestrator in `packages/core/src/engine/pipeline.ts`.

### 13.1 Pipeline Orchestrator

See §8.2 for the full pipeline branch law and pseudo-code. The orchestrator is an
explicit stateful control-flow branch — NOT a generic gate loop. Full implementation
in `packages/core/src/engine/pipeline.ts`.

Invariants enforced by this structure:
- Gate 05 is never invoked on ALLOW paths
- Gate 05 is invoked at most once per action
- Gate 06 is never invoked before Gate 04 passes
- Gate 06 is never invoked on approval-required paths without a resolved ApprovalResponse
- Gate 07 runs exactly once per action regardless of all upstream outcomes

The pipeline process() function implements the exact branch structure shown in §8.2.
Gate 07 is extracted into a runGate07() helper to prevent duplication across branch paths.

### 13.2 Gate 01 — Identity

Gate 01 resolves the runtime identity tuple: Actor, Principal, Session, DelegationContext.
Gate 01 also loads the actor's OCT level for Gate 02 ceiling enforcement.

```typescript
async function evaluateIdentity(
  action:  AgentAction,
  context: PipelineContext,
  _prior:  GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  const actor = await actorRegistry.get(action.actorId);
  if (!actor) return gateDeny(GATE_ID.G01, 1, DENIAL_CODE.ACTOR_NOT_REGISTERED,
    'actor not registered', startMs);

  // SessionStore.get() returns the session regardless of expiry.
  // Gate 01 owns the expiry check — the store does not filter by expiry.
  const session = await sessionStore.get(action.sessionId);
  if (!session) return gateDeny(GATE_ID.G01, 1, DENIAL_CODE.SESSION_NOT_FOUND,
    'session not found', startMs);
  if (new Date(session.expiresAt) <= new Date()) return gateDeny(GATE_ID.G01, 1,
    DENIAL_CODE.SESSION_EXPIRED, 'session expired', startMs);

  const principal = await principalRegistry.get(action.principalId);
  if (!principal) return gateDeny(GATE_ID.G01, 1, DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE,
    'principal not resolvable', startMs);
  if (actor.principalId !== principal.principalId) return gateDeny(GATE_ID.G01, 1,
    DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH, 'actor/principal mismatch', startMs);

  const isNonHuman = actor.actorClass !== ACTOR_CLASS.HUMAN &&
                     actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;
  if (isNonHuman && (!actor.owner || !actor.purpose || !actor.reviewCadence)) {
    return gateDeny(GATE_ID.G01, 1, DENIAL_CODE.NON_HUMAN_ACTOR_INCOMPLETE,
      'non-human actor registry incomplete', startMs);
  }

  context.actor     = actor;
  context.principal = principal;
  return gatePass(GATE_ID.G01, 1, startMs);
}
```

### 13.3 Gate 02 — Classification

Gate 02 normalizes verb, resolves target, classifies data, resolves capability, computes
risk tier. v1.4.12 addition: OCT risk ceiling enforcement after risk tier computation.

```typescript
async function evaluateClassification(
  action:  AgentAction,
  context: PipelineContext,
  _prior:  GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  const verb = verbNormalizer.normalize(action.rawVerb);
  if (!verb) return gateDeny(GATE_ID.G02, 2, DENIAL_CODE.UNRESOLVABLE_VERB,
    'unresolvable action verb', startMs);

  // targetNormalizer uses context.actor.environment as authoritative environment source.
  // Adapter-provided environment is never trusted (§19.5).
  const target = targetNormalizer.normalize(
    action.rawTarget, action.tool, context.actor.environment
  );
  if (!target) return gateDeny(GATE_ID.G02, 2, DENIAL_CODE.UNRESOLVABLE_TARGET,
    'unresolvable target', startMs);

  const dataClasses  = dataClassifier.classify(action.intent, target, verb);
  const capabilityId = resolveCapability(verb, target, dataClasses);
  if (!capabilityId) return gateDeny(GATE_ID.G02, 2, DENIAL_CODE.UNRESOLVABLE_CAPABILITY,
    'unresolvable capability', startMs);

  const riskTier = computeRiskTier(capabilityId, dataClasses, target.environment, target.externalFacing);

  // v1.4.12: OCT risk ceiling enforcement
  const octCeiling = OCT_CEILINGS[context.actor.octLevel];
  if (octCeiling) {
    // OCT-COMPILE: sentinel actionRiskCeiling — deny all system actions
    if (octCeiling.actionRiskCeiling === EVIDENCE_SENTINEL) {
      return gateDeny(GATE_ID.G02, 2, DENIAL_CODE.RISK_CEILING_EXCEEDED,
        'OCT-COMPILE actors may not execute system actions', startMs);
    }
    if (riskTierExceeds(riskTier, octCeiling.actionRiskCeiling as RiskTier)) {
      return gateDeny(GATE_ID.G02, 2, DENIAL_CODE.RISK_CEILING_EXCEEDED,
        `risk tier ${riskTier} exceeds OCT ceiling ${octCeiling.actionRiskCeiling}`, startMs);
    }
  }

  return {
    decision: gatePass(GATE_ID.G02, 2, startMs).decision,
    actionMutations: {
      resolvedVerb:        verb,
      resolvedCapability:  capabilityId,
      resolvedTarget:      target,
      resolvedDataClasses: dataClasses,
      resolvedRiskTier:    riskTier,
    },
  };
}
```

Classification sub-component interfaces (all in `packages/core/src/classification/`):

```typescript
interface VerbNormalizer {
  normalize(rawVerb: string): ActionVerb | null;
}

interface TargetNormalizer {
  normalize(rawTarget: string, tool: string, actorEnvironment: EnvironmentId): ResourceTarget | null;
}

interface DataClassifier {
  classify(intent: IntentContext, target: ResourceTarget, verb: ActionVerb): DataClass[];
}
```

Risk tier computation: see §13.9.2 `computeRiskTier`.
Capability resolution: see §13.9.1 `resolveCapability`.

#### 13.3.1 Gate 02 Lexical Resolver Law — Amendment J-S1

`verbNormalizer.normalize()` shall resolve raw verb input in this exact order:

1. **Exact governed verb match** — raw verb is already a member of the canonical ACTION_VERB set.
2. **Exact approved alias match** — raw verb matches an approved entry in the governed lexical
   fixture (`fixtures/lexicon/governed-verb-lexicon.v1.json`).
3. **Tool or endpoint deterministic override** — specific tool name or endpoint maps to a
   canonical verb by explicit override rule.
4. **Hard-separated or forbidden alias check** — raw verb is in the hard-separated or forbidden
   set; emit `UNRESOLVABLE_VERB` denial. Do not collapse.
5. **Unresolved result** — no match found; emit `UNRESOLVABLE_VERB` denial. Do not guess.

Gate 02 shall never call WordNet source files directly at runtime.
Gate 02 shall never infer a canonical verb from semantic similarity alone.
Ambiguous lexical cases must emit a denial — never a guess.

The following distinctions are governance-significant and must never be collapsed by the
lexical resolver under any circumstances:

- `search` vs `read`
- `query` vs `execute`
- `send` vs `publish`
- `publish` vs `transmit`

Additional hard separations may be added to `config/lexicon/governed-verb-hard-separations.v1.yaml`
without engine rewrite.

The `LexicalVerbResolver` is implemented in
`packages/core/src/classification/lexical-verb-resolver.ts`. It loads only the governed
lexical fixture at startup. It does not accept WordNet source file paths.

```typescript
interface LexicalVerbResolver {
  // Returns canonicalVerb if deterministically resolved, null if unresolvable.
  // Never throws on ambiguity — returns null.
  resolve(rawVerb: string): ActionVerb | null;
}
```

### 13.4 Gate 03 — Delegation

Verifies delegation signature, expiry, scope ceilings, environment match, chain depth,
propagation permission, and chain integrity.

```typescript
async function evaluateDelegation(
  action:  AgentAction,
  context: PipelineContext,
  _prior:  GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();
  const dc      = context.delegationContext;

  const { signature, ...body } = dc;
  if (!await verify(canonicalize(body), signature, controlPlanePublicKey)) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.DELEGATION_SIG_INVALID,
      'delegation signature invalid', startMs);
  }

  if (new Date(dc.expiresAt) <= new Date()) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.DELEGATION_EXPIRED,
      'delegation expired', startMs);
  }

  if (!dc.allowedCapabilities.includes(action.resolvedCapability!)) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.CAPABILITY_NOT_IN_DELEGATION,
      'capability not in delegation', startMs);
  }

  if (dc.forbiddenCapabilities.includes(action.resolvedCapability!)) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.CAPABILITY_FORBIDDEN,
      'capability explicitly forbidden', startMs);
  }

  if (!dc.allowedSystems.includes(action.resolvedTarget!.system)) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.SYSTEM_NOT_IN_DELEGATION,
      'system not in delegation', startMs);
  }

  if (riskTierExceeds(action.resolvedRiskTier!, dc.maxRiskTier)) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.RISK_TIER_EXCEEDS_CEILING,
      'risk tier exceeds delegation ceiling', startMs);
  }

  if (context.actor.actorClass === ACTOR_CLASS.DELEGATED_SUBAGENT &&
      dc.chainDepth >= dc.maxChainDepth) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.CHAIN_DEPTH_EXCEEDED,
      'chain depth ceiling exceeded', startMs);
  }

  if (dc.parentDelegationId !== null && !dc.allowDownstreamPropagation) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.PROPAGATION_NOT_PERMITTED,
      'downstream propagation not permitted', startMs);
  }

  // Environment must match — blueprint §17.3 law
  if (action.resolvedTarget!.environment !== dc.environment) {
    return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.ENVIRONMENT_MISMATCH,
      `environment mismatch: delegation scoped to ${dc.environment}, ` +
      `action targets ${action.resolvedTarget!.environment}`, startMs);
  }

  // Build delegation snapshot — throws DelegationChainIntegrityError if parent missing
  let delegationSnapshot: DelegationContextSnapshot;
  try {
    delegationSnapshot = await buildDelegationSnapshotFromChain(dc, context.delegationStore);
  } catch (err) {
    if (err instanceof DelegationChainIntegrityError) {
      return gateDeny(GATE_ID.G03, 3, DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        err.message, startMs);
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

Evaluates policy bundle, finds first matching rule in priority order, determines
OutcomeLabel, computes ExecutionGrantTemplate. Default-deny on no match.
Gate 04 is the single authoritative point for grant template computation (MODULAR-008).

```typescript
async function evaluatePolicy(
  action:  AgentAction,
  context: PipelineContext,
  _prior:  GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  if (!context.policyFile) {
    return gateDeny(GATE_ID.G04, 4, DENIAL_CODE.DEFAULT_DENY,
      'no valid policy bundle loaded', startMs);
  }

  const envelope = {
    actorClass:     context.actor.actorClass,
    capability:     action.resolvedCapability!,
    verb:           action.resolvedVerb!,
    riskTier:       action.resolvedRiskTier!,
    dataClasses:    action.resolvedDataClasses,
    environment:    action.resolvedTarget!.environment,
    externalFacing: action.resolvedTarget!.externalFacing,
    chainDepth:     context.delegationContext.chainDepth,
  };

  const matchedRule  = context.policyFile.sortedRules.find(r => matchesCondition(r.conditions, envelope));
  const outcome      = matchedRule?.outcome ?? OUTCOME_LABEL.DENY;
  const policyRuleId = matchedRule?.ruleId  ?? 'default_deny';

  if (outcome === OUTCOME_LABEL.DENY) {
    return gateDeny(GATE_ID.G04, 4, DENIAL_CODE.POLICY_DENY,
      `policy deny: rule ${policyRuleId}`, startMs, policyRuleId);
  }

  const template = buildGrantTemplate(action, matchedRule, context);

  return {
    decision: {
      gateId: GATE_ID.G04, gateOrder: 4, plane: 'control',
      outcome, reason: `policy rule matched: ${policyRuleId}`,
      denialCode: null, policyRuleId,
      evaluatedAt: nowIso(), durationMs: Date.now() - startMs, metadata: {},
    },
    grantTemplate: template,
  };
}
```

### 13.6 Gate 05 — Approval

Packages ApprovalRequest, dispatches to channel, awaits signed response, verifies
approver signature. Timeout always produces DENY. System-generated timeout responses
never reach external verification. ApprovalConfig.channelId (string, not array).

```typescript
async function evaluateApproval(
  action:  AgentAction,
  context: PipelineContext,
  _prior:  GateDecision[]
): Promise<GateResult> {
  const startMs      = Date.now();
  const template     = context.grantTemplate!;
  const approvalConfig = template.approvalConfig;

  if (!approvalConfig) {
    return gateDeny(GATE_ID.G05, 5, DENIAL_CODE.APPROVAL_CONFIG_MISSING,
      'approval required but template carries no config', startMs);
  }

  let diff: string | null = null;
  const connector = context.connectorRegistry.get(action.resolvedTarget!.system);
  if (connector?.canProduceDiff()) {
    try {
      diff = await connector.produceDiff!(action, template);
      if (diff && diff.length > 2000) diff = diff.slice(0, 2000) + '...[TRUNCATED]';
    } catch { diff = null; }
  }

  const requestBody = await buildApprovalRequest(action, template, context, diff);
  const sig         = await sign(canonicalize(requestBody), controlPlaneKey);
  const signedRequest: ApprovalRequest = { ...requestBody, signature: sig };

  const channelId = approvalConfig.channelId;
  const channel   = context.channelRegistry.get(channelId);
  if (!channel) {
    return gateDeny(GATE_ID.G05, 5, DENIAL_CODE.APPROVAL_CHANNEL_NOT_FOUND,
      `channel ${channelId} not registered`, startMs);
  }

  await channel.dispatch(signedRequest);

  const timeoutMs = approvalConfig.timeoutSeconds * 1000;
  const response  = await channel.awaitDecision(signedRequest.approvalId, timeoutMs);

  if (!response) {
    const timeoutResponse: ApprovalResponse = {
      approvalId: signedRequest.approvalId,
      decision:   APPROVAL_DECISION_LABEL.TIMED_OUT,
      decidedBy:  'system:timeout',
      decidedAt:  nowIso(),
      channel:    channelId,
      note:       null,
      signature:  '<none>',
    };
    return gateDenyWithApproval(GATE_ID.G05, 5, DENIAL_CODE.APPROVAL_TIMEOUT,
      'approval timed out', startMs, signedRequest, timeoutResponse);
  }

  if (!await verifyApproverSignature(response, context.approverRegistry)) {
    return gateDenyWithApproval(GATE_ID.G05, 5, DENIAL_CODE.APPROVAL_SIG_INVALID,
      'approval response signature invalid', startMs, signedRequest, response);
  }

  if (response.decision === APPROVAL_DECISION_LABEL.DENIED) {
    return gateDenyWithApproval(GATE_ID.G05, 5, DENIAL_CODE.APPROVAL_DENIED_BY_HUMAN,
      'approval denied by human', startMs, signedRequest, response);
  }

  template.approvalLinkage = signedRequest.approvalId;

  return {
    decision: {
      gateId: GATE_ID.G05, gateOrder: 5, plane: 'control',
      outcome: 'pass', reason: `approval granted by ${response.decidedBy}`,
      denialCode: null, policyRuleId: null, evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs, metadata: {},
    },
    approvalRequest:  signedRequest,
    approvalResponse: response,
  };
}
```

### 13.7 Gate 06 — Execution

Control: assertTemplateIntegrity, mintGrant. Data: connector.redeemGrant,
connector.execute. NexusSecurityViolation caught separately from generic errors.
Grant secret cleared in finally block.

```typescript
async function evaluateExecution(
  action:  AgentAction,
  context: PipelineContext,
  _prior:  GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();
  const template = context.grantTemplate!;

  // === CONTROL PLANE: Verify template integrity and mint grant ===
  assertTemplateIntegrity(template);
  const grant = await mintGrant(action, template, context.approvalRequest ?? null);

  // From this point forward, grant is minted. ALL return paths must include `grant`
  // in the GateResult so Gate 07 can populate grant metadata per §34.4.
  // Grant secret must be cleared on ALL paths (even error).

  try {
    // === DATA PLANE: Connector forwarding ===
    const connector = context.connectorRegistry.get(action.resolvedTarget!.system);
    if (!connector) {
      return {
        decision: gateError(GATE_ID.G06, 6, DENIAL_CODE.CONNECTOR_NOT_REGISTERED,
          'connector not registered for system: ' + action.resolvedTarget!.system, startMs).decision,
        grant,  // grant was minted — evidence must reflect this
      };
    }
    if (!connector.supportedCapabilities().includes(action.resolvedCapability!)) {
      return {
        decision: gateError(GATE_ID.G06, 6, DENIAL_CODE.CONNECTOR_CAP_UNSUPPORTED,
          'connector does not support capability: ' + action.resolvedCapability!, startMs).decision,
        grant,
      };
    }

    await connector.redeemGrant(grant);

    let executionResult: ExecutionResult;
    try {
      executionResult = await connector.execute(action, grant);
    } catch (err) {
      if (err instanceof NexusSecurityViolation) {
        const threatEvent: ThreatEvent = {
          threatType: 'security_violation',
          detectedAt: nowIso(),
          gateId:     GATE_ID.G06,
          detail:     `Security violation in connector execution: ${err.message}`.slice(0, 300),
        };
        context.threatLog.push(threatEvent);
        return {
          decision: {
            gateId: GATE_ID.G06, gateOrder: 6, plane: 'data',
            outcome: 'deny', reason: err.message,
            denialCode: err.denialCode, policyRuleId: null,
            evaluatedAt: nowIso(), durationMs: Date.now() - startMs,
            metadata: { violationType: err.violationType },
          },
          grant,  // grant was minted — denied_threat path still has grant metadata
        };
      }
      executionResult = {
        grantId: grant.grantId, executedAt: nowIso(),
        status: 'failure', responseCode: null, durationMs: 0,
        redactedSummary: null,
        errorType: 'connector_execution_error',
        errorMessage: sanitizeError(err),
      };
    }

    return {
      decision: {
        gateId: GATE_ID.G06, gateOrder: 6, plane: 'data',
        outcome: executionResult!.status === 'failure' ? 'error' : 'pass',
        reason: `connector execution: ${executionResult!.status}`,
        denialCode: null, policyRuleId: null, evaluatedAt: nowIso(),
        durationMs: Date.now() - startMs,
        metadata: { connectorStatus: executionResult!.status },
      },
      grant,
      executionResult: executionResult!,
    };
  } finally {
    // Grant secret cleared on ALL paths — connector error, security violation,
    // connector not found, capability unsupported
    clearGrantSecret(grant);
  }
}
```

### 13.8 Gate 07 — Evidence

```typescript
async function evaluateEvidence(
  action:  AgentAction,
  context: PipelineContext,
  priorDecisions: GateDecision[]
): Promise<GateResult> {
  const startMs = Date.now();

  const finalOutcome = computeFinalOutcome(priorDecisions);
  const actionSummary = buildRedactedActionSummary(action, context.actor);
  const intentEvidence = buildIntentEvidence(action.intent);

  const delegationSnapshot = context.delegationSnapshot
    ?? buildMinimalDelegationSnapshot(context.delegationContext);

  // Redact execution result
  const executionResult = context.executionResult
    ? redactExecutionResult(context.executionResult, action.resolvedDataClasses)
    : null;

  // Build grant metadata with sentinel applicability (§34)
  // grantMetadata is ALWAYS present — sentinel-encoded when no grant was minted
  const grantMetadata: ExecutionGrantMetadata = context.executionGrant
    ? buildGrantMetadata(context.executionGrant, context.grantTemplate!)
    : buildSentinelGrantMetadata();

  // Sentinel-aware field population (see §34)
  const policyDecision = priorDecisions.find(d => d.gateId === GATE_ID.G04);
  const policyRuleId = policyDecision?.policyRuleId ?? EVIDENCE_SENTINEL;
  const policyOutcome = policyDecision
    ? (policyDecision.outcome as OutcomeLabel)
    : EVIDENCE_SENTINEL;
  const approvalRequired = context.grantTemplate
    ? context.grantTemplate.approvalRequired
    : EVIDENCE_SENTINEL;
  const approvalDecisionLabel = context.approvalResponse
    ? context.approvalResponse.decision
    : EVIDENCE_SENTINEL;

  // Ledger sequence
  const previousSeq = await ledgerBackend.getLatestSequence();
  const ledgerSequence = previousSeq + 1;
  const prevRecord = previousSeq > 0
    ? await ledgerBackend.getBySequence(previousSeq)
    : null;
  const previousHash = prevRecord?.recordHash ?? GENESIS_HASH;

  // Build record body (without compilerView, recordHash, signature)
  const recordBody = {
    recordId: uuid(),
    actionId: action.actionId,
    sessionId: action.sessionId,
    runId: action.runId,
    ledgerSequence,
    actionSummary,
    intentEvidence,
    delegationContextSnapshot: delegationSnapshot,
    gateDecisions: priorDecisions,
    policyRuleId,
    policyOutcome,
    approvalRequired,
    approvalRequest: context.approvalRequest ?? null,
    approvalResponse: context.approvalResponse ?? null,
    approvalDecisionLabel,
    grantMetadata,
    executionResult,
    finalOutcome,
    threatEvents: context.threatLog,
    previousHash,
  };

  // CCV materialized inside signed body
  const compilerView = buildCCV(recordBody, context);

  // Hash over full body including CCV
  const fullBody = { ...recordBody, compilerView };
  const recordHash = sha256(canonicalize(fullBody));
  const signature = await sign(recordHash, controlPlaneKey);

  const record: EvidenceRecord = { ...fullBody, recordHash, signature };

  // Append to ledger
  await ledgerBackend.append(record);
  context.lastEvidenceRecord = record;

  return {
    decision: {
      gateId: GATE_ID.G07, gateOrder: 7, plane: 'control',
      outcome: 'pass', reason: `evidence recorded: ${finalOutcome}`,
      denialCode: null, policyRuleId: null,
      evaluatedAt: nowIso(), durationMs: Date.now() - startMs, metadata: {},
    },
  };
}
```

### 13.9 Gate Implementation Helpers

All helpers defined in `packages/core/src/utils/helpers.ts` unless noted otherwise.

**13.9.1** resolveCapability:

```typescript
function resolveCapability(verb: ActionVerb, target: ResourceTarget, dataClasses: DataClass[]): string | null {
  const hasPii = dataClasses.some(dc => dc === DATA_CLASS.PII || dc === DATA_CLASS.PHI);
  const isBulk = target.resourceScope === 'bulk' || target.resourceScope === 'collection';
  const isExt  = target.externalFacing;
  if (verb === ACTION_VERB.READ) {
    if (hasPii && isBulk) return 'read:record:bulk:pii';
    if (hasPii)           return 'read:record:pii';
    if (isBulk)           return 'read:record:bulk';
    return 'read:record:single';
  }
  if (verb === ACTION_VERB.CREATE)     return isExt ? 'create:record:external'  : 'create:record:internal';
  if (verb === ACTION_VERB.UPDATE)     return isExt ? 'update:record:external'  : 'update:record:internal';
  if (verb === ACTION_VERB.DELETE)     return isBulk ? 'delete:record:bulk'     : 'delete:record';
  if (verb === ACTION_VERB.SEND)       return isExt ? 'send:message:external'   : 'send:message:internal';
  if (verb === ACTION_VERB.PUBLISH)    return isExt ? 'publish:content:external': 'publish:content:internal';
  if (verb === ACTION_VERB.EXPORT) {
    if (hasPii && isBulk) return 'export:data:bulk:pii';
    if (isBulk)           return 'export:data:bulk';
    return 'export:data:single';
  }
  if (verb === ACTION_VERB.EXECUTE) {
    if (target.resourceType === 'automation' || target.resourceType === 'workflow') return 'execute:automation';
    return 'execute:query';
  }
  // v1.4.12 additions:
  if (verb === ACTION_VERB.WRITE)      return isExt ? 'write:record:external'  : 'write:record:internal';
  if (verb === ACTION_VERB.QUERY)      return 'query:data';
  if (verb === ACTION_VERB.SEARCH)     return 'search:data';
  if (verb === ACTION_VERB.SYNTHESIZE) return 'synthesize:content';
  if (verb === ACTION_VERB.TRANSMIT)   return 'transmit:data';
  return null;
}
```

**13.9.2** computeRiskTier:

```typescript
function computeRiskTier(capabilityId: string, dataClasses: DataClass[],
  environment: EnvironmentId, externalFacing: boolean): RiskTier {
  const capEntry = capabilityRegistry.get(capabilityId);
  let tier = capEntry.defaultRiskTier;
  if (dataClasses.some(dc => dc === DATA_CLASS.PII || dc === DATA_CLASS.PHI || dc === DATA_CLASS.FINANCIAL)) {
    tier = elevateRiskTier(tier, RISK_TIER.MEDIUM);
  }
  if (environment === ENVIRONMENT_ID.PRODUCTION) tier = elevateRiskTier(tier, RISK_TIER.MEDIUM);
  if (externalFacing)                            tier = elevateRiskTier(tier, RISK_TIER.HIGH);
  return tier;
}
function elevateRiskTier(current: RiskTier, minimum: RiskTier): RiskTier {
  return RISK_TIER_ORDER.indexOf(current) >= RISK_TIER_ORDER.indexOf(minimum) ? current : minimum;
}
```

**13.9.3** buildActionSummaryText:

```typescript
function buildActionSummaryText(action: AgentAction): string {
  const verb   = action.resolvedVerb ?? action.rawVerb;
  const target = action.resolvedTarget && action.resolvedTarget !== EVIDENCE_SENTINEL
    ? `${action.resolvedTarget.system}/${action.resolvedTarget.resourceType}`
    : action.rawTarget;
  const scope  = (action.resolvedTarget && action.resolvedTarget !== EVIDENCE_SENTINEL)
    ? action.resolvedTarget.resourceScope : 'single';
  const ext    = (action.resolvedTarget && action.resolvedTarget !== EVIDENCE_SENTINEL
    && action.resolvedTarget.externalFacing) ? ' (external)' : '';
  return `${verb} ${target} [${scope}]${ext}`;
}
```

**13.9.4** computeEstimatedImpact:

```typescript
function computeEstimatedImpact(riskTier: RiskTier, dataClasses: DataClass[],
  target: ResourceTarget): NonEmpty {
  const parts: string[] = [`${riskTier.toUpperCase()} risk`];
  if (target.externalFacing) parts.push('external-facing');
  if (target.resourceScope === 'bulk' || target.resourceScope === 'collection') parts.push('bulk operation');
  if (dataClasses.length > 0) parts.push(`data: ${[...dataClasses].sort().join(', ')}`);
  return parts.join(' | ');
}
```

**13.9.5** buildApprovalRequest (Gate 05):

```typescript
async function buildApprovalRequest(action: AgentAction, template: ExecutionGrantTemplate,
  context: PipelineContext, diff: string | null): Promise<Omit<ApprovalRequest, 'signature'>> {
  const issuedAt  = nowIso();
  const expiresAt = addSeconds(issuedAt, template.approvalConfig!.timeoutSeconds);
  return {
    approvalId: uuid(), actionId: action.actionId, templateId: template.templateId,
    issuedAt, expiresAt,
    actionSummary:        buildActionSummaryText(action).slice(0, 300),
    contextSummary:       action.intent.objectiveSummary.slice(0, 500),
    proposedTarget:       action.resolvedTarget! as ResourceTarget,
    diff,
    estimatedImpact:      computeEstimatedImpact(action.resolvedRiskTier!, action.resolvedDataClasses as DataClass[], action.resolvedTarget! as ResourceTarget),
    principalDisplayName: context.principal.displayName,
    actorDisplayName:     context.actor.displayName,
    riskTier:             action.resolvedRiskTier!,
    dataClasses:          action.resolvedDataClasses as DataClass[],
    modelConfidence:      action.intent.modelConfidence,
    riskNote:             action.intent.riskNote,
  };
}
```

**13.9.6-13.9.8** resolveCredentialSubjectType, buildScopeDescriptor, resolveCredentialSubject:

```typescript
function resolveCredentialSubjectType(actorClass: ActorClass, _system: string):
  'user_identity' | 'service_identity' | 'federated' {
  if (actorClass === ACTOR_CLASS.HUMAN || actorClass === ACTOR_CLASS.HUMAN_WITH_COPILOT) return 'user_identity';
  return 'service_identity';
}

function buildScopeDescriptor(capabilityId: string, target: ResourceTarget,
  hint: GrantTemplateHint | null | undefined): NonEmpty {
  const base = `${capabilityId}@${target.system}:${target.resourceType}:${target.resourceScope}`;
  const ext  = (hint?.allowExternalFacing || target.externalFacing) ? ':external' : '';
  return base + ext;
}

function resolveCredentialSubject(template: ExecutionGrantTemplate,
  action: AgentAction): CredentialSubject {
  const subjectType = template.credentialSubjectType as CredentialSubject['subjectType'];
  return {
    subjectId:   subjectType === 'user_identity' ? action.actorId : `svc:${action.actorId}`,
    subjectType,
    system:      (action.resolvedTarget! as ResourceTarget).system,
  };
}
```

**13.9.9** templateFingerprintPayload + assertTemplateIntegrity (Gate 06):

```typescript
function templateFingerprintPayload(
  template: Omit<ExecutionGrantTemplate, 'templateFingerprint' | 'approvalLinkage'>
): Record<string, unknown> {
  return { ...template };
}

function assertTemplateIntegrity(template: ExecutionGrantTemplate): void {
  const { templateFingerprint, approvalLinkage, ...body } = template;
  const expected = sha256(canonicalize(templateFingerprintPayload(body)));
  if (expected !== template.templateFingerprint) {
    throw new NexusSecurityViolation('template_fingerprint_mismatch', DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED);
  }
  if (template.approvalRequired && !template.approvalLinkage) {
    throw new NexusSecurityViolation('approval_required_but_linkage_absent', DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED);
  }
}
```

**13.9.10** buildGrantTemplate (Gate 04):

```typescript
function buildGrantTemplate(action: AgentAction, rule: PolicyRule | undefined,
  context: PipelineContext): ExecutionGrantTemplate {
  const hint        = rule?.grantHint;
  const expiryClass = hint?.expiryClass ?? EXPIRY_CLASS.ACTION_SCOPED;
  const maxExpiry   = EXPIRY_CLASS_SECONDS[expiryClass] ?? 30;
  const resourceBounds: ResourceBounds = {
    allowedResourceTypes: [(action.resolvedTarget! as ResourceTarget).resourceType],
    maxRecords:    hint?.maxRecords ?? 1,
    allowBulk:     hint?.allowBulk ?? false,
    allowExternalFacing: hint?.allowExternalFacing ?? false,
  };
  const dc = context.delegationContext;
  if (!dc.allowedSystems.includes((action.resolvedTarget! as ResourceTarget).system)) {
    throw new NexusSecurityViolation('grant_template_exceeds_delegation_scope', DENIAL_CODE.BROAD_TOKEN_BYPASS);
  }
  const credentialSubjectType = resolveCredentialSubjectType(context.actor.actorClass, (action.resolvedTarget! as ResourceTarget).system);
  const scopeDescriptor       = buildScopeDescriptor(action.resolvedCapability!, action.resolvedTarget! as ResourceTarget, hint);
  const templateBody = {
    templateId: uuid(), actionId: action.actionId, computedAt: nowIso(),
    capabilityId: action.resolvedCapability!, scopeDescriptor, credentialSubjectType,
    resourceBounds, environmentBound: (action.resolvedTarget! as ResourceTarget).environment,
    expiryClass, maxExpirySeconds: maxExpiry,
    approvalRequired: rule?.outcome === OUTCOME_LABEL.REQUIRE_APPROVAL || rule?.outcome === OUTCOME_LABEL.ESCALATE,
    approvalConfig:   rule?.approvalConfig ?? null,
  };
  const templateFingerprint = sha256(canonicalize(templateFingerprintPayload(templateBody)));
  return { ...templateBody, approvalLinkage: null, templateFingerprint };
}
```

**13.9.11** buildIntentEvidence:

```typescript
function buildIntentEvidence(intent: IntentContext): IntentEvidence {
  return {
    objectiveSummary: intent.objectiveSummary, triggeringSource: intent.triggeringSource,
    toolchainContext: intent.toolchainContext, modelId: intent.modelId,
    modelConfidence: intent.modelConfidence, riskNote: intent.riskNote,
  };
}
```

**13.9.12** buildDelegationSnapshotFromChain:

```typescript
class DelegationChainIntegrityError extends Error {
  constructor(missingId: Uuid) {
    super(`Delegation chain broken: parent ${missingId} not found in store`);
  }
}

async function buildDelegationSnapshotFromChain(dc: DelegationContext,
  store: DelegationStore): Promise<DelegationContextSnapshot> {
  const ancestors: Uuid[] = [];
  let current = dc;
  while (current.parentDelegationId !== null) {
    ancestors.unshift(current.parentDelegationId);
    const parent = await store.getById(current.parentDelegationId);
    if (!parent) throw new DelegationChainIntegrityError(current.parentDelegationId);
    current = parent;
  }
  return {
    delegationId: dc.delegationId, principalId: dc.principalId, actorId: dc.actorId,
    chainDepth: dc.chainDepth, chainAncestors: ancestors,
    chainHash: sha256(canonicalize([dc.delegationId, ...ancestors])),
    allowedSystems: dc.allowedSystems, maxRiskTier: dc.maxRiskTier,
    environment: dc.environment, expiresAt: dc.expiresAt,
  };
}

function buildMinimalDelegationSnapshot(dc: DelegationContext): DelegationContextSnapshot {
  return {
    delegationId: dc.delegationId, principalId: dc.principalId, actorId: dc.actorId,
    chainDepth: dc.chainDepth, chainAncestors: [],
    chainHash: sha256(canonicalize([dc.delegationId])),
    allowedSystems: dc.allowedSystems, maxRiskTier: dc.maxRiskTier,
    environment: dc.environment, expiresAt: dc.expiresAt,
  };
}
```

**13.9.13** buildRedactedActionSummary:

```typescript
function buildRedactedActionSummary(action: AgentAction, actor: Actor): EvidenceRecord['actionSummary'] {
  return {
    actionId: action.actionId, receivedAt: action.receivedAt, protocol: action.protocol,
    actorId: action.actorId, actorClass: actor.actorClass, actorEnvironment: actor.environment,
    principalId: action.principalId, delegationSequence: action.delegationSequence,
    tool: action.tool,
    resolvedVerb: action.resolvedVerb ?? EVIDENCE_SENTINEL,
    resolvedCapability: action.resolvedCapability ?? EVIDENCE_SENTINEL,
    resolvedTarget: action.resolvedTarget ?? EVIDENCE_SENTINEL,
    resolvedDataClasses: action.resolvedDataClasses.length > 0 ? action.resolvedDataClasses : EVIDENCE_SENTINEL,
    resolvedRiskTier: action.resolvedRiskTier ?? EVIDENCE_SENTINEL,
  };
}
```

**13.9.14** buildGrantMetadata (sentinel-aware):

```typescript
function buildGrantMetadata(
  grant: ExecutionGrant,
  template: ExecutionGrantTemplate
): ExecutionGrantMetadata {
  return {
    grantId:               grant.grantId,
    scopeDescriptor:       grant.scopeDescriptor,
    credentialSubjectId:   grant.credentialSubject.subjectId,
    credentialSubjectType: grant.credentialSubject.subjectType,
    issuedAt:              grant.mintedAt,
    expiresAt:             grant.expiresAt,
    expiryClass:           template.expiryClass,
    templateFingerprint:   template.templateFingerprint,
    approvalLinkage:       grant.approvalId ?? EVIDENCE_SENTINEL,  // sentinel on direct-ALLOW
  };
}

function buildSentinelGrantMetadata(): ExecutionGrantMetadata {
  return {
    grantId:               EVIDENCE_SENTINEL,
    scopeDescriptor:       EVIDENCE_SENTINEL,
    credentialSubjectId:   EVIDENCE_SENTINEL,
    credentialSubjectType: EVIDENCE_SENTINEL,
    issuedAt:              EVIDENCE_SENTINEL,
    expiresAt:             EVIDENCE_SENTINEL,
    expiryClass:           EVIDENCE_SENTINEL,
    templateFingerprint:   EVIDENCE_SENTINEL,
    approvalLinkage:       EVIDENCE_SENTINEL,
  };
}
```

**13.9.15** redactExecutionResult:

```typescript
function redactExecutionResult(result: ExecutionResult, dataClasses: DataClass[]): ExecutionResult {
  let summary = result.redactedSummary;
  if (dataClasses.includes(DATA_CLASS.PHI))            summary = REDACTION_MARKERS.PHI;
  else if (dataClasses.includes(DATA_CLASS.PII))       summary = REDACTION_MARKERS.PII;
  else if (dataClasses.includes(DATA_CLASS.FINANCIAL)) summary = REDACTION_MARKERS.FINANCIAL;
  const errorMessage = result.errorMessage
    ? result.errorMessage.replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED:SECRET]')
    : null;
  return { ...result, redactedSummary: summary, errorMessage };
}
```

**13.9.16** sanitizeError:

```typescript
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return 'connector_unknown_error';
  const msg = err.message
    .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED:SECRET]')
    .slice(0, 500);
  return msg || 'connector_error_no_message';
}
```

**13.9.17** matchesCondition (Gate 04):

```typescript
interface PolicyEvalEnvelope {
  actorClass: ActorClass; capability: string; verb: ActionVerb;
  riskTier: RiskTier; dataClasses: DataClass[]; environment: EnvironmentId;
  externalFacing: boolean; chainDepth: number;
}
function matchesCondition(cond: PolicyCondition, env: PolicyEvalEnvelope): boolean {
  if (cond.actorClasses && !cond.actorClasses.includes(env.actorClass))  return false;
  if (cond.capabilities && !cond.capabilities.includes(env.capability))  return false;
  if (cond.actionVerbs  && !cond.actionVerbs.includes(env.verb))         return false;
  if (cond.riskTiers    && !cond.riskTiers.includes(env.riskTier))       return false;
  if (cond.dataClasses  && !cond.dataClasses.some(dc => env.dataClasses.includes(dc))) return false;
  if (cond.environments && !cond.environments.includes(env.environment)) return false;
  if (cond.externalFacing !== undefined && cond.externalFacing !== env.externalFacing) return false;
  if (cond.maxChainDepth  !== undefined && env.chainDepth > cond.maxChainDepth) return false;
  return true;
}
```

**13.9.18** Gate pass/deny constructors:

```typescript
function gatePass(gateId: GateId, order: number, startMs: number): GateResult {
  return { decision: {
    gateId, gateOrder: order, plane: 'control',
    outcome: 'pass', reason: 'gate passed', denialCode: null,
    policyRuleId: null, evaluatedAt: nowIso(), durationMs: Date.now() - startMs, metadata: {},
  }};
}
function gateDeny(gateId: GateId, order: number, code: DenialCode, reason: string, startMs: number, ruleId?: string): GateResult {
  return { decision: {
    gateId, gateOrder: order, plane: 'control',
    outcome: 'deny', reason, denialCode: code,
    policyRuleId: ruleId ?? null, evaluatedAt: nowIso(), durationMs: Date.now() - startMs, metadata: {},
  }};
}
function gateError(gateId: GateId, order: number, code: DenialCode, reason: string, startMs: number): GateResult {
  return { decision: {
    gateId, gateOrder: order, plane: 'data',
    outcome: 'error', reason, denialCode: code,
    policyRuleId: null, evaluatedAt: nowIso(), durationMs: Date.now() - startMs, metadata: {},
  }};
}
function gateDenyWithApproval(gateId: GateId, order: number, code: DenialCode, reason: string,
  startMs: number, req: ApprovalRequest, resp: ApprovalResponse): GateResult {
  return {
    decision: { gateId, gateOrder: order, plane: 'control', outcome: 'deny', reason,
      denialCode: code, policyRuleId: null, evaluatedAt: nowIso(),
      durationMs: Date.now() - startMs, metadata: {} },
    approvalRequest: req, approvalResponse: resp,
  };
}
```

**13.9.19** NexusSecurityViolation:

```typescript
class NexusSecurityViolation extends Error {
  constructor(
    public readonly violationType: string,
    public readonly denialCode: DenialCode
  ) {
    super(`Security violation [${denialCode}]: ${violationType}`);
  }
}
```

**13.9.20** computeFinalOutcome — maps on denialCode, not reason string:

```typescript
function computeFinalOutcome(decisions: GateDecision[]): FinalOutcome {
  for (const d of [...decisions].reverse()) {
    if (d.outcome === 'pass' || d.outcome === 'allow') continue;
    if (d.outcome === 'error') return FINAL_OUTCOME.ERROR;
    const code = d.denialCode;
    if (code === DENIAL_CODE.APPROVAL_TIMEOUT)   return FINAL_OUTCOME.DENIED_TIMEOUT;
    if (code === DENIAL_CODE.REPLAY_DETECTED     || code === DENIAL_CODE.RATE_LIMIT_EXCEEDED ||
        code === DENIAL_CODE.BROAD_TOKEN_BYPASS  || code === DENIAL_CODE.TEMPLATE_INTEGRITY_FAILED ||
        code === DENIAL_CODE.GRANT_EXPIRED)       return FINAL_OUTCOME.DENIED_THREAT;
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

**13.9.21** getG04Outcome — extracts Gate 04 outcome label from prior decisions (§8.2):

```typescript
function getG04Outcome(priorDecisions: GateDecision[]): string | null {
  const g04 = priorDecisions.find(d => d.gateId === GATE_ID.G04);
  return g04?.outcome ?? null;
}
```

---

## 14. Compiler Comparison View Law

Updated for v1.4.12 sentinel encoding.

### 14.1 CompilerComparisonView Interface

```typescript
interface CompilerComparisonView {
  meta: {
    blueprintVersion:          SemVer;
    runtimeContractVersion:    SemVer;
    capabilityTaxonomyVersion: SemVer;
    comparisonInputVersion:    SemVer;
    normalizedActionHash:      Sha256Hex;
    policyBundleHash:          Sha256Hex;
  };
  identity: {
    actorId: Uuid; actorClass: ActorClass;
    principalId: Uuid; environment: EnvironmentId;
  };
  delegation: {
    delegationContextId: Uuid; chainDepth: number;
    chainHash: Sha256Hex; maxRiskTier: RiskTier;
  };
  classification: {
    capabilityId: string | EvidenceSentinel;
    actionVerb:   ActionVerb | EvidenceSentinel;
    dataClasses:  DataClass[] | EvidenceSentinel;
    riskTier:     RiskTier | EvidenceSentinel;
  };
  policyAndApproval: {
    policyRuleId:          string | EvidenceSentinel;
    outcomeLabel:          OutcomeLabel | EvidenceSentinel;
    approvalRequired:      boolean | EvidenceSentinel;
    approvalDecisionLabel: ApprovalDecisionLabel | EvidenceSentinel;
  };
  authorityAndExecution: {
    executionGrantId:         Uuid | EvidenceSentinel;
    credentialSubjectType:    string | EvidenceSentinel;
    scopeDescriptor:          string | EvidenceSentinel;
    expiryClass:              ExpiryClass | EvidenceSentinel;
    grantTemplateFingerprint: Sha256Hex | EvidenceSentinel;
  };
  result: {
    finalOutcome:    FinalOutcome;
    errorCodeFamily: string | null;
  };
}
```

delegationSequence is NOT a CCV field. It is forensic-only in actionSummary.

CCV field definitions are blueprint law (MODULAR-009). CCV schema changes require a
blueprint version bump.

### 14.2 Normalized Action Hash

```typescript
function computeNormalizedActionHash(
  action: EvidenceRecord['actionSummary']
): Sha256Hex {
  // Sentinel-aware: if resolved fields carry sentinel, use sentinel in hash input.
  // This ensures pre-classification denials produce a consistent (but distinct) hash.
  const resolvedTarget = action.resolvedTarget;
  const isTargetSentinel = resolvedTarget === EVIDENCE_SENTINEL;

  const normalized = {
    tool:               action.tool,
    resolvedVerb:       action.resolvedVerb,
    resolvedCapability: action.resolvedCapability,
    targetSystem:       isTargetSentinel ? EVIDENCE_SENTINEL : (resolvedTarget as ResourceTarget).system,
    targetResourceType: isTargetSentinel ? EVIDENCE_SENTINEL : (resolvedTarget as ResourceTarget).resourceType,
    targetScope:        isTargetSentinel ? EVIDENCE_SENTINEL : (resolvedTarget as ResourceTarget).resourceScope,
    externalFacing:     isTargetSentinel ? EVIDENCE_SENTINEL : (resolvedTarget as ResourceTarget).externalFacing,
    dataClasses:        action.resolvedDataClasses === EVIDENCE_SENTINEL
                          ? EVIDENCE_SENTINEL
                          : [...(action.resolvedDataClasses as DataClass[])].sort(),
    riskTier:           action.resolvedRiskTier,
  };
  return sha256(canonicalize(normalized));
}
```

### 14.3 CCV Builder

Updated for v1.4.12 sentinel encoding — see §34 for applicability rules.

```typescript
function buildCCV(
  record:  Omit<EvidenceRecord, 'compilerView' | 'recordHash' | 'signature'>,
  context: PipelineContext
): CompilerComparisonView {
  const policyDecision = record.gateDecisions.find(d => d.gateId === GATE_ID.G04);
  const as = record.actionSummary;

  return {
    meta: {
      blueprintVersion:          BLUEPRINT_VERSION,
      runtimeContractVersion:    RUNTIME_CONTRACT_VERSION,
      capabilityTaxonomyVersion: CAPABILITY_TAXONOMY_VERSION,
      comparisonInputVersion:    COMPARISON_INPUT_VERSION,
      normalizedActionHash:      computeNormalizedActionHash(as),
      policyBundleHash:          context.policyFile?.bundleHash ?? sha256(canonicalize('no_policy')),
    },
    identity: {
      actorId:     as.actorId,
      actorClass:  as.actorClass,
      principalId: as.principalId,
      environment: as.actorEnvironment,
    },
    delegation: {
      delegationContextId: record.delegationContextSnapshot.delegationId,
      chainDepth:          record.delegationContextSnapshot.chainDepth,
      chainHash:           record.delegationContextSnapshot.chainHash,
      maxRiskTier:         record.delegationContextSnapshot.maxRiskTier,
    },
    classification: {
      capabilityId: as.resolvedCapability ?? EVIDENCE_SENTINEL,
      actionVerb:   as.resolvedVerb ?? EVIDENCE_SENTINEL,
      dataClasses:  as.resolvedDataClasses === EVIDENCE_SENTINEL
        ? EVIDENCE_SENTINEL
        : [...(as.resolvedDataClasses as DataClass[])].sort(),
      riskTier:     as.resolvedRiskTier ?? EVIDENCE_SENTINEL,
    },
    policyAndApproval: {
      policyRuleId:          record.policyRuleId,
      outcomeLabel:          record.policyOutcome,
      approvalRequired:      record.approvalRequired,
      approvalDecisionLabel: record.approvalDecisionLabel,
    },
    authorityAndExecution: {
      executionGrantId:         record.grantMetadata.grantId,
      credentialSubjectType:    record.grantMetadata.credentialSubjectType,
      scopeDescriptor:          record.grantMetadata.scopeDescriptor,
      expiryClass:              record.grantMetadata.expiryClass,
      grantTemplateFingerprint: record.grantMetadata.templateFingerprint,
    },
    result: {
      finalOutcome:    record.finalOutcome,
      errorCodeFamily: record.executionResult?.errorType ?? null,
    },
  };
}
```

### 14.4 CCV Comparability Law

Comparability law:

```typescript
function areComparable(a: CompilerComparisonView, b: CompilerComparisonView): boolean {
  return (
    a.meta.blueprintVersion          === b.meta.blueprintVersion &&
    a.meta.runtimeContractVersion    === b.meta.runtimeContractVersion &&
    a.meta.capabilityTaxonomyVersion === b.meta.capabilityTaxonomyVersion &&
    a.meta.comparisonInputVersion    === b.meta.comparisonInputVersion &&
    a.identity.actorClass            === b.identity.actorClass &&
    a.identity.environment           === b.identity.environment &&
    a.classification.capabilityId    === b.classification.capabilityId &&
    a.meta.normalizedActionHash      === b.meta.normalizedActionHash
  );
}
```

---

## 15. Crypto Law

### 15.1 Algorithm: Ed25519 + SHA-256. Library: `@noble/ed25519`.

### 15.2 Key Management

```typescript
interface KeyPair {
  publicKey: Base64Url; privateKey: Base64Url;
  generatedAt: IsoTimestamp; purpose: 'control_plane' | 'approver' | 'dev';
}
```

**Control plane key**: `keys/dev.keypair.json` in dev; production uses separate secrets
management. Generated by `scripts/gen-keys.ts`. Gitignored in production.

**Admin token**: `keys/admin.token` — securely generated random string. Created by
`nexus init`. Gitignored always. Required as `Authorization: Bearer <token>` on all
management API routes.

**Approver Key Contract**: Per-approver keypairs at `keys/approvers/<approverId>.keypair.json`.
Directory always gitignored. Keys loaded exclusively by `key-manager.ts` using approverId.

```typescript
// packages/core/src/crypto/key-manager.ts
async function loadApproverKey(approverId: NonEmpty): Promise<KeyPair> {
  const keyPath = path.join('keys', 'approvers', `${approverId}.keypair.json`);
  try {
    const raw  = await fs.readFile(keyPath, 'utf-8');
    const pair = JSON.parse(raw) as KeyPair;
    if (pair.purpose !== 'approver') {
      throw new Error(`key at ${keyPath} has purpose '${pair.purpose}', expected 'approver'`);
    }
    return pair;
  } catch (err) {
    throw new Error(`Approver key not found for approverId '${approverId}': ${(err as Error).message}`);
  }
}

async function loadControlPlaneKey(): Promise<KeyPair> {
  const keyPath = process.env.NEXUS_KEY_PATH ?? path.join('keys', 'dev.keypair.json');
  const raw     = await fs.readFile(keyPath, 'utf-8');
  return JSON.parse(raw) as KeyPair;
}

async function generateApproverKeypair(approverId: NonEmpty): Promise<void> {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey  = await ed25519.getPublicKeyAsync(privateKey);
  const pair: KeyPair = {
    publicKey:    base64urlEncode(publicKey),
    privateKey:   base64urlEncode(privateKey),
    generatedAt:  nowIso(),
    purpose:      'approver',
  };
  const keyPath = path.join('keys', 'approvers', `${approverId}.keypair.json`);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, JSON.stringify(pair, null, 2), 'utf-8');
}
```

Dev key fallback for fixtures/tests only: `keys/dev.keypair.json`. Never used as an
approver key in production paths. Fixture usage must prefix secret values with
`FIXTURE_SYNTHETIC_SECRET:`.

### 15.3 Signature Computation

```typescript
async function sign(payload: string, keyPair: KeyPair): Promise<Base64Url> {
  const msgBytes  = new TextEncoder().encode(payload);
  const privBytes = base64urlDecode(keyPair.privateKey);
  return base64urlEncode(await ed25519.sign(msgBytes, privBytes));
}
async function verify(payload: string, signature: Base64Url, publicKey: Base64Url): Promise<boolean> {
  try {
    return await ed25519.verify(base64urlDecode(signature),
      new TextEncoder().encode(payload), base64urlDecode(publicKey));
  } catch { return false; }
}
```

All callers pass `canonicalize(obj)` as payload. Never raw JSON.stringify.

### 15.4 Hash Computation

```typescript
function sha256(payload: string): Sha256Hex {
  return nodeCrypto.createHash('sha256').update(new TextEncoder().encode(payload)).digest('hex');
}
```

### 15.5 Canonical Serialization — `packages/core/src/crypto/canonicalize.ts`

```typescript
export function canonicalize(val: unknown): string {
  if (val === null)      return 'null';
  if (val === undefined) throw new TypeError(
    'canonicalize: undefined is not a legal canonical value — use null or omit the field');
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map(v => {
      if (v === undefined) throw new TypeError(
        'canonicalize: undefined element in array — use null or remove the element');
      return canonicalize(v);
    }).join(',') + ']';
  }
  const obj  = val as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k]!));
  return '{' + pairs.join(',') + '}';
}
```

`JSON.stringify(obj, Object.keys(obj).sort())` is PROHIBITED throughout the codebase.
All signing/hashing paths must use `canonicalize()`. No payload passed to `canonicalize()`
may contain `undefined` values — use `null` or omit the field.

### 15.6 Utility Functions — `packages/core/src/utils/time.ts`

```typescript
import { randomUUID } from 'crypto';
export function uuid(): Uuid         { return randomUUID(); }
export function nowIso(): IsoTimestamp { return new Date().toISOString(); }
export function addSeconds(iso: IsoTimestamp, seconds: number): IsoTimestamp {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 16. NXS Ledger Law

### 16.1 JSONL Backend (Backend v1)

JSONL is an architecture version designation (MODULAR-003).
`packages/core/src/ledger/backends/jsonl.backend.ts`.

```typescript
class JsonlLedgerBackend implements LedgerBackend {
  readonly backendId = 'jsonl-v1'; readonly backendVersion = 'v1.0.0';
  constructor(private readonly ledgerPath: string) {}

  async append(record: EvidenceRecord): Promise<void> {
    await fs.appendFile(this.ledgerPath, JSON.stringify(record) + '\n', 'utf-8');
  }

  async listRange(from: number, to: number): Promise<EvidenceRecord[]> {
    const results: EvidenceRecord[] = [];
    let raw: string;
    try { raw = await fs.readFile(this.ledgerPath, 'utf-8'); } catch { return []; }
    for (const line of raw.split('\n').filter(Boolean)) {
      let record: EvidenceRecord;
      try { record = JSON.parse(line) as EvidenceRecord; } catch { continue; }
      if (record.ledgerSequence >= from && record.ledgerSequence <= to) results.push(record);
    }
    return results;
  }

  async getBySequence(seq: number): Promise<EvidenceRecord | null> {
    return (await this.listRange(seq, seq))[0] ?? null;
  }

  async getByRecordId(recordId: Uuid): Promise<EvidenceRecord | null> {
    let raw: string;
    try { raw = await fs.readFile(this.ledgerPath, 'utf-8'); } catch { return null; }
    for (const line of raw.split('\n').filter(Boolean)) {
      let record: EvidenceRecord;
      try { record = JSON.parse(line) as EvidenceRecord; } catch { continue; }
      if (record.recordId === recordId) return record;
    }
    return null;
  }

  async getLatestSequence(): Promise<number> {
    let raw: string;
    try { raw = await fs.readFile(this.ledgerPath, 'utf-8'); } catch { return 0; }
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return 0;
    try { return (JSON.parse(lines[lines.length - 1]!) as EvidenceRecord).ledgerSequence; }
    catch { return 0; }
  }
}
```

### 16.2 Chain Integrity Verifier

Enforces hash linkage AND sequence continuity. SEQUENCE_ANOMALY emitted for any gap
or regression. O(n) verification via listRange.

```typescript
interface ChainError {
  seq:        number;
  type:      'hash_chain_break' | 'signature_invalid' | 'sequence_anomaly';
  denialCode: DenialCode;
  detail:     string;
}

async function verifyChain(
  backend: LedgerBackend, fromSeq: number, toSeq: number, publicKey: Base64Url
): Promise<ChainVerificationResult> {
  const errors:  ChainError[] = [];
  const records  = await backend.listRange(fromSeq, toSeq);
  let prevHash   = fromSeq === 1
    ? GENESIS_HASH
    : (await backend.getBySequence(fromSeq - 1))?.recordHash ?? GENESIS_HASH;
  let expectedSeq = fromSeq;

  for (const record of records) {
    if (record.ledgerSequence !== expectedSeq) {
      errors.push({
        seq: record.ledgerSequence, type: 'sequence_anomaly',
        denialCode: DENIAL_CODE.SEQUENCE_ANOMALY,
        detail: `Expected ledgerSequence ${expectedSeq}, got ${record.ledgerSequence}`,
      });
      expectedSeq = record.ledgerSequence;
    }
    if (record.previousHash !== prevHash) {
      errors.push({
        seq: record.ledgerSequence, type: 'hash_chain_break',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `Expected previousHash ${prevHash}, got ${record.previousHash}`,
      });
    }
    const isValid = await verify(record.recordHash, record.signature, publicKey);
    if (!isValid) {
      errors.push({
        seq: record.ledgerSequence, type: 'signature_invalid',
        denialCode: DENIAL_CODE.CHAIN_INTEGRITY_BROKEN,
        detail: `Signature invalid on sequence ${record.ledgerSequence}`,
      });
    }
    prevHash = record.recordHash;
    expectedSeq++;
  }

  return { ok: errors.length === 0, checkedFrom: fromSeq, checkedTo: toSeq,
           recordCount: records.length, errors };
}
```

---

## 17. Security Layer

### 17.1 Replay Detector — `packages/core/src/security/replay-detector.ts`

SQLite-backed. Survives process restarts. Uses `REPLAY_DEDUP_TTL_SECONDS` constant.

```typescript
class ReplayDetector {
  constructor(private readonly db: Database) {}

  async check(actionId: Uuid): Promise<'ok' | 'replay'> {
    await this.db.run(
      `DELETE FROM replay_cache WHERE seen_at < ?`,
      new Date(Date.now() - REPLAY_DEDUP_TTL_SECONDS * 1000).toISOString()
    );
    const hit = await this.db.get<{ action_id: string }>(
      `SELECT action_id FROM replay_cache WHERE action_id = ?`, actionId
    );
    if (hit) return 'replay';
    await this.db.run(
      `INSERT INTO replay_cache(action_id, seen_at) VALUES (?, ?)`, actionId, nowIso()
    );
    return 'ok';
  }

  async nextSequence(delegationId: Uuid): Promise<number> {
    await this.db.run(
      `INSERT INTO delegation_sequences(delegation_id, last_sequence)
       VALUES (?, 1)
       ON CONFLICT(delegation_id) DO UPDATE SET last_sequence = last_sequence + 1`,
      delegationId
    );
    const row = await this.db.get<{ last_sequence: number }>(
      `SELECT last_sequence FROM delegation_sequences WHERE delegation_id = ?`, delegationId
    );
    return row?.last_sequence ?? 1;
  }
}
```

Ingress security layer calls both `replayDetector.check(action.actionId)` and
`action.delegationSequence = await replayDetector.nextSequence(action.delegationId)`
before the gate pipeline.

SEQUENCE_ANOMALY is emitted by the chain verifier (§16.2), not by the ingress layer.

### 17.2 Injection Guard

```typescript
function sanitizeIntentField(raw: string | null | undefined, maxLen: number): string {
  if (!raw) return '';
  let s = raw.replace(/[^\x20-\x7E\n\t]/g, '');
  const truncated = s.length > maxLen;
  return (truncated ? s.slice(0, maxLen) + ' [TRUNCATED]' : s);
}
```

### 17.3 Rate Limiter — single-process; documented limitation

Per-actor: max 60 actions/minute. In-memory Map.

**Documented limitation**: Single-process only. No guarantee across restarts or instances.
Must be documented in operator notes before production.

```typescript
class RateLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();
  private readonly MAX_PER_MINUTE = 60;
  check(actorId: Uuid): 'ok' | 'rate_limited' {
    const now = Date.now();
    const b   = this.buckets.get(actorId) ?? { count: 0, windowStart: now };
    if (now - b.windowStart > 60_000) {
      this.buckets.set(actorId, { count: 1, windowStart: now }); return 'ok';
    }
    b.count++;
    this.buckets.set(actorId, b);
    return b.count > this.MAX_PER_MINUTE ? 'rate_limited' : 'ok';
  }
}
```

### 17.4 Broad Token Bypass Detection

```typescript
function assertGrantPresent(grant: ExecutionGrant | undefined): asserts grant is ExecutionGrant {
  if (!grant) throw new NexusSecurityViolation('execution_without_grant', DENIAL_CODE.BROAD_TOKEN_BYPASS);
}
function assertGrantNotExpired(grant: ExecutionGrant): void {
  if (new Date(grant.expiresAt) <= new Date())
    throw new NexusSecurityViolation('execution_with_expired_grant', DENIAL_CODE.GRANT_EXPIRED);
}
```

### 17.5 Grant Vault — `packages/core/src/execution/grant-vault.ts`

```typescript
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

Connectors: `setGrantSecret(grant, token)` in `redeemGrant()`.
`getGrantSecret(grant)` for API call. Gate 06 `finally`: `clearGrantSecret(grant)`.
Applies even on NexusSecurityViolation.

---

## 18. Redaction Law

Redaction applied at Gate 07 before write.

```typescript
export const REDACTION_MARKERS = {
  PII: '[REDACTED:PII]', PHI: '[REDACTED:PHI]', FINANCIAL: '[REDACTED:FINANCIAL]',
  SECRET: '[REDACTED:SECRET]', PROMPT: '[REDACTED:RAW_PROMPT]',
  REASONING: '[REDACTED:REASONING]', OVERFLOW: '[TRUNCATED:OVERFLOW]',
} as const;
```

Rules: rawPayload never stored; executionResult redacted; secretValue never stored;
objectiveSummary sanitized/truncated; secret-pattern fields replaced.

---

## 19. MCP Adapter Law (Adapter v1)

All files in `packages/adapters/mcp/src/`.

### 19.1 Architecture

HTTP server wrapping an upstream MCP server. Operator changes `mcpServer` URL to proxy
address. MCP is Adapter v1 (MODULAR-001). Layer 4 — imports Layer 2 only.

### 19.2 MCP Normalizer

Verb prefix map, inferVerbFromMcp, inferTargetFromMcp,
inferResourceScope, isExternalFacingMcp. Updated for v1.4.12 expanded verb taxonomy:

```typescript
// v1.4.12 additions to VERB_PREFIX_MAP:
[['write_','overwrite_'],                                     ACTION_VERB.WRITE],
[['query_','lookup_'],                                        ACTION_VERB.QUERY],
[['search_','find_','browse_'],                               ACTION_VERB.SEARCH],
[['synthesize_','compose_','generate_','summarize_'],         ACTION_VERB.SYNTHESIZE],
[['transmit_','stream_','relay_'],                            ACTION_VERB.TRANSMIT],
```

### 19.3 MCP Session Law

Sessions MUST exist before any MCP action. The adapter does NOT create sessions from
caller-supplied headers. No auto-create path.

### 19.4 Required Headers

| Header | Required | Description |
|---|---|---|
| `X-Nexus-Actor-Id` | Yes | UUID of registered actor |
| `X-Nexus-Principal-Id` | Yes | UUID of principal |
| `X-Nexus-Session-Id` | Yes | UUID of existing session |
| `X-Nexus-Delegation-Id` | Yes | UUID of active delegation |
| `X-Nexus-Run-Id` | Yes | UUID of current run (new in v1.4.12) |
| `X-Nexus-Target-System` | No | Target system identifier |
| `X-Nexus-External-Facing` | No | 'true' if external |
| `X-Nexus-Model-Id` | No | Model identifier |
| `X-Nexus-Model-Confidence` | No | Float [0,1] |
| `X-Nexus-Risk-Note` | No | Short risk note |

`X-Nexus-Environment` is intentionally absent. Environment is not adapter-provided.

### 19.5 Adapter Environment Non-Override Law

Adapters MUST NOT set or override environment (blueprint §24.5). Environment is resolved
from actor registration at Gate 01. No adapter-provided field influences
ResourceTarget.environment.

---

## 20. NXS Registry and Store Law

### 20.1 SQLite Schema — `packages/core/src/db/schema.ts`

Initialized at startup. All tables. Column-by-column — no JSON blob for indexed fields.

```sql
CREATE TABLE IF NOT EXISTS principals (
  principal_id      TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  registered_at     TEXT NOT NULL,
  max_risk_tier     TEXT NOT NULL,
  allowed_systems   TEXT NOT NULL    -- JSON array
);

CREATE TABLE IF NOT EXISTS actors (
  actor_id            TEXT PRIMARY KEY,
  actor_class         TEXT NOT NULL,
  principal_id        TEXT NOT NULL REFERENCES principals(principal_id),
  display_name        TEXT NOT NULL,
  environment         TEXT NOT NULL,
  oct_level           TEXT NOT NULL DEFAULT 'OCT-OPEN',
  risk_ceiling        TEXT NOT NULL,
  allowed_systems     TEXT NOT NULL,  -- JSON array
  registered_at       TEXT NOT NULL,
  owner               TEXT,
  purpose             TEXT,
  review_cadence      TEXT,
  approver_public_key TEXT,
  approver_channels   TEXT
);
CREATE INDEX IF NOT EXISTS idx_actors_principal   ON actors(principal_id);
CREATE INDEX IF NOT EXISTS idx_actors_environment ON actors(environment);
CREATE INDEX IF NOT EXISTS idx_actors_class       ON actors(actor_class);
CREATE INDEX IF NOT EXISTS idx_actors_oct         ON actors(oct_level);

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
  allowed_systems             TEXT NOT NULL,
  allowed_capabilities        TEXT NOT NULL,
  forbidden_capabilities      TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS delegation_sequences (
  delegation_id  TEXT PRIMARY KEY,
  last_sequence  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_approvals (
  approval_id   TEXT PRIMARY KEY,
  action_id     TEXT NOT NULL,
  template_id   TEXT NOT NULL,
  request_json  TEXT NOT NULL,
  channel_id    TEXT NOT NULL,
  dispatched_at TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  response_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status  ON pending_approvals(status);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_expires ON pending_approvals(expires_at);
```

### 20.2 Actor Registry

Reads/writes the `actors` table. Validation rules from §12.3.2 enforced at registration.

### 20.3 Approver Registry

Reads `actors` table filtering on `approver_public_key IS NOT NULL`.

### 20.4 Session Store Law

```typescript
interface SessionStoreInterface {
  get(sessionId: Uuid): Promise<Session | null>;
  create(session: Session): Promise<void>;
  invalidate(sessionId: Uuid): Promise<void>;
}
```

**`get`**: returns `Session` regardless of expiry. Returns `null` only if not found.
**Gate 01 is the sole owner of the session expiry decision.** The store does not filter
by expiry.

**`create`**: inserts into sessions. Throws if sessionId exists. principalId derived
server-side from actor.principalId — never caller-supplied. Validates
actor.principalId === delegation.principalId at creation time; mismatch throws.

**`invalidate`**: sets `expires_at = now()` — does not delete.

### 20.5 Pending Approval Store

```typescript
interface PendingApprovalStore {
  create(record: PendingApprovalRecord): Promise<void>;
  getStatus(approvalId: Uuid): Promise<{ status: string; responseJson: string | null } | null>;
  getRequest(approvalId: Uuid): Promise<string | null>;  // stored signed ApprovalRequest JSON
  resolve(approvalId: Uuid, status: string, responseJson: string): Promise<void>;
  markTimedOut(approvalId: Uuid): Promise<void>;
}
```

### 20.6 Approval Decision Service — `packages/core/src/approval/decision-service.ts`

Shared service — single signing path. CLI and API are thin shells.

```typescript
async function decideApproval(
  approvalId: Uuid, approverId: NonEmpty,
  decision: 'approved' | 'denied', note?: string
): Promise<ApprovalResponse> {
  const record = await pendingApprovalStore.getStatus(approvalId);
  if (!record) throw new ApprovalDecisionError(`Approval ${approvalId} not found`);
  if (record.status !== 'pending') throw new ApprovalDecisionError(`Approval ${approvalId} already resolved: ${record.status}`);

  const requestJson = await pendingApprovalStore.getRequest(approvalId);
  if (!requestJson) throw new ApprovalDecisionError(`Approval request not found`);
  const request = JSON.parse(requestJson) as ApprovalRequest;

  if (new Date(request.expiresAt) <= new Date()) {
    throw new ApprovalDecisionError(`Approval ${approvalId} has expired`);
  }

  const approverKey = await loadApproverKey(approverId);

  const responseBody: Omit<ApprovalResponse, 'signature'> = {
    approvalId,
    decision: decision === 'approved' ? APPROVAL_DECISION_LABEL.APPROVED : APPROVAL_DECISION_LABEL.DENIED,
    decidedBy: approverId,
    decidedAt: nowIso(),
    channel: 'cli',
    note: note ?? null,
  };

  const signature = await sign(canonicalize(responseBody), approverKey);
  const response: ApprovalResponse = { ...responseBody, signature };

  await pendingApprovalStore.resolve(approvalId, decision, JSON.stringify(response));
  return response;
}
```

### 20.7 CLI Channel (Channel v1)

```typescript
class CliApprovalChannel implements ApprovalChannel {
  readonly channelId = 'cli'; readonly channelVersion = 'v1.0.0';
  constructor(private readonly store: PendingApprovalStore, private readonly pollMs = 2000) {}

  async dispatch(request: ApprovalRequest): Promise<void> {
    await this.store.create({
      approvalId: request.approvalId, actionId: request.actionId,
      templateId: request.templateId, requestJson: JSON.stringify(request),
      channelId: this.channelId, dispatchedAt: nowIso(), expiresAt: request.expiresAt,
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

### 20.8 Run Orchestrator Law

`nexus run [--scenario <id> | --fixtures all] [--out-dir <path>]`

`--scenario <id>` validates against SCENARIO_MANIFEST. Fixture path from manifest.
No string concatenation for paths.

```typescript
async function executeRun(options: RunOptions): Promise<void> {
  // runId is a proper Uuid — the cross-link key across all three audit streams.
  // The directory display name uses a RUN- prefix for human readability.
  const runId  = uuid();
  const runDir = 'RUN-' + runId.slice(0, 8).toUpperCase();
  const outDir = options.outDir ?? path.join('runs', runDir);
  await fs.mkdir(outDir, { recursive: true });

  const runDb           = await openDatabase(path.join(outDir, 'run.db'));
  await applySchema(runDb);

  // Three distinct audit stream backends — never collapsed
  const evidenceLedger  = new JsonlLedgerBackend(path.join(outDir, '08-evidence-ledger.jsonl'));
  const runLedgerWriter = new JsonlRunLedgerBackend(path.join(outDir, '14-run-ledger.jsonl'));
  // Routing Provenance Trail backend created per-NVG-call in §27.2

  // Open run in Run Ledger
  await runLedgerWriter.writeEvent({
    runId,
    eventType: 'run_opened',
    timestamp: nowIso(),
    actorId: null,
    detail: { outDir },
  });

  const scenarios = options.fixturesAll
    ? await loadAllFixtures(SCENARIO_MANIFEST)
    : [await loadFixture(SCENARIO_MANIFEST[options.scenario!].fixturePath)];

  const ingestLog: IngestEntry[] = [];
  for (const scenario of scenarios) {
    await bootstrapScenario(scenario, runDb);
    const result = await executeScenario(scenario, runId, runDb, evidenceLedger, runLedgerWriter);
    ingestLog.push(...result.ingestEntries);
  }

  // Close run in Run Ledger
  await runLedgerWriter.writeEvent({
    runId,
    eventType: 'run_closed',
    timestamp: nowIso(),
    actorId: null,
    detail: { scenarioCount: scenarios.length },
  });

  await writeRunArtifacts(outDir, runId, scenarios, runDb, evidenceLedger, runLedgerWriter, ingestLog);
}

// ─── Run helper contracts (used by executeRun) ───

interface ScenarioFixture {
  scenarioId:    ScenarioId;
  description:   string;
  actors:        Actor[];
  principals:    Principal[];
  delegations:   DelegationContext[];
  sessions:      Omit<Session, 'sessionId'>[];
  actions:       AgentAction[];
  policyPath:    string;
}

async function loadFixture(fixturePath: string): Promise<ScenarioFixture> {
  // Reads fixture JSON from the given path. Validates against ScenarioFixture shape.
  // Throws on missing file or schema violation.
}

async function loadAllFixtures(
  manifest: typeof SCENARIO_MANIFEST
): Promise<ScenarioFixture[]> {
  // Iterates all manifest entries, calls loadFixture for each.
  return Promise.all(
    Object.values(manifest).map(entry => loadFixture(entry.fixturePath))
  );
}

async function bootstrapScenario(
  scenario: ScenarioFixture,
  db: ReturnType<typeof openDatabase>
): Promise<void> {
  // Inserts principals, actors, delegations, sessions into SQLite from fixture data.
  // Signs delegations with control-plane key. Creates sessions with server-derived principalId.
}

interface ScenarioResult {
  ingestEntries: IngestEntry[];
}

async function executeScenario(
  scenario: ScenarioFixture,
  runId: Uuid,
  db: ReturnType<typeof openDatabase>,
  evidenceLedger: LedgerBackend,
  runLedgerWriter: RunLedgerWriter
): Promise<ScenarioResult> {
  // For each action in scenario.actions: run the pipeline orchestrator (§8.2).
  // Collect ingest entries. Write evidence records. Write run ledger events.
}

async function writeRunArtifacts(
  outDir: string, runId: Uuid,
  scenarios: ScenarioFixture[],
  db: ReturnType<typeof openDatabase>,
  evidenceLedger: LedgerBackend,
  runLedgerWriter: RunLedgerWriter,
  ingestLog: IngestEntry[]
): Promise<void> {
  // Writes all 14 run artifacts per §35 Run Artifact Contract.
  // Each artifact is a JSON or JSONL file at the exact filename from §35.
}
```

**JsonlRunLedgerBackend** — separate from JsonlLedgerBackend (which handles EvidenceRecords):

```typescript
// packages/core/src/ledger/backends/jsonl-run-ledger.backend.ts
class JsonlRunLedgerBackend implements RunLedgerWriter {
  constructor(private readonly ledgerPath: string) {}

  async writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void> {
    const full: RunLedgerEntry = { entryId: uuid(), ...entry };
    await fs.appendFile(this.ledgerPath, JSON.stringify(full) + '\n', 'utf-8');
  }

  async getByRunId(runId: Uuid): Promise<RunLedgerEntry[]> {
    return (await this.readAll()).filter(e => e.runId === runId);
  }

  async tail(n: number): Promise<RunLedgerEntry[]> {
    const all = await this.readAll();
    return all.slice(-n);
  }

  async getLatestRunId(): Promise<Uuid | null> {
    const all = await this.readAll();
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i]!.eventType === 'run_opened') return all[i]!.runId;
    }
    return null;
  }

  private async readAll(): Promise<RunLedgerEntry[]> {
    let raw: string;
    try { raw = await fs.readFile(this.ledgerPath, 'utf-8'); } catch { return []; }
    return raw.split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line) as RunLedgerEntry; } catch { return null; } })
      .filter((e): e is RunLedgerEntry => e !== null);
  }
}
```

---

## 21. Delegation Engine Law

### 21.1 Minting Root DelegationContext

```typescript
async function mintRootDelegation(
  principal: Principal, actor: Actor,
  allowed: Omit<DelegationContext, 'delegationId'|'parentDelegationId'|'chainDepth'|
                                    'mintedAt'|'mintedBy'|'signature'>
): Promise<DelegationContext> {
  if (riskTierExceeds(allowed.maxRiskTier, principal.maxDelegableRiskTier)) {
    throw new DelegationError('delegation_exceeds_principal_authority');
  }
  for (const sys of allowed.allowedSystems) {
    if (!principal.allowedSystems.includes(sys)) {
      throw new DelegationError(`system_not_in_principal_scope: ${sys}`);
    }
  }

  // Mint-time environment invariant:
  // Root delegation environment must equal actor.environment.
  if (allowed.environment !== actor.environment) {
    throw new DelegationError(
      `delegation_environment_mismatch: delegation environment '${allowed.environment}' ` +
      `does not match actor environment '${actor.environment}'`
    );
  }

  const body = {
    ...allowed,
    delegationId:       uuid(),
    parentDelegationId: null,
    chainDepth:         0,
    mintedAt:           nowIso(),
    mintedBy:           DELEGATION_ENGINE_ID,
  };
  const signature = await sign(canonicalize(body), controlPlaneKey);
  return { ...body, signature };
}
```

### 21.2 Sub-Delegation Law

Permitted only if: `parentDelegation.allowDownstreamPropagation === true`,
sub-actor `maxRiskTier ≤ parent maxRiskTier`, sub-actor `allowedSystems ⊆ parent`,
sub-actor `allowedCapabilities ⊆ parent`, `chainDepth + 1 ≤ maxChainDepth`.
Violation throws `DelegationError`. mintedBy must use `DELEGATION_ENGINE_ID` constant.

---

## 22. CLI Contract

v1.4.12 CLI contract.

### 22.1 Required Commands

Complete CLI command set for v1.4.12. All commands listed — no external references.

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

nexus ledger tail [--n N]     Show last N evidence records (default 20).
nexus ledger verify [--from N --to N]  Verify ledger chain integrity + sequence continuity.
nexus ledger get <recordId>   Get evidence record by ID.

nexus policy validate <filepath>     Validate and verify policy file signature.
nexus policy test <filepath> <action-json>  Test policy evaluation against action.

nexus actor register <json>   Register actor from JSON file or inline JSON.
nexus actor list              List all registered actors.

nexus principal register <json>  Register principal from JSON file or inline JSON.

nexus approver keygen --approver-id <id>
                              Generate approver keypair at keys/approvers/<id>.keypair.json.
                              Prints public key for registry registration.

nexus posture                 Show token posture report for most recent run.
nexus replay <runDir>         Replay run and compare CCV outputs for determinism.
nexus init                    Generate dev keypair + admin token. Writes keys/dev.keypair.json
                              and keys/admin.token (both gitignored in production).

nexus serve [--port 7701]     Start Management API server. Constructs core service
                              implementations and injects into API server (§23.1).
                              Binds 127.0.0.1 only. Requires admin token.

nexus nvg classify <request-json>       Classify data and check OCT ceiling.
nexus nvg route <request-json>          Route to model tier per policy.
nexus nvg trail [--run-id <id>]         Show Routing Provenance Trail.
nexus nvg policy validate <filepath>    Validate NVG routing policy signature.

nexus run-ledger tail [--n N]           Show last N run ledger entries.
nexus run-ledger get <run-id>           Get run ledger for specific run.

nexus mode show                         Show current operating modes.
nexus mode set --engine <nxs|nvg> --mode <observe|advisory|enforcing>
                                        Set operating mode (requires admin key).
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

```typescript
function printApprovalPrompt(request: ApprovalRequest): void {
  const expiresIn = Math.max(0, Math.floor(
    (new Date(request.expiresAt).getTime() - Date.now()) / 1000
  ));
  const mins = Math.floor(expiresIn / 60);
  const secs = expiresIn % 60;

  console.log(`\n⚡ Approval required: ${request.actorDisplayName} → ${request.actionSummary}`);
  console.log(`\n  Action:    ${request.actionSummary}`);
  console.log(`  Impact:    ${request.estimatedImpact}`);
  console.log(`  Intent:    "${request.contextSummary.slice(0, 80)}"`);
  console.log(`  Diff:      ${request.diff ?? '[no diff available]'}`);
  console.log(`  Principal: ${request.principalDisplayName}`);
  console.log(`  Expires:   in ${mins}m ${secs}s`);
  console.log(`\n  Run: nexus approve ${request.approvalId} --approver-id <id>`);
  console.log(`  Run: nexus deny ${request.approvalId} --approver-id <id> [--note "reason"]`);
}
```

### 22.3 Approver Key Loading Law

All approval signing goes through decideApproval() shared service.

---

## 23. Management API Contract

v1.4.12 Management API contract.

### 23.1 Server

Express on port 7701. Binds 127.0.0.1 only. Admin bearer token required on all routes.
Trust boundary law: binds 127.0.0.1, admin bearer token, timing-safe comparison.

**Dependency injection**: The API server receives service instances (actor registry, session
store, delegation store, ledger backend, approval decision service, pending approval store,
policy loader, connector registry, channel registry) as constructor parameters. These
instances implement interfaces defined in Layer 2 (contracts). The API imports only the
interface types from contracts — never the implementation classes from core. The bootstrap
entry point (`nexus serve` command or standalone server script) constructs core
implementations and injects them into the API server.

### 23.2 Routes

Complete route set for v1.4.12. All routes listed — no external references. All routes
return `{ ok: boolean, data?: unknown, error?: string }`.

```
POST   /principals               Register principal (body: Principal JSON)
GET    /principals/:id           Get principal by ID

POST   /actors                   Register actor (body: Actor JSON, validates non-human fields)
GET    /actors                   List all actors
GET    /actors/:id               Get actor by ID

POST   /sessions                 Create session (body: { actorId, delegationId, ttlSeconds? })
                                 principalId derived server-side from actor.principalId.
                                 Validates actor.principalId === delegation.principalId.
GET    /sessions/:id             Get session by ID

POST   /delegations              Mint root delegation (body: delegation params)
GET    /delegations/:id          Get delegation by ID

POST   /policies                 Load policy file (body: { filepath: string } — file path only)
                                 Rejects raw rule JSON (status 400). File path only.
GET    /policies/current         Get current loaded policy metadata

GET    /approvals/pending        List pending approvals
POST   /approvals/:id/approve    Approve (body: { decidedBy: string })
                                 Calls decideApproval() shared service.
POST   /approvals/:id/deny       Deny (body: { decidedBy: string, note?: string })
                                 Calls decideApproval() shared service.

GET    /ledger?from=N&to=N       Get ledger range
GET    /ledger/:recordId         Get evidence record by ID
POST   /ledger/verify            Verify chain (body: { from: number, to: number })

GET    /posture                  Token posture report

GET    /nvg/trail?runId=<id>     Get Routing Provenance Trail entries
GET    /nvg/policy               Get current NVG routing policy metadata
POST   /nvg/classify             Classify request data
POST   /nvg/route                Route request to model tier

GET    /run-ledger?runId=<id>    Get run ledger entries
GET    /run-ledger/latest        Get latest run ledger

GET    /mode                     Get current operating modes
POST   /mode                     Set operating mode (body: { engine, mode })
                                 Requires admin key. Validates enforcing-lock.
```

`POST /policies` rejects raw rule JSON (status 400). File path only.

`POST /sessions`:

```typescript
app.post('/sessions', async (req, res) => {
  const { actorId, delegationId, ttlSeconds = 3600 } = req.body;
  // principalId is never accepted from the request body
  const actor = await actorRegistry.get(actorId);
  if (!actor) return res.status(400).json({ ok: false, error: 'actor not found' });
  const delegation = await delegationStore.getById(delegationId);
  if (!delegation) return res.status(400).json({ ok: false, error: 'delegation not found' });
  if (actor.principalId !== delegation.principalId) {
    return res.status(400).json({ ok: false, error: 'actor/principal mismatch' });
  }
  const session: Session = {
    sessionId:    uuid(),
    actorId:      actor.actorId,
    principalId:  actor.principalId,  // server-side derivation
    delegationId: delegation.delegationId,
    createdAt:    nowIso(),
    expiresAt:    addSeconds(nowIso(), ttlSeconds),
  };
  await sessionStore.create(session);
  return res.json({ ok: true, data: { sessionId: session.sessionId, expiresAt: session.expiresAt } });
});
```

`POST /approvals/:id/approve` and `POST /approvals/:id/deny` accept `decidedBy` (approverId)
and call `decideApproval(approvalId, decidedBy, decision, note?)` from the shared decision
service. The API does not re-implement signing logic. Same signing path as CLI.

---

## 24. NVG Engine Law

Blueprint §13. All files in `packages/vanguard/src/`. Layer 3 — imports Layer 2 only.
Never imports Layer 1.

### 24.1 Outbound: Step 1 — Intake and Normalization

```typescript
interface NvgOutboundRequest {
  requestId:         Uuid;
  runId:             Uuid;
  actorId:           Uuid;
  octLevel:          OctLevel;        // loaded from registry — not actor-supplied
  environmentContext: EnvironmentId;  // from actor registration
  taskIntent:        NonEmpty;
  payload:           unknown;         // never stored
  dataLabels:        DataLabel[];     // from enterprise data catalog
  costPreference:    'low' | 'standard' | 'high';
  latencyPreference: 'low' | 'standard' | 'high';
}

interface DataLabel {
  source:     NonEmpty;       // e.g. 'collibra', 'alation', 'dlp'
  label:      DataClass;      // classification label applied by enterprise
  confidence: number;         // [0,1]
}
```

Actors cannot supply their own identity claims or OCT at intake.

### 24.2 Outbound: Step 2 — Data Classification

Label-driven classification. NVG reads labels the enterprise has applied.

```typescript
interface NvgClassificationResult {
  effectiveDataClass: DataClass;
  isSensitive:        boolean;
  labels:             DataLabel[];
  classifiedAt:       IsoTimestamp;
}

interface NvgCeilingResult {
  allowed:     boolean;
  denialCode?: DenialCode;
  reason?:     string;
}

// resolveHighestDataClass uses DATA_CLASS_ORDER from §11.4
function resolveHighestDataClass(labels: DataLabel[]): DataClass {
  if (!labels.length) return DATA_CLASS.PUBLIC;
  let maxIdx = 0;
  for (const label of labels) {
    const idx = DATA_CLASS_ORDER.indexOf(label.label);
    if (idx > maxIdx) maxIdx = idx;
  }
  return DATA_CLASS_ORDER[maxIdx]!;
}

function classifyOutboundData(labels: DataLabel[]): NvgClassificationResult {
  const highestClass = resolveHighestDataClass(labels);
  const isSensitive = isSensitiveDataClass(highestClass);

  return {
    effectiveDataClass: highestClass,
    isSensitive,
    labels,
    classifiedAt: nowIso(),
  };
}
```

### 24.3 Outbound: Step 3 — OCT Ceiling Enforcement

```typescript
function enforceOctModelCeiling(
  octLevel: OctLevel,
  requestedTier: ModelTier,
  classification: NvgClassificationResult
): NvgCeilingResult {
  const ceiling = OCT_CEILINGS[octLevel];
  if (!ceiling) return { allowed: false, denialCode: 'nvg_oct_ceiling_denied', reason: 'unknown OCT level' };

  // Hard wall: sensitive data → frontier denied
  if (classification.isSensitive && isFrontierTier(requestedTier)) {
    return { allowed: false, denialCode: DENIAL_CODE.NVG_CLASSIFICATION_DENIED,
             reason: 'sensitive data cannot reach frontier tiers' };
  }

  // OCT model tier ceiling
  if (!ceiling.modelTierCeiling.includes(requestedTier)) {
    return { allowed: false, denialCode: DENIAL_CODE.NVG_OCT_CEILING_DENIED,
             reason: `OCT ${octLevel} does not permit tier ${requestedTier}` };
  }

  return { allowed: true };
}

function isFrontierTier(tier: ModelTier): boolean {
  return tier === MODEL_TIER.FRONTIER_GENERAL ||
         tier === MODEL_TIER.FRONTIER_REASONING ||
         tier === MODEL_TIER.FRONTIER_LIVE;
}
```

### 24.4 Outbound: Step 4 — Routing Policy Evaluation

First matching rule governs. No match → deny (default-deny posture). Policy must be signed
and validated at load time (§25.2).

```typescript
function evaluateRoutingPolicy(
  policy: NvgRoutingPolicy,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult
): NvgRoutingDecision {
  for (const rule of policy.rules.sort((a, b) => a.priority - b.priority)) {
    if (matchesRoutingCondition(rule.conditions, request, classification)) {
      return {
        matched:     true,
        ruleId:      rule.ruleId,
        routeTo:     rule.routeTo,
        fallbackTier: rule.fallbackTier ?? null,
      };
    }
  }
  // Default deny — no matching rule
  return { matched: false, ruleId: null, routeTo: null, fallbackTier: null };
}

interface NvgRoutingDecision {
  matched:      boolean;
  ruleId:       NonEmpty | null;
  routeTo:      ModelTier | null;
  fallbackTier: ModelTier | null;
}

function matchesRoutingCondition(
  cond: NvgRoutingRule['conditions'],
  request: NvgOutboundRequest,
  classification: NvgClassificationResult
): boolean {
  if (cond.dataClasses && !cond.dataClasses.includes(classification.effectiveDataClass)) return false;
  if (cond.octLevels && !cond.octLevels.includes(request.octLevel)) return false;
  if (cond.taskTypes && !cond.taskTypes.includes(request.taskIntent)) return false;
  if (cond.costCeiling !== undefined && request.costPreference === 'high') return false;
  return true;
}
```

### 24.5 Outbound: Step 5 — Model Invocation

Health monitoring. Fallback constrained — never widens ceiling.

```typescript
interface ModelEndpoint {
  endpointId:   NonEmpty;
  tier:         ModelTier;
  url:          NonEmpty;
  healthy:      boolean;
  lastCheckAt:  IsoTimestamp;
}

// callEndpoint() contract — the HTTP transport to a model endpoint.
// Implementation is connector-specific (each model provider has its own API shape).
// This contract defines the governed input/output shape and invariants.
interface ModelEndpointResponse {
  success:      boolean;
  denialCode?:  DenialCode;      // set only on failure
  reason?:      string;          // human-readable failure reason
  responseSize?: number;         // response body size in bytes (success only)
  latencyMs?:   number;          // round-trip time in milliseconds
}

// Governed invariants:
// 1. request.payload is forwarded but never stored or logged by the transport layer.
// 2. The transport layer must not modify, inspect, or branch on payload content.
// 3. Timeout produces { success: false, denialCode: NVG_ENDPOINT_TIMEOUT } — never silent retry.
// 4. Network failure produces { success: false, denialCode: NVG_ENDPOINT_UNREACHABLE }.
// 5. The transport layer must not cache or replay responses.
async function callEndpoint(
  endpoint: ModelEndpoint,
  request: NvgOutboundRequest
): Promise<ModelEndpointResponse> {
  // Connector-specific HTTP implementation.
  // Must satisfy all five invariants above.
  // Reference implementation: packages/vanguard/src/transport/http-model-transport.ts
  const startMs = Date.now();
  try {
    const response = await httpPost(endpoint.url, {
      body: request.payload,
      timeoutMs: 30_000,  // governed default — configurable per endpoint
    });
    return {
      success: true,
      responseSize: response.bodySize,
      latencyMs: Date.now() - startMs,
    };
  } catch (err: unknown) {
    return {
      success: false,
      denialCode: isTimeoutError(err)
        ? DENIAL_CODE.NVG_ENDPOINT_TIMEOUT
        : DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
      reason: err instanceof Error ? err.message : 'unknown transport error',
      latencyMs: Date.now() - startMs,
    };
  }
}

async function invokeModel(
  tier: ModelTier,
  fallbackTier: ModelTier | null,
  request: NvgOutboundRequest,
  classification: NvgClassificationResult,
  endpoints: ModelEndpoint[]
): Promise<NvgInvocationResult> {
  const primary = endpoints.find(e => e.tier === tier && e.healthy);
  if (primary) {
    const result = await callEndpoint(primary, request);
    return { ...result, fallbackApplied: false, fallbackFromTier: null, endpointUsed: primary };
  }

  // Fallback — never widens data-class ceiling or OCT model tier ceiling (§26.2)
  if (fallbackTier) {
    // Validate fallback does not widen data-class ceiling
    if (classification.isSensitive && isFrontierTier(fallbackTier)) {
      return { success: false, fallbackApplied: false, fallbackFromTier: null, endpointUsed: null,
               denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
               reason: 'fallback tier would violate data classification ceiling' };
    }
    // Validate fallback does not widen OCT model-tier ceiling
    const octCeiling = OCT_CEILINGS[request.octLevel];
    if (octCeiling && !octCeiling.modelTierCeiling.includes(fallbackTier)) {
      return { success: false, fallbackApplied: false, fallbackFromTier: null, endpointUsed: null,
               denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
               reason: `fallback tier ${fallbackTier} outside OCT ${request.octLevel} model-tier ceiling` };
    }
    const fallback = endpoints.find(e => e.tier === fallbackTier && e.healthy);
    if (fallback) {
      const result = await callEndpoint(fallback, request);
      return { ...result, fallbackApplied: true, fallbackFromTier: tier, endpointUsed: fallback };
    }
  }

  // No valid endpoint — deny, do not queue silently
  return { success: false, fallbackApplied: false, fallbackFromTier: null, endpointUsed: null,
           denialCode: DENIAL_CODE.NVG_FALLBACK_DENIED,
           reason: `no healthy endpoint for tier ${tier}` };
}

interface NvgInvocationResult {
  success:         boolean;
  fallbackApplied: boolean;
  fallbackFromTier: ModelTier | null;
  endpointUsed:    ModelEndpoint | null;
  denialCode?:     DenialCode;
  reason?:         string;
  responseSize?:   number;
  latencyMs?:      number;
}
```

### 24.6 Inbound: Step 6 — Return Path Logging

Log-and-normalize. No content inspection. Link to outbound entry by run ID and
correlation ID.

```typescript
async function logInboundResponse(
  correlationId: Uuid,
  request: NvgOutboundRequest,
  invocation: NvgInvocationResult,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty
): Promise<void> {
  await trailWriter.append({
    entryId:               uuid(),
    runId:                 request.runId,
    correlationId,
    direction:             'inbound',
    actorId:               request.actorId,
    octLevel:              request.octLevel,
    dataClassification:    request.dataLabels.length > 0
                             ? resolveHighestDataClass(request.dataLabels)
                             : DATA_CLASS.PUBLIC,
    routingPolicyVersion,
    modelTierSelected:     invocation.endpointUsed?.tier ?? null,
    modelTierInvoked:      invocation.endpointUsed?.tier ?? null,
    denialCode:            invocation.denialCode ?? null,
    denialReason:          invocation.reason ?? null,
    fallbackApplied:       invocation.fallbackApplied,
    fallbackFromTier:      invocation.fallbackFromTier,
    costMetrics:           { requestCost: null, responseCost: null },
    latencyMs:             invocation.latencyMs ?? 0,
    responseSize:          invocation.responseSize ?? null,
    timestamp:             nowIso(),
  });
}
```

### 24.7 Deny / Quarantine

Request terminated. Structured denial with reason code. Routing Provenance Trail entry
written. No data leaves enterprise boundary.

```typescript
async function handleNvgDenial(
  request: NvgOutboundRequest,
  denialCode: DenialCode,
  reason: string,
  trailWriter: RoutingTrailWriter,
  routingPolicyVersion: NonEmpty
): Promise<void> {
  await trailWriter.append({
    entryId:               uuid(),
    runId:                 request.runId,
    correlationId:         uuid(),
    direction:             'outbound',
    actorId:               request.actorId,
    octLevel:              request.octLevel,
    dataClassification:    request.dataLabels.length > 0
                             ? resolveHighestDataClass(request.dataLabels)
                             : DATA_CLASS.PUBLIC,
    routingPolicyVersion,
    modelTierSelected:     null,
    modelTierInvoked:      null,
    denialCode,
    denialReason:          reason,
    fallbackApplied:       false,
    fallbackFromTier:      null,
    costMetrics:           { requestCost: null, responseCost: null },
    latencyMs:             0,
    responseSize:          null,
    timestamp:             nowIso(),
  });
}
```

---

## 25. NVG Routing Policy Contract

Blueprint §14.4.

### 25.1 Routing Policy Format

Versioned, signed YAML. Signature validated at load time.

```typescript
interface NvgRoutingPolicy {
  version:      NonEmpty;
  policyId:     Uuid;
  issuer:       NonEmpty;
  issuedAt:     IsoTimestamp;
  signature:    Base64Url;  // Ed25519 over canonicalize() of all fields except signature
  defaultAction: 'deny';
  rules:        NvgRoutingRule[];
}

interface NvgRoutingRule {
  ruleId:        NonEmpty;
  priority:      number;
  conditions: {
    dataClasses?:     DataClass[];
    octLevels?:       OctLevel[];
    taskTypes?:       string[];
    costCeiling?:     number;
  };
  routeTo:       ModelTier;
  fallbackTier?: ModelTier;
}
```

### 25.2 Policy Validation

A routing policy that would route sensitive data to a frontier tier is rejected at load
time as a classification-enforcement violation — even if the signature is valid.

```typescript
function validateRoutingPolicy(policy: NvgRoutingPolicy): void {
  for (const rule of policy.rules) {
    const hasSensitive = rule.conditions.dataClasses?.some(isSensitiveDataClass);
    if (hasSensitive && isFrontierTier(rule.routeTo)) {
      throw new Error(`ROUTING_POLICY_VIOLATION: rule ${rule.ruleId} routes sensitive data to frontier tier ${rule.routeTo}`);
    }
    if (hasSensitive && rule.fallbackTier && isFrontierTier(rule.fallbackTier)) {
      throw new Error(`ROUTING_POLICY_VIOLATION: rule ${rule.ruleId} fallback routes sensitive data to frontier tier ${rule.fallbackTier}`);
    }
  }
}
```

---

## 26. NVG Model Tier Registry

Blueprint §14.

### 26.1 Six Governed Tiers

Carried from blueprint §14.1. ModelTier is an open governed string type (MODULAR-011).
Adding a new tier is a registry update + new signed routing policy — not a code change.

### 26.2 Fallback Law

Fallback never widens data-class ceiling or OCT model tier ceiling. If no valid fallback
exists within ceiling constraints: deny. Do not queue silently.

---

## 27. NVG Routing Provenance Trail

Blueprint §13.8, §22.1.

### 27.1 Trail Record

```typescript
interface RoutingProvenanceTrailEntry {
  entryId:           Uuid;
  runId:             Uuid;        // cross-link key
  correlationId:     Uuid;        // links outbound to inbound
  direction:         'outbound' | 'inbound';
  actorId:           Uuid;
  octLevel:          OctLevel;
  dataClassification: DataClass;
  routingPolicyVersion: NonEmpty;
  modelTierSelected: ModelTier | null;  // null if denied before tier selection
  modelTierInvoked:  ModelTier | null;  // null if denied
  denialCode:        DenialCode | null;
  denialReason:      string | null;
  fallbackApplied:   boolean;
  fallbackFromTier:  ModelTier | null;
  costMetrics: {
    requestCost:  number | null;
    responseCost: number | null;
  };
  latencyMs:         number;
  responseSize:      number | null;  // inbound only
  timestamp:         IsoTimestamp;
}
```

### 27.2 Trail Backend

Append-only. JSONL file per run at `runs/RUN-<id>/13-routing-provenance-trail.jsonl`.
Queryable via management API (`GET /nvg/trail?runId=<id>`) and CLI (`nexus nvg trail`).

```typescript
// packages/contracts/src/interfaces/routing-trail.interface.ts

interface RoutingTrailWriter {
  append(entry: RoutingProvenanceTrailEntry): Promise<void>;
}

interface RoutingTrailReader {
  getByRunId(runId: Uuid): Promise<RoutingProvenanceTrailEntry[]>;
  getByCorrelationId(correlationId: Uuid): Promise<RoutingProvenanceTrailEntry[]>;
  tail(n: number): Promise<RoutingProvenanceTrailEntry[]>;
}

// packages/vanguard/src/trail/jsonl-routing-trail.backend.ts

class JsonlRoutingTrailBackend implements RoutingTrailWriter, RoutingTrailReader {
  constructor(private readonly trailPath: string) {}

  async append(entry: RoutingProvenanceTrailEntry): Promise<void> {
    await fs.appendFile(this.trailPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  async getByRunId(runId: Uuid): Promise<RoutingProvenanceTrailEntry[]> {
    return (await this.readAll()).filter(e => e.runId === runId);
  }

  async getByCorrelationId(correlationId: Uuid): Promise<RoutingProvenanceTrailEntry[]> {
    return (await this.readAll()).filter(e => e.correlationId === correlationId);
  }

  async tail(n: number): Promise<RoutingProvenanceTrailEntry[]> {
    const all = await this.readAll();
    return all.slice(-n);
  }

  private async readAll(): Promise<RoutingProvenanceTrailEntry[]> {
    let raw: string;
    try { raw = await fs.readFile(this.trailPath, 'utf-8'); } catch { return []; }
    return raw.split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line) as RoutingProvenanceTrailEntry; } catch { return null; } })
      .filter((e): e is RoutingProvenanceTrailEntry => e !== null);
  }
}
```

---

## 28. Post-Inference Action Normalizer

Blueprint §15.

### 28.1 Normalizer Contract

The normalizer converts model output to AgentAction format. It makes zero governance
decisions — pure normalization.

```typescript
interface PostInferenceNormalizer {
  normalize(modelOutput: unknown, context: NormalizerContext): AgentAction;
}

interface NormalizerContext {
  runId:       Uuid;
  actorId:     Uuid;
  principalId: Uuid;
  sessionId:   Uuid;
  delegationId: Uuid;
  protocol:    NonEmpty;
}
```

Any governance decision made inside the normalizer is a build violation.

### 28.2 Lexical Helper Relationship — Amendment J-S1

`packages/core/src/normalization/lexical-normalizer.ts` is a **subordinate lexical helper
module** used by the Post-Inference Action Normalizer. It is not the Post-Inference Action
Normalizer and does not replace it.

The `lexical-normalizer.ts` module performs lexical cleanup of raw verb strings from model
output before the normalizer produces the AgentAction. It does this by consulting only the
governed lexical fixture (`fixtures/lexicon/governed-verb-lexicon.v1.json`).

The `lexical-normalizer.ts` module shall not:
- assign policy outcome
- assign risk tier
- assign OCT ceiling
- resolve identity-provider claims
- collapse ambiguous verbs by guess
- consult WordNet source files directly at runtime

If the lexical helper cannot deterministically resolve a raw verb, it returns the raw verb
unchanged. The Post-Inference Action Normalizer continues — Gate 02 is the authority on
verb resolution and will emit `UNRESOLVABLE_VERB` if needed.

---

## 29. Workspace / Orchestration Contract

Blueprint §10, §11.

### 29.1 Workspace Entry

The workspace is the only authorized entry point for governed work (hard rule).

```typescript
interface WorkspaceEntry {
  userId:    NonEmpty;         // authenticated via identity provider
  request:   NonEmpty;         // user's request text
  runId:     Uuid;             // assigned at workspace entry
  enteredAt: IsoTimestamp;
}
```

Run ID is assigned at workspace entry. Run Ledger is opened at workspace entry.

### 29.2 Orchestrator Contract

The orchestrator is a governed actor with OCT assignment. It selects agents from the
governed agent registry, issues scoped delegation, dispatches sub-tasks.

```typescript
interface OrchestratorDispatch {
  runId:           Uuid;
  orchestratorId:  Uuid;       // registered actor
  selectedAgents:  Uuid[];
  delegationsIssued: Uuid[];
  taskSplits:      TaskSplit[];
}

interface TaskSplit {
  agentId:      Uuid;
  delegationId: Uuid;
  subTaskDescription: NonEmpty;
  requiresNvg:  boolean;       // does agent need model calls?
  requiresNxs:  boolean;       // does agent need system actions?
}
```

### 29.3 Agent Registry

The governed catalog of all actors. New agent = new config, not engine changes.
Four registration steps per blueprint §11.2.

---

## 30. Run Ledger Law

Blueprint §22.3-22.5.

### 30.1 Run Ledger Interface

```typescript
interface RunLedgerEntry {
  entryId:    Uuid;
  runId:      Uuid;            // cross-link key
  eventType:  RunEventType;
  timestamp:  IsoTimestamp;
  actorId:    Uuid | null;
  detail:     Record<string, unknown>;
}

type RunEventType =
  | 'run_opened'               // workspace entry
  | 'orchestrator_dispatched'  // task split
  | 'delegation_issued'       // per-agent delegation
  | 'nvg_outbound'            // model call sent through NVG
  | 'nvg_inbound'             // model response received
  | 'nvg_denied'              // NVG denied the request
  | 'nxs_action'              // system action through NXS
  | 'partial_result'          // agent returned partial result
  | 'compile_started'         // compile step invoked
  | 'compile_mode_selected'   // deterministic/on-prem/frontier
  | 'final_response'          // response delivered to user
  | 'run_closed'              // run completed
  | 'oct_assignment'          // OCT assigned/changed
  | 'mode_change'             // operating mode changed
  | 'enforcing_lock_disabled' // enforcing-lock disabled (§9.4)
  | 'bypass_annotation';      // NVG bypass run annotated

interface RunLedgerWriter {
  writeEvent(entry: Omit<RunLedgerEntry, 'entryId'>): Promise<void>;
  getByRunId(runId: Uuid): Promise<RunLedgerEntry[]>;
  tail(n: number): Promise<RunLedgerEntry[]>;
  getLatestRunId(): Promise<Uuid | null>;
}
```

### 30.2 Mandatory for All Runs

Run Ledger is mandatory for all runs including NVG-bypass runs (blueprint §22.3).

### 30.3 NVG Bypass Annotation

When a run uses the NVG-bypass path, the Run Ledger must annotate:

```typescript
await runLedger.writeEvent({
  runId,
  eventType: 'bypass_annotation',
  timestamp: nowIso(),
  actorId: null,
  detail: { bypass_path: true, nvg_entries: false },
});
```

An unannotated bypass run is an audit integrity violation.

---

## 31. Compile / Return Path Contract

Blueprint §21.

### 31.1 Three Compile Modes

```typescript
type CompileMode = 'deterministic_render' | 'on_prem_synthesis' | 'frontier_synthesis';

function selectCompileMode(
  inheritedDataClass: DataClass,
  operatorConfig: CompileConfig,
  hasOnPrem: boolean
): CompileMode {
  const isSensitive = isSensitiveDataClass(inheritedDataClass);

  if (isSensitive) {
    // Mode 3 hard-denied for sensitive inputs
    return hasOnPrem ? 'on_prem_synthesis' : 'deterministic_render';
  }

  if (operatorConfig.preferFrontierSynthesis && !isSensitive) {
    return 'frontier_synthesis';
  }

  return hasOnPrem ? 'on_prem_synthesis' : 'deterministic_render';
}
```

### 31.2 OCT-COMPILE Inheritance

The compile actor's effective ceiling = highest data class of all inputs (hard rule).
Not operator-configurable. See §11.4 for implementation.

### 31.3 Reference Deterministic Renderer

Built-in system utility. Exempt from actor registration (blueprint §21.4).
No model calls, no system actions, no delegations.

---

## 32. Reference Identity Adapter

Blueprint §7.4. `packages/identity-ref/src/`.

### 32.1 Scope

Optional starter package. Implements identity-provider interface from Layer 2. Not a
production IAM replacement. Labeled explicitly: "Reference Identity Adapter — starter only."

### 32.2 Internal Types

```typescript
// packages/identity-ref/src/actor-store.ts
interface ReferenceActorStore {
  get(actorIdentifier: NonEmpty): Promise<ReferenceActorRecord | null>;
  register(record: ReferenceActorRecord): Promise<void>;
}

interface ReferenceActorRecord {
  actorId:              Uuid;
  actorClass:           ActorClass;
  principalId:          Uuid;
  environment:          EnvironmentId;
  riskCeiling:          RiskTier;
  allowedSystems:       string[];
  allowedCapabilities?: string[];
  roles?:               string[];
  owner?:               NonEmpty;
  purpose?:             NonEmpty;
  reviewCadence?:       NonEmpty;
}

// packages/identity-ref/src/principal-store.ts
interface ReferencePrincipalStore {
  get(principalId: Uuid): Promise<Principal | null>;
  register(principal: Principal): Promise<void>;
}

// packages/identity-ref/src/auth/
interface ReferenceAuthProvider {
  validate(credentials: AuthCredentials): Promise<NonEmpty>;
}
```

These are identity-ref-internal types (Layer 6). They are not exported to contracts.
Enterprise IAM/RBAC integrations replace these stores entirely.

### 32.3 Implementation

```typescript
class ReferenceIdentityAdapter implements IdentityProviderInterface {
  readonly providerType = 'reference_adapter' as const;
  readonly providerVersion = 'v1.0.0';

  constructor(
    private readonly actorStore: ReferenceActorStore,
    private readonly principalStore: ReferencePrincipalStore,
    private readonly authProvider: ReferenceAuthProvider
  ) {}

  async resolveIdentity(actorIdentifier: NonEmpty): Promise<IdentityClaims | null> {
    const actor = await this.actorStore.get(actorIdentifier);
    if (!actor) return null;
    const principal = await this.principalStore.get(actor.principalId);
    if (!principal) return null;
    return {
      principalIdentity: principal.principalId,
      roleAssignments: actor.roles ?? [],
      capabilityCeilings: [{
        allowedSystems: actor.allowedSystems,
        allowedCapabilities: actor.allowedCapabilities ?? [],
        maxRiskTier: actor.riskCeiling,
      }],
      environmentContext: actor.environment,
      actorClass: actor.actorClass,
    };
  }

  async authenticate(credentials: AuthCredentials): Promise<NonEmpty> {
    return this.authProvider.validate(credentials);
  }
}
```

### 32.3 Upgrade Path

Disable or remove the Reference Identity Adapter and wire in enterprise IAM or RBAC.
No engine changes required — the interface is identical.

---

## 33. Three Audit Stream Cross-Link Law

Blueprint §22.4.

### 33.1 Cross-Link by Run ID

All three streams are cross-linked by run ID. Every entry in every stream for a governed
run carries the same run ID. Missing run ID is an audit integrity violation.

```typescript
function validateCrossLinks(
  routingTrail: RoutingProvenanceTrailEntry[],
  evidenceLedger: EvidenceRecord[],
  runLedger: RunLedgerEntry[],
  runId: Uuid
): CrossLinkValidationResult {
  const errors: string[] = [];

  for (const entry of routingTrail) {
    if (entry.runId !== runId) errors.push(`RPT entry ${entry.entryId} has wrong runId`);
  }
  for (const record of evidenceLedger) {
    if (record.runId !== runId) errors.push(`Evidence ${record.recordId} has wrong runId`);
  }
  for (const entry of runLedger) {
    if (entry.runId !== runId) errors.push(`RunLedger ${entry.entryId} has wrong runId`);
  }

  return { ok: errors.length === 0, errors };
}
```

---

## 34. EvidenceRecord Sentinel / Applicability Law

Blueprint §20.5-20.6. This section defines the exact sentinel encoding for all
applicability-governed fields in EvidenceRecord and CCV.

### 34.1 Sentinel Value

```typescript
// Canonical definition: §12.2 Governed Constants. Repeated here for §34 readability.
export const EVIDENCE_SENTINEL = 'NOT_APPLICABLE' as const;
```

The sentinel is a governed string. It replaces null/undefined for fields that depend on
a gate that has not executed. Fields are never null and never omitted — the record is
structurally complete with every field present in all cases.

### 34.2 Early-Denial Applicability

| Denial at Gate | Fields carrying sentinel |
|---|---|
| Gate 01 (identity) | resolvedVerb, resolvedCapability, resolvedTarget, resolvedDataClasses, resolvedRiskTier, policyRuleId, policyOutcome, approvalRequired, approvalDecisionLabel, all grant metadata fields |
| Gate 02 (classification) | policyRuleId, policyOutcome, approvalRequired, approvalDecisionLabel, all grant metadata fields |
| Gate 03 (delegation) | policyRuleId, policyOutcome, approvalRequired, approvalDecisionLabel, all grant metadata fields |
| Gate 04 (policy deny) | approvalRequired (false on deny, not sentinel), approvalDecisionLabel, all grant metadata fields |

### 34.3 Approval-Field Applicability

ApprovalDecisionLabel carries sentinel on all paths where Gate 05 did not execute:
- Direct ALLOW (Gate 04 → Gate 06, no approval needed)
- Policy DENY
- Early identity/classification/delegation denials
- Error paths bypassing Gate 05

approvalRequired carries sentinel on all paths where Gate 04 did not execute.

### 34.4 Grant-Metadata Applicability

Grant metadata fields carry sentinel on paths where no grant was minted (denials before
Gate 06, approval timeout, policy deny). On paths where a grant was minted but execution
failed (denied_threat or error), grant metadata is populated — the grant existed.

On direct ALLOW paths, approvalLinkage within grant metadata carries sentinel — the grant
is valid but no approval artifact is linked.

---

## 35. Run Artifact Contract

v1.4.12 run artifact contract.

Every run produces these artifacts in `/runs/RUN-<id>/`:

| Filename | Description |
|---|---|
| `01-ingest-log.json` | Actions received, timestamps, ingress results |
| `02-session-manifest.json` | Sessions and actors active in this run |
| `03-actor-manifest.json` | Actor registry snapshots at run time |
| `04-delegation-registry.json` | Delegation contexts active, chain snapshots |
| `05-gate-decision-log.json` | All gate decisions, ordered by ledger sequence |
| `06-policy-evaluation-log.json` | Policy rule evaluations with outcomes |
| `07-approval-record-log.json` | All ApprovalRequests + ApprovalResponses |
| `08-evidence-ledger.jsonl` | Append-only hash-chained evidence records |
| `09-threat-detection-log.json` | All ThreatEvents detected |
| `10-execution-result-log.json` | Execution results, redacted |
| `11-token-posture-report.json` | Token posture at run time |
| `12-run-summary.md` | Human-readable run summary |
| `13-routing-provenance-trail.jsonl` | NVG routing events (new in v1.4.12) |
| `14-run-ledger.jsonl` | Run Ledger entries (new in v1.4.12) |
| `00-failure-log.json` | Written on pipeline crash |

Artifact filenames must match exactly. Any deviation is a ci:gate failure.

---

## 36. Token Posture Report

Interfaces defined in §12.3.32. This section defines generation logic.

### 36.1 Generation

```typescript
async function generateTokenPostureReport(
  runId: string,
  ledger: LedgerBackend,
  actorRegistry: ActorRegistry
): Promise<TokenPostureReport> {
  const records = await ledger.listRange(1, await ledger.getLatestSequence());
  const runRecords = records.filter(r => r.runId === runId);
  const actors = await actorRegistry.list();

  const actorPostures: ActorPosture[] = actors.map(actor => {
    const actorRecords = runRecords.filter(r => r.actionSummary.actorId === actor.actorId);
    const grantCount = actorRecords.filter(r => r.finalOutcome === FINAL_OUTCOME.EXECUTED).length;
    const risks = actorRecords
      .map(r => r.actionSummary.resolvedRiskTier)
      .filter(r => r !== EVIDENCE_SENTINEL) as RiskTier[];
    const maxRisk = risks.reduce((max, r) =>
      RISK_TIER_ORDER.indexOf(r) > RISK_TIER_ORDER.indexOf(max) ? r : max,
      RISK_TIER.LOW
    );
    return {
      actorId: actor.actorId, actorClass: actor.actorClass,
      owner: actor.owner ?? null, environment: actor.environment,
      grantCount, maxRiskSeen: maxRisk,
      hasOwner: !!actor.owner,
    };
  });

  const violations: PostureViolation[] = [];
  for (const actor of actors) {
    const isNonHuman = actor.actorClass !== ACTOR_CLASS.HUMAN &&
                       actor.actorClass !== ACTOR_CLASS.HUMAN_WITH_COPILOT;
    if (isNonHuman && !actor.owner) {
      violations.push({ type: 'unowned_non_human_actor',
        detail: `Actor ${actor.actorId} (${actor.actorClass}) has no owner`,
        actorId: actor.actorId });
    }
    if (isNonHuman && !actor.reviewCadence) {
      violations.push({ type: 'missing_review_cadence',
        detail: `Actor ${actor.actorId} (${actor.actorClass}) has no review cadence`,
        actorId: actor.actorId });
    }
  }

  const grantPatterns: GrantPatternSummary[] = [];
  const capMap = new Map<string, { count: number; expiry: Set<string>;
    external: boolean; approval: boolean }>();
  for (const r of runRecords) {
    if (r.grantMetadata.grantId === EVIDENCE_SENTINEL) continue;
    const cap = r.actionSummary.resolvedCapability as string;
    const entry = capMap.get(cap) ?? { count: 0, expiry: new Set(), external: false, approval: false };
    entry.count++;
    if (r.grantMetadata.expiryClass !== EVIDENCE_SENTINEL) entry.expiry.add(r.grantMetadata.expiryClass);
    if (r.approvalRequired === true) entry.approval = true;
    capMap.set(cap, entry);
  }
  for (const [capId, entry] of capMap) {
    grantPatterns.push({
      capabilityId: capId, count: entry.count,
      expiryClasses: [...entry.expiry] as ExpiryClass[],
      externalFacing: entry.external, approvalRequired: entry.approval,
    });
  }

  return { generatedAt: nowIso(), runId, actors: actorPostures, grantPatterns, violations };
}
```

---

## 37. Validation Gates

v1.4.12 validation gate contract. All gates are enforced by `scripts/ci-gate.ts`.

### 37.1 Default-Deny Gate
`policyFile null` → Gate 04 returns DENY, `denialCode: DENIAL_CODE.DEFAULT_DENY`.
Verified: scenario-07-default-deny exercises this path.

### 37.2 Grant Template Uniqueness Gate
`buildGrantTemplate` called more than once for same `actionId` → throws.
Builder must maintain an in-memory set of actionIds for which templates have been computed.

### 37.3 Evidence Always-Write Gate
Pipeline orchestrator enforces Gate 07 runs for every action. Null guard on
`context.lastEvidenceRecord` after Gate 07 returns. If null → invariant violation throws.

### 37.4 No-Certification-Language Gate (ci:gate step 9)
Reject any artifact containing any of:
`"approved by system"`, `"authorized by engine"`, `"Nexus certifies"`,
`"system confirms compliance"`, `"this action is safe"`, `"compliant action"`.
Post-write grep-based validation across all output files.

### 37.5 Secret-In-Evidence Gate
Reject any EvidenceRecord with field named `secretValue`, `secret`, `password`, `privateKey`
carrying a non-empty string. Validated by scanning serialized evidence records.

### 37.6 Ledger Chain Integrity Gate (ci:gate step 7)
Run `verifyChain()` on the full evidence ledger. Verify Ed25519 signatures, hash chain
linkage, and sequence continuity. Any error → gate failure.

### 37.7 Policy Signature Gate (ci:gate step 10)
All NXS policy files must have valid Ed25519 signatures. Load each policy file via the
policy loader. Unsigned or invalid-signature → gate failure.

### 37.8 CCV Integrity Gate (ci:gate step 8)
For every EvidenceRecord: re-derive CCV from the record body, assert it matches the
stored `compilerView`, then re-hash the full body and assert the hash matches `recordHash`.
Any mismatch → gate failure.

### 37.9 Fixture Secret Prefix Gate (ci:gate step 11)
Every secret value in fixture/test output must begin with `FIXTURE_SYNTHETIC_SECRET:`.
Scan all run artifacts for secret-pattern strings not prefixed correctly.

### 37.10 NVG Routing Policy Signature Gate (new — ci:gate step 12)

All NVG routing policy files must have valid Ed25519 signatures. Unsigned = gate failure.

### 37.11 NVG Classification Enforcement Gate (new — ci:gate step 13)

No routing policy may contain a rule that routes sensitive data to a frontier tier.
Load-time validation.

### 37.12 Run Ledger Cross-Link Gate (new — ci:gate step 14)

All three audit streams for a run share the same runId. Missing runId = gate failure.

### 37.13 Bypass Annotation Gate (new — ci:gate step 15)

NVG-bypass runs must have explicit bypass annotation in the Run Ledger.
Unannotated bypass = gate failure.

### 37.14 Governed Lexical Fixture Existence Gate — Amendment J-S1

`fixtures/lexicon/governed-verb-lexicon.v1.json` must exist and parse as a valid
`GovernedVerbLexicon` shape. Missing file or schema violation = gate failure.

### 37.15 Approved Alias Uniqueness Gate — Amendment J-S1

No approved alias in the governed lexical fixture may map to more than one canonical verb.
Duplicate alias mapping = gate failure.

### 37.16 Hard-Separation Integrity Gate — Amendment J-S1

No term that appears in the `hardSeparated` set of the governed lexical fixture may also
appear in the `approved` set. Overlap = gate failure.

### 37.17 Canonical Verb Membership Gate — Amendment J-S1

Every canonical verb referenced in the governed lexical fixture must exist in the
governed ACTION_VERB constant set. Unknown verb reference = gate failure.

### 37.18 Runtime Bundle Exclusion Gate — Amendment J-S1

`fixtures/lexicon/wordnet-candidate-aliases.v1.json` must not be present in the
production runtime bundle or output. Only the governed lexical fixture
(`governed-verb-lexicon.v1.json`) may be present at runtime. Presence of the
candidate alias file in production output = gate failure.

---

## 38. Testing Requirements

v1.4.12 testing requirements. All test cases listed — no external references.

### 38.1 Unit Tests

One test file per NXS gate (7 files). One test file per NVG classification module (new).
One test file per NVG routing module (new). Min 95% line coverage on gate files.

```
packages/core/src/gates/01-identity.gate.test.ts
packages/core/src/gates/02-classification.gate.test.ts
packages/core/src/gates/03-delegation.gate.test.ts
packages/core/src/gates/04-policy.gate.test.ts
packages/core/src/gates/05-approval.gate.test.ts
packages/core/src/gates/06-execution.gate.test.ts
packages/core/src/gates/07-evidence.gate.test.ts
packages/core/src/ledger/chain-verifier.test.ts
packages/adapters/mcp/src/mcp-normalizer.test.ts
packages/vanguard/src/classifier/data-classifier.test.ts
packages/vanguard/src/router/model-router.test.ts
packages/core/src/classification/lexical-verb-resolver.test.ts
packages/core/src/normalization/lexical-normalizer.test.ts
```

### 38.2 NXS Threat Tests (10)

```
tests/threat/01-replay-detection.test.ts         — same actionId replayed → REPLAY_DETECTED
tests/threat/02-broad-token-bypass.test.ts        — execution without minted grant → BROAD_TOKEN_BYPASS
tests/threat/03-injection-truncation.test.ts      — oversized intent field → TRUNCATED
tests/threat/04-expired-grant.test.ts             — execution with expired grant → GRANT_EXPIRED
tests/threat/05-delegation-expansion.test.ts      — sub-agent exceeds parent scope → DENIED
tests/threat/06-policy-signature-invalid.test.ts  — tampered policy file → REJECTED at load
tests/threat/07-environment-mismatch.test.ts      — cross-env delegation → ENVIRONMENT_MISMATCH
tests/threat/08-scope-expansion.test.ts           — capability not in delegation → DENIED
tests/threat/09-approval-forgery.test.ts          — invalid approver signature → DENIED
tests/threat/10-rate-limit.test.ts                — >60 actions/minute → RATE_LIMITED
```

### 38.3 NVG Threat Tests (3, new in v1.4.12)

```
tests/threat/11-nvg-wall-violation.test.ts        — sensitive data routed to frontier → hard deny
tests/threat/12-nvg-policy-unsigned.test.ts        — unsigned routing policy → rejected at load
tests/threat/13-nvg-oct-ceiling.test.ts            — OCT-SECURE actor requesting frontier → denied
```

### 38.4 NXS Integration Tests (10)

All 10 NXS integration tests use StubConnector. Each test loads the corresponding fixture
from SCENARIO_MANIFEST, bootstraps actors/principals/delegations/sessions, runs the pipeline,
and asserts on the EvidenceRecord.

```
tests/integration/scenario-01-allow-read.test.ts
tests/integration/scenario-02-allow-create.test.ts
tests/integration/scenario-03-approval-approved.test.ts
tests/integration/scenario-04-approval-denied.test.ts
tests/integration/scenario-05-approval-timeout.test.ts
tests/integration/scenario-06-replay-detected.test.ts
tests/integration/scenario-07-default-deny.test.ts
tests/integration/scenario-08-policy-unsigned.test.ts
tests/integration/scenario-09-broad-token-bypass.test.ts
tests/integration/scenario-10-delegation-exceeded.test.ts
```

### 38.5 NVG Integration Tests (new in v1.4.12)

Test NVG outbound classification, routing, denial, and inbound logging. Verify Routing
Provenance Trail entries are written and cross-linked by run ID.

### 38.6 Deterministic Replay Test

CCV must be byte-identical across runs for scenarios 01, 02, 03. Run each scenario twice,
extract CCV from both runs, assert deep equality on all `areComparable` fields (§14.4).

### 38.7 Cross-Link Tests (new in v1.4.12)

Verify all three audit streams carry same runId for governed runs. Run a full scenario,
collect entries from all three streams, assert every entry has the correct runId.

### 38.8 Lexical Normalization Tests — Amendment J-S1

```
packages/core/src/classification/lexical-verb-resolver.test.ts
  — approved alias maps deterministically to canonical verb
  — hard separation: 'query' does not collapse to 'execute'
  — hard separation: 'send' does not collapse to 'publish'
  — hard separation: 'search' does not collapse to 'read'
  — hard separation: 'publish' does not collapse to 'transmit'
  — ambiguous alias emits null (unresolved) — never a guess
  — unknown raw term emits null (unresolved)

packages/core/src/normalization/lexical-normalizer.test.ts
  — lexical cleanup assists normalization without making governance decisions
  — unresolvable raw verb returned unchanged (Gate 02 handles denial)
  — normalizer never loads wordnet-candidate-aliases.v1.json at runtime

tests/lexicon/governed-verb-lexicon.consistency.test.ts
  — approved, forbidden, hard-separated, and review-required sets are internally consistent
  — no approved alias maps to more than one canonical verb
  — no hard-separated term appears in approved set
  — all canonical verbs in fixture exist in ACTION_VERB constant set
```

---

## 39. Failure Handling

Failure handling law.

### 39.1 Pipeline Crash Recovery

Partial EvidenceRecord preferred to none.

### 39.2 Startup Failures

Policy signature invalid → exit. DB init fails → exit. Admin token missing → exit with
`nexus init` instructions.

### 39.3 Ledger Write Failure

Emit to stderr, set non-zero exit code. Do not swallow.

---

## 40. Build Sequence

Blueprint §28. Layer order is law. Gate design precedes implementation.

```
PHASE 1 — Layer 2 (contracts)
  1.  All governed type constants, all interfaces, all contract shapes
  2.  AgentAction schema, identity-provider interface
  3.  Gate interface, ledger backend interface, adapter interface, connector interface,
      approval channel interface, Run Ledger interface
  4.  Zod schemas, error classes, NexusSecurityViolation

PHASE 2 — Layer 1 (NXS core engine)
  5.  Crypto layer: canonicalize, sign, verify, sha256, key-manager, gen-keys
  6.  Database schema: SQLite init, all tables
  7.  Registry implementations: principal, actor, approver, session store, delegation store,
      replay detector, delegation sequences
  8.  Delegation engine: mintRootDelegation with environment invariant
  9.  Classification layer: verb normalizer, target normalizer, capability registry,
      data classifier, risk classifier, lexical-verb-resolver (Amendment J-S1)
  9a. Lexical layer (Amendment J-S1): run lexicon:build to generate governed lexical
      fixture; commit fixtures/lexicon/governed-verb-lexicon.v1.json; run
      lexicon:validate; wire lexical-verb-resolver into verbNormalizer pipeline
  10. Gates 01-04 with unit tests
  11. Gates 05-07 with approval, evidence, and unit tests
  12. Pipeline orchestrator (explicit branch, not loop)
  13. Policy layer: loader, evaluator, grant template builder, default policy
  14. Approval layer: packager, CLI channel, pending approval store, decision service
  15. Ledger layer: JSONL backend, chain verifier
  16. Security layer: replay, injection guard, rate limiter, threat log, grant vault
  17. CCV materialization: builder, normalized action hash
  18. Redaction layer

PHASE 3 — Layer 3 (NVG vanguard)
  19. Data classifier, label reader
  20. Routing policy engine, model router, tier registry
  21. Model health monitor
  22. Routing Provenance Trail writer
  23. Inbound response logger and normalizer

PHASE 4 — Layer 4 (adapters)
  24. MCP Adapter v1 (full implementation, no auto-create sessions)

PHASE 5 — Layer 5 (connectors)
  25. StubConnector (all capabilities)
  26. HashiCorp Vault connector (reference)

PHASE 6 — Layer 6 (identity-ref)
  27. Reference Identity Adapter (optional)

PHASE 7 — Layer 7 (control interface)
  28. CLI: all commands, --approver-id on approve/deny, nexus init, bin wiring
  29. Management API: 127.0.0.1 bind, admin token, all routes

PHASE 8 — Tests and fixtures
  30. Ten NXS scenario fixtures via SCENARIO_MANIFEST
  31. NVG scenario fixtures
  32. NXS unit tests (one per gate, 95% coverage)
  33. NXS threat tests (10)
  34. NVG threat tests (3)
  35. NXS integration tests (10, StubConnector)
  36. NVG integration tests
  37. Deterministic replay test
  38. Cross-link tests
  39. Approval expiry invariant test
  40. Sequence continuity test
  41. ci:gate script (all 16 steps)
  42. Run artifact validation
  43. Clean-clone assertion
```

Each push checkpoint from §6.5 aligns to completion of its phase's gates.

---

## 41. Known Holes Log

### 41.1 Open Holes

None.

### 41.2 Closed Holes

All SOLVE-001 through SOLVE-022 and CONTRA-509 are closed.
Full closure log is maintained in the audit record.

HOLE-001 | `callEndpoint()` — CLOSED in v1.6.22. Contract defined in §24.5:
`ModelEndpointResponse` interface, five governed transport invariants, reference
implementation with timeout and unreachable denial codes. HTTP implementation
remains connector-specific; contract shape is spec law.

HOLE-002 | `ModeConfiguration.updatedBy` — CLOSED in v1.6.22 via SOLVE-021.
Field changed from `Base64Url` to `{ adminId: NonEmpty; publicKey: Base64Url }`.
Admin identity binding via filesystem key directory (`keys/admins/<adminId>.public.json`).
Production upgrade path: swap filesystem lookup for enterprise IAM — same shape.

---

## 42. Deployment Trust Boundary Invariants

Blueprint §26.2, §10.3. Production Kubernetes manifests are out of scope for this build
(§4.2). This section pins the trust boundary invariants that any deployment target —
Kubernetes, docker-compose, systemd, or bare metal — must satisfy. These invariants are
testable in the POC via CI gate and integration tests.

**INV-001**: Management API must bind to 127.0.0.1 only (or mTLS/Unix socket in
production upgrade). No network-exposed management surface without transport-layer
mutual authentication.

**INV-002**: Admin bearer token must not be embedded in container images, environment
variables visible to non-admin processes, or version control. Token is generated at
initialization and stored at `keys/admin.token` (gitignored).

**INV-003**: Key material (control-plane keypair, approver keypairs, admin keys) must
not be baked into container images. Keys are mounted at runtime via volume, secret
store, or init container.

**INV-004**: Ledger storage (Evidence Ledger, Run Ledger, Routing Provenance Trail)
must be persistent across container restarts. Ephemeral container filesystems are not
valid ledger backends.

**INV-005**: Single-node constraint must be documented in operator notes for any
deployment that does not implement multi-node replication (out of scope this build).
Concurrent writes to JSONL ledger files from multiple processes are not safe.

**INV-006**: Enforcing-lock must be the default production configuration. Any
deployment manifest that starts in Observe or Advisory mode must document the
onboarding timeline to Enforcing.

**INV-007**: NVG hard wall enforcement must not be bypassable by deployment
configuration. No environment variable, feature flag, or manifest annotation may
disable the sensitive-data/frontier-tier wall.

**INV-008**: The two checkpoints (NVG wall enforcement, NXS action authority) must
be independently deployable. A deployment that omits NVG must still enforce NXS
action governance. A deployment that omits NXS must still enforce NVG wall policy.

Production deployment pathway: satisfy all INV invariants → containerize with
`pnpm start` or `node` entrypoint → mount keys and ledger volumes → set admin token
via secret → configure operating mode → enable enforcing-lock.

---

## 43. Completion Criteria

ALL of the following must be true:

- ci:gate passes all 16 steps from a clean clone
- all 10 NXS POC scenario integration tests pass (using StubConnector)
- all NXS threat tests pass (10)
- all NVG threat tests pass (3)
- deterministic replay test passes (CCV identical for scenarios 1, 2, 3)
- ledger chain integrity verifies on full integration test ledger
- CCV integrity gate passes: CCV inside signed body for every record
- no evidence record in any fixture run contains a secret value field
- no artifact contains prohibited certification language
- no gate order violation is possible at runtime
- policy signature gate passes for all NXS fixture policy files
- NVG routing policy signature gate passes for all NVG policy files
- NVG classification enforcement gate passes
- Run Ledger cross-link gate passes
- Bypass annotation gate passes for NVG-bypass runs
- MCP adapter correctly normalizes all 10 fixture scenario requests
- CLI approve and deny commands produce signed ApprovalResponses verifiable by Gate 05
- nexus session start and nexus delegate can bootstrap a full scenario from zero
- nexus run --fixtures all completes and writes all required run artifacts
- token posture report generates without error for all 10 scenarios
- all run artifacts match exact filename contract
- all EvidenceRecords carry non-empty actorClass, actorEnvironment, delegationSequence
- all DelegationContextSnapshots carry environment field
- computeFinalOutcome uses denialCode, not reason string
- Gate 03 denies with CHAIN_INTEGRITY_BROKEN when parent delegation missing
- gate interface evaluate() signature matches across all gate files and orchestrator
- no adapter-provided environment value influences risk computation or gate decisions
- rate-limiter single-process limitation is documented
- sentinel encoding is correct for all applicability-governed fields
- three audit streams are cross-linked by run ID for all governed runs
- NVG hard wall enforced: sensitive data cannot reach frontier tiers

---

## 44. Final Spec Statement

This document is the **canonical engineering spec** for the Nexus Stack build.
Status: CANONICAL — governing law / build not yet build-cleared.

Nexus Stack v1.5.13 is a two-checkpoint, seven-layer, TypeScript-strict governed runtime.
Two enforcement checkpoints: NVG (wall enforcement) and NXS (action authority). Three
audit streams cross-linked by run ID. Seven gates in fixed order, default-deny. Gate 07
always runs. Timeout produces denial, never auto-approval. The machine governs, routes,
mints bounded execution authority, classifies data, enforces model-tier ceilings, and
produces tamper-evident proof. Human operators remain the final decision authority.

Blueprint governs purpose and architecture.
Spec governs implementation law.
No spec section may contradict blueprint law. Blueprint wins all conflicts.
Build instructions govern builder-session behavior only.

---

*Spec version: v1.8.26 — CANONICAL*
*Owner: James Huson / Lake Area LLC*
*Date: 2026-04-21*
*Governing blueprint: nexus-blueprint-v1-5-13.md*
*Governing ratification: nexus-owner-ratification-v1-4-12.md*
*Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (LOCKED)*
*Supersedes: nexus-engineering-spec-v1-7-25.md*
*Incorporates: Amendment J-S1 — WordNet Build-Time Lexical Integration (merged, superseded)*
