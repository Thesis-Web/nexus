# Nexus Stack — Governed Workspace Blueprint Amendment
# Version: v1.1.1
# Status: OWNER-RATIFIED — governs reference workspace implementation
# Owner: James Huson / Lake Area LLC
# Date: 2026-05-03
# Ratified: 2026-05-03 (owner-approved after 4 audit passes, 41 findings resolved)
# Governing blueprint: nexus-blueprint-v1-5-13.md
# Governing spec: nexus-engineering-spec-v1-8-26.md
# Governing ratification: nexus-owner-ratification-v1-4-12.md
# Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (LOCKED)
# Orch blueprint amendment: docs/blueprints/AMEND-nexus-blueprint-orch-v1-1-1.md
# Orch spec amendment: docs/engineering-specs/AMEND-nexus-spec-orch-v1-1-1.md
# Compile blueprint amendment: docs/blueprints/AMEND-blueprint-nexus-compile-1-1-1.md
# Compile spec amendment: docs/engineering-specs/AMEND-spec-nexus-compile-1-0-0.md
#
# Audit history:
#   draft-v1: 20 findings (GWB-F01–F20). All closed.
#   draft-v2: 12 findings (GWB2-F01–F12). All closed.
#   draft-v4: 9 findings (GWB4-F01–F09). All addressed in this draft.

---

## 1. Scope and Purpose

### 1.1 Covers
Reference workspace implementation per blueprint §10, spec §29. Identity-gated
entry, three prompt modes, policy-filtered catalogs, real-time run events, file
attachment ingress, workspace approval bridge.

### 1.2 Does Not Cover
Enterprise IAM, admin dashboard UI, full agent registry, lab test bed, production RBAC.

### 1.3 Plug-and-Play Law
Reference workspace is replaceable. API routes (§5) are integration surface.
Same pattern as identity-ref, orch-ref, compile-ref.

---

## 2. Package Structure

### 2.1 Location
`packages/workspace-ref/` — Layer 7. Imports `@nexus/contracts` only.

### 2.2 Build and Serving
Vite → `dist/`. Express route registration order:
1. API routes  2. WS upgrade  3. SSE  4. Admin  5. Static assets  6. SPA fallback

### 2.3 Required Spec Amendments
- §6.1: add `packages/workspace-ref`
- §6.3: Layer 7 browser package, contracts-only imports
- §6.4: workspace CI gates into ordered ci:gate (§7)
- §30.1: workspace RunEventType values (§6.2)

---

## 3. Workspace Surface

### 3.1 Entry Point

#### 3.1.1 Authentication and Claim Resolution
JWT authenticates actor/session ref. Server resolves claims:
1. `identityProvider.authenticate(credentials)` → actor identifier
2. `identityProvider.resolveIdentity(actorId)` → five claims [blueprint §7.2]
3. Session JWT issued with `workspaceAuthSessionId`
4. Server re-resolves claims on every API call (trust boundary)

#### 3.1.2 Session Vocabulary
| Concept | Name | Scope |
|---|---|---|
| Browser auth | `workspaceAuthSessionId` | JWT, workspace routes |
| Secure Rails elevated | `elevatedSessionId` | Vault re-auth, Tab 3 |
| NXS authority | `nxsSessionId` | Gate 01, action governance |

Hard law: workspace sessions are NOT NXS sessions. Only `nxsSessionId` binds
actor, principal, and DelegationContext.

#### 3.1.3 Auth Middleware Split [T16-F02]
- `/workspace/*`: JWT via IdentityProviderInterface
- `/admin/*`: bearer token (scoped — NOT global)
- `/compile-return/*`: callback signature
- `/ws/*`, `/sse/*`: event ticket (§5.4)

#### 3.1.4 JWT Wiring — HOLE-D2-003
jwt.ts wired into identity-provider.ts. Accepts Bearer JWT or X-API-Key.

#### 3.1.5 Principal Binding [T8-F02]
PrincipalId from server-side resolution — never caller-supplied.

### 3.2 Prompt Tab System

#### 3.2.1 Tab 1 — Free Text
Prompt textarea + send. Top bar: model/agent selectors (single or multi mode).

#### 3.2.2 Tab 2 — Sectioned (Template-Driven)
Template selector (policy-filtered). Six sections:
S1: Work to be done (always, free text). S2: Agents. S3: Models (preference §3.4.2).
S4: Output format. S5: Connectors. S6: Execution mode.
"Save as template" = same form in save mode.

#### 3.2.3 Tab 3 — Secure Rails
Pre-registered operations under elevated session assurance.

**Hard law: elevated re-auth does NOT change OCT. OCT is registry-assigned.**

Elevated auth via `ElevatedAuthProvider` (§3.9). `elevatedSessionId` with
configurable timeout. Cannot be silently extended.

Vault audit target configurable (signed admin config):
- Mode A: infra Run Ledger event before rail execution
- Mode B: logged under rail's run ID

Vault events → Run Ledger ONLY. Evidence/RPT through normal NXS/NVG only.

Rail execution requires: agent registered OCT matches rail `requiredAgentOctLevels`,
user ceiling permits rail permissions, `elevatedSessionId` active.

### 3.3 Shell
Desktop: top bar + sidebar + center. Tablet: collapsible sidebar. Phone: drawer.

### 3.4 Run Configuration

#### 3.4.1 Agent Cards
Name, status, compatible models, preference state.

#### 3.4.2 Model Preference
```typescript
interface ModelPreference {
  agentId: Uuid;
  modelTier: ModelTier;                // [GWB4-F07 fix]
  mode: 'available' | 'preferred';
}
```
NVG remains sole routing authority. Preferences are planner constraints.

#### 3.4.3 Display vs Selectability
- **Visible**: agent config + identity ceiling permit
- **Selectable**: visible + OCT + NVG policy permit
- **Struck-through**: visible but not selectable (reason shown)
- **Hidden**: agent config or identity ceiling block

### 3.5 Response Surface

#### 3.5.1 Run Progress
Status, per-agent progress, step markers. Run ID at workspace entry [blueprint §10.3].

#### 3.5.2 Partial Results — Non-Terminal Previews
Labeled "preview / non-terminal." Normalized through OutputCollector.
Authorization-checked (run ACL). Classification-badged. Redacted.
Raw model output never displayed. FinalResponseArtifact is the only terminal output.

#### 3.5.3 Approval Display — WorkspaceApprovalBridge

[GWB4-F02 fix — bridge routes through ApprovalDecisionService]

```typescript
// @nexus/contracts
interface WorkspaceApprovalBridge {
  submitDecision(input: {
    approvalId: Uuid;
    runId: Uuid;                       // [GWB4-F02: added]
    principalId: string;
    decision: 'approved' | 'denied';
    note?: string;
    workspaceAuthSessionId: Uuid;
  }): Promise<ApprovalResponse>;       // signed by decision service
}
```

Bridge law:
- Bridge verifies run ACL (principal authorized for this run)
- Bridge verifies approver identity/role via server-side resolution
- Bridge calls `ApprovalDecisionService.decideApproval(...)` — NOT ApprovalChannel
- ApprovalDecisionService is the single signing/resolution path
- ApprovalChannel remains responsible for dispatch/await flow
- Bridge never signs ApprovalResponse directly
- Gate 05 awaits the signed ApprovalResponse from the decision service
- Timeout = DENY [blueprint §16.6]

#### 3.5.4 File Artifacts
Download links in response area and sidebar file sandbox.

#### 3.5.5 Compiled Final Response
FinalResponseArtifact from compile-return. Terminal governed result.

### 3.6 Real-Time Event Channel
Primary: WebSocket. Fallback: SSE. Degraded: GET polling.
`WorkspaceUiEvent` is derived projection — not Run Ledger.

| Canonical RunEventType | UI Event | UI Action |
|---|---|---|
| run_opened | run_status | Show run indicator |
| orchestrator_dispatched | run_status | Show agent cards |
| partial_result | agent_preview | Show preview card |
| compile_started | run_status | Show "compiling" |
| final_response | compile_complete | Show final response |
| run_closed | run_status | Show complete |

Approval events from ApprovalChannel state, not Run Ledger.

**Phase guard: WebSocket/SSE may not ship before workspace-run-acl and
workspace-event-ticket gates pass.** [GWB4-F09]

### 3.7 File Attachment Ingress

#### 3.7.1 Pre-Run Staging + Bind Lifecycle

[GWB4-F03 fix]

1. `POST /workspace/files` — upload, returns `workspaceFileId` (no user runId)
2. Server logs `workspace_file_staged` with **infra run ID** (not user run)
3. `POST /workspace/runs` — submit prompt with `attachmentIds[]`
4. Server binds staged files to new user runId
5. Server logs `workspace_file_bound` with **user runId**
6. If classification fails at bind time: `workspace_file_quarantined`

```typescript
interface WorkspaceFileReference {
  fileId: Uuid;
  sha256: Sha256Hex;
  declaredFilename: string;
  mediaType: string;
  sizeBytes: number;
  classificationLabels: string[];
  provenance: 'user_upload';
  storedAt: string;
  runId: Uuid | null;                 // null until bound
  uploadedByPrincipalId: string;
  uploadedAt: IsoTimestamp;
}
```

#### 3.7.2 Classification Authority
Labels server-resolved. Client labels advisory only. Unknown → quarantine/deny
per signed admin config. Quarantine produces `workspace_file_quarantined`.

#### 3.7.3 Ingress Constraints
Max size configurable (default 50MB). Server-computed sha256. MIME + deny list.
Files entering model calls route through NVG classification.

### 3.8 API Contract Types

[GWB4-F04 fix — discriminated union]

All in `@nexus/contracts`.

#### 3.8.1 Browser → Server Input (Discriminated Union)

```typescript
type WorkspacePromptInput =
  | FreeTextPromptInput
  | SectionedPromptInput
  | SecureRailsPromptInput;

interface FreeTextPromptInput {
  promptMode: 'free_text';
  prompt: string;
  agents?: Uuid[];
  modelPreferences?: ModelPreference[];
  attachmentIds?: Uuid[];
}

interface SectionedPromptInput {
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

interface SecureRailsPromptInput {
  promptMode: 'secure_rails';
  railId: string;
  railVersion: string;
  elevatedSessionId: Uuid;
  constrainedInputs?: Record<string, string>;
  attachmentIds?: Uuid[];
}
```

Fields outside selected promptMode are schema-invalid.

#### 3.8.2 Server-Created Run Envelope (Trusted)

```typescript
interface WorkspaceRunEnvelope {
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
```

Extends spec §29.1 WorkspaceEntry.

### 3.9 Elevated Auth Provider Interface

[GWB4-F05 fix — open string type]

```typescript
// @nexus/contracts
export const ELEVATED_AUTH_METHOD = {
  PASSWORD_REAUTH: 'password_reauth',
  API_KEY_REAUTH: 'api_key_reauth',
} as const;

export type ElevatedAuthMethod = string;   // open — enterprise adds methods

interface ElevatedAuthProvider {
  challenge(input: ElevatedAuthChallengeRequest): Promise<ElevatedAuthChallenge>;
  verify(input: ElevatedAuthVerifyRequest): Promise<ElevatedSession>;
  validateSession(elevatedSessionId: Uuid): Promise<ElevatedSessionStatus>;
}

interface ElevatedAuthChallengeRequest {
  principalId: string;
  method: ElevatedAuthMethod;
}

interface ElevatedSession {
  elevatedSessionId: Uuid;
  principalId: string;
  method: ElevatedAuthMethod;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  timeoutSeconds: number;
}

interface ElevatedSessionStatus {
  valid: boolean;
  remainingSeconds: number;
  reason?: string;
}
```

Reference impl supports `password_reauth` and `api_key_reauth` only.
Enterprise methods are provider-specific strings.

---

## 4. Catalogs

### 4.1 Prompt Template Registry
```typescript
interface PromptTemplate {
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
```

Eligibility: principal ceiling ∩ permitted agent catalog ∩ agent OCT ∩ policy.
Admin: signed artifacts + infra audit. Immutable versions, disabled-not-deleted.

### 4.2–4.4 Agent, Model, Connector Catalogs
Read-only views filtered by identity ceiling + OCT.

### 4.5 Secure Rail Registry
```typescript
interface SecureRail {
  railId: string;
  name: string;
  description: string;
  version: string;
  agentId: Uuid;
  modelTier: ModelTier;                // [GWB4-F07]
  connectors: string[];
  constrainedFields?: ConstrainedFieldDef[];
  requiredPermissions: string[];
  requiredAgentOctLevels: OctLevel[];
  requiredModelTierCeiling: ModelTier[];  // [GWB4-F07]
  requiredDataClasses?: string[];
  requiredApprovalChain?: string[];
  disabled: boolean;
  signatures: RailSignature[];
}
```

---

## 5. API Surface

### 5.1 Retained Routes (Auth Amended)
| Route | Method | Auth |
|---|---|---|
| /workspace/runs | POST | Workspace JWT |
| /workspace/runs/:runId | GET | JWT + run ACL |
| /compile-return/:id | POST | Callback sig |

Server-driven (NOT browser-triggered):
| Route | Method | Auth | Lifecycle Gate |
|---|---|---|---|
| /orchestrator/dispatch | POST | Internal + run ACL | state = run_opened |
| /orchestrator/cancel | POST | JWT + run ACL + state | state = in_progress |
| /compile/runs/:runId | POST | Internal + run ACL | state = ready_to_compile |

### 5.2 New Routes
| Route | Method | Auth |
|---|---|---|
| /workspace/files | POST | JWT |
| /workspace/templates | GET | JWT |
| /workspace/catalogs/agents | GET | JWT |
| /workspace/catalogs/models | GET | JWT |
| /workspace/catalogs/connectors | GET | JWT |
| /workspace/catalogs/rails | GET | JWT + elevatedSessionId |
| /workspace/vault/auth | POST | JWT + elevated creds |
| /workspace/vault/session | GET | JWT + elevatedSessionId |
| /workspace/runs/:runId/event-ticket | POST | JWT + run ACL |
| /workspace/runs/:runId/approval | POST | JWT + run ACL |
| /admin/prompt-templates | POST/PUT/DELETE | Admin bearer |
| /admin/secure-rails | POST/PUT/DELETE | Admin bearer |
| /ws/runs/:runId | WS | Event ticket |
| /sse/runs/:runId | GET | Event ticket |

### 5.3–5.4 Middleware + Run ACL
JWT for workspace, admin bearer scoped to `/admin/*`, event tickets for streams.
Run ACL stores `{ runId, principalId, actorId, permittedViewers }` at run_opened.
Event ticket: short-lived (60s), single-use, minted after ACL check.

---

## 6. Audit Requirements

### 6.1 Stream Law
Vault/session/file events → Run Ledger ONLY. Evidence/RPT through NXS/NVG only.

### 6.2 RunEventType Amendment (spec §30.1)

[GWB4-F03/F06 fix — staged/bound split + detail minimums]

```typescript
| 'workspace_vault_session_opened'
| 'workspace_vault_session_closed'
| 'workspace_secure_rail_selected'
| 'workspace_secure_rail_submitted'
| 'workspace_file_staged'
| 'workspace_file_bound'
| 'workspace_file_quarantined'
```

#### 6.2.1 Required Detail Minimums

[GWB4-F06 fix]

| Event | Required Detail |
|---|---|
| workspace_vault_session_opened | principalId, elevatedSessionId, authMethod, expiresAt, auditTargetMode |
| workspace_vault_session_closed | principalId, elevatedSessionId, reason, closedAt |
| workspace_secure_rail_selected | railId, railVersion, principalId, elevatedSessionId |
| workspace_secure_rail_submitted | railId, railVersion, runId, agentId, modelTier, elevatedSessionId |
| workspace_file_staged | fileId, sha256, sizeBytes, mediaType, uploadedByPrincipalId (infra runId) |
| workspace_file_bound | fileId, runId, sha256, classificationLabels |
| workspace_file_quarantined | fileId, sha256, reason, classificationState, auditTargetRunId |

---

## 7. CI Gates

[GWB4-F08 fix — file-runid gate added]

Integrated into ordered ci:gate (exact step numbers at merge):

| Gate | Verifies |
|---|---|
| workspace-build | TypeScript build |
| workspace-imports | Contracts-only imports |
| workspace-auth-split | JWT for workspace, admin for admin |
| workspace-principal-bind | PrincipalId from server resolution |
| workspace-run-acl | Run status/events require ownership |
| workspace-event-ticket | WS/SSE require valid ticket |
| workspace-template-sig | Templates require admin signature |
| workspace-rail-sig | Rails require admin signature |
| workspace-no-raw-prompt | Raw prompt not in Run Ledger |
| workspace-static-order | Static serving doesn't shadow API |
| workspace-dispatch-lifecycle | /orchestrator/dispatch requires run_opened |
| workspace-file-runid | Staged files use infra runId; bound files use user runId |

---

## 8. Build Phases

Phase 1: JWT wiring, auth split, principal binding, React scaffold, Tab 1,
response area, WebSocket + run ACL + event tickets (inseparable), pre-run file
staging, static serving, sidebar. Server-driven dispatch.

Phase 2: Tab 2, template registry (signed), catalogs, multi-agent config,
model preference, "Save as template," template browser, approval bridge → decision service.

Phase 3: Tab 3, ElevatedAuthProvider + reference impl, elevated sessions,
rail registry (signed), pre-built rails, constrained prompt.

Phase 4: Slash commands, template library, file classification pipeline,
responsive, greyed-out catalog, phase polish.

---

## 9. Hard Rules

1. Workspace = only authorized entry point [blueprint §10.1]
2. No functionality before auth
3. Run ID at workspace entry [blueprint §10.3]
4. Server = trust boundary
5. JWT authenticates actor ref — server resolves claims
6. Elevated re-auth ≠ OCT change
7. NVG = sole model routing authority
8. Timeout = DENY [blueprint §16.6]
9. PrincipalId from server resolution
10. Workspace auth ≠ admin auth
11. Approval bridge → ApprovalDecisionService (not channel, not direct signing)
12. Partial results = non-terminal previews
13. Vault events → Run Ledger ONLY
14. File attachments: server-resolved classification, digest, provenance
15. /orchestrator/dispatch and /compile = server-driven
16. `workspaceAuthSessionId` ≠ `elevatedSessionId` ≠ `nxsSessionId`
17. WebSocket/SSE inseparable from run ACL + event tickets [GWB4-F09]
18. Staged files use infra runId; bound files use user runId [GWB4-F03]

---

## Changelog

| Version | Date | Change |
|---|---|---|
| draft-v1 | 2026-05-03 | Initial draft. 20 findings. |
| draft-v2 | 2026-05-03 | v1 findings addressed. 12 findings. |
| draft-v3 | 2026-05-03 | v2 findings addressed. |
| draft-v4 | 2026-05-03 | Submitted as draft-v3 with v4 intent. 9 findings. |
| draft-v5 | 2026-05-03 | v4 findings addressed. Version control corrected. Approval bridge → ApprovalDecisionService. File staging split (staged/bound). Discriminated WorkspacePromptInput union. Open ElevatedAuthMethod. Event detail minimums. ModelTier alias. File-runid CI gate. Phase guard for WS/SSE. |

| v1.1.1 | 2026-05-03 | OWNER-RATIFIED. Establishes reference workspace-ref as replaceable Layer 7 UI, workspace JWT auth split, run ACL/event-ticket law, Secure Rails elevated session assurance, WorkspaceApprovalBridge through ApprovalDecisionService, pre-run file staging/binding, workspace RunEventType amendments, and workspace CI gates. |
