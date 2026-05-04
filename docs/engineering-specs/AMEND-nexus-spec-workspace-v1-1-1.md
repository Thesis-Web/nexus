# Nexus Stack — Engineering Spec Amendment: Governed Workspace

# Version: v1.1.1
# Filename: AMEND-nexus-spec-workspace-v1-1-1.md
# Status: OWNER-RATIFIED — governs reference workspace-ref build
# Owner: James Huson / Lake Area LLC
# Date: 2026-05-03
# Ratified: 2026-05-03 (owner-approved after 8 drafts, 7 audit rounds)
# Governing blueprint: AMEND-blueprint-nexus-governed-workspace-v1-1-1.md
# Governing spec: nexus-engineering-spec-v1-8-26.md
#
# Audit history:
#   draft-v1: 18 findings. 14 accepted, 4 rejected.
#   draft-v2: 10 findings. 8 accepted, 2 rejected.
#   draft-v3: 6 findings + 4 notes. 3 real defects, 2 one-liners, 1 format.
#   draft-v4: all findings closed. Owner approvals applied:
#     OD-WS-001: Spec references blueprint for exact type definitions via
#                pinned §-reference. Spec does NOT repeat them.
#     OD-WS-002: Add runId to ApprovalRequest (parent spec amendment).
#     OD-WS-003: Frontend scope — reference UI is a minimal Vite+React
#                consumer of routes/events. UI components are not spec-governed.
#   draft-v5: 6 findings from audit round 4. All accepted.
#     GWS4-AUD-01: Law stack reordered.
#     GWS4-AUD-02: FinalResponseArtifact display required.
#     GWS4-AUD-03: Gate 17 added.
#     GWS4-AUD-04: Gate 1 expanded for Vite build.
#     GWS4-AUD-05: Import law clarified.
#     GWS4-AUD-06: Version aligned.
#   draft-v6: 3 findings + 2 notes from audit round 5. All blockers accepted.
#     GWS5-AUD-01: Login route exempt from workspace JWT middleware.
#     GWS5-AUD-02: Minimal Vite+React entry files and React deps added.
#     GWS5-AUD-03: Approval route authorization — RunAcl OR approval assignment.
#     GWS5-N01: "certified" → "owner-approved" wording.
#     GWS5-N02: workspaceJwtSecret fail-closed.
#     GWS5-N03: REJECTED — OD-WS-001 permits pinned references.
#   draft-v7: 1 finding from audit round 6. Wording fix accepted, blocker
#     severity rejected — existing decideApproval already implements model.
#     GWS6-AUD-01: "assigned approver" → "registered approver" — aligns spec
#       language to built decideApproval architecture (any registered approver
#       with valid key can decide any pending approval for matching run).
#   draft-v8: 1 finding from audit round 7. Accepted — internal contradiction.
#     GWS7-AUD-01: RunAcl OR approver key was contradictory — RunAcl alone
#       never authorizes approval. Registered approver key is always required.

---

## 0. Precedence and Scope

### 0.1 Law Stack [GWS4-AUD-01 fix]

1. `nexus-complete-end-to-end-flow-v4.8.md` (LOCKED — scope/intent conformance)
2. `nexus-owner-ratification-v1-4-12.md` (LOCKED — owner-approved scope decisions) [GWS5-N01]
3. `nexus-blueprint-v1-5-13.md` (architecture law — wins all implementation conflicts)
4. `AMEND-blueprint-nexus-governed-workspace-v1-1-1.md`
5. `AMEND-blueprint-nexus-infra-externals-v1-0-0.md`
6. `nexus-engineering-spec-v1-8-26.md`
7. `AMEND-spec-nexus-infra-externals-v0-2-5.md`
8. `AMEND-nexus-spec-orch-v1-1-1.md`
9. `AMEND-spec-nexus-compile-1-0-0.md`
10. This spec
11. Repo implementation

Outline and ratification define what we intend to build and whether we are
conforming to that intent. Blueprint defines how we build it. Blueprint wins
all implementation conflicts. No amendment spec may contradict its governing
blueprint or the locked scope documents above it.

### 0.2 Scope

Server-side contracts, routes, stores, and logic for the governed workspace
reference implementation per [blueprint §1–§9].

### 0.3 Frontend Scope [OD-WS-003, GWS4-AUD-02 fix]

Reference UI implementation details are not spec-governed. The minimal
Vite+React UI must consume the route/event contracts and must display the
terminal `FinalResponseArtifact` as an opaque governed artifact, plus run
status and file artifact links. Styling and component internals are not
governed. The compile-return route [spec §6.8, AMEND-spec-nexus-compile §8]
owns the return path law — this spec consumes but does not redefine it.

### 0.4 Pinned Reference Convention [OD-WS-001]

Type definitions that are already exact in the ratified blueprint are referenced
by pin (e.g. `[blueprint §3.8.1]`) and NOT repeated. This spec adds: file paths,
function signatures, Zod schemas, pseudo-code, wiring, deny paths, CI gates.

### 0.5 Plug-and-Play Law

`workspace-ref` is replaceable Layer 7. API imports ONLY contract-level port
interfaces from `@nexus/contracts` — never concrete workspace-ref implementations.

---

## 1. Repository Placement

### 1.1 Package [GWS5-AUD-02 fix]

```
packages/workspace-ref/
  package.json
  tsconfig.json
  vite.config.ts
  index.html                                ← Vite HTML entry
  src/
    auth/
      elevated-auth-provider.ts
      elevated-session-store.ts
      workspace-session-store.ts
    stores/
      workspace-file-store.ts
      workspace-blob-store.ts
      workspace-run-acl-store.ts
      workspace-event-ticket-store.ts
      prompt-template-store.ts
      secure-rail-store.ts
      catalog-reader.ts
    bridge/
      workspace-approval-bridge.ts
    client/
      main.tsx                              ← React mount point
    index.ts
```

`index.html` is the Vite entry point with a `<div id="root">` mount target
and a `<script type="module" src="/src/client/main.tsx">` reference.
`src/client/main.tsx` mounts the React app and consumes route/event contracts.
Component files under `src/client/` are not spec-governed per OD-WS-003.

### 1.2 Dependencies [GWS5-AUD-02 fix]

```json
{
  "name": "@nexus/workspace-ref",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "vite build"
  },
  "dependencies": {
    "@nexus/contracts": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "ws": "^8.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/ws": "^8.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0"
  }
}
```

### 1.3 Import Law [GWS4-AUD-05 fix]

Monorepo imports: `@nexus/contracts` only. No imports from `@nexus/core`,
`@nexus/vanguard`, adapters, connectors, identity-ref, or interfaces internals.

External imports allowed only from declared package dependencies (`react`,
`react-dom`, `ws`, `vite`) and Node built-ins required for streaming, hashing,
and file reference implementation (e.g. `node:crypto`, `node:stream`, `node:fs`).

The `workspace-imports` gate (§10, gate 2) enforces monorepo import law.
External dependency allow-list is validated by the declared `package.json`
dependencies — undeclared external imports fail typecheck.

### 1.4 Contract File

`packages/contracts/src/externals/workspace-governed.ts` — all ports and
workspace-specific types not already defined in the blueprint.

### 1.5 Amended Files

| File | Change |
|---|---|
| `contracts/src/interfaces/index.ts` | Add workspace RunEventType values (§8) |
| `contracts/src/externals/index.ts` | Re-export workspace-governed.ts |
| `interfaces/api/src/server.ts` | Auth split, new DI deps (§7.1) |
| `interfaces/api/src/routes/index.ts` | Register new workspace routes |
| `interfaces/api/src/routes/workspace.ts` | JWT auth, principal binding, new endpoints |
| `identity-ref/src/identity-provider.ts` | JWT wiring (HOLE-D2-003) |

---

## 2. Contract Types — Blueprint-Pinned

### 2.1 Types Defined by Pinned Reference

These types are exact in the ratified blueprint. Spec pins to them:

| Type | Blueprint Pin | Notes |
|---|---|---|
| `WorkspacePromptInput` (union) | [blueprint §3.8.1] | 3-branch discriminated union |
| `FreeTextPromptInput` | [blueprint §3.8.1] | Tab 1 |
| `SectionedPromptInput` | [blueprint §3.8.1] | Tab 2 |
| `SecureRailsPromptInput` | [blueprint §3.8.1] | Tab 3 |
| `WorkspaceRunEnvelope` | [blueprint §3.8.2] | Server trusted envelope |
| `WorkspaceApprovalBridge` | [blueprint §3.5.3] | Bridge interface |
| `WorkspaceFileReference` | [blueprint §3.7.1] | AMENDED — see §2.3 |
| `ModelPreference` | [blueprint §3.4.2] | Agent/model preference |
| `ElevatedAuthProvider` | [blueprint §3.9] | AMENDED — see §2.4 |
| `ElevatedSession` | [blueprint §3.9] | Session record |
| `ElevatedSessionStatus` | [blueprint §3.9] | Validation result |
| `ElevatedAuthChallengeRequest` | [blueprint §3.9] | Challenge input |
| `ElevatedAuthChallenge` | [blueprint §3.9] | Challenge response |
| `ElevatedAuthVerifyRequest` | [blueprint §3.9] | Verify input |
| `WorkspaceUiEvent` | [blueprint §3.6] | Derived projection |
| `PromptTemplate` | [blueprint §4.1] | Prompt template |
| `SecureRail` | [blueprint §4.5] | AMENDED — see §2.5 |
| `RunAcl` | [blueprint §5.3–5.4] | Run ACL |
| `WorkspaceEventTicket` | [blueprint §5.4] | Stream auth |

### 2.2 Types Defined in This Spec

```typescript
// OutputFormat alias
import type { CompileFormat } from './compile-template.js';
export type OutputFormat = CompileFormat;
export const OUTPUT_FORMAT_VALUES = ['prose','table','raw','mixed','file_bundle'] as const;

// Workspace session [GWS2-AUD-02]
export interface WorkspaceSession {
  workspaceAuthSessionId: Uuid;
  principalId: string;
  actorId: Uuid;
  issuedAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

// Catalog item [GWS-F11]
export interface CatalogItem {
  id: string; name: string; description: string;
  visible: boolean; selectable: boolean; reason?: string;
}

// Template/rail section/field/signature types
// TemplateSectionConfig, ConstrainedFieldDef, TemplateSignature, RailSignature
// — defined in blueprint §4.1/§4.5 by structure. Exact TypeScript in spec:

export interface TemplateSectionConfig {
  sectionId: string; label: string; description: string;
  inputType: 'free_text' | 'select' | 'multi_select' | 'readonly';
  required: boolean; options?: string[]; defaultValue?: string;
}

export interface ConstrainedFieldDef {
  fieldId: string; label: string;
  inputType: 'text' | 'select' | 'readonly';
  required: boolean; options?: string[];
  maxLength?: number; pattern?: string;
}

export interface TemplateSignature {
  signedBy: string; publicKey: string; signature: string; signedAt: IsoTimestamp;
}

export interface RailSignature {
  signedBy: string; publicKey: string; signature: string; signedAt: IsoTimestamp;
}
```

### 2.3 WorkspaceFileReference — AMENDED [GWS3-AUD-06]

Adds `status` and quarantine fields to [blueprint §3.7.1]:

```typescript
export interface WorkspaceFileReference {
  // ... all fields from [blueprint §3.7.1] plus:
  status: 'staged' | 'bound' | 'quarantined';        // [GWS3-AUD-06]
  quarantineReason?: string;                           // [GWS3-AUD-06]
}
```

### 2.4 ElevatedAuthProvider — AMENDED [GWS2-AUD-06]

`validateSession` requires `principalId`:

```typescript
validateSession(elevatedSessionId: Uuid, principalId: string): Promise<ElevatedSessionStatus>;
```

### 2.5 SecureRail — AMENDED [GWS-F15]

Adds attachment constraints to [blueprint §4.5]:

```typescript
// ... all fields from [blueprint §4.5] plus:
allowAttachments: boolean;
allowedAttachmentMediaTypes?: string[];
maxAttachmentCount?: number;
maxAttachmentSizeBytes?: number;
```

---

## 3. Store Port Interfaces

All in `workspace-governed.ts`. API imports ONLY these — never concrete impls.

```typescript
export interface WorkspaceFileStorePort {
  store(file: WorkspaceFileReference): Promise<void> | void;
  get(fileId: Uuid): Promise<WorkspaceFileReference | null> | WorkspaceFileReference | null;
  getByPrincipal(principalId: string): Promise<WorkspaceFileReference[]> | WorkspaceFileReference[];
  bindToRun(fileId: Uuid, runId: Uuid, labels: string[]): Promise<void> | void;
  markQuarantined(fileId: Uuid, reason: string, labels: string[]): Promise<void> | void;
}

export interface WorkspaceBlobStorePort {
  write(input: { fileId: Uuid; stream: NodeJS.ReadableStream;
    declaredMediaType: string; maxSizeBytes: number;
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
  consume(ticketId: Uuid, runId: Uuid): Promise<WorkspaceEventTicket | null> | WorkspaceEventTicket | null;
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
```

Blob store law: streaming only, sha256 while streaming, max-size mid-stream
enforcement, quarantined blobs return null from `read()`, contents never logged.

---

## 4. Zod Validation

Route-layer only (NOT in contracts). Schemas per [blueprint §3.8.1] structure.
`z.discriminatedUnion('promptMode', [...]).strict()` per branch.
`outputFormat` bound to `OUTPUT_FORMAT_VALUES` constant.
`VaultAuthSchema`: `z.discriminatedUnion('action', [challenge, verify])`.

---

## 5. Auth and Session Lifecycle

### 5.1 Auth Split [T16-F02, blueprint §3.1.3, GWS5-AUD-01 fix]

Remove global `app.use(adminAuth)`. Replace with path-scoped middleware:

- `/workspace/auth/login` → **NO workspace JWT required** (this route issues the JWT) [GWS5-AUD-01]
- `/workspace/*` (all other) → `workspaceJwtAuth`
- `/admin/*` → `adminBearerAuth`
- Legacy routes (`/actors`, `/principals`, etc.) → `adminBearerAuth`
- `/compile-return/*` → callback signature (existing)
- `/ws/*`, `/sse/*` → event ticket (§6)

Registration order: login route MUST be registered before the blanket
`/workspace/*` JWT middleware to prevent the middleware from intercepting it.
Gate `workspace-auth-session` (§10, gate 5) verifies login succeeds without
a prior workspace JWT and that all other `/workspace/*` routes reject
requests without a valid JWT (401).

### 5.2 Workspace Session JWT [blueprint §3.1.1, GWS2-AUD-02]

**POST /workspace/auth/login**
1. Authenticate via `identityProvider.authenticate(credentials)`
2. Resolve identity → five claims [blueprint §7.2]
3. Mint `workspaceAuthSessionId = randomUUID()`
4. Create `WorkspaceSession { sid, principalId, actorId, issuedAt, expiresAt }`
5. Store in `WorkspaceSessionStorePort`
6. Issue workspace JWT: `{ sub: actorId, sid: workspaceAuthSessionId, exp }`
7. Return `{ token, workspaceAuthSessionId, expiresAt }`

### 5.3 JWT Middleware [GWS3-AUD-04]

```typescript
// 1. Verify workspace JWT signature
// 2. Extract sid from payload
// 3. session = sessionStore.get(sid)                    [GWS3-AUD-04]
// 4. Verify: session exists, not expired
// 5. Verify: session.actorId === payload.sub            [GWS3-AUD-04]
// 6. Re-resolve claims: identityProvider.resolveIdentity(payload.sub)
// 7. Verify: claims.principalIdentity === session.principalId  [GWS3-AUD-04]
// 8. Attach to request: principalId, actorId, claims, workspaceAuthSessionId
```

### 5.4 API-Key Fallback [GWS3-AUD-05]

API-key auth is reference-harness-only. Production browser workspace MUST use
the JWT login path. API-key callers MUST NOT be used as the primary human
workspace auth path. API-key path mints per-request ephemeral session.

### 5.5 Principal Binding [T8-F02]

`principalId` from server-resolved claims — never caller-supplied.

### 5.6 JWT Wiring — HOLE-D2-003 [blueprint §3.1.4]

`ReferenceIdentityAdapter` constructor accepts optional `jwtProvider`.
Routes by `credentials.type`. Bootstrap wires if JWT secret configured.

### 5.7 JWT Secret Fail-Closed [GWS5-N02]

If `workspaceJwtSecret` is not configured, `/workspace/auth/login` and the
JWT middleware fail closed: login returns 501 and middleware rejects all
requests. Boot-time warning is logged. This prevents silent auth bypass.

### 5.8 Session Vocabulary [blueprint §3.1.2]

| Name | Scope | Created |
|---|---|---|
| `workspaceAuthSessionId` | JWT sid, workspace routes | POST /workspace/auth/login |
| `elevatedSessionId` | Vault re-auth, Tab 3 | ElevatedAuthProvider.verify() |
| `nxsSessionId` | Gate 01 | NXS pipeline (NOT workspace) |

---

## 6. Run Lifecycle

### 6.1 POST /workspace/runs [blueprint §3.5.1, §10.3]

1. JWT middleware → principalId, actorId, claims, workspaceAuthSessionId
2. Validate body: `WorkspacePromptInputSchema`
3. `runId = randomUUID()`, `enteredAt = nowIso()`
4. `promptDigest = sha256(canonicalize({ runId, prompt, enteredAt, workspaceSocketId }))`
5. Write `run_opened` to Run Ledger (no raw prompt)
6. Store `RunAcl { runId, principalId, actorId, permittedViewers: [principalId] }`
7. If `attachmentIds`: classify → bind or quarantine (§6.4)
   - On failure: write `run_closed { closeReason }`, return 400
8. Build `WorkspaceRunRequest`, dispatch to orchestrator (server-driven)
9. Return `{ runId, planPreview? }`

### 6.2 Dispatch Gate [T8-F03]

`/orchestrator/dispatch` is server-driven. Called ONLY after `run_opened`.

### 6.3 GET /workspace/runs/:runId

JWT + RunAcl check → run status from Run Ledger.

### 6.4 File Binding [GWS2-AUD-05, GWS3-AUD-06]

Order: classify FIRST → if fail: `markQuarantined()` + `blobStore.quarantine()` +
ledger `workspace_file_quarantined` + `run_closed(error)`. If pass: `bindToRun(fileId, runId, labels)` + ledger `workspace_file_bound`. Quarantined files
cannot be rebound.

### 6.5 POST /workspace/files [GWS2-AUD-04]

1. JWT → principalId
2. `fileId = randomUUID()` (BEFORE blob write)
3. Stream to `blobStore.write({ fileId, stream, ... })`
4. Store `WorkspaceFileReference { status: 'staged', ... }`
5. Log `workspace_file_staged` with infra runId
6. Return `{ fileId, sha256 }`

---

## 7. API Routes

### 7.1 ApiDependencies Additions [GWS5-N02]

```typescript
elevatedAuthProvider?: ElevatedAuthProvider;
workspaceFileStore?: WorkspaceFileStorePort;
workspaceBlobStore?: WorkspaceBlobStorePort;
workspaceRunAclStore?: WorkspaceRunAclStorePort;
workspaceEventTicketStore?: WorkspaceEventTicketStorePort;
workspaceSessionStore?: WorkspaceSessionStorePort;
workspaceApprovalBridge?: WorkspaceApprovalBridge;
promptTemplateStore?: PromptTemplateStorePort;
secureRailStore?: SecureRailStorePort;
catalogReader?: WorkspaceCatalogReaderPort;
adminSignerRegistry?: AdminSignerRegistry;
workspaceJwtSecret?: string;   // if missing → workspace auth fails closed (501)
```

### 7.2 Route Table [GWS5-AUD-01/03 fix]

| Route | Method | Auth |
|---|---|---|
| `/workspace/auth/login` | POST | Credentials in body (NO JWT) [GWS5-AUD-01] |
| `/workspace/runs` | POST | JWT |
| `/workspace/runs/:runId` | GET | JWT + RunAcl |
| `/workspace/files` | POST | JWT |
| `/workspace/templates` | GET | JWT |
| `/workspace/catalogs/agents` | GET | JWT |
| `/workspace/catalogs/models` | GET | JWT |
| `/workspace/catalogs/connectors` | GET | JWT |
| `/workspace/catalogs/rails` | GET | JWT + X-Elevated-Session |
| `/workspace/vault/auth` | POST | JWT |
| `/workspace/vault/session` | GET | JWT + X-Elevated-Session |
| `/workspace/runs/:runId/event-ticket` | POST | JWT + RunAcl |
| `/workspace/runs/:runId/approval` | POST | JWT + approval authorization (§7.8) [GWS5-AUD-03] |
| `/admin/prompt-templates` | POST/PUT/DELETE | Admin bearer |
| `/admin/secure-rails` | POST/PUT/DELETE | Admin bearer |
| `/ws/runs/:runId` | WS | Event ticket |
| `/sse/runs/:runId` | GET | Event ticket |

### 7.3 Elevated Session Transport [GWS2-AUD-06]

Via `X-Elevated-Session` header. NOT query string. Principal-bound validation.

### 7.4 Signature Law [GWS2-AUD-08]

`signaturePayload = canonicalize(template/rail sans signatures)`.
Verified against `AdminSignerRegistry` — NOT approver keys.
Immutable versions. Disabled-not-deleted. Collision → 409.

### 7.5 Approval Bridge [GWS5-AUD-03 fix]

Approval authorization (§7.8) → bridge verifies approval belongs to run via
`PendingApprovalStore.getRequest()` → deserialize `ApprovalRequest` → extract
`runId` [OD-WS-002] → verify matches route `:runId`. Bridge resolves
`principalId` → `approverId` via server-side identity resolution. Routes to
`decideApproval`. Never signs. Never writes Evidence.

### 7.6 Error Status Table

| Condition | Status |
|---|---|
| No/invalid auth | 401 |
| Identity resolution failed | 403 |
| Not authorized for run | 403 |
| Not an approver | 403 |
| Elevated session required | 403 |
| Approval/run not found | 404 |
| Approval resolved/expired | 409 |
| Template/rail collision | 409 |
| Schema validation failed | 400 |
| Attachment bind failed | 400 |
| File too large | 413 |
| Not configured / JWT secret missing | 501 |
| Approval wrong run | 403 |

### 7.7 Event Ticket [blueprint §5.4]

60s TTL, single-use, minted after RunAcl check. Ticket IDs redacted from logs.
SSE prefers `Authorization: Bearer` header; WS uses `?ticket=` (protocol limit).

### 7.8 Approval Authorization [GWS5-AUD-03, GWS6-AUD-01, GWS7-AUD-01 fix]

The approval route requires a registered approver key. RunAcl alone never
authorizes an approval decision.

1. JWT middleware → principalId, actorId
2. Load pending `ApprovalRequest` by `approvalId` from `PendingApprovalStore`
3. Verify `request.runId === route :runId`; mismatch → 403
4. Verify principal maps to a registered `approverId` with valid approver key
   via server-side identity resolution (`ApproverRegistry`); if not → 403
5. Route to bridge → bridge routes to `decideApproval`

RunAcl may provide supplementary run-context access (e.g. viewing run status
before deciding) but RunAcl alone never satisfies approval authorization.
Any registered approver may decide any pending approval for the matching run.
Per-approval assignment is an `ApprovalChannel` notification concern, not an
authorization gate — channels decide who gets notified, `decideApproval`
verifies the approver key exists.

Approvers do not gain general run-view or event-stream access. RunAcl remains
the gatekeeper for run status, events, and event tickets. The bridge performs
approver identity verification internally via `loadApproverKey` and must reject
before reaching `decideApproval` if the principal does not map to a registered
approver.

---

## 8. Run Ledger Amendments

### 8.1 New RunEventType Values [blueprint §6.2]

```typescript
| 'workspace_vault_session_opened'
| 'workspace_vault_session_closed'
| 'workspace_secure_rail_selected'
| 'workspace_secure_rail_submitted'
| 'workspace_file_staged'
| 'workspace_file_bound'
| 'workspace_file_quarantined'
```

### 8.2 Detail Minimums [blueprint §6.2.1]

Per [blueprint §6.2.1] table — CI gate `workspace-run-event-details` enforces.

### 8.3 Stream Law

Vault/session/file events → Run Ledger ONLY. Never Evidence/RPT.

---

## 9. Parent Spec Amendments

### 9.1 §6.1 — Add `packages/workspace-ref/` to repo layout
### 9.2 §6.3 — Add workspace-ref dependency law (contracts only)
### 9.3 §6.4 — Add 17 CI gates (§10)

### 9.4 §12.3.11 — ApprovalRequest Amendment [OD-WS-002]

Add `runId: Uuid` to `ApprovalRequest`. Populated at Gate 05 from
`AgentAction.runId`. Stored in `PendingApprovalStore.create()`.
Bridge extracts via `getRequest()` → deserialize → `request.runId`.

```typescript
export interface ApprovalRequest {
  // ... existing fields ...
  runId: Uuid;                          // [OD-WS-002] — from AgentAction.runId
}
```

### 9.5 §29.1 — Add WorkspaceRunEnvelope
### 9.6 §30.1 — Add 7 workspace RunEventType values

---

## 10. CI Gates (17 total) [GWS4-AUD-03/04, GWS5-AUD-01/03 fix]

| # | Gate | Verifies |
|---|---|---|
| 1 | workspace-build | `pnpm --filter @nexus/workspace-ref typecheck` passes; `pnpm --filter @nexus/workspace-ref build` succeeds; `packages/workspace-ref/dist/` exists, is non-empty, and contains at least `index.html` and one `.js` asset [GWS4-AUD-04, GWS5-AUD-02] |
| 2 | workspace-imports | Monorepo imports: `@nexus/contracts` only. No `@nexus/core`, `@nexus/vanguard`, adapters, connectors, identity-ref, or interfaces internals. External imports validated against declared package.json dependencies [GWS4-AUD-05] |
| 3 | workspace-static-order | Static after API, SPA fallback last |
| 4 | workspace-auth-split | JWT for /workspace (except login), admin for /admin [GWS5-AUD-01] |
| 5 | workspace-auth-session | Login succeeds without prior JWT and returns valid JWT; login JWT is accepted by subsequent /workspace/* routes; all other /workspace/* routes without JWT return 401; mutated sub denied; revoked session denied [GWS5-AUD-01] |
| 6 | workspace-principal-bind | Body principalId ignored; server-resolved used |
| 7 | workspace-run-acl | Cross-run access denied |
| 8 | workspace-event-ticket | Expired/consumed/missing ticket denied |
| 9 | workspace-template-sig | Unsigned/invalid/unknown-signer rejected; collision 409 |
| 10 | workspace-rail-sig | Same as template-sig for rails |
| 11 | workspace-no-raw-prompt | Prompt absent from Run Ledger detail |
| 12 | workspace-dispatch-lifecycle | Dispatch requires prior run_opened |
| 13 | workspace-file-runid | Staged uses infra runId; bound uses user runId |
| 14 | workspace-run-event-details | All 7 event types carry required detail fields |
| 15 | workspace-run-failure-closure | Bind failure after run_opened → run_closed written |
| 16 | workspace-elevated-principal-bind | Wrong principal denied; header transport only |
| 17 | workspace-approval-run-bind | (a) Create run A + approval A → `ApprovalRequest.runId === runA`; (b) submit approval A on `/workspace/runs/runB/approval` → 403; (c) submit on `/workspace/runs/runA/approval` as run owner who is also a registered approver → reaches `decideApproval`; (d) submit as registered non-owner approver → reaches `decideApproval`; (e) submit as unregistered non-owner → 403; (f) submit as run owner who is NOT a registered approver → 403; (g) no event subscription required [GWS4-AUD-03, GWS5-AUD-03, GWS6-AUD-01] |

---

## 11. Build Phases and Push Order

### 11.1 Phases

Phase 1: scaffold, auth split, JWT wiring, login, run creation, ACL, static order, dispatch.
Phase 2: event tickets, WS/SSE, file staging/binding/quarantine.
Phase 3: templates, rails, catalogs, admin signer registry, approval bridge.
Phase 4: elevated auth, vault routes, rail attachment constraints.

### 11.2 Pushes (8)

```
W01: scaffold + contracts + ports                     → gates 1-2
W02: auth split + JWT login + static order             → gates 3-6
W03: run creation + ACL + dispatch                     → gates 7, 12
W04: event tickets + WS/SSE                            → gate 8
W05: file staging/binding/quarantine + no-raw-prompt   → gates 11, 13, 15
W06: templates + rails + admin signers + approval bridge → gates 9-10, 17
W07: elevated auth + vault + catalogs                  → gates 14, 16
W08: full gate pass (all 17)                           → FULL WORKSPACE GATE
```

---

## 12. Hard Rules (32)

1–18: [blueprint §9 rules 1–18]
19. Raw prompt never in Run Ledger detail
20. Raw prompt never persisted without signed retention policy
21. File bodies streaming only — never fully buffered
22. Event ticket IDs redacted from access logs
23. NXS session is pipeline responsibility — not workspace
24. API imports contract ports only — never concrete stores
25. Template/rail versions immutable — disabled, never deleted
26. Run failure after run_opened MUST write run_closed
27. workspaceAuthSessionId is session-scoped via JWT sid — not per-request
28. promptDigest includes workspaceSocketId
29. Classify before bind — atomic bind+classify
30. Elevated session validation is principal-bound
31. Elevated session via X-Elevated-Session header — not query string
32. Admin signers ≠ approver keys

---

## 13. Open Items

None. All resolved. 3 owner decisions applied (OD-WS-001 through OD-WS-003).
OD-WS-003 refined by GWS4-AUD-02 — FinalResponseArtifact display required.

### 13.1 Cumulative Pushback Record

| Finding | Verdict |
|---|---|
| GWS-F01, F04, F07 | REJECTED with evidence |
| GWS-F08 | Partially accepted |
| GWS2-AUD-01 | Partially rejected (OD-WS-003) |
| GWS2-AUD-10 | Rejected (D2 post-ratification) |
| GWS4-AUD-01 | Accepted — law stack reordered, builder corrected audit's blueprint position |
| GWS5-N03 | REJECTED — OD-WS-001 permits pinned blueprint §9 reference |
| GWS6-AUD-01 | ACCEPTED substance (wording fix), REJECTED blocker severity — built decideApproval already implements registered-approver model |
| GWS7-AUD-01 | ACCEPTED — internal contradiction in §7.8 OR logic. RunAcl alone never authorizes approval |

---

## Changelog

| Version | Date | Change |
|---|---|---|
| draft-v1 | 2026-05-03 | Initial. 18 findings. |
| draft-v2 | 2026-05-03 | Store ports, blob store, session mint, lifecycle fix, sig law, error table. |
| draft-v3 | 2026-05-03 | Session JWT, promptDigest fix, classify-before-bind, principal-bound elevated, admin signer split. |
| draft-v4 | 2026-05-03 | Full standalone via blueprint-pinned references (OD-WS-001). runId added to ApprovalRequest (OD-WS-002). Frontend scope resolved (OD-WS-003). 16 CI gates, 8 pushes, 32 hard rules. |
| draft-v5 | 2026-05-03 | GWS4-AUD-01 through GWS4-AUD-06 fixes. Law stack reordered. FinalResponseArtifact required. Gate 17 added. Vite build gated. Import law clarified. 17 CI gates. |
| draft-v6 | 2026-05-03 | GWS5-AUD-01: Login exempt from JWT middleware. GWS5-AUD-02: React entry files and deps. GWS5-AUD-03: Approval-specific authorization (§7.8). GWS5-N01/N02 applied. 17 CI gates, 8 pushes, 32 hard rules. |
| draft-v7 | 2026-05-03 | GWS6-AUD-01: "assigned approver" → "registered approver." Gate 17 expanded to 7 cases. |
| draft-v8 | 2026-05-03 | GWS7-AUD-01: Removed contradictory OR in §7.8. RunAcl alone never authorizes approval. Registered approver key always required. |
| v1.1.1 | 2026-05-03 | OWNER-RATIFIED. 8 drafts, 7 audit rounds, 18 total findings resolved. Establishes governed workspace reference implementation: workspace JWT auth split, login exception, run ACL/event-ticket law, registered-approver approval authorization, pre-run file staging/binding/quarantine, FinalResponseArtifact display, Vite+React build surface, elevated session assurance, workspace RunEventType amendments, 17 CI gates, 8 pushes, 32 hard rules. |
