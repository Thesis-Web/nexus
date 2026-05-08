# SPEC: Runtime Principal Binding — Delegation Fix

**For**: Claude Code to implement
**Status**: Owner-ratified (build immediately)
**Branch**: `feat/beta1-admin-dashboard`
**Author**: Claude E (architecture), owner-approved
**Governing law**: blueprint v1.5.13 §12.1, §17.3; spec v1.8.26 §12.3.3, §21.1

---

## 0. Read This First

This spec fixes a fundamental architecture error: agents are permanently bound
to a single principal at registration time. The correct model (per blueprint
§12.1) is: agents are shared resources, the requesting USER becomes the
principal at runtime when they activate the agent.

**Five files change. Every change has a reason. Do not skip any.**

The pipeline is currently in `observe` mode (`keys/mode-config.json` →
`"nxsMode": "observe"`). This means gate denials are logged but not enforced.
The fixes in this spec make the pipeline correct for `enforce` mode. Test in
observe first, then switch to enforce and verify.

---

## 1. Problem

When a user selects an agent and sends a prompt:

1. `issueDelegation()` looks up `agent.principalId` (the admin who registered
   the agent) instead of the requesting user's principalId
2. `dispatchToGovernance()` sets `principalId: orchManifest.orchestratorActorId`
   on the AgentAction — also wrong
3. `dispatchToGovernance()` uses `sessionId: crypto.randomUUID()` — a fake
   session that doesn't exist in the store
4. Gate 01 validates `actor.principalId === principal.principalId` — this
   check blocks agents from working under different principals
5. Session creation validates `actor.principalId === delegation.principalId` —
   same fixed-binding assumption
6. Capability filtering in `issueDelegation()` compares capability strings
   against system strings — always passes by accident with `['*']`, breaks
   with real bounded users

### What this causes

Every agent run either:
- Gets the WRONG principal (registering admin, not requesting user)
- Fails at Gate 01 with ACTOR_PRINCIPAL_MISMATCH
- Fails at Gate 01 with SESSION_NOT_FOUND (fake session)
- Passes only because `nxsMode: "observe"` doesn't enforce denials

---

## 2. The Fix (5 Files)

### 2.1 File 1: `scripts/nexus-main.ts` — `issueDelegation`

**Location**: Lines 253–283
**What changes**: Use requesting user's principalId. Fix capability intersection.

The `issueDelegation` function is called by the coordinator for each plan node.
Currently it receives `(agentId, scope)`. It needs the requesting user's
principalId. The cleanest approach: make it a factory that creates a
per-request closure.

**Current code (BROKEN)**:
```typescript
// 22e. Glue: issueDelegation — ceiling intersection + mintRootDelegation
const issueDelegation = async (agentId: Uuid, _scope: DelegationScope): Promise<Uuid> => {
  try {
    const agent = await coreDeps.actorRegistry.get(agentId);
    if (!agent) throw new Error('Agent not found: ' + agentId);
    const principal = await coreDeps.principalRegistry.get(agent.principalId);
    if (!principal) throw new Error('Principal not found: ' + agent.principalId);
    const dc = await mintRootDelegation(principal, agent, {
      principalId: agent.principalId,
      actorId: agentId,
      allowedSystems: agent.allowedSystems.filter(
        s => principal.allowedSystems.includes('*') || principal.allowedSystems.includes(s)
      ),
      allowedCapabilities: (agent.allowedCapabilities ?? []).filter(
        c => principal.allowedSystems.includes('*') || principal.allowedSystems.includes(c)
        //    ^^^^^^^^^^^^^^^^^ BUG: compares capabilities against SYSTEMS
      ),
      forbiddenCapabilities: [],
      maxRiskTier: agent.riskCeiling,
      allowDownstreamPropagation: false,
      environment: agent.environment,
      expiresAt: new Date(Date.now() + 3600_000).toISOString() as IsoTimestamp,
      maxChainDepth: orchManifest.maxSplitDepth,
    });
    await coreDeps.delegationStore.save(dc);
    console.log('[orch-wire] delegation issued:', dc.delegationId);
    return dc.delegationId;
  } catch (err) {
    console.error('[orch-wire] delegation failed:', (err as Error).message);
    return crypto.randomUUID() as Uuid;
  }
};
```

**New code (FIXED)**:
```typescript
// 22e. Factory: makeIssueDelegation — creates a per-request delegation issuer
// that closes over the requesting user's principalId.
// Delegation scope = LESSER of agent's ceiling and principal's ceiling.
// Blueprint §12.1: principal owns the ACTION, not the agent.
// Blueprint §17.3: delegation cannot exceed principal's authority.
const makeIssueDelegation = (requestingPrincipalId: Uuid) => {
  return async (agentId: Uuid, _scope: DelegationScope): Promise<Uuid> => {
    try {
      const agent = await coreDeps.actorRegistry.get(agentId);
      if (!agent) throw new Error('Agent not found: ' + agentId);

      // Look up the REQUESTING USER's principal — not the agent's registrar
      const principal = await coreDeps.principalRegistry.get(requestingPrincipalId);
      if (!principal) throw new Error('Principal not found: ' + requestingPrincipalId);

      // Delegation scope = lesser of agent ceiling and principal ceiling
      // Systems: intersection of agent's and principal's allowed systems
      const effectiveSystems = agent.allowedSystems.filter(
        s => principal.allowedSystems.includes('*') || principal.allowedSystems.includes(s)
      );

      // Capabilities: agent's capabilities (Principal doesn't have a
      // capabilities field — capability scoping happens through OCT ceiling
      // at Gate 03 and risk tier comparison below)
      const effectiveCapabilities = agent.allowedCapabilities ?? [];

      // Risk: lesser of agent's ceiling and principal's max delegable tier
      const effectiveRiskTier = riskTierExceeds(agent.riskCeiling, principal.maxDelegableRiskTier)
        ? principal.maxDelegableRiskTier
        : agent.riskCeiling;

      const dc = await mintRootDelegation(principal, agent, {
        principalId: requestingPrincipalId,
        actorId: agentId,
        allowedSystems: effectiveSystems,
        allowedCapabilities: effectiveCapabilities,
        forbiddenCapabilities: [],
        maxRiskTier: effectiveRiskTier,
        allowDownstreamPropagation: false,
        environment: agent.environment,
        expiresAt: new Date(Date.now() + 3600_000).toISOString() as IsoTimestamp,
        maxChainDepth: orchManifest.maxSplitDepth,
      });
      await coreDeps.delegationStore.save(dc);
      console.log('[orch-wire] delegation issued:', dc.delegationId,
        'principal:', requestingPrincipalId, 'agent:', agentId);
      return dc.delegationId;
    } catch (err) {
      console.error('[orch-wire] delegation failed:', (err as Error).message);
      return crypto.randomUUID() as Uuid;
    }
  };
};
```

**Then update `buildPlannerRequest` and coordinator assembly** (same file):

Where the coordinator is assembled (~line 308), change from passing a single
`issueDelegation` to creating a per-request one. The coordinator's
`orchestrateRun` method receives the `WorkspaceRunRequest` which has
`principalId`. The `issueDelegation` dep on `RunCoordinatorDeps` needs to
be set per-run.

Find the `dispatchToOrchestrator` function (the one returned in the deps
object) — it calls `coordinator.orchestrateRun(request)`. Before that call,
create the delegation issuer:

```typescript
// In the dispatchToOrchestrator function:
const dispatchToOrchestrator = async (request: WorkspaceRunRequest) => {
  const issueDelegation = makeIssueDelegation(request.principalId);
  return coordinator.orchestrateRun(request, {
    // ... existing deps ...
    issueDelegation,
    // ... rest of deps ...
  });
};
```

**NOTE**: The exact wiring depends on how `coordinator.orchestrateRun` receives
its deps. Check `run-coordinator.ts` — if `issueDelegation` is a constructor
dep, you'll need to either make it settable per-run or pass it differently.
Read the code before wiring.

---

### 2.2 File 2: `scripts/nexus-main.ts` — `dispatchToGovernance`

**Location**: Lines 192–251
**What changes**: Use requesting user's principalId on AgentAction. Create
real session. Wire real session store to IdentityGate.

**Current code (BROKEN)**:
```typescript
const action = {
  // ...
  actorId: node.agentId,
  principalId: orchManifest.orchestratorActorId,  // WRONG: orchestrator's ID
  sessionId: crypto.randomUUID() as Uuid,          // WRONG: fake session
  delegationId,
  // ...
};
```

**Problem 1**: `principalId` is set to the orchestrator actor ID. Should be
the requesting user's principalId.

**Problem 2**: `sessionId` is a random UUID that doesn't exist in the session
store. Gate 01 calls `sessionStore.get(action.sessionId)` → null →
SESSION_NOT_FOUND.

**Problem 3** (line 160-161): IdentityGate is constructed with a stub session
store: `{ get: async () => null, create: async () => {} } as any`. Even if
we create real sessions, the gate can't find them.

**Fix**:

Step A — Wire real session store to IdentityGate (line 159-165):
```typescript
// BEFORE (stub):
identity: new IdentityGate(
  coreDeps.actorRegistry,
  { get: async () => null, create: async () => {} } as any,
  coreDeps.principalRegistry,
  coreDeps.delegationStore,
  pipelineIdp
),

// AFTER (real):
identity: new IdentityGate(
  coreDeps.actorRegistry,
  coreDeps.sessionStore,
  coreDeps.principalRegistry,
  coreDeps.delegationStore,
  pipelineIdp
),
```

Verify `coreDeps.sessionStore` exists and implements `SessionStoreInterface`
(needs `get(sessionId)` and `create(session)`). Check `nexus-bootstrap.ts`
for where it's constructed.

Step B — `dispatchToGovernance` must close over the requesting user's
principalId and create real sessions. Make it a factory like issueDelegation:

```typescript
const makeDispatchToGovernance = (requestingPrincipalId: Uuid) => {
  return async (
    node: PlanNode,
    delegationId: Uuid
  ): Promise<NodeDispatchResult> => {
    try {
      // Create a real session for this agent under the requesting user
      const session: Session = {
        sessionId: newUuid(),
        actorId: node.agentId,
        principalId: requestingPrincipalId,
        delegationId,
        createdAt: nowIso(),
        expiresAt: addSeconds(nowIso(), 3600),
      };
      await coreDeps.sessionStore.create(session);

      const action = {
        actionId: crypto.randomUUID() as Uuid,
        runId: node.nodeId,
        receivedAt: nowIso(),
        protocol: 'nexus-orch/v1.0.0' as NonEmpty,
        adapterVersion: '1.0.0' as NonEmpty,
        actorId: node.agentId,
        principalId: requestingPrincipalId,   // FIXED: requesting user
        sessionId: session.sessionId,          // FIXED: real session
        delegationId,
        delegationSequence: 0,
        tool: node.taskSummary,
        rawVerb: node.taskSummary,
        rawTarget: node.taskSummary,
        rawPayload: null,
        intent: {
          objectiveSummary: node.taskSummary,
          triggeringSource: 'orchestrator' as NonEmpty,
          toolchainContext: 'nexus-orch' as NonEmpty,
          modelId: null,
          modelConfidence: null,
          riskNote: null,
          extractedAt: nowIso(),
        },
        resolvedVerb: null,
        resolvedCapability: null,
        resolvedTarget: null,
        resolvedDataClasses: [],
        resolvedRiskTier: null,
      };

      // Context starts empty — Gate 01 populates actor, principal, delegation
      const ctx = {
        actor: null,
        principal: null,
        session: null,
        delegationContext: null,
        effectiveCeiling: null,
        identityClaims: null,
        gateResults: [],
        threatLog: [],
        connectorRegistry: new SimpleConnectorRegistry(),
        channelRegistry: new SimpleChannelRegistry(),
        policyFile: null,
      };

      const result = await nxsPipeline.process(action as any, ctx as any);
      const finalOutcome = result.evidenceRecord.finalOutcome;
      const denied = finalOutcome === 'deny';
      return {
        success: !denied,
        completionMetadata: denied ? null : { pipelineOutcome: finalOutcome },
        failureReason: denied ? ('governance_denied' as NonEmpty) : null,
        governanceDenied: denied,
      };
    } catch (err) {
      return {
        success: false,
        completionMetadata: null,
        failureReason: ('pipeline_error: ' + (err as Error).message) as NonEmpty,
        governanceDenied: false,
      };
    }
  };
};
```

Then wire `makeDispatchToGovernance` into `dispatchToOrchestrator` the same
way as `makeIssueDelegation`:

```typescript
const dispatchToOrchestrator = async (request: WorkspaceRunRequest) => {
  const issueDelegation = makeIssueDelegation(request.principalId);
  const dispatchToGovernance = makeDispatchToGovernance(request.principalId);
  return coordinator.orchestrateRun(request, {
    // ... deps with per-request issueDelegation and dispatchToGovernance ...
  });
};
```

---

### 2.3 File 3: `packages/core/src/gates/01-identity.gate.ts`

**Location**: Lines 88–93
**What changes**: For non-human agents, allow the action's principalId to
differ from actor.principalId. The delegation's principalId (already checked
on line 148) is the authoritative binding for agents.

**Current code (BROKEN for agents)**:
```typescript
const principal = await this.principalRegistry.get(action.principalId);
if (!principal)
  return gateDeny(DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE, 'principal not resolvable', startMs);
if (actor.principalId !== principal.principalId) {
  return gateDeny(DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH, 'actor/principal mismatch', startMs);
}
```

**New code (FIXED)**:
```typescript
const principal = await this.principalRegistry.get(action.principalId);
if (!principal)
  return gateDeny(DENIAL_CODE.PRINCIPAL_NOT_RESOLVABLE, 'principal not resolvable', startMs);

// For HUMAN/HUMAN_WITH_COPILOT: strict match — actor IS the principal.
// For agent actors: actor.principalId is the registering admin (audit trail).
// The runtime principal is the requesting user, validated via delegation
// binding on line 148 (delegation.principalId === action.principalId).
const isHuman =
  actor.actorClass === ACTOR_CLASS.HUMAN || actor.actorClass === ACTOR_CLASS.HUMAN_WITH_COPILOT;
if (isHuman && actor.principalId !== principal.principalId) {
  return gateDeny(DENIAL_CODE.ACTOR_PRINCIPAL_MISMATCH, 'actor/principal mismatch', startMs);
}
```

**Why this is safe**: The delegation binding check (line 148:
`delegationContext.principalId !== action.principalId`) still runs for ALL
actors. An agent can only act under a principal if a valid delegation was
minted for that principal+agent pair. The delegation minting enforces scope
ceilings. No authority escalation is possible.

---

### 2.4 File 4: `packages/interfaces/api/src/routes/sessions.ts`

**Location**: Lines 43–48
**What changes**: For non-human agents, allow delegation.principalId to
differ from actor.principalId when creating sessions.

**Current code (BROKEN for agents)**:
```typescript
if (actor.principalId !== delegation.principalId) {
  res
    .status(400)
    .json({ ok: false, error: 'actor.principalId does not match delegation.principalId' });
  return;
}
```

**New code (FIXED)**:
```typescript
// For human actors: strict match — they can only create sessions under their
// own principal. For agents: the delegation carries the requesting user's
// principal, which won't match the agent's registrar principal. That's correct.
const isHuman =
  actor.actorClass === 'HUMAN' || actor.actorClass === 'HUMAN_WITH_COPILOT';
if (isHuman && actor.principalId !== delegation.principalId) {
  res
    .status(400)
    .json({ ok: false, error: 'actor.principalId does not match delegation.principalId' });
  return;
}
```

Also fix line 59 — session.principalId should come from the delegation
(the runtime authority), not the actor record:
```typescript
// BEFORE:
principalId: actor.principalId,

// AFTER:
principalId: delegation.principalId,
```

You will need to import `ACTOR_CLASS` from `@nexus/contracts`:
```typescript
import { ACTOR_CLASS, nowIso, newUuid, addSeconds } from '@nexus/contracts';
```

---

### 2.5 File 5: `packages/interfaces/cli/src/commands/session.ts`

**Location**: Lines 35–36, 44
**What changes**: Same relaxation as sessions.ts route.

**Current code**:
```typescript
if (delegation.principalId !== actor.principalId) {
  console.error(`✗ delegation.principalId does not match actor.principalId`);
  // ...
}
// ...
principalId: actor.principalId,
```

**New code**:
```typescript
const isHuman =
  actor.actorClass === 'HUMAN' || actor.actorClass === 'HUMAN_WITH_COPILOT';
if (isHuman && delegation.principalId !== actor.principalId) {
  console.error(`✗ delegation.principalId does not match actor.principalId`);
  // ...
}
// ...
principalId: delegation.principalId,
```

Import `ACTOR_CLASS` if not already imported.

---

## 3. Agent Registration — principalId Field

With this fix, `principalId` on the Actor record means "the admin who
registered this agent" — an audit trail, NOT the runtime authority.

### Agent panel form change

The principalId field in the agent registration form should be:
- **Auto-set** to the logged-in admin's principalId (from the elevated session)
- **Read-only** or hidden — not a dropdown of "who this agent works for"
- **Label**: "Registered by" (not "Principal / Human Handler")

The Actor interface in contracts (`principalId: Uuid`) stays REQUIRED — every
actor must have a principalId. For agents, it's the registrar. For humans,
it's themselves.

---

## 4. Downstream Effects — Verification Checklist

Every downstream consumer of principalId traced and accounted for:

| File | Check | Status after fix |
|---|---|---|
| `nexus-main.ts` issueDelegation | Uses requesting user | ✅ Fixed (§2.1) |
| `nexus-main.ts` dispatchToGovernance | Uses requesting user, real session | ✅ Fixed (§2.2) |
| `01-identity.gate.ts` line 91 | actor.principalId check | ✅ Relaxed for agents (§2.3) |
| `01-identity.gate.ts` line 127 | session.principalId === action.principalId | ✅ Works (session created with delegation.principalId) |
| `01-identity.gate.ts` line 148 | delegation.principalId === action.principalId | ✅ Works (delegation minted with requesting user) |
| `sessions.ts` line 43 | actor.principalId === delegation.principalId | ✅ Relaxed for agents (§2.4) |
| `sessions.ts` line 59 | session.principalId source | ✅ Fixed to use delegation.principalId (§2.4) |
| `cli/session.ts` line 35 | Same check as sessions.ts | ✅ Relaxed for agents (§2.5) |
| `cli/session.ts` line 44 | session.principalId source | ✅ Fixed to use delegation.principalId (§2.5) |
| `identity-provider.ts` line 36 | Resolves principal for identity claims | ⚠️ See note below |
| `registry-identity-provider.ts` line 42 | Same as above | ⚠️ See note below |
| `actor-registry.ts` lines 103, 138 | SQLite read/write | ✅ No change needed |
| `nexus-bootstrap.ts` line 980 | Bootstrap identity wiring | ✅ No change needed |

### Note on identity-provider.ts / registry-identity-provider.ts

These resolve identity claims for an actor by looking up
`actor.principalId`. For agents, this returns the REGISTRAR's principal
info. The identity claims resolution (Gate 01 line 165) uses
`actor.actorId` not `actor.principalId`, so this is not in the critical
path for the delegation fix. However, if agent-specific identity claims
need the requesting user's info, this will need a future update.

---

## 5. Capability Intersection Rule — "Lesser Of"

**Rule**: Delegation scope = lesser of agent's ceiling and principal's ceiling.

| Dimension | Agent ceiling | Principal ceiling | Delegation gets |
|---|---|---|---|
| Systems | `allowedSystems` | `principal.allowedSystems` | Intersection |
| Risk tier | `riskCeiling` | `principal.maxDelegableRiskTier` | Lesser (lower tier) |
| Capabilities | `allowedCapabilities` | (none on Principal — future) | Agent's capabilities |

Principal interface currently has no `allowedCapabilities` field. The agent's
capabilities pass through to delegation. Capability scoping is enforced by:
1. Gate 03 checks delegation.allowedCapabilities against resolved action capability
2. OCT ceiling limits what model tiers (and thus what capability classes) are available
3. Risk tier comparison limits what risk level of capabilities are permitted

**Future**: If owner wants per-principal capability restrictions (e.g., interns
can only delegate read capabilities), add `allowedCapabilities?: string[]` to
the Principal interface. This is NOT in scope for this fix.

---

## 6. Wiring Note — RunCoordinator Deps

The `RefRunCoordinator` receives its deps at construction time (line 308).
The `issueDelegation` and `dispatchToGovernance` functions are constructor
deps. To make them per-request, you have two options:

**Option A (preferred)**: Create the coordinator per-request inside
`dispatchToOrchestrator`. This is clean but creates a new coordinator
per run.

**Option B**: Change `RefRunCoordinator` to accept `issueDelegation` and
`dispatchToGovernance` as parameters to `orchestrateRun()` instead of
constructor deps. This requires modifying `run-coordinator.ts`.

Read `run-coordinator.ts` to determine which is less invasive. The
coordinator is stateful (it has `activeRuns` map), so Option B is probably
better — keep one coordinator, pass per-request functions at call time.

---

## 7. Test Plan

### 7.1 Seed test users (add to bootstrap, ~line 1082)

Add 2 bounded test users after the existing dev-admin + default-agent seeding:

```typescript
// ── Bounded test users for delegation testing ──
const TEST_PRINCIPAL_1 = '00000000-0000-4000-a000-000000000010' as Uuid;
const TEST_ACTOR_1 = '00000000-0000-4000-a000-000000000011' as Uuid;
if (!(await coreDeps.principalRegistry.get(TEST_PRINCIPAL_1))) {
  await coreDeps.principalRegistry.register({
    principalId: TEST_PRINCIPAL_1,
    displayName: 'test-analyst' as NonEmpty,
    email: 'analyst@nexus.local' as NonEmpty,
    registeredAt: now,
    maxDelegableRiskTier: 'medium',
    allowedSystems: ['stub'],
  });
}
if (!(await coreDeps.actorRegistry.get(TEST_ACTOR_1))) {
  await coreDeps.actorRegistry.register({
    actorId: TEST_ACTOR_1,
    actorClass: 'HUMAN',
    principalId: TEST_PRINCIPAL_1,
    displayName: 'test-analyst' as NonEmpty,
    environment: 'reference',
    octLevel: 'OCT-OPEN',
    riskCeiling: 'medium',
    allowedSystems: ['stub'],
    allowedCapabilities: ['read:record:single', 'search:data', 'synthesize:content'],
    enabled: true,
    registeredAt: now,
    owner: 'system' as NonEmpty,
    purpose: 'Bounded test user for delegation testing' as NonEmpty,
    reviewCadence: 'quarterly' as NonEmpty,
  } as Actor);
}

const TEST_PRINCIPAL_2 = '00000000-0000-4000-a000-000000000020' as Uuid;
const TEST_ACTOR_2 = '00000000-0000-4000-a000-000000000021' as Uuid;
if (!(await coreDeps.principalRegistry.get(TEST_PRINCIPAL_2))) {
  await coreDeps.principalRegistry.register({
    principalId: TEST_PRINCIPAL_2,
    displayName: 'test-intern' as NonEmpty,
    email: 'intern@nexus.local' as NonEmpty,
    registeredAt: now,
    maxDelegableRiskTier: 'low',
    allowedSystems: ['stub'],
  });
}
if (!(await coreDeps.actorRegistry.get(TEST_ACTOR_2))) {
  await coreDeps.actorRegistry.register({
    actorId: TEST_ACTOR_2,
    actorClass: 'HUMAN',
    principalId: TEST_PRINCIPAL_2,
    displayName: 'test-intern' as NonEmpty,
    environment: 'reference',
    octLevel: 'OCT-OPEN',
    riskCeiling: 'low',
    allowedSystems: ['stub'],
    allowedCapabilities: ['read:record:single'],
    enabled: true,
    registeredAt: now,
    owner: 'system' as NonEmpty,
    purpose: 'Low-privilege test user for ceiling intersection testing' as NonEmpty,
    reviewCadence: 'quarterly' as NonEmpty,
  } as Actor);
}
```

### 7.2 Verification steps

1. **Server boots**: `pnpm tsx scripts/nexus-main.ts serve` — no errors
2. **ci:gate**: All 79 gates pass
3. **Register agent via admin panel**: Create "math-worker" agent
   (SUPERVISED_AGENT, OCT-OPEN, medium risk, systems: ['stub'],
   capabilities: ['read:record:single', 'synthesize:content'])
4. **Login as dev-admin**: Agent appears in workspace dropdown
5. **Send prompt**: "What is 7 + 5?" with math-worker selected
6. **Check server logs for**:
   - `[orch-wire] delegation issued: <id> principal: 00000000-...-000000000001 agent: <agent-id>`
   - Delegation minted with dev-admin's principalId, NOT the agent's registrar
7. **Check observe-mode gate results**: Gate 01 should PASS (not deny)
   for identity checks
8. **Switch to enforce** (change mode-config.json `nxsMode: "enforce"`):
   repeat test — should still work

### 7.3 Ceiling intersection test

1. Register an agent with `riskCeiling: 'critical'`
2. Login as test-intern (maxDelegableRiskTier: 'low')
3. Send prompt with that agent
4. Delegation should be minted with `maxRiskTier: 'low'` (the lesser)
5. If agent attempts a high-risk action, Gate 03 blocks it

---

## 8. Files Summary

| File | Lines changed | Type |
|---|---|---|
| `scripts/nexus-main.ts` | ~60 lines (issueDelegation + dispatchToGovernance refactor) | Architecture fix |
| `packages/core/src/gates/01-identity.gate.ts` | ~6 lines (agent check relaxation) | Gate logic |
| `packages/interfaces/api/src/routes/sessions.ts` | ~8 lines (agent check relaxation + principalId source) | API route |
| `packages/interfaces/cli/src/commands/session.ts` | ~6 lines (same as sessions.ts) | CLI |
| `scripts/nexus-bootstrap.ts` | ~50 lines (test user seeding) | Test data |

**Total**: ~130 lines across 5 files. Not 20.

---

## 9. What This Does NOT Change

- Actor interface in contracts — `principalId: Uuid` stays required
- Gate 03 delegation scope checks — unchanged, already correct
- Gate 04–07 — unchanged
- NVG routing — unchanged
- Workspace auth / JWT chain — unchanged
- Admin panel writer routes — unchanged
- Agent registration API — unchanged (principalId still accepted,
  means "registered by")

---

## 10. Definition of Done

- [ ] `issueDelegation` uses requesting user's principalId
- [ ] `dispatchToGovernance` creates real session with correct principalId
- [ ] Gate 01 passes for agents under different principals
- [ ] Session creation works for agents under different principals
- [ ] Capability intersection uses correct namespaces (no systems-vs-caps bug)
- [ ] Risk tier uses lesser of agent and principal ceiling
- [ ] Test users seeded in bootstrap
- [ ] ci:gate 79/79 GREEN
- [ ] Server boots and agent run dispatches with correct principal in logs
