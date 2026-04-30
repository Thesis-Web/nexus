# Nexus Stack — Engineering Spec Amendment: Externals Infrastructure

# Version: v0.2.5-draft
# Status: DRAFT r6 / v0.2.5 — S18 forensic audit fixes applied; ratification-candidate
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-30
# Governing law stack:
#   1. `nexus-complete-end-to-end-flow-v4.8.md` — locked canonical outline
#   2. `nexus-blueprint-v1-5-13.md` — primary blueprint law
#   3. `AMEND-blueprint-v1_5_14-NISP-001-A-r2.md` — manifold / model transport / signed-manifest amendment law where applicable
#   4. `AMEND-blueprint-nexus-infra-externals-v1-0-0.md` — externals infrastructure amendment law where applicable
#   5. `nexus-engineering-spec-v1-8-26.md` — base engineering implementation law
#   6. `AMEND-spec-v2_9_29-NISP-001-A-r4.md` — manifold / transport / signed-manifest implementation law where applicable
#   7. This amendment spec — implementation law for externals infrastructure only

---

## 0. Amendment Status and Precedence

This engineering spec amendment implements the ratified externals infrastructure blueprint:

- `AMEND-blueprint-nexus-infra-externals-v1-0-0.md`

The amendment is additive. It does not replace NVG wall law, NXS gate law, OCT law, Run Ledger law, signed-manifest law, model transport law, or the existing manifold/bootstrap law. Where this amendment touches those areas, it must inherit them exactly.

### 0.1 Precedence

The builder must resolve conflicts in this order:

1. `nexus-complete-end-to-end-flow-v4.8.md`
2. `nexus-blueprint-v1-5-13.md`
3. `AMEND-blueprint-v1_5_14-NISP-001-A-r2.md` where manifold / model transport / signed-manifest law applies
4. `AMEND-blueprint-nexus-infra-externals-v1-0-0.md` where externals law applies
5. `nexus-engineering-spec-v1-8-26.md`
6. `AMEND-spec-v2_9_29-NISP-001-A-r4.md` where manifold / model transport / signed-manifest implementation applies
7. This spec amendment
8. Repo implementation

If this spec conflicts with any blueprint, the blueprint wins. If this spec conflicts with the base engineering spec but the externals blueprint requires the change, this spec controls only for the externals surface. If a hole remains, the builder must log a best-solve item and stop at the affected implementation line unless the owner has already approved the solve.

### 0.2 Scope Classification

This amendment implements baked external infrastructure around the existing Nexus Stack. It does not implement customer-specific workspace UI, customer-specific orchestrator logic, customer-specific compiler intelligence, customer-specific identity provider, customer-specific connector, customer-specific approval channel, or customer-specific model provider. It implements the sockets, contracts, manifests, mailbox, output collector, compile-return wire, and gates that make those surfaces pluggable and governed.

### 0.3 Ratified Architecture Additions Implemented Here

This spec implements these ratified externals blueprint additions:

| Blueprint ID | Spec treatment |
|---|---|
| ADD-EXT-001 — Return mailbox as baked primitive | Implemented as contracts interfaces + core JSONL/filesystem backend + manifest loader + bootstrap wiring. |
| ADD-EXT-002 — Explicit forbidden direct output paths | Implemented as contract boundaries, route law, import gate, and tests. |
| ADD-EXT-003 — Existing RunEventType lifecycle remains canonical | Implemented by extending only where necessary and reusing existing events first. |
| ADD-EXT-004 — Runtime plugin loading through signed approved manifests only | Implemented by extending existing signed-manifest loader/factory registry pattern. |
| ADD-EXT-005 — `packages/contracts` / `@nexus/contracts` is public compatibility surface | Implemented by placing all plugin-facing interfaces in contracts and forbidding plugin imports from core/vanguard. |

---

## 0.4 S17 Audit Owner Rulings Applied in r2

The following S17 audit findings are resolved in this r2 draft. These rulings are implementation law for this amendment unless superseded by owner ratification.

| Finding | r2 ruling | Spec change |
|---|---|---|
| F-01 | Fix to blueprint. Bootstrap target is 21 steps, not 22. | `CompileService` construction and runtime exposure are folded into blueprint step 21. |
| F-02 | Fix to blueprint. Manifest phases must remain incremental. | Build order split into one domain family per push. |
| F-03 | Reject public contract expansion. | Removed `identityClaimsRef` and `requestMetadata` from `WorkspaceRunRequest`; identity reference may be Run Ledger detail only. |
| F-04 | Partially approve. | Removed `createdAt`; `expectedOutputSlots` is mandatory orchestrator-declared slot metadata and is included in `planDigest`. Nexus infra validates/carries it; Nexus does not generate it. |
| F-05 | Approve production diagnostics. | Keep `consumedAt` and `blockedReason` on `MailboxItem`. |
| F-07 | Fix hole. | Define `CompileService`. |
| F-08 | Fix hole. | Define manifest record interfaces. |
| F-09 | Approve baked mailbox service. | `MailboxBackend` remains public replaceable storage surface; `MailboxService` is baked core implementation law. |
| F-10 | Approve one additive event only. | Only `mailbox_item_status_changed` may be added. |
| F-11/F-12 | Clarify. | Required externals domains fail closed; existing NISP domains remain warning-only unless used as required cross-reference. `ManifestDomain` expands to nine values. |
| F-13 | Approve naming consistency. | Rename `CompilerPlugin` to `Compiler`. |
| F-21 | Clarify. | Contracts use TypeScript types plus assert-style validation helpers; Zod remains in loaders/implementation packages unless repo law changes. |
| F-22 | Approve bootstrap placement. | `ExternalsRuntime` is bootstrap/composition-root type, not public contracts surface. |

Breaker-box law: this amendment builds the containers, wires, plugs, endpoints, slot labels, signatures, ledgers, and validation points. It does not build the enterprise breakers: production IAM/RBAC/OAuth provider, production workspace UI, production orchestrator intelligence, or production compiler intelligence. Those attach later through the baked sockets and contracts defined here.


## 0.5 R2 Wiring Audit Fixes Applied in v0.2.2

The following R2 wiring audit findings are resolved in this draft. These fixes preserve the breaker-box / car-chassis law: baked infra provides sockets, manifests, wires, validation, ledgers, dispatchers, and attachment points; replaceable products/plugins provide IAM/RBAC/OAuth, workspace UI, orchestrator intelligence, and compiler intelligence.

| Finding | v0.2.2 ruling | Spec change |
|---|---|---|
| R2-WIRE-001 | Fix blocking gap. | Add factory contracts for workspace, orchestrator, mailbox backend, compiler, and compile-return transport. |
| R2-WIRE-002 | Fix blocking gap. | Add minimal workspace and orchestrator socket interfaces. |
| R2-WIRE-003 | Fix blocking gap. | Add baked `CompileReturnDispatcher` and plug-facing `CompileReturnTransport`; route receiver is reference harness only. |
| R2-WIRE-004 | Fix implicit artifact-type gap. | Pin `final_response.v1` as implicit V1 artifact type. |
| R2-WIRE-005 | Fix signature key source. | Add compiler manifest `artifactSigning` law. Reference deterministic compiler uses control-plane signing. |
| R2-WIRE-006 | Fix resultRef verification gap. | Add baked payload resolver/store interfaces and allowed V1 schemes. |
| R2-WIRE-007 | Fix slot validation dependency. | Add `DeclaredOutputSlotReader` / run-plan slot index built from Run Ledger. |
| R2-WIRE-008 | Fix mailbox ambiguity. | V1 governed runtime permits exactly one enabled required mailbox. |
| R2-WIRE-009 | Fix return endpoint resolution. | Route endpoint resolution through `ExternalSocketRegistry.resolveReturnEndpointForRun(runId)`; no standalone resolver service. |
| R2-WIRE-010 | Fix CompileService signature mismatch. | Pin core `selectCompileMode(contract, compilerRecord, config)` signature. |
| R2-WIRE-011 | Fix frontier synthesis bypass risk. | Frontier synthesis must route through injected NVG service; no direct provider call from compiler. |
| R2-WIRE-012 | Owner-approved clarification. | Mark §6.2 and §6.3 as `REFERENCE HARNESS — NOT INFRA LAW`. |
| R2-WIRE-013 | Fix undefined registry. | Define `ExternalSocketRegistry` placement, shape, and lookup law. |
| R2-WIRE-014 | Fix bootstrap Step 01 ambiguity. | Register all new factory registries and built-in factories before manifest load. |
| R2-WIRE-015 | Fix loader/factory gap. | All new manifest discriminators must resolve in populated factory registry. |
| R2-WIRE-016 | Fix route registration gap. | Add route barrel/server registration path. |
| R2-WIRE-017 | Fix consume timing. | Mailbox items become `consumed` only after successful compile-return acceptance or durable signed handoff. |
| R2-WIRE-018 | Fix empty output contract path. | Empty output contract fails closed and must not invoke compiler. |
| R2-WIRE-019 | Fix audit clarity. | `partial_result` detail records slot validation status. |
| R2-WIRE-020 | Fix denial-code coverage. | Add denial codes for undeclared slot, resolver/key failures, return dispatch failure. |


## 0.6 S17 v0.2.2 Audit Fixes Applied in v0.2.3

The following S17 v0.2.2 audit findings are resolved in this draft. These are implementation-law corrections, not architecture changes.

| Finding | v0.2.3 ruling | Spec change |
|---|---|---|
| V022-01 | Fix internal contradiction. | `CompileService.selectCompileMode` now uses the pinned `(contract, compilerRecord, config)` signature everywhere. |
| V022-02 | Fix undefined baked dispatcher. | Define `CompileReturnDispatcher`, `CompileReturnDispatchInput`, and dispatch acknowledgement law in core compile service section. |
| V022-03 | Remove duplicate resolver surface. | No standalone `ReturnEndpointResolver` is built. `ExternalSocketRegistry.resolveReturnEndpointForRun(runId)` is the single resolver. |
| V022-04 | Owner-approved carry. | `outputSlotPolicy` remains as an infra-level enforcement policy on the orchestrator manifest. It is logged as spec-level refinement to be reflected in the canonical change log before ratification. |

Resolver supersession law: any prior wording that implies a separate `ReturnEndpointResolver` service is superseded by `ExternalSocketRegistry.resolveReturnEndpointForRun`. The registry is the terminal map; a second resolver would be duplicate wiring.


## 0.7 Monorepo-Fit Cleanup Applied in v0.2.4

This cleanup pass applies no new architecture. It removes duplicate/dead wiring references and pins repo ownership so the amendment can be taken to ratification audit.

| Finding | v0.2.4 ruling | Spec change |
|---|---|---|
| FIT-01 / FIT-06 | Remove duplicate resolver path. | Removed all `return-endpoint-resolver.ts` path references. `ExternalSocketRegistry.resolveReturnEndpointForRun(runId)` remains the single resolver. |
| FIT-02 | Fix repo path. | `ManifestDomain` expansion is pinned to `packages/runtime-utils/src/qualified-identifier.ts`. |
| FIT-03 | Restore corrupted section. | Restored full `## 16. Completion Criteria`. |
| FIT-04 | Pin existing DI type names. | API/compile references use `PipelineInterface` from `packages/contracts/src/interfaces/index.ts` and `NvgService` from `@nexus/contracts`, implemented by `packages/vanguard/src/nvg-service.ts`. |
| FIT-05 | Clarify single-source backend contract. | `MailboxBackend` is owned in `packages/contracts/src/externals/mailbox.ts`; core imports it and must not redefine it. |
| FIT-07 | Pin `CompileConfig` source. | `CompileConfig` is inherited from base spec §12.3.33 at `packages/contracts/src/interfaces/index.ts`. |

## 0.8 S18 Forensic Audit Fixes Applied in v0.2.5

Full forensic pinned audit of every spec claim against the externals infrastructure blueprint. Zero CONTRAs, zero HOLEs found. The following fixes address internal consistency findings.

| Finding | v0.2.5 ruling | Spec change |
|---|---|---|
| F-AUD-01 | Add disabled compiler sample. | §4.5 compiler manifest sample now includes a disabled `customer-onprem-compiler` entry matching blueprint §7.4 example. |
| F-AUD-02 | Accept spec ordering. | Bootstrap ordering preserves existing green 12-step numbering; externals appended as steps 13-21. Same end state as blueprint target sequence. No change needed. |
| F-AUD-03 | Accept V1 coverage. | Blueprint §2.3 minimum manifest fields (pinned version, expected contract version) are covered by factory type discriminator and manifest schema version for V1. Blueprint §7 shapes also omit explicit fields. Future package distribution may add explicit fields. No change needed. |
| F-AUD-04 | Accept stricter trigger. | Consumed transition requires workspace acceptance or durable handoff ack, not just artifact creation. Stricter than blueprint minimum — safer. No change needed. |
| F-AUD-05 | Fix validation pseudocode. | Added `promptRef` assertion to `validateWorkspaceRunRequest` pseudocode. |
| F-AUD-06 | Fix dispatch pseudocode. | §6.8 compile wire pseudocode now uses structured `CompileReturnDispatchInput` matching the §3.10 interface. |

## 1. Existing Repo Reality Map

The current repo snapshot contains these anchors. The builder must modify these files in place rather than invent parallel paths.

### 1.1 Existing Files to Inherit

| Existing path | Current role | Required use in this amendment |
|---|---|---|
| `scripts/nexus-main.ts` | top-level startup entry | May call expanded bootstrap result but must not compose externals itself. |
| `scripts/nexus-bootstrap.ts` | current lawful composition root, 12-step bootstrap | Must become expanded composition root. Cross-layer imports are allowed here only. |
| `packages/runtime-utils/src/manifest/load-signed-manifest.ts` | generic signed YAML manifest loader | Must be reused for all new externals manifests. Do not fork signature logic. |
| `packages/contracts/src/interfaces/signed-manifest.ts` | generic manifest envelope type | Must be reused by new manifest body types. |
| `config/identity/providers.v1.yaml` | identity provider manifest | Already governed by NISP; loaded before workspace manifest. |
| `config/connectors/connectors.v1.yaml` | connector manifest | Already governed by NISP; loaded before output collector can accept NXS refs. |
| `config/channels/channels.v1.yaml` | approval channel manifest | Already governed by NISP. |
| `config/nvg/endpoints.v1.yaml` | model endpoint manifest | Already governed by NISP; remains endpoint registry, not routing policy. |
| `fixtures/nvg/default.routing-policy.yaml` | signed NVG routing policy fixture | Remains infrastructure policy, not a plugin registry manifest. |
| `packages/core/src/ledger/run-ledger.ts` | JSONL Run Ledger backend | Must record externals lifecycle metadata through existing `RunLedgerWriter`. |
| `packages/contracts/src/interfaces/index.ts` | public interface barrel | Must receive new externals contracts. |
| `packages/contracts/src/types/index.ts` | primitive aliases | Must not import monorepo internals. |
| `packages/contracts/src/constants/index.ts` | governed constants | May receive additive event/denial constants. Must keep governed string aliases open. |
| `packages/adapters/mcp/src/mcp-normalizer.ts` | current MCP normalization path requiring `X-Nexus-Run-Id` | Must remain compatible. WorkspaceRunRequest formalizes this existing runId wire. |
| `packages/interfaces/api/src/server.ts` and `packages/interfaces/api/src/routes/*` | Layer 7 API surface | Must expose reference harness routes through DI only. API must not import core/vanguard implementations. |

### 1.2 Existing D2 Topology Signals

The D2 files are topology aids, not independent law. They confirm the following implementation direction:

| D2 signal | Spec implication |
|---|---|
| Workspace is purple / not pinned in current canon | This amendment pins the workspace socket and harness route, but not a production workspace UI. |
| Orchestrator is purple / not pinned | This amendment pins orchestrator socket, manifest, and plan-preview contract, not a full enterprise orchestrator. |
| Compile path is purple / not pinned | This amendment pins compiler socket, deterministic reference compiler boundary, mailbox read law, and compile-return endpoint. |
| Run Ledger block is green / partially deferred for workspace events | This amendment closes the deferred externals event path by making workspace/orchestrator/compile events emitted at reference harness boundaries. |
| Internal manifold already contains bootstrap, signed manifests, transport, and three audit streams | This amendment must extend current manifold; it must not create a second bootstrap. |

---

## 2. Repository Placement Law

### 2.1 New and Modified Paths

The builder must implement the amendment at the following paths.

    nexus/
      config/
        workspace/
          workspaces.v1.yaml
        orchestrators/
          orchestrators.v1.yaml
        mailbox/
          mailboxes.v1.yaml
        compile/
          compilers.v1.yaml
        output/
          compile-return.v1.yaml

      packages/
        contracts/
          src/
            externals/
              index.ts
              workspace.ts
              orchestrator.ts
              mailbox.ts
              output-contract.ts
              compiler.ts
              compile-return.ts
              manifests.ts
              output-references.ts
              factories.ts
              payload.ts
            interfaces/
              index.ts                         # exports externals public contracts
            constants/
              index.ts                         # additive event/denial/status constants
            schemas/
              externals.ts                     # schema re-export only; no zod import if repo keeps no-zod-in-contracts law

        core/
          src/
            mailbox/
              mailbox-service.ts              # imports MailboxBackend from contracts; no duplicate backend interface
              local-jsonl-mailbox.backend.ts
              mailbox-eligibility.ts
              mailbox-errors.ts
              mailbox-paths.ts
              index.ts
            output/
              output-collector.ts
              output-contract-builder.ts
              output-reference-adapter.ts
              output-digest.ts
              payload-resolver.ts
              declared-output-slot-reader.ts
              index.ts
            compile/
              deterministic-renderer.ts
              compile-service.ts
              compile-eligibility.ts
              final-response-signer.ts
              compile-return-dispatcher.ts
              index.ts
            externals/
              external-socket-registry.ts
              index.ts
            manifest/
              workspace/
                workspace-manifest-loader.ts
                workspace-factory-registry.ts
              orchestrators/
                orchestrator-manifest-loader.ts
                orchestrator-factory-registry.ts
              mailbox/
                mailbox-manifest-loader.ts
                mailbox-factory-registry.ts
              compile/
                compiler-manifest-loader.ts
                compiler-factory-registry.ts
              output/
                compile-return-manifest-loader.ts
                compile-return-factory-registry.ts

        interfaces/
          api/
            src/
              routes/
                workspace.ts
                orchestrator.ts
                mailbox.ts
                compile.ts
                compile-return.ts
                index.ts
              server.ts

      scripts/
        nexus-bootstrap.ts
        sign-manifest.ts                       # extend allowed domains if domain allow-list exists
        ci-gate.ts

      tests/
        externals/
          workspace-run-request.test.ts
          output-collector.test.ts
          mailbox-service.test.ts
          compile-service.test.ts
          compile-return-auth.test.ts
          forbidden-output-paths.test.ts
          runid-propagation.test.ts
          oct-secure-loop.test.ts
        manifest/
          workspace-manifest-signature.test.ts
          orchestrator-manifest-signature.test.ts
          mailbox-manifest-signature.test.ts
          compiler-manifest-signature.test.ts
          compile-return-manifest-signature.test.ts
          externals-cross-domain-collision.test.ts
        architecture/
          externals-import-law.test.ts
          single-composition-root.test.ts
          plugin-public-surface.test.ts
          no-direct-agent-workspace-output.test.ts

### 2.2 Package Boundary Law

New externals contract types live in `packages/contracts/src/externals/`. The public barrel `packages/contracts/src/index.ts` must export them.

Implementation lives in `packages/core/src/mailbox`, `packages/core/src/output`, and `packages/core/src/compile` because this amendment makes mailbox/output-collector/reference deterministic compile baked infrastructure. This is allowed only because these are Layer 1 implementations behind Layer 2 interfaces.

No vanguard file may import from `packages/core/src/mailbox`, `packages/core/src/output`, or `packages/core/src/compile`.

No adapter, connector, identity-ref package, or plugin package may import from `packages/core` or `packages/vanguard` internals.

Layer 7 API routes must import contracts only and receive service instances by DI from the composition root.

### 2.3 Composition Root Law

`scripts/nexus-bootstrap.ts` remains the sole lawful runtime composition root for this build. It may import implementation classes from multiple layers. No other package may compose the runtime graph.

Forbidden composition locations:

- `packages/core/src/**` may not instantiate vanguard services.
- `packages/vanguard/src/**` may not instantiate core mailbox/output services.
- `packages/adapters/**` may not instantiate core/vanguard engines.
- `packages/interfaces/api/src/server.ts` may not instantiate core/vanguard implementation classes.
- Any manifest loader may validate records but may not execute plugin code outside factory validation.

---

## 3. Public Contracts — `packages/contracts/src/externals`

All plugin-facing contracts in this section are public compatibility contracts. Baked service interfaces explicitly marked as core implementation law are not exported as plugin surfaces.

### 3.1 Primitive Reuse

All new types must reuse these existing primitives from `packages/contracts/src/types/index.ts`:

    Uuid
    IsoTimestamp
    Sha256Hex
    Base64Url
    NonEmpty
    SemVer

All governed strings remain open string aliases. Do not create closed TypeScript unions for governed values unless the base spec already uses a literal for a truly closed wire variant.

### 3.2 WorkspaceRunRequest

File: `packages/contracts/src/externals/workspace.ts`

    export interface WorkspaceRunRequest {
      runId: Uuid;
      userId: NonEmpty;
      principalId: Uuid;
      authenticatedBy: NonEmpty;
      enteredAt: IsoTimestamp;
      prompt: NonEmpty;
      promptDigest: Sha256Hex;
      promptRef: NonEmpty | null;
      selectedAgentIds: Uuid[];
      workspaceSocketId: NonEmpty;
      planCheckbackRequested: boolean;
    }

Law:

- `runId` is generated before this request leaves the workspace boundary.
- `prompt` is volatile transit data and must not be written to long-term Run Ledger detail by default.
- `promptDigest = sha256(canonicalize({ runId, prompt, enteredAt, workspaceSocketId }))` unless a later approved prompt canonicalization spec supersedes it.
- `selectedAgentIds` may be empty only when the orchestrator owns agent selection. If non-empty, the orchestrator must still verify against registry/capability ceiling.
- Identity-provider resolution references may be written to `run_opened.detail.identityClaimsRef` when available, but they are not part of `WorkspaceRunRequest`. Raw IAM/OAuth tokens must never be copied into this contract.

Validation:

    validateWorkspaceRunRequest(input): WorkspaceRunRequest
      assertUuid(input.runId)
      assertNonEmpty(input.userId)
      assertUuid(input.principalId)
      assertNonEmpty(input.authenticatedBy)
      assertIso(input.enteredAt)
      assertNonEmpty(input.prompt)
      assertSha256(input.promptDigest)
      if input.promptRef !== null: assertNonEmpty(input.promptRef)
      assertArrayOfUuid(input.selectedAgentIds)
      assertNonEmpty(input.workspaceSocketId)
      assertBoolean(input.planCheckbackRequested)
      return input

### 3.2.1 Workspace Socket Contract

File: `packages/contracts/src/externals/workspace.ts`

This contract is a plug/attachment surface. It is not a production UI implementation. Production workspaces may be external HTTP services, web UIs, desktop clients, or enterprise portals, but they attach through this socket law.

    export interface WorkspaceAdapter {
      readonly workspaceSocketId: NonEmpty;
      readonly workspaceVersion: NonEmpty;
      submitRun?(input: unknown): Promise<WorkspaceRunRequest>;
      acceptFinalResponse(request: CompileReturnRequest): Promise<CompileReturnAck>;
    }

    export interface CompileReturnAck {
      runId: Uuid;
      returnEndpointId: NonEmpty;
      accepted: boolean;
      acceptedAt: IsoTimestamp;
      reason: DenialCode | null;
    }

Law:

- `submitRun` is optional because many production workspaces are external HTTP callers rather than in-process adapters.
- `acceptFinalResponse` is the required return attachment when the workspace is represented in-process or by the reference harness.
- A workspace adapter must not call LLMs as part of entry, return, or display.
- The final response acceptance path must verify compile-return auth before user display.

### 3.3 OrchestratorPlanPreview

File: `packages/contracts/src/externals/orchestrator.ts`

    export interface OrchestratorPlanPreview {
      runId: Uuid;
      orchestratorSocketId: NonEmpty;
      orchestratorActorId: Uuid;
      plannerMode: 'deterministic' | 'policy_template' | 'llm_assisted';
      selectedAgents: OrchestratorSelectedAgent[];
      requiresUserApproval: boolean;
      planDigest: Sha256Hex;
    }

    export interface OrchestratorSelectedAgent {
      agentId: Uuid;
      taskId: Uuid;
      taskSummary: NonEmpty;
      requiresNvg: boolean;
      requiresNxs: boolean;
      estimatedRisk: RiskTier | EvidenceSentinel;
      expectedOutputSlots: NonEmpty[];
    }

Law:

- `plannerMode = 'llm_assisted'` is legal only if the orchestrator actor is registered and the model call goes through NVG.
- Default V1 reference planner uses `deterministic`.
- `expectedOutputSlots` SHALL be present for every selected agent entry. It is declared by the orchestrator plugin/socket; Nexus infra validates, records, carries, and checks it, but does not generate orchestration intelligence.
- `planDigest = sha256(canonicalize({ runId, orchestratorSocketId, orchestratorActorId, plannerMode, selectedAgents, requiresUserApproval }))`. Because `expectedOutputSlots` is inside `selectedAgents`, any slot expectation change changes the plan digest.
- A plan preview is metadata. It is not authority to execute actions.
- If `planCheckbackRequested = true`, the reference workspace may require user acknowledgement before dispatch. This acknowledgement is not NXS approval and must not be confused with Gate 05.
- Run Ledger `orchestrator_dispatched.detail.selectedAgents[]` SHALL include `taskId` and `expectedOutputSlots`. OutputCollector validates actual `slotId` against the declared slots when slot policy requires strict validation.

### 3.3.1 Orchestrator Socket Contract

File: `packages/contracts/src/externals/orchestrator.ts`

This is the orchestrator plug contract. It defines the attachment point for a replaceable orchestrator. It does not implement orchestration intelligence.

    export interface Orchestrator {
      readonly orchestratorSocketId: NonEmpty;
      readonly orchestratorVersion: NonEmpty;
      dispatch(request: WorkspaceRunRequest): Promise<OrchestratorPlanPreview>;
    }

Law:

- The orchestrator plugin declares task IDs, selected agents, required checkpoints, and expected output slots.
- Nexus infra validates, records, and routes those declarations; Nexus infra does not invent the plan.
- A production orchestrator may be external HTTP, in-process adapter, or enterprise orchestration platform. In every case, the manifest socket ID and contract shape remain the attachment point.
- If an orchestrator uses LLM-assisted planning, that model-bound work must route through NVG under the orchestrator actor.

### 3.4 Output References

File: `packages/contracts/src/externals/output-references.ts`

The externals blueprint deferred exact output reference schemas to this spec. These are the canonical schemas.

    export type OutputSourceType = 'nvg_result' | 'nxs_execution_result' | 'agent_partial';

    export interface BaseOutputReference {
      outputReferenceId: Uuid;
      runId: Uuid;
      taskId: Uuid;
      agentId: Uuid;
      slotId: NonEmpty;
      sourceType: OutputSourceType;
      resultRef: NonEmpty;
      resultDigest: Sha256Hex;
      resultClassifications: DataClass[];
      octLevel: OctLevel;
      createdAt: IsoTimestamp;
      redactionState: 'not_required' | 'redacted' | 'blocked';
    }

    export interface NvgOutputReference extends BaseOutputReference {
      sourceType: 'nvg_result';
      routingTrailRecordId: Uuid;
      trailCorrelationId: Uuid;
      modelTierInvoked: ModelTier | null;
      responseSize: number | null;
    }

    export interface NxsOutputReference extends BaseOutputReference {
      sourceType: 'nxs_execution_result';
      evidenceRecordId: Uuid;
      executionGrantId: Uuid | null;
      finalOutcome: FinalOutcome;
    }

    export interface AgentPartialOutputReference extends BaseOutputReference {
      sourceType: 'agent_partial';
      producerKind: 'orchestrator' | 'agent' | 'adapter';
      parentOutputReferenceId: Uuid | null;
    }

Law:

- An output reference is not raw payload. It is metadata plus a payload reference and digest.
- `resultRef` must be resolvable by the configured output collector and mailbox backend.
- `resultDigest` must be SHA-256 of the exact bytes stored at or represented by `resultRef`.
- `resultClassifications` must be non-empty when mailbox manifest `classificationRequired = true`.
- `redactionState = 'blocked'` makes the reference non-compile-eligible.
- NVG/NXS internals do not write mailbox items directly. The composition boundary adapts their returns into these output references.

### 3.5 MailboxItem

File: `packages/contracts/src/externals/mailbox.ts`

    export type MailboxStatus = 'available' | 'blocked' | 'cancelled' | 'expired' | 'consumed';
    export type RedactionState = 'not_required' | 'redacted' | 'blocked';

    export interface MailboxItem {
      mailboxItemId: Uuid;
      mailboxId: NonEmpty;
      runId: Uuid;
      taskId: Uuid;
      agentId: Uuid;
      slotId: NonEmpty;
      sourceType: OutputSourceType;
      resultRef: NonEmpty;
      resultDigest: Sha256Hex;
      resultClassifications: DataClass[];
      octLevel: OctLevel;
      createdAt: IsoTimestamp;
      expiresAt: IsoTimestamp | null;
      evidenceRecordId: Uuid | null;
      routingTrailRecordId: Uuid | null;
      runLedgerEventId: Uuid | null;
      redactionState: RedactionState;
      mailboxStatus: MailboxStatus;
      compileEligible: boolean;
      consumedAt: IsoTimestamp | null;
      blockedReason: DenialCode | null;
    }

### 3.6 Mailbox Backend Contract and Baked Service Law

File: `packages/contracts/src/externals/mailbox.ts`

    export interface MailboxWriteInput {
      mailboxId: NonEmpty;
      output: NvgOutputReference | NxsOutputReference | AgentPartialOutputReference;
      expiresAt: IsoTimestamp | null;
      runLedgerEventId: Uuid | null;
    }

    export interface MailboxReadQuery {
      mailboxId: NonEmpty;
      runId: Uuid;
      includeIneligible?: boolean;
    }

    export interface MailboxBackend {
      readonly backendId: NonEmpty;
      readonly backendVersion: NonEmpty;
      write(item: MailboxItem): Promise<void>;
      getById(mailboxItemId: Uuid): Promise<MailboxItem | null>;
      listByRun(query: MailboxReadQuery): Promise<MailboxItem[]>;
      updateStatus(mailboxItemId: Uuid, next: MailboxStatus, reason: DenialCode | null): Promise<MailboxItem>;
    }

Baked implementation interface path: `packages/core/src/mailbox/mailbox-service.ts`

    export interface MailboxService {
      writeFromOutput(input: MailboxWriteInput): Promise<MailboxItem>;
      listEligibleForCompile(mailboxId: NonEmpty, runId: Uuid): Promise<MailboxItem[]>;
      markConsumed(mailboxId: NonEmpty, runId: Uuid, itemIds: Uuid[]): Promise<void>;
      cancelRun(mailboxId: NonEmpty, runId: Uuid, reason: DenialCode): Promise<void>;
    }

Law:

- `MailboxBackend` is the replaceable storage abstraction. It is the only mailbox-related plugin-facing contract.
- `MailboxBackend` has exactly one source of truth: `packages/contracts/src/externals/mailbox.ts`. Core implementation files import this contract and must not redefine a second backend interface.
- `MailboxService` is baked core infrastructure. It owns eligibility and transition rules and is not a replaceable plugin surface.
- Enterprises may replace storage later, such as JSONL to Postgres/S3/MinIO/object storage, but they may not replace digest/classification/status/redaction eligibility law.
- The V1 reference backend is local JSONL metadata plus filesystem payload references.
- Backend implementations must not call LLMs, NXS, NVG, connectors, approval channels, or workspace endpoints.

### 3.7 OutputContract

File: `packages/contracts/src/externals/output-contract.ts`

    export interface OutputContract {
      outputContractId: Uuid;
      runId: Uuid;
      mailboxId: NonEmpty;
      mailboxItems: Uuid[];
      inputDataClasses: DataClass[];
      inheritedCompileDataClass: DataClass;
      compileEligibility: CompileEligibility;
      runLedgerRefs: Uuid[];
      evidenceRefs: Uuid[];
      routingTrailRefs: Uuid[];
      createdAt: IsoTimestamp;
      contractDigest: Sha256Hex;
    }

    export interface CompileEligibility {
      deterministic: true;
      onPremSynthesis: boolean;
      frontierSynthesis: boolean;
      denialReason?: DenialCode;
    }

Digest law:

    contractDigest = sha256(canonicalize({
      outputContractId,
      runId,
      mailboxId,
      mailboxItems,
      inputDataClasses,
      inheritedCompileDataClass,
      compileEligibility,
      runLedgerRefs,
      evidenceRefs,
      routingTrailRefs,
      createdAt
    }))

### 3.8 OutputCollector Interface

File: `packages/contracts/src/externals/output-contract.ts`

    export interface OutputCollector {
      writeMailboxItemFromNvgResult(input: NvgOutputReference): Promise<MailboxItem>;
      writeMailboxItemFromNxsResult(input: NxsOutputReference): Promise<MailboxItem>;
      writeMailboxItemFromAgentPartial(input: AgentPartialOutputReference): Promise<MailboxItem>;
      buildOutputContract(runId: Uuid): Promise<OutputContract>;
    }

Law:

- OutputCollector is the only lawful writer from engine/orchestrator results into mailbox.
- Engine outputs are adapted into output references at the composition boundary.
- OutputCollector writes mailbox items only after the relevant audit write exists or has a null reason allowed by source type.
- OutputCollector must write or cause a Run Ledger `partial_result` event for every successful mailbox write.

### 3.9 Compiler Contracts

File: `packages/contracts/src/externals/compiler.ts`

    export type CompileMode = 'deterministic_render' | 'on_prem_synthesis' | 'frontier_synthesis';

    export interface CompileRequest {
      runId: Uuid;
      compilerSocketId: NonEmpty;
      mailboxId: NonEmpty;
      outputContractId: Uuid;
      requestedAt: IsoTimestamp;
    }

    export interface FinalResponseArtifact {
      artifactId: Uuid;
      runId: Uuid;
      compilerSocketId: NonEmpty;
      compilerActorId: Uuid | null;
      compileMode: CompileMode;
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

    export interface Compiler {
      readonly compilerSocketId: NonEmpty;
      readonly compilerVersion: NonEmpty;
      compile(request: CompileRequest, contract: OutputContract, items: MailboxItem[]): Promise<FinalResponseArtifact>;
    }

Baked service interface path: `packages/core/src/compile/compile-service.ts`

    export interface CompileService {
      compile(request: CompileRequest, contract: OutputContract, items: MailboxItem[]): Promise<FinalResponseArtifact>;
      selectCompileMode(contract: OutputContract, compilerRecord: CompilerManifestRecord, config: CompileConfig): CompileMode;
    }

Law:

- `Compiler` is the replaceable compiler socket contract.
- `CompileService` is baked core infrastructure. It selects the configured compiler from `CompilerManifestRecord`, enforces OCT-COMPILE inheritance, invokes the compiler, signs/verifies final artifact law, and prepares compile-return handoff.
- `selectCompileMode` must use the manifest record and compile config, not the `Compiler` implementation object, because mode law is governed by signed manifest configuration and operator compile config. The compiler implementation does not self-authorize its mode.
- `CompileConfig` is inherited from base engineering spec §12.3.33 and current repo path `packages/contracts/src/interfaces/index.ts`; this amendment does not create a second `CompileConfig` type.
- Reference deterministic renderer implements `Compiler` but is actor-registration exempt.
- Any compiler implementation that calls a model, third-party service, custom synthesis, or action surface must be represented by a registered OCT-COMPILE actor.
- A compiler must not mutate Evidence Ledger, Routing Provenance Trail, Run Ledger history, mailbox payloads, or source mailbox items.

### 3.10 Compile-Return Contracts

File: `packages/contracts/src/externals/compile-return.ts`

    export interface CompileReturnRequest {
      runId: Uuid;
      returnEndpointId: NonEmpty;
      targetWorkspaceSocketId: NonEmpty;
      artifact: FinalResponseArtifact;
      artifactDigest: Sha256Hex;
      sentAt: IsoTimestamp;
      auth: CompileReturnAuthEnvelope;
    }

    export interface CompileReturnAuthEnvelope {
      kind: 'signed_callback';
      keyId: NonEmpty;
      signature: Base64Url;
      signedAt: IsoTimestamp;
    }

    export interface CompileReturnVerifier {
      verify(request: CompileReturnRequest): Promise<boolean>;
    }

Signed callback law:

    signaturePayload = canonicalize({
      runId,
      returnEndpointId,
      targetWorkspaceSocketId,
      artifactDigest,
      sentAt,
      signedAt,
      keyId
    })

    signature = ed25519.sign(signaturePayload, configuredReturnSigningPrivateKey)

Workspace verification:

    verify ed25519 signature using configured keyId
    recompute artifactDigest from canonical artifact without transport auth
    assert recomputed digest equals request.artifactDigest
    assert request.artifact.runId equals request.runId
    assert request.artifact.signature verifies under compiler key law
    reject on any failure

Baked dispatcher interface path: `packages/core/src/compile/compile-return-dispatcher.ts`

    export interface CompileReturnDispatchInput {
      runId: Uuid;
      endpoint: CompileReturnEndpointRecord;
      artifact: FinalResponseArtifact;
      sentAt: IsoTimestamp;
    }

    export interface CompileReturnDispatcher {
      dispatch(input: CompileReturnDispatchInput): Promise<CompileReturnAck>;
    }

Dispatcher law:

- `CompileReturnDispatcher` is baked infrastructure, not a plugin.
- It receives the resolved `CompileReturnEndpointRecord` from `ExternalSocketRegistry.resolveReturnEndpointForRun(runId)`.
- It computes `artifactDigest = sha256(canonicalize(FinalResponseArtifact without transport auth))`.
- It builds `CompileReturnRequest` using endpoint ID, target workspace socket ID, artifact, digest, `sentAt`, and `signed_callback` auth.
- It signs the callback auth payload with the configured compile-return signing key.
- It sends the request through the configured `CompileReturnTransport` selected by `endpoint.endpointType`.
- It returns `CompileReturnAck` from the transport.
- It must not mark mailbox items consumed; consumption occurs only after compile-return acceptance or durable signed handoff acknowledgement in the compile runtime path.
- It must not call LLMs, NXS gates, NVG routing, connectors, approval channels, or workspace internals.

---

### 3.11 Manifest Record Types

File: `packages/contracts/src/externals/manifests.ts`

These records are typed outputs of manifest loaders. They describe sockets and endpoints. They do not compose runtime services.

    export type OutputSlotPolicy = 'strict_declared_slots' | 'advisory_declared_slots' | 'open_slots';

    export interface WorkspaceManifestRecord {
      workspaceSocketId: NonEmpty;
      workspaceType: NonEmpty;
      enabled: boolean;
      entryMode: 'governed_only';
      baseUrl: NonEmpty;
      returnEndpointId: NonEmpty;
      capabilities: { promptEntry: boolean; planReview: boolean; finalDisplay: boolean; fileSpace: boolean };
      configuration: Record<string, unknown>;
    }

    export interface OrchestratorManifestRecord {
      orchestratorSocketId: NonEmpty;
      orchestratorType: NonEmpty;
      enabled: boolean;
      orchestratorActorId: Uuid;
      plannerMode: 'deterministic_first' | 'policy_template' | 'llm_assisted';
      maxSplitDepth: number;
      planCheckbackDefault: boolean;
      secureMode: { octSecureDefault: 'single_agent_no_helper'; allowSecureMultiAgentOnlyBySignedPolicy: boolean };
      retryPolicy: { transientAutoRetryCount: number };
      timeouts: { systemActionMs: number; modelCallMs: number };
      outputSlotPolicy: OutputSlotPolicy;
      configuration: Record<string, unknown>;
    }

    export interface MailboxManifestRecord {
      mailboxId: NonEmpty;
      mailboxType: NonEmpty;
      enabled: boolean;
      required: boolean;
      storageRoot: NonEmpty;
      retentionPolicy: { payloadTtlSeconds: number; metadataRetention: 'run_ledger' };
      classificationRequired: boolean;
      digestRequired: boolean;
      configuration: Record<string, unknown>;
    }

    export interface CompilerManifestRecord {
      compilerSocketId: NonEmpty;
      compilerType: NonEmpty;
      enabled: boolean;
      actorRegistration: 'exempt_reference_deterministic_renderer' | 'required';
      compilerActorId: Uuid | null;
      octMode: 'OCT-COMPILE';
      allowedModes: CompileMode[];
      readsFromMailboxId: NonEmpty;
      outputContractVersion: 'v1';
      artifactSigning: CompilerArtifactSigning;
      configuration: Record<string, unknown>;
    }

    export type CompilerArtifactSigning =
      | { kind: 'control_plane' }
      | { kind: 'actor_registry_key'; keyId: NonEmpty };

    export interface CompileReturnEndpointRecord {
      returnEndpointId: NonEmpty;
      endpointType: 'http_callback';
      enabled: boolean;
      targetWorkspaceSocketId: NonEmpty;
      url: NonEmpty;
      auth: { kind: 'signed_callback'; keyId: NonEmpty };
      acceptedArtifactTypes: NonEmpty[];
      configuration: Record<string, unknown>;
    }

Law:

- Manifest record types may live in contracts because plugin authors need socket shape compatibility.
- Manifest record types do not expose composition or service instances. `ExternalsRuntime` remains bootstrap-owned.
- `outputSlotPolicy` is declared by the orchestrator manifest and enforced by OutputCollector when it can resolve the run plan.

### 3.12 Contract Validation Surface

Contracts must not import Zod unless repo law is changed by owner approval. Contract validation is provided through TypeScript types plus assert-style helper functions that throw typed validation errors. Zod schemas remain in manifest loaders or implementation packages.

Required helpers:

    assertWorkspaceRunRequest(input: unknown): asserts input is WorkspaceRunRequest
    assertOrchestratorPlanPreview(input: unknown): asserts input is OrchestratorPlanPreview
    assertMailboxItem(input: unknown): asserts input is MailboxItem
    assertOutputContract(input: unknown): asserts input is OutputContract
    assertFinalResponseArtifact(input: unknown): asserts input is FinalResponseArtifact
    assertCompileReturnRequest(input: unknown): asserts input is CompileReturnRequest

### 3.13 Factory Contracts

File: `packages/contracts/src/externals/factories.ts`

Factory contracts are the breaker slots. Manifests select a type discriminator; bootstrap factory registries resolve that discriminator to a known factory. YAML never executes arbitrary code.

    export interface WorkspaceFactory {
      readonly workspaceType: NonEmpty;
      readonly factoryVersion: NonEmpty;
      create(record: WorkspaceManifestRecord): Promise<WorkspaceAdapter>;
    }

    export interface OrchestratorFactory {
      readonly orchestratorType: NonEmpty;
      readonly factoryVersion: NonEmpty;
      create(record: OrchestratorManifestRecord): Promise<Orchestrator>;
    }

    export interface MailboxBackendFactory {
      readonly mailboxType: NonEmpty;
      readonly factoryVersion: NonEmpty;
      create(record: MailboxManifestRecord): Promise<MailboxBackend>;
    }

    export interface CompilerFactory {
      readonly compilerType: NonEmpty;
      readonly factoryVersion: NonEmpty;
      create(record: CompilerManifestRecord): Promise<Compiler>;
    }

    export interface CompileReturnTransportFactory {
      readonly endpointType: NonEmpty;
      readonly factoryVersion: NonEmpty;
      create(record: CompileReturnEndpointRecord): Promise<CompileReturnTransport>;
    }

Factory law:

- Factory registries are populated in bootstrap Step 01 before manifest loading.
- Every enabled manifest entry discriminator must resolve in its domain factory registry.
- Missing factory resolution fails closed before API traffic starts.
- Factories may instantiate adapters/transports/backends only for approved local implementation identifiers already registered in code.
- Manifest YAML must not carry executable import paths or arbitrary package code.

### 3.14 Payload Reference Contracts

File: `packages/contracts/src/externals/payload.ts`

Payload contracts define how infrastructure verifies `resultRef` without making NVG/NXS/mailbox know every storage system.

    export interface PayloadResolver {
      readonly resolverId: NonEmpty;
      readonly resolverVersion: NonEmpty;
      canResolve(resultRef: NonEmpty): boolean;
      resolveBytes(resultRef: NonEmpty): Promise<Uint8Array>;
    }

    export interface PayloadStore {
      readonly storeId: NonEmpty;
      readonly storeVersion: NonEmpty;
      write(runId: Uuid, bytes: Uint8Array, hint: NonEmpty): Promise<{ resultRef: NonEmpty; resultDigest: Sha256Hex }>;
      read(resultRef: NonEmpty): Promise<Uint8Array>;
    }

V1 allowed reference schemes:

    mailbox://<runId>/<mailboxItemId>
    file://<runtime-root-relative-path>
    inline://<reference-harness-id>

Law:

- `file://` refs must normalize under the configured runtime root; path escape fails closed.
- Unknown schemes fail closed with `payload_resolver_not_found`.
- OutputCollector must verify `resultDigest` against bytes resolved through an approved resolver before mailbox write.
- Reference harness may use `inline://` only in test/dev mode. Production manifests must use durable resolver schemes.

### 3.15 Compile-Return Transport Contract

File: `packages/contracts/src/externals/compile-return.ts`

    export interface CompileReturnTransport {
      readonly endpointType: NonEmpty;
      readonly transportVersion: NonEmpty;
      send(endpoint: CompileReturnEndpointRecord, request: CompileReturnRequest): Promise<CompileReturnAck>;
    }

Law:

- `CompileReturnTransport` is the outbound wire from Nexus compile-return dispatcher to the configured workspace endpoint.
- The V1 required transport is `http_callback`.
- The reference API route may receive the callback for tests, but production workspace implementations may host the receiver outside Nexus.
- A transport must not call LLMs, NXS gates, NVG routing, connectors, or approval channels.

## 4. Manifest Contracts

All manifests use the existing signed envelope:

    manifestVersion: '1.0'
    issuer: nexus-dev
    issuedAt: '<iso timestamp>'
    signature: '<ed25519 signature over canonicalized body>'
    body:
      ... domain body ...

The shared loader remains `packages/runtime-utils/src/manifest/load-signed-manifest.ts`.

### 4.1 Required New Manifest Files

| Domain | Path | Required in governed runtime mode |
|---|---|---:|
| workspace | `config/workspace/workspaces.v1.yaml` | yes |
| orchestrator | `config/orchestrators/orchestrators.v1.yaml` | yes |
| mailbox | `config/mailbox/mailboxes.v1.yaml` | yes |
| compiler | `config/compile/compilers.v1.yaml` | yes |
| compile-return | `config/output/compile-return.v1.yaml` | yes |

### 4.2 Workspace Manifest Body

File: `config/workspace/workspaces.v1.yaml`

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

Schema path: `packages/core/src/manifest/workspace/workspace-manifest-loader.ts`

    WorkspaceManifestBodySchema = z.object({
      workspaces: z.array(WorkspaceManifestEntrySchema).min(1)
    }).strict()

    WorkspaceManifestEntrySchema = z.object({
      workspaceSocketId: z.string().min(1),
      workspaceType: z.string().min(1),
      enabled: z.boolean(),
      entryMode: z.literal('governed_only'),
      baseUrl: z.string().url(),
      returnEndpointId: z.string().min(1),
      capabilities: z.object({
        promptEntry: z.boolean(),
        planReview: z.boolean(),
        finalDisplay: z.boolean(),
        fileSpace: z.boolean()
      }).strict(),
      configuration: z.record(z.unknown())
    }).strict()

Loader invariants:

- At least one enabled workspace is required.
- `workspaceType` must resolve in the populated WorkspaceFactoryRegistry.
- Duplicate `workspaceSocketId` fails closed.
- Enabled workspace with `entryMode` other than `governed_only` fails closed in governed runtime mode.
- `returnEndpointId` must resolve in compile-return manifest after all manifests load.

### 4.3 Orchestrator Manifest Body

File: `config/orchestrators/orchestrators.v1.yaml`

    body:
      orchestrators:
        - orchestratorSocketId: reference-orchestrator
          orchestratorType: reference_deterministic
          enabled: true
          orchestratorActorId: '<registered-orchestrator-actor-uuid>'
          plannerMode: deterministic_first
          maxSplitDepth: 1
          planCheckbackDefault: true
          secureMode:
            octSecureDefault: single_agent_no_helper
            allowSecureMultiAgentOnlyBySignedPolicy: true
          retryPolicy:
            transientAutoRetryCount: 1
          timeouts:
            systemActionMs: 30000
            modelCallMs: 60000
          outputSlotPolicy: strict_declared_slots
          configuration: {}

Loader invariants:

- At least one enabled orchestrator is required.
- `orchestratorType` must resolve in the populated OrchestratorFactoryRegistry.
- Duplicate `orchestratorSocketId` fails closed.
- `orchestratorActorId` must be syntactically UUID.
- `maxSplitDepth` must be `0` or `1` for V1. Values greater than `1` fail closed.
- `plannerMode` allowed values for V1: `deterministic_first`, `policy_template`, `llm_assisted`. If `llm_assisted`, the orchestrator actor must have an OCT that permits the model route through NVG.
- `outputSlotPolicy` allowed values: `strict_declared_slots`, `advisory_declared_slots`, `open_slots`. Production default SHALL be `strict_declared_slots`.
- OCT-SECURE default must be `single_agent_no_helper`.

### 4.4 Mailbox Manifest Body

File: `config/mailbox/mailboxes.v1.yaml`

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

Loader invariants:

- Exactly one enabled `required: true` mailbox is required in V1 governed runtime mode. Additional mailbox records must be disabled or non-required future placeholders.
- `mailboxType` must resolve in the populated MailboxBackendFactoryRegistry.
- Duplicate `mailboxId` fails closed.
- `storageRoot` must be repo-relative or absolute and must not escape the configured runtime root after path normalization.
- `payloadTtlSeconds` minimum is `60`; maximum is `86400` unless owner-approved.
- `classificationRequired` must be true for governed runtime mode.
- `digestRequired` must be true for governed runtime mode.

### 4.5 Compiler Manifest Body

File: `config/compile/compilers.v1.yaml`

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
          artifactSigning:
            kind: control_plane
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
          artifactSigning:
            kind: actor_registry_key
            keyId: '<compiler-actor-signing-key>'
          configuration: {}

Loader invariants:

- At least one enabled compiler is required.
- `compilerType` must resolve in the populated CompilerFactoryRegistry.
- Duplicate `compilerSocketId` fails closed.
- `octMode` must equal `OCT-COMPILE`.
- If `actorRegistration = exempt_reference_deterministic_renderer`, then `compilerType` must equal `reference_deterministic_renderer`, `compilerActorId` must be null, and `allowedModes` must equal `['deterministic_render']`.
- If `actorRegistration = required`, then `compilerActorId` must be a UUID and the actor registry must resolve it as an OCT-COMPILE actor before compile execution.
- `artifactSigning.kind = control_plane` is required for the reference deterministic compiler.
- `artifactSigning.kind = actor_registry_key` is required for non-reference compilers unless owner-approved compiler-key registry law supersedes it.
- `artifactSigning` key resolution failure fails closed with `compiler_signature_key_unresolved`.
- `readsFromMailboxId` must resolve to the single enabled required mailbox.

### 4.6 Compile-Return Manifest Body

File: `config/output/compile-return.v1.yaml`

    body:
      returnEndpoints:
        - returnEndpointId: reference-workspace-return
          endpointType: http_callback
          enabled: true
          targetWorkspaceSocketId: reference-workspace
          url: http://localhost:4100/nexus/compile-return
          auth:
            kind: signed_callback
            keyId: dev-compile-return-key
          acceptedArtifactTypes:
            - final_response.v1
          configuration: {}

Loader invariants:

- At least one enabled return endpoint is required.
- `endpointType` must resolve in the populated CompileReturnTransportFactoryRegistry.
- Duplicate `returnEndpointId` fails closed.
- `targetWorkspaceSocketId` must resolve to an enabled workspace.
- `auth.kind` must equal `signed_callback` for V1.
- `acceptedArtifactTypes` must include `final_response.v1`.
- URL must be HTTP(S). Localhost HTTP is allowed only in development/test mode.

### 4.7 Cross-Domain Collision Law

The existing NISP collision check is warning-only for older NISP domains unless a required externals cross-reference depends on that ID. This externals amendment requires fail-closed collision detection for required external socket domains.

`ManifestDomain` in `packages/runtime-utils/src/qualified-identifier.ts` SHALL expand from the current four NISP domains to these nine domain values:

    identity
    connector
    channel
    endpoint
    workspace
    orchestrator
    mailbox
    compiler
    compileReturn

Fail-closed required externals domains:

    workspace.workspaceSocketId
    orchestrator.orchestratorSocketId
    mailbox.mailboxId
    compiler.compilerSocketId
    compileReturn.returnEndpointId

Warning-only legacy/NISP domains unless referenced by required externals validation:

    identity.providerId
    connector.connectorId
    channel.channelId
    endpoint.endpointId

Rules:

- Duplicate ID within any required externals domain: fail closed.
- Same raw ID across any two required externals domains: fail closed.
- Same raw ID between a required externals domain and a legacy/NISP domain: fail closed only when that legacy/NISP ID is referenced by a required externals manifest; otherwise emit warning under existing NISP behavior.
- Duplicate ID within legacy/NISP domains remains governed by the NISP amendment/spec.
- A qualified identifier convention such as `workspace:reference-workspace` may be used in diagnostics, but raw required externals IDs must still be unique unless a later blueprint explicitly relaxes this.

### 4.8 External Socket Registry

Path: `packages/core/src/externals/external-socket-registry.ts`

The external socket registry is the baked index of all loaded externals sockets. It is not a plugin. It is the breaker-box terminal map used by bootstrap, OutputCollector, CompileService, CompileReturnDispatcher, and API DI.

    export interface ExternalSocketRegistry {
      getWorkspace(workspaceSocketId: NonEmpty): WorkspaceManifestRecord | null;
      getOrchestrator(orchestratorSocketId: NonEmpty): OrchestratorManifestRecord | null;
      getPrimaryMailbox(): MailboxManifestRecord;
      getMailbox(mailboxId: NonEmpty): MailboxManifestRecord | null;
      getCompiler(compilerSocketId: NonEmpty): CompilerManifestRecord | null;
      getDefaultCompiler(): CompilerManifestRecord;
      getReturnEndpoint(returnEndpointId: NonEmpty): CompileReturnEndpointRecord | null;
      resolveReturnEndpointForRun(runId: Uuid): Promise<CompileReturnEndpointRecord>;
      validateCrossReferences(): void;
    }

Registry law:

- Constructed only by `scripts/nexus-bootstrap.ts` after all required manifests load.
- Holds manifest records and lookup indexes only; it does not execute plugin behavior.
- Cross-reference validation fails closed before API traffic starts.
- `resolveReturnEndpointForRun` follows: `runId -> run_opened.detail.workspaceSocketId -> WorkspaceManifestRecord.returnEndpointId -> CompileReturnEndpointRecord`.
- Missing `run_opened`, missing workspace socket, or missing return endpoint fails closed.
- This method is the single return endpoint resolver. Do not add a separate `ReturnEndpointResolver` service unless a later blueprint introduces a distinct resolver responsibility.

---

## 5. Bootstrap Expansion


The current `scripts/nexus-bootstrap.ts` has 12 steps. This amendment expands it to the blueprint-pinned 21-step target end state. Do not create a second bootstrap.

### 5.1 Expanded Bootstrap Order

    Step 01: Register factory registries + built-in factories
             - WorkspaceFactoryRegistry
             - OrchestratorFactoryRegistry
             - MailboxBackendFactoryRegistry
             - CompilerFactoryRegistry
             - CompileReturnTransportFactoryRegistry
             - built-in reference factories for reference harness/testing surfaces
    Step 02: Load control-plane keypair
    Step 03: Load identity manifest
    Step 04: Evaluate RIA bridge conditions
    Step 05: Load connector manifest
    Step 06: Load channel manifest
    Step 07: Load endpoint manifest
    Step 08: Populate TierRegistry from loaded endpoints
    Step 09: Create NvgTransportContext
    Step 10: Load NVG routing policy
    Step 11: Load mode configuration
    Step 12: Construct NvgServiceImpl
    Step 13: Load workspace manifest
    Step 14: Load orchestrator manifest
    Step 15: Load mailbox manifest
    Step 16: Load compiler manifest
    Step 17: Load compile-return manifest
    Step 18: Run required-domain collision and cross-reference validation
    Step 19: Construct MailboxBackend + baked MailboxService
    Step 20: Construct ExternalSocketRegistry, DeclaredOutputSlotReader, PayloadResolver set, OutputCollector
    Step 21: Construct CompileService, CompileReturnDispatcher, reference deterministic compiler, assemble ExternalsRuntime, and return full BootstrapResult

### 5.2 Expanded BootstrapResult

File: `scripts/nexus-bootstrap.ts`

    export interface BootstrapResult {
      readonly nvgService: NvgServiceImpl;
      readonly transportContext: NvgTransportContext;
      readonly tierRegistry: TierRegistry;
      readonly trailBackend: JsonlRoutingTrailBackend;
      readonly endpoints: readonly ModelEndpoint[];
      readonly controlPlanePublicKey: string;
      readonly routingPolicy: NvgRoutingPolicy;
      readonly modeConfig: ModeConfiguration;

      readonly externals: ExternalsRuntime;
    }

File: `scripts/nexus-bootstrap.ts` or `scripts/bootstrap-types.ts`

    export interface ExternalsRuntime {
      readonly workspaceSockets: readonly WorkspaceManifestRecord[];
      readonly orchestratorSockets: readonly OrchestratorManifestRecord[];
      readonly mailboxService: MailboxService; // core baked service type; bootstrap/composition root only
      readonly outputCollector: OutputCollector;
      readonly compileService: CompileService;
      readonly compileReturnDispatcher: CompileReturnDispatcher;
      readonly socketRegistry: ExternalSocketRegistry;
      readonly compileReturnEndpoints: readonly CompileReturnEndpointRecord[];
    }

Law:

- `ExternalsRuntime` is not exported from `@nexus/contracts`.
- It is a composition-root aggregate used by bootstrap and API DI only.
- Plugin authors import service/socket contracts, not runtime assembly shape.

### 5.3 Fail-Closed Startup Rule

If any required external manifest is missing, unsigned, invalidly signed, schema-invalid, all-disabled, or cross-reference-invalid, governed runtime startup must fail before any API route begins accepting traffic.

No reference harness may silently downgrade into direct response mode.

### 5.4 Baked Runtime Services Added by This Amendment

The following baked services are constructed by bootstrap and passed by DI. They are infrastructure, not replaceable plugin behavior.

| Service | Path | Purpose |
|---|---|---|
| `ExternalSocketRegistry` | `packages/core/src/externals/external-socket-registry.ts` | Loaded socket indexes and cross-reference lookup. |
| `DeclaredOutputSlotReader` | `packages/core/src/output/declared-output-slot-reader.ts` | Reads declared output slots from Run Ledger `orchestrator_dispatched` detail. |
| `PayloadResolverRegistry` | `packages/core/src/output/payload-resolver.ts` | Resolves approved `resultRef` schemes to bytes for digest verification. |
| `OutputCollector` | `packages/core/src/output/output-collector.ts` | Converts output references into mailbox items and output contracts. |
| `MailboxService` | `packages/core/src/mailbox/mailbox-service.ts` | Enforces mailbox eligibility and status transition law. |
| `CompileService` | `packages/core/src/compile/compile-service.ts` | Enforces compile mode selection and invokes the selected compiler through law. |
| `CompileReturnDispatcher` | `packages/core/src/compile/compile-return-dispatcher.ts` | Builds signed compile-return request and sends it through configured transport. |

---

## 6. Runtime Wiring — Inputs, Outputs, and Wires

### 6.1 Canonical Runtime Wire

The runtime wire implemented by this amendment is:

    WorkspaceRunRequest
      -> OrchestratorPlanPreview
      -> agent dispatch metadata
      -> NVG / NXS checkpoint calls
      -> OutputReference
      -> OutputCollector
      -> MailboxItem
      -> OutputContract
      -> CompileRequest
      -> FinalResponseArtifact
      -> CompileReturnRequest
      -> workspace final display

### 6.2 Workspace Entry Wire

REFERENCE HARNESS — NOT INFRA LAW. This route is a test plug proving the workspace socket, runId wire, prompt digest, ledger open event, and orchestrator handoff. Production workspace implementations replace it through the workspace manifest/factory surface.

Reference route: `packages/interfaces/api/src/routes/workspace.ts`

Endpoint:

    POST /workspace/runs

Input:

    {
      userId,
      principalId,
      prompt,
      selectedAgentIds?,
      planCheckbackRequested?
    }

Injected dependencies:

    IdentityProviderInterface
    RunLedgerWriter
    Workspace manifest records
    Orchestrator dispatch service or reference harness

Behavior:

    authenticate or resolve identity through configured identity provider
    generate runId = crypto.randomUUID()
    enteredAt = nowIso()
    promptDigest = sha256(canonicalize({ runId, prompt, enteredAt, workspaceSocketId }))
    build WorkspaceRunRequest
    write Run Ledger event run_opened
    forward request to orchestrator socket
    return { runId, planPreview? }

Run Ledger `run_opened` detail must include:

    workspaceSocketId
    userId
    principalId
    authenticatedBy
    promptDigest
    selectedAgentIds
    planCheckbackRequested

Run Ledger `run_opened` detail must not include raw prompt by default.

### 6.3 Orchestrator Dispatch Wire

REFERENCE HARNESS — NOT INFRA LAW. This route is a test plug proving the orchestrator socket, plan preview contract, expected output slot declaration, ledger event, and dispatch wire. Production orchestrator implementations replace it through the orchestrator manifest/factory surface. Nexus infra validates/carries/records the plan; it does not generate orchestration intelligence.

Reference route: `packages/interfaces/api/src/routes/orchestrator.ts`

Endpoint:

    POST /orchestrator/dispatch

Input:

    WorkspaceRunRequest

Behavior:

    load enabled orchestrator socket from manifest
    validate orchestrator actor registration if registry is available in this phase
    create OrchestratorPlanPreview
    require each selected task to carry expectedOutputSlots
    write Run Ledger event orchestrator_dispatched
    for each selected task:
      create scoped delegation through existing delegation law when action path exists
      dispatch to reference harness or configured external orchestrator adapter

Run Ledger `orchestrator_dispatched` detail must include:

    orchestratorSocketId
    orchestratorActorId
    plannerMode
    planDigest
    selectedAgentCount
    selectedAgentIds
    taskIds
    selectedAgents[].expectedOutputSlots
    outputSlotPolicy

### 6.4 NVG Output Wire

Input source:

    NvgClassifyAndRouteResult from NvgService.classifyAndRoute()

Adapter path:

    scripts/nexus-bootstrap.ts composition boundary or a core output adapter called only by composition root

Output reference:

    NvgOutputReference

Required mapping:

    outputReferenceId = newUuid()
    runId = request.runId
    taskId = task context taskId
    agentId = request.actorId
    slotId = deterministic slot from task output name or new slot sequence
    sourceType = 'nvg_result'
    resultRef = payload reference from normalized response storage
    resultDigest = sha256(payload bytes)
    resultClassifications = [classification.effectiveDataClass]
    octLevel = request.octLevel
    routingTrailRecordId = inbound trail entry id if available, otherwise outbound denial trail id for denied result refs
    trailCorrelationId = result.trailCorrelationId
    modelTierInvoked = result.modelTierInvoked
    responseSize = result.invocation?.responseSize ?? null

Rule:

- If NVG denies and there is no payload result, the output collector may write an agent partial denial summary only if the orchestrator needs it for final deterministic render. It must not fabricate a model result.

### 6.5 NXS Output Wire

Input source:

    PipelineResult from PipelineInterface.process()

Output reference:

    NxsOutputReference

Required mapping:

    outputReferenceId = newUuid()
    runId = evidenceRecord.runId
    taskId = task context taskId
    agentId = evidenceRecord.actionSummary.actorId
    slotId = deterministic slot from action/tool name or new slot sequence
    sourceType = 'nxs_execution_result'
    resultRef = execution result payload reference or redacted summary reference
    resultDigest = sha256(payload bytes)
    resultClassifications = evidenceRecord.actionSummary.resolvedDataClasses unless sentinel, else ['internal'] only if policy permits
    octLevel = actor.octLevel
    evidenceRecordId = evidenceRecord.recordId
    executionGrantId = grantMetadata.grantId unless sentinel, else null
    finalOutcome = evidenceRecord.finalOutcome

Rule:

- Evidence must be written before the NXS output reference becomes mailbox eligible.
- Failed/denied NXS actions may still produce mailbox items if the compiler needs to explain denied work, but they must be classified and marked accurately.

### 6.6 Agent Partial Wire

Input source:

    Orchestrator/reference harness partial result

Output reference:

    AgentPartialOutputReference

Rules:

- Agent partials must carry `runId`, `taskId`, `agentId`, `slotId`, digest, classification, and OCT.
- Agent partials cannot bypass OutputCollector.
- Agent partials cannot be sent to workspace final display.

### 6.7 OutputCollector to Mailbox Wire

File: `packages/core/src/output/output-collector.ts`

Algorithm:

    writeMailboxItemFromNvgResult(input):
      assert input.sourceType == 'nvg_result'
      assert payload resolver exists for resultRef
      assert digest verifies against bytes resolved from resultRef
      assert classifications if required
      slotCheck = declaredOutputSlotReader.validate(runId, taskId, slotId, outputSlotPolicy)
      if strict and !slotCheck.matched: fail closed with undeclared_output_slot
      item = mailboxService.writeFromOutput({ mailboxId, output: input, expiresAt, runLedgerEventId: null })
      write Run Ledger partial_result with mailboxItemId, sourceType, resultDigest
      return item

    writeMailboxItemFromNxsResult(input):
      assert input.sourceType == 'nxs_execution_result'
      assert evidenceRecordId present
      assert payload resolver exists for resultRef
      assert digest verifies against bytes resolved from resultRef
      slotCheck = declaredOutputSlotReader.validate(runId, taskId, slotId, outputSlotPolicy)
      if strict and !slotCheck.matched: fail closed with undeclared_output_slot
      item = mailboxService.writeFromOutput(...)
      write Run Ledger partial_result
      return item

    buildOutputContract(runId):
      mailboxId = socketRegistry.getPrimaryMailbox().mailboxId
      items = mailboxService.listEligibleForCompile(mailboxId, runId)
      if items.length == 0: fail closed with OUTPUT_CONTRACT_EMPTY and do not invoke compiler
      compute inputDataClasses from all items
      inherited = computeCompileOctCeiling(inputDataClasses)
      eligibility = computeCompileEligibility(inherited, items)
      refs = collect run/evidence/routing refs
      contract = build + digest
      write Run Ledger compile_started with outputContractId and contractDigest
      return contract

### 6.7.1 Declared Output Slot Reader

Path: `packages/core/src/output/declared-output-slot-reader.ts`

    export interface SlotValidationResult {
      policy: OutputSlotPolicy;
      declared: boolean;
      matched: boolean;
      reason: DenialCode | null;
    }

    export interface DeclaredOutputSlotReader {
      validate(runId: Uuid, taskId: Uuid, slotId: NonEmpty, policy: OutputSlotPolicy): Promise<SlotValidationResult>;
    }

Law:

- Source of truth is Run Ledger `orchestrator_dispatched.detail.selectedAgents[].expectedOutputSlots`.
- `strict_declared_slots`: missing declaration or unmatched slot fails closed with `undeclared_output_slot`.
- `advisory_declared_slots`: unmatched slot is logged in `partial_result.detail.slotValidation` but does not block.
- `open_slots`: slot declaration is not required.
- Nexus infra does not generate expected slots; it only validates actual slots against what the orchestrator plugin declared.

### 6.7.2 Payload Resolver Registry

Path: `packages/core/src/output/payload-resolver.ts`

    export interface PayloadResolverRegistry {
      register(resolver: PayloadResolver): void;
      resolveBytes(resultRef: NonEmpty): Promise<Uint8Array>;
      verifyDigest(resultRef: NonEmpty, expected: Sha256Hex): Promise<boolean>;
    }

Law:

- OutputCollector must use the resolver registry before mailbox write.
- Missing resolver fails closed with `payload_resolver_not_found`.
- Digest mismatch fails closed with `mailbox_digest_mismatch`.
- The resolver registry is populated by bootstrap with only approved built-in/resolved factories.

### 6.8 Mailbox to Compile Wire

Reference route: `packages/interfaces/api/src/routes/compile.ts`

Endpoint:

    POST /compile/runs/:runId

Behavior:

    outputContract = outputCollector.buildOutputContract(runId)
    compiler = selected enabled compiler from manifest
    items = mailboxService.listEligibleForCompile(mailboxId, runId)
    compileRequest = { runId, compilerSocketId, mailboxId, outputContractId, requestedAt }
    artifact = compileService.compile(compileRequest, outputContract, items)
    endpoint = socketRegistry.resolveReturnEndpointForRun(runId)
    ack = compileReturnDispatcher.dispatch({ runId, endpoint, artifact, sentAt: nowIso() })
    mark mailbox items consumed only after successful compile-return acceptance or durable signed handoff acknowledgement

Run Ledger:

- `compile_started` when output contract is created.
- `compile_mode_selected` after compile mode is selected.
- `final_response` after final artifact is created and compile-return handoff is accepted or durably acknowledged depending on transport mode.

### 6.9 Compile to Workspace Return Wire

The production wire is outbound from Nexus compile-return dispatcher to the configured workspace return endpoint. The route below is a reference harness receiver for local tests.

Production outbound path:

    CompileService
      -> FinalResponseArtifact
      -> CompileReturnDispatcher
      -> CompileReturnTransport(http_callback)
      -> configured workspace return endpoint
      -> CompileReturnAck
      -> mailbox consumed transition

Reference route: `packages/interfaces/api/src/routes/compile-return.ts`

Endpoint:

    POST /compile-return/:returnEndpointId

Input:

    CompileReturnRequest

Artifact type law:

    V1 FinalResponseArtifact has implicit artifact type final_response.v1.
    The endpoint acceptedArtifactTypes check verifies final_response.v1 is configured.
    Do not add an artifactType field to FinalResponseArtifact without blueprint amendment.

Behavior:

    verify returnEndpointId exists and enabled
    verify targetWorkspaceSocketId matches endpoint config
    verify signed_callback envelope
    verify artifactDigest
    verify artifact signature
    verify artifact.runId == request.runId
    write Run Ledger final_response if not already written
    write Run Ledger run_closed after successful display handoff
    return accepted

Workspace route must reject:

- invalid callback signature
- digest mismatch
- unknown return endpoint
- disabled return endpoint
- endpoint/workspace mismatch
- artifact type not accepted
- runId mismatch

---

## 7. Mailbox Implementation

### 7.1 Local JSONL Reference Backend

Path: `packages/core/src/mailbox/local-jsonl-mailbox.backend.ts`

Storage layout:

    runs/mailbox/
      mailbox-items.jsonl
      payloads/
        <runId>/
          <mailboxItemId>.payload

JSONL line:

    MailboxItem as canonical JSON

Payload storage:

- V1 backend stores payload bytes only when OutputCollector receives inline bytes from a reference harness.
- If `resultRef` is already an external durable reference, backend stores only metadata and verifies digest through the configured resolver.
- Payload files must be written before metadata append.
- Metadata append is append-only. Status transitions append a new version record rather than mutating prior JSONL line, unless the repo's existing JSONL helper already supports safe rewrite with audit preservation. Preferred V1 is append-only version records.

### 7.2 Mailbox Item Identity

    mailboxItemId = uuidv4()

Uniqueness:

- Unique across all mailboxes.
- A duplicate ID discovered during backend read is a data integrity error and must fail closed.

### 7.3 Eligibility Function

Path: `packages/core/src/mailbox/mailbox-eligibility.ts`

    function computeMailboxEligibility(item, policy): EligibilityResult {
      if (!verifyDigest(item.resultRef, item.resultDigest))
        return blocked('mailbox_digest_mismatch')

      if (policy.classificationRequired && item.resultClassifications.length === 0)
        return blocked('mailbox_classification_missing')

      if (item.redactionState === 'blocked')
        return blocked('mailbox_redaction_blocked')

      if (item.mailboxStatus !== 'available')
        return ineligible(item.mailboxStatus)

      if (item.expiresAt !== null && item.expiresAt <= nowIso())
        return transition('expired')

      return eligible()
    }

Additive denial codes required in `packages/contracts/src/constants/index.ts`:

    MAILBOX_DIGEST_MISMATCH = 'mailbox_digest_mismatch'
    MAILBOX_CLASSIFICATION_MISSING = 'mailbox_classification_missing'
    MAILBOX_REDACTION_BLOCKED = 'mailbox_redaction_blocked'
    MAILBOX_ITEM_EXPIRED = 'mailbox_item_expired'
    MAILBOX_ITEM_CANCELLED = 'mailbox_item_cancelled'
    MAILBOX_ITEM_CONSUMED = 'mailbox_item_consumed'
    OUTPUT_CONTRACT_EMPTY = 'output_contract_empty'
    COMPILE_FRONTIER_DENIED = 'compile_frontier_denied'
    COMPILE_RETURN_SIGNATURE_INVALID = 'compile_return_signature_invalid'
    COMPILE_RETURN_DIGEST_MISMATCH = 'compile_return_digest_mismatch'
    EXTERNAL_MANIFEST_CROSS_DOMAIN_COLLISION = 'external_manifest_cross_domain_collision'
    UNDECLARED_OUTPUT_SLOT = 'undeclared_output_slot'
    PAYLOAD_RESOLVER_NOT_FOUND = 'payload_resolver_not_found'
    COMPILER_SIGNATURE_KEY_UNRESOLVED = 'compiler_signature_key_unresolved'
    COMPILE_RETURN_DISPATCH_FAILED = 'compile_return_dispatch_failed'

### 7.4 Status Transitions

Allowed transitions:

| From | To | When |
|---|---|---|
| available | blocked | digest/classification/redaction/policy/secure-loop invariant fails |
| available | cancelled | run/task cancelled before consumption |
| available | expired | TTL exceeded before consumption |
| available | consumed | Compile-return accepted by configured workspace endpoint, or future durable return queue signs and acknowledges handoff ownership |
| blocked | blocked | idempotent repeated read |
| cancelled | cancelled | idempotent repeated cancel |
| expired | expired | idempotent repeated expiry |
| consumed | consumed | idempotent repeated consume acknowledgement |

Forbidden transitions:

- blocked -> available
- cancelled -> available
- expired -> available
- consumed -> available
- consumed -> blocked/cancelled/expired

Failed compile, failed return dispatch, non-2xx HTTP callback, invalid compile-return ack, or unsigned/non-durable handoff must not consume mailbox items.

---

## 8. Compile Implementation

### 8.1 Compile Ceiling Math

Use the existing base spec data class order:

    DATA_CLASS_ORDER = ['public', 'internal', 'confidential', 'pii', 'phi', 'financial']

Function:

    function computeCompileOctCeiling(inputDataClasses: DataClass[]): DataClass {
      assert inputDataClasses.length > 0
      maxIdx = 0
      for dc in inputDataClasses:
        idx = DATA_CLASS_ORDER.indexOf(dc)
        if idx < 0: throw UNKNOWN_DATA_CLASS
        if idx > maxIdx: maxIdx = idx
      return DATA_CLASS_ORDER[maxIdx]
    }

Frontier synthesis eligibility:

    frontierSynthesis = !inputDataClasses.some(isSensitiveDataClass)

On-prem synthesis eligibility:

    onPremSynthesis = configured on-prem compiler available AND no policy denial

Deterministic eligibility:

    deterministic = true

### 8.2 Compile Mode Selection

Path: `packages/core/src/compile/compile-service.ts`

Input:

    CompileRequest
    OutputContract
    MailboxItem[]
    CompilerManifestRecord
    CompileConfig from packages/contracts/src/interfaces/index.ts
    NvgService from @nexus/contracts when frontier_synthesis is enabled

Algorithm:

    selectCompileMode(contract: OutputContract, compilerRecord: CompilerManifestRecord, config: CompileConfig): CompileMode
      if compilerRecord.allowedModes contains only deterministic_render:
        return deterministic_render

      if contract.compileEligibility.frontierSynthesis
         and config.preferFrontierSynthesis
         and compilerRecord.allowedModes includes frontier_synthesis:
           return frontier_synthesis

      if contract.compileEligibility.onPremSynthesis
         and compilerRecord.allowedModes includes on_prem_synthesis:
           return on_prem_synthesis

      return deterministic_render

Secure rule:

- If inherited compile data class is sensitive, `frontier_synthesis` is hard-denied regardless of operator preference.
- `OCT-SECURE` input forces deterministic or on-prem mode.
- Reference deterministic renderer never calls NVG, NXS, connectors, or LLMs.
- If `frontier_synthesis` is selected, CompileService must route the compiler model-bound request through injected `NvgService` from `@nexus/contracts` as an OCT-COMPILE actor path. The compiler receives only the NVG-normalized result. Direct provider calls by compiler plugins are prohibited in governed runtime mode.

### 8.3 Reference Deterministic Renderer

Path: `packages/core/src/compile/deterministic-renderer.ts`

Behavior:

    render(items, outputContract):
      sort items by createdAt asc, then taskId asc, then slotId asc
      body = deterministic markdown/plaintext summary of available payload references and redacted summaries
      bodyBytes = utf8(body)
      bodyDigest = sha256(bodyBytes)
      bodyRef = write body to runs/compile/<runId>/<artifactId>.txt
      artifact = FinalResponseArtifact
      artifact.signature = sign(canonicalize(artifact without signature), compiler signing key)
      return artifact

Constraints:

- No model call.
- No action call.
- No network call except filesystem storage.
- No mutation of source mailbox items.
- Deterministic item ordering required for replay.

### 8.4 Final Artifact Digest

    artifactDigest = sha256(canonicalize(FinalResponseArtifact without signature))

The compile-return request carries both `artifact.signature` and `artifactDigest`. The artifact signature proves compiler authenticity; the compile-return auth proves transport authenticity.

---

## 9. OCT-SECURE Hardened Loop

### 9.1 OCT-SECURE Default Runtime Shape

When the workspace/orchestrator request enters OCT-SECURE path:

    workspace -> orchestrator -> single selected agent -> NVG on_prem_sensitive or NXS -> output collector -> mailbox -> deterministic/on-prem compile -> compile-return -> workspace

Hard rules:

- No frontier model endpoints.
- No helper/multi-agent split unless signed policy explicitly permits secure multi-agent.
- No raw prompt long-term storage by default.
- No direct output to workspace.
- No compiler frontier synthesis.
- No mailbox read unless digest, classification, status, and redaction checks pass.

### 9.2 Secure Loop Gate

Test path: `tests/externals/oct-secure-loop.test.ts`

The test must prove:

1. OCT-SECURE workspace request receives a runId.
2. Orchestrator manifest default enforces `single_agent_no_helper`.
3. Any attempt to plan multi-agent under OCT-SECURE without signed policy fails closed.
4. NVG denies frontier route for sensitive data.
5. OutputCollector writes only classified/digested mailbox item.
6. Compile mode is deterministic or on-prem, never frontier.
7. Final response returns only through compile-return endpoint.
8. Run Ledger contains `run_opened`, `orchestrator_dispatched`, `partial_result`, `compile_started`, `compile_mode_selected`, `final_response`, `run_closed`.

---

## 10. Run Ledger Integration

### 10.1 Existing Event Lifecycle Reuse

The existing `RunEventType` is canonical and must be reused first:

| Runtime moment | Existing event |
|---|---|
| workspace accepted request | `run_opened` |
| orchestrator dispatched plan | `orchestrator_dispatched` |
| delegation issued | `delegation_issued` |
| NVG outbound | `nvg_outbound` |
| NVG inbound | `nvg_inbound` |
| NVG denied | `nvg_denied` |
| NXS action completed | `nxs_action` |
| output collector mailbox write | `partial_result` |
| output contract built / compile begins | `compile_started` |
| compile mode selected | `compile_mode_selected` |
| final artifact / return prepared | `final_response` |
| workspace final display accepted | `run_closed` |

### 10.2 Additive Event Types

The existing lifecycle must be reused first. This spec permits exactly one additive `RunEventType` value:

    mailbox_item_status_changed

Do not add `output_contract_built`, `compile_return_delivered`, or `compile_return_rejected`. Use existing `compile_started`, `final_response`, and `run_closed` events with structured detail. If `mailbox_item_status_changed` is added, append it to the open event constant set and mirror it in any schema generation.

### 10.3 Run Ledger Detail Minimums


`partial_result` detail:

    sourceType
    mailboxId
    mailboxItemId
    taskId
    agentId
    slotId
    resultDigest
    resultClassifications
    evidenceRecordId|null
    routingTrailRecordId|null
    slotValidation: { policy, declared, matched, reason|null }

`compile_started` detail:

    compilerSocketId
    mailboxId
    outputContractId
    contractDigest
    eligibleMailboxItemCount

`compile_mode_selected` detail:

    compilerSocketId
    compileMode
    inheritedCompileDataClass
    frontierSynthesisEligible
    onPremSynthesisEligible
    denialReason|null

`final_response` detail:

    artifactId
    artifactDigest
    compilerSocketId
    compilerActorId|null
    sourceMailboxItems
    returnEndpointId

`run_closed` detail:

    closeReason: 'final_response_delivered' | 'cancelled' | 'error'
    returnEndpointId|null
    artifactId|null

---

## 11. API Reference Harness Routes

All routes are reference harness surfaces. They are not production UI. They exist so the full loop can be tested.

### 11.1 API Dependency Injection

`packages/interfaces/api/src/server.ts` must accept the following by dependency injection:

    ExternalsRuntime from bootstrap-owned type
    RunLedgerWriter from the existing Run Ledger contract/export used by packages/core/src/ledger/run-ledger.ts
    IdentityProviderInterface from packages/contracts/src/interfaces/index.ts
    PipelineInterface from packages/contracts/src/interfaces/index.ts
    NvgService from @nexus/contracts, implemented by packages/vanguard/src/nvg-service.ts
    ExternalSocketRegistry from packages/core/src/externals/external-socket-registry.ts via bootstrap-owned type only
    CompileReturnDispatcher from packages/core/src/compile/compile-return-dispatcher.ts via bootstrap-owned type only

The API must not import `JsonlRunLedgerWriter`, `NvgServiceImpl`, `MailboxServiceImpl`, `OutputCollectorImpl`, `CompileServiceImpl`, or `CompileReturnDispatcher` implementation constructors directly. It may receive already-constructed service instances from `scripts/nexus-bootstrap.ts`.

### 11.2 Routes

| Route | Method | Purpose |
|---|---|---|
| `/workspace/runs` | POST | reference workspace entry |
| `/workspace/runs/:runId` | GET | run status summary from Run Ledger |
| `/orchestrator/dispatch` | POST | reference orchestrator dispatch |
| `/mailbox/runs/:runId/items` | GET | list mailbox item metadata |
| `/compile/runs/:runId` | POST | invoke compile for run |
| `/compile-return/:returnEndpointId` | POST | receive signed final artifact |

Route registration law:

- `packages/interfaces/api/src/routes/index.ts` must export/register all five new route modules.
- `packages/interfaces/api/src/server.ts` must mount the routes through DI-provided services only.
- The server must not import core/vanguard implementation classes directly.

### 11.3 Forbidden Route Behavior

No route may expose:

- direct agent-to-workspace final response
- direct model-to-workspace final response
- direct NXS connector-to-workspace final response
- mailbox payload read without metadata/digest controls
- Evidence Ledger mutation
- Routing Provenance Trail mutation
- arbitrary manifest package execution

---

## 12. CI Gate Additions

The base spec currently has gates through existing NISP additions. This amendment adds externals gates after the current final step. If current `scripts/ci-gate.ts` already has Step 17/18/19 from NISP, append these as the next numbers without renumbering existing steps.

### 12.1 Required Gates

| Gate | Name | Required assertion |
|---:|---|---|
| EXT-01 | workspace manifest signature gate | `config/workspace/workspaces.v1.yaml` loads only if signed and schema-valid. |
| EXT-02 | orchestrator manifest signature gate | `config/orchestrators/orchestrators.v1.yaml` loads only if signed and schema-valid. |
| EXT-03 | mailbox manifest signature gate | `config/mailbox/mailboxes.v1.yaml` loads only if signed and schema-valid. |
| EXT-04 | compiler manifest signature gate | `config/compile/compilers.v1.yaml` loads only if signed and schema-valid. |
| EXT-05 | compile-return manifest signature gate | `config/output/compile-return.v1.yaml` loads only if signed and schema-valid. |
| EXT-06 | required domain collision gate | collisions across required socket domains fail closed. |
| EXT-07 | manifest cross-reference gate | workspace return endpoint, compiler mailbox, compile-return workspace refs resolve. |
| EXT-08 | mailbox required gate | governed runtime cannot start without enabled required mailbox. |
| EXT-09 | output collector gate | NVG/NXS/partial refs produce mailbox items only through OutputCollector. |
| EXT-10 | no direct output path gate | static/dynamic tests prove agent/model/NXS connector cannot return directly to workspace. |
| EXT-11 | runId propagation gate | runId appears from WorkspaceRunRequest through mailbox, output contract, artifact, compile-return, Run Ledger. |
| EXT-12 | OCT-SECURE loop gate | secure loop denies frontier/helper bypasses and returns through compile-return only. |
| EXT-13 | compile eligibility gate | digest/classification/status/redaction checks enforced before compile reads. |
| EXT-14 | output contract integrity gate | contract digest rederived and matched. |
| EXT-15 | compile-return auth gate | signed_callback and artifact digest verified; invalid requests rejected. |
| EXT-16 | plugin public surface gate | plugin-facing sample imports only `@nexus/contracts`. |
| EXT-17 | single composition root gate | runtime composition occurs only in `scripts/nexus-bootstrap.ts`. |
| EXT-18 | externals import-law gate | vanguard/adapters/connectors/identity-ref do not import core mailbox/output/compile internals. |
| EXT-19 | factory resolution gate | every enabled new manifest discriminator resolves in its populated factory registry. |
| EXT-20 | payload resolver gate | OutputCollector rejects unknown resultRef schemes and digest mismatches. |
| EXT-21 | compile-return dispatch gate | CompileReturnDispatcher sends through configured transport and consumes mailbox items only after accepted/durable ack. |
| EXT-22 | frontier compile NVG gate | frontier_synthesis compile path routes through NVG and direct provider calls are rejected. |

### 12.2 Static Import Gate Patterns

Forbidden imports:

    packages/vanguard/src/** -> packages/core/src/mailbox/**
    packages/vanguard/src/** -> packages/core/src/output/**
    packages/vanguard/src/** -> packages/core/src/compile/**
    packages/adapters/** -> packages/core/**
    packages/adapters/** -> packages/vanguard/**
    packages/connectors/** -> packages/core/**
    packages/connectors/** -> packages/vanguard/**
    packages/identity-ref/** -> packages/core/**
    packages/identity-ref/** -> packages/vanguard/**
    packages/interfaces/api/src/** -> packages/core/** except type-only contracts imports are allowed through package alias
    packages/interfaces/api/src/** -> packages/vanguard/** except type-only contracts imports are allowed through package alias

Allowed composition exception:

    scripts/nexus-bootstrap.ts may import implementation classes.

### 12.3 Dynamic Behavioral Gates

`no-direct-output-path` dynamic test:

    send workspace request
    simulate agent partial result
    assert workspace display endpoint rejects direct partial
    write same partial through OutputCollector
    compile run
    assert workspace accepts only signed CompileReturnRequest

`runId-propagation` test:

    run = POST /workspace/runs
    assert runId in WorkspaceRunRequest
    assert runId in OrchestratorPlanPreview
    assert runId in NvgOutputReference or NxsOutputReference
    assert runId in MailboxItem
    assert runId in OutputContract
    assert runId in FinalResponseArtifact
    assert runId in CompileReturnRequest
    assert Run Ledger all events share runId

---

## 13. Build Order

The builder must implement in this order. Do not skip ahead.

### PUSH-EXT-01 — Contracts Only

Files:

    packages/contracts/src/externals/*.ts
    packages/contracts/src/externals/factories.ts
    packages/contracts/src/externals/payload.ts
    packages/contracts/src/interfaces/index.ts
    packages/contracts/src/index.ts
    packages/contracts/src/constants/index.ts

Gates:

    format
    typecheck
    contracts no-zod import
    plugin public surface sample

### PUSH-EXT-02 — Workspace Manifest Loader and Sample Manifest

Files:

    config/workspace/workspaces.v1.yaml
    packages/core/src/manifest/workspace/*
    packages/core/src/manifest/workspace/workspace-factory-registry.ts
    scripts/sign-manifest.ts

Gates:

    all prior
    EXT-01 workspace manifest signature gate

### PUSH-EXT-03 — Orchestrator Manifest Loader and Sample Manifest

Files:

    config/orchestrators/orchestrators.v1.yaml
    packages/core/src/manifest/orchestrators/*
    packages/core/src/manifest/orchestrators/orchestrator-factory-registry.ts

Gates:

    all prior
    EXT-02 orchestrator manifest signature gate

### PUSH-EXT-04 — Mailbox Manifest Loader and Sample Manifest

Files:

    config/mailbox/mailboxes.v1.yaml
    packages/core/src/manifest/mailbox/*
    packages/core/src/manifest/mailbox/mailbox-factory-registry.ts

Gates:

    all prior
    EXT-03 mailbox manifest signature gate
    mailbox required manifest gate

### PUSH-EXT-05 — Compiler Manifest Loader and Sample Manifest

Files:

    config/compile/compilers.v1.yaml
    packages/core/src/manifest/compile/*
    packages/core/src/manifest/compile/compiler-factory-registry.ts

Gates:

    all prior
    EXT-04 compiler manifest signature gate

### PUSH-EXT-06 — Compile-Return Manifest Loader and Sample Manifest

Files:

    config/output/compile-return.v1.yaml
    packages/core/src/manifest/output/*
    packages/core/src/manifest/output/compile-return-factory-registry.ts

Gates:

    all prior
    EXT-05 compile-return manifest signature gate
    EXT-06 required domain collision gate
    EXT-07 manifest cross-reference gate

### PUSH-EXT-07 — Mailbox Backend and Baked Service

Files:

    packages/core/src/mailbox/*
    tests/externals/mailbox-service.test.ts

Gates:

    all prior
    mailbox required gate
    compile eligibility prechecks for mailbox read

### PUSH-EXT-08 — OutputCollector

Files:

    packages/core/src/output/*
    tests/externals/output-collector.test.ts
    tests/externals/payload-resolver.test.ts
    tests/externals/declared-output-slot-reader.test.ts

Gates:

    all prior
    output collector gate
    no direct output path static gate

### PUSH-EXT-09 — Compile Service and Deterministic Renderer

Files:

    packages/core/src/compile/*
    tests/externals/compile-service.test.ts

Gates:

    all prior
    output contract integrity gate
    compile mode/OCT inheritance gate

### PUSH-EXT-10 — Compile-Return Auth

Files:

    packages/core/src/compile/final-response-signer.ts
    packages/core/src/compile/compile-return-dispatcher.ts
    packages/interfaces/api/src/routes/compile-return.ts
    tests/externals/compile-return-auth.test.ts

Gates:

    all prior
    compile-return auth gate

### PUSH-EXT-11 — Bootstrap Expansion

Files:

    scripts/nexus-bootstrap.ts
    scripts/bootstrap-types.ts if needed
    packages/core/src/externals/external-socket-registry.ts
    scripts/nexus-main.ts if required

Gates:

    all prior
    single composition root gate
    externals import-law gate
    clean bootstrap smoke test

### PUSH-EXT-12 — API Reference Harness

Files:

    packages/interfaces/api/src/routes/workspace.ts
    packages/interfaces/api/src/routes/orchestrator.ts
    packages/interfaces/api/src/routes/mailbox.ts
    packages/interfaces/api/src/routes/compile.ts
    packages/interfaces/api/src/routes/index.ts
    packages/interfaces/api/src/server.ts

Gates:

    all prior
    runId propagation gate
    OCT-SECURE loop gate
    full ci:gate

---

## 14. Determinism and Canonicalization

### 14.1 Canonical JSON

All digests must use the existing canonicalize implementation. No `JSON.stringify` digesting unless the existing canonicalizer delegates to stable JSON internally.

Digest functions:

    sha256Utf8(s: string): Sha256Hex
    sha256Bytes(bytes: Uint8Array): Sha256Hex
    digestCanonical(value: unknown): Sha256Hex = sha256Utf8(canonicalize(value))

### 14.2 Stable Ordering

Before digesting arrays in OutputContract and FinalResponseArtifact:

- `mailboxItems` sorted lexicographically by UUID.
- `inputDataClasses` sorted by `DATA_CLASS_ORDER`, duplicates removed.
- `runLedgerRefs`, `evidenceRefs`, `routingTrailRefs` sorted lexicographically.
- `sourceMailboxItems` sorted by item creation order for render, but digest field stores sorted UUID list unless render body explicitly depends on order. If render body depends on order, artifact must include render order.

### 14.3 Time Use

Timestamps use `nowIso()` from existing utilities where present. Tests requiring deterministic replay must inject a clock.

---

## 15. Security and Threat Rules

### 15.1 Runtime Plugin Loading

Runtime bootstrap may load only:

- signed manifests
- approved package/local implementation identifiers
- pinned versions
- known factory exports
- schema-valid configs

YAML must not cause arbitrary import or execution. A manifest entry may name a local implementation identifier that the bootstrap registry already knows. The registry maps identifier to factory; the manifest does not carry executable code.

### 15.2 Compile-Return Threats

Reject the request and write existing `run_closed` with `closeReason: error` plus `final_response`/return rejection detail when applicable. Do not create `compile_return_rejected`. Rejection conditions:

- signature invalid
- digest mismatch
- unknown keyId
- endpoint disabled
- artifact runId mismatch
- artifact signature invalid
- accepted artifact type missing

### 15.3 Mailbox Threats

Reject or block mailbox item when:

- digest mismatch
- missing classification when required
- payload path escapes storage root
- duplicate mailbox item ID
- status transition illegal
- attempt to read expired/cancelled/blocked item for compile

### 15.4 Direct Output Threats

Any direct path below is a build/security violation:

    Agent -> Workspace final response
    Model -> Workspace final response
    NXS connector -> Workspace final response
    Compiler -> Evidence Ledger mutation
    Workspace -> direct compile payload bypassing mailbox
    Mailbox -> LLM call
    Return endpoint -> LLM call
    NVG internal -> core mailbox implementation import
    NXS gate -> workspace implementation import

---

## 16. Completion Criteria

This amendment is build-complete only when all are true:

1. New externals contracts exist and are exported from `@nexus/contracts`.
2. All five new signed manifests exist and load through the shared signed-manifest loader.
3. Bootstrap expands from 12 to 21 blueprint-pinned steps without creating a second composition root.
4. Required-domain collision and cross-reference validation fail closed.
5. `ManifestDomain` expansion is implemented at `packages/runtime-utils/src/qualified-identifier.ts` without breaking existing NISP domains.
6. Baked `MailboxService` writes, reads, blocks, expires, cancels, and consumes by law while `MailboxBackend` remains the single public replaceable storage contract.
7. OutputCollector is the only legal mailbox write path from engine/orchestrator outputs.
8. OutputCollector verifies `resultRef` through approved payload resolvers and rejects unknown schemes/digest mismatch.
9. Declared output slot validation reads orchestrator-declared slots from Run Ledger and enforces `outputSlotPolicy`.
10. OutputContract digest is deterministic and revalidated by gate.
11. CompileService reads only eligible mailbox items and fails closed on empty output contracts.
12. Reference deterministic renderer produces signed `FinalResponseArtifact` without model/action calls.
13. Frontier compile/synthesis, if enabled, routes through injected `NvgService`; direct provider calls are rejected.
14. CompileReturnDispatcher builds signed callback requests, dispatches through configured transport, and only permits mailbox consumption after accepted/durable acknowledgement.
15. Compile-return signed_callback verification rejects invalid signature/digest/key/endpoint/runId.
16. Workspace reference route accepts final response only through compile-return.
17. Run Ledger shows complete lifecycle for a reference run.
18. OCT-SECURE loop test proves no frontier/helper/direct-output bypass.
19. Import-law gate proves package boundaries.
20. Single composition root gate proves no runtime composition outside `scripts/nexus-bootstrap.ts`.
21. No duplicate `ReturnEndpointResolver` service or `return-endpoint-resolver.ts` path exists; `ExternalSocketRegistry.resolveReturnEndpointForRun(runId)` is the single resolver.
22. Full `pnpm ci:gate` passes from clean clone.

---

## 17. Non-Goals

This amendment does not build:

- production workspace UI
- production orchestrator
- production compiler intelligence
- marketplace package installer
- automatic local-service discovery
- enterprise IAM integration beyond existing provider interface
- new model transport beyond existing NISP transport layer
- dashboard
- PostgreSQL mailbox backend
- S3/object-store mailbox backend
- streaming compile-return
- multi-tenant workspace permissions UI

---

## 18. Builder Notes

- Do not rename RIA/NIA surfaces in code during this build.
- Do not replace existing `RunEventType` lifecycle with a new externals event family.
- Do not move NVG routing policy into plugin manifest law; it remains signed infrastructure policy.
- Do not add LangChain/LlamaIndex or equivalent orchestration dependencies.
- Do not treat LiteLLM/OpenRouter as core dependencies; they are possible model endpoint adapters only.
- Do not weaken no-zod-in-contracts law if current tests enforce it.
- Do not make `ModelTier`, `DataClass`, `OctLevel`, or other governed values closed enums.
- Do not put mailbox writes inside NVG/NXS gate implementations.
- Do not mark mailbox items consumed until FinalResponseArtifact creation succeeds.
- Do not store raw prompt in long-term Run Ledger detail by default.

---

## 19. First Implementation Checklist

The first builder turn should execute:

    cd /home/deploy/repos/nexus
    git status --short
    pnpm typecheck
    pnpm test -- --runInBand if needed by repo conventions
    inspect packages/contracts/src/index.ts
    inspect packages/contracts/src/interfaces/index.ts
    create packages/contracts/src/externals/
    add contracts only
    run pnpm typecheck
    run prettier on touched files
    run first contract tests
    git diff -- packages/contracts

Do not touch bootstrap before contracts compile.

---

## 20. Final Spec Statement

This amendment closes the external infrastructure loop around the existing Nexus Stack. The lawful runtime path is now explicit and buildable:

    workspace entry
      -> orchestrator dispatch
      -> governed agent work through NVG/NXS
      -> output reference
      -> OutputCollector
      -> return mailbox
      -> OutputContract
      -> OCT-COMPILE compiler
      -> FinalResponseArtifact
      -> signed compile-return
      -> workspace display
      -> Run Ledger close

Any implementation that returns final user-visible output outside this path is non-conformant.
