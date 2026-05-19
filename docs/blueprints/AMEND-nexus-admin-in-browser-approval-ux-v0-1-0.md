# AMEND — Nexus Admin: In-Browser Approval UX

**Version:** v0.1.0
**Status:** RATIFIED (Q5 fail-closed approver scoping in body)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §4 R (Approval Channels), §4 Q (Mode + Mode Signing), §3 K (Admin Dashboard)
**Audit packet:** Turn 5 P0-044

---

## §0 Disposition

This spec defines the in-browser approval inbox UX and the **fail-closed approver scoping law** required by Q5. The prior pattern of "approverIds optional, missing = open channel" is forbidden. Every approval channel must have an explicit approver allowlist OR an explicit signed break-glass/open-channel config; missing both = channel disabled.

**Q5 ruling (verbatim):** empty `approverIds` → channel disabled (plug-in level fail-closed). Baked NXS in enforcing mode ALSO fails closed on any approval-required gate with no evidence chain entry. Plug-ins SUGGEST, CALLBACK, LOG. NEVER KILL. Only baked NXS, NVG, or human can kill a run.

**Hard Laws this spec preserves:**
- **#4** Orch has zero power to kill a run; approval timeouts go to user, not orch-deny.
- **#5** NXS is sole action-governance authority — Gate 04 / Gate 05 may require approval; only NXS denies on missing approval.
- **#10** Every signed envelope (approval response) is Ed25519-signed by an admin-registered key.
- **#13** Default-secure — approval channel without explicit approver scope is disabled, not open.

**Q-rulings applied:**
- **Q5** (above).
- **Q3** BAKED enforcement (NXS Gate evaluating approval requirement) first, plug-in (admin-writer rejecting empty `approverIds` on save) second.

**Audit findings closed:** P0-044 (Turn 5).

---

## §1 Scope

In scope (V1):
- `ApprovalChannel` contract type with mandatory `approverIds` field.
- Reference channels: dashboard inbox, webhook, CLI.
- Approval request lifecycle: pending → granted / denied / expired.
- Signed approval response envelopes.
- BAKED NXS gate that fails closed on approval-required action with no evidence chain entry.
- Plug-in admin-writer rejecting empty `approverIds` at save time.
- Explicit `signedOpenChannelConfig` envelope for break-glass / global approvers.

Out of scope:
- M-of-N approval (separate from SigningCouncil 2-of-2 federated ops; deferred to V2 unless owner ratifies).
- Slack / Teams / PagerDuty adapters (V2 channel adapters).
- Approval delegation chains (V2).

---

## §2 Contract types

### §2.1 `ApprovalChannel`

```ts
interface ApprovalChannel {
  readonly channelId: ApprovalChannelId;
  readonly channelKind: 'dashboard' | 'webhook' | 'cli';
  readonly approverIds: readonly PrincipalId[];   // MANDATORY — empty = channel disabled (plug-in fail-closed)
  readonly openChannelConfig?: SignedOpenChannelConfig;  // only present if break-glass signed config exists
  readonly enabled: boolean;
  readonly notes?: string;
}
```

`approverIds` is NOT optional. Empty array is allowed at the type level (so the field is always present) but means "channel disabled" at runtime. To allow any registered admin to approve (e.g., break-glass), the operator must attach a `SignedOpenChannelConfig` envelope (admin-signed via SigningCouncil 2-of-2 per Spec F4.1).

### §2.2 `SignedOpenChannelConfig`

```ts
interface SignedOpenChannelConfig {
  readonly channelId: ApprovalChannelId;
  readonly allowAnyRegisteredAdmin: boolean;
  readonly expiresAt: WallClockISO;
  readonly signatures: ReadonlyArray<{
    readonly principalId: PrincipalId;
    readonly signature: Ed25519Signature;
  }>;   // exactly 2 distinct admin signatures required
  readonly openedBy: PrincipalId;
  readonly openedAt: RunSequence;
}
```

A wide-open channel can only be created via the SigningCouncil `signing_council_change` flow (Spec F4.1). Time-bounded; auto-revokes at `expiresAt`.

### §2.3 `ApprovalRequest`

```ts
interface ApprovalRequest {
  readonly requestId: ApprovalRequestId;
  readonly runId: RunId;                  // never null — approvals are run-scoped
  readonly nodeId: NodeId;                // which plan node needs approval
  readonly channelId: ApprovalChannelId;
  readonly reason: string;                // human-readable from Gate 04/05
  readonly openedAt: RunSequence;
  readonly expiresAt: WallClockISO;
  readonly responses: ReadonlyArray<{
    readonly approverId: PrincipalId;
    readonly decision: 'grant' | 'deny';
    readonly signature: Ed25519Signature;
    readonly respondedAt: RunSequence;
  }>;
  readonly status: 'pending' | 'granted' | 'denied' | 'expired';
}
```

### §2.4 `ApprovalPort` (plug-in)

```ts
interface ApprovalPort {
  open(req: Omit<ApprovalRequest, 'requestId' | 'openedAt' | 'expiresAt' | 'responses' | 'status'>): Promise<ApprovalRequestId>;
  respond(requestId: ApprovalRequestId, approverId: PrincipalId, decision: 'grant' | 'deny', signature: Ed25519Signature): Promise<ApprovalRequest>;
  get(requestId: ApprovalRequestId): Promise<ApprovalRequest | null>;
  listPending(approverId: PrincipalId): Promise<readonly ApprovalRequest[]>;
}
```

---

## §3 Runtime behavior

### §3.1 BAKED enforcement (floor)

When NXS Gate 04 / Gate 05 determines an action is approval-required (per signed policy bundle, Spec F4.2), it:
1. Calls `ApprovalPort.open(...)` to register the request.
2. Records `approval_required` ledger event with `(requestId, runId, nodeId, channelId, reason)`.
3. Pauses the node pending response.
4. On `respond(decision='grant')`: verifies signature, verifies approver is in `channel.approverIds` OR `openChannelConfig.allowAnyRegisteredAdmin` is true AND approver is registered admin AND config not expired. Mismatch → `approval_response_rejected` + fail closed.
5. On `respond(decision='deny')`: marks denied, NXS denies node, run terminates per Hard Law #5.
6. On `expiresAt`: marks expired, NXS denies node, terminates run.

**Critical:** if `channel.approverIds` is empty AND no valid `openChannelConfig` exists, the channel is DISABLED — NXS fails closed at step 1 with `approval_channel_disabled` ledger event. The plug-in `ApprovalPort.open` may pre-reject (defense in depth), but the baked NXS layer fails closed regardless.

### §3.2 Plug-in defense in depth

Admin-writer routes (`POST /workspace/admin/approval/channels`) reject saves with empty `approverIds` AND no `openChannelConfig` with HTTP 400 + `approval_channel_invalid` reason. This is plug-in fail-closed at write time, so the bad config never reaches the baked layer in well-behaved deployments. The baked layer still enforces independently.

### §3.3 Approval inbox UI

- Dashboard inbox panel shows `listPending(approverId=session.principalId)`.
- Each item: runId, nodeId, action verb, target system, requester, reason, opened-at, expires-at, "Grant" + "Deny" buttons.
- Grant click: server-side signs via principal's keypair (per `feedback_signing_keys_server_side.md`) and calls `respond`.
- All callback + operator overrides logged for admin gaming detection (Q5).

### §3.4 Orch callback approvals (same surface)

Per outline §4 Q, orch's callback to user uses the same approval-channel infrastructure as governance-gate approvals. The user sees a unified "things waiting on you" list. Orch never denies on timeout — see Spec F4.14.

### §3.5 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | NXS evaluates approval requirement; if would-require, log `would_open_approval_request`; no pause   | yes            | always         |
| advisory  | NXS opens request; warning to workspace; node continues pending background grant                    | yes (with caveat in receipt) | always |
| enforcing | NXS opens request; node pauses; grant → continue; deny/expired → terminate; disabled channel → fail-closed | no on deny/expired/disabled | always |

### §3.6 BAKED vs plug-in summary

- **BAKED (floor):** NXS gate evaluating approval requirement; `approval_channel_disabled` fail-closed on missing approver scope; signature verification; ledger writes; only NXS/NVG/human terminate run.
- **PLUG-IN (defense in depth):** admin-writer schema rejecting empty `approverIds`; dashboard UI form validation; channel-kind adapters (dashboard/webhook/cli).

---

## §4 Admin dashboard surfaces

- **Channels panel**: list/edit channels; required approver multi-select; "this channel is disabled because no approvers are configured" empty-state.
- **Open channel break-glass form**: warns prominently; requires SigningCouncil 2-of-2 (Spec F4.1) to enable; mandatory `expiresAt` (V1 max 24h).
- **Pending approvals panel**: principal-scoped inbox.
- **Approval history**: per-channel, per-run filter; signature chain visible.

---

## §5 Implementation sequence

1. Add `ApprovalChannel`, `SignedOpenChannelConfig`, `ApprovalRequest`, `ApprovalPort` to `packages/contracts/`.
2. Implement baked NXS gate fail-closed on `approval_channel_disabled`.
3. Implement `ApprovalPort` reference dashboard adapter.
4. Wire admin-writer routes + dashboard UI.
5. Wire orch's callback to use the same `ApprovalPort` (Spec F4.14).
6. Tests + CI gates per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| APP-01 | Channel with empty `approverIds` and no `openChannelConfig` → save rejected 400 | Integration |
| APP-02 | Same channel reaching NXS gate at runtime → fail closed with `approval_channel_disabled` | Integration |
| APP-03 | Approver outside `channel.approverIds` attempts grant → rejected with `approval_response_rejected` | Integration |
| APP-04 | Valid grant from in-list approver → node continues | Integration |
| APP-05 | Deny → run terminates with `approval_denied` from NXS (not orch) | Integration |
| APP-06 | Expired request → `approval_expired` + NXS terminates | Integration |
| APP-07 | `SignedOpenChannelConfig` with 2-of-2 SigningCouncil signatures → any registered admin can grant within `expiresAt` | Integration |
| APP-08 | Open channel config past `expiresAt` → treated as no config; channel disabled | Integration |
| APP-09 | Plug-in `ApprovalPort` shim returning grant without proper signature → BAKED gate rejects | Integration |
| APP-10 | observe mode: would-require logs event; node does not pause | Integration |

**CI static gates (Spec F4.19):**
- `GOV-?? approval-channel scoping` — scans for `approverIds` schema and verifies required-field enforcement; scans NXS gate for `approval_channel_disabled` fail-closed branch.

---

## §7 What this spec does NOT change

- SigningCouncil federation operations (Spec F4.1) — distinct mechanism for governance-mutation signatures.
- Mode signing — uses SigningCouncil for `mode_unlock`, not this approval surface.
- M-of-N variable thresholds — explicitly deferred to V2.

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-044 | `approverIds` mandatory; empty = disabled (plug-in fail-closed); BAKED NXS independently fails closed; break-glass requires SigningCouncil signed config; tests APP-01/-02/-07/-08 |

---

*End of v0.1.0.*
