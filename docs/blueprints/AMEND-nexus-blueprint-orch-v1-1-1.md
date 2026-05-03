# Blueprint Amendment K — Orchestrator Reference Architecture
# Version: v1.1.1
# Date: 2026-05-02
# Status: RATIFICATION-READY — audit rounds 1-3 complete, no open blockers
# Amends: nexus-blueprint-v1-5-13.md §11 (Orchestration Plane)
# Hash session: S24-S25 (ORCH-HASH-SESSION-LOG.md)
# Audit round 1: v0.1.0 — 6 critical, 4 medium (all resolved)
# Audit round 2: v0.2.0 — 1 critical, 4 medium (all resolved)
# Audit round 3: v0.3.0 — 0 critical, 1 medium (resolved below)
# Author: Claude (deterministic build agent), under owner direction
# Owner: James Huson / Lake Area LLC
#
# This amendment extends blueprint §11 with four new subsections (§11.4–§11.7).
# Existing §11.1–§11.3 are preserved with one clarifying addition to §11.1.
# No other blueprint sections are modified by this amendment.
#
# v1.1.1 changes from v0.3.0 (audit round 3 — single wording fix):
# - K3-M01: FIXED — §11.7.3 replaced "signed policy authorization" with
#           "manifest-declared structural constraint." Prevents builder misread
#           of planner performing policy inspection.
#
# v0.3.0 changes from v0.2.0 (surgical — no rewrite):
# - K2-F01: FIXED — removed policy-based hard deny from §11.7.3 (internal
#           contradiction with §11.4.5 planner authority bounds). Replaced with
#           orchestration-feasibility framing.
# - K2-M01: FIXED — §11.7.1 clarified identity-provider ceiling as catalog
#           visibility filter, not authorization.
# - K2-M02: FIXED — §11.6.5 timestamp reframed as evidence metadata, not
#           replay ordering authority.
# - K2-M03: FIXED — scope statement adds composition-root guard for reference
#           harness routes.
# - K2-M04: VERIFIED — MailboxManifestRecord confirmed to contain payloadTtlSeconds,
#           classificationRequired, digestRequired. No guard needed.
#
# v0.2.0 changes from v0.1.0:
# - K-F02: Added §11.4.5 Planner Authority Bounds (explicit shadow-governor prevention)
# - K-F03: Added §11.5.4 Tier Precedence Law (OCT floor, policy elevation, config preference)
# - K-F04: Added §11.6.5 Replay Determinism Law (ledger sequence for parallel DAGs)
# - K-F05: Added cross-reference to existing mailbox contracts (not re-specified)
# - K-F06: Added cross-reference to existing layer placement (not re-specified)
# - K-M01: Added rationale for core vs pluggable designation
# - K-M02: Tightened informal language ("fits or return to sender" → formal)
# - K-M03: Added §11.7.4 Anti-Recursion Law (hard law, not soft guidance)
# - K-M04: Added §11.6.6 Plan Amendment Governance (re-plan triggers governance checks)
# - K-F01: REJECTED — blueprint already contains this level of boundary definition
#           throughout (§12 actor classes, §17 gate behavior, §19 approval law).
#           Spec references back to blueprint. Boundary definitions stay.
# - K-F05: PARTIAL — mailbox law already exists in canon. Cross-reference added,
#           not re-specification.
# - K-F06: REJECTED — layer placement already established by ext-infra build.
#           Cross-reference added.

---

## Amendment K — Scope Statement

This amendment defines the reference orchestrator's modular internal architecture,
component pluggability contract, prompt visibility tiers, execution model, and
agent-selection behavior. It does not change the orchestrator's external governance
posture (governed actor, OCT assigned, NXS/NVG envelope) or its position in the
governed loop.

Blueprint §3 ("The Nexus Stack is not... an orchestrator") remains in force. The
stack does not become an orchestrator. The stack ships a **reference orchestrator**
as a replaceable plugin — the same pattern as the reference identity adapter (§6),
the reference deterministic renderer (§21), and all socket-based externals. The
enterprise may use the reference, replace it entirely, or replace individual
components within it.

**Layer placement:** The orchestrator is an external governed component connected via
the lawful socket boundary defined in AMEND-spec §3.3. It lives outside the engine
packages. Its contracts reside in `packages/contracts/src/externals/` alongside all
other socket contracts. Its reference harness route resides in `packages/interfaces/`.
This follows the same placement pattern as workspace, mailbox, and compiler sockets.
See blueprint §27 (Monorepo Package Structure) and §7.2 (Layer Import Rules).

Any reference harness route in `packages/interfaces/` must receive pre-constructed
services through the lawful composition root. It must not compose engine internals,
planner internals, or adapter internals locally. Composition belongs to bootstrap.

---

## §11.1 Amendment — Modular Component Clarification

**Append to existing §11.1, after the responsibilities list:**

> The orchestrator fulfills its responsibilities through modular internal components.
> These components are independently replaceable where the blueprint designates them
> as pluggable. The reference orchestrator ships with reference implementations of
> all components. An enterprise may:
>
> 1. Replace the entire orchestrator — all internal components go with it.
>    The governance envelope (actor registration, OCT, delegation, NXS/NVG routing)
>    is reimplemented by the enterprise orch against the same stack contracts.
>
> 2. Replace an individual pluggable component inside the reference orchestrator —
>    the remaining components continue operating unchanged.
>
> Both levels of replacement are first-class supported. Neither requires engine,
> contract, or governance-layer changes. This is the orchestrator portability law.

---

## §11.4 Orchestrator Component Architecture (NEW)

### §11.4.1 Component Inventory

The reference orchestrator is composed of four architectural components:

**Planner** — PLUGGABLE

Receives a structured request. Produces an execution plan (DAG structure with nodes,
edges, dependencies, conditions). The planner is where task interpretation and agent
selection occur — per §11.1 responsibilities. The planner consults the agent registry
to identify capable agents.

V1 reference planner: deterministic. No LLM. Evaluates request metadata,
selectedAgentIds hints, and registry capabilities. Produces a structured execution
plan or returns a typed rejection with reason. No ambiguity: the plan is valid and
complete, or the rejection states why.

The planner interface is the replacement boundary. Future planners (policy-template,
LLM-assisted, inference substrate) slot in here without touching execution,
coordination, or governance. If an LLM-assisted planner is used, that model-bound
call must route through NVG under the orchestrator actor's OCT ceiling.

Pluggable designation rationale: the planner has a clean functional boundary — structured
input in, structured plan out, no shared mutable state with executor or coordinator.
This makes independent replacement safe without creating state-split.

**DAG Executor** — CORE (replaceable only via whole-orch swap)

Receives a confirmed execution plan. Executes it deterministically:
- Fires independent nodes in parallel
- Tracks dependency resolution between nodes
- Handles wait gates (node B waits for node A's output)
- Evaluates conditional branches (if condition → activate additional path)
- Enforces timeout policy per node and per run
- Handles partial completion per policy
- Reports node-level status to the run coordinator

The DAG executor is deterministic. It does not interpret prompts, select agents,
or make LLM calls. It executes the plan the planner produced.

Core designation rationale: the executor and coordinator share tight internal state —
run lifecycle, node status tracking, mailbox assignments, delegation issuance timing.
Separating them at an interface boundary would force externalizing run state that is
inherently tightly coupled. Independent replacement of one without the other would
create state-split across the boundary. Whole-orch replacement keeps the coupling
contained.

**Run Coordinator** — CORE (replaceable only via whole-orch swap)

Manages the run lifecycle across all components:
- Receives WorkspaceRunRequest from workspace
- Passes request to planner
- If planCheckback requested: sends plan preview to workspace for user review
- On plan confirmation: passes plan to DAG executor
- Assigns mailboxes for each node and intermediate data hops
- Issues delegation to each agent — scoped, signed, bounded by orch ceiling
- Tracks run state and run ID propagation
- Invokes compile step when DAG resolves (fully or partially per policy)
- Passes compiled result to workspace via compile-return path

Core designation rationale: same as DAG executor — shared run lifecycle state.

**Governance Envelope** — NON-NEGOTIABLE (never replaceable independently)

The orchestrator's governance posture is not a component — it is the environment:
- Orchestrator is a registered actor with actor profile, OCT, delegation authority
- Every agent dispatch goes through NXS/NVG (or NVG-bypass per §13.9)
- Every delegation issuance follows §11.3 delegation law
- Every run produces Run Ledger entries
- The governance envelope is present regardless of which planner or executor is used
- Governance is not configurable, not optional, not bypassable

### §11.4.2 Component Dependency Law

```
WorkspaceRunRequest
        |
        v
  Run Coordinator ──→ Planner (pluggable)
        |                  |
        |                  v
        |            Agent Registry (read-only)
        |                  |
        |                  v
        |            Execution Plan
        |                  |
        v                  v
  Plan Checkback?    DAG Executor
  (workspace review)       |
        |                  v
        v            Node dispatch ──→ NXS / NVG
  Confirmed Plan           |
        |                  v
        v            Mailbox collect
  DAG Executor             |
        |                  v
        v            Compile invocation
  Run complete             |
        |                  v
        v            CompileReturn → Workspace
  Run Ledger closed
```

- The planner depends on the agent registry (read-only query)
- The DAG executor depends on the governance envelope (dispatch through NXS/NVG)
- The run coordinator depends on all other components
- No component depends on the planner implementation — only the planner interface
- The governance envelope depends on nothing inside orch — it depends on NXS/NVG/stack

### §11.4.3 Planner Interface Contract

The planner interface is the pluggability boundary. A planner is selected by
manifest-governed discriminator, resolved by the planner factory registry at
bootstrap. The interface defines:

- Planner identity: type discriminator and version
- Single entry point: receives structured request and registry access, returns
  execution plan or typed rejection
- Typed rejection must include: reason code and (optionally) suggested alternatives

The planner receives:
- The structured request (visibility-tier-aware — see §11.5)
- Read-only access to the agent registry

The planner returns either:
- A valid execution plan: nodes, edges, dependencies, conditions, agent assignments
- A typed rejection: reason code, suggested alternative agents (if any)

### §11.4.4 Replacement Law

**Whole-orch replacement:**
- Enterprise implements the Orchestrator socket interface (AMEND-spec §3.3)
- Enterprise registers a new OrchestratorFactory with a new orchestratorType
- Manifest points to the new type
- Bootstrap factory resolution picks up the new implementation
- No stack code changes required

**Planner-only replacement:**
- Enterprise implements the planner interface
- Orchestrator manifest discriminator selects the new planner type
- Reference orch executor and coordinator continue unchanged
- If planner uses LLM: model call must route through NVG per §11.1

### §11.4.5 Planner Authority Bounds

The planner is an orchestration feasibility engine. It is not a governance engine.

The planner MAY:
- Reject requests for orchestration feasibility reasons: no agent in registry has
  the needed capability, request is structurally malformed, request exceeds
  structural limits (e.g., maxSplitDepth)
- Suggest alternative agents when the requested agent lacks a capability but
  another agent in the registry has it
- Interpret task structure to determine single-agent vs multi-agent decomposition
- Consult the agent registry for capability matching

The planner MUST NOT:
- Perform authorization decisions (NXS Gate 01 is the authority)
- Perform risk adjudication (NXS Gate 02 is the authority)
- Evaluate or enforce policy rules (NXS Gate 04 is the authority)
- Enforce OCT ceilings (NVG and Gate 02 are the authorities)
- Deny based on data classification (NVG is the authority)
- Substitute for, pre-empt, or duplicate any NXS or NVG governance decision
- Access or inspect prompt content in OCT-SECURE mode (see §11.5.3)

A planner that performs governance decisions is a trust boundary violation.
The planner proposes. NXS/NVG disposes. This separation is non-negotiable.

If a planner rejects a request, the rejection reason must be an orchestration
feasibility reason — never a governance reason. Governance reasons are for
NXS/NVG to produce, with proper evidence, through the proper gates.

---

## §11.5 Prompt Visibility Tiers (NEW)

The orchestrator's view of user prompt content is governed by three visibility tiers.
These tiers are an extension of the OCT system (blueprint §8) applied to the
orchestrator boundary.

### §11.5.1 Normal Mode

The orchestrator receives the full WorkspaceRunRequest including prompt content.
The orchestrator (specifically, the planner component) may use prompt content for
task interpretation, agent matching, and capability routing.

Applicable when: agents do not require content isolation from the orchestration layer.

### §11.5.2 Metadata Mode

The requesting agent or workspace pre-transforms the prompt into structured metadata
before it reaches the orchestrator. The orchestrator receives only:
- Needed agent types / capability identifiers
- Needed system targets
- Template reference (if applicable)
- Task shape metadata (number of sub-tasks, expected output types)

The orchestrator never sees prompt text. The prompt remains in the workspace boundary
or the requesting agent's context.

Applicable when: the enterprise wants to limit prompt exposure to the orchestration
layer without requiring full OCT-SECURE isolation.

### §11.5.3 OCT-SECURE Mode

The orchestrator receives only authentication and authorization tokens. It validates:
- Actor permissions
- Delegation authority
- OCT ceiling compatibility

The orchestrator grants passage and assigns mailboxes. It never sees prompt content,
structured metadata, or any representation of what the user asked. The secure agent
handles everything internally, routing its own NVG/NXS calls under its delegation.

Applicable when: OCT-SECURE agents handle sensitive work that must not be visible
to any infrastructure component outside the agent itself.

### §11.5.4 Tier Precedence Law

Tier selection follows a strict precedence where security constraints always dominate:

1. **OCT floor (non-negotiable):** If the actor's OCT assignment is OCT-SECURE, the
   visibility tier is OCT-SECURE. No policy, configuration, or operator action may
   lower it. This is the hard wall applied to the orchestrator boundary.

2. **Policy elevation:** Signed policy may elevate the visibility tier (normal →
   metadata). Policy may never lower a tier that OCT has set. Policy may never
   lower OCT-SECURE to metadata or normal.

3. **Run configuration preference:** Run-level configuration may request metadata
   mode. This is advisory — policy overrides it, OCT overrides both.

4. **Default:** Normal mode when no elevation or OCT floor applies.

The direction is one-way: tiers may only be raised (toward more restrictive), never
lowered below the OCT floor. Any attempt to lower a visibility tier below the actor's
OCT-imposed floor is a trust boundary violation.

---

## §11.6 Execution Plan Model (NEW)

### §11.6.1 Execution Plan Structure

The execution plan produced by the planner is a directed acyclic graph (DAG) of
task nodes with typed edges representing dependencies and conditions.

A task node represents one agent assignment:
- Agent identity (from registry)
- Task description or metadata (per visibility tier)
- Required checkpoints (NVG, NXS, or both)
- Expected output slots
- Timeout policy

An edge represents a dependency or condition:
- Data dependency: node B requires node A's output as input
- Conditional activation: node C activates only if node A's output meets a condition
- Sequential handoff: node B starts after node A completes (ordering, no data flow)

### §11.6.2 DAG Execution Law

The DAG executor follows these invariants:

- Independent nodes (no incoming dependency edges) may execute in parallel
- A dependent node fires only when all its incoming dependencies are resolved
- Conditional nodes fire only when the condition evaluates to true
- Every node dispatch goes through the governance envelope (NXS/NVG)
- Every node produces a Run Ledger entry regardless of outcome
- Timeout on any node follows the timeout policy: default is fail the node, not the run
- Partial completion is permitted per policy — a run may complete with some nodes
  failed if policy allows partial results
- The DAG executor does not modify the plan — it executes what the planner produced

### §11.6.3 Cross-Agent Data Sharing

Agent A's output may be required as input to Agent B. This data sharing is governed:

- Agent A's result is written to mailbox by the output collector
- The run coordinator routes the result through NXS/NVG to Agent B's preflight
- Agent B receives the data only if governance permits (OCT ceiling, data classification,
  delegation scope all checked)
- There is no direct agent-to-agent data channel — all cross-agent data flows through
  the governed mailbox and checkpoint infrastructure
- The orchestrator sets up intermediate mailbox assignments for each inter-node data hop

Mailbox contract law for intermediate hops follows the existing mailbox contracts
(AMEND-spec §3.4, §3.4.1). Retention policy, digest requirements, classification
requirements, and payload TTL are governed by the MailboxManifestRecord already in
canon. This amendment does not create a separate mailbox regime — intermediate hops
use the same governed mailbox surface as all other mailbox operations.

### §11.6.4 Scope Boundary — V1 vs Deferred

**V1 scope (this amendment):**
Single-run, single-orchestrator DAG execution. One orchestrator receives one request,
builds one plan, executes one DAG, produces one compiled result.

**Deferred (blueprint §36.2, unchanged):**
Multi-party orchestrator — orchestrators delegating to other orchestrators, forming
orchestration trees. This remains explicitly deferred. The V1 DAG executor handles
multiple agents within a single orchestrator, not nested orchestration.

### §11.6.5 Replay Determinism Law

Parallel DAG execution may produce non-deterministic physical completion ordering.
The ledger must remain forensically reproducible regardless of physical timing.

Deterministic replay is ensured by:

- **Plan order index:** Every node in the execution plan receives a deterministic
  index assigned at plan creation. This index is immutable for the life of the run.
- **Dependency resolution event record:** When a dependency edge is satisfied, the
  resolution is recorded as a run-scoped event. The wall-clock timestamp is evidence
  metadata only — it does not participate in deterministic ordering.
- **Monotonic run sequence:** The run coordinator maintains a monotonic sequence
  counter for all run-scoped events (node dispatched, node completed, dependency
  resolved, condition evaluated). This counter is the sole ordering authority for
  replay. Deterministic ordering is governed by plan order index and monotonic run
  sequence — never by wall-clock timestamps.
- **Ledger ordering:** Run Ledger entries for a given run are ordered by the
  monotonic run sequence, not by wall-clock arrival. Physical parallelism does
  not produce non-deterministic ledger order.

A replay of a completed run must produce the same ledger sequence when given the
same execution plan, the same node outcomes, and the same dependency resolutions.
If replay produces a different sequence, that is a replay integrity violation.

### §11.6.6 Plan Amendment Governance

Mid-run plan amendment occurs when an agent's output indicates additional work is
needed beyond the original plan (e.g., agent A's result triggers a conditional path
that requires a new agent not in the original plan).

Plan amendment is handled by the run coordinator invoking the planner for a plan
extension — the executor does not modify the DAG directly.

**Governance re-check triggers:** A plan amendment must trigger new governance checks
when the amendment:
- Adds a new agent not in the original plan
- Broadens the delegation scope beyond the original plan's ceiling
- Introduces a higher OCT path than the original plan contained
- Adds an external-facing system action not covered by the original plan's scope

The run coordinator must evaluate whether the amendment crosses any of these
thresholds. If it does, the amendment is treated as a new governance surface —
delegation issuance, NXS/NVG preflight, and (if planCheckback is active) user
approval are required for the new nodes before execution proceeds.

A plan amendment that silently expands scope without governance re-check is a
trust boundary violation.

---

## §11.7 Agent Selection Behavior (NEW)

### §11.7.1 Suggest-Not-Deny at Orchestration Layer

When the planner cannot fulfill a request with a specific agent (capability mismatch,
agent unavailable, structural impossibility), the planner should attempt to suggest
alternative agents that:
- Have the needed capability
- Are within the user's identity-provider capability ceiling
- Are within the orchestrator's delegation ceiling
- Are compatible with the run's OCT requirements

This is an orchestration-layer intelligence: the planner helps the user find a
workable path before giving up. The planner uses identity-provider capability
ceiling only as catalog visibility input supplied by the workspace or identity
layer — it does not authorize the action. Authorization remains with NXS.

### §11.7.2 Governance Deny Is Final

Suggest-not-deny applies **only** to the planner's agent selection logic. It does
not weaken, override, or soften any governance-layer denial:

- NXS Gate 04 policy DENY → final. No suggestion overrides this.
- NXS Gate 03 delegation ceiling violation → final. No suggestion overrides this.
- NXS Gate 02 OCT risk ceiling exceeded → final. No suggestion overrides this.
- NVG wall enforcement deny (sensitive data → frontier) → final. No suggestion overrides this.
- Timeout produces DENY → final. No suggestion overrides this.

The planner may suggest alternatives **before** governance evaluation. Once
governance evaluates and denies, the deny stands. The orchestrator does not
retry with a suggested agent after a governance denial — that would require a
new run or explicit user action.

### §11.7.3 Hard Deny Conditions

The planner issues a hard deny (no suggestion) when:
- No agent in the registry has the needed capability
- All capable agents are outside the user's catalog visibility ceiling
- The request cannot be mapped to any registered orchestration capability
  without inventing a capability, agent, or edge type
- The request violates a manifest-declared structural constraint, such as
  secureMode prohibiting multi-agent planning for that request shape

All hard-deny conditions are orchestration feasibility reasons — never governance
reasons. Whether the action is authorized is for NXS/NVG to determine after the
planner has produced a plan.

### §11.7.4 Anti-Recursion Law

The planner must not recursively retry agent selection after a governance denial
within the same run. This is hard law:

- If an agent is dispatched and NXS/NVG denies the action, the denial is recorded
  and the node is marked failed. The planner is not re-invoked to find an
  alternative agent for the same node in the same run.
- If the user wants to retry with a different agent, that is a new run or an
  explicit plan amendment (subject to §11.6.6 governance re-check).
- Automatic retry is permitted only for transient infrastructure failures (network
  timeout, service unavailable) per the orchestrator manifest's retryPolicy —
  never for governance denials.

A planner that re-invokes itself after governance denial to find a path around the
denial is a trust boundary violation. Governance denial is not a routing hint —
it is a stop signal.

---

## Amendment K — What This Does NOT Change

- §11.1 responsibility list: preserved (interpret, select, delegate, dispatch, collect,
  compile, return). Modular clarification appended, not replaced.
- §11.2 Agent Registry: unchanged.
- §11.3 Orchestrator Delegation Law: unchanged.
- §10 Workspace responsibilities: unchanged. Workspace displays plans, does not build them.
- §31 Complete Governed Loop: unchanged. Orchestrator position in the loop is the same.
- §35 Security Model: unchanged. Trust boundaries preserved.
- §36.2 Deferred Items: "Multi-party orchestrator" remains deferred.
- Existing Orchestrator socket interface (AMEND-spec §3.3): unchanged.
  The Planner interface is a new internal contract, not a replacement of the socket.
- Existing mailbox contracts (AMEND-spec §3.4): unchanged. Intermediate hops use
  the same mailbox surface.
- Layer placement (blueprint §27, AMEND-spec §3): unchanged. Orchestrator remains
  an external socket component, not a privileged internal package.
- OrchestratorFactory: unchanged — whole-orch replacement path is the same.

---

## Amendment K — Audit Response Log

### Round 1 (v0.1.0 → v0.2.0)

| Finding | Disposition | Action |
|---------|------------|--------|
| K-F01 Blueprint/spec leakage | REJECTED | Blueprint already contains this level of boundary definition (§12, §17, §19). Spec references back. Language tightened but structural definitions stay. |
| K-F02 Planner shadow governor | ACCEPTED | §11.4.5 added — explicit authority bounds, planner MUST NOT list, trust boundary violation clause. |
| K-F03 Tier precedence | ACCEPTED with modification | §11.5.4 added — OCT floor is non-negotiable. Policy may elevate, never lower. One-way ratchet. |
| K-F04 Replay determinism | ACCEPTED | §11.6.5 added — plan order index, monotonic run sequence, ledger ordering by sequence not wall-clock. |
| K-F05 Mailbox hop trust | PARTIAL — cross-reference | §11.6.3 updated with cross-reference to existing mailbox contracts (AMEND-spec §3.4). Not re-specified — already in canon. |
| K-F06 Layer/import mapping | REJECTED — cross-reference | Scope statement updated with layer placement cross-reference. Already established by ext-infra build and blueprint §27. |
| K-M01 Core rationale | ACCEPTED | §11.4.1 updated — executor/coordinator share tight internal state, planner has clean functional boundary. |
| K-M02 Informal language | ACCEPTED | Formal language throughout. |
| K-M03 Anti-loop law | ACCEPTED | §11.7.4 added — hard law: governance denial is stop signal not routing hint. |
| K-M04 Plan amendment governance | ACCEPTED | §11.6.6 added — four re-check triggers, scope expansion without re-check is trust boundary violation. |

### Round 2 (v0.2.0 → v0.3.0)

| Finding | Disposition | Action |
|---------|------------|--------|
| K2-F01 Planner policy hard-deny | ACCEPTED (BLOCKER) | §11.7.3 rewritten — removed "policy absolutely forbids" bullet. Replaced with orchestration-feasibility framing. Added explicit: all hard-deny conditions are feasibility reasons, never governance reasons. |
| K2-M01 User ceiling as authorization | ACCEPTED | §11.7.1 — added: ceiling used as catalog visibility filter, not authorization. Authorization remains with NXS. |
| K2-M02 Timestamp replay risk | ACCEPTED | §11.6.5 — timestamp reframed as evidence metadata. Monotonic run sequence is sole ordering authority. |
| K2-M03 Composition-root guard | ACCEPTED | Scope statement — added: reference harness routes receive pre-constructed services through composition root, must not compose internals locally. |
| K2-M04 Mailbox contract verification | VERIFIED | MailboxManifestRecord confirmed in repo: payloadTtlSeconds, classificationRequired, digestRequired all present. No guard needed — already in canon. |

### Round 3 (v0.3.0 → v1.1.1)

| Finding | Disposition | Action |
|---------|------------|--------|
| K3-M01 "signed policy authorization" wording | ACCEPTED | §11.7.3 — replaced with "manifest-declared structural constraint, such as secureMode prohibiting multi-agent planning for that request shape." Removes language a builder could misread as planner inspecting policy. |

---

*Amendment K — v1.1.1*
*Ratification-ready. Three audit rounds complete. No open blockers.*
*Hash log: ORCH-HASH-SESSION-LOG.md*
*Audit round 1: 10 findings (6 accepted, 2 rejected, 2 partial)*
*Audit round 2: 5 findings (4 accepted, 1 verified-no-action)*
*Audit round 3: 1 finding (1 accepted)*
*Date: 2026-05-02*
