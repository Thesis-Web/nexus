# Nexus Stack — Complete End-to-End Flow
# Version: v4.8 | 2026-04-18
# Status: Owner-Approved Canonical Outline for blueprint v0.3.7 / spec v0.4.7
# Supersedes: nexus-complete-end-to-end-flow-v4.7.md
#
# CARRIED FORWARD — OWNER-APPROVED CANON AMENDMENTS (v3 origin):
# Amendment A — REST included as Adapter v2 production target
# Amendment B — Webhook included as Channel v2 production target
# Amendment C — Gate 02 action verb taxonomy updated to production set
# Amendment D — Three operating modes added as production control-plane design
#
# OWNER-APPROVED IN v4 — NOW RATIFIED IN v4.1:
# Amendment E — Agent Operational Classification Tier (OCT) as first-class governed concept
# Amendment F — Run Ledger as third audit stream, mandatory for all runs including bypass paths
# Amendment G — Orchestration Plane as enterprise-owned governed layer
# Amendment H — Compile / Return path as OCT-COMPILE governed step
# Amendment I — Vanguard inbound return path logging (log-and-normalize, no content inspection)
#
# DECISIONS APPLIED IN v4.1 (from cross-audit findings log, owner-approved 2026-04-18):
# CONTRA-001 — Name confirmed as "Nexus Vanguard (NVG)" — owner decision 2026-04-18
# CONTRA-002 — Workspace "only authorized entry point" confirmed as hard rule
# NEW-001    — "Two calls" clarified as checkpoint integration surface only, not full runtime description
# NEW-002    — Direct-to-Nexus bypass is Vanguard-only; still operates inside workspace envelope;
#              Run Ledger still records all bypass runs
# NEW-003    — Reference deterministic renderer explicitly exempt from actor registration;
#              reason: no wall crossings, no system actions, no delegation
# NEW-004    — OCT vs IAM conflict rule: more restrictive always governs; explicit rule added
# NEW-005    — Run Ledger mandatory for all runs including direct-to-Nexus bypass paths
#
# NEW IN v4.3 — OWNER-RATIFIED IN v4.7:
# v4.3-001 [RATIFIED] — TypeScript strict is the sole implementation language for the entire stack.
#             No Python, Go, or multi-language SDKs. Other languages integrate via REST API.
#             The stack ships clean TypeScript strict. REST API is the polyglot surface.
# v4.3-002 [RATIFIED] — Monorepo confirmed. NVG builds as a new package inside the existing nexus/
#             monorepo, not a separate repository. Package boundaries enforce independence.
#             nexus-contracts/ extracted as shared types package.
# v4.3-003 [RATIFIED] — Reference Identity Adapter added as optional package
#
# FIXES IN v4.4 (from cross-audit Audit 3 findings — no new architecture):
# v4.4-001 — Identity layer wording: "Upstream: Enterprise IAM" section renamed to
#             "Identity Provider Interface." Language throughout updated to reflect that
#             the source may be enterprise IAM OR the Reference Identity Adapter.
#             Runtime contract is uniform either way.
# v4.4-002 — Footer ratification status split cleanly: ratified through v4.2, v4.3
#             additions still pending owner ratification. Header and footer now agree.
# v4.4-003 — "Never constructs governance payloads by hand" softened: TS packages are
#             canonical; non-TS uses generated REST/OpenAPI clients; hand-authored
#             payloads are discouraged, not assumed impossible.
# v4.4-004 — Reference Identity Adapter trust boundary hardened: explicit statement
#             that it is not sufficient for high-assurance / SSO / MFA / compliance-grade
#             identity. Production deployments with enterprise IAM disable or remove it.
#             Starter bootstrapper only — not production IAM.
#             Documented upgrade path to Okta / Azure AD / AWS IAM.

---

## What This Is

**A governed runtime for the full human → agent → model → action → compile → user loop.**

Two enforcement checkpoints. Three audit streams. Every actor governed.
Every wall crossing logged. The best umpire is felt, not seen.

**Nexus Vanguard (NVG)** — the wall enforcement engine.
Decides: *Can this data leave the wall to this model tier? What came back through the wall?*

**Nexus (NXS)** — the authority engine.
Decides: *Can this actor execute this action against this system, right now, under this authority?*

Everything else — IAM, agent frameworks, orchestrators, compile agents, vaults — stays yours
or is provided by the enterprise. The Nexus Stack governs the envelope. It does not replace
what you have and it does not run your agents for you.

### Checkpoint Integration Surface

Two calls are the checkpoint integration surface — the points where your code touches the stack.
This is not the full runtime description. The complete governed loop includes workspace,
orchestrator, agents, compile, and run audit. The two calls are what your integration produces.

```typescript
// Checkpoint 1 — Nexus Vanguard
const route = await nvg.classifyAndRoute(request);
// Returns: egress decision, selected model tier, reason codes, audit record ID

// Checkpoint 2 — Nexus
const decision = await nexus.authorizeAction(agentAction);
// Returns: ALLOW | REQUIRE_APPROVAL | DENY + signed evidence record ID
```

The entire stack is implemented in TypeScript strict. That is the sole implementation
language. No Python, Go, or multi-language SDK suite. Agents and applications in other
languages integrate via the REST API — standard HTTP, no proprietary client required.
The TypeScript types are the canonical contract. The REST API surface is generated from
those types. Non-TypeScript integrations should use generated REST/OpenAPI clients or
the published schemas — hand-authoring governance payloads is strongly discouraged
and unsupported, though not technically prevented at the HTTP layer.

---

## What the Stack Is Not

- Not an IAM platform
- Not a secrets vault
- Not an OAuth wrapper
- Not an agent framework
- Not an orchestrator
- Not a compile engine
- Not a compliance reporting suite
- Not a model risk manager
- Not a certification system
- Not a multi-language SDK suite — REST API is the polyglot integration surface

Your enterprise identity provider (IAM, RBAC, or Reference Identity Adapter) remains the source of truth for identity when present.
In starter deployments, the Reference Identity Adapter temporarily fills that role
until replaced. Both checkpoints consume identity-provider claims and enforce within
their boundaries. Neither replaces the identity provider. Your orchestrator, your
agents, and your compile layer remain yours. The stack governs the envelope they
operate in.

---

## Three Deployment Modes
# [AMENDMENT D — carried. Owner-approved additive production design.
#  Gate pipeline executes identically in all three modes.]

Both NVG and Nexus support three operating modes. Mode is signed infrastructure
configuration — it cannot be changed by agents, adapters, or any interface that
agents use. Mode changes require a signed admin command (Ed25519 admin keypair,
separate from agent credentials) and produce mandatory audit events in all three streams.

In all three modes, every decision is fully evaluated and logged as if Enforcing.
Mode controls whether the decision is acted upon, not whether it is recorded.

| Mode        | Behavior                                               | Use When                                |
|-------------|--------------------------------------------------------|-----------------------------------------|
| Observe     | Evaluate and log all decisions. Never block.           | Day 1 trial. Zero production risk.      |
| Advisory    | Return decisions. Caller decides enforcement.          | Gradual rollout. Policy testing.        |
| Enforcing   | Full enforcement. Blocks on DENY. Routes to approval.  | Production. This is the correct posture.|

An enforcing-lock flag in signed config prevents any downgrade from Enforcing without
multi-party admin approval. A compromised agent or adapter cannot soften the posture.

Recommended onboarding path: Observe (week 1) → Advisory (week 2) → Enforcing (production).

---

## Agent Operational Classification Tiers (OCT)
# [AMENDMENT E — owner-ratified in v4.1]
# Every actor in the system — human, agent, orchestrator, compile agent,
# service automation — is assigned an OCT at registration. OCT is the governed
# envelope the actor operates in. OCT is enforced at runtime by NVG (model ceiling)
# and Nexus (action ceiling). OCT is immutable during a run.

An OCT defines four ceilings for the actor it is assigned to:

| Ceiling               | What It Controls                                          |
|-----------------------|-----------------------------------------------------------|
| Data class ceiling    | Highest data classification the actor may handle          |
| Model tier ceiling    | Highest model tier the actor may call through NVG         |
| Action risk ceiling   | Highest Nexus risk tier the actor may be authorized for   |
| Delegation ceiling    | Maximum delegation scope the actor may carry or grant     |

### OCT vs IAM Capability Ceiling — Conflict Rule
# [NEW-004 — owner-approved 2026-04-18]

The more restrictive of IAM capability ceiling and OCT ceiling always governs.

- OCT can never grant more than IAM permits. If IAM restricts an actor to
  read-only operations, OCT cannot unlock write or execute actions.
- IAM cannot unlock what OCT has restricted. If OCT is SECURE, IAM broad-access
  roles do not enable frontier model calls.
- When ceilings differ, the lower ceiling applies automatically. This is not
  configurable and requires no runtime decision.

### The Four OCT Levels

**OCT-SECURE**
- Data class ceiling: sensitive / restricted
- Model tier ceiling: on_prem_sensitive only — frontier hard-denied
- Action risk ceiling: critical — full Nexus scrutiny, approval likely required
- Typical actors: agents handling PII, financial records, health data, regulated data
- Compile inputs from this OCT: compile must use on-prem or deterministic mode only
- Note: enterprises with no on-prem models cannot run OCT-SECURE inference jobs.
  This is a hard operational constraint, not a silent fallback.

**OCT-CONFIDENTIAL**
- Data class ceiling: internal / general
- Model tier ceiling: frontier-eligible per routing policy
- Action risk ceiling: high — standard Nexus gate
- Typical actors: internal analytics agents, workflow agents, internal search agents

**OCT-OPEN**
- Data class ceiling: public / unclassified (trusted source)
- Model tier ceiling: any configured frontier tier
- Action risk ceiling: medium / low — Nexus gate, auto-allow likely
- Typical actors: public-facing agents, market intelligence, external research agents

**OCT-COMPILE**
- Special purpose: result assembly and response synthesis only
- Data class ceiling: inherited from highest OCT of all inputs at runtime — hard rule
- Model tier ceiling: derived from inherited data class at runtime
- Action risk ceiling: none — compile actors do not execute system actions
- Output destination: workspace / user surface only
- Who provides: enterprise builds their own, uses a third party, or uses the
  reference deterministic renderer. All are valid. Stack governs the envelope.
  Enterprise owns the implementation.

### OCT Assignment

OCT is assigned at actor registration by the enterprise operator.
It is not self-declared by the actor.
The actor has no visibility into its own OCT assignment.
Assigning or changing an OCT requires a signed operator action and produces
a mandatory audit event in the Run Ledger.

---

## Identity Provider Interface
# [v4.4-001 — renamed from "Upstream: Enterprise IAM (Yours — Unchanged)"]
# [v4.6 — RBAC restored as explicit valid source alongside IAM and Reference Adapter]
# Source may be any of three valid configurations:
#   1. Enterprise IAM (Okta / Azure AD / AWS IAM) — full identity + roles + lifecycle
#   2. Enterprise RBAC system — roles and capability ceilings, no full IAM required
#   3. Reference Identity Adapter — starter bootstrapper (see below)
# Runtime contract is identical across all three. The stack does not care which
# source is behind the interface. It enforces the claims it receives.
#
# IAM vs RBAC distinction:
#   IAM answers: who is this actor and how did they authenticate?
#   RBAC answers: what roles and permissions does this actor have?
#   An enterprise may have a standalone RBAC system without a full IAM platform.
#   Both are valid upstream sources. The interface requires the same five claims
#   regardless of which system provides them.

Before any request enters the stack, the identity provider supplies:

- Principal identity — who the actor is
- Role assignments — what roles they hold in the organization
- Capability ceilings — maximum scope of systems and actions permitted
- Environment context — production, staging, development
- Actor class — HUMAN, SUPERVISED_AGENT, AUTONOMOUS_AGENT, SERVICE_AUTOMATION

These five claims are what the stack requires. Whether they come from enterprise IAM,
a standalone RBAC system, or the Reference Identity Adapter is a deployment decision.
The runtime contract is the same either way.

Both checkpoints consume these claims and enforce within their boundaries.
Neither replaces the identity provider. The identity provider sets the org-level
ceiling. OCT sets the Nexus-enforced runtime ceiling within that. More restrictive
always wins.

### Reference Identity Adapter (Optional — For Deployments Without Enterprise IAM)
# [v4.3-003 — OWNER-RATIFIED v4.7]

Some deployments — smaller organizations, internal AI teams, early-stage builds —
do not have enterprise IAM in place. Telling them to implement Okta first is a
barrier to adoption. The Reference Identity Adapter removes that barrier without
building a full IAM platform.

The Reference Identity Adapter is an optional package that implements the same
identity-provider interface the enterprise integrations use. It is a bootstrapper, not a product.

What it provides:
- Simple actor and principal store — register actors, assign roles, set capability ceilings
- API-key or signed JWT authentication — enough to bootstrap a governed deployment
- The same interface contract that Okta / Azure AD / AWS IAM integrations implement
- Documented upgrade path — swap in enterprise IAM or enterprise RBAC without touching the governance engine

What it is NOT:
- Not a user management system
- Not a permissions engine beyond what NVG and Nexus need
- Not a production IAM replacement
- Not sufficient for high-assurance identity requirements — no SSO, no MFA,
  no identity lifecycle management, not compliance-grade
- Not marketed as a feature — it is a starter kit
- Not present in production deployments that have enterprise IAM — disable
  or remove it when upgrading to real IAM

Labeled explicitly in the package: "Reference Identity Adapter — starter only.
Not for production deployments with enterprise IAM in place."

This is plug-and-play in the same sense as everything else in the stack: use it if
you want, replace it with your own when you are ready, the interface contract is
the same either way.

---

## User Entry: Enterprise Workspace / Agent Surface
# [AMENDMENT G — owner-ratified in v4.1]
# CONTRA-002 confirmed: this is a hard rule, not a recommendation.

In governed enterprise mode, the user enters through a managed workspace surface.
This is the only authorized entry point for governed work.

Direct access to raw model UIs (Claude.ai, ChatGPT, Cursor, etc.) for governed
enterprise work is outside the governed system. Work done outside the workspace
is not covered by NVG or Nexus governance and must be treated as ungoverned
by enterprise policy.

Observe mode provides a zero-risk onramp for enterprises in evaluation —
all decisions are logged but never enforced, so existing workflows are
uninterrupted. This eliminates commercial friction without weakening the
architectural posture.

The workspace surface provides:
- Identity-provider-gated access — user authenticated before anything else
- Agent catalog — user sees only agents their identity-provider capability ceiling permits
- Governed prompt entry — requests enter the orchestration plane, not a raw model
- Run tracking — every request gets a run ID linked across all three audit streams
- Final response display — compiled answers return here, not from raw model output

---

## Orchestration Plane: Enterprise-Owned, Governed Actor
# [AMENDMENT G — owner-ratified in v4.1]
# The orchestrator is enterprise-owned. The stack defines the governance contract.
# The enterprise provides the implementation. The stack does not ship an orchestrator.

The orchestrator is a registered actor in the Nexus actor registry with its own
actor profile, OCT assignment, delegation authority, and audit trail.
It is not exempt from governance because it is infrastructure.

The orchestrator's responsibilities:
- Receive the user request from the workspace
- Interpret the task — single-agent or multi-agent work
- Select agents from the governed agent registry per task requirements
- Issue delegation to each sub-agent — scoped, signed, bounded by orchestrator's
  own delegation ceiling (Gate 03 enforces: sub-agent cannot exceed parent bounds)
- Dispatch sub-tasks to selected agents
- Track run state
- Collect partial results from agents
- Invoke compile step when results are ready
- Pass compiled result to workspace for delivery to user

The orchestrator does not call models directly.
Every model-bound call routes through NVG.
Every system-action call routes through Nexus.

### Agent Registry and Plug-and-Play Onboarding

The agent registry is the governed catalog of all actors in the system.
The orchestrator selects agents from the registry.
The user sees agents from the registry filtered by their identity-provider capability ceiling.

Registering a new agent:
1. Register with the identity provider (enterprise IAM, enterprise RBAC, or Reference
   Identity Adapter) — actor class, capability ceiling
2. Create actor profile in Nexus actor registry — name, class, environment, OCT
3. Attach or create policy profile — allowed verbs, allowed systems, risk tier, approval posture
4. Agent is now available in the registry, visible to the orchestrator and workspace catalog

No code changes to the firewall, engine, or orchestrator are required for a new agent.
New agent = new config. That is the complete onboarding path.

For a new protocol or framework: implement one adapter once.
All agents using that protocol are then pure config onboarding.

---

## Checkpoint 1 — Nexus Vanguard (NVG): Wall Enforcement
# [AMENDMENT I — owner-ratified in v4.1. NVG name confirmed by owner in v4.2.]
# NVG governs the wall in both directions:
# Outbound: data leaving the wall to a model tier.
# Inbound: model response returning through the wall — log, normalize, pass.

### [AMENDMENT A — carried. REST is Adapter v2, MCP is Adapter v1.]

Protocol support:
- MCP — Adapter v1, current release, fully implemented
- REST — Adapter v2, interface contract locked, implementation next build cycle
- Additional adapters implement the same adapter interface; core engine never imports
  protocol-specific types (MODULAR-001)

### Outbound: Step 1 — Intake and Normalization

NVG receives the raw outbound request and normalizes it:
- Task intent and payload
- Actor identity claims (from identity provider interface — not supplied by the agent itself)
- Actor OCT (loaded from registry — not supplied by the agent)
- Environment classification
- Cost and latency preferences

### Outbound: Step 2 — Data Classification and Egress Policy Engine

This is the hard wall — an active policy enforcement point, not a detection heuristic.

Classification is label-driven. NVG reads classification labels the enterprise has
already applied — from your data catalog (Collibra, Alation), database classification
tags, DLP labels, and data residency policies. It enforces those labels. It does not
infer content meaning from raw text.

For unstructured or unlabeled content:
- Trusted source, unlabeled — routes to on_prem_general by default until policy configured
- Unknown provenance — quarantined or denied. Unknown is not internal and safe.

Optional: governed model-assisted labeling. On-prem-only classifier module.
Off by default. Requires explicit operator configuration.

Classification decision:
- Sensitive / Restricted → on-prem only, frontier hard-denied
- General / Internal → frontier-eligible per routing policy
- Public → any tier
- Unclassified (trusted source) → on_prem_general until policy configured
- Unknown provenance → quarantine or deny

OCT enforcement: the actor's OCT model tier ceiling is applied as an additional
constraint on top of data classification. More restrictive wins. An OCT-CONFIDENTIAL
actor requesting a model call with sensitive data is denied — data class wins.

The hard wall is law. Sensitive data cannot reach frontier tiers.
This is not a configuration switch.

### Outbound: Step 3 — Policy-Governed Model Router

Routing decisions are based on: classification result, actor OCT ceiling, task
complexity, cost envelope, and model tier health.

Tiers are open strings governed by registry — adding a new tier is a registry
update, not a code change.

| Tier               | Purpose                                                      |
|--------------------|--------------------------------------------------------------|
| on_prem_sensitive  | Models that never touch external APIs. Sensitive data only.  |
| on_prem_general    | Local general-purpose models for internal tasks.             |
| frontier_general   | Cloud models for routine, frontier-eligible work.            |
| frontier_reasoning | High-capability cloud models for complex reasoning.          |
| frontier_live      | Real-time / current-data models.                             |
| fallback           | Secondary selection when primary tier is unavailable.        |

Fallback never widens the tier. on_prem_sensitive does not route to frontier_general
on unavailability. It denies or queues.

Routing policy is expressed in versioned, signed YAML.

Example:
```yaml
- name: never-frontier-sensitive
  when:
    data_class: sensitive
  then:
    deny_if_tier_tag: frontier

- name: executive-complex-reasoning
  when:
    principal_role: executive
    task_complexity: high
    data_class: general
  then:
    route_to: frontier_reasoning
```

### Outbound: Step 4 — Deny / Quarantine

Request terminates here if classification or OCT ceiling denies it.
No model is invoked. Structured denial with reason code returned to agent.
Routing Provenance Trail entry written. No data leaves.

### Outbound: Step 5 — Model Invocation and Health Monitoring

For approved requests:
- Primary model selection per policy
- Health monitoring across all model endpoints
- Automatic fallback respecting data-class and OCT constraints
- Cost and latency tracking

### Inbound: Step 6 — Return Path Logging
# [AMENDMENT I — owner-ratified in v4.1]
# Log-and-normalize. No content inspection. No token parsing.
# The governed loop closes through Nexus and the compile step — not here.

When the model responds, NVG:
- Logs the inbound event: actor, model tier, run ID, timestamp, response size
- Links the inbound log entry to the originating outbound Routing Provenance Trail entry
- Normalizes the response into standard format (AgentAction or result schema)
- Passes the normalized result to the orchestrator boundary

NVG does not inspect the semantic content of model responses.
What happens next is governed by Nexus (if the result triggers a system action)
or by the compile step OCT rules (if it becomes compile input).

### Step 7 — Routing Provenance Trail

Every NVG event — outbound and inbound — is logged:
- Actor identity and OCT
- Data classification decision and policy applied
- Model tier selected and invoked
- Outbound request and inbound return linked by run ID
- Any denial or quarantine with reason code
- Performance and cost metrics

Queryable via management API and CLI. SIEM export formats available.
You do not parse raw log files.

---

## Normalization Boundary: Post-Inference Action Normalizer

The model's inference result passes through a post-inference action normalizer:
- Converts model output into a standard AgentAction format
- Protocol translation between model APIs and Nexus
- Zero governance decisions — pure normalization
- Consistent AgentAction format entering Nexus regardless of model source

### Direct-to-Nexus Integration (Vanguard-Bypass Path)
# [NEW-002 — owner-approved 2026-04-18]
# Bypass is Vanguard-only. All other governed system rules apply.

Agents that do not need data egress governance — fully on-prem agents with
pre-classified inputs — may integrate directly with Nexus via the same AgentAction
schema, bypassing NVG entirely.

This bypass applies to NVG only. It is not a bypass of the governed workspace,
the orchestrator, or the run audit trail. The following rules apply on all
direct-to-Nexus bypass runs:

- The agent must still operate inside the governed workspace / orchestrator envelope
- A Run Ledger entry is mandatory — bypass runs are not exempt from run audit
- The Nexus seven-gate authority path executes in full — no gates are skipped
- The agent must have an active session started through the governed workspace

The Run Ledger entry for a bypass run will have no NVG routing entries.
That is expected and explicitly noted in the run record.

---

## Checkpoint 2 — Nexus (NXS): Authority Engine

The normalized AgentAction enters Nexus. Nexus answers one question:
**Can this actor execute this action against this system, right now, under this authority?**

Nexus is default-deny. An agent that cannot execute an action escalates to a human.
An agent that executes without authority has already caused harm.

In Observe and Advisory modes, default-deny decisions are reported but not enforced.

### Gate 01: Identity Resolution

- Validates actor identity against identity provider claims (enterprise IAM, enterprise RBAC, or Reference Identity Adapter)
- Resolves session context and delegation chain
- Confirms principal authority and environment match
- Checks session expiry — SessionStore returns record regardless of expiry;
  Gate 01 evaluates and emits SESSION_EXPIRED denial if invalid
- Gate 01 owns all expiry semantics

### Gate 02: Action Classification
# [AMENDMENT C — carried. Production verb taxonomy.]

Normalizes action verbs into the governed production taxonomy:
read, write, create, update, delete, execute, query, search, publish, export,
send, synthesize, transmit

- Classifies target systems and resource types
- Determines capability requirements for the action/target combination
- Assigns risk tier: low, medium, high, critical

Taxonomy is governed but open — maintained in a central registry, not a closed enum.
Policies can introduce new verbs without engine rewrites (MODULAR-002, MODULAR-006).

### Gate 03: Delegation Chain Verification

- Verifies cryptographic signatures on all delegation grants
- Enforces scope ceiling constraints — sub-agent actions cannot exceed parent bounds
- Validates environment matching — delegation environment must match target environment
- Checks chain integrity — all parent delegations must be valid and unrevoked
- Emits CHAIN_INTEGRITY_BROKEN denial if any link is invalid

### Gate 04: Policy Evaluation — Authoritative Decision Point

- Loads current signed policy rules
- Evaluates action against rules — actor, OCT, target, risk tier, delegation scope, environment
- Computes final outcome: ALLOW, REQUIRE_APPROVAL, ESCALATE, or DENY
- Builds ExecutionGrantTemplate for ALLOW cases
- Determines approval routing for REQUIRE_APPROVAL cases
- Provides denial codes for all DENY paths — denial codes, not reason strings

Gate 04 is the sole authoritative computation point for execution authority.
No adapter, connector, channel, or interface layer may supplement or override it (MODULAR-008).

### Gate 05: Human Approval Orchestration (Conditional)

Invoked only on REQUIRE_APPROVAL or ESCALATE outcomes. Never on ALLOW paths.
Invoked at most once per action.

- Packages approval request with action summary, risk assessment, and policy context
- Routes to configured approval channel
- Enforces timeout — timeout produces APPROVAL_TIMEOUT denial, never auto-approval
- Validates approver authority and cryptographic signature on approval response

Approval channels:
# [AMENDMENT B — carried.]
- CLI — Channel v1, current release, fully implemented
- Webhook — Channel v2, interface contract locked, implementation next build cycle
- Slack — Channel v3, future roadmap
- All channels implement the same approval channel interface (MODULAR-004)

Agent behavior during pending approval: Nexus returns PENDING with a request ID.
Agent polls for outcome or receives callback on resolution.

### Gate 06: Execution Grant Minting

For approved actions (ALLOW from Gate 04 or PASS from Gate 05):
- Validates ExecutionGrantTemplate integrity — Gate 04 is the sole template authority
- Mints a time-bound execution grant with precise scope constraints
- Binds live secret material to the grant vault for execution duration
- Forwards grant to the appropriate connector
- Clears all secrets from the grant after connector consumption
- Catches NexusSecurityViolation separately; preserves denial code; emits ThreatEvent

Long-lived base secrets never circulate in agents, adapters, or approval payloads.

### Gate 07: Evidence Generation — Always Executes

Gate 07 runs regardless of upstream outcome. No path skips Gate 07.

- Materializes the Comprehensive Chronicle View (CCV) inside the signed EvidenceRecord body
- Computes the record hash over the full body including CCV
- Signs that record hash with the control plane keypair
- Appends to the hash-chained evidence ledger with sequence integrity
- Records the final outcome

The CCV lives inside the signed record body. It is not computed or stored outside it.

### Nexus Evidence Ledger

Every action — successful or failed — produces a signed, hash-chained evidence record:
- Complete decision chain through all seven gates
- Human approval workflows and outcomes
- Cryptographically signed and hash-chained to prevent tampering
- Sequence verified — SEQUENCE_ANOMALY emitted by chain verifier on any gap.
  This is the sole authorized emission point for that signal.

Queryable via management API and CLI. SIEM export formats available.

---

## Target Systems: Scoped Execution

For approved actions, the execution grant flows to target systems with:
- Time-bound scope — grant expires automatically
- Precise resource constraints — only specified systems and operations
- Automatic secret clearing — no long-lived credentials remain in circulation

---

## Compile / Return Path
# [AMENDMENT H — owner-ratified in v4.1]

After agents return results to the orchestrator, the orchestrator invokes the
compile step. The compile actor assembles the final response.

### Three Compile Modes

**Mode 1 — Deterministic Render**
Reference implementation — always available, always zero-risk.
No model call. No wall crossing. Stays entirely inside the wall.
Produces: tables, charts, structured summaries, formatted text.
Available to all enterprises regardless of on-prem model availability.

Note on the reference renderer:
# [NEW-003 — owner-approved 2026-04-18]
# The reference deterministic renderer is a built-in system utility, not a
# registered actor. It is exempt from actor registration because it makes no
# model calls, executes no system actions, and issues no delegations. It only
# formats data already inside the wall. This exemption is explicit and intentional.
# It does not weaken governance because there is no governed surface for it to cross.

**Mode 2 — On-Prem Synthesis**
Enterprise provides an on-prem model as compile actor.
Inside the wall. No NVG outbound call needed.
OCT-COMPILE assigned. Inherits highest data class of inputs at runtime.

**Mode 3 — Frontier Synthesis**
Permitted only if:
- Inherited data class of all compile inputs is not sensitive / restricted
- Operator has explicitly configured frontier synthesis in signed policy

The compile request routes through NVG (outbound) — same as any other model call.
The response returns through NVG (inbound logged, normalized).
If any input is OCT-SECURE or sensitive: this mode is hard-denied.
Falls back to Mode 1 or Mode 2. There is no silent fallback to frontier.

### OCT-COMPILE Inheritance Rule (Hard Rule, Not Configurable)

The compile actor's effective data class ceiling at runtime equals the highest
data class of all its inputs. This rule is not operator-configurable.

Example: Sales Agent result is sensitive. Market Intelligence result is general.
Compile inherits sensitive. Frontier synthesis is hard-denied for this run.
Only Mode 1 or Mode 2 is permitted for this compile step.

Operational note: in mixed-OCT runs, the inheritance rule will often force
Mode 1 (deterministic) rendering. Operators should design compile outputs
with this in mind when handling sensitive + general mixed workloads.

### Enterprise Compile Options

The stack does not mandate a compile implementation:
- Build your own compile agent — register as OCT-COMPILE actor
- Use a third-party compile agent — register as OCT-COMPILE actor
- Use an on-prem synthesis model — register as OCT-COMPILE actor
- Use the reference deterministic renderer — no registration required

All registered paths are governed identically. The stack enforces the OCT ceiling.
The enterprise owns the implementation.

---

## Final Response to User

The compiled answer returns to the user through the workspace surface only.

Not from raw model output.
Not directly from a sub-agent.
Not directly from a frontier model.
Only from the governed workspace surface.

The run is closed. A final Run Ledger entry is written.
The user sees the governed result.

---

## The Complete Governed Loop

```
USER
  → Enterprise Workspace (identity-provider-gated — only authorized entry point)
  ↓
ORCHESTRATOR
  (governed actor, OCT assigned, registered in actor registry)
  (enterprise-owned implementation, stack-governed envelope)
  → receives user request
  → selects agents from governed agent registry per task
  → issues scoped, signed delegation to each selected agent
  → dispatches sub-tasks
  → run ID assigned, Run Ledger opened
  ↓
FOR EACH AGENT:

  If model call needed:
    → NVG OUTBOUND
        classify data + enforce OCT model ceiling
        if denied: terminate, no model called, Trail entry written
        if approved: call selected model tier
    → Model executes (on-prem or frontier per classification + OCT)
    → NVG INBOUND
        log return event, normalize result, pass to orchestrator
    → Result returned to orchestrator, Run Ledger updated

  If system action needed:
    → Nexus (seven gates, default deny)
        Gate 01: identity / session
        Gate 02: action classification
        Gate 03: delegation chain
        Gate 04: policy → ALLOW / REQUIRE_APPROVAL / DENY
        Gate 05: human approval (if required)
        Gate 06: execution grant → target system
        Gate 07: evidence written (always, every path)
    → Result returned to orchestrator, Run Ledger updated

  If agent bypasses NVG (on-prem pre-classified only):
    → Nexus directly (same seven gates, no gates skipped)
    → Run Ledger still records the run (bypass noted, no NVG entries)
    → Agent must still have active session from workspace

ORCHESTRATOR
  → collects all agent results
  → invokes compile step
  ↓
COMPILE ACTOR (OCT-COMPILE, enterprise-provided or reference renderer)
  → OCT ceiling inherited from highest-class input — hard rule applied
  → Mode 1 (deterministic): stays inside wall, no NVG call
  → Mode 2 (on-prem synthesis): inside wall, no NVG call
  → Mode 3 (frontier synthesis): routes through NVG if inputs permit
  → assembles final answer
  ↓
FINAL RESPONSE
  → returns to workspace
  → workspace delivers to user
  → Run Ledger closed
```

---

## Three Independent Audit Streams
# [AMENDMENT F — owner-ratified in v4.1. Run Ledger mandatory for all runs.]

**Stream 1 — Nexus Vanguard: Routing Provenance Trail**
- Actor identity and OCT
- Data classification decision and policy applied
- Model tier selected and reason
- Outbound request and inbound return linked by run ID
- Any denial or quarantine with reason code
- Performance and cost metrics
- Queryable via management API and CLI

**Stream 2 — Nexus: Evidence Ledger**
- Complete seven-gate decision chain per action
- Human approval workflows and outcomes
- Cryptographically signed, hash-chained records
- Sequence integrity (SEQUENCE_ANOMALY on any gap — chain verifier only)
- Queryable via management API and CLI

**Stream 3 — Run Ledger**
# Mandatory for ALL runs, including direct-to-Nexus bypass paths. [NEW-005]
- Run ID assigned at workspace entry
- Orchestrator actor and OCT
- Task split and agents selected
- Delegation grants issued
- Model call events (linked to Routing Provenance Trail entries by run ID)
- System action events (linked to Evidence Ledger entries by run ID)
- Partial results received
- Compile mode selected and OCT ceiling applied
- Final response delivered, run closed
- Bypass runs noted explicitly: no NVG entries, Nexus entries present

Cross-linked by run ID across all three streams.

Together: a complete forensic record of every governed AI run — who asked what,
which agents were selected, what data left the wall and to where, what actions
were authorized, how results were compiled, and what was delivered to the user.

---

## No On-Prem: Explicit Constraint Table

| Scenario                                       | Behavior                                                  |
|------------------------------------------------|-----------------------------------------------------------|
| OCT-OPEN agent, general data, no on-prem       | Frontier permitted. No constraint.                        |
| OCT-CONFIDENTIAL agent, internal data          | Frontier permitted per policy. No constraint.             |
| OCT-SECURE agent, sensitive data, no on-prem   | Hard-denied. Sensitive data cannot go to frontier.        |
| Compile, non-sensitive inputs, no on-prem      | Deterministic render or frontier synthesis per policy.    |
| Compile, sensitive inputs, no on-prem          | Deterministic render only. Frontier hard-denied.          |

No silent weakening. The stack surfaces the constraint. The enterprise decides
whether to deploy on-prem capability or accept the operational limit.

---

## The Security Model

```
                    Identity Provider Interface
                    (enterprise IAM / enterprise RBAC / Reference Identity Adapter)
                    (identity + capability ceilings)
                    OCT vs identity-provider ceiling: more restrictive wins
                            |
                            ↓
               Enterprise Workspace / Agent Surface
               (only authorized entry point — hard rule)
                            |
                            ↓
               Orchestrator (governed actor, OCT assigned)
               (enterprise-owned — stack governs envelope)
              /              |               \
    Agent A          Agent B           Agent C
  (OCT-SECURE)  (OCT-CONFIDENTIAL)   (OCT-OPEN)
       |                  |                 |
       ↓                  ↓                 ↓
  [ NVG — OUTBOUND ] ← OCT ceiling + data class enforced
    classify, route, enforce wall
       |
       | Denied → Routing Provenance Trail → stop
       |
       ↓
  Model invocation (on-prem or frontier per OCT + data class)
       |
       ↓
  [ NVG — INBOUND ]
    log return, normalize, pass
       |
       ↓ (if action needed)
  [ NEXUS — AUTHORITY ENGINE ]
    Gate 01 → 02 → 03 → 04
    ALLOW → Gate 06 → Gate 07
    REQUIRE_APPROVAL → Gate 05 → PASS → Gate 06 → Gate 07
                               → DENY/TIMEOUT → Gate 07
    DENY/ERROR → Gate 07
       |
  Execution Grant → Target System
  Evidence Ledger (always — every path)
       |
       ↓
  Orchestrator collects results
       |
       ↓
  Compile Actor (OCT-COMPILE)
  [OCT ceiling inherited from highest-class input]
  Mode 1: deterministic (always available)
  Mode 2: on-prem synthesis (inside wall)
  Mode 3: frontier synthesis (through NVG if permitted)
       |
       ↓
  Final Response → Workspace → User
  Run Ledger closed
```

---

## What This Stack Is Not Asserting

The machine may assert:
- Action allowed under policy rule X
- Action denied with denial code Y
- Human approval was received / denied / timed out
- Delegation chain is valid or broken at link Z
- Evidence record is cryptographically intact and sequentially verified
- Data classification routed payload to tier T under policy P
- OCT ceiling prevented model call for actor A

The machine may NOT assert:
- This action is safe
- This agent is trustworthy
- The system certifies compliance with regulation X
- This action is approved by the system

Prohibited language anywhere in the stack or its outputs:
"approved by system" / "Nexus certifies" / "system confirms compliance" /
"this action is safe" / "compliant action."

Compliance decisions remain with humans. The stack provides the evidence.
You provide the judgment.

---

*Nexus Stack v4.8 — Owner-Approved Canonical Outline — LOCKED*
*Owner: James Huson / Lake Area LLC*
*All amendments A–I ratified. All v4.x decisions ratified. No pending items.*
*v4.8 final fixes: header status corrected; "enterprise IAM" → "enterprise identity provider";*
*duplicate scar removed; upgrade path broadened to IAM or RBAC.*
*This is the canonical outline for blueprint v0.3.7 and spec v0.4.7.*
