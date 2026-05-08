# SPEC: Agent Panel — Catalog-Driven Registration + Workspace Integration

**For**: Claude Code to implement
**Status**: Owner-ratified (build immediately)
**Prerequisite**: Model endpoint panel pattern (already built by Claude Code)

---

## 1. What This Enables

Admin registers agents through the dashboard. Agents appear in the workspace
"Select an agent" dropdown for authorized users. User selects one or more
agents, submits a prompt, Nexus governs and dispatches.

---

## 2. Actor Fields — What the Form Must Capture

Source: `packages/contracts/src/interfaces/index.ts` → `interface Actor`

| Field | Type | Required | Source for dropdown | Notes |
|---|---|---|---|---|
| `actorId` | Uuid | Auto-generated | `crypto.randomUUID()` | Primary key |
| `actorClass` | string | Yes | `ACTOR_CLASS` from `@nexus/contracts` | **Must be `SUPERVISED_AGENT`** for workspace visibility |
| `principalId` | Uuid | Yes | Existing principals from `principalRegistry.get()` or manual UUID | The human handler — whose authority the agent works under |
| `displayName` | string | Yes | User input | Shows in workspace agent dropdown |
| `environment` | string | Yes | `ENVIRONMENT_ID` from contracts: dev, staging, production | Current system uses 'reference' |
| `octLevel` | string | Yes | `OCT_LEVEL` from contracts: OCT-SECURE, OCT-CONFIDENTIAL, OCT-OPEN, OCT-COMPILE | Determines data classification ceiling |
| `riskCeiling` | string | Yes | `RISK_TIER` from contracts: low, medium, high, critical | Max risk operations this agent can perform |
| `allowedSystems` | string[] | Yes | From `catalog.allConnectors` → unique connectorIds + `['*']` wildcard | Which systems this agent can target |
| `allowedCapabilities` | string[] | Yes | `CAPABILITY_IDS` from contracts (19 governed capabilities) | Multi-select — what this agent can do |
| `enabled` | boolean | Yes | Toggle, default true | Disabled agents don't appear in workspace |
| `registeredAt` | ISO string | Auto | `new Date().toISOString()` | |
| `owner` | string | Required for non-human | User input | Who owns/maintains this agent |
| `purpose` | string | Required for non-human | User input | What this agent is for |
| `reviewCadence` | string | Required for non-human | quarterly, annual, etc. | How often this agent is reviewed |

---

## 3. Critical: principalId (Human Handler)

The `principalId` links the agent to the human principal whose authority it
operates under. This is how the delegation chain works:

- Principal (human admin) → delegates to → Agent (supervised)
- The agent's `principalId` MUST match a registered principal
- Currently, the dev-admin principal is: `00000000-0000-4000-a000-000000000001`
- The default agent principal is: `00000000-0000-4000-a000-000000000003`

For MVP: provide a dropdown of known principals OR allow manual UUID input.
The system currently has 2 principals (dev-admin + default-agent-principal).

To list principals: `actorRegistry` doesn't do this, but the `principalRegistry`
does. It's available in the DI deps. Consider adding a
`GET /workspace/admin/setup/principals` route that returns registered principals,
or include them in the catalog response.

---

## 4. How Agents Appear in Workspace

File: `packages/workspace-ref/src/stores/catalog-reader.ts` → `listAgents()`

Rules:
1. Only `actorClass === 'SUPERVISED_AGENT'` actors appear
2. `intersectsAllowedSystems(actor.allowedSystems, claims)` — user must have
   overlapping system access
3. `enabled !== false` — disabled agents show as "visible but not selectable"
4. `displayName` shows in the dropdown
5. `purpose` shows as description

**Multiple agents can be selected** — `WorkspaceRunRequest.selectedAgentIds: Uuid[]`
is an array. The workspace UI currently supports single selection but the
backend supports multiple.

---

## 5. What the Orchestrator Needs From Agents

File: `packages/orch-ref/src/agent-registry-reader.ts`

The orchestrator reads from the canonical ActorRegistry to:
1. Get agent capabilities (`allowedCapabilities`) — determines what tasks can
   be assigned to this agent
2. Get agent risk ceiling — determines what risk level of tasks can be assigned
3. Get allowed systems — determines which connectors the agent can use
4. Plan the execution DAG based on agent capabilities

---

## 6. Implementation — Same Pattern as Model Endpoint Panel

The model endpoint panel (already built by Claude Code) established the pattern:
- Catalog-driven dropdowns from `GET /workspace/admin/setup/catalog`
- Inline edit for existing entries
- Enable/disable toggle
- Delete with confirm
- Feedback banners (success, error, restart info)

Apply the SAME pattern to the actor panel:

### 6.1 Backend — Add to catalog response

In `admin-writer.ts` catalog route, ADD to the response:
```typescript
// Already in catalog: actorClasses, octLevels, riskTiers, capabilities
// ADD: list of existing principals for the principalId dropdown
// ADD: list of existing actors for the table (ALL, including disabled)
allActors: await deps.actorRegistry?.list() ?? [],
```

Note: `actorRegistry.list()` already returns ALL actors including disabled.
No manifest read needed — actors are in SQLite.

### 6.2 Frontend — Rebuild actor-agent-setup-panel.tsx

Same pattern as model-endpoint-setup-panel.tsx:
- Table showing ALL actors (enabled + disabled) with state badge
- Catalog-driven dropdowns for actorClass, octLevel, riskCeiling, capabilities, systems
- Multi-select for `allowedCapabilities` (checkboxes or multi-select dropdown)
- Multi-select for `allowedSystems`
- principalId dropdown (from catalog principals or manual input)
- Required fields: owner, purpose, reviewCadence (non-human actors)
- Add form with all fields
- Inline edit for existing actors
- Enable/disable toggle
- Delete (hard delete — already implemented in backend)
- **No restart required** — actors are in SQLite, changes are immediate

### 6.3 API Endpoints Already Built

- `POST /workspace/admin/setup/actors` — register new actor ✓
- `PUT /workspace/admin/setup/actors/:actorId` — update existing ✓
- `DELETE /workspace/admin/setup/actors/:actorId` — hard delete ✓
- Client helpers in `admin-writer-api.ts` — `addActor`, `updateActor`, `deleteActor` ✓

---

## 7. Test Plan

After the panel is built:
1. Add a "math-worker" agent: SUPERVISED_AGENT, OCT-OPEN, medium risk,
   systems: ['stub'], capabilities: ['read:record:single', 'synthesize:content']
2. Verify it appears in workspace agent dropdown
3. Select it, submit "What is 7 + 5?", verify the run dispatches
4. Add a "cake-planner" agent with same config
5. Verify BOTH appear in dropdown
6. Verify disabled agents show but are not selectable

---

## 8. Connector Panel — Same Pattern (Do After Agents)

Once agents work, apply the same catalog-driven rebuild to
`connector-setup-panel.tsx`. The backend CRUD already works.
Connectors are simpler — fewer fields, manifest-based (requires restart).

---

## 9. Files to Modify

| File | Change |
|---|---|
| `admin-writer.ts` | Add `allActors` to catalog response |
| `actor-agent-setup-panel.tsx` | Full rebuild — same pattern as model endpoint panel |
| `admin-catalog-api.ts` | Add `allActors` to `AdminCatalog` type |
| `admin-dashboard-shell.tsx` | Already threads catalog — may need minor update |

---

## 10. Definition of Done

- [ ] Admin can add an agent with all required fields via dynamic dropdowns
- [ ] Agent appears in workspace "Select an agent" dropdown
- [ ] Admin can edit an existing agent inline
- [ ] Admin can enable/disable an agent (toggle)
- [ ] Admin can delete an agent (hard delete with confirm)
- [ ] Multiple agents visible in workspace dropdown
- [ ] ci:gate 79/79 GREEN
