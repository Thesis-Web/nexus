# AMEND — Nexus LLM Internal Tools vs Targeted Systems

**Version:** v0.1.0
**Status:** RATIFIED (Q6 distinction — internal-only LLM tools fine; targeted-system dispatch via planner-authored nxs_dispatch only)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 D Orchestrator, §3 G NVG, §3 H NXS, §3 L LLMs, Hard Laws #5/#7
**Audit packet:** Turn 3 P0-016, Turn 4 P0-027

---

## §0 Disposition

Q6 ratifies a precise distinction between two classes of LLM tool calls:

- **LLM-internal tools** (Claude Code's own tools, Langgraph's internal flow control, OpenAI Assistants' file_search, etc.) — these are part of the LLM runtime's own loop, not part of Nexus's governance surface. They never touch the customer's targeted internal systems. Nexus does NOT intercept or govern these; they live entirely within the LLM adapter.
- **Targeted-system tool calls** (read sales database, write to file server, send email, etc.) — these touch the customer's targeted internal systems. They MUST go through the planner-authored `nxs_dispatch` node path (Spec F4.7). LLMs cannot initiate these via post-inference tool calls; the planner authors them deterministically.

The current code (`scripts/nexus-main.ts:1084-1121`) normalizes any model `tool_calls` and dispatches them to NXS, conflating both classes. This spec ratifies the boundary and removes the conflating path.

**Q6 ruling (verbatim):** LLMs CAN call tools for their own internal needs (Claude Code's own tools, Langgraph's internal flow, etc.) — that's NOT Nexus's concern; lives in LLM runtime. LLMs CANNOT call tools that touch targeted internal systems. Remove the post-inference normalizer path that takes LLM tool output and dispatches to NXS. Log every attempt as `unsolicited_model_tool_call` ledger event. NVG may rarely fire a tool call for its own firewall/routing — that's baked-side and stays.

**Hard Laws this spec preserves:**
- **#5** NXS is sole action-governance authority for targeted-system actions — model output cannot trigger NXS.
- **#7** LLMs see only their slice; no tool descriptors in NVG payload; LLMs cannot discover targeted systems via tool schemas.

**Q-rulings applied:**
- **Q6** (above).
- **Q3** BAKED enforcement — baked NVG inspects model output and routes; planner is plug-in but its dispatch authority is baked-enforced via the CI gate ban on post-inference normalization.

**Audit findings closed:** P0-016 (Turn 3), P0-027 (Turn 4).

---

## §1 Scope

In scope (V1):
- Definition of LLM-internal tool calls vs targeted-system tool calls.
- Removal of post-inference normalizer (`scripts/nexus-main.ts:1084-1121`) from production runtime path.
- `unsolicited_model_tool_call` ledger event on every model `tool_calls` field detection.
- LLM adapter contract: adapters MAY pass internal tools to the LLM (Claude Code's own tools, etc.) so long as those tools do NOT touch targeted internal systems; adapters MUST NOT advertise targeted-system tools to the LLM.
- NVG-internal tool calls (for NVG's own firewall/routing) preserved as baked-side.
- CI gate per Spec F4.19 (`GOV-02 no unsolicited model tool dispatch`).

Out of scope:
- LLM adapter framework / vendor SDK ergonomics (separate work; this spec is the governance contract they must obey).
- "Reasoning tools" / "thinking tools" / model-internal scratchpads — those are entirely LLM-internal.

---

## §2 Conceptual model

```
            ┌──────────────────────────────────────────┐
            │  LLM adapter (plug-in, vendor SDK)       │
            │                                          │
            │  ┌────────────────────────┐              │
            │  │ LLM-INTERNAL TOOLS     │ ← OK         │
            │  │ (Claude Code MCP,      │              │
            │  │  Langgraph state,      │              │
            │  │  file_search, etc.)    │              │
            │  └────────────────────────┘              │
            │                                          │
            │  ┌────────────────────────┐              │
            │  │ TARGETED-SYSTEM TOOLS  │ ← FORBIDDEN  │
            │  │ (CRM read, file write, │   in payload │
            │  │  email send, ...)      │   sent to LLM│
            │  └────────────────────────┘              │
            └──────────────────────────────────────────┘
                                │
                                ▼
            ┌──────────────────────────────────────────┐
            │  NVG (baked)                              │
            │  - inspects model response                │
            │  - if tool_calls present → log            │
            │    `unsolicited_model_tool_call`          │
            │  - does NOT dispatch to NXS               │
            │  - may fire its OWN tool calls for        │
            │    firewall/routing (baked)               │
            └──────────────────────────────────────────┘
                                │
                                ▼
            ┌──────────────────────────────────────────┐
            │  Orch (plug-in) reads NVG result         │
            │  - treats unsolicited tool_calls as text │
            │  - never dispatches them to NXS          │
            └──────────────────────────────────────────┘
                                │
                                ▼
            ┌──────────────────────────────────────────┐
            │  NXS (baked) — only entry is              │
            │  planner-authored `nxs_dispatch` node     │
            └──────────────────────────────────────────┘
```

---

## §3 Contract types

### §3.1 LLM adapter declaration

```ts
interface LlmAdapterDeclaration {
  readonly adapterId: LlmAdapterId;
  readonly providerKind: 'ollama' | 'anthropic' | 'openai' | 'mcp' | 'custom';
  readonly internalToolsAdvertised: readonly InternalToolDescriptor[];   // LLM-internal only
  // FORBIDDEN: targetedSystemTools field. Targeted-system tools never appear here.
}
```

A CI static gate (Spec F4.19 GOV-02 + this spec §5.7) verifies no `LlmAdapterDeclaration` carries a targeted-system tool descriptor.

### §3.2 `unsolicited_model_tool_call` ledger event

```ts
interface UnsolicitedModelToolCallEvent {
  readonly eventType: 'unsolicited_model_tool_call';
  readonly runId: RunId;
  readonly nodeId: NodeId;
  readonly nvgRequestRef: NvgRequestRef;
  readonly modelResponseRef: ModelResponseRef;
  readonly toolCallsExtract: ReadonlyArray<{
    readonly toolName: string;
    readonly argsDigest: HexDigest;   // never raw args (provenance protection)
  }>;
  readonly disposition: 'treated_as_text';
  readonly emittedAt: RunSequence;
}
```

NVG emits one event per occurrence. The orch consumer treats the model response (including any `tool_calls` field) as text in the LLM reply slot.

---

## §4 Runtime behavior

### §4.1 NVG inspection

Per NVG return-precheck, NVG inspects the model response. If `tool_calls` field is present (provider-shaped):
- Emit `unsolicited_model_tool_call` ledger event with names + arg digests.
- Drop the `tool_calls` field from the payload that goes to the orch mailbox; preserve only the text content.
- Workspace receipt notes: "Model returned tool-call shapes; treated as text per Nexus governance."

### §4.2 Orch behavior

Orch reads the mailbox payload as text. Never dispatches a tool call extracted from model output. The planner remains the only authority for `nxs_dispatch` nodes (Spec F4.7).

### §4.3 NVG-internal tool calls (baked, preserved)

NVG itself may fire tool calls as part of its own firewall/routing logic (e.g., calling a classifier service to label outbound payload). These are NVG-baked operations, not LLM-initiated. They appear in ledger as `nvg_internal_tool_call` events and are part of NVG's own decision pipeline.

### §4.4 LLM adapter behavior

Adapters MAY pass LLM-internal tools (per `LlmAdapterDeclaration.internalToolsAdvertised`) to the LLM during inference. The LLM may use them. Their effects are within the adapter / LLM runtime, never crossing into Nexus's targeted-system surface.

Adapters MUST NOT pass targeted-system tools to the LLM. NVG payload assembly verifies this by stripping any `tools` field from outbound NVG → adapter payload (per outline §3 G "NVG decides whether the agent/LLM/payload may transit the firewall"). If an adapter ignores this and passes targeted-system tools via its own SDK, the resulting model `tool_calls` are still caught by NVG return-precheck and treated as text + logged.

### §4.5 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | NVG detects model `tool_calls`; log `would_log_unsolicited_model_tool_call`; payload passes as text  | yes            | always         |
| advisory  | NVG logs `unsolicited_model_tool_call` + workspace warning                                          | yes            | always         |
| enforcing | NVG logs `unsolicited_model_tool_call`; payload returned as text only; orch never dispatches         | yes (the call is text, not action) | always |

### §4.6 BAKED vs plug-in

- **BAKED (floor):** NVG return-precheck inspecting `tool_calls`; logging `unsolicited_model_tool_call`; stripping field from payload; NVG-internal tool calls remain baked.
- **PLUG-IN (defense in depth):** LLM adapter `internalToolsAdvertised` declarations; admin can audit declarations.

---

## §5 Implementation sequence

1. Remove `scripts/nexus-main.ts:1084-1121` post-inference normalizer + `dispatchToolCall` invocation from production runtime path. (Module retained behind a clearly-named legacy-disabled namespace if needed for migration tests; not wired into runtime.)
2. Wire NVG return-precheck to emit `unsolicited_model_tool_call` events on detection.
3. Add `LlmAdapterDeclaration.internalToolsAdvertised` typed field; reject declarations carrying targeted-system tool names.
4. Update `scripts/dispatch-round-trip.test.ts` to invert from "dispatch happens" → "dispatch does NOT happen; event logged".
5. CI gate per Spec F4.19 (`GOV-02 no unsolicited model tool dispatch`).
6. Tests per §6.

---

## §6 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| LIT-01 | NVG receives model response with `tool_calls` field → emits `unsolicited_model_tool_call`; drops field; payload to orch is text-only | Integration |
| LIT-02 | Orch reads orch-input mailbox with model response → does NOT dispatch any tool call extracted from response | Integration |
| LIT-03 | Planner-authored `nxs_dispatch` node → NXS invoked normally (control case) | Integration |
| LIT-04 | LLM adapter declaration with targeted-system tool name (e.g., `crm_read`) → schema rejects with `targeted_system_tool_in_adapter_declaration_forbidden` | Integration |
| LIT-05 | LLM adapter declaration with LLM-internal tool name (e.g., `claude_code_read`, `mcp_file_search`) → schema accepts | Unit |
| LIT-06 | NVG-internal tool call for firewall routing → emits `nvg_internal_tool_call` (distinct event, baked) | Integration |
| LIT-07 | Static gate detects `dispatchToolCall` / `extractToolCalls` invocation in production runtime path → CI fails | Static |
| LIT-08 | observe mode: NVG detects `tool_calls`; logs `would_log_unsolicited_model_tool_call`; field still stripped (no dispatch in any mode) | Integration |

**CI static gates (Spec F4.19):**
- `GOV-02 no unsolicited model tool dispatch` — verifies production runtime path does not contain `dispatchToolCall`/`extractToolCalls`; verifies `unsolicited_model_tool_call` event type exists.

---

## §7 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-016 | Post-inference normalizer removed; `unsolicited_model_tool_call` event; planner-authored `nxs_dispatch` is only path; tests LIT-01/-02 |
| P0-027 | dispatch-round-trip test inverted to no-dispatch + event-logged; CI gate GOV-02; LIT-07 |

---

*End of v0.1.0.*
