# AMEND — Nexus Workspace E2E Smoke Test Suite

**Version:** v0.3.0
**Status:** RATIFIED (law-first consolidated test list; supersedes v0.2.0)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §5 Run Types, §6 End-to-End Flow, all 16 Hard Laws
**Audit packet:** Turn 1 P1-001, Turn 5 P0-046

---

## §0 Disposition

This is the canonical E2E smoke test suite under the alignment outline. It supersedes v0.2.0 (which carried an addendum §0.3.1 alignment with 20 new tests over a body §3 that asserted stale behavior). v0.2.0 was wiped by the 2026-05-19 reset; v0.3.0 is the body-first replacement.

**Q8 ruling:** Spec 12 v0.3.0 successor with consolidated law-first test list. v0.2.0 retained with SUPERSEDED header in pre-reset history; this v0.3.0 commit message records the supersession.

**Test design principle (Turn 1 P1-001):** stop debating count. Each Hard Law and outline-significant invariant gets explicit coverage. Tests may be parameterized to reduce file count, but coverage categories are mandatory; CI fails on missing category.

**Canonical law outcomes (Turn 5 P0-046 rewrite):**
- Orch callbacks DO NOT kill runs (Hard Law #4); only NXS, NVG, or human terminate.
- Unmappable prompts → callback/rephrase/cancel + `unmapped_prompt` ledger event (Hard Law #13 + Lexicon Hard-code/Ask).
- Malformed mailbox payload / pass-through integrity → fail closed (Hard Law #11 + Spec F4.12).
- No bypass-partial success path; default-secure rejects (Hard Law #13).
- Claim drift mid-run → hard fail with `claim_drift_detected` (Hard Law #14).

**Audit findings closed:** P0-046 (Turn 5), P1-001 (Turn 1).

---

## §1 Scope

In scope (V1):
- ~30 parameterized E2E smoke tests covering all 16 Hard Laws and the four run types.
- CI gate that fails when a mandatory category has zero assertions.
- Per-test mapping to outline section + Hard Law + audit P-ID.

Out of scope:
- Performance benchmarks (separate suite).
- Multi-tenant / multi-organization tests (V2).
- Full E2E for V2 features (third-party shim agents, autonomous timed agents).

---

## §2 Mandatory coverage categories (CI-enforced)

Each category MUST have at least one passing test. CI fails if any category is empty.

| Category | Hard Law(s) | Outline section | Mandatory? |
|---|---|---|---|
| AUTH | #1 | §3 A IAM | yes |
| RBAC_CLAIMS | #2 | §3 B | yes |
| WORKSPACE_ENTRY | #3 | §3 C | yes |
| ORCH_NO_KILL | #4 | §3 D | yes |
| NXS_AUTHORITY | #5 | §3 H | yes |
| NVG_AUTHORITY | #6 | §3 G | yes |
| LLM_SLICE_ISOLATION | #7 | §3 L | yes |
| MAILBOX_ONLY_HUB | #8 | §3 I, §4 | yes |
| AGENT_RUNTIME | #9 | §3 F | yes |
| SIGNED_LOGGED_FAILCLOSED | #10 | §4 P, §4 S | yes |
| COMPILE_PASSTHROUGH | #11 | §3 J | yes |
| RUN_IDENTITY | #12 | §3 D §6.1 | yes |
| DEFAULT_SECURE | #13 | §3 D | yes |
| CLAIM_DRIFT | #14 | §3 G, §3 H | yes |
| DELEGATION_INTERSECTION | #15 | §4 O | yes |
| AGENT_MAILBOX_ONLY | #16 | §3 F | yes |
| RUN_TYPE_CHAT | — | §5.1 | yes |
| RUN_TYPE_REFERENCE_WORKSPACE | — | §5.2 (planner-decided shape of chat) | yes |
| RUN_TYPE_SECTIONED | — | §5.3 | yes |
| RUN_TYPE_SECURE_RAILS | — | §5.4 | yes |
| SECOND_RUN_CONTINUATION | #12 | §6.1 step 11 | yes |
| LEXICON_HARD_CODE_OR_ASK | — | §3 E | yes |
| MODE_OBSERVE_ADVISORY_ENFORCING | — | §4 Q | yes |

---

## §3 Test list (consolidated, law-first)

Each test is canonical-law-first. No stale outcomes; no "orch denies"; no "bypass partial completes".

### AUTH (Hard Law #1)
**T-AUTH-01** — Unauthenticated request to workspace `/runs` → 401, no module sees the request, no ledger entry beyond `auth_rejected`.

### RBAC_CLAIMS (Hard Law #2)
**T-RBAC-01** — Authenticated principal opens run; `WorkspaceRunRequest` carries claims envelope populated from RBAC (principalId, runId, permitted systems, OCT, etc.).

### WORKSPACE_ENTRY (Hard Law #3)
**T-WS-01** — All run lifecycle events surface to workspace via push/poll only; no direct module HTTP access for the human user.

### ORCH_NO_KILL (Hard Law #4)
**T-ORCH-NOKILL-01** — Planner returns multiple ambiguous candidates → callback to user with top-N + ε; run not killed, lexicon_signal logged on user pick.
**T-ORCH-NOKILL-02** — Plan callback timeout → request marked `expired`/`pending-user`, NOT orch-authored deny. (Spec F4.14.)
**T-ORCH-NOKILL-03** — User clicks "restart" on callback → run terminates with `terminated_by:user`, not `terminated_by:orch`.

### NXS_AUTHORITY (Hard Law #5)
**T-NXS-01** — `nxs_dispatch` node where user lacks `read:sales_records` → NXS fails closed at Gate 04/05, run terminates with NXS-attributed deny.
**T-NXS-02** — Successful `nxs_dispatch` writes EvidenceRecord with canonical `finalOutcome=executed_successfully` (Q1 vocabulary; Spec F4.10).

### NVG_AUTHORITY (Hard Law #6)
**T-NVG-01** — `nvg_dispatch` node where firewall transit denied by NVG → NVG fails closed; no LLM invocation; no payload crosses wall.
**T-NVG-02** — NVG payload with unknown provenance and empty `dataLabels` → deny/quarantine, never public (Spec F4.11).

### LLM_SLICE_ISOLATION (Hard Law #7)
**T-LLM-SLICE-01** — Multi-agent run; assert each LLM invocation contains only its own slice; no plan metadata; no tool descriptors; no other agent's content.

### MAILBOX_ONLY_HUB (Hard Law #8)
**T-MBX-01** — Inter-module data only via mailbox; static assertion that no agent code path calls NXS / NVG / orch HTTP surfaces directly.

### AGENT_RUNTIME (Hard Law #9)
**T-AGENT-01** — Agent runtime registered, listens on assigned input mailbox, invokes paired LLM via NVG, drops to compile-input or orch-input mailbox.

### SIGNED_LOGGED_FAILCLOSED (Hard Law #10)
**T-SIGN-01** — Mode unlock requires 2 distinct admin signatures (Spec F4.17); 1-signature attempt fails.
**T-SIGN-02** — Compile artifact unsigned reaches return endpoint → return rejects.
**T-SIGN-03** — Lexicon mutation single-admin attempt → SigningCouncil rejects (Spec F4.1).

### COMPILE_PASSTHROUGH (Hard Law #11)
**T-COMPILE-PT-01** — Single-agent + no output contract → compile pass-through verbatim (Spec F4.12).
**T-COMPILE-PT-02** — Multi-agent + no output contract → compile pass-through as deterministic bundle/manifest, NOT default template.
**T-COMPILE-PT-03** — Pass-through item with mailbox digest mismatch → quarantine, no final artifact.

### RUN_IDENTITY (Hard Law #12)
**T-RUN-ID-01** — Every ledger event, mailbox item, signed envelope, delegation tagged with runId; second-run continuation carries `checkbackSourceRunId`.

### DEFAULT_SECURE (Hard Law #13)
**T-DS-01** — Unmappable prompt (no lexicon match above threshold) → callback with rephrase/cancel + `unmapped_prompt` event; NOT silent reject; NOT LLM fallback.
**T-DS-02** — Malformed mailbox item reached compile-input → fail closed; no bypass-partial; no run-completes.

### CLAIM_DRIFT (Hard Law #14)
**T-CLAIM-DRIFT-01** — RBAC permissions revoked mid-run between Gate 01 resolution and Gate 04 evaluation → `claim_drift_detected` ledger event, NXS fails closed, workspace receipt explains. (Spec F4.9.)
**T-CLAIM-DRIFT-02** — NVG observes claim drift on inbound firewall return → fails closed.

### DELEGATION_INTERSECTION (Hard Law #15)
**T-DEL-INT-01** — User has read+write sales; agent has read-only sales; explicit delegation read-only → run effective = read-only sales.
**T-DEL-INT-02** — User has read inventory; agent has write-only sales (no read) → empty intersection → callback to user, NOT dispatch. (Spec F4.15.)

### AGENT_MAILBOX_ONLY (Hard Law #16)
**T-AGENT-MBX-01** — Agent runtime attempting direct NXS/NVG call → static AST gate fails; runtime guard rejects.

### RUN_TYPE_CHAT (§5.1)
**T-CHAT-01** — Simple prompt → LLM → response via NVG; no NXS unless prompt requests action. Multi-turn thread store as read-side projection (Spec F3a).

### RUN_TYPE_REFERENCE_WORKSPACE (§5.2)
**T-REF-WS-01** — Planner decides chat-mode prompt needs multi-agent fan-out; no user-facing "reference workspace" radio; planner-driven only.

### RUN_TYPE_SECTIONED (§5.3)
**T-SECT-01** — Sectioned run with output contract template; compile assembles per template + signs FinalResponseArtifact.

### RUN_TYPE_SECURE_RAILS (§5.4)
**T-SECURE-01** — Secure-rails run bypasses orch planning (orch thin pass-through, still logged); straight to NVG → NXS; secure agent picks up via mailbox.

### SECOND_RUN_CONTINUATION (Hard Law #12 + §6.1)
**T-SECOND-RUN-01** — Agent drops to orch-input mailbox needing another system touch; orch opens NEW run with `checkbackSourceRunId`; new run re-enters governance from scratch.

### LEXICON_HARD_CODE_OR_ASK (§3 E)
**T-LEX-01** — Single high-confidence candidate → hard-coded plan (no callback).
**T-LEX-02** — Multiple candidates within ε → callback with top-N visualization + ε.
**T-LEX-03** — Nothing above threshold → callback with rephrase/cancel + `unmapped_prompt`.

### MODE_OBSERVE_ADVISORY_ENFORCING (§4 Q)
**T-MODE-01** — observe mode: all gates evaluate, log "would_*", run continues.
**T-MODE-02** — advisory mode: gates evaluate + workspace warning, run continues.
**T-MODE-03** — enforcing mode: gates evaluate + fail closed on deny; only NXS/NVG/user kill.

---

## §4 Parameterization

Tests can share scaffolding (e.g., one fixture builder produces variants for `T-NXS-01` across multiple action verbs + target systems). The CI gate counts categories, not test functions. The intent: a builder can express the same Hard Law assertion across multiple table-rows without inflating file count.

---

## §5 CI gate

Add `GOV-E2E-COVERAGE` (under Spec F4.19 GOV-* suite):
- Scan `tests/e2e/` for test IDs matching pattern `T-<CATEGORY>-NN`.
- Build a category-presence map.
- Fail if any mandatory category from §2 has zero present test IDs.
- Gate report lists missing categories by name.

---

## §6 Retired test patterns (formerly in v0.2.0 §3)

These patterns are RETIRED-INCORRECT under the outline; tests asserting them are forbidden (see `feedback_retired_incorrect_class.md`):

- "Cancel → run_closed via orch" — Hard Law #4 violated; only user/NXS/NVG terminate.
- "Lexical mismatch → plan_rejected UI error" — Hard Law #13 violated; correct behavior is callback + `unmapped_prompt`.
- "Malformed mailbox item → bypass partial / run completes" — Hard Law #11 + #13 violated; correct behavior is fail-closed.
- "server_restart → terminal closure" — Hard Law #4 violated; orch cannot kill on restart; run resumes from ledger state.

---

## §7 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-046 | §3 test list rewritten around canonical law outcomes; §6 explicitly retires stale patterns |
| P1-001 | §2 mandatory category map; §5 CI gate fails on missing category; count is no longer the metric |

---

## §8 Backwards compatibility

v0.2.0 (the addendum-over-stale-body version) was wiped by the 2026-05-19 reset. This v0.3.0 is the canonical e2e-smoke-tests spec under the alignment outline; no legacy spec body to wrestle with.

---

*End of v0.3.0.*
