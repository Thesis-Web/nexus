# AMEND — Nexus Planner / Chat Tier v1.1: Multi-Turn Conversation

**Version:** v0.1.0
**Status:** RATIFIED (outline-aligned, body-first; no §0.4 addendum)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (under owner direction, dangerous-mode spec rework session)
**Base commit:** 3ae197d (pre-rework HEAD)
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md (ratified 2026-05-18)
**Audit packet:** runs/alignment-spec-rework-2026-05-19/audit-input/ (Turn 1 P2-003)

---

## §0 Disposition

This spec adds multi-turn conversation support to the chat run type (outline §5.1) without expanding governance authority. The thread store is a **read-side projection** of the run ledger; it is not a replacement mailbox, not a governance surface, and not a side channel for inter-module data.

**Hard Laws this spec preserves:**
- **#4** Orch has zero power to kill a run; multi-turn does not give orch a new termination authority.
- **#7** LLMs see only their slice; thread history fed to the LLM in turn N is a planner decision, not an LLM discovery.
- **#8** The mailbox is the only inter-module data hub; thread store reads from ledger projections, never from another module's mailbox content.
- **#12** Run identity binds everything; each chat turn is its own runId; the thread store correlates turns through a `chatSessionId` that is separate from runId and never substitutes for it.
- **#13** Default-secure; thread visibility, deletion, and cross-principal sharing all gate on RBAC claims.

**Outline anchors:**
- §3 C Workspace (chat is a workspace-exposed run mode).
- §3 D Orchestrator (planner reads thread history when planning turn N).
- §3 P Run Ledger (thread store is a projection of `run_opened` / `final_response` events, not authoritative).
- §5.1 Chat run type.

**Audit findings closed:** P2-003 (Turn 1) — confirms thread-store-as-read-side-projection direction.

---

## §1 Scope

In scope (V1):
- A `chatSessionId` identifier that correlates multiple chat runs into one user-facing conversation.
- A read-side thread store that projects `run_opened` (prompt digest) + `final_response` (artifact digest + opaque body endpoint) events into a per-`(principalId, chatSessionId)` view.
- Planner ability to read the last N turns of the thread when planning turn N+1, so the LLM slice for turn N+1 can include relevant prior context.
- Workspace UI for switching between active chat sessions and viewing history.

Out of scope (deferred — owner decides separately):
- Cross-principal thread sharing (requires explicit RBAC ratification).
- Branch / fork of a thread mid-conversation.
- Streaming partial-message UI (independent UX work; thread store stays append-only).
- Server-initiated thread deletion (admin retention policy work).

---

## §2 Contract types

### §2.1 `ChatSessionId`

```ts
type ChatSessionId = `chat-${string}`;
```

A 26-char ULID under a `chat-` prefix. Workspace generates on first turn of a new conversation; subsequent turns of the same conversation reuse it.

### §2.2 `ChatTurnRecord`

The projection record assembled by reading the run ledger:

```ts
interface ChatTurnRecord {
  readonly chatSessionId: ChatSessionId;
  readonly runId: RunId;
  readonly turnIndex: number;            // 0-based within the session
  readonly principalId: PrincipalId;
  readonly promptDigest: HexDigest;       // from run_opened.detail.promptDigest
  readonly artifactDigest: HexDigest | null; // from final_response.detail.artifactDigest
  readonly artifactEndpoint: string | null;  // opaque artifactId / endpoint, NEVER inline body
  readonly openedAt: RunSequence;
  readonly closedAt: RunSequence | null;
  readonly finalOutcome: FinalOutcome | null;
}
```

**FORBIDDEN in `ChatTurnRecord`:**
- Raw prompt text (lives in protected `promptRef` per P1-013 fix in Spec 9).
- Inline artifact body (Run Ledger stores digest + endpoint per P1-014).
- Mailbox content of any kind.
- Plan envelope details (those are orch-internal; planner reads them directly).

### §2.3 `ChatThreadReader`

```ts
interface ChatThreadReader {
  listSessions(principalId: PrincipalId): Promise<ChatSessionId[]>;
  readSession(
    principalId: PrincipalId,
    chatSessionId: ChatSessionId,
    options?: { lastN?: number }
  ): Promise<readonly ChatTurnRecord[]>;
}
```

Implementation reads run-ledger projections; never reads mailbox content directly.

---

## §3 Runtime behavior

### §3.1 Opening a chat turn

Workspace generates or reuses `chatSessionId` at prompt entry. The `WorkspaceRunRequest` carries `chatSessionId` and `turnIndex`. Orch stores both in `run_opened.detail` so the projection picks them up. The runId is fresh per turn (Hard Law #12).

### §3.2 Planner reading prior turns

When orch's planner decomposes turn N's prompt, it MAY call `ChatThreadReader.readSession(principalId, chatSessionId, { lastN: K })` where K is a planner-config bound (V1 default: K=5). The planner uses prior turns to disambiguate the current prompt under the lexicon mini-substrate; the LLM slice for turn N includes prior-turn snippets ONLY if the planner emits them in the slice.

The LLM does not query the thread store directly. The LLM does not know `chatSessionId` exists. (Hard Law #7.)

### §3.3 LLM slice construction with history

Per Hard Law #7, the LLM sees prompt fragment + injected mailbox content + planner-emitted history snippets for its node. Planner-emitted history is treated as part of the prompt slice; NVG governs it like any payload (data labels, firewall transit, model tier).

### §3.4 Final response projection

After compile signs the FinalResponseArtifact and the workspace receives it, the run ledger's `final_response` event includes `chatSessionId`, `turnIndex`, `artifactDigest`, and an opaque `artifactEndpoint`. The thread store projection picks these up and updates the session view.

### §3.5 Three-mode behavior

| Mode      | Gate behavior                                              | Run continues?              | Ledger writes? |
|-----------|------------------------------------------------------------|-----------------------------|----------------|
| observe   | thread store reads succeed; planner uses prior turns       | yes                         | always         |
| advisory  | same as observe; warnings if planner exceeds K bound       | yes                         | always         |
| enforcing | thread store reads gated by RBAC `read:chat_session_self`; failures fail-closed | no on fail | always |

---

## §4 Workspace UX

- Sidebar lists `ChatSessionId`s owned by the current principal, with the first user prompt of each as label preview.
- Selecting a session loads `readSession` with default `lastN=20`.
- New chat button generates a fresh `chatSessionId`.
- Each turn displays the opaque `artifactEndpoint` (renderer fetches body) — never inline body from ledger.

---

## §5 Implementation sequence

1. Add `chatSessionId` + `turnIndex` to `WorkspaceRunRequest` schema in `packages/contracts/src/externals/workspace.ts`.
2. Add `chatSessionId` + `turnIndex` to `run_opened.detail` event schema in `packages/contracts/src/run-ledger/events.ts`.
3. Add `chatSessionId` + `turnIndex` to `final_response.detail`.
4. Add `ChatThreadReader` port + reference impl that scans run-ledger events.
5. Wire planner's preflight to optionally call `ChatThreadReader.readSession` and surface snippets via the per-node prompt slice.
6. Add workspace UI for session list + history view.
7. Tests per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| CHAT-MT-01 | New chat session generates fresh `chatSessionId`; subsequent turn reuses it | E2E |
| CHAT-MT-02 | Planner reads `lastN=5` from thread store and emits history snippets into LLM slice | Unit |
| CHAT-MT-03 | Thread store never returns raw prompt text or inline artifact body | Unit |
| CHAT-MT-04 | Cross-principal read returns empty (RBAC `read:chat_session_self` gates) | Integration |
| CHAT-MT-05 | Thread store is append-only (no in-place mutation) | Unit |
| CHAT-MT-06 | `chatSessionId` collisions between principals are isolated (per-principal namespace or ULID disambiguation) | Unit |
| CHAT-MT-07 | LLM slice contains no `chatSessionId` marker (Hard Law #7) | Unit |

---

## §7 What this spec does NOT change

- Mailbox semantics. Multi-turn is a workspace + planner read-side feature.
- NXS/NVG gates. Each turn is its own run with full governance.
- Compile pass-through (Hard Law #11) applies per turn.
- Approval channels, mode signing, OCT, lexicon mutation — unchanged.

---

*End of v0.1.0.*
