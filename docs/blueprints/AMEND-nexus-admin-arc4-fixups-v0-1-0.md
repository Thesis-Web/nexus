# Amendment — Admin Dashboard Arc 4 Fixups (production-quality close-out)
# Version: v0.1.0
# Date: 2026-05-15
# Status: RATIFIED — Arc 4 build begins 2026-05-15 (single owner-approved arc).
# Amends:
#   AMEND-nexus-admin-dashboard-full-buildout-v0-1-0.md §3.7 — completes
#     admin-signing keypair provisioning so the unlock route works
#   AMEND-nexus-planner-chat-tier-v0-2-0.md §3.4 — exposes the chat
#     workspace via a user-facing UI selector (the Arc 1 fixup made it
#     API-reachable; this arc makes it browser-reachable)
# References:
#   packages/core/src/modes/mode-manager.ts:184-192 (loadAdminPublicKey)
#   packages/interfaces/api/src/routes/admin-writer.ts:701-722 (writeAdminKeyFile)
#   packages/interfaces/api/src/routes/workspace.ts:1287-1334 (existing catalog routes)
#   packages/workspace-ref/src/client/main.tsx:63-64,251,265 (selectedAgent/selectedModel pattern)
#   packages/workspace-ref/src/client/api.ts:130-138 (listAgents/listModels pattern)
# HEAD pin at draft time: a0d4443
# Owner: James Huson / Lake Area LLC
# Author: Claude (deterministic build agent), under owner direction

---

## §0 Why this amendment exists

Two minor production-quality gaps surfaced during the live-server audit
that followed the admin dashboard + chat-tier arcs. Both are documented
in the prior session's status report; neither is silent. This amendment
closes both in a single small arc so the prior work ships fully
production-quality.

**Gap #3 — Admin signer registry not populated by the admin-keys writer.**
`disableEnforcingLock` in `mode-manager.ts:152-156` calls
`loadAdminPublicKey(adminId)` which reads
`keys/admins/<adminId>.public.json`. The admin-keys POST writer at
`admin-writer.ts:1778-1834` only writes
`keys/admins/<principalId>.keypair.json` (the full private+public
keypair, perms 0600). The public.json companion is never written. Result:
the unlock route is correctly wired and reachable, but every unlock
attempt returns `UNKNOWN_ADMIN: <principalId>` because the public-key
lookup file doesn't exist. Live-verified in the prior arc's mode-signing
trace.

**Gap #2 — Chat workspace not browser-reachable through the React UI.**
Arc 1 fixup (commit `bc76f65`) added optional `workspaceSocketId` to
`WorkspacePromptInputSchema` so HTTP clients can target a specific
workspace. The route's lookup chain works end-to-end (live-verified).
But the React workspace UI at `main.tsx:107-149` has no workspace
selector — `selectedAgent` and `selectedModel` dropdowns exist
(`main.tsx:63-64,251,265`) but no `selectedWorkspace`. A user clicking
the prompt box gets routed to the first-enabled workspace (governed)
because no `workspaceSocketId` is sent.

---

## §1 Surface

### §1.1 Gap #3 — Admin signer public.json companion write

**File:** `packages/interfaces/api/src/routes/admin-writer.ts`

**Change:** Inside the `POST /workspace/admin/setup/admin-keys` route
(after the existing `writeAdminKeyFile` call), when `body.keyKind ===
'admin-signing'`, write a sibling `keys/admins/<keyId>.public.json` file
containing `{ publicKey }` extracted from the uploaded keypair. File
perms 0644 (the public key is by definition publishable; only the
keypair needs 0600).

**Why split files:** `loadAdminPublicKey` deliberately reads only
public material — it must never load the private key into memory for a
signature-verification operation that needs only the public side. The
split is correct security shape per `feedback_signing_keys_server_side`
memory; this amendment completes the wiring.

**Out of scope:** the bootstrap `nexus init` path does not yet write a
public.json companion for the initial admin keypair. That's a separate
followup; the operator-driven keypair upload path (this fix) is the
production path. Initial bootstrap can be addressed when `nexus init`
gets its next refactor.

### §1.2 Gap #2 — Workspace catalog endpoint + UI selector

**Backend** — new route in `packages/interfaces/api/src/routes/workspace.ts`:

- `GET /workspace/catalogs/workspaces` — JWT-only (mirrors
  `/workspace/catalogs/agents` + `/workspace/catalogs/models`).
- Reads `deps.workspaceSockets` (the same array the run-creation route
  resolves against). Returns `CatalogItem[]` for every enabled
  workspace: `id = workspaceSocketId`, `name = workspaceSocketId`,
  `description = "<workspaceType> · entryMode: <entryMode>"`,
  `visible: true`, `selectable: true`.
- No per-user / per-claim filtering for v0.1.0 — every workspace
  authenticated workspace user can see is selectable. Future
  amendments may add visibility scoping if the workspace surface ever
  becomes large enough to warrant it.

**Frontend** — `packages/workspace-ref/src/client/`:

- `api.ts`: add `listWorkspaces(): Promise<ApiResponse<CatalogItem[]>>`
  that fetches `/workspace/catalogs/workspaces`. Mirrors
  `listAgents` / `listModels` exactly.
- `main.tsx`: add `const [selectedWorkspace, setSelectedWorkspace] =
  useState('')` next to the existing `selectedAgent`/`selectedModel`
  hooks. Default empty string = "Auto" (server falls back to
  first-enabled — preserves current behavior for users who don't pick).
- `main.tsx`: in `handleSubmit`, when `selectedWorkspace` is non-empty
  AND `submission.workspaceSocketId` is not already set, set it to
  `selectedWorkspace`. Mirrors the existing
  `selectedModel → preferredEndpointId` pattern at lines 119-121.
- `main.tsx`: in the topbar (`.nx-topbar-controls`), add a dropdown
  mirroring the agent + model dropdowns. First option "Auto
  (first-enabled)" with value `""`; subsequent options one per
  catalog-returned workspace.
- `components/prompt-panel.tsx`: extend `PromptSubmission` interface
  with optional `workspaceSocketId?: string`.
- Catalog refresh: fetch `listWorkspaces()` in the existing
  `Promise.all` at `main.tsx:75` so the dropdown populates on mount.

**Cardinality enforcement is server-side.** The chat workspace requires
exactly one selectedAgentId; the route at `workspace.ts:619-629` (Arc 1
fixup) enforces this with HTTP 400 before any ledger write. UI-side
agent-count filtering when chat is selected is polish for the
chat-tier-v1.5 amendment, not this arc.

---

## §2 Tests

**Gap #3:** extend `tests/api/admin-writer.test.ts`:
- POST a well-formed admin-signing keypair → assert both
  `<keyId>.keypair.json` AND `<keyId>.public.json` appear in the
  in-memory store. Assert the public.json contains the same
  `publicKey` value as the keypair.

**Gap #2 backend:** extend the integration suite OR add to existing
admin-writer / workspace tests:
- `GET /workspace/catalogs/workspaces` with two enabled workspaces in
  `deps.workspaceSockets` returns both as `CatalogItem[]`.
- Disabled workspace is omitted.

**Gap #2 frontend:** no new test required for v0.1.0 — the topbar
dropdown is a UI affordance that surfaces the same field already proven
by Arc 1's HTTP-level test `tests/integration/workspace-chat-route.integration.test.ts`.
The Arc 1 test already covers the wire-format behavior; the UI is just
a typed selector exposing it.

**Live verification (manual, against running `nexus serve`):**
1. `pnpm build && pnpm tsx scripts/nexus-main.ts -- serve`
2. POST a new admin keypair via `/workspace/admin/setup/admin-keys`
3. Verify both `keys/admins/<id>.keypair.json` (0600) and
   `<id>.public.json` (0644) on disk
4. POST `/workspace/admin/setup/mode/unlock` → expect 200 (was
   `UNKNOWN_ADMIN` before this fix)
5. Open the React workspace at `/`, confirm topbar shows a workspace
   dropdown with both seeded entries
6. Select `nexus-chat-default`, submit a prompt, confirm the run lands
   in the chat tier (Branch 0) via the run-ledger viewer

---

## §3 Out of scope

- **Bootstrap `nexus init`** writing the initial admin's public.json
  companion. Separate, when `nexus init` is next touched.
- **UI agent-count filtering when chat workspace is selected.** Polish
  for chat-tier-v1.5 amendment, not this arc.
- **Per-claim workspace visibility filtering.** Not needed for v0.1.0
  (small workspace surface); add when warranted.
- **Multi-admin signing federation.** Was already out-of-scope for
  AMEND-nexus-admin-dashboard §6 / multi-admin signing federation; this
  amendment does not change that.

---

## §4 Build sequence

| # | Title | Files | Tests |
|---|---|---|---|
| 1 | Arc 4 spec lands | this file | — |
| 2 | Gap #3 — admin signer public.json | `admin-writer.ts` | +2 admin-writer.test.ts cases |
| 3 | Gap #2 — workspace catalog + UI selector | `workspace.ts`, `api.ts`, `main.tsx`, `prompt-panel.tsx` | +1 backend test |

ci:gate stays 90/90 (no new gates this arc — both fixes are mechanical
wiring, not new invariants).

---

## §5 Risks + mitigations

| Risk | Mitigation |
|---|---|
| public.json drift from keypair.json over time | Both written atomically in the same handler; subsequent rotations overwrite both. Followup keypair upload always replaces both files. |
| UI selector default behavior changes existing flows | Default `selectedWorkspace = ''` → no `workspaceSocketId` sent → server fall-back to first-enabled is unchanged from current behavior. Pure additive. |
| Chat workspace cardinality mismatch (user picks chat + multiple agents) | Server-side 400 at `workspace.ts:619-629` already enforces; user sees a friendly error rather than silent failure. |
| Future per-claim filtering becomes painful retroactively | Catalog endpoint is one place to add filtering when needed; current shape mirrors existing `listAgents` pattern that already does claim-aware filtering for parity. |

---

*End of spec. Build per §4 sequence.*
