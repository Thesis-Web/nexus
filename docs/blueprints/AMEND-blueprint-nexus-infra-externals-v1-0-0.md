# Nexus Stack — Externals Infrastructure Blueprint
# Version: v0.5-draft
# Status: DRAFT — ratification-readiness fixes incorporated; not canonical until owner ratification
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-30
# Governing precedence: see
#   docs/alignment/nexus-component-outline-v0-1-0.md §Governing Precedence
# (Ratified chain 2026-05-23: end-to-end flow v4.8 / owner-ratification v1.4.12 /
#  component outline v0.1.0 / blueprint v1.5.13 / engineering spec v1.8.26 /
#  owner-approved AMENDs / implementation. Older "Governing canon: blueprint,
#  spec, end-to-end flow" header was retired 2026-05-23 — fix-spec post-
#  consolidation, §11 Document Hygiene Law — because it omitted the outline
#  and the locked owner-ratification document, both above this AMEND in the
#  chain.)

## 0. Ratification / Addition Log

This draft is architecturally additive to the current canonical Nexus Stack law. It does not replace NXS gate law, NVG wall law, OCT law, Run Ledger law, or the existing manifold/signed-manifest pattern.

| ID | Type | Description | Status |
|---|---|---|---|
| ADD-EXT-001 | ADD | Return mailbox as baked infrastructure primitive. Current blueprint/spec define governed compile/return and workspace-only final response, but do not define an explicit mailbox primitive. | PENDING owner ratification |
| ADD-EXT-002 | ADD | Explicit forbidden output paths: no direct agent/model/NXS-connector output to workspace final response. Current canon implies this through governed loop/final response law; this draft makes it explicit. | PENDING owner ratification |
| AMEND-EXT-001 | RULE | Engineering spec amendment required after architecture ratification for new contracts, manifest schemas, bootstrap steps, placement law, CI gates, mailbox service law, and lawful output-collector wiring. | PENDING ratification |
| FIX-EXT-001 | FIX | v0.2 mailbox placement/wiring risk corrected: engines do not import mailbox internals. NXS/NVG emit contract-level result references; composition/output collector writes mailbox items. | APPLIED in v0.3 |
| FIX-EXT-002 | FIX | Compiler actor law added: only reference deterministic renderer is actor-registration exempt; all model/third-party/custom compilers require registered OCT-COMPILE actor. | APPLIED in v0.3 |
| FIX-EXT-003 | FIX | Socket IDs and actor UUIDs separated to avoid manifest/contract ID drift. | APPLIED in v0.3 |
| FIX-EXT-004 | FIX | OCT-SECURE baked loop now enforced by infra invariants and gates, not by trusting replaceable plugins. | APPLIED in v0.3 |
| FIX-EXT-005 | FIX | Mailbox read/compile eligibility law added: digest/classification/status/cancellation gates must pass before compile reads. | APPLIED in v0.3 |
| ADD-EXT-003 | ADD | Existing RunEventType lifecycle remains canonical; externals must emit existing lifecycle events where semantically applicable instead of creating parallel event families. | PENDING owner ratification |
| ADD-EXT-004 | ADD | Runtime plugin loading is manifest-governed and restricted to signed, approved, version-pinned, factory-validated entries. No arbitrary runtime package execution from YAML. | PENDING owner ratification |
| ADD-EXT-005 | ADD | `packages/contracts` / `@nexus/contracts` is the public compatibility surface for plugin authors. Core/Vanguard internals are not plugin dependency surfaces. | PENDING owner ratification |
| RULE-EXT-001 | RULE | Modal language law: SHALL/MUST are mandatory, SHOULD is recommended with documented exception, MAY is optional only. | APPLIED in v0.4 |

Owner feedback and audit fixes applied in v0.3:

- Mailbox is logged as new architecture, not treated as already canonical.
- Explicit forbidden output paths are logged as additive law.
- Bootstrap expansion is phased, not big-bang.
- Mailbox contract types/interfaces live in `packages/contracts`.
- Baked mailbox implementation lives in `packages/core/src/mailbox`, but cross-engine writes occur through contracts-level output collector and lawful composition root, not direct NVG→core coupling.
- `ExecutionResult` stays lean; payload return metadata lives on `MailboxItem`. Evidence may store mailbox item reference/digest for cross-link.
- V1 mailbox backend decided: local JSONL metadata + filesystem payload references.
- Reference harness route namespaces accepted: `/workspace/*`, `/orchestrator/*`, `/mailbox/*`, `/compile/*`, `/compile-return/*`.
- Cross-domain collisions fail closed for all required external socket domains.
- Raw prompt is volatile transit data; long-term storage uses prompt digest and optional governed prompt reference, not raw prompt by default.
- Runtime plugin composition SHALL be manifest-governed; setup/discovery tooling is separate from runtime trust.
- Manual onboarding SHALL be supported; guided discovery SHOULD be supported where environment permits; automatic local-service discovery MAY be offered as convenience only.

Owner feedback and audit fixes applied in v0.5:

- Ratification criteria now include ADD-EXT-003, ADD-EXT-004, and ADD-EXT-005.
- Output reference types used by OutputCollector are explicitly deferred to AMEND-EXT-001.
- MailboxItem state transitions are stated at architecture level and field-level transition machinery is deferred to AMEND-EXT-001.
- NVG routing policy is clarified as signed infrastructure policy, not a plugin registry manifest.
- `signed_callback` is clarified as a spec-defined compile-return authentication profile.
- Existing RunEventType lifecycle and MCP `X-Nexus-Run-Id` wire are inherited anchors and SHALL be used by new externals work.

## 1. Purpose

This blueprint defines the external infrastructure surface around the Nexus Stack: the sockets, signed manifests, transport wires, return mailbox, compile-return path, and the hard OCT-SECURE loop that close the governed runtime from user entry to final response.

This blueprint does not define the internals of the reference workspace, reference orchestrator, or reference compiler. Those are separate plugin blueprints. This document defines where those plugins attach and which parts are baked infrastructure law.

## 2. Core Thesis

The Nexus Stack must provide a governed space with plugs and wires. Enterprises SHALL be able to use Nexus reference plugins or replace them with their own workspace, orchestrator, compiler, identity provider, model endpoints, connectors, and approval channels through approved external-surface manifests.

The following SHALL be treated as baked infrastructure primitives. Items marked additive require owner ratification before spec/build work:

- signed external-surface manifests loaded by the manifold/bootstrap root;
- runId propagation from workspace entry through all runtime paths;
- lawful external socket registry and output collector;
- return mailbox primitive (ADD-EXT-001);
- output contract metadata recorded by runId;
- compile-return endpoint back to workspace;
- OCT-SECURE loop as the strict built-in most-secure path;
- audit writes to Run Ledger, Routing Provenance Trail, and Evidence Ledger as applicable.

The following SHALL remain replaceable plugin implementations behind baked sockets/contracts:

- workspace implementation;
- orchestrator implementation;
- compiler implementation, except reference deterministic renderer utility law;
- identity/IAM/RBAC provider implementation;
- model endpoint providers/transports;
- connector/action target implementations;
- approval channel implementations;
- observability/export implementations.

Reference plugins SHALL be defaults, not architectural dependencies.

## 2.1 Modal Language Law

This blueprint uses enforceable modal language.

- **SHALL** means a mandatory architecture requirement.
- **MUST** means a hard technical invariant or fail-closed condition.
- **SHOULD** means recommended default; exceptions require explicit documented reason.
- **MAY** means genuinely optional capability and must not be relied on by core runtime law.

Architecture, manifest, bootstrap, mailbox, output routing, OCT-SECURE, and compile-return requirements SHALL use SHALL/MUST language. MAY is permitted only for optional tooling conveniences such as automatic local-service discovery.

## 2.2 Public Compatibility Surface Law

`packages/contracts` / future `@nexus/contracts` SHALL be the public compatibility surface for external plugins. Workspace, orchestrator, compiler, identity, connector, channel, and model transport plugins SHALL import only the contracts package for Nexus runtime contracts.

Core and Vanguard internals SHALL NOT be plugin dependency surfaces. Plugins MUST NOT import `packages/core`, `packages/vanguard`, or internal engine files. Runtime composition occurs through signed manifests, factory validation, and the lawful bootstrap/composition root.

Reference plugin implementations MAY start inside the monorepo for development, but their plugin integration surface SHALL remain the contracts package and signed manifests so they can later be extracted without changing core law.

## 2.3 Integration Onboarding vs Runtime Loading Law

The system SHALL distinguish setup-time onboarding from runtime bootstrap.

Setup/onboarding tooling SHALL support manual manifest creation and approved package onboarding. It SHOULD support guided discovery where environment and permissions permit. It MAY offer automatic local-service discovery for convenience only.

Runtime bootstrap SHALL load external plugins only through signed, schema-valid, approved manifests. Runtime bootstrap MUST NOT execute arbitrary packages declared by untrusted YAML.

A runtime-loadable plugin manifest entry MUST declare at minimum:

- plugin/socket identifier;
- approved package identifier or local implementation identifier;
- pinned version;
- exported factory entrypoint;
- expected contract version;
- enabled/disabled state;
- domain-specific configuration body;
- Ed25519 signature over canonicalized manifest body.

Runtime bootstrap MUST reject:

- unsigned manifests;
- invalid signatures;
- schema-invalid bodies;
- unapproved package identifiers;
- missing or mismatched contract versions;
- missing factory exports;
- duplicate required-domain identifiers;
- cross-domain socket collisions in required external domains.

Package hash pinning SHOULD be supported and SHOULD be required for marketplace or third-party package onboarding once package distribution is implemented. Local development manifests MAY omit package hashes only under explicit development mode and never in enforcing production mode.

## 3. Current Repo Anchors

Existing pinned manifold/config surfaces already present:

- `scripts/nexus-main.ts` — composition root entry point.
- `scripts/nexus-bootstrap.ts` — current 12-step bootstrap root.
- `packages/runtime-utils/src/manifest/load-signed-manifest.ts` — generic signed manifest loader.
- `config/identity/providers.v1.yaml` — identity provider manifest, currently `ria`.
- `config/connectors/connectors.v1.yaml` — connector manifest.
- `config/channels/channels.v1.yaml` — approval channel manifest.
- `config/nvg/endpoints.v1.yaml` — model endpoint manifest.
- Existing `RunEventType` lifecycle already covers `run_opened`, `orchestrator_dispatched`, `delegation_issued`, `nvg_outbound`, `nvg_inbound`, `nvg_denied`, `nxs_action`, `partial_result`, `compile_started`, `compile_mode_selected`, `final_response`, and `run_closed`; externals SHALL emit these existing events where semantically applicable instead of creating parallel lifecycle enums.
- Existing MCP normalization already requires a workspace-assigned `X-Nexus-Run-Id`; `WorkspaceRunRequest` SHALL formalize that existing runId wire rather than replacing it.
- `packages/core/src/ledger/run-ledger.ts` — Run Ledger backend.
- `packages/interfaces/api/src/routes/run-ledger.ts` — Run Ledger API read surface.
- `packages/adapters/mcp/src/mcp-normalizer.ts` — currently requires workspace-assigned `X-Nexus-Run-Id`.

Current missing or incomplete surfaces:

- workspace manifest;
- orchestrator manifest;
- mailbox manifest/backend;
- compiler manifest;
- compile-return/output manifest;
- output contract schema;
- mailbox item schema;
- contracts-level output collector interface;
- explicit NXS/NVG/orchestrator output-to-mailbox wiring through composition root;
- compile reads from mailbox by `runId`;
- compile-return endpoint back to workspace.

## 4. External Infrastructure Flow

Canonical external infrastructure flow:

```text
IAM/RBAC/Auth provider
  → Workspace socket
  → Orchestrator socket
  → Nexus manifold / internal runtime
  → Contracts-level output collector
  → Internal output contract
  → Return mailbox
  → Compile socket
  → Compile-return endpoint
  → Workspace final display
```

Expanded runtime flow:

```text
1. User enters through governed workspace surface.
2. Workspace authenticates through configured identity provider/RBAC/RIA-compatible source.
3. Workspace assigns runId and opens Run Ledger entry.
4. Workspace sends WorkspaceRunRequest to configured orchestrator socket.
5. Orchestrator plans deterministically by default and activates selected agents for the run.
6. Agents call NVG for model-bound work and NXS for system-action work.
7. NVG/NXS results and agent partials emit contract-level output events/references.
8. Composition/output collector writes eligible return mailbox slots by runId.
9. Run Ledger records output contract metadata and mailbox item references.
10. Compiler reads approved mailbox items by runId through compile socket.
11. Compiler selects compile mode under OCT-COMPILE inheritance law.
12. Compiler writes FinalResponseArtifact to compile-return endpoint.
13. Workspace displays final response.
14. Run Ledger writes final_response and run_closed.
```

## 5. Baked vs Replaceable Boundary

| Surface | Baked or replaceable | Reason |
|---|---:|---|
| Manifold/bootstrap config root | Baked | Owns lawful composition and signed manifest loading. |
| External socket registry | Baked | Owns socket identity, cross-domain collision checks, and plug wiring. |
| Output collector | Baked | Lawful composition boundary that turns engine result references into mailbox items. |
| Identity provider socket | Baked socket, replaceable provider | Nexus consumes claims; provider may be RIA/RBAC/IAM. |
| Workspace socket | Baked socket, replaceable implementation | Workspace is required entry point, but enterprise may bring its own. |
| Reference workspace | Replaceable plugin | Default implementation only. |
| Orchestrator socket | Baked socket, replaceable implementation | Orchestrator envelope is governed; implementation is enterprise-owned. |
| Reference orchestrator | Replaceable plugin | Default implementation only. |
| Return mailbox | Baked primitive | Needed to close output path without making workspace/orch/compiler own transport. |
| Mailbox backend | Baked interface, replaceable backend | JSONL/local backend may be reference; storage backend can change. |
| Compiler socket | Baked socket, replaceable implementation | Compile is governed by OCT-COMPILE, but implementation is replaceable. |
| Reference deterministic compiler | Built-in utility / reference plugin | Makes no model calls, actions, or delegations; actor-registration exempt under existing compile renderer law. |
| Non-reference compiler | Replaceable plugin, registered actor required | Any custom/third-party/on-prem/frontier compiler is an OCT-COMPILE actor. |
| Compile-return endpoint | Baked wire contract, replaceable transport | Required final-response path to workspace. |
| OCT-SECURE loop | Baked | Most secure loop must not depend on customer plugin behavior. |
| Model endpoints | Baked socket, replaceable endpoints | Existing NVG endpoint manifest pattern. |
| Connectors | Baked socket, replaceable connectors | Existing connector manifest pattern. |
| Approval channels | Baked socket, replaceable channels | Existing channel manifest pattern. |

## 6. Manifest Expansion Law

The existing signed manifest pattern SHALL be extended. The manifold/bootstrap root MUST load the following external surface manifests in governed runtime mode:

Existing plugin/registry manifests:

```text
config/identity/providers.v1.yaml
config/connectors/connectors.v1.yaml
config/channels/channels.v1.yaml
config/nvg/endpoints.v1.yaml
```

Clarification: `config/nvg/routing-policy.v1.yaml` remains signed infrastructure policy loaded by bootstrap/NVG policy law. It is not a plugin registry manifest, and this blueprint does not reclassify it as one.

New:

```text
config/workspace/workspaces.v1.yaml
config/orchestrators/orchestrators.v1.yaml
config/mailbox/mailboxes.v1.yaml
config/compile/compilers.v1.yaml
config/output/compile-return.v1.yaml
```

All new manifests SHALL follow the existing signed envelope:

```yaml
manifestVersion: '1.0'
issuer: nexus-dev
issuedAt: '<iso timestamp>'
signature: '<ed25519 signature over canonicalized body>'
body:
  ... domain-specific body ...
```

Manifest loading invariants:

- unsigned manifest: reject at load time;
- invalid signature: reject at load time;
- schema-invalid body: reject at load time;
- all-disabled manifest for required baked primitive: fail closed;
- duplicate identifiers within a domain: fail closed;
- cross-domain identifier collisions across required socket domains: fail closed;
- orphan sockets or references to disabled domains: fail closed.

## 7. Proposed Manifest Shapes

### 7.1 Workspace Manifest

```yaml
body:
  workspaces:
    - workspaceSocketId: reference-workspace
      workspaceType: reference_http
      enabled: true
      entryMode: governed_only
      baseUrl: http://localhost:4100
      returnEndpointId: reference-workspace-return
      capabilities:
        promptEntry: true
        planReview: true
        finalDisplay: true
        fileSpace: false
      configuration: {}
```

Law:

- Workspace implementation is replaceable.
- Workspace socket is not optional in governed enterprise mode.
- Workspace assigns `runId`.
- Workspace does not call LLMs as part of entry, return, or display.
- Workspace MAY display plan check-back UI, but plan creation SHALL belong to orchestrator socket.
- Raw prompt is volatile transit content. Long-term storage stores prompt digest and metadata only by default.

### 7.2 Orchestrator Manifest

```yaml
body:
  orchestrators:
    - orchestratorSocketId: reference-orchestrator
      orchestratorType: reference_deterministic
      enabled: true
      orchestratorActorId: '<registered-orchestrator-actor-uuid>'
      plannerMode: deterministic_first
      maxSplitDepth: 3  # plannertype-scoped — 'db-lexicon-transformer-v0' allowance is 3 per AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.7.1
      planCheckbackDefault: true
      secureMode:
        octSecureDefault: single_agent_no_helper
        allowSecureMultiAgentOnlyBySignedPolicy: true
      retryPolicy:
        transientAutoRetryCount: 1
      timeouts:
        systemActionMs: 30000
        modelCallMs: 60000
      configuration: {}
```

Law:

- Orchestrator implementation is replaceable.
- Orchestrator actor must be registered and have OCT assignment.
- Default V1 planning is deterministic-first, not LLM-first.
- One split level max for V1.
- OCT-SECURE default path bypasses helper and multi-agent unless signed policy permits.
- `orchestratorSocketId` is a manifest/socket ID; `orchestratorActorId` is the registered actor UUID.

### 7.3 Mailbox Manifest

```yaml
body:
  mailboxes:
    - mailboxId: core-return-mailbox
      mailboxType: local_jsonl_reference
      enabled: true
      required: true
      storageRoot: runs/mailbox
      retentionPolicy:
        payloadTtlSeconds: 3600
        metadataRetention: run_ledger
      classificationRequired: true
      digestRequired: true
      configuration: {}
```

Law:

- Mailbox primitive is baked.
- Mailbox implementation/backend may be replaceable behind the mailbox interface.
- Mailbox items are scoped by `runId`, `agentId`, `taskId`, and `slotId`.
- Mailbox does not call LLMs.
- Mailbox does not make governance decisions.
- Mailbox stores/references returned payloads and classifications; Run Ledger stores metadata and references.
- Mailbox service implementation may live in `packages/core/src/mailbox`, but engines must not import across layers to reach it. Writes are mediated through contracts-level interfaces and lawful bootstrap composition.

### 7.4 Compiler Manifest

```yaml
body:
  compilers:
    - compilerSocketId: reference-deterministic-compiler
      compilerType: reference_deterministic_renderer
      enabled: true
      actorRegistration: exempt_reference_deterministic_renderer
      compilerActorId: null
      octMode: OCT-COMPILE
      allowedModes:
        - deterministic_render
      readsFromMailboxId: core-return-mailbox
      outputContractVersion: v1
      configuration: {}

    - compilerSocketId: customer-onprem-compiler
      compilerType: customer_onprem_synthesis
      enabled: false
      actorRegistration: required
      compilerActorId: '<registered-oct-compile-actor-uuid>'
      octMode: OCT-COMPILE
      allowedModes:
        - on_prem_synthesis
      readsFromMailboxId: core-return-mailbox
      outputContractVersion: v1
      configuration: {}
```

Law:

- Compiler implementation is replaceable.
- Compiler cannot authorize actions.
- Compiler cannot alter evidence or run ledger history.
- Compiler reads mailbox items by `runId` after mailbox eligibility checks pass.
- Compiler MUST call a model only if compile mode law allows it.
- Reference deterministic compiler makes no model calls and is actor-registration exempt.
- Any non-reference compiler, third-party compiler, on-prem synthesis compiler, or frontier synthesis compiler must be a registered OCT-COMPILE actor.
- `compilerSocketId` is a manifest/socket ID; `compilerActorId` is the registered actor UUID when required.

### 7.5 Compile-Return Manifest

```yaml
body:
  returnEndpoints:
    - returnEndpointId: reference-workspace-return
      endpointType: http_callback
      enabled: true
      targetWorkspaceSocketId: reference-workspace
      url: http://localhost:4100/nexus/compile-return
      auth:
        kind: signed_callback
      acceptedArtifactTypes:
        - final_response.v1
      configuration: {}
```

Law:

- `signed_callback` is a compile-return authentication profile defined by AMEND-EXT-001. At architecture level, it means the final response callback must carry a verifiable authenticity binding for the configured compiler/return endpoint and artifact digest. The exact signature envelope, key source, and verification procedure are engineering-spec work.
- Compile-return is a transport endpoint, not an LLM call.
- Compile-return delivers final artifact to workspace display surface.
- It must include `runId`, `artifactDigest`, classification summary, and evidence/run-ledger references.
- Workspace MUST reject invalid signature or digest mismatch.

## 8. Core Contracts

### 8.1 WorkspaceRunRequest

```typescript
interface WorkspaceRunRequest {
  runId: Uuid;
  userId: NonEmpty;
  principalId: Uuid;
  authenticatedBy: NonEmpty;
  enteredAt: IsoTimestamp;
  prompt: NonEmpty;              // volatile transit only; not long-term stored by default
  promptDigest: Sha256Hex;
  promptRef: NonEmpty | null;     // optional governed short-lived reference if configured
  selectedAgentIds: Uuid[];
  workspaceSocketId: NonEmpty;
  planCheckbackRequested: boolean;
}
```

Notes:

- `prompt` is not stored in long-term history by default.
- Run Ledger stores prompt digest and metadata, not raw prompt.
- File space is reserved but not implemented in V1.

### 8.2 OrchestratorPlanPreview

```typescript
interface OrchestratorPlanPreview {
  runId: Uuid;
  orchestratorSocketId: NonEmpty;
  orchestratorActorId: Uuid;
  plannerMode: 'deterministic' | 'policy_template' | 'llm_assisted';
  selectedAgents: Array<{
    agentId: Uuid;
    taskId: Uuid;
    taskSummary: NonEmpty;
    requiresNvg: boolean;
    requiresNxs: boolean;
    estimatedRisk: RiskTier | EvidenceSentinel;
  }>;
  requiresUserApproval: boolean;
  planDigest: Sha256Hex;
}
```

### 8.3 MailboxItem

```typescript
interface MailboxItem {
  mailboxItemId: Uuid;
  mailboxId: NonEmpty;
  runId: Uuid;
  taskId: Uuid;
  agentId: Uuid;
  slotId: NonEmpty;
  sourceType: 'nvg_result' | 'nxs_execution_result' | 'agent_partial';
  resultRef: NonEmpty;
  resultDigest: Sha256Hex;
  resultClassifications: DataClass[];
  octLevel: OctLevel;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp | null;
  evidenceRecordId: Uuid | null;
  routingTrailRecordId: Uuid | null;
  runLedgerEventId: Uuid | null;
  redactionState: 'not_required' | 'redacted' | 'blocked';
  mailboxStatus: 'available' | 'blocked' | 'cancelled' | 'expired' | 'consumed';
  compileEligible: boolean;
}
```

Compile eligibility law:

- `resultDigest` must verify against `resultRef`.
- `resultClassifications` must be non-empty when classificationRequired is true.
- `redactionState` must not be `blocked`.
- `mailboxStatus` must be `available`.
- Cancelled or late-arriving task results are logged but not compile eligible.
- Compile may mark eligible items `consumed` only after FinalResponseArtifact creation succeeds.

Mailbox status transition law:

- `available` is the initial state for a digest-valid, classification-present, non-blocked mailbox item.
- `blocked` is set when redaction, classification, integrity, policy, or secure-loop invariant checks prohibit compile consumption.
- `cancelled` is set when the parent run/task is cancelled before the item is consumed; late arrivals after cancellation must be logged but remain non-eligible.
- `expired` is set when the item exceeds its TTL before consumption; expiry may be detected on read or by sweep, but either path must produce the same non-eligible result.
- `consumed` is set only after successful FinalResponseArtifact creation and compile-return handoff preparation. Failed compile or failed return must not falsely consume the item.

Field-level transition guards, persistence details, and race-handling rules are specified by AMEND-EXT-001.

### 8.4 OutputContract

```typescript
interface OutputContract {
  outputContractId: Uuid;
  runId: Uuid;
  mailboxId: NonEmpty;
  mailboxItems: Uuid[];
  inputDataClasses: DataClass[];
  inheritedCompileDataClass: DataClass;
  compileEligibility: {
    deterministic: true;
    onPremSynthesis: boolean;
    frontierSynthesis: boolean;
    denialReason?: DenialCode;
  };
  runLedgerRefs: Uuid[];
  evidenceRefs: Uuid[];
  routingTrailRefs: Uuid[];
  createdAt: IsoTimestamp;
  contractDigest: Sha256Hex;
}
```

Law:

- OutputContract is metadata, not payload.
- Run Ledger stores OutputContract reference/digest by `runId`.
- Payloads live behind MailboxItem `resultRef`.
- `inheritedCompileDataClass` is computed from `inputDataClasses` under OCT-COMPILE inheritance law.

### 8.5 FinalResponseArtifact

```typescript
interface FinalResponseArtifact {
  artifactId: Uuid;
  runId: Uuid;
  compilerSocketId: NonEmpty;
  compilerActorId: Uuid | null;
  compileMode: 'deterministic_render' | 'on_prem_synthesis' | 'frontier_synthesis';
  bodyRef: NonEmpty;
  bodyDigest: Sha256Hex;
  outputClassifications: DataClass[];
  sourceMailboxItems: Uuid[];
  evidenceRefs: Uuid[];
  routingTrailRefs: Uuid[];
  runLedgerRefs: Uuid[];
  createdAt: IsoTimestamp;
  signature: Base64Url;
}
```

### 8.6 OutputCollector Interface

```typescript
interface OutputCollector {
  writeMailboxItemFromNvgResult(input: NvgOutputReference): Promise<MailboxItem>;
  writeMailboxItemFromNxsResult(input: NxsOutputReference): Promise<MailboxItem>;
  writeMailboxItemFromAgentPartial(input: AgentPartialOutputReference): Promise<MailboxItem>;
  buildOutputContract(runId: Uuid): Promise<OutputContract>;
}
```

Law:

- `NvgOutputReference`, `NxsOutputReference`, and `AgentPartialOutputReference` are architecture-level placeholders in this blueprint. Their exact schemas are specified by AMEND-EXT-001.
- OutputCollector is a contracts-level interface implemented by lawful composition/root wiring.
- NXS/NVG engines do not import each other's internals and do not import forbidden layer implementations.
- Engine outputs are adapted into output references at the composition boundary.
- Mailbox writes occur after engine decisions and audit writes, not inside NVG/NXS gate law.

## 9. Output Routing Law

Status: additive explicit law under ADD-EXT-002. Current canon requires final response through workspace and not from raw model/sub-agent; this section turns the implied forbidden paths into enforceable build law.

Results must not return directly from agents to workspace.

Allowed return path:

```text
Agent / NVG / NXS result
  → contract-level output reference
  → OutputCollector
  → Return Mailbox item
  → OutputContract metadata by runId
  → Compiler reads eligible mailbox items by runId
  → FinalResponseArtifact
  → Compile-return endpoint
  → Workspace display
```

Forbidden paths:

```text
Agent → Workspace final response
Model → Workspace final response
NXS connector → Workspace final response
Compiler → Evidence Ledger mutation
Workspace → direct compile payload bypassing mailbox
Mailbox → LLM call
Return endpoint → LLM call
NVG internal → core mailbox implementation import
NXS gate → workspace implementation import
```

## 10. OCT-SECURE Baked Loop

OCT-SECURE is the built-in most-secure loop. It must not depend on a replaceable reference plugin behaving correctly.

Default OCT-SECURE path:

```text
Workspace entry
  → secure-loop invariant validation
  → single selected secure actor
  → no LLM orchestrator helper
  → no multi-agent split
  → on_prem_sensitive only for model calls through NVG
  → NXS full gate path for system actions
  → mailbox item with sensitive classification
  → deterministic compile/render OR on-prem synthesis only
  → compile-return endpoint
  → workspace display
```

OCT-SECURE infra invariants:

- secure run defaults to single selected secure actor;
- no LLM-assisted orchestrator planning unless explicit signed secure policy permits;
- no multi-agent split unless explicit signed secure policy names exact agents and systems;
- no frontier model call for sensitive/restricted inputs;
- no frontier compile if inherited compile data class is sensitive/restricted;
- mailbox classificationRequired and digestRequired must be true;
- compile reads only eligible mailbox items;
- compile-return artifact must carry classification summary and digest;
- violations fail closed before dispatch or compile.

OCT-SECURE multi-agent path:

- disabled by default;
- allowed only by explicit signed policy;
- policy must name exact agents, systems, data classes, allowed capabilities, compile mode, mailbox scope, and approval posture;
- no blanket secure multi-agent enable flag;
- no frontier compile or frontier model calls for sensitive inputs.

## 11. LLM Call Minimization Law

Default V1 must avoid helper-model fanout.

No LLM calls in:

- workspace entry;
- workspace display;
- mailbox storage/retrieval;
- compile-return endpoint;
- default deterministic orchestrator planning.

Possible LLM calls only in:

- agent task execution when task requires model call and NVG permits;
- compile Mode 2 on-prem synthesis;
- compile Mode 3 frontier synthesis when OCT/data-class policy permits;
- future orchestrator LLM-assisted planning only behind signed manifest + policy.

This preserves speed, cost, and governance determinism.

## 12. Bootstrap Expansion — Phased, Not Big-Bang

Current bootstrap is green and must not be destabilized by a single 12-step → 21-step rewrite. External infra bootstrap expands incrementally. Each phase adds one manifest/domain family and must pass the current gate set plus its new domain gate before the next phase begins.

Target end-state sequence:

```text
1. Register factory registries + factories
2. Load control-plane keypair
3. Load identity manifest
4. Evaluate RIA bridge conditions
5. Load connector manifest
6. Load channel manifest
7. Load endpoint manifest
8. Load workspace manifest
9. Load orchestrator manifest
10. Load mailbox manifest
11. Load compiler manifest
12. Load compile-return manifest
13. Cross-domain collision and orphan-socket check
14. Populate TierRegistry from endpoints
15. Create transport contexts
16. Load NVG routing policy
17. Load mode configuration
18. Construct NVG/NXS/control services
19. Construct mailbox service
20. Construct output collector and external socket registry
21. Expose final composed runtime
```

Required phasing:

| Phase | Add | Gate requirement |
|---|---|---|
| P0 | Spec amendment file | Docs/audit check only; no runtime changes |
| P1 | Contracts only | Typecheck + schema tests |
| P2 | Workspace manifest loader/schema | Existing gates + workspace manifest signature/schema gate |
| P3 | Orchestrator manifest loader/schema | Existing gates + orchestrator manifest signature/schema gate |
| P4 | Mailbox manifest + core mailbox service | Existing gates + required mailbox enabled gate |
| P5 | Compiler manifest | Existing gates + compiler actor/manifest gate |
| P6 | Compile-return manifest | Existing gates + return endpoint gate |
| P7 | Cross-domain socket registry + output collector | Existing gates + collision/no-orphan/no-cross-layer-import gate |
| P8 | OCT-SECURE loop test harness | Existing gates + OCT-SECURE loop gate |

Important: this does not move workspace/orchestrator/compiler internals into Nexus core. Bootstrap composes interfaces and sockets only. Reference plugin implementations are loaded behind contracts/manifests and remain replaceable.

## 13. Required CI / Gate Additions

Add gates for external infra:

- manifest schema gate for workspace/orchestrator/mailbox/compiler/output manifests;
- manifest signature gate for all new manifests;
- required mailbox manifest enabled gate;
- compiler actor registration gate for every non-reference compiler;
- compile-return endpoint manifest gate;
- output contract schema gate;
- mailbox item digest/classification/status/compileEligibility gate;
- no-direct-agent-to-workspace-output gate;
- no-cross-layer-mailbox-import gate;
- OCT-SECURE loop gate;
- no-helper-LLM-default gate;
- runId propagation gate from workspace request through mailbox and compile-return;
- cross-link gate: mailbox item refs appear in Run Ledger by runId;
- socket collision/no-orphan gate for workspace/orchestrator/mailbox/compiler/output.

## 13.1 Packaging and Distribution Law

Initial implementation SHALL remain monorepo-first to preserve build velocity and gate determinism. The first public/stable plugin dependency surface SHALL be contracts. A future package distribution model MAY publish reference plugins independently, but only if the plugin continues to depend on contracts and load through signed manifests.

The install/onboarding experience SHOULD eventually support commands such as guided integration discovery and approved package onboarding, but those commands SHALL generate or update signed approved manifests. They SHALL NOT weaken runtime bootstrap trust.

No immediate removals are required for the externals phase. Existing CLI harness behavior, management API routes, MCP adapter behavior, identity/provider manifests, connector manifests, channel manifests, and NVG endpoint manifests SHALL be inherited as anchors unless a later audit finds a direct conflict.

## 14. Build Order

Recommended build sequence after architecture ratification and before reference plugins. Build incrementally; do not ship all manifest/bootstrap changes in one pass:

0. Write spec amendment file for AMEND-EXT-001.
1. Add contracts only: WorkspaceRunRequest, OrchestratorPlanPreview, MailboxItem, OutputContract, FinalResponseArtifact, OutputCollector, output reference types.
2. Add signed manifest schemas/loaders for workspace/orchestrator/mailbox/compiler/output.
3. Add mailbox backend interface and local reference implementation.
4. Wire output contract writer to Run Ledger.
5. Wire NXS/NVG/agent result references to output collector and mailbox item creation at lawful composition boundary.
6. Wire compiler socket to read eligible mailbox items by runId.
7. Wire compile-return endpoint to workspace socket.
8. Add OCT-SECURE loop policy and tests.
9. Add reference workspace blueprint.
10. Add reference orchestrator blueprint.
11. Add reference compiler/output blueprint.

## 15. Placement and Contract Decisions

Resolved from owner feedback and v0.2 audit:

| Question | Decision |
|---|---|
| Where does mailbox service live? | Contract types/interfaces in `packages/contracts`; baked mailbox implementation in `packages/core/src/mailbox`; cross-engine writes through `OutputCollector` and composition root, not direct imports. |
| Does `ExecutionResult` get `resultRef/resultDigest/resultClassifications`? | No for V1. `ExecutionResult` stays lean as execution/audit metadata. `MailboxItem` owns payload return reference, digest, and classifications. EvidenceRecord may store mailbox item reference/digest for cross-link. |
| V1 mailbox backend? | Local JSONL metadata + filesystem payload refs under run-scoped storage. Production backend remains replaceable behind mailbox interface. |
| API route namespace? | Reference harness routes: `/workspace/*`, `/orchestrator/*`, `/mailbox/*`, `/compile/*`, `/compile-return/*`. These are reference-plugin/infra harness routes, not NXS/NVG core engine routes. |
| Existing D2 workspace/orch/compile NOT PINNED? | This blueprint is the first pinning pass for external sockets/wires only. Reference plugin internals are separate blueprints. |
| How are IDs represented? | Socket/manifest IDs use `NonEmpty`; actor/principal/run/action IDs use `Uuid`. Do not conflate socket IDs with actor IDs. |
| How is secure loop baked if plugins are replaceable? | Infra validates secure-loop invariants before dispatch/compile and fails closed on violation. Do not trust plugin implementation behavior alone. |
| How does compiler read mailbox? | Compiler reads only compile-eligible mailbox items by runId after digest, classification, cancellation, redaction, and status checks. |

Spec amendment required after owner ratification: `WorkspaceRunRequest`, `OrchestratorPlanPreview`, `MailboxItem`, `OutputContract`, `FinalResponseArtifact`, `OutputCollector`, output reference types, new manifest schemas/loaders, bootstrap phase gates, mailbox service path, and CI gates.

## 16. Owner Decisions Applied From Open Questions

Approved/accepted into this draft:

- no prompt history by default; Run Ledger metadata only;
- file space deferred, reserved by contract only;
- idle timeout belongs to auth/session/Gate 01, not workspace timer;
- multiple simultaneous agents allowed under run-scoped activation;
- orchestrator helper has own OCT but secure path bypasses helper unless signed policy permits;
- one split level for V1;
- no plan cache for V1;
- user plan edits get deterministic feasibility recheck, not helper re-plan;
- autonomous/timed workflows require signed pre-approved config;
- one transient auto-retry allowed by policy; scope change returns to user;
- 30s system action timeout / 60s model call timeout defaults;
- cancellation is Run Ledger mark + best-effort abort;
- custom orchestrator agents load from signed manifest;
- deterministic-first planning for V1;
- secure multi-agent only by explicit signed policy;
- output contract metadata through Run Ledger by runId;
- resultRef + resultDigest + resultClassifications required on returned mailbox artifacts.

## 17. Ratification Criteria

This draft is ready for owner ratification only if the owner accepts:

1. ADD-EXT-001 mailbox as baked infrastructure primitive.
2. ADD-EXT-002 explicit forbidden output path law.
3. ADD-EXT-003 existing RunEventType lifecycle inheritance.
4. ADD-EXT-004 runtime plugin loading security law.
5. ADD-EXT-005 contracts as public compatibility surface.
6. AMEND-EXT-001 spec amendment before implementation.
7. Mailbox implementation placement plus output-collector wiring law.
8. Compiler actor-registration law.
9. OCT-SECURE infra invariant enforcement.
10. Phased bootstrap expansion.

If ratified, promote this file into `/docs` with canonical version assignment, then begin AMEND-EXT-001 spec amendment before any runtime build.
