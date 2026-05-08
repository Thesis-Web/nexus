# PATCH: SPEC-AGENT-PANEL-CATALOG.md — Section 3 Replacement

**Replaces**: Section 3 ("Critical: principalId (Human Handler)")
**Reason**: CONTRA-E01 — blueprint §12.1 says principal owns the ACTION,
not the agent. principalId on agent record is registrar audit trail.

---

## 3. principalId on Agent Record (Registrar — Audit Trail Only)

The `principalId` field on the Actor record has different meanings by class:

- **HUMAN / HUMAN_WITH_COPILOT**: principalId = self (they ARE the principal)
- **All agent classes**: principalId = the admin who registered this agent
  (audit trail only — NOT the runtime authority)

### Runtime behavior

When a user selects an agent and sends a prompt:
1. The REQUESTING USER's principalId becomes the delegation authority
2. `issueDelegation()` mints a delegation with the user's principalId
3. The agent operates under the user's authority for that run
4. Multiple users can use the same agent simultaneously — each gets
   their own delegation with their own principalId

### What the form should do

The principalId field in the agent registration form should be:
- **Auto-populated** with the logged-in admin's principalId
  (from the elevated session claims)
- **Read-only** — not editable, not a dropdown
- **Label**: "Registered by" (not "Principal" or "Human Handler")
- Stored as `principalId` on the Actor record for audit purposes

### Current known principals (bootstrap-seeded)

| principalId | displayName | Role |
|---|---|---|
| `00000000-0000-4000-a000-000000000001` | dev-admin | Super admin |
| `00000000-0000-4000-a000-000000000003` | nexus-default-agent-svc | Default agent registrar |
| `00000000-0000-4000-a000-000000000010` | test-analyst | Bounded test user (medium risk) |
| `00000000-0000-4000-a000-000000000020` | test-intern | Low-privilege test user (low risk) |

### What this means for the table in Section 2

Update the `principalId` row:

| Field | Type | Required | Source for dropdown | Notes |
|---|---|---|---|---|
| `principalId` | Uuid | Yes (auto) | Auto-set from admin session | Registering admin's principalId. Read-only. NOT the runtime authority. |
