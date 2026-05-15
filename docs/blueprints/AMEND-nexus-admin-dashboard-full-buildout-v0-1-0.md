# AMEND-nexus-admin-dashboard-full-buildout — v0.1.0

**Status:** DRAFT (pending owner ratification).
**Authored:** 2026-05-15.
**Authors:** James Huson (owner) + Claude (drafter).
**Supersedes:** any prior spec language that scopes admin UI writers as "out of scope", "deferred", "placeholder", or "CLI-only" except where overridden by an architecture constraint that this spec preserves verbatim (mode/policy signed-envelope path, OR-DASH-009 secret-presence-only).

**Scope statement.** When this spec is implemented, an admin who has run `pnpm build && docker compose up && pnpm tsx scripts/nexus-main.ts serve` can configure every operational surface of Nexus from the admin dashboard, end-to-end, without dropping to a terminal. Modes, identity providers, channels, connectors, endpoints, agents, orchestrators, workspaces, mailbox/compile/return triples, signing keys, and operational secrets are all manageable from the elevated admin session. The only exception is initial bootstrap of the very first admin signing keypair (which `nexus init` creates before the server can authenticate anyone).

---

## §1. Acceptance criteria

A. **`/admin` route** loads with elevated session, lists 12 surfaces (overview + 11), every surface marked `partial` today becomes `complete` once the operator has provided required entries.

B. **No surface displays "Read-only" banner copy** unless the displayed value is genuinely immutable by architecture (signing key fingerprints, evidence digests, ledger entries). The `AdminDisabledMutationBanner` component remains in the tree but is used only by the three by-design read-only contexts called out in §6 (ledger viewer, evidence chain, routing trail).

C. **No surface shows `AdminAddNewButton`** with a placeholder click handler. The component is deleted from the tree once §3 lands; every add affordance goes through a working writer.

D. **No `PLACEHOLDER_BANNER_REASON` references remain** in shipped panels. The `placeholder-data.ts` module survives only as a fallback for the no-data-yet state (catalog hasn't loaded), never as the visible state of a complete surface.

E. **Production quality**:
- No `console.log` in panel code or writer routes (use the run ledger / structured server logger).
- No `TODO` / `FIXME` left in shipped code; deferred items live in a separate `runs/<arc>/admin-buildout-todo.md`.
- Every writer has Zod schema validation, atomic YAML write, integration test, unit test.
- Every panel has a happy-path test covering the writer roundtrip.
- ci:gate stays 80/80 throughout; vitest stays green; integration suite stays green.

F. **End-to-end workspace setup test**: a fresh checkout with no `config/` overrides can, by clicking only within `/admin`, reach a state where a workspace prompt successfully executes through a configured agent, model endpoint, connector, mailbox, compiler, and return endpoint — and ledger entries appear in the ledger viewer. This test goes into `packages/workspace-ref/src/integration/admin-end-to-end-buildout.test.ts`.

---

## §2. Architecture inventory (current state — verified against HEAD 098b20a + tree state 2026-05-15)

### §2.1 Writer-enabled today (no work)

| Surface | Backend | UI | Storage |
|---|---|---|---|
| Model Endpoints / NVG | `/workspace/admin/setup/endpoints` (POST/PUT/DELETE) | `model-endpoint-setup-panel.tsx` (full CRUD + Ollama discover + API-key store) | `config/nvg/endpoints.v1.yaml` + `keys/secrets.json` |
| Actors & Agents | `/workspace/admin/setup/actors` (POST/PUT/DELETE) | `actor-agent-setup-panel.tsx` (full CRUD) | SQLite `ActorRegistry` (hot, no restart) |
| Connectors | `/workspace/admin/setup/connectors` (POST/PUT/DELETE) | `connector-setup-panel.tsx` (full CRUD + wildcard reject) | `config/connectors/connectors.v1.yaml` |
| Secrets (key=value) | `/workspace/admin/setup/secrets` (GET status / POST / DELETE) | embedded in endpoint panel | `keys/secrets.json` |

### §2.2 Read-only today — addressed by this spec

| Surface | Today | This spec |
|---|---|---|
| Identity Providers | placeholder add button, no writer | §3.1 manifest CRUD |
| Approval Channels | placeholder add button + CLI instructions | §3.2 manifest CRUD (CLI / webhook / Slack / dashboard) |
| Orchestrators | placeholder add button, no writer | §3.3 manifest CRUD |
| Workspaces | placeholder add button, no writer (entryMode stays locked) | §3.4 manifest CRUD with entryMode pinned to `governed_only` |
| Mailbox / Compile / Return (3 sub-surfaces) | sub-nav with three read-only tables | §3.5 three independent manifest writers |
| Modes, Policy & OCT | radios disabled, CLI command instructions | §3.6 server-side signed envelope (browser never holds key) |
| Toolchain & Keys | secret presence-only display, no add/rotate | §3.7 register/rotate/delete signing-key files (presence-only display preserved) |

### §2.3 Read-only by design — NO writers, NOT a gap

| Surface | Reason |
|---|---|
| Ledgers & Trails (run, evidence, routing) | Append-only governance ledgers; tampering would invalidate the chain. Viewer with chain-verify is the correct shape. Already fully wired. |
| Evidence-record values themselves | Secret-shaped fields auto-redacted per the existing `secretFields` projection. Not editable by definition. |
| Signed envelope digests / signature bytes | Cryptographic artifact; UI shows fingerprint truncated, never the private material. |

---

## §3. Per-surface specs

Every §3.x sub-section follows the same shape:
1. **Data model** — payload Zod schema (server validates) + UI form fields.
2. **Routes** — REST verbs added to `admin-writer.ts`.
3. **Storage** — manifest path, atomic-write strategy, restart semantics.
4. **Panel changes** — file path, what gets deleted (placeholder/banner), what gets added (table → detail → edit form).
5. **Tests** — unit + integration filenames.

### §3.1 Identity Providers

**Data model** — `IdentityProviderSchema` (Zod):
```ts
{
  providerId: NonEmptyString,
  providerType: enum('local', 'oidc', 'saml', 'api-token'),
  configuration: discriminated union by providerType:
    - local:   { sessionTtlMinutes: int >= 5 }
    - oidc:    { issuerUrl: url, clientId: NonEmpty, clientSecretRef: SecretRef, redirectUri: url, scopes: string[] }
    - saml:    { entityId: NonEmpty, ssoUrl: url, certPemRef: SecretRef }
    - api-token: { allowedTokenRefs: SecretRef[], rotationDays: int }
  enabled: boolean,
}
```
`SecretRef` is `file:KEY_NAME` (resolves via the existing secrets API) or `env:KEY_NAME`.

**Routes** — added to `admin-writer.ts`:
- `POST   /workspace/admin/setup/identity-providers` → 201 `{ providerId, requiresRestart: true }`
- `PUT    /workspace/admin/setup/identity-providers/:providerId` → 200
- `DELETE /workspace/admin/setup/identity-providers/:providerId` → 200 (refuses if `providerId` is the last enabled provider — return 409 with `error: 'cannot remove last enabled identity provider'`)

**Storage** — `config/identity/providers.v1.yaml`, atomic write via temp-file + rename, manifest schema version preserved, `requiresRestart: true` (provider chain composes at bootstrap).

**Panel changes** — `identity-provider-setup-panel.tsx`:
- Delete `AdminAddNewButton` + `PLACEHOLDER_BANNER_REASON` usage.
- Add table column for `enabled`.
- Inline edit form with provider-type-aware fields (discriminated union).
- Secret-ref fields render as `AdminSecretField` (presence pill, no value display).
- Provider-type selector → form auto-fills typical defaults (matching the endpoint panel's `applyProviderProfile` pattern).

**Tests** —
- Unit: `admin-writer-identity-providers.test.ts` covering schema validation per discriminator, last-enabled-guard, atomic write.
- Integration: `admin-identity-provider-roundtrip.test.ts` covering POST→GET→PUT→DELETE.
- Panel test: `identity-provider-setup-panel.test.tsx` covering the discriminated-union form.

### §3.2 Approval Channels

**Data model** — `ApprovalChannelSchema`:
```ts
{
  channelId: NonEmptyString,
  channelType: enum('cli', 'webhook', 'slack', 'dashboard'),
  configuration: discriminated union:
    - cli:       { promptText: NonEmpty }                   // human-prompt shown by CLI approver
    - webhook:   { url: url, signingSecretRef: SecretRef, timeoutMs: 1000-30000 }
    - slack:     { workspaceUrl: url, channel: NonEmpty, botTokenRef: SecretRef }
    - dashboard: { sessionGate: 'elevated' | 'standard', defaultTtlSeconds: 60-1800 }
  enabled: boolean,
}
```

**Routes** — under `/workspace/admin/setup/approval-channels` (POST / PUT / DELETE). Same last-enabled guard (at least one enabled approval channel must exist if NXS mode is `enforcing`).

**Storage** — `config/channels/channels.v1.yaml`. `requiresRestart: true` for all channel-type writers.

**Panel changes** — `channel-setup-panel.tsx`:
- Delete the `cli` hardcoded instruction block from the form — it becomes one of four type-aware blocks the form renders based on `channelType`.
- Add type selector, type-aware config fields, enable toggle, delete button.
- Dashboard channel rows render a note: "Dashboard approvals route through this elevated session. Approval UX lives at `/approvals` in a follow-on spec; the channel record itself is fully manageable here."

**Note on the dashboard channel implementation surface** — this spec adds the *channel record*; the in-browser approval UX (rendering pending approvals to the elevated admin) is a separate spec. Adding the dashboard channel row here is forward-compatible: when the approval UX ships, the channel is already present and approvers receive notifications.

**Tests** — `admin-writer-approval-channels.test.ts`, `admin-channel-roundtrip.test.ts`, `channel-setup-panel.test.tsx` (already exists — extend with writer cases).

### §3.3 Orchestrators

**Data model** — `OrchestratorSchema`:
```ts
{
  orchestratorSocketId: NonEmptyString,
  orchestratorType: enum('ref-deterministic'),  // single type today; lexicon planner adds to plannerType, not orchestratorType
  enabled: boolean,
  plannerMode: enum('deterministic'),           // §6.3 of lexicon spec: no LLM-as-orch in V1
  plannerType: enum('nvg-deterministic', 'db-lexicon-transformer'),  // lexicon V1 adds the second option
  plannerVersion: SemVerString,
  maxToolTurnsPerNode: int 0-10,                // AMEND-spec-nexus-orch §4.2; 0 = no LLM tool turns
}
```

**Routes** — `/workspace/admin/setup/orchestrators` (POST / PUT / DELETE). At least one enabled orchestrator must exist (server returns 409 on delete-the-last).

**Storage** — `config/orchestrators/orchestrators.v1.yaml`, atomic write, `requiresRestart: true` (orchestrator socket composes at bootstrap).

**Panel changes** — `orchestrator-setup-panel.tsx`:
- Delete `AdminAddNewButton` placeholder.
- Add inline edit form with planner-type selector (catalog-driven once lexicon V1 lands — until then, `nvg-deterministic` is the only option in the dropdown).
- Surface `maxToolTurnsPerNode` as a numeric input bounded to 0..10, with default 0 (V1 = no LLM tool-use round-trips).

**Tests** — same pattern as identity providers.

### §3.4 Workspaces

**Data model** — `WorkspaceSchema`:
```ts
{
  workspaceSocketId: NonEmptyString,
  workspaceType: enum('http', 'cli', 'mcp'),
  enabled: boolean,
  entryMode: enum('governed_only'),    // LOCKED — owner ratified 2026-05-15
  baseUrl: UrlString | null,           // null for cli/mcp types
  returnEndpointId: NonEmptyString,    // FK to return endpoint
  capabilities: {
    prompts: boolean,
    runDisplay: boolean,
    approvalUi: boolean,               // when channel-type='dashboard' is enabled
    adminAccess: boolean,
  },
}
```

**Routes** — `/workspace/admin/setup/workspaces` (POST / PUT / DELETE). `entryMode` is hardcoded to `governed_only` server-side (writer rejects any other value with `error: 'entryMode is fixed to governed_only in this version'`).

**Storage** — `config/workspace/workspaces.v1.yaml`, atomic write, `requiresRestart: true`.

**Panel changes** — `workspace-setup-panel.tsx`:
- entryMode field is read-only in the form (gray text + tooltip "Locked to governed_only — see AMEND-nexus-admin-dashboard-full-buildout §3.4").
- returnEndpointId is a dropdown driven by the catalog's return-endpoint list (cross-surface validation: dropdown only shows enabled return endpoints).
- All other fields editable; capabilities rendered as a checkbox group.

**Tests** — standard pattern + an explicit `entryMode-stays-locked.test.ts` that POSTs `{ entryMode: 'direct' }` and asserts 400 with the locked-value error.

### §3.5 Mailbox / Compile / Return (three independent writers)

This panel has three sub-tables. Each gets an independent writer.

**§3.5.a Mailboxes** — `MailboxSchema`:
```ts
{
  mailboxId: NonEmptyString,
  mailboxType: enum('jsonl-file', 'sqlite', 'memory'),  // 'memory' for test/dev only
  enabled: boolean,
  required: boolean,                  // whether bootstrap must allocate this mailbox
  configuration: discriminated union by mailboxType:
    - jsonl-file: { directory: PathString }
    - sqlite:     { dbPath: PathString, tableName: NonEmpty }
    - memory:     {} // empty
}
```
- Routes: `/workspace/admin/setup/mailboxes` (POST / PUT / DELETE).
- Storage: `config/mailbox/mailboxes.v1.yaml`.
- `requiresRestart: true`.
- **Important invariant** — bootstrap RefRunCoordinator step 3.6 allocates per-actor mailboxes from this manifest. Writer enforces that the manifest contains *at least one enabled mailbox of mailboxType ∈ {jsonl-file, sqlite}* (memory-only would silently break per-actor allocation in production).

**§3.5.b Compilers** — `CompilerSchema`:
```ts
{
  compilerSocketId: NonEmptyString,
  compilerType: enum('deterministic'),     // V1: lexicon-aligned default-compile
  enabled: boolean,
  octMode: enum('observe', 'advisory', 'enforcing'),  // mirrors NXS mode names by §3.6
}
```
- Routes: `/workspace/admin/setup/compilers`.
- Storage: `config/compile/compilers.v1.yaml`.

**§3.5.c Return endpoints** — `ReturnEndpointSchema`:
```ts
{
  returnEndpointId: NonEmptyString,
  endpointType: enum('http', 'cli', 'mcp'),
  enabled: boolean,
  targetWorkspaceSocketId: NonEmptyString,   // FK to workspace
}
```
- Routes: `/workspace/admin/setup/return-endpoints`.
- Storage: `config/output/return-endpoints.v1.yaml` (existing path).
- Cross-surface validation: `targetWorkspaceSocketId` must reference an enabled workspace.

**Panel changes** — `compile-mailbox-setup-panel.tsx`:
- The three-sub-nav structure is kept; each sub-table gets its own add-form + inline-edit + delete + enable/disable, mirroring the connector panel pattern.
- Cross-surface validation surfaces as inline errors (e.g. trying to delete a workspace that is the target of a return-endpoint shows "in use by return endpoint X").

**Tests** — three writer-route unit test files, one integration test that exercises a full mailbox→compiler→return-endpoint chain, panel test extended to cover the three add-forms.

### §3.6 Modes, Policy & OCT — server-side signed envelopes

**Architectural rule preserved**: mode mutations require an Ed25519-signed admin envelope. The browser NEVER holds the signing key (see `feedback_signing_keys_server_side` memory). The dashboard composes an *unsigned intent*; the server signs on behalf of the elevated session.

**Key storage** — admin signing keypairs live at `keys/admins/<principalId>.keypair.json` (file-perm 0600, gitignored). `nexus init` creates the first one when the operator runs initial bootstrap. Rotation/re-import happens via §3.7.

**Routes** — added to `admin-writer.ts`:
- `POST /workspace/admin/setup/mode` body `{ engine: 'nxs' | 'nvg', mode: 'observe' | 'advisory' | 'enforcing' }` →
  - Server loads `keys/admins/<elevatedPrincipalId>.keypair.json`.
  - Server constructs the mode envelope, signs it, calls `changeMode(engine, mode, adminId, keypair, currentConfig, runLedger)` (the existing domain function used by the CLI).
  - Server writes `keys/mode-config.json`, emits the `mode_changed` event to the run ledger, returns `{ ok: true, currentConfig: { nxsMode, nvgMode, enforcingLocked, updatedAt, updatedBy }, eventDigest }`.
  - On enforcing→observe/advisory while `enforcingLocked === true`: 409 with `error: 'enforcing-lock active; POST /workspace/admin/setup/mode/unlock first'`.
- `POST /workspace/admin/setup/mode/unlock` body `{ confirm: true }` → server signs an unlock envelope, applies, returns the new state. The UI surfaces this as a separate "Unlock enforcing" affordance with a confirm-required modal.

The existing `POST /mode` route stays 501 (third-party clients can't bypass the elevated-session + server-key path). All mutations go through the new `/workspace/admin/setup/mode` route.

**Panel changes** — `mode-policy-setup-panel.tsx`:
- Delete `AdminDisabledMutationBanner` and the CLI-command `<pre>` block.
- Both `<fieldset>` elements become enabled when `canWrite` AND the admin's signing keypair is present server-side (the GET status response gains a `signingKeypairPresent: boolean` field — added to the existing admin-setup-status response in §4).
- If the keypair is missing, show the existing CLI instruction block as a fallback ("Run `nexus init` to provision your admin keypair, or upload one via Toolchain & Keys → Admin signing key.").
- Radio changes immediately POST to `/workspace/admin/setup/mode`. Show busy spinner; success toast; refresh state.
- Enforcing-lock badge shows `🔒 locked` with an "Unlock enforcing" button beneath when applicable. Clicking the button opens a modal "This will allow downgrading NXS/NVG out of enforcing mode. Confirm?" → on confirm, POST to `/workspace/admin/setup/mode/unlock`.
- NXS policy summary block is unchanged (already wired against admin-setup-status).

**Tests** —
- `admin-writer-mode.test.ts` — unit covering the signing path, missing-keypair → 412 Precondition Failed, enforcing-lock guard, unlock flow.
- `admin-mode-roundtrip.test.ts` — integration: provision keypair → flip NXS observe → advisory → enforcing → unlock → observe.
- `mode-policy-setup-panel.test.tsx` — UI test (existing file is extended).
- `mode-keypair-missing.test.tsx` — fallback CLI-instructions visible when keypair absent.

### §3.7 Toolchain & Keys

**Constraint preserved** — OR-DASH-009: secret presence only, never values. This spec adds *registration / rotation / deletion* of key files; it does NOT add value display.

**Key file types** managed here:
1. **Admin signing keypair** (`keys/admins/<principalId>.keypair.json`) — used by §3.6.
2. **Control-plane keypair** (`keys/dev.keypair.json` today) — used by legacy CLI; this UI can rotate it.
3. **Mode-config signing public-key registry** (`keys/mode-config.json` is the *signed config*, not a key — readonly).
4. **Vault key** (`keys/vault.key`) — used by the vault connector when enabled.

**Routes** — new namespace `/workspace/admin/setup/admin-keys`:
- `GET    /workspace/admin/setup/admin-keys` → list `{ keyId, keyKind, fingerprint, present, lastModified }[]`. No private material.
- `POST   /workspace/admin/setup/admin-keys` (multipart) body `{ keyKind: 'admin-signing' | 'control-plane' | 'vault', keyFile: <multipart file> }` → server validates the file is a well-formed Ed25519 keypair JSON, writes to the appropriate path with perms 0600. Existing file is renamed `<path>.replaced-<iso8601>` (one rotation backup).
- `DELETE /workspace/admin/setup/admin-keys/:keyId` → server refuses to delete the keypair for the currently-elevated admin (you'd lock yourself out).

**Panel changes** — `toolchain-keys-panel.tsx`:
- Delete the "Source priority (pending OR-DASH-009 owner ruling)" placeholder block — replace with a real "Admin signing key" section showing fingerprint + present pill + Upload-new-key button.
- The `AdminSecretField` listing for detected secret refs survives (it's correct — presence-only).
- Upload modal: file input + `keyKind` selector + confirm. On submit, multipart POST. On success, fingerprint refreshes.

**Tests** —
- `admin-writer-admin-keys.test.ts` — unit: malformed key rejection, perms set correctly, rotation backup file written.
- `toolchain-keys-panel.test.tsx` — upload happy path + lock-yourself-out guard.

---

## §4. Cross-cutting work

### §4.1 admin-setup-status response gains `signingKeypairPresent`

The `DashboardSurfaceStatus` for the `modes_policy_oct` surface gains a `signingKeypairPresent: boolean` field. Drives §3.6 UI fallback.

### §4.2 Catalog reload after writer success

Every panel that mutates state calls `onCatalogReload()` (the existing pattern from §2.1). The catalog API gains new fields:
- `allIdentityProviders`
- `allChannels`
- `allOrchestrators`
- `allWorkspaces`
- `allMailboxes`
- `allCompilers`
- `allReturnEndpoints`

Each is a typed array of the manifest entries, used by panels for cross-surface validation (e.g. the workspace panel's return-endpoint dropdown).

### §4.3 admin-writer-api.ts client helpers

Five new function groups added, one per surface in §3.1–§3.5, mirroring the existing endpoint/actor/connector helper layout. Two more for §3.6 (`setMode`, `unlockEnforcing`). Three more for §3.7 (`listAdminKeys`, `uploadAdminKey`, `deleteAdminKey`).

### §4.4 admin-disabled-mutation-banner.tsx — surviving uses

After this spec lands, `AdminDisabledMutationBanner` is used in exactly the by-design read-only contexts of §2.3 — and nowhere else. ci:gate gains a step that greps for `AdminDisabledMutationBanner` import outside of `ledger-viewer-panel.tsx` and fails the build if it reappears elsewhere.

### §4.5 placeholder-data.ts — surviving uses

`PLACEHOLDER_BANNER_REASON` is deleted. The `*_PLACEHOLDER` constants survive only as fallback `DashboardSurfaceStatus` shapes when the catalog hasn't loaded (initial render). Once data arrives, they're replaced. The fallback-only role is enforced by panel-test assertions: "when `data` is provided, no placeholder string appears in the rendered output."

### §4.6 AdminAddNewButton — deleted

The primitive itself is removed. No surface needs a placeholder add button anymore.

### §4.7 ci:gate additions

Two new ci:gate steps (Step 81 + 82):
- **Step 81**: grep the workspace-ref tree for `AdminAddNewButton` import → fail if found.
- **Step 82**: grep panel sources for `console.log` / `console.warn` (panels must use the structured toast/feedback path) → fail if found.

---

## §5. Build sequencing (smallest-correct-surface)

Estimated commits, in order. Each commit keeps ci:gate green and tests passing.

| # | Title | Scope |
|---|---|---|
| 1 | catalog API extension | Add the seven new `all*` arrays to the catalog response + types. Pure additive, no UI change. |
| 2 | identity providers writer | Backend route + Zod + YAML write + tests. UI panel rewrite (delete placeholder, add CRUD). |
| 3 | approval channels writer | Same recipe. |
| 4 | orchestrators writer | Same recipe. |
| 5 | workspaces writer | Same recipe + entryMode-stays-locked test. |
| 6 | mailbox writer (sub-surface a) | Same recipe + per-actor-allocation invariant. |
| 7 | compiler writer (sub-surface b) | Same recipe. |
| 8 | return-endpoint writer (sub-surface c) | Same recipe + cross-surface targetWorkspace validation. |
| 9 | admin-key registration writer | §3.7 — new namespace, multipart upload, lock-yourself-out guard. |
| 10 | mode signing route + UI | §3.6 — server-side signing, enforcing-lock UX, unlock flow, fallback when keypair missing. |
| 11 | end-to-end test + ci:gate steps 81/82 + cleanup | §1.F integration test + placeholder/console removal sweep. |

Total: 11 commits. Mailbox-pit shipped in 7, lexicon V1 will ship in ~5 — this is a bigger surface area but each commit follows an established recipe.

---

## §6. Out of scope (deferred to later specs)

- **In-browser approval UX** — the dashboard *channel record* is buildable here; the actual approval-rendering UX (pending-approvals queue, approve/deny affordance with re-auth) is its own spec because of approver-key verification + audit-trail design choices. The channel record this spec ships is forward-compatible.
- **Lexicon admin UI (V3)** — per `AMEND-nexus-planner-db-lexicon-v0-2-1` §8, signed-admin-apply for lexicon entries lands in V3 after lexicon V1 ships.
- **NXS policy bundle editing** — same architectural shape as mode (signed envelope); a separate spec because policy bundles are richer than mode triplets. The policy summary display in §3.6 panel is unchanged.
- **OCT level admin UI** — actor.octLevel is editable through §2.1 actor writer today; the modes/policy panel's OCT readout is informational.
- **Multi-admin signing-key federation** — V1 supports one signing keypair per admin principal. A signing council / m-of-n approvals is a future spec.

---

## §7. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Operator misconfigures a mailbox manifest and bootstrap can't allocate per-actor mailboxes | §3.5.a invariant: writer rejects deletion that would leave zero file-backed mailboxes. |
| Operator deletes the workspace that a return endpoint points to | §3.5.c cross-surface FK validation. |
| Operator deletes their own admin signing keypair → can't make further mode changes | §3.7 writer rejects self-delete with 409. |
| Operator uploads a malformed keypair file | §3.7 writer parses + verifies signature roundtrip before writing. |
| Multipart upload bypasses CSRF / elevated-session checks | Multipart route uses the same auth middleware chain as the rest of `/workspace/admin/setup`. |
| Two admins flip mode simultaneously, race on `keys/mode-config.json` | Atomic write via temp-file + rename is already the pattern; the run ledger's `mode_changed` event sequence preserves causality on conflict. |
| `requiresRestart: true` surfaces are confusing — admin clicks save but nothing happens | Every restart-required writer returns `{ requiresRestart: true }`; the panel's success toast says "Saved — restart server to apply." Already the pattern for endpoints/connectors. |

---

## §8. Open items requiring owner ratification

(None blocking — listed for completeness; the spec is internally consistent without these answers, but resolving them now avoids rework.)

1. **Workspace return-endpoint cardinality** — can multiple workspaces share a return endpoint, or is it 1:1? Current code allows N:1. Spec assumes N:1; if the owner wants 1:1, §3.5.c validation gets stricter.
2. **Channel `last-enabled` guard when NXS mode is `enforcing`** — §3.2 proposes blocking deletion of the last enabled approval channel when NXS is enforcing, on the theory that enforcing requires at least one approval surface. If the owner thinks that's over-protective (some flows might be auto-approved), drop the guard.
3. **`mode-changed` event in the run ledger** — the existing CLI emits this event with the legacy event type. The new dashboard route emits the same event with the same shape, so ledger consumers see no diff. Confirm acceptable.

---

## §9. Memory + handoff updates

Once this spec is ratified, save:
- A `project_admin_dashboard_buildout.md` memory pointing at this spec + the rollout commit plan.
- A handoff amendment at `runs/<arc>/handoff-admin-buildout.md` so a future Claude continuing this work has the entry-point pointer.

— Drafted 2026-05-15 by Claude (Opus 4.7 1M).
