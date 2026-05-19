# AMEND — Nexus Planner / Chat Tier v1.4: File Attachments

**Version:** v0.1.0
**Status:** RATIFIED (mailbox-bound, classified-at-bind, deny/quarantine on unknown)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 C Workspace, §3 G NVG, §3 I Mailbox, Hard Laws #6/#8/#13/#14
**Audit packet:** Turn 5 P0-045, Turn 3 P0-019 (label propagation), P1-013/P1-014 (workspace UX adjacents)

---

## §0 Disposition

This spec corrects the prior chat-attachment pattern in which staged file bytes rode on the dispatcher request side channel (an `attachedFiles` field on `WorkspaceRunRequest`) and non-vision attachments were silently skipped with a ledger event while the run continued. That pattern violates Hard Laws #6 (NVG governs every payload crossing the firewall), #8 (mailbox is the only inter-module data hub), and #13 (default-secure).

**Canonical V1 attachment lifecycle:**
1. Staged at workspace upload → assigned `attachmentId` + initial unbound classification.
2. Bound to run at `WorkspaceRunRequest` open → classified at bind time, digest computed, provenance recorded.
3. Materialized into mailbox items (NVG-drop or NXS-drop per plan); the request body carries `attachmentRef`s, not bytes.
4. NVG sees the bound `dataLabels` for every attachment payload that transits the firewall.
5. Unsupported / sensitive / unknown attachments → deny or quarantine. Never silent skip.

**Hard Laws this spec preserves:**
- **#6** NVG governs every payload crossing the firewall (either direction).
- **#8** Mailbox is the only inter-module data hub; attachment bytes flow through mailbox items, not request side channels.
- **#13** Default-secure; unknown/unclassified attachments deny or quarantine.
- **#14** Claim drift verification — attachment-touching gates re-verify carried claims.

**Q-rulings applied:**
- **Q3** BAKED enforcement first (NVG reads `dataLabels`; baked classify-at-bind cannot be removed by plug-in Workspace) + plug-in defense (Workspace upload UI pre-checks file type).
- **Q5** Plug-ins never kill — non-vision attachments are not silently dropped by the workspace plug-in; the baked NVG layer denies or quarantines with a workspace receipt explaining the reason.

**Audit findings closed:** P0-045 (Turn 5). Coordinates with Spec F4.11 (NVG payload labels) and P1-013/P1-014 (workspace UX hygiene).

---

## §1 Scope

In scope (V1):
- `Attachment` contract type with mandatory classification + provenance + digest.
- `AttachmentStagingPort` + `AttachmentBinder` baked services.
- `WorkspaceRunRequest.attachmentRefs: AttachmentId[]` replaces inline `attachedFiles`.
- Plan-time materialization into per-node mailbox items via `attachment_materialized` ledger event.
- NVG payload assembly reads bound `dataLabels` per attachment (Spec F4.11).
- Workspace receipt explaining any deny/quarantine outcome.
- Tests + CI gates per §6.

Out of scope:
- Per-attachment human-in-the-loop review queue (V2).
- Streaming chunked uploads (V2).
- Cross-run attachment reuse (V2; reuse implies cross-run governance, separate ratification).

---

## §2 Contract types

### §2.1 `Attachment`

```ts
interface Attachment {
  readonly attachmentId: AttachmentId;          // ULID
  readonly stagedAt: WallClockISO;
  readonly stagedBy: PrincipalId;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly digest: HexDigest;                    // SHA-256 of bytes
  readonly storageRef: string;                   // opaque server-side ref; never client-readable
  readonly bindingState: 'unbound' | 'bound' | 'rejected' | 'quarantined';
  readonly boundToRunId?: RunId;                 // populated when bindingState='bound'
  readonly dataLabels: readonly DataLabel[];     // populated AT BIND TIME (see §3.2); empty until bound
  readonly classificationDecisionRef?: ClassificationDecisionRef;
  readonly rejectionReason?: string;
}
```

**FORBIDDEN:**
- Sending `attachmentBytes` (or equivalent inline payload) on `WorkspaceRunRequest`.
- Materializing an attachment into a mailbox item with empty `dataLabels`.
- Skipping (silently or otherwise) a non-vision attachment when the plan requires an LLM call.

### §2.2 `WorkspaceRunRequest` change

```ts
interface WorkspaceRunRequest {
  // ... existing fields
  readonly attachmentRefs?: readonly AttachmentId[];   // NEW — replaces attachedFiles
}
```

The `attachedFiles` field (if present in older code) is REMOVED in V1.

### §2.3 `AttachmentBinder` (baked)

```ts
interface AttachmentBinder {
  /** Bind staged attachments to a run; classify-at-bind. */
  bind(runId: RunId, attachmentIds: readonly AttachmentId[], context: BindContext): Promise<readonly Attachment[]>;
}

interface BindContext {
  readonly principalId: PrincipalId;
  readonly identityClaims: IdentityClaims;
  readonly arena: ArenaId;
}
```

`bind` classifies each attachment per `mimeType` + `byteLength` + arena policy + plug-in classifier (if any). Unsupported MIME type → `bindingState='rejected'` + `rejectionReason='unsupported_mime_type'`. Unknown / no-classifier → `bindingState='quarantined'` + `rejectionReason='unknown_provenance'`. Successful classification → `bindingState='bound'` + `dataLabels` populated.

---

## §3 Runtime behavior

### §3.1 Staging (workspace upload)

1. Workspace POSTs bytes to `POST /workspace/attachments/stage` with mimeType + auth.
2. Server computes digest, stores bytes in opaque storage, emits `attachment_staged` ledger event, returns `attachmentId`.
3. Initial `bindingState='unbound'`; `dataLabels: []`.

### §3.2 Bind (at run open)

1. `WorkspaceRunRequest` arrives with `attachmentRefs: [attId1, attId2, ...]`.
2. Orch calls `AttachmentBinder.bind(runId, attIds, ctx)` BEFORE plan assembly.
3. For each attachment:
   - Verify ownership (`stagedBy === principalId` OR explicit sharing).
   - Classify per arena policy + classifier output.
   - On success: persist `bindingState='bound'`, populate `dataLabels`, emit `attachment_bound`.
   - On rejection/quarantine: persist state, emit `attachment_rejected` or `attachment_quarantined`, include reason.
4. If ANY attachment ended in `rejected` or `quarantined` AND the plan requires that attachment (e.g., LLM needs it) → run does NOT proceed to plan execution; workspace receipt explains.
5. If plan does not require the rejected attachment → plan proceeds without it; workspace receipt notes the omission.

The decision "plan requires this attachment" is the planner's; the planner reads bound attachments during decomposition and emits explicit per-node `attachmentRef` references.

### §3.3 Materialize (plan execution)

When a plan node is dispatched (`nvg_dispatch` or `nxs_dispatch`), if the node references attachmentRefs:
1. Orch reads the bound `Attachment` and emits a mailbox item for the assigned input mailbox, carrying:
   - `attachmentId`
   - `digest` (re-verifiable)
   - `mimeType`
   - `dataLabels` (from bind)
   - `storageRef` (server-side resolvable; NXS/NVG read bytes via storage adapter, never raw HTTP from workspace)
2. Emits `attachment_materialized` ledger event with mailbox item reference.
3. NVG payload assembly for an `nvg_dispatch` node reads the mailbox item's `dataLabels` and includes them in the NVG request (Spec F4.11). Empty `dataLabels` here is a P0 violation; NVG fails closed.

### §3.4 NVG sees labels

Per Spec F4.11, the NVG request body for an LLM invocation carries `dataLabels: DataLabel[]` aggregating labels from prompt slice + mailbox items + materialized attachments. If any label is `oct_secure` and the chosen LLM tier is `frontier_general`, NVG denies. If `dataLabels` is empty AND provenance is unknown, NVG denies/quarantines.

### §3.5 Non-vision attachment + LLM requiring vision

If the plan requires the LLM to see an attachment and the chosen LLM does not support that MIME type:
- The classifier marks the attachment `bindingState='rejected'` with `rejectionReason='llm_tier_incompatible'`.
- The run does NOT proceed silently. Workspace receives a receipt: "The attachment 'sales-report.pdf' could not be processed by the selected on-prem LLM (no PDF vision support). Choose a different LLM or remove the attachment."
- Operator may pick a different LLM (re-open run) or remove attachment.

### §3.6 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | bind classifies + logs `would_reject_attachment` / `would_quarantine_attachment`; run proceeds      | yes            | always         |
| advisory  | same as observe + workspace warning panel                                                           | yes            | always         |
| enforcing | rejected/quarantined attachments that plan requires → run does not proceed; receipt explains        | no on require  | always         |

### §3.7 BAKED vs plug-in

- **BAKED (floor):** `AttachmentBinder` classify-at-bind enforcement; `dataLabels` populated mandatorily; mailbox materialization is the only path to NVG/NXS; storage adapter access restricted to baked layer.
- **PLUG-IN (defense in depth):** workspace upload UI pre-checks MIME type and size; admin classifier plug-ins (per arena) add custom classification rules; storage backend (filesystem/S3) is plug-and-play.

---

## §4 Workspace UX

- Upload widget shows progress + accepted MIME types per current arena policy.
- Submit run with attachments → loading state "Classifying attachments…" before plan preview.
- Rejected/quarantined attachments shown inline with reason and remediation.
- No silent drops; every outcome appears in workspace receipt + run ledger.

---

## §5 Implementation sequence

1. Add `Attachment`, `AttachmentId`, `BindContext` to `packages/contracts/`.
2. Remove `attachedFiles` (if present) from `WorkspaceRunRequest`; add `attachmentRefs`.
3. Implement baked `AttachmentBinder` in `packages/core/src/attachments/`.
4. Wire `POST /workspace/attachments/stage` + `attachment_staged` ledger event.
5. Hook orch run-open to call `AttachmentBinder.bind` before plan assembly.
6. Hook plan dispatcher to emit `attachment_materialized` mailbox items.
7. Update NVG payload assembly (Spec F4.11 coordinates) to read bound `dataLabels`.
8. Update workspace UI.
9. Tests + CI gates per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| ATT-01 | Staged attachment without binding cannot be sent to NVG (no mailbox materialization) | Integration |
| ATT-02 | `WorkspaceRunRequest` with `attachedFiles` (legacy) → schema rejects | Unit |
| ATT-03 | Unsupported MIME type → `bindingState='rejected'` + workspace receipt, no silent skip | Integration |
| ATT-04 | Unknown provenance attachment → `bindingState='quarantined'` + receipt | Integration |
| ATT-05 | Attachment required by plan but rejected → run does not proceed; receipt explains | Integration |
| ATT-06 | Attachment NOT required by plan → run proceeds; receipt notes omission | Integration |
| ATT-07 | Materialized mailbox item carries `dataLabels` populated at bind | Integration |
| ATT-08 | NVG payload assembly reads `dataLabels` from materialized item (Spec F4.11) | Integration |
| ATT-09 | Cross-principal attachment use → bind rejects (ownership check) | Integration |
| ATT-10 | observe mode: classifier marks reject, run proceeds, ledger reflects `would_reject_attachment` | Integration |
| ATT-11 | enforcing mode + secure-rails run: attachment with `oct_secure` label + on-prem-only routing → NVG enforces | Integration |
| ATT-12 | Digest mismatch on materialization (storage tamper) → quarantine; node fails closed | Integration |

**CI static gates (Spec F4.19):**
- Scan: no production code path sends `attachedFiles` (legacy).
- Scan: no mailbox-write path can construct an attachment item with empty `dataLabels`.

---

## §7 Workspace UX adjacents (P1-013, P1-014)

- `run_opened.detail` stores `promptDigest`, NOT raw prompt. Reissue from `checkbackSourceRunId` uses server-side stored request body, not ledger.
- `final_response` ledger detail stores `artifactDigest` + opaque `artifactEndpoint`; client renders body via endpoint, not from ledger.
- These two adjacents are not the focus of this spec but coordinate with attachment lifecycle (since attachment digests appear in `run_opened.detail.attachmentDigests`).

---

## §8 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-045 | Attachments bound through baked binder; mailbox materialization is only handoff; reject/quarantine instead of silent skip; tests ATT-01/-03/-04/-05 |
| P0-019 / P0-030 | (Coordinated with Spec F4.11) `dataLabels` populated at bind; never empty post-bind for real payloads |

---

*End of v0.1.0.*
