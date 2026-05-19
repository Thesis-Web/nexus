# AMEND — Nexus Orch Callback Timeout

**Version:** v0.1.0
**Status:** RATIFIED (Hard Law #4 — orch timeout = expired/pending; never orch deny)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 D Orchestrator, §4 R Approval Channels, Hard Law #4
**Audit packet:** Turn 3 P0-025

---

## §0 Disposition

Hard Law #4: Orch has zero power to kill a run. Today `scripts/nexus-main.ts:1564-1601` lets a plan-checkback timeout auto-deny and auto-close the run by writing `plan_checkback_resolved` with decision `deny`. This violates the law. This spec ratifies the canonical timeout behavior: on plan-checkback timeout, the request is marked `expired` (or `pending-user-after-grace`); only the user, NXS, or NVG can deny/close.

**Q5 application (verbatim):** Plug-ins SUGGEST/CALLBACK/LOG. NEVER KILL. Only baked NXS, NVG, or human can kill a run.

**Audit findings closed:** P0-025 (Turn 3).

---

## §1 Scope

In scope (V1):
- Plan-checkback timeout marks request `expired` (or `pending-user-after-grace` if config allows).
- Orch never authors a `decision: 'deny'` on timeout.
- Workspace receipt explains pending/expired state and offers user actions: dismiss, restart, extend.
- Ledger event `plan_checkback_expired` (not `plan_checkback_resolved` with deny).
- CI gate per Spec F4.19.

Out of scope:
- Auto-extend / auto-retry policies (V2; explicit owner ratification).

---

## §2 Contract types

### §2.1 `PlanCheckbackTimeoutBehavior` (config)

```ts
type PlanCheckbackTimeoutBehavior =
  | { kind: 'expire'; expiresAfterMs: number }
  | { kind: 'pending_user_after_grace'; gracePeriodMs: number; remindUserEveryMs: number };
```

Default: `{ kind: 'expire', expiresAfterMs: 24 * 60 * 60 * 1000 }` (24 hours).

### §2.2 `plan_checkback_expired` ledger event

```ts
interface PlanCheckbackExpiredEvent {
  readonly eventType: 'plan_checkback_expired';
  readonly runId: RunId;
  readonly checkbackId: CheckbackId;
  readonly openedAt: RunSequence;
  readonly expiredAt: RunSequence;
  readonly emittedAt: RunSequence;
}
```

Distinct from `plan_checkback_resolved` (which only fires when the user grants/denies). No `decision` field. The event simply records that the timer elapsed.

---

## §3 Runtime behavior

### §3.1 Open

Orch opens checkback → ledger event `plan_checkback_opened` → workspace notifies user.

### §3.2 Timer

Background job checks for checkbacks past `expiresAfterMs`. On match:
- Emit `plan_checkback_expired` (NOT `plan_checkback_resolved`).
- Workspace receipt: "Plan callback expired with no user response. Restart run or dismiss."
- The run STAYS OPEN per Hard Law #4. Orch does not close. The user must decide.
- If `pending_user_after_grace` config is chosen, instead of expiring, orch keeps the checkback open + sends reminder notifications.

### §3.3 User actions post-expiry

User clicks:
- "Dismiss" → workspace marks user-dismissed; orch closes the run with `terminated_by:user` reason.
- "Restart" → workspace opens new run; orch terminates this run with `terminated_by:user`.
- "Extend" → workspace re-opens the checkback with fresh `expiresAt`; new `plan_checkback_extended` ledger event.

### §3.4 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | timer logs `would_expire_checkback`; nothing changes                                                | yes            | always         |
| advisory  | timer expires + workspace warning; user retains action                                              | yes            | always         |
| enforcing | timer expires; orch does NOT deny; run open pending user                                            | yes            | always         |

### §3.5 BAKED vs plug-in

- **BAKED (floor):** Hard Law #4 enforced — orch implementations cannot author `decision: 'deny'` on timeout; any code path that emits `plan_checkback_resolved` with `decision: 'deny'` from a timeout source is CI-gated.
- **PLUG-IN (defense in depth):** orch reference impl follows the law; customer-swapped orch must also (CI gate scans the orch interface contract for timeout-deny patterns).

---

## §4 Implementation sequence

1. Remove the timeout-deny path in `scripts/nexus-main.ts:1564-1601`.
2. Add `plan_checkback_expired` ledger event type.
3. Add background timer job that fires `plan_checkback_expired` on timeout.
4. Update workspace UI to render `expired` state with user action buttons.
5. CI gate per Spec F4.19 (`GOV-11 orch callback timeout no-kill`).
6. Tests per §5.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| OCT-TO-01 | Checkback opened; timer elapses → `plan_checkback_expired` event written (not `plan_checkback_resolved` with deny) | Integration |
| OCT-TO-02 | Run stays open after expiry; ledger does NOT contain `terminated_by:orch` reason | Integration |
| OCT-TO-03 | User clicks "Dismiss" post-expiry → run closes with `terminated_by:user` | Integration |
| OCT-TO-04 | User clicks "Restart" → new run opens with `checkbackSourceRunId`; original terminates with `terminated_by:user` | Integration |
| OCT-TO-05 | User clicks "Extend" → checkback re-opens with new `expiresAt`; `plan_checkback_extended` event | Integration |
| OCT-TO-06 | observe mode: timer logs `would_expire_checkback`; nothing else changes | Integration |
| OCT-TO-07 | Static gate scans orch code for `decision: 'deny'` constructed from a timeout source → CI fails | Static |

**CI static gates (Spec F4.19):**
- `GOV-11 orch callback timeout no-kill` — scans orch reference impl for any code path that authors a deny on timeout.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-025 | Timeout-deny path retired; canonical `plan_checkback_expired` event; orch never closes on timeout; tests OCT-TO-01/-02 |

---

*End of v0.1.0.*
