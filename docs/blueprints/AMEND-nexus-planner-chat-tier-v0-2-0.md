# Amendment — Planner Chat Tier V1 (Branch 0 pre-lexicon dispatch)
# Version: v0.2.0 (post solo-audit-pass-1 revision; supersedes v0.1.0)
# Date: 2026-05-15
# Status: RATIFIED — Phase D Commit 1 of 5 begins 2026-05-15.
# Supersedes: docs/blueprints/AMEND-nexus-planner-chat-tier-v0-1-0.md
# Amends:
#   AMEND-nexus-planner-db-lexicon-v0-2-1.md §3.3 — adds Branch 0 BEFORE Branch 1 (oct_secure) in tier-dispatch
#   AMEND-nexus-admin-dashboard-full-buildout-v0-1-0.md §3.4 — widens admin workspace panel's entryMode from locked literal to 2-value dropdown
#   AMEND-nexus-blueprint-orch-v1-1-1.md (parent orch) — `PromptVisibilityTier` widens by one value
# References:
#   memory/project_compile_passthrough.md (single-agent + no-contract = pass-through; chat consumes this)
#   memory/feedback_llm_governance_model.md (LLMs receive toolDescriptors: [] — chat is no exception)
#   memory/project_mailbox_pit_architecture.md (per-actor mailbox still law for chat)
#   memory/feedback_nexus_architecture_layers.md (auth + audit + mode signing still apply to chat)
#   packages/core/src/compile/deterministic-renderer.ts:338-396 (existing pass-through implementation)
#   packages/contracts/src/externals/planner.ts:25 (PromptVisibilityTier source)
#   packages/contracts/src/externals/manifests.ts:66 (WorkspaceManifestRecord.entryMode source)
#   packages/workspace-ref/src/client/components/admin/panels/workspace-setup-panel.tsx:1-205 (current entryMode lock site)
# Author: Claude (deterministic build agent), under owner direction
# Owner: James Huson / Lake Area LLC
# HEAD pin at draft time: d68b775

---

## §0 Canonical Law Alignment

### §0.1 Why this amendment exists

(Unchanged from v0.1.0.)

Lexicon V1 has four branches (oct_secure, pre-resolved subTasks,
preferred-agents preflight, lexical decomposition). There is no branch
for prompts targeting no NXS-connected system — pure conversational
prompts. Today they hit Branch 4, find no intent, and reject as
`unmappable_request`. This amendment adds **Branch 0** for tier
`'chat'`, anchored on `workspace.entryMode === 'free_chat'`.

### §0.2 Two-axis architecture clarification

(Unchanged from v0.1.0.)

- **Axis A — "Only some of the prompt hits the LLM" (governed-mixed):**
  Handled by Branch 4 today.
- **Axis B — "Prompts that target no NXS system at all" (chat):**
  Gap closed by this amendment.

### §0.3 What this amendment does NOT change

(Unchanged from v0.1.0.)

LLMs never see tool descriptors. Per-actor mailbox-pit. Auth chain.
Audit ledger. Mode signing applies to chat. Lexicon planner remains
the single Planner V1. Output contract library unchanged. Pass-through
compile already shipped. No "bypass Nexus" — chat is governed.

### §0.4 Scope statement (V1 chat-tier — Branch 0 only)

**In scope (V1 chat-tier this amendment ships):**

- New tier value `'chat'` on `PromptVisibilityTier`
- New `ChatPlannerRequest` interface variant
- `WorkspaceManifestRecord.entryMode` widens: `'governed_only' | 'free_chat'`
- New Branch 0 in `db-lexicon-planner.ts` dispatch
- **Symmetric Branch 3 preflight checkback** — Branch 0 returns
  `RejectionCheckbackPayload` with `recommendedSelectedAgentIds` when
  selected agent lacks `synthesize` (revised per audit pass 1 §10.3)
- New `'chat'` value on `PlannerPlanTrace.branch` enum
- Workspace UI: server-side tier derivation from `workspace.entryMode`
- Admin dashboard workspace panel: entryMode 2-value dropdown
- One seeded chat workspace in `config/workspace/workspaces.v1.yaml`
- 2 new ci:gate steps (CHAT-TIER-01, CHAT-TIER-02)
- Unit + integration tests covering Branch 0
- Updates to admin placeholder data

**Sequential follow-on amendments (NOT this amendment — each is its
own v1.x increment, owner-ratified separately):**

- `chat-tier-v1.1` — multi-turn conversation (3–4 commits)
- `chat-tier-v1.2` — chat agent presets (1–2 commits)
- `chat-tier-v1.3` — slash commands (1 commit, optional)
- `chat-tier-v1.4` — chat file attachments (3–5 commits)

**Permanently out of scope (architectural law):**

- LLM direct tool/connector access — banned per
  `feedback_llm_governance_model.md`
- Auto-classification of prompts as chat vs governed — banned per
  don't-drift checklist
- Mode-signing relaxation for chat — chat respects enforcing mode

**Clarified scope (not new feature — uses existing infrastructure):**

- "Chat-with-connectors" / "search the web for X" → **This is Branch
  4 with new target-catalog entries**, NOT a chat-tier feature. Add
  rows to `planner-target-catalog.v1.jsonl` for `web_search`,
  `yahoo_finance`, etc.; the lexicon decomposes the prompt into
  `connector_read (nxs) → llm_summarize (nvg)`. The LLM never holds
  a tool — it receives summarized input from NXS connectors. Buildable
  today as additional planner fixtures; not part of this spec.

### §0.5 Changes from v0.1.0 (solo audit pass 1 ratifications)

| Section | v0.1.0 said | v0.2.0 says | Audit ratification |
|---|---|---|---|
| §3.2 planChatBranch step 3 | No checkback — flat `PlanRejection` on missing synthesize | Returns `RejectionCheckbackPayload` with `recommendedSelectedAgentIds` populated from lexicon's synthesize-capable agent set, mirroring Branch 3 exactly | Audit pass 1 §10.3 — "should be the same workflow as all the other" |
| §8 V2 firmness | 8.1 chat-with-connectors framed as V2 chat amendment | 8.1 reclassified — clarified that "search yahoo finance" type prompts are Branch 4 with new target-catalog entries, NOT a chat-tier feature. Buildable today via existing lexicon. | Audit pass 1 §10.7 — "our job is to solve all of these" |
| §8 V2 firmness | 8.2-8.5 listed as V2 amendments | 8.2-8.5 reclassified as sequential v1.x increments (multi-turn, presets, slash, attachments) — each owner-ratified separately after Branch 0 ships green | Audit pass 1 §10.7 — applied with build-protocol smallest-correct-surface argument |
| §10 owner decisions | 7 open items | 5 of 7 ratified (10.1, 10.2, 10.4, 10.5, 10.6); 10.3 ratified-with-revision (symmetric checkback); 10.7 ratified-with-partial-pushback (v1.x sequence) | Audit pass 1 |

### §0.6 §10 ratification table

| # | Item | v0.1.0 proposed | v0.2.0 ratified |
|---|---|---|---|
| 10.1 | Tier name | `'chat'` | `'chat'` (ratified) |
| 10.2 | EntryMode value name | `'free_chat'` | `'free_chat'` (ratified) |
| 10.3 | Chat agent source | Default + operator override | Default + operator override + **symmetric checkback when preflight fails** (ratified with revision) |
| 10.4 | Enforcing mode applies | YES | YES (ratified) |
| 10.5 | workspaceType string | `'chat_workspace'` | `'chat_workspace'` (ratified) |
| 10.6 | preferredEndpointId | YES, traced not adjudicated | YES, traced not adjudicated (ratified) |
| 10.7 | Out-of-scope firmness | Mixed V2/never | Architectural rejections stay (mode-sign relax, auto-classify, LLM tool access); buildable features become sequential v1.x amendments (multi-turn / presets / slash / attachments); chat-with-connectors clarified as Branch 4 work not chat-tier |

---

## §1 Problem Statement

(Unchanged from v0.1.0 §§1.1–1.3.)

---

## §2 Architecture

(§§2.1–2.5 unchanged from v0.1.0.)

### §2.6 Symmetry with Branch 3 — the checkback pattern (NEW in v0.2.0)

Per audit pass 1 §10.3, Branch 0's preflight failure mode now mirrors
Branch 3 exactly:

| Branch 3 (lexicon V1) | Branch 0 (this amendment) |
|---|---|
| Operator selects `selectedAgentIds` | Operator selects `selectedAgentIds[0]` (cardinality 1) |
| Preflight checks all required caps covered | Preflight checks `synthesize` is in agent.allowedCapabilities |
| FAIL → `PlanRejection { reason: 'no_capable_agent' }` + `RejectionCheckbackPayload` populated with `recommendedSelectedAgentIds` | FAIL → SAME shape — `PlanRejection` + `RejectionCheckbackPayload` with `recommendedSelectedAgentIds` |
| Coordinator writes `plan_checkback_sent` ledger event with payload | Coordinator writes `plan_checkback_sent` ledger event with payload |
| Workspace UI shows `plan-checkback-modal.tsx` | Workspace UI shows the SAME `plan-checkback-modal.tsx` (no new modal) |
| Operator clicks Accept → workspace closes original run, opens new run with `selectedAgentIds = recommendedSelectedAgentIds`, `checkbackSourceRunId = originalRunId` | Operator clicks Accept → SAME flow |
| Operator clicks Cancel → run closes terminal | Operator clicks Cancel → SAME flow |

**No new UI surface for chat-tier checkback.** The existing modal +
reducer + close endpoint built in lexicon V1 Commit 8 carry chat
unchanged.

---

## §3 Surface

(§§3.1, 3.3–3.9 unchanged from v0.1.0.)

### §3.2 planChatBranch implementation (REVISED per §10.3 ratification)

```typescript
private planChatBranch(
  request: ChatPlannerRequest,
  context: PlannerContext
): { result: ExecutionPlan | PlanRejection; trace: PlannerPlanTrace } {

  const promptDigest = sha256Hex(request.prompt);

  // 1. Selection cardinality
  if (request.selectedAgentIds.length !== 1) {
    return this.buildRejectionWithTrace(
      'malformed_request',
      `chat tier requires exactly one selectedAgentId; received ${request.selectedAgentIds.length}`,
      [],
      request,
      null,
      promptDigest
    );
  }

  const agentId = request.selectedAgentIds[0];

  // 2. Agent existence
  const agent = context.registry.getById(agentId);
  if (!agent) {
    // No checkback — operator's selection was a non-existent ID; this
    // is a UI staleness bug, not a feasibility issue
    return this.buildRejectionWithTrace(
      'no_capable_agent',
      `chat tier selected agent ${agentId} not found in registry`,
      ['synthesize'],
      request,
      null,
      promptDigest
    );
  }

  // 3. Capability preflight — synthesize required; if missing, SYMMETRIC
  //    Branch-3-style checkback fires (REVISED per audit pass 1 §10.3)
  if (!agent.allowedCapabilities.includes('synthesize')) {
    // Find synthesize-capable alternatives within capability ceiling
    const synthesizeCapableAgents = context.registry
      .findByCapability('synthesize')
      .filter(a => context.capabilityCeiling.includes('synthesize'))
      .filter(a => a.actorId !== agent.actorId);

    const checkback: RejectionCheckbackPayload = {
      reason: 'no_capable_agent',
      reasonDetail:
        `chat tier requires agent with synthesize capability; ` +
        `agent ${agent.actorId} (${agent.displayName}) allowedCapabilities: ` +
        `[${agent.allowedCapabilities.join(', ')}]`,
      missingCapabilities: ['synthesize'],
      rejectedSelectedAgentIds: [agent.actorId],
      recommendedSelectedAgentIds: synthesizeCapableAgents.length > 0
        ? [synthesizeCapableAgents[0].actorId]  // pick first; UI lists rest as alternatives
        : [],
      alternativesByCapability: {
        synthesize: synthesizeCapableAgents.map(a => ({
          agentId: a.actorId,
          capability: 'synthesize',
          reason: `${a.displayName} has synthesize in allowedCapabilities`,
        })),
      },
    };

    return this.buildRejectionWithTrace(
      'no_capable_agent',
      checkback.reasonDetail,
      ['synthesize'],
      request,
      checkback,  // ← non-null; coordinator picks up via getLastRejectionCheckback()
      promptDigest
    );
  }

  // 4. Capability ceiling check (synthesize must be allowed at workspace level)
  if (!context.capabilityCeiling.includes('synthesize')) {
    return this.buildRejectionWithTrace(
      'capability_outside_ceiling',
      `chat tier requires 'synthesize' but it is not in workspace capability ceiling`,
      ['synthesize'],
      request,
      null,  // ceiling problems aren't fixable by operator; no checkback
      promptDigest
    );
  }

  // 5. Single-node plan via plan-assembly helper
  const plan = buildChatPlan({
    runId: request.runId,
    workspaceId: request.workspaceId,
    agentId: agent.actorId,
    prompt: request.prompt,
    promptDigest,
  });

  // 6. Trace (unchanged from v0.1.0)
  const trace: PlannerPlanTrace = {
    runId: request.runId,
    plannerType: 'db-lexicon-transformer-v0',
    plannerVersion: '0.1.0',
    promptDigest,
    branch: 'chat',
    operatorPreference: {
      selectedAgentIds: [agent.actorId],
      preferredEndpointId: request.preferredEndpointId ?? null,
    },
    preflightOutcome: 'preferred_agents_satisfy',  // mirror Branch 3's success literal
    lexicalMatches: [],
    candidateIntents: [],
    selectedIntent: null,
    candidateTemplates: [],
    selectedTemplate: null,
    requiredCapabilities: ['synthesize'],
    candidateAgents: [{ capability: 'synthesize', agentIds: [agent.actorId] }],
    planOutcome: 'plan_created',
    rejectionReason: null,
    rejectionDetail: null,
    emittedAt: new Date().toISOString(),
  };

  return { result: plan, trace };
}
```

### §3.10 What gets reused from Branch 3 (NEW in v0.2.0)

Per §10.3 ratification, Branch 0 reuses the entire Branch 3 checkback
machinery already shipped in lexicon V1 Commit 8:

- `RejectionCheckbackPayload` interface — no new type
- `OrchestratorPlanPreview.rejection` field — no new field
- `plan-checkback-modal.tsx` — same modal renders for chat
- `closeRun(runId, reason)` endpoint — same endpoint
- `run-stage-reducer.extractPendingPlannerCheckback` — same reducer
- `WorkspaceRunRequest.checkbackSourceRunId` — same field
- Accept-Suggestions flow — same
- Cancel-Run flow — same

**This is why §10.3 ratification matters:** symmetric checkback turns
chat-tier's "preflight UX" surface from "build new modal + new
reducer + new close endpoint" to "extend trace shape, point existing
modal at chat-tier preview, done."

---

## §4 Lifecycle

(Unchanged from v0.1.0.)

---

## §5 Worked examples

### §5.1 Chat happy path (unchanged from v0.1.0 §5.1)

### §5.2 Chat reject + counter-suggest (REVISED per §10.3)

**Input:** Workspace `nexus-chat-default`, operator picks
`SALES_AGENT_ACTOR_ID` (no synthesize).

```json
{ "workspaceId": "nexus-chat-default", "prompt": "Hello",
  "selectedAgentIds": ["SALES_AGENT_ACTOR_ID"] }
```

**Branch 0:**
1. cardinality === 1 ✓
2. SALES_AGENT exists ✓
3. SALES_AGENT.allowedCapabilities = ['read:record:single', 'query:data']
   — no 'synthesize' ✗
4. Find synthesize-capable alternatives: [CHAT_AGENT_ACTOR_ID,
   FRONTIER_AGENT_ACTOR_ID]
5. Build `RejectionCheckbackPayload`:
   ```typescript
   {
     reason: 'no_capable_agent',
     reasonDetail: 'chat tier requires agent with synthesize capability; agent SALES_AGENT_ACTOR_ID (Sales Agent) allowedCapabilities: [read:record:single, query:data]',
     missingCapabilities: ['synthesize'],
     rejectedSelectedAgentIds: [SALES_AGENT_ACTOR_ID],
     recommendedSelectedAgentIds: [CHAT_AGENT_ACTOR_ID],
     alternativesByCapability: {
       synthesize: [
         { agentId: CHAT_AGENT_ACTOR_ID, capability: 'synthesize', reason: 'Default Chat Agent has synthesize in allowedCapabilities' },
         { agentId: FRONTIER_AGENT_ACTOR_ID, capability: 'synthesize', reason: 'Frontier Claude Agent has synthesize in allowedCapabilities' },
       ],
     },
   }
   ```
6. Trace `branch: 'chat'`, `preflightOutcome: 'preferred_agents_insufficient_alternatives_suggested'`, `planOutcome: 'plan_rejected_no_capable_agent'`

**Coordinator + UI (identical to Branch 3 flow):**
1. Coordinator writes `plan_rejected` + `planner_plan_trace` + `plan_checkback_sent`
2. Returns `OrchestratorPlanPreview { plan: null, rejection: <checkback>, ... }`
3. Workspace UI sees `rejection != null` → opens `plan-checkback-modal.tsx`
4. Operator clicks **Accept Suggestions**:
   - Close original run reason `user_accepted_checkback_reissued`
   - Open new run `selectedAgentIds: [CHAT_AGENT_ACTOR_ID]`, `checkbackSourceRunId: <originalRunId>`
   - New run hits Branch 0 → preflight passes → chat plan emits → run completes
5. Or operator clicks **Cancel Run** → close terminal

Zero new UI surface. Modal + reducer + close endpoint all reused from
lexicon V1 Commit 8.

### §5.3 Chat coexists with governed runs on different workspaces

(Unchanged from v0.1.0 §5.3.)

---

## §6 Migration & Coexistence

### §6.1 5-commit migration sequence (revised commit boundaries)

Per audit pass 1 §10.3 ratification, the workspace UI surface
**shrinks** because Branch 0 reuses the existing `plan-checkback-modal.tsx`.

**Commit 1 — Spec lands + contract additions.**

(Unchanged from v0.1.0 §6.1 Commit 1 except: spec v0.2.0 lands and
v0.1.0 is deleted as superseded.)

- This file (v0.2.0) lands; v0.1.0 deleted
- Contracts updated: `PromptVisibilityTier`, `ChatPlannerRequest`,
  `PlannerRequest` union, `PlannerPlanTrace.branch`,
  `WorkspaceManifestRecord.entryMode`
- Unit tests for new contract types
- Logs: `ADD-CHAT-TIER-001`, `-002`, `-003`

**Commit 2 — Planner Branch 0 + plan-assembly helper + symmetric checkback.**

- `buildChatPlan` in `packages/orch-ref/src/plan-assembly.ts`
- `planChatBranch` in `db-lexicon-planner.ts` (per §3.2 revised)
- Branch 0 inserted at top of `dispatch()`
- Unit tests (revised set, now 11 cases including checkback shape):
  - CHAT-01..09 from v0.1.0
  - **CHAT-10 (NEW): agent missing synthesize → checkback payload
    populated with all synthesize-capable alternatives**
  - **CHAT-11 (NEW): checkback `recommendedSelectedAgentIds` is empty
    when no synthesize-capable agent exists in registry**
- Logs: `ADD-CHAT-TIER-004`

**Commit 3 — Workspace manifest loader + run-creation route.**

(Unchanged from v0.1.0 §6.1 Commit 3.)

**Commit 4 — Admin dashboard panel unlock + manifest seed.**

(Unchanged from v0.1.0 §6.1 Commit 4.)

**Commit 5 — Workspace UI minimal wiring + integration test + ci:gate.**

(Shrunk vs v0.1.0 — no new modal needed.)

- `run-display.tsx` + `run-stage-reducer.ts` extended to detect chat
  tier in preview (no new component — chat uses the same
  `plan-checkback-modal.tsx` on rejection paths, the existing
  pass-through compile rendering on success paths)
- Integration test `db-lexicon-chat.integration.test.ts`:
  - CHAT-INT-01: chat happy path
  - CHAT-INT-02: stale UI tier value → server overrides
  - **CHAT-INT-03 (REVISED): chat rejection with checkback → modal
    fires → Accept-Suggestions → new run completes — uses the same
    flow lexicon V1 Commit 8 built for Branch 3**
- 2 new ci:gate steps: `CHAT-TIER-01`, `CHAT-TIER-02`
- Logs: `ADD-CHAT-TIER-008`, `ADD-CHAT-TIER-009`

ci:gate boundary count: 87 → 89.

### §6.2 Backward compatibility, §6.3 No hidden fallback, §6.4 Parent spec amendments

(Unchanged from v0.1.0.)

---

## §7 What stays unchanged

(Unchanged from v0.1.0 §7.)

---

## §8 Out of scope — REORGANIZED per §10.7 ratification

### §8.A Permanently rejected (architectural law)

- **8.6 Mode-signing relaxation for chat** — chat respects enforcing
  mode. Enforcing mode = approval required. No exceptions.
- **8.7 Auto-classification of prompts** — workspace.entryMode is the
  signed source of truth. No prompt-content sniffing.
- **LLM direct tool/connector access** — per
  `feedback_llm_governance_model.md`, LLMs receive `toolDescriptors: []`.
  This includes chat. NXS does CRUD, LLM only synthesizes.

### §8.B Sequential v1.x amendments (firm near-term arcs, owner-ratified each)

Each amendment will follow this spec's audit-and-revise loop pattern,
land as its own commit-sequence, maintain ci:gate green at every
boundary.

- **chat-tier-v1.1 — Multi-turn conversation.**
  Scope: thread/session contract, `threadId` field on chat requests,
  history retrieval at plan time, UI thread view.
  Estimated: 3–4 commits.
  Owner ratification BEFORE start.

- **chat-tier-v1.2 — Chat agent presets.**
  Scope: `workspace.configuration.chatPresets[]` with
  `{ presetId, systemPromptPrefix, defaultAgentId }`. Admin manages.
  Workspace UI offers preset dropdown.
  Estimated: 1–2 commits.

- **chat-tier-v1.3 — Slash commands (OPTIONAL — owner may skip).**
  Scope: `/code`, `/analyze`, etc. UI sugar that maps to a chat-preset
  selection. Only meaningful if v1.2 lands first.
  Estimated: 1 commit. Pending §10.4 ratification — owner may decide
  the workspace-routing answer is sufficient and skip this entirely.

- **chat-tier-v1.4 — Chat file attachments.**
  Scope: `capabilities.fileSpace: true` on free_chat workspaces; file
  upload UI; mailbox extension for binary attachments; LLM-side
  attachment passing (model-specific — different paths for Anthropic
  Files API vs Ollama base64 vs OpenAI).
  Estimated: 3–5 commits.

### §8.C Clarified — buildable today, not chat-tier work

- **Chat-with-connectors / "search yahoo finance":** This is
  Branch 4 with new entries in `planner-target-catalog.v1.jsonl`. The
  prompt "What stocks are performing well today on Yahoo Finance"
  decomposes via the lexicon to `read (nxs:yahoo_finance) →
  synthesize (nvg:agent)`. The yahoo_finance NXS connector reads;
  the LLM summarizes; the LLM never holds a tool. Add fixture rows
  for the desired connectors and the lexicon handles the rest.

---

## §9 Test Plan

### §9.1 Unit tests (REVISED — 11 cases now)

Added CHAT-10 and CHAT-11 for checkback payload assertions; otherwise
unchanged from v0.1.0 §9.1.

### §9.2 Loader tests, §9.3 Integration test, §9.4 ci:gate, §9.5 Parity, §9.6 Acceptance

(Unchanged from v0.1.0.)

---

## §10 Owner decisions — RATIFIED (closing the list)

All 7 items closed per audit pass 1. See §0.6 ratification table.

---

## §11 Risks (with mitigations)

(Unchanged from v0.1.0 + adding R7 below.)

R7: Branch 0 checkback uses the same `plan-checkback-modal.tsx` as
Branch 3 — if Branch 3's modal logic changes in a future amendment,
chat-tier inherits the change automatically. Mitigation: modal accepts
generic `RejectionCheckbackPayload`; payload shape is the same for
both branches; integration tests exercise both branches against the
same UI surface.

---

## §12 Logs to open at build time

```
ADD-CHAT-TIER-001 | PromptVisibilityTier widens by 'chat'             | pending build
ADD-CHAT-TIER-002 | ChatPlannerRequest interface                      | pending build
ADD-CHAT-TIER-003 | WorkspaceManifestRecord.entryMode widens          | pending build
ADD-CHAT-TIER-004 | Branch 0 planChatBranch + buildChatPlan + checkback | pending build
ADD-CHAT-TIER-005 | Workspace manifest loader + run-creation route    | pending build
ADD-CHAT-TIER-006 | Admin dashboard workspace panel entryMode unlock  | pending build
ADD-CHAT-TIER-007 | Manifest seed for nexus-chat-default              | pending build
ADD-CHAT-TIER-008 | Workspace UI run-stage chat rendering             | pending build
ADD-CHAT-TIER-009 | Integration test + 2 ci:gate steps                | pending build
```

---

## §13 What this spec does NOT change

(Unchanged from v0.1.0 §13.)

---

## §14 Appendix A — Touched surfaces

(Unchanged from v0.1.0 §14 except §3.10 reuse — no new modal file, no
new reducer extractor, no new close endpoint. All reused from lexicon
V1 Commit 8.)

---

*End of v0.2.0 draft. Awaiting owner ratification; on ratification,
Phase D build begins per §6.1 Commit 1.*
