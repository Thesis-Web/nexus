# AMEND — Nexus Planner Dispatch Correctness

**Version:** v0.2.0
**Status:** RATIFIED (canonical; supersedes v0.1.0 history)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 D Orchestrator, §3 E Lexicon, §3 H NXS, §3 G NVG, Hard Laws #4/#5/#7/#13/#15
**Audit packet:** Turn 1 P0-005, P1-002, Turn 2 P0-012, P0-013, Turn 5 P0-047

---

## §0 Disposition

This is the canonical planner-dispatch-correctness spec. It supersedes the v0.1.0 lineage (which existed in pre-reset history and was wiped by the 2026-05-19 reset). v0.2.0 corrects the four drifts the prior bug-diagnosis spec named, applies Q3 wildcard discipline, applies Q6 post-inference dispatch removal, and replaces hard-fail-on-unmappable wording with Hard-code/Ask callback.

**Hard Laws this spec enforces:**
- **#4** Orch has zero power to kill a run — planner never silent-rejects; unmappable prompts callback.
- **#5** NXS is sole action-governance authority — `nxs_dispatch` nodes are planner-authored only.
- **#7** LLMs see only their slice — no tool descriptors in NVG payload; no LLM-initiated tool dispatch into NXS.
- **#13** Default-secure — no eligibility without intersection match; no wildcard without explicit narrowed config.
- **#15** Symmetric intersection (user ∩ agent ∩ delegation) — used by `findEligibleForRun`.

**Q-rulings applied:**
- **Q3 wildcard discipline:**
  - WRITE-side: plug-in admin-writer rejects `*` (defense in depth).
  - READ-side baked gates: observe → log `wildcard_present_would_quarantine`; advisory → log + workspace warning; enforcing → fail closed unless `SignedWildcardConfig` ratifies AND intersection narrows.
- **Q6 post-inference dispatch removal:** LLM tool calls touching targeted internal systems are forbidden; planner-authored `nxs_dispatch` is the only path. Unsolicited LLM tool calls → text/`unsolicited_model_tool_call` ledger event.
- **Q5 plug-in vs baked:** orch (plug-in) cannot deny; the run-eligibility intersection is computed in the baked layer (NXS gate reads via callback) so a swapped orch cannot bypass.

**Audit findings closed:** P0-005, P0-012, P0-013, P0-047, P1-002.

---

## §1 Scope

In scope (V1):
- Node-kind preservation: NXS action nodes → `nxs_dispatch`; NVG model nodes → `nvg_dispatch`; deterministic/agent-only nodes → neither (planner emits agent direct invocation via mailbox).
- `findEligibleForRun(runId, principalId, target, capability, oct, delegatedScope)` on `AgentRegistryReader`.
- Typed `NxsDispatchResult` (no raw nullable `PipelineResult`).
- Hard-code / Ask callback flow: no candidate / below threshold → callback with rephrase/cancel + `unmapped_prompt`; never hard-fail; never silent LLM fallback.
- Wildcard discipline per Q3.
- Removal of post-inference tool dispatch per Q6 (coordinates with Spec F4.20).

Out of scope:
- A* costed lexicon search implementation (separate; lexicon mini-substrate work).
- Cost-routing intelligence (planner picks LLM tier candidate; NVG vetoes — separate spec).
- Mid-run plan amendment (handled by second-run pattern, outline §6.1 step 11).

---

## §2 Contract types

### §2.1 `AgentRegistryReader` (planner-facing port)

```ts
interface AgentRegistryReader {
  // EXISTING (kept for non-governed read paths):
  findByCapability(capability: Capability): Promise<readonly AgentSummary[]>;
  getById(agentId: AgentId): Promise<AgentSummary | null>;
  listVisible(principalId: PrincipalId): Promise<readonly AgentSummary[]>;

  // NEW (governed planning paths MUST use this):
  findEligibleForRun(query: EligibleForRunQuery): Promise<readonly AgentSummary[]>;
}

interface EligibleForRunQuery {
  readonly runId: RunId;
  readonly principalId: PrincipalId;
  readonly identityClaims: IdentityClaims;        // user RBAC for this run
  readonly targetSystem: TargetSystemId;
  readonly capability: Capability;
  readonly octLevel: OctLevel;                     // from identityClaims
  readonly delegatedScope: DelegationScope;        // explicit run-bound delegation
  readonly environment: Environment;
  readonly riskTier: RiskTier;
}
```

`findEligibleForRun` returns agents whose declared capabilities intersect with `(user RBAC) ∩ (agent RBAC) ∩ (delegated scope)` per Hard Law #15. Empty result → planner callbacks per §3.3.

### §2.2 `PlanNode` kind preservation

```ts
type PlanNode =
  | NxsDispatchNode    // requiresNxs=true; nodeType='nxs_dispatch'; planner-authored
  | NvgDispatchNode    // requiresNvg=true; nodeType='nvg_dispatch'; planner-authored
  | AgentInvocationNode // deterministic or LLM-paired agent; reads/writes mailbox; neither requires NXS nor NVG directly (agent reaches NVG via orch dispatch if LLM-paired)
  | CompileNode;       // reads compile-input mailbox
```

The legacy single-prompt path that emits all nodes as `nvg_dispatch` (P0-013) is **forbidden** and removed.

### §2.3 `NxsDispatchResult`

```ts
interface NxsDispatchResult {
  readonly nodeId: NodeId;
  readonly outcome: 'success' | 'denied' | 'error';
  readonly evidenceRecordRef: EvidenceRecordRef;    // always present, never null
  readonly mailboxItemRef?: MailboxItemRef;          // present on success
  readonly denialCode?: DenialCode;                  // present on denied
  readonly errorRef?: ErrorRef;                      // present on error
}
```

Replaces the raw `PipelineResult` exposure path (P0-005 evidence). Never nullable.

### §2.4 `SignedWildcardConfig` (production/enforcing only)

```ts
interface SignedWildcardConfig {
  readonly scope: 'target_system' | 'capability' | 'agent_eligibility';
  readonly narrowingClauses: readonly NarrowingClause[];   // MANDATORY non-empty
  readonly approvedBy: ReadonlyArray<{ principalId: PrincipalId; signature: Ed25519Signature }>;
  readonly expiresAt: WallClockISO;
}
```

Requires SigningCouncil 2-of-2 (Spec F4.1). Without this envelope, wildcards in production enforcing mode fail closed at the baked NXS gate.

---

## §3 Runtime behavior

### §3.1 Lexicon-driven decomposition

Planner calls lexicon mini-substrate's A* costed search (outline §3 E) with prompt tokens. Returns ranked candidates with confidence per arena. The planner applies Hard-code / Ask:

- Single high-confidence candidate → hard-code the plan (deterministic node graph).
- Multiple candidates within ε → CALLBACK to user with top-N + ε visualization; log `lexicon_signal` on user pick.
- Nothing above threshold → CALLBACK with rephrase/cancel; log `unmapped_prompt`.

**Forbidden:** silent reject; LLM fallback; hard-fail with `unmappable_request`. The prior `hard-fail unmappable_request` wording is RETIRED-INCORRECT.

### §3.2 Node-kind emission

Per matched intent:
- If intent involves a target-system CRUD → emit `NxsDispatchNode` with `requiresNxs=true`, planner-authored.
- If intent requires LLM synthesis only → emit `NvgDispatchNode` with `requiresNvg=true`, planner-authored.
- If intent is deterministic agent work (e.g., file aggregation, formatting) → emit `AgentInvocationNode` with neither flag.
- A single intent may emit multiple nodes (e.g., `NxsDispatchNode(read sales)` → `AgentInvocationNode(format)` → `NvgDispatchNode(LLM polish)`).

### §3.3 Eligible-agent lookup

For each `NxsDispatchNode` or `AgentInvocationNode` that requires an agent, planner calls `findEligibleForRun(...)`. If result is empty:
- Planner callbacks to user: "No agent has the intersection (your permissions) ∩ (agent capabilities) ∩ (delegated scope) needed for `<verb>` on `<system>`."
- Logs `eligible_agents_empty` ledger event.
- Does NOT dispatch; does NOT silently fail.

### §3.4 Typed NXS dispatch

`nxs_dispatch` calls return `NxsDispatchResult`. Orch reads `outcome` and routes:
- `success` → next node consumes `mailboxItemRef`.
- `denied` → run terminates per Hard Law #5 with NXS-attributed deny + workspace receipt.
- `error` → ledger event + workspace receipt; per owner ratification, retry once with backoff or terminate.

### §3.5 Wildcard discipline (Q3)

- WRITE-side: admin-writer rejects `*` in `RolePermission.targetSystems` or `Agent.allowedSystems` unless paired with a `SignedWildcardConfig` reference.
- READ-side at baked NXS Gate 04/05:
  - **observe**: log `wildcard_present_would_quarantine` per gate eval; do not block.
  - **advisory**: log + workspace warning panel; do not block.
  - **enforcing**: if `SignedWildcardConfig` absent OR `narrowingClauses` empty OR expired → fail closed with `wildcard_unsigned_or_unscoped`.
- The intersection check still runs even with wildcard; wildcard expands eligibility candidates but the narrowing clauses + `(user RBAC) ∩ (agent RBAC) ∩ (delegated scope)` still apply.

### §3.6 Post-inference dispatch removal (Q6)

The planner never authors a node that takes "model output" and dispatches it to NXS. Specifically:
- The legacy `scripts/nexus-main.ts:1084-1121` path that normalizes model `tool_calls` into NXS dispatch is REMOVED.
- An LLM that returns `tool_calls` in its response → the orch treats them as text in the LLM reply slot. A ledger event `unsolicited_model_tool_call` is written for every occurrence.
- NVG itself may fire a tool call for its own firewall/routing (baked-side, kept). LLM-initiated dispatch into NXS is forbidden.

See Spec F4.20 for the full LLM-internal-tools-vs-targeted-systems distinction.

### §3.7 Three-mode behavior

| Mode      | Gate behavior                                                                                          | Run continues? | Ledger writes? |
|-----------|--------------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | planner evaluates eligibility; on empty intersection log `would_callback_eligibility`; plan proceeds with best-guess (logs intent) | yes            | always         |
| advisory  | planner callbacks on empty intersection + workspace warning; user can override                          | yes (with caveat) | always         |
| enforcing | planner callbacks on empty intersection; no dispatch without user pick; wildcards fail closed unless signed | no on empty | always         |

### §3.8 BAKED vs plug-in

- **BAKED (floor):** NXS Gate 04/05 evaluates wildcards + `SignedWildcardConfig` + intersection; rejects unsigned wildcards in enforcing mode; ledger writes for `unsolicited_model_tool_call`, `wildcard_present_would_quarantine`, `eligible_agents_empty`.
- **PLUG-IN (defense in depth):** planner is plug-in; lexicon planner can be replaced; the baked layer still enforces. Admin-writer plug-in rejects `*` at write-time.

---

## §4 Implementation sequence

1. Add `findEligibleForRun` + `EligibleForRunQuery` to `packages/contracts/src/externals/planner.ts`.
2. Implement on reference `AgentRegistryReader`.
3. Remove `legacy single-prompt all-nvg path` in `packages/orch-ref/src/plan-assembly.ts:687-710`.
4. Replace `dispatchToNxs` raw `PipelineResult` return with `NxsDispatchResult` (Spec F4.13 admin-signed-mutation-envelopes coordinates).
5. Wire `unsolicited_model_tool_call` ledger event; remove `dispatchToolCall`/`extractToolCalls` from production runtime path (Spec F4.20).
6. Add `SignedWildcardConfig` to contracts + SigningCouncil operation type (Spec F4.1 amendment to add `wildcard_config` operation in V2; V1 ships with wildcards effectively forbidden in enforcing mode).
7. Update CI gates (Spec F4.19): `GOV-02 no unsolicited model tool dispatch`, `GOV-04 effective-scope intersection`, planner all-NVG static ban.
8. Tests per §5.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| PDC-01 | Action-verb prompt (e.g., "read sales") → planner emits `NxsDispatchNode`, not `NvgDispatchNode` | Unit |
| PDC-02 | Synthesis-only prompt ("summarize this paragraph") → planner emits `NvgDispatchNode`, not `NxsDispatchNode` | Unit |
| PDC-03 | Deterministic prompt ("aggregate three files") → planner emits `AgentInvocationNode` with neither flag | Unit |
| PDC-04 | `findEligibleForRun`: user has read+write sales; agent has read-only sales; delegation read-only → returns agent with effective read-only | Unit |
| PDC-05 | `findEligibleForRun`: user has read inventory; agent has write-only sales (no read) → returns empty; planner callbacks | Unit |
| PDC-06 | Legacy all-NVG path removed: planner constructor lacking node-kind preservation throws | TS-build |
| PDC-07 | `NxsDispatchResult.outcome='success'` returns `mailboxItemRef` populated | Unit |
| PDC-08 | Unmappable prompt → callback to user with rephrase/cancel; ledger `unmapped_prompt` written; no silent reject; no LLM fallback | Integration |
| PDC-09 | Ambiguous prompt (top-2 within ε) → callback with top-N + ε; user pick logs `lexicon_signal` | Integration |
| PDC-10 | Wildcard `*` in admin payload → plug-in admin-writer rejects with `wildcard_unscoped` unless `SignedWildcardConfig` attached | Integration |
| PDC-11 | Wildcard with `SignedWildcardConfig` but expired → baked NXS fails closed | Integration |
| PDC-12 | Unsolicited LLM tool call in NVG response → orch logs `unsolicited_model_tool_call`; no NXS dispatch; reply treated as text | Integration |
| PDC-13 | observe mode: empty intersection → log `would_callback_eligibility`; plan proceeds with best-guess (does not block) | Integration |
| PDC-14 | enforcing mode: empty intersection → callback; no dispatch without user pick | Integration |
| PDC-15 | NVG fires its own tool call for firewall routing → allowed (baked) | Integration |

---

## §6 Retired patterns (RETIRED-INCORRECT)

- "Unmappable_request hard-fail" — replaced by Hard-code/Ask callback per Hard Law #13.
- "Wildcard handling as owner-option production loophole" — replaced by `SignedWildcardConfig` requirement.
- "Single-prompt all-NVG path" — removed.
- "Post-inference LLM tool call → NXS dispatch" — removed per Q6.
- "Raw nullable `PipelineResult` exposure" — replaced by typed `NxsDispatchResult`.

---

## §7 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-005 | Node-kind preservation in §2.2; legacy all-NVG path removed in §4.3; `findEligibleForRun` in §2.1 |
| P0-012 | `findEligibleForRun` with intersection in §2.1; PDC-04/-05 tests |
| P0-013 | Legacy single-prompt all-NVG path explicitly removed in §4.3; static gate in Spec F4.19 |
| P0-047 | Hard-code/Ask callback for unmappable; wildcard discipline per Q3; PDC-08/-10/-11 |
| P1-002 | Owner rulings closed: Option A delegate (§4), wildcard strict, no LLM fallback (§3.1), typed NxsDispatchResult (§2.3) |

---

*End of v0.2.0.*
