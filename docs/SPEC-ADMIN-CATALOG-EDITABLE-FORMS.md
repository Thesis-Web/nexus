# SPEC: Admin Dashboard — Dynamic Catalog + Editable Forms

**Author**: Claude D
**Date**: 2026-05-07
**Branch**: `feat/beta1-admin-dashboard`
**Status**: DRAFT — requires owner ratification before build
**Governing law**: blueprint v1.5.13, spec v1.8.26, SPEC-ADMIN-WRITER
**Fixes**: STRIKE-D01 (hardcoded dropdowns), ITEM-D02 (disabled entries hidden),
ITEM-D03 (no inline editing), ITEM-D04 (cascading endpoint dropdowns),
ITEM-D05 ("add new" on every dropdown)

---

## 1. Problem Statement

The admin dashboard writer forms use hardcoded HTML `<option>` lists instead
of reading from the system's actual data. Existing entries (including disabled
ones) are hidden from the admin view. Inline editing of existing entries is
not possible. This makes the dashboard a toy, not a tool.

---

## 2. Data Sources — What Already Exists in the Repo

### 2.1 Contracts Constants (`packages/contracts/src/constants/index.ts`)

These are the canonical governed value sets. All are open `string` types —
the constants define the KNOWN set, but new values can be added at runtime.

| Constant | Values | Used by |
|---|---|---|
| `ACTOR_CLASS` | HUMAN, HUMAN_WITH_COPILOT, SUPERVISED_AGENT, AUTONOMOUS_AGENT, SCHEDULED_AGENT, DELEGATED_SUBAGENT, SERVICE_AUTOMATION (7) | Actor registration |
| `OCT_LEVEL` | OCT-SECURE, OCT-CONFIDENTIAL, OCT-OPEN, OCT-COMPILE (4) | Actor OCT assignment |
| `RISK_TIER` | low, medium, high, critical (4) — ordered via `RISK_TIER_ORDER` | Actor risk ceiling |
| `MODEL_TIER` | on_prem_sensitive, on_prem_general, frontier_general, frontier_reasoning, frontier_live, fallback (6) | Endpoint tier |
| `CAPABILITY_IDS` | 19 governed capability strings (e.g., `read:record:single`, `execute:automation`) | Actor allowed capabilities |
| `ACTION_VERB` | read, write, create, update, delete, execute, query, search, publish, export, send, synthesize, transmit (13) | Classification |

### 2.2 Registries (constructed at bootstrap)

| Registry | Class | Method | Returns | Current location |
|---|---|---|---|---|
| `ModelTransportAdapterRegistry` | In `packages/vanguard/src/transport/` | `.list()` | `ModelTransportAdapter[]` — each has `.adapterId`, `.adapterVersion` | Constructed in `bootstrap()` Step 1, held in `BootstrapResult.transportContext.registry` |
| `CapabilityRegistry` | `packages/core/src/classification/capability-registry.ts` | `.list()` | `CapabilityEntry[]` — each has `.capabilityId`, `.verb`, `.defaultRiskTier`, `.resourceScope` | Constructed in `nexus-main.ts` orchestrator assembly only — NOT exposed to API layer |
| `ConnectorFactoryRegistry` | In `packages/core/src/engine/pipeline.ts` | `.list()` | `ConnectorFactory[]` — each has `.connectorType` | Constructed in `bootstrap()`, NOT exposed |
| `IdentityProviderFactoryRegistry` | Same file | `.list()` | `IdentityProviderFactory[]` — each has `.providerType` | Same |

### 2.3 Raw Manifests (YAML files on disk)

The manifest loaders (endpoint, connector, identity, channel) **filter out
disabled entries** (HOLE-C01). For the admin dashboard, we need ALL entries
including disabled ones. `ManifestWriterService.readEntries()` already does
this — it reads raw YAML without filtering.

| Manifest | Path | Body key | ID key | Entries in repo |
|---|---|---|---|---|
| Endpoints | `config/nvg/endpoints.v1.yaml` | `endpoints` | `endpointId` | 3 (1 enabled, 2 disabled) |
| Connectors | `config/connectors/connectors.v1.yaml` | `connectors` | `connectorId` | 2 (1 enabled, 1 disabled) |
| Identity | `config/identity/providers.v1.yaml` | `providers` | `providerId` | 1 |
| Channels | `config/channels/channels.v1.yaml` | `channels` | `channelId` | 1 |

### 2.4 Auth Kinds (`packages/contracts/src/interfaces/model-endpoint-auth.ts`)

Discriminated union: `'none' | 'api_key' | 'bearer'`

### 2.5 Existing Catalog API (`/workspace/catalogs/*`)

Already exists in `packages/interfaces/api/src/routes/workspace.ts` (lines 939-985):
- `GET /workspace/catalogs/agents` → `CatalogItem[]`
- `GET /workspace/catalogs/models` → `CatalogItem[]`
- `GET /workspace/catalogs/connectors` → `CatalogItem[]`

These are claims-filtered, user-facing. They return simplified `CatalogItem`
(id, name, description, visible, selectable). NOT suitable for admin forms —
they lack the schema detail needed for form fields.

### 2.6 Live Infrastructure (James's network)

4 ollama nodes running on local network:
- `jameshp2:11434` — ollama serve, `OLLAMA_HOST=0.0.0.0`
- `BlackMac:11434` — ollama serve
- `jameshp:11434` — ollama serve, `OLLAMA_HOST=0.0.0.0`
- `iMac:11434` — ollama serve (localhost only — needs `OLLAMA_HOST=0.0.0.0`)

Each can be queried for available models via `GET /api/tags` (ollama API).

---

## 3. New Backend: Admin Catalog Endpoint

### 3.1 Route

`GET /workspace/admin/setup/catalog`

Auth: same chain as other admin-setup routes (JWT + admin role + X-Elevated-Session)

### 3.2 Response Shape

```typescript
interface AdminCatalogResponse {
  ok: true;

  // ── Governed constant sets (from contracts) ──────────────────────────
  actorClasses: { id: string; label: string }[];
  octLevels: { id: string; label: string; description: string }[];
  riskTiers: { id: string; label: string; order: number }[];
  modelTiers: { id: string; label: string }[];
  authKinds: { id: string; label: string; requiresSecret: boolean }[];

  // ── Registry-sourced (from bootstrap registries) ─────────────────────
  adapters: { adapterId: string; adapterVersion: string }[];
  capabilities: {
    capabilityId: string;
    verb: string;
    defaultRiskTier: string;
    resourceScope: string;
  }[];
  connectorTypes: { connectorType: string }[];

  // ── Raw manifest entries (ALL, including disabled) ───────────────────
  allEndpoints: Record<string, unknown>[];
  allConnectors: Record<string, unknown>[];
}
```

### 3.3 Data Assembly

| Field | Source | How |
|---|---|---|
| `actorClasses` | `ACTOR_CLASS` from `@nexus/contracts` | Value import — iterate object entries |
| `octLevels` | `OCT_LEVEL` from `@nexus/contracts` | Value import — iterate + attach OCT_CEILINGS summary |
| `riskTiers` | `RISK_TIER` + `RISK_TIER_ORDER` from `@nexus/contracts` | Value import — iterate with order index |
| `modelTiers` | `MODEL_TIER` from `@nexus/contracts` | Value import — iterate |
| `authKinds` | Hardcoded from `ModelEndpointAuth` discriminated union | `[{id:'none',requiresSecret:false},{id:'api_key',requiresSecret:true},{id:'bearer',requiresSecret:true}]` |
| `adapters` | `ModelTransportAdapterRegistry.list()` | **Needs DI** — registry must flow from bootstrap to API |
| `capabilities` | `CapabilityRegistry.list()` | **Needs DI** — new construction in serve.ts |
| `connectorTypes` | `ConnectorFactoryRegistry.list()` | **Needs DI** — registry must flow from bootstrap to API |
| `allEndpoints` | `ManifestWriterService.readEntries('config/nvg/endpoints.v1.yaml', 'endpoints')` | Already wired via `manifestWriter` dep |
| `allConnectors` | `ManifestWriterService.readEntries('config/connectors/connectors.v1.yaml', 'connectors')` | Already wired via `manifestWriter` dep |

### 3.4 DI Wiring Needed

Three registries need to reach the API layer:

**A. `ModelTransportAdapterRegistry`** — already in `BootstrapResult.transportContext.registry`.
Path: `bootstrap()` → `BootstrapResult` → `nexus-main.ts` → return in workspace deps → `ApiDependencies` → route.

Add to `ApiDependencies`:
```typescript
adapterRegistry?: { list(): { adapterId: string; adapterVersion: string }[] };
```

Wire in `nexus-main.ts`:
```typescript
adapterRegistry: { list: () => br.transportContext.registry.list().map(a => ({
  adapterId: a.adapterId, adapterVersion: a.adapterVersion
})) },
```

**B. `CapabilityRegistry`** — stateless, no constructor deps.
Construct directly in the catalog route handler:
```typescript
import { CapabilityRegistry } from '@nexus/core';
const caps = new CapabilityRegistry().list();
```

This works because `CapabilityRegistry` uses a module-level `CAPABILITY_TABLE`
constant — constructing a new instance just reads the same table. No DI needed.

**C. `ConnectorFactoryRegistry`** — constructed in `bootstrap()` but not exposed.
Add to `BootstrapResult` or construct in `nexus-main.ts`.

Alternative: since only 2 connector types exist (stub, vault), and the
`connectors.v1.yaml` manifest already lists `connectorType` on each entry,
we can derive available types from the raw manifest entries without needing
the factory registry. `allConnectors.map(c => c.connectorType)` + dedupe.

### 3.5 Route File

Add to `packages/interfaces/api/src/routes/admin-writer.ts` as a new GET
handler under the existing auth chain. Approximately 60 lines.

---

## 4. Backend: Raw Manifest Projection for Admin-Setup

### 4.1 Problem

`admin-setup.ts` receives `endpoints` from DI — these are the
post-loader, enabled-only `ModelEndpoint[]`. The dashboard shows 1 of 3
endpoints because 2 are disabled and filtered by the loader.

### 4.2 Fix

Add `allEndpoints` and `allConnectors` to the admin-setup route's DI deps.
Source: `ManifestWriterService.readEntries()` called at request time (reads
live YAML, always current including post-write changes).

The admin-setup projection for `models_nvg` and `connectors_targets` surfaces
should merge enabled entries (with health/status from runtime) with disabled
entries (from raw YAML, marked `state: 'disabled'`).

### 4.3 Files Modified

- `packages/interfaces/api/src/routes/admin-setup.ts` — merge raw manifest entries
- `packages/interfaces/api/src/server.ts` — add `manifestWriter` to admin-setup deps (already in ApiDependencies)

---

## 5. Frontend: Dynamic Catalog Client

### 5.1 New File

`packages/workspace-ref/src/client/admin-catalog-api.ts`

```typescript
export interface AdminCatalog { /* mirrors §3.2 response */ }

export async function getCatalog(
  elevatedSessionId: string
): Promise<{ ok: boolean; data?: AdminCatalog; error?: string }> {
  // GET /workspace/admin/setup/catalog with elevated session header
}
```

### 5.2 Caching

Catalog data is stable within a session. Fetch once on admin dashboard mount,
store in React state, pass to panels. Do NOT re-fetch on every panel switch.

---

## 6. Frontend: Dynamic Dropdowns

### 6.1 Pattern

Every dropdown that currently uses hardcoded `<option>` lists will instead:
1. Receive `catalog: AdminCatalog` as a prop from the shell
2. Map the relevant catalog field to `<option>` elements
3. Include an "Add new…" option at the bottom
4. When "Add new…" is selected, show an inline text input for custom value

### 6.2 Dropdown Mapping Per Panel

**Model Endpoint Panel:**
| Dropdown | Catalog field | Display |
|---|---|---|
| Adapter | `catalog.adapters` | `adapterId` |
| Tier | `catalog.modelTiers` | `id` (label) |
| Auth kind | `catalog.authKinds` | `id` — show/hide secretRef fields based on `requiresSecret` |

**Actor/Agent Panel:**
| Dropdown | Catalog field | Display |
|---|---|---|
| Actor class | `catalog.actorClasses` | `id` |
| OCT level | `catalog.octLevels` | `id` (description) |
| Risk ceiling | `catalog.riskTiers` | `id` (ordered) |
| Allowed systems | `catalog.allConnectors` → unique `connectorId` values + wildcard `*` | Multi-select + add new |
| Capabilities | `catalog.capabilities` | `capabilityId` — multi-select + add new |

**Connector Panel:**
| Dropdown | Catalog field | Display |
|---|---|---|
| Connector type | `catalog.connectorTypes` | `connectorType` + add new |
| Allowed systems | Freetext with `*` default | Input + add |

### 6.3 Estimated Change Per Panel

~40-60 lines: replace static `<select>` with catalog-driven `<select>` +
"Add new" toggle + input field.

---

## 7. Frontend: Editable Forms + Working Save

### 7.1 Problem

`AdminManifestReadForm` renders entries as read-only key-value pairs.
The "Save (disabled)" button and "Read-only" banner persist even when the
elevated session is active. There is no way to edit an existing entry.

### 7.2 Fix: Editable Form Component

Create `AdminManifestEditForm` (or extend `AdminManifestReadForm` with an
`editable` prop) that:

1. When `editable={true}` (elevated session active):
   - Renders each field as an `<input>` instead of a `<span>`
   - Tracks local edits in component state
   - Shows "Save" button (enabled) that calls PUT via writer API
   - Shows "Discard" button to reset to original values
   - Hides the "Read-only" banner

2. When `editable={false}` (no elevated session):
   - Renders as before (read-only display)
   - Shows "Save (disabled)" with reason banner

### 7.3 PUT Flow

User edits field → clicks Save → panel calls `updateEndpoint(elevatedSessionId,
endpointId, editedFields)` → backend ManifestWriterService.updateEntry() →
YAML re-signed → response includes `requiresRestart: true` → panel shows
restart banner.

For actors: `updateActor(elevatedSessionId, actorId, editedFields)` →
`actorRegistry.update()` → immediate, `requiresRestart: false`.

### 7.4 Files Modified

- `packages/workspace-ref/src/client/components/admin/primitives/admin-manifest-read-form.tsx`
  — add `editable?: boolean`, `onSave?: (fields: Record<string,unknown>) => void` props
- Or create new `admin-manifest-edit-form.tsx` alongside it
- 3 panels — pass `editable={canWrite}` and `onSave` handler

### 7.5 Estimated Size

~80-100 lines for editable form component. ~20 lines per panel for onSave wiring.

---

## 8. Frontend: Show All Entries (Enabled + Disabled)

### 8.1 Problem

Panel tables only show enabled entries because the DI pipeline filters
disabled ones. Admin needs to see everything — enable, disable, edit, delete.

### 8.2 Fix

Use `catalog.allEndpoints` / `catalog.allConnectors` from the catalog endpoint
(§3) as the data source for the panel table, instead of the DI-piped
runtime records. Each entry includes its `enabled` field. The table renders
a visual badge: green "enabled" or grey "disabled".

Add an "Enable/Disable" toggle button per entry that calls PUT with
`{ enabled: true/false }`.

### 8.3 Files Modified

- `panels/model-endpoint-setup-panel.tsx` — use catalog.allEndpoints
- `panels/connector-setup-panel.tsx` — use catalog.allConnectors
- Panel table column for enabled/disabled badge

---

## 9. File Inventory

### New Files (2)

| File | Purpose | Est. Lines |
|---|---|---|
| Catalog route handler (in admin-writer.ts) | GET /workspace/admin/setup/catalog | ~60 |
| `admin-catalog-api.ts` | Client-side catalog fetch | ~30 |

### Modified Files (8)

| File | Change | Est. Lines |
|---|---|---|
| `admin-writer.ts` | Add catalog GET handler | +60 |
| `server.ts` | Add `adapterRegistry` to ApiDependencies | +5 |
| `routes/index.ts` | Pass adapterRegistry to admin-writer deps | +3 |
| `nexus-main.ts` | Wire adapterRegistry into returned deps (both paths) | +6 |
| `admin-dashboard-shell.tsx` | Fetch catalog on mount, pass to panels | +15 |
| `admin-manifest-read-form.tsx` | Add editable mode + onSave | +80 |
| `model-endpoint-setup-panel.tsx` | Dynamic dropdowns + editable + catalog data | +50 |
| `actor-agent-setup-panel.tsx` | Dynamic dropdowns + editable + catalog data | +50 |
| `connector-setup-panel.tsx` | Dynamic dropdowns + editable + catalog data | +40 |

### Total: ~340 lines across 10 files

---

## 10. Dependency Order

1. Backend catalog endpoint (§3) — no frontend deps
2. DI wiring for adapterRegistry (§3.4) — needed by catalog endpoint
3. Admin-setup raw manifest merge (§4) — independent of catalog
4. Client-side catalog fetch (§5) — needs backend catalog
5. Shell catalog fetch + prop threading (§5.2) — needs client
6. Editable form component (§7) — independent, can parallel
7. Panel dynamic dropdowns (§6) — needs catalog + editable form
8. Enable/disable badges (§8) — needs catalog data

Build order: 1+2+3 → 4+6 → 5 → 7+8

---

## 11. What This Enables

After this build:
- Admin opens Model Endpoints → sees ALL 3 endpoints (enabled + disabled)
- Clicks "Add endpoint" → adapter dropdown shows `ollama-chat-v1`, `openai-chat-v1`,
  `anthropic-messages-v1` (read from registry) + "Add new…"
- Tier dropdown shows all 6 model tiers from contracts
- Clicks existing endpoint → fields become editable → changes field → clicks Save
  → manifest rewritten + re-signed → "Restart required" banner
- Can toggle endpoint enabled/disabled without deleting
- Same pattern for Actors (dropdowns from contracts, capabilities from registry)
  and Connectors (types from manifest)

---

## 12. Open Questions for Owner

1. **Ollama model discovery**: Should the "Add endpoint" form query ollama
   nodes' `GET /api/tags` to discover available models? This would enable
   cascading dropdowns (pick node → see available models → select one).
   Requires: the admin to enter ollama URLs first, then the backend probes
   them. This is a separate feature from the catalog — flag for future?

2. **Custom values vs. registry enforcement**: When admin picks "Add new…"
   on a capability dropdown and types `custom:my:capability`, should the
   system accept it immediately (open governed type) or require registration
   in the CapabilityRegistry first (fail-closed at pipeline)?

3. **Enable/disable vs. delete**: Should the admin be able to fully delete
   manifest entries, or should disable be the primary mechanism with delete
   reserved for cleanup? (Currently both exist.)
