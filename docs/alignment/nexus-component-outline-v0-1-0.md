# Nexus Component Outline
# Version: v0.1.0
# Status: RATIFIED (alignment baseline — supersedes ad-hoc model in scattered specs)
# Date: 2026-05-18
# Author: Claude (under owner direction, hash session 2026-05-17/18)
# Owner: James Huson / Lake Area LLC
# HEAD pin at ratification: 3ae197d
# References:
#   docs/blueprints/AMEND-nexus-blueprint-orch-v1-1-1.md
#   docs/blueprints/AMEND-nexus-mailbox-pit-v0-2-1.md
#   docs/blueprints/AMEND-blueprint-nexus-compile-1-1-1.md
#   docs/blueprints/AMEND-blueprint-nexus-governed-workspace-v1-1-1.md
#   docs/blueprints/AMEND-nexus-planner-db-lexicon-v0-2-1.md
#   /mnt/c/Users/AdLibitumVita/Downloads/hartonomous-substrate-architecture.md (substrate reference)
#   /mnt/c/Users/AdLibitumVita/Downloads/agent-{1,2,3,cake,format,meta}.sh
#   /mnt/c/Users/AdLibitumVita/Downloads/compiler.sh
#   /mnt/c/Users/AdLibitumVita/Downloads/nexus-chain-test.sh

---

## §0 How to read this document

This is the canonical statement of what every Nexus module does, what it
listens to, what it drops, and what it is forbidden from doing. It is the
shared map for owner, spec authors, build agents, and audit. When a spec
or piece of code conflicts with this outline, the outline wins — specs
and code must be revised to match, not the other way around.

This outline contains **no deferrals**. Every component listed here is
load-bearing for V1. Items previously marked "future amendment" in older
specs (orch listener, agent listener, second-run pattern, multi-admin
signing for lexicon mutations, etc.) are part of V1 and are listed here
as such. Deferring foundational items does not shrink the road; it
lengthens it.

The outline distinguishes:

- **HARD LAWS** (§1) — true for every run, every module, every
  implementation. Non-negotiable. A spec or implementation that violates
  one is wrong.
- **PLUG-AND-PLAY** components (§3) — reference implementation ships;
  customer can swap. The system contracts at the seam; behind it is
  replaceable.
- **BAKED** components (§3) — not replaceable. Governance core.
- **CROSS-CUTTING** concerns (§4) — apply across modules.
- **RUN TYPES** (§5) — the four user-facing run shapes.
- **CANONICAL END-TO-END FLOW** (§6) — generic + a worked sales example.
- **STATE TODAY** (§7) — what's built, what's drifted, what's missing.

---

## §1 Hard Laws

Sixteen laws. Every Nexus implementation must honor all sixteen.

**1. Auth happens first.** No module sees a request that hasn't been
authenticated. The user (or autonomous agent acting under a user's
authority) authenticates at the IAM boundary before anything else.

**2. RBAC populates the claims envelope; everyone downstream consumes
it.** Identity claims, capability ceiling, OCT classification, permitted
run types, target-system access, CRUD rights, firewall transit rights,
agent-pairing config — all originate at RBAC. Downstream modules read;
they do not infer.

**3. Workspace is the only entry/exit for the human.** A human user
never sees, calls, or routes around any other module directly. The
workspace is the surface; everything else is server-side.

**4. Orch has zero power to kill a run.** Orch may: pass through,
callback to user (accept / deny+send-anyway / restart), or hand to
NVG/NXS for execution. Orch may NOT deny, reject, terminate, or fail a
run for any reason. Only NVG, NXS, or the user (via callback) ends a
run. Orch is not part of governance; orch is plug-and-play and may
itself be a non-deterministic implementation, so it cannot hold
governance authority.

**5. NXS is the sole action-governance authority.** Every CRUD on a
target system passes through NXS. NXS validates principal + agent +
LLM are all permitted. NXS fails closed on any gate violation. NXS
logs every decision to ledger, audit trail, and workspace receipt.

**6. NVG is the sole model-and-firewall governance authority.** Every
LLM invocation passes through NVG. Every payload crossing the firewall
(either direction) passes through NVG. NVG fails closed. NVG logs every
decision to ledger, audit trail, and workspace receipt.

**7. LLMs see only their slice.** An LLM receives the prompt fragment +
injected mailbox content for its node — never the plan, never tool
descriptors, never another agent's slice. The orch may stash plan
metadata in the trace; the LLM never gets it.

**8. The mailbox is the only data hub between modules.** All
inter-module data movement passes through a mailbox. No back-channel
calls between agents, between NXS and the agent, between NVG and the
agent, between any two modules. The mailbox is the only seam.

**9. The agentic agent actor has its own runtime.** An agent is not a
registry record. It is a runtime that registers, holds config, listens
to one or more mailboxes, may pre-process inputs, may invoke its paired
LLM via NVG (if the work requires synthesis), may post-process, and
drops its result into the assigned next mailbox. The runtime spectrum
ranges from pure deterministic (no LLM) through LLM-paired, multi-step
agentic, autonomous, timed, and third-party-shim — all sharing one
runtime contract.

**10. Everything signed, everything logged, fail-closed.** Every signed
envelope (mode change, approval response, compile artifact, delegation,
template ingestion, lexicon mutation) is Ed25519-signed by an
admin-registered key. Every gate outcome (allow / deny / timeout / error)
goes to ledger. Every failure path is fail-closed — no silent skips, no
"we'll log it later."

**11. Compile is pass-through when there's nothing to compile.**
Single-agent + no output contract = compile does not validate, parse,
or transform — it forwards verbatim to return. Multi-agent without
output contract = same. Output contract present = compile assembles
per template.

**12. Run identity binds everything.** Every event, every mailbox item,
every ledger entry, every signed envelope, every delegation is tagged
with `runId`. The run is the universal correlator. A second-run
continuation carries `checkbackSourceRunId` pointing at its predecessor.

**13. Default-secure.** No module assumes permission. If RBAC did not
grant it, it is denied. If the manifest did not register it, it is not
callable. If a confidence score did not exceed threshold, the planner
does not auto-route — it callbacks. Permission is positive, not
absence-of-denial.

**14. Carried claims are verified against RBAC at every governance
gate.** The claims envelope travels with the request for performance.
NXS and NVG callback to RBAC at every gate to verify the carried
claims still match RBAC's current state. Mismatch = hard fail + ledger
event `claim_drift_detected` + workspace receipt with reason. Stale or
forged claims cannot succeed.

**15. Delegation chains are signed at every step, and run effective
permissions are the SYMMETRIC intersection of all parties.**

  Run effective permissions = (user's current RBAC permissions for this
  run) ∩ (agent's declared capabilities per RBAC) ∩ (explicitly
  delegated scope for this run). Lesser wins in every dimension.

  Examples:
  | User (per RBAC)              | Agent (per RBAC)            | Run effective                |
  |-------------------------------|------------------------------|------------------------------|
  | Can do everything             | Read sales only              | Read sales only              |
  | Read inventory + shipping     | Can do everything            | Read inventory + shipping    |
  | Read + write sales            | Read sales only              | Read sales only              |
  | Read sales                    | Write sales (no read)        | (empty — callback to user)   |

  NXS validates the chain at each gate. Each delegation envelope is
  signed (Ed25519). Stale, forged, or over-broad envelopes hard-fail.

**16. Agents touch mailboxes only.** An agent runtime's only legitimate
external surface is the mailboxes assigned to it for the current run.
Any call from an agent runtime to NXS, NVG, the orchestrator, the
ledger, or any other module is a hard-fail violation. The agent gets
data via NXS-drop or NVG-drop mailbox; the agent provides data via
compile-drop or orch-drop mailbox; that is the entire surface.

  **Exception**: when the plug-and-play orch is itself implemented as
  an agent (e.g., enterprise plugs an on-prem agentic orchestrator),
  that one specific case routes through a signed-key path with its own
  audit trail. This is the only carve-out; it is not a general loophole.

---

## §2 Plug-and-play vs. Baked

| Category | Components | Why this category |
|---|---|---|
| **PLUG-AND-PLAY** | IAM/Auth, RBAC, Workspace, Orchestrator (planner + executor + coordinator together), Mailbox (backend), Compile (assembler), Connectors, LLM adapters, Agentic Agent Actor, Approval Channels, Identity Provider | Customer may swap the implementation. We ship a reference for the portable build. Contract is at the seam. |
| **BAKED** | NXS, NVG, Run Ledger, Mode + Signing, Manifest Manifold, the Mailbox primitive contract (not the backend), the Governance Envelope around Orch, the Hard Laws themselves | Cannot be swapped. Governance authority is not a customer choice. |

A baked component may have replaceable sub-pieces (e.g., Mailbox
contract is baked, but the storage backend is plug-and-play). The
**contract** is baked; the **implementation** behind the contract may
be replaceable depending on the component.

---

## §3 Modules

For each module: **WHAT** it is, **RESPONSIBILITIES**, **LISTENS TO**,
**DROPS / WRITES**, **FORBIDDEN**, **PLUG-AND-PLAY STATUS**, optional
**NOTES**.

### A. IAM / Auth (PLUG-AND-PLAY)

- **WHAT**: The identity provider. Username + password (or equivalent
  credential) → authenticated principal.
- **RESPONSIBILITIES**: Authenticate the user (or autonomous agentic
  agent acting under a user's authority). Issue session token. Hand
  control to RBAC.
- **LISTENS TO**: HTTP/CLI auth request.
- **DROPS / WRITES**: Session token, principal identifier.
- **FORBIDDEN**: Holding capabilities. Authorizing actions. Knowing
  about runs.
- **REFERENCE IMPL**: ships with a default admin user + API key in the
  repo (correct for a portable product so customer can get in on first
  install).
- **TARGET ADAPTERS**: AWS IAM, Microsoft Entra, Keycloak, OIDC, SAML,
  custom API-token.

### B. RBAC (PLUG-AND-PLAY)

- **WHAT**: The policy + configuration layer that translates "who is
  this principal" into "what is this principal allowed to do."
- **RESPONSIBILITIES**: Populate the runtime config for every actor
  (human, agentic agent, LLM). Define what target systems the actor may
  touch, what CRUD operations, what firewall transit rights, what run
  types they may invoke, what capability ceiling, what OCT class.
  Respond to callback verification from NXS/NVG at runtime gates.
- **LISTENS TO**: Principal identifier from IAM. Callback verification
  requests from NXS/NVG.
- **DROPS / WRITES**: Identity claims envelope (carried downstream with
  the run). Callback responses to NXS/NVG verifications.
- **FORBIDDEN**: Authenticating. Deciding per-action governance (that's
  NXS). Deciding per-model governance (that's NVG).
- **REFERENCE IMPL**: RIA (Reference Identity Adapter).
- **TARGET ADAPTERS**: AWS IAM policies, Microsoft Entra roles,
  Keycloak realms, custom.
- **THE FULL CLAIMS PAYLOAD RBAC POPULATES** (consumed by Orch + NXS +
  NVG + Agent runtime — Mailbox + Compile + Return do NOT read claims):
  - principalId, displayName
  - runId (assigned by workspace at run-open)
  - permitted targeted systems + per-system CRUD rights
  - firewall transit rights (ingress / egress, per direction)
  - permitted run types (chat / sectioned / secure-rails / autonomous)
  - if agentic agent: agentId, the human under whose authority it
    acts, the agent's runtime capabilities
    (read/write/copy/move/file-handling/file-creation/firewall-transit/
    cloud-actions/visible target systems/default LLM pairing/output shape)
  - capability ceiling (cap on what orch can plan into this run)
  - OCT classification (governance ceiling)
  - approval-channel preferences

### C. Workspace (Governed) (PLUG-AND-PLAY)

- **WHAT**: The only place a human or autonomous agentic agent operates
  from. Visual or CLI surface for entering prompts and receiving returns.
- **RESPONSIBILITIES**: Display agent/LLM/run-type selectors (grayed
  for unavailable; toggleable in admin to hide vs. show-disabled).
  Accept prompt + optional file uploads. Open a runId. Stream run
  progress / receipts to the user. Display the final return (text,
  file, data, receipt). Present orch's callback modal (accept / deny /
  restart / pick-from-candidates).
- **LISTENS TO**: User input. Run-progress events from runtime
  (push/poll). Compile-return delivery.
- **DROPS / WRITES**: WorkspacePromptInput. File upload staging.
  Approval decisions (when user is the approver). Callback responses
  (accept / deny / restart / pick).
- **FORBIDDEN**: Knowing about NXS/NVG/Mailbox/Compile internals.
  Building plans. Authorizing actions. Signing envelopes.
- **REFERENCE IMPL**: web UI (current test bed).
- **TARGET ADAPTERS**: CLI, customer-built UI, embedded surface.
- **RUN MODES IT EXPOSES** (see §5): chat, sectioned, secure-rails.
  Reference-workspace as a separate user-facing mode is deleted — that
  shape is the planner's decision (chat-fan-out-to-multi-agent), not a
  separate radio button.

### D. Orchestrator (PLUG-AND-PLAY)

- **WHAT**: The planner + run coordinator + DAG executor. Deterministic
  by default; could be replaced by an on-prem LLM, frontier LLM, or
  alternate inference-DB implementation.
- **RESPONSIBILITIES**:
  - Accept WorkspaceRunRequest (prompt + files + claims + selected
    agents/LLMs/run type).
  - Decide whether this is an inside-the-wall or outside-the-wall request.
  - Use lexicon (the mini-substrate per §E) to inference the prompt
    into a workflow plan via A* costed search.
  - Apply the Hard-code / Ask pattern: high-confidence match →
    hard-code the plan; ambiguous → callback with top-N candidates;
    nothing above threshold → callback with rephrase/cancel options.
  - Preview the plan to user (callback) for accept / deny+send-anyway /
    restart / pick-from-candidates.
  - Split the prompt into per-recipient slices: what NVG sees, what
    NXS sees, what each agent sees.
  - Assign mailboxes per node: NXS-drop, NVG-drop, agent-input,
    compile-input, orch-input.
  - Pick output contract / compile template from template DB (or none).
  - Issue scoped, signed delegations to each agent.
  - Coordinate run lifecycle: dispatch, await results, handle mid-run
    plan amendment (with governance re-check), trigger compile, drive
    return.
  - **Re-enter from the top on multi-run flow**: when an agent drops
    work to the orch mailbox that requires touching another target
    system, orch opens a NEW run (with `checkbackSourceRunId`); the
    new run goes back through governance from scratch.
  - Log user picks from callbacks as `lexicon_signal` events (per §E
    admin-mediated growth loop).
- **LISTENS TO**: WorkspaceRunRequest. Orch-input mailbox (for
  agent-driven continuation, second-run trigger, mid-run replanning).
- **DROPS / WRITES**: Plan envelope (signed). Per-node delegations
  (signed). Mailbox assignments. Plan callback to workspace. Lexicon
  trace + lexicon_signal to ledger.
- **FORBIDDEN** (HARD):
  - **Cannot kill a run.** Cannot deny. Cannot reject. Cannot fail.
    Orch passes-through, calls-back, or hands off — period.
  - Cannot authorize anything.
  - Cannot decide which LLM (NVG's authority — orch may suggest).
  - Cannot decide whether a system action is permitted (NXS's authority).
  - Cannot see oct_secure prompt content.
- **REFERENCE IMPL**: deterministic runtime + lexicon mini-substrate +
  DAG executor (under build — current code is too light per §7).
- **TARGET ADAPTERS**: on-prem LLM orchestrator, frontier LLM
  orchestrator, alternate inference-DB orchestrator.

### E. Lexicon Database — Mini-Substrate (PLUG-AND-PLAY data; BAKED contract)

- **WHAT**: The data backbone of the deterministic orchestrator. A
  scaled-down version of the Hartonomous substrate model
  (entity + edge + significance per arena + A* traversal + guards +
  hard-code/ask) sized for Nexus's specific job: deciding chat-vs-action,
  output-contract-vs-not, template-vs-not, single-vs-multi-agent,
  which agents, which target systems.

- **ARCHITECTURE — Four layers borrowed from Hartonomous, sized for Nexus**:

  | Layer | Hartonomous | Nexus mini-substrate |
  |---|---|---|
  | 1. Atomic / Lexical | Unicode points, tokens, WordNet synsets/lemmas | Action verbs (ACTION_VERB), nouns (business terms), operands (date, quantity, file path) |
  | 2. Structural | AST nodes, phrase groups, grammar roles | Intent definitions, workflow templates, slot definitions, output contracts |
  | 3. Semantic | Sense disambiguation, cross-lingual, domain topics, significance per arena | Capability mappings, target-system catalog, confidence scores per (entity, arena) |
  | 4. Inference | A* costed search, Glicko-2 ranking, guards, state machine, cost budget | Planner's decomposition algorithm: A* through lexicon entities, costed by match confidence per arena, with hard guards |

- **STORAGE**: SQLite (V1) → PostgreSQL (V2). Tables: `lexicon_entity`,
  `lexicon_entity_type`, `lexicon_edge`, `lexicon_edge_type`,
  `lexicon_confidence (entity_id, arena, score)`. Entity/edge model
  instead of flat fixture tables — adding new relationship types does
  not require new fixture files.

- **SEED DATA**: WordNet subset (verbs + action-relevant nouns) +
  governed-verb-lexicon (563 mappings — already in repo, currently
  unused) + admin-ingested intents and templates.

- **MATCH ALGORITHM**: A* from prompt-token seed entities, costed by
  `-confidence` per arena (high-confidence edges are cheap; low are
  expensive), with hard cost budget. Returns ranked candidate intents
  with confidence scores. Budget exhaustion → callback, never silent
  failure, never LLM fallback.

- **DECISION (Hard-code / Ask)**:
  - Single candidate above threshold → hard-code plan (deterministic).
  - Multiple candidates within ε of each other → callback to user with
    top-N + ε visualization.
  - Nothing above threshold → callback with "rephrase or cancel."
  - **Never** silently fall back to an LLM. **Never** silently reject.

- **GUARDS** (architectural invariants — when/then, hard stops):
  - Compile-time enforced via TypeScript types + ci:gate scans
    (e.g., "no plan emitter may produce a node without a mailbox
    assignment").
  - Runtime hard-stops (e.g., "if prompt contains a target-system
    noun and the plan has no nxs_dispatch node, halt and callback —
    planner bug catcher").
  - Compose with the OCT / mode / policy machinery — guards are about
    plan correctness, not authorization.

- **ARENAS**: Per-workspace + global default. Same prompt may route
  differently in `medical_workspace` vs `warehouse_workspace` because
  "pull" has different confidence scores per arena. Workspace declares
  which arena(s) score it uses.

- **MUTATION**:
  - Admin-only.
  - **Double-admin signing required for every lexicon mutation**
    (two distinct admin keys must sign; single-admin signing for
    lexicon is forbidden).
  - Versioned. Audit-trailed.
  - Unmapped prompts log as `unmapped_prompt` events; admins review
    periodically.
  - User picks from callbacks log as `lexicon_signal` events
    (prompt + chosen intent + candidate scores + userId + runId);
    admins review patterns over time and propose lexicon updates
    that the second admin signs off on.
  - **Real-time learning from prompts is forbidden.** The prompt
    channel cannot mutate governance data. Admin-mediated growth only.

- **LISTENS TO**: Bootstrap loader. Query calls from planner.
- **DROPS / WRITES**: In-memory tables consumed by the planner.
  Lexicon-trace events to ledger. `unmapped_prompt` events.
  `lexicon_signal` events.
- **FORBIDDEN**: Mutation at runtime (except admin signing). Per-run
  state. Authorization decisions. Calling out to any other module at
  runtime. Auto-mutation from user prompts.

### F. Agentic Agent Actor (PLUG-AND-PLAY)

- **WHAT**: A registered runtime that, when invoked, listens on its
  assigned mailboxes, may pair with an LLM (via NVG) if the work
  requires synthesis, and drops its result into the next mailbox. The
  runtime is the unit of code that runs as the agent — not an LLM
  call, and not a registry record. The runtime contract is uniform;
  the body inside the runtime varies completely across implementations.

- **THE RUNTIME SPECTRUM** (all implement the same contract):

  | Variant | What it is | When to use |
  |---|---|---|
  | Pure deterministic | Just code: read mailbox → transform → write mailbox. No LLM. | File transfer, format conversion, simple aggregation, deterministic table-shaping |
  | LLM-paired | Read mailbox → invoke LLM via NVG → post-process → write mailbox | Synthesis, reasoning, content generation |
  | Multi-step agentic | Internal loop: pickup → maybe-LLM → maybe more pickup → ... | Investigation, multi-turn reasoning within one agent |
  | Autonomous | Runs without per-prompt human invocation; triggered by schedule, event, or another agent | Nightly report, monitoring alert, scheduled extract |
  | Timed | Cron-style under a delegated principal's auth | Daily backup, weekly summary |
  | Third-party shim | Wraps an MCP server, Langgraph app, OpenAI Assistant, etc. | Plugging existing AI apps into Nexus governance |

- **RESPONSIBILITIES**:
  - Register at boot (signed registration; sits in registered-actors
    bucket waiting to be called).
  - Hold config (populated by RBAC + admin writer; ships with defaults
    for portable build).
  - Show in workspace dropdown (visible to all; selectability gated by
    claims — admin can toggle to hide vs. show-disabled).
  - On dispatch: listen on assigned input mailbox(es). On drop:
    pre-process if needed; invoke paired LLM via NVG if needed;
    post-process if needed; drop result to assigned next mailbox.

- **LISTENS TO**: NXS-drop mailbox (data/files/receipt from target
  system action), NVG-drop mailbox (LLM result from prior turn or
  upstream synthesis).
- **DROPS / WRITES**:
  - Compile-input mailbox (run is done; result flows to compile/return).
  - Orch-input mailbox (work needs to continue — another agent, another
    target-system touch, another data fetch — triggers a second run if
    needed per Hard Law #12).

- **FORBIDDEN** (HARD per Hard Law #16):
  - Calling NXS directly (only orch talks to NXS).
  - Calling NVG directly (only orch talks to NVG).
  - Calling the orchestrator directly (orch reads orch-input mailbox).
  - Calling the ledger directly.
  - Touching any mailbox not assigned to it for this run.
  - Holding governance authority.

- **REFERENCE IMPL**: needs to be built (does not exist today — see §7).
- **TARGET ADAPTERS**: customer-built agent runtime, third-party
  frameworks (Langgraph, MCP, OpenAI Assistants, .sh / .bat /
  arbitrary runtime files) via shim.

- **CONFIG SHAPE**: capabilities
  (read/write/copy/move/file-handling/file-creation), firewall transit
  rights, cloud-action rights, visible target systems, default LLM
  pairing preference, output shape (does it produce text / file /
  data / image), runtime type (deterministic / LLM-paired / agentic /
  autonomous / timed / shim).

- **DELEGATION**: when invoked, the agent presents its delegation
  chain (human → optional autonomous orchestrator → this agent) with
  signed envelopes. NXS validates at each gate per Hard Law #15.

### G. NVG — Model + Firewall Governance (BAKED)

- **WHAT**: The AI firewall and LLM router. Sole authority on whether
  an LLM may be invoked, which one, and whether a payload may transit
  the firewall in either direction.
- **RESPONSIBILITIES**:
  - LLM selection: user preference first, orch preference second,
    NVG fallback third (with receipt to workspace explaining the choice
    when fallback fires).
  - Decide whether the agent / LLM / payload may transit the firewall
    (per direction). Outbound: is this payload allowed to leave?
    Inbound: is this returning payload allowed in?
  - Receive returning payloads via the sandbox. Run precheck (today:
    ledger; production target: virus/malware/data-sniffing).
  - Drop post-firewall payload into the assigned NVG-drop mailbox.
  - Decide whether the prompt needs NXS (any target-system action) or
    only the wall (pure outbound LLM call).
  - Fail-closed on every violation. Log every decision.
- **LISTENS TO**: Dispatch from orch (per-node). Sandbox return-channel
  from outside-the-wall.
- **DROPS / WRITES**: NVG-drop mailbox. Ledger events. Workspace
  receipts.
- **FORBIDDEN**:
  - Executing actions on target systems (that's NXS).
  - Picking which target system to touch (that's planner).
  - Direct receipt of calls from agents (only orch dispatches).
- **MODEL TIER**: Each LLM sits in a model-tier bucket
  (`on_prem_general`, `on_prem_sensitive`, `frontier_general`, etc.).
  NVG reads the bucket as the first-line "what can this LLM touch."
  Per-LLM config refines.
- **NOTE — cost-routing**: "pick on-prem for simple, frontier for hard"
  belongs in the planner (planner sees prompt complexity), not NVG.
  NVG keeps the veto (permission), planner picks the candidate.

### H. NXS — Action Governance + Connector Dispatch (BAKED)

- **WHAT**: The sole authority on actions taken inside the company's
  target systems.
- **RESPONSIBILITIES**:
  - Receive per-node prompt slice from orch.
  - Determine what action (CRUD) is being asked for on which target
    system.
  - Callback to RBAC per Hard Law #14 to verify carried claims.
  - Validate delegation chain per Hard Law #15.
  - Dispatch action via appropriate connector (CRUD or tool call).
  - Receive connector result (data, file, multiple files, or receipt
    of write/move/delete).
  - **Drop result + receipt into the NXS-drop mailbox** that orch
    assigned for this run. The receipt is load-bearing: agents pick
    up receipts to confirm an action happened, and drop their final
    artifact to compile.
  - Stream snippets to workspace (today: post-run; goal: streaming).
  - Fail closed on every gate. Log every decision.
- **LISTENS TO**: Dispatch from orch (per-node).
- **DROPS / WRITES**: NXS-drop mailbox (data + files + receipt). Ledger
  events. Audit trail. Workspace receipts.
- **FORBIDDEN**:
  - Calling an LLM (that's NVG).
  - Touching a system not in its allowed connector registry.
  - Direct receipt of calls from agents (only orch dispatches).
  - Holding prompt fragments meant for other modules.

### I. Mailbox (PLUG-AND-PLAY backend; BAKED contract)

- **WHAT**: The data hub. Per-actor, per-run isolated drop/pickup point.
  Allocated by orch at plan-confirm. The only seam through which data
  moves between modules (Hard Law #8).
- **RESPONSIBILITIES**:
  - Allocate a mailbox per `(runId, actorId, role)` at run-confirmation.
  - Accept drops from authorized modules; serve pickups to authorized
    listeners.
  - Enforce per-actor isolation at the storage layer (not just logical).
  - Persist allocation records for audit reconstruction.
  - Emit ledger events for allocations, drops, pickups.
- **MAILBOX ROLES the planner assigns per run**:
  - NXS-drop mailbox(es) — what NXS writes connector results to
  - NVG-drop mailbox(es) — what NVG writes post-firewall payloads to
  - Agent input mailbox(es) — what agents listen to (= NXS-drop /
    NVG-drop mailboxes from planner's POV)
  - Compile-input mailbox — what compile listens to
  - Orch-input mailbox — what orch listens to (for continuation /
    second-run triggers / mid-run replanning)
- **LISTENS TO** (as service): Drop calls from NXS, NVG, Agent
  runtimes, Orch.
- **DROPS / WRITES** (as service): Items requested by listeners.
- **FORBIDDEN**: Knowing what content means. Making governance
  decisions. Calling LLMs. Calling NXS / NVG. Cross-mailbox
  data leakage.
- **REFERENCE BACKEND**: local JSONL + filesystem payloads.
- **TARGET BACKENDS**: SQLite, Postgres, S3-backed, workflow-specific
  "smart mailbox" (accounting/marketing/sales/R&D-tagged for richer
  audit).

### J. Compile / Return (PLUG-AND-PLAY)

- **WHAT**: Two roles in one component.
  - **Compile**: deterministic assembler that takes mailbox content +
    a CompileTemplate (output contract) and produces an assembled
    artifact.
  - **Return**: hands the artifact (compiled or pass-through) to the
    workspace via the return endpoint.
- **RESPONSIBILITIES**:
  - Listen on compile-input mailbox for the run.
  - If output contract present: validate fills against template, place
    by slot/position, run guards, produce assembled artifact (prose /
    table / mixed / file bundle).
  - If no output contract: pass-through verbatim (Hard Law #11).
  - Sign the FinalResponseArtifact (Ed25519).
  - Hand to return endpoint (HTTP callback to workspace by default).
- **LISTENS TO**: Compile-input mailbox.
- **DROPS / WRITES**: FinalResponseArtifact (signed). Return delivery
  to workspace.
- **FORBIDDEN**:
  - Calling LLMs (deterministic mode).
  - Making governance decisions.
  - Mutating mailbox items.
  - Interpreting prose content (opacity rule — guards see metadata only).
  - Writing back to the template registry at runtime.
- **REFERENCE IMPL**: deterministic assembler + DeterministicRenderer
  (currently skeleton; needs template-aware production build).
- **TARGET ADAPTERS**: on-prem synthesis agent (compile-mode 2),
  frontier synthesis agent (compile-mode 3), customer-built assembler.

### K. Admin Dashboard (BAKED — not plug-and-play)

- **WHAT**: Operator's setup + audit surface. Ships in web UI and
  (eventually) CLI form.
- **RESPONSIBILITIES**:
  - Secondary auth (timed JWT or timed API key). Not every human has a
    key; admins do.
  - All writers for system setup: target systems, agents, LLMs,
    identity providers, RBAC config, orchestrator config, lexicon
    mutations (DOUBLE-admin signed), compile config, mailbox config,
    workspace config, approval channels, connectors, endpoints,
    webhooks, keys, toolchains.
  - Mode controls (observe / advisory / enforcing) with signed envelopes.
  - OCT level management.
  - Policy + keypair + signing key management.
  - Read access to all ledgers, audit trails, run logs.
  - Lexicon-signal + unmapped_prompt review queues; propose lexicon
    additions; second admin signs to land.
- **LISTENS TO**: Admin UI input. (Reads from ledgers, registries.)
- **DROPS / WRITES**: Signed config updates. Mode envelopes. Key
  registrations. Lexicon mutations (after double-admin signing).
- **FORBIDDEN**: Acting as runtime authority (admin writes config;
  runtime enforces).

### L. LLMs (PLUG-AND-PLAY via adapter)

- **WHAT**: The pool of language models Nexus can route to.
- **RESPONSIBILITIES**: Receive prompt fragments (only their slice).
  Produce response text. Nothing else.
- **MODEL TIER BUCKETS**: every LLM sits in a tier bucket
  (`on_prem_general`, `on_prem_sensitive`, `frontier_general`,
  `frontier_sensitive`). NVG reads the bucket as the first-line "what
  can this LLM touch."
- **LISTENS TO**: Invocation via NVG.
- **DROPS / WRITES**: Response text → NVG → post-firewall mailbox.
- **FORBIDDEN** (Hard Law #7): Tool descriptors. Knowing about the plan.
  Picking the next agent. Seeing other agents' slices.
- **ADAPTERS**: Ollama, Anthropic, OpenAI, MCP-wrapped models,
  customer-hosted.

### M. Connectors (PLUG-AND-PLAY)

Two distinct surfaces sharing one component (and one governance regime):

- **SURFACE 1 — Target-system connectors**: the tool-call chain NXS uses
  to perform real CRUD on customer systems. Email, databases,
  spreadsheets, CRM, file servers, accounting software. Adapter per
  system type.
- **SURFACE 2 — AI-ecosystem adapters**: the bridge that lets MCP
  servers, OpenAI-style chains, Langgraph, Cursor, Copilot, etc., plug
  into Nexus so they get governance + firewall + isolation while still
  being usable.
- **WHY ONE COMPONENT**: both surfaces share registration, signing,
  dispatch primitives. Both are governed the same way.
- **LISTENS TO**: Dispatch from NXS (surface 1) or from the appropriate
  adapter shim (surface 2).
- **DROPS / WRITES**: Connector result → NXS → mailbox.
- **FORBIDDEN**: Acting outside registered scope. Calling other
  connectors. Holding state across runs.

### N. Manifest Manifold (BAKED)

- **WHAT**: The plug-and-play hub. The single registry of all seams
  where plug-and-play components attach. APIs, hooks, endpoints,
  factory registrations.
- **RESPONSIBILITIES**:
  - Hold registration of every plug-and-play implementation currently
    active (which Orchestrator type, which Mailbox backend, which IAM
    adapter, which LLM adapters, which connectors, which agent runtimes).
  - Validate at bootstrap that every required seam has a registered
    implementation.
  - Provide discovery to runtime modules ("give me the active Mailbox").
  - Enforce factory-registry signatures at boot.
- **LISTENS TO**: Bootstrap loader.
- **DROPS / WRITES**: Registry state consumed by the rest of the runtime.
- **FORBIDDEN**: Authorizing actions. Calling LLMs. Mutating at
  runtime (changes go through admin → re-bootstrap or signed-hot-swap).

---

## §4 Cross-Cutting Concerns

### O. Identity / OCT / Delegation

- The runtime translation of RBAC's claims into something every
  governance gate can read.
- **OCT** = actor's classification ceiling. Set at registration. Cannot
  be lowered at runtime; can be raised by signed policy.
- **Delegation** = the scoped, signed authority orch grants each agent
  for one run (which capabilities, which systems, which OCT, valid for
  this runId, expires at T).
- Every signed envelope carries delegation context.
- Run effective permissions per Hard Law #15 (SYMMETRIC intersection,
  always the lesser).

### P. Run Ledger

- The forensic, replayable record of every event in a run.
- Append-only. Signed. Ordered by monotonic run-sequence (not
  wall-clock).
- Every gate decision, mailbox allocation, drop, pickup, plan trace,
  plan callback, plan amendment, lexicon_signal, unmapped_prompt,
  claim_drift_detected, final_response — all here.
- Workspace reads ledger projections for run progress. Admin reads
  ledger for audit.

### Q. Mode + Mode Signing

- Three modes:
  - **Observe** — full governance evaluation runs; nothing blocks. Every
    gate logs "would have denied/allowed" but run continues. Used to
    dry-run new policies.
  - **Advisory** — gates evaluate and emit warnings to workspace/audit;
    still don't block. Used during policy rollout.
  - **Enforcing** — gates evaluate AND block. Failures fail-closed.
- Mode changes are signed envelopes (Ed25519, admin key).
- **Threshold within enforcing**: signed policy defines, per
  `(target_system, action, OCT_level)`:
  - **auto-allow** — action proceeds without human approval (e.g.,
    "read from CRM always OK for sales role").
  - **approval-required** — action halts; approval request goes to
    approver(s) via approval channel; human decides; action proceeds
    or halts.
  - **forbidden** — hard-deny; no approval can unlock.
- In observe/advisory: thresholds are evaluated for logging only.
- In enforcing: thresholds are enforced; approval-required actions
  halt until human responds.
- **The orch's callback to user uses the same approval-channel
  infrastructure** as governance-gate approvals — one user-facing
  approval surface, different originating gates. User sees a unified
  "things waiting on you" list.

### R. Approval Channels (PLUG-AND-PLAY)

- The mechanism by which approvals (from governance gates OR orch
  callbacks) reach a human.
- Reference channels: CLI, dashboard (web UI), webhook, Slack.

### S. Signing Keys

- Every admin principal gets a server-side keypair (browser never holds
  the key).
- Keys live in `keys/admins/<principalId>.keypair.json` (perms 0600).
- Companion `public.json` for verification.
- Used to sign: mode envelopes, policy envelopes, approval responses,
  compile artifacts, template ingestions, lexicon mutations,
  delegation envelopes.
- **Lexicon mutations specifically require two distinct admin
  signatures** (double-admin pattern).

---

## §5 Run Types

Four run types, three user-facing modes (chat / sectioned /
secure-rails) + reference-workspace as a planner-decided shape of a
chat run.

### 1. Chat

- Simple prompt → LLM → response. May or may not have an agent.
- Doesn't touch a target system unless the prompt requests one (in
  which case NXS gets involved and it's still chat — the user just
  asked for an action).
- Flow: Workspace → Orch (pass-through or split per lexicon) → NVG
  (firewall + LLM) → Agent (if one) → Compile (pass-through if no
  contract) → Return.
- Output: text, file, data — whatever the LLM/agent produced.

### 2. Reference-Workspace (planner-decided shape of a chat run)

- Not a separate user-facing mode. Deleted as a manual toggle.
- Triggered automatically when the planner decides a chat-mode prompt
  needs multi-agent fan-out. Has one or more agents, no output
  contract, tool calls by Nexus, routing on-prem/off-prem by NVG,
  may have loops where multiple agents do multiple things.

### 3. Sectioned

- Structured run with template, output contract, multi-agent capability,
  loops, tool calls, output formats, execution modes (human-in-the-loop
  / autonomous).
- Can involve NXS but doesn't have to.
- Flow: Workspace (template + sections) → Orch (plans against
  template) → NVG/NXS (per node) → Agents → Compile (assembles per
  template) → Return.

### 4. Secure Rails

- Most secure run. Handles most delicate data.
- **Bypasses orch's planning** (still logged; orch acts as a thin pass)
  → straight to NVG → NXS if needed.
- Rarely off-prem (unless to a secure cloud storage).
- The secure agent picks up data from its mailbox after NVG/NXS
  dropped it; works the data; returns directly to workspace.
- Can have an output contract running through deterministic compile —
  rare, but possible if combining secure runs or merging secure +
  unsecure run data.

---

## §6 End-to-End Flow

### §6.1 Generic happy path

```
1. Human signs in at IAM → session token issued
2. RBAC populates claims envelope for this principal
3. Workspace UI loads; selectors populated (visible vs. grayed by claims)
4. Human enters prompt + optional files + suggests agent/LLM/run-type
5. Workspace opens runId; assembles WorkspaceRunRequest; sends to Orch

6. Orch reads claims + prompt + selections
7. Orch's planner inferences via lexicon mini-substrate (A* costed search):
   a. Determines inside-the-wall vs outside-the-wall
   b. Returns ranked candidate intents with confidence per arena
   c. Hard-code / Ask decision:
      - single high-confidence candidate → hard-code plan
      - ambiguous (multiple within ε) → callback to user with top-N + ε
      - nothing above threshold → callback "rephrase or cancel"
   d. Picks workflow template (or single-node) per matched intent
   e. Assigns mailboxes:
      - per-actor input mailboxes for agents
      - NXS-drop mailbox(es) for any nxs_dispatch nodes
      - NVG-drop mailbox(es) for any nvg_dispatch nodes
      - compile-input mailbox
      - orch-input mailbox
   f. Picks output contract from template DB (or none)
   g. Splits prompt: NVG-slice, NXS-slice, per-agent-slice

8. Orch sends plan preview back to workspace
   - User: accept → continue
   - User: deny+send-anyway → orch passes original prompt unchanged
   - User: restart → run killed by USER (not orch); new run starts
   - User: pick-from-candidates → orch logs lexicon_signal and executes
     chosen path

9. Orch issues signed delegations per node and dispatches:
   - nxs_dispatch nodes: orch → NXS → connector → result+receipt → NXS-drop mailbox
   - nvg_dispatch nodes: orch → NVG → firewall check → LLM → sandbox return
     → precheck → NVG-drop mailbox

10. Agentic agent runtime(s) listen on assigned input mailboxes
    - On drop: pre-process if needed; invoke paired LLM via NVG if needed;
      post-process
    - Drop final per-node artifact to:
      → COMPILE mailbox (work done for this run leg)
      → ORCH mailbox (work needs to continue: next agent, write back to
        a target system, fetch more data)

11. If orch sees orch-mailbox drop needing another target-system touch:
    - opens a NEW run (checkbackSourceRunId pointing at this run)
    - new run goes back through governance from step 6
    - this is the multi-run flow

12. Compile listens on compile-input mailbox
    - Output contract present: assemble per template + run guards + sign
    - No contract: pass-through verbatim

13. Compile hands signed FinalResponseArtifact to return endpoint
14. Return endpoint delivers to workspace
15. Workspace renders to human (or hands back to autonomous agent operator)
16. Run closed; ledger sealed
```

### §6.2 Canonical worked example — month-end sales table

User prompt:

> "Pull last month's sales from the sales database, list in a table with
> headers Date | Item | Quantity | Shipped | Return Customer. Use output
> contract template 001 (month-end sales data table)."

```
PROMPT enters workspace → runId R1 opens

Orch planner inferences via lexicon:
  verb: "pull" → READ (confidence 0.95 in business_data arena)
  target: "sales database" → system=sales (confidence 0.98)
  operand: "last month" → time-bounded query
  format: "table with headers ..." + "output contract template 001"
  → intent matched: sales.list_monthly + output_contract=template_001
  → confidence above threshold → hard-code plan (no callback)

PLAN:
  Node 1: nxs_dispatch
          query: SELECT * FROM sales_records WHERE month=last
          drops to → mbx-sales_agent (NXS-drop mailbox)

  Node 2: agent=sales_agent
          listens to → mbx-sales_agent
          work: take rows, format as Date|Item|Qty|Shipped|Return table
                (LLM-paired runtime — invokes paired LLM via NVG for
                 the formatting step)
          drops to → mbx-compile (compile-input mailbox)

  Compile: listens to → mbx-compile
           template_001 (month-end sales data table)
           fills slot by slot per template
           assembles final artifact

  Return: signed FinalResponseArtifact → workspace renders the table

EVERY DROP AND PICKUP HAPPENS IN A MAILBOX.
EVERY GOVERNANCE GATE (NXS reading sales_records, NVG invoking the
LLM for formatting) IS MEDIATED THROUGH ORCH.
THE AGENT NEVER REACHES OUTSIDE ITS MAILBOX SURFACE.
```

### §6.3 Variant — same prompt but missing permission

If user lacks `read:sales_records` per current RBAC, NXS callback at
step 9 returns claim mismatch (Hard Law #14) → NXS halts the
nxs_dispatch node → `claim_drift_detected` ledger event → workspace
receipt explains. The run does NOT continue to compile. The user sees
a clean explanation: "Your RBAC permissions for sales_records were
revoked at HH:MM:SS; the action could not proceed."

This is NXS killing the run (allowed per Hard Law #4). NOT orch.

---

## §7 State Today — what's built vs. what this outline requires

| Item | Outline requires | Code today | Gap |
|---|---|---|---|
| IAM/Auth plug-and-play | Yes | Reference impl works | None |
| RBAC populates full claims envelope | Yes | Reference impl partial | Claims schema needs full enumeration in §B |
| RBAC callback verification (Hard Law #14) | Yes | Unclear — needs code audit | Verify; if missing, build |
| Workspace plug-and-play | Yes | Web UI works | CLI version pending |
| Workspace deletes "reference workspace" mode | Yes | 4 modes currently exposed | Needs UI change |
| Orch cannot kill a run (Hard Law #4) | Yes | Code returns `PlanRejection` with terminal reasons | Code + spec violate; need rework |
| Orch is plug-and-play | Yes | One reference impl | Other adapters pending |
| Lexicon as mini-substrate (entity/edge/A*/Hard-code-or-Ask) | Yes | Flat tables; 3 intents; 22 terms; no WordNet | Major build needed |
| WordNet seed wired | Yes | 121KB fixture exists, unwired | Wire it |
| governed-verb-lexicon (563 mappings) wired | Yes | Fixture exists, unwired | Wire it |
| Confidence-per-arena scoring | Yes | None | Build it |
| A* costed search with budget | Yes | Token-overlap matching only | Build it |
| Hard-code / Ask pattern | Yes | Silent rejection or LLM fallback | Replace with callbacks |
| Lexicon guards as architectural invariants | Yes | None | Build ci:gate + runtime guards |
| Double-admin signing for lexicon mutations | Yes | Multi-admin spec pending | Ratify spec + apply to lexicon |
| Lexicon-signal admin review loop | Yes | None | Build event + admin queue |
| Agent has runtime (Hard Law #9) | Yes | Agent is registry record only | Major build needed |
| Agent listens to mailboxes | Yes | Dispatcher pushes; no listener | Build agent runtime listener |
| Agent drops to compile OR orch mailbox | Yes | Drops to per-actor mailbox; compile reads via list, orch doesn't read | Add compile-input + orch-input mailbox roles |
| Agent cannot talk to NXS/NVG (Hard Law #16) | Yes | Possible in current code? — needs audit | Verify; if possible, build guard |
| Multi-run when work touches another system (Hard Law #12) | Yes | Mid-run amendment only | Build second-run pattern |
| NXS drops receipt + data | Yes | NXS drops data | Make receipt explicit |
| NVG sandbox return + precheck + mailbox drop | Yes | Path exists | Precheck pipeline needs virus/malware/data-sniffing for production |
| Compile pass-through (Hard Law #11) | Yes | Works | None |
| Compile template-aware renderer | Yes | Skeleton | Production build needed |
| Mailbox plug-and-play | Yes | Reference backend works | Smart mailbox is plug-and-play extension |
| Mailbox-pit per-actor isolation | Yes | Spec ratified; build in flight | Add orch-input + compile-input roles to allocation taxonomy |
| Connectors (target-system + AI-ecosystem surfaces) | Yes | Target-system only today | AI-ecosystem surface needs explicit adapter shim |
| Manifest manifold | Yes | Factory registry partial | Needs full registration coverage |
| Admin dashboard | Yes | 11 commits landed; 5 follow-on specs pending | The 5 deferrals (in-browser approval, multi-admin signing, OCT-level UI, policy-bundle, lexicon admin UI) are V1 per "don't defer" rule |
| Mode signing | Yes | Built | None |
| Approval channels | Yes | Built | Adapters pending |
| Ledger | Yes | Built | None |
| Signing keys (server-side) | Yes | Built | None |
| Delegation chain symmetric intersection (Hard Law #15) | Yes | Code today applies delegator-side only | Revise NXS gate logic |

---

## §8 Outstanding questions for owner

These items are real and need an owner decision before downstream
spec/build can proceed:

1. **RBAC callback verification** — is the carried-claims-plus-callback
   pattern currently built in code? Need to verify before treating as
   "already there." Decision: do a code audit first, or accept it as
   a V1 requirement to build/verify?

2. **Lexicon mini-substrate scope** — confirm: WordNet seed + governed-
   verb-lexicon + entity/edge model + A* search + Hard-code/Ask +
   double-admin mutation is the V1 surface. Larger Hartonomous patterns
   (PostGIS modality, Glicko-2 full, Merkle DAG, cross-lingual) are
   not V1.

3. **Cost-routing relocation** — confirm: "pick on-prem for simple,
   frontier for hard" moves from NVG to planner. NVG keeps the
   permission veto.

4. **Second-run vs. mid-run amendment** — confirm: when an agent's
   work needs to touch a system again, orch opens a NEW run (with
   checkbackSourceRunId). Mid-run amendment is retired or scoped to
   non-system-touching extensions only.

5. **Agent runtime contract** — single contract supporting the spectrum
   (deterministic / LLM-paired / multi-step / autonomous / timed /
   shim) is the V1 design. Build the contract; reference implementations
   come per-variant as needed.

6. **Workspace mode collapse** — confirm: reference-workspace as a
   user-facing radio button is deleted. The shape exists but is
   planner-decided, not user-chosen.

---

## §9 Glossary / Vocabulary

| Term | Meaning |
|---|---|
| **Actor** | A registered principal (human or agentic agent). Always has actorId, capabilities per RBAC, OCT classification. |
| **Agentic Agent** | An agent that operates under a human's authority. Treated as an actor with delegation chain back to the originating human. |
| **Agent Runtime** | The code that runs as the agent. Listens on mailbox, may pair with LLM, drops to next mailbox. Spectrum from pure-deterministic through full-agentic. |
| **Arena** | A domain context for confidence scoring in the lexicon (e.g., `warehouse_operations`, `medical`, `business_data`). Same prompt routes differently per arena. |
| **Callback** | Orch's mechanism for asking the user to decide when planner can't unambiguously hard-code. Routes through approval-channel infrastructure. |
| **Carried Claims** | RBAC's claims envelope traveling with the request through downstream modules. Verified via callback at every gate. |
| **Checkback Source Run ID** | The runId of the original run when a second run is opened to continue work that needs to touch another system. |
| **Compile Template** | A signed, admin-ingested layout manifest defining sections, slots, and guards for output assembly. |
| **Delegation Envelope** | A signed scoped authority granted by orch to an agent for one run. Time-bounded. Capability-bounded. |
| **Hard-code / Ask** | The planner's decision pattern: confident → hard-code (deterministic plan); ambiguous or unknown → callback (ask user). Never guess. |
| **Mailbox** | Per-(runId, actorId, role) isolated drop/pickup point. The only data hub between modules. |
| **Mini-Substrate** | The Nexus-sized version of Salty's Hartonomous substrate. Entity/edge/significance/A*/guards, scoped to lexicon. |
| **OCT** | Operator Classification Tier — the actor's classification ceiling. |
| **Output Contract** | Per-run metadata about what mailbox items exist for compile. Distinct from CompileTemplate. |
| **Receipt** | What NXS drops in addition to (or instead of) data when an action writes/moves/deletes/creates on a target system. Agents pick up receipts to confirm action happened. |
| **Run** | One end-to-end execution from workspace prompt to workspace return. Has unique runId. May trigger a second run via orch-input mailbox. |
| **Run Ledger** | Append-only signed forensic record of every event in a run. Ordered by monotonic run-sequence. |

---

## §10 What this outline does NOT cover

- Specific UI design (workspace look-and-feel, admin dashboard layout).
- Specific connector implementations (which database drivers, which
  CRM adapters).
- Specific LLM adapters (Ollama-specific, Anthropic-specific wire
  format).
- Performance / latency targets.
- Multi-tenant deployment topology.
- Disaster recovery / backup.
- Pricing / licensing model.

These belong in downstream documents that reference this outline.

---

*End of v0.1.0 alignment outline.*

*This document supersedes the implicit model in scattered specs. When
a spec or piece of code conflicts with this outline, the outline wins.
Specs and code revise to match.*

*Version history:*
*v0.1.0 — 2026-05-18 — initial ratification. Hash session 2026-05-17/18.*
