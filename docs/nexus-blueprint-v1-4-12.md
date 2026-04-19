# Nexus Stack — System Blueprint
# Version: v1.4.12
# Owner: James Huson / Lake Area LLC
# Date: 2026-04-19
# Supersedes: nexus-blueprint-v0-3-6.md
# Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (Owner-Approved, LOCKED)
# Engineering spec derived from this blueprint: nexus-engineering-spec-v1-4-12.md
# Canonical law: this document

---

## Changelog from v0.3.6

This version incorporates all ratified amendments A–I from nexus-complete-end-to-end-flow-v4.8.md,
v4.3 additions (v4.3-001 through v4.3-003), v4.4 fixes (v4.4-001 through v4.4-004), and the
seven-layer expansion (ADD-008, owner-approved 2026-04-19). All prior v0.3.6 NXS law
(gates, approval, evidence, credential governance, modularity) is carried forward unchanged.

**ADD-008 approval record:**
ADD-008 — Seven-layer architecture expansion — owner-approved 2026-04-19.
The five-layer stack from v0.3.6 is replaced by a seven-layer stack to accommodate the
contracts layer (Layer 2), vanguard engine layer (Layer 3), and identity layer (Layer 6).
This is now binding architecture law. All downstream references (build order, modularity
rules, package structure, drift prevention) are updated to reflect the approved seven-layer
numbering. Stale five-layer references from v0.3.6 are superseded.

**Structural changes:**

1. System scope expanded from Nexus (authority engine only) to the Nexus Stack — a
   two-checkpoint governed runtime covering wall enforcement (NVG) and authority enforcement
   (NXS) as independently governed layers in a single TypeScript monorepo.

2. Nexus Vanguard (NVG) added as Checkpoint 1 — wall enforcement engine governing data egress
   to model tiers (Amendment I, CONTRA-001). NVG is a first-class governed layer. Its addition
   does not change Nexus (NXS) gate law. NXS gates execute identically with or without a
   prior NVG call.

3. OCT (Operational Classification Tier) added as first-class governed concept (Amendment E).
   Four tiers: OCT-SECURE, OCT-CONFIDENTIAL, OCT-OPEN, OCT-COMPILE. OCT is enforced at
   registration by the operator. OCT ceiling and identity-provider capability ceiling are both
   enforced; more restrictive always governs.

4. Three operating modes added: Observe, Advisory, Enforcing (Amendment D). Mode is signed
   infrastructure configuration. Mode changes require signed admin command. Enforcing-lock
   prevents downgrade without multi-party admin approval.

5. Workspace added as the only authorized entry point for governed work (Amendment G,
   CONTRA-002). Workspace assigns run ID and gates identity-provider access.

6. Orchestration Plane added as enterprise-owned governed actor with agent registry and
   plug-and-play onboarding (Amendment G). The orchestrator is registered in the Nexus actor
   registry. It is not exempt from governance because it is infrastructure.

7. Compile / Return Path added as governed step (Amendment H). Three modes: deterministic
   render, on-prem synthesis, frontier synthesis. OCT-COMPILE inherits highest data class of
   all inputs — hard rule, not configurable.

8. Run Ledger added as third mandatory audit stream for all runs including NVG-bypass paths
   (Amendment F). Three streams — Routing Provenance Trail (NVG), Evidence Ledger (NXS),
   Run Ledger — are cross-linked by run ID.

9. NVG inbound return path: log-and-normalize, no content inspection (Amendment I).
   NVG does not inspect semantic content of model responses.

10. REST added as Adapter v2 production target — interface contract locked (Amendment A).
    Webhook added as Channel v2 production target — interface contract locked (Amendment B).
    Neither is implemented in this build; treating either interface as permission to scaffold
    partial code is a build violation.

11. ActionVerb governed set expanded from 8 to 13 per Amendment C production taxonomy:
    read, write, create, update, delete, execute, query, search, publish, export,
    send, synthesize, transmit. Open governed type — additions require no engine rewrite.

12. Identity Provider Interface formalized: three valid sources (enterprise IAM, enterprise
    RBAC, Reference Identity Adapter). Runtime contract is identical across all three.
    Five required claims regardless of source.

13. Reference Identity Adapter added as optional starter package — implements the
    identity-provider interface — not a production IAM replacement (v4.3-003).

14. TypeScript strict is the sole implementation language. REST API is the polyglot
    integration surface. No multi-language SDKs (v4.3-001).

15. Single nexus/ monorepo confirmed. nexus-contracts package extracted as shared types.
    Package boundaries enforce independence (v4.3-002).

16. Layer count expanded from five (v0.3.6) to seven (ADD-008, owner-approved 2026-04-19).
    New layers: contracts (Layer 2), vanguard engine (Layer 3), identity (Layer 6).
    All stale five-layer references from v0.3.6 are superseded. See §24.

17. All v0.3.6 NXS gate law is unchanged. All v0.3.6 approval law is unchanged.
    All v0.3.6 evidence ledger law is unchanged. All v0.3.6 credential governance
    law is unchanged. All v0.3.6 modularity law is carried forward and extended.

---

## 1. System Identity and Purpose

The Nexus Stack is a governed runtime for the full human → agent → model → action →
compile → user loop. It sits inline at two enforcement checkpoints — between agents and
the model tier they would call, and between agents and the target systems they would act
upon. Everything that crosses those two checkpoints is governed, logged, and traceable.

**Checkpoint 1 — Nexus Vanguard (NVG):** the wall enforcement engine. Every outbound
request from an agent to a model tier passes through NVG. NVG classifies data, enforces
OCT model-tier ceilings, routes to the appropriate model, and logs every wall crossing.
Every inbound model response is logged and normalized as it returns through the wall.
NVG decides: *Can this data leave the wall to this model tier? What came back?*

**Checkpoint 2 — Nexus (NXS):** the authority engine. Every action an agent attempts
against a real system passes through Nexus. Nexus identifies the actor and the authority
they hold, classifies the action, enforces delegation boundaries, evaluates the action
against policy, routes high-risk actions to human approval, mints bounded execution
authority for allowed actions, forwards execution through governed connectors, and emits
a tamper-evident hash-chained evidence record for every action regardless of outcome.
Nexus decides: *Can this actor execute this action against this system, right now, under
this authority?*

The stack exists because AI agents currently operate with either god-mode static credentials
or full user impersonation for actions, and with unclassified data egress to model tiers.
There is no standard runtime layer that knows what data is leaving the enterprise boundary,
to which model, under what classification, who the actor is, what authority they hold,
whether an action is permitted under policy, whether a human must approve it, whether the
credential at execution time was correctly bounded, and whether the complete chain of custody
is provable. The Nexus Stack is that layer.

The product wedge is runtime wall enforcement, authority enforcement, and evidence production
across the governed AI loop. The stack governs the envelope. It does not run agents. It does
not manage identity. It does not replace secrets vaults, orchestrators, or model providers.
It governs what passes through and logs what happened.

---

## 2. Product Thesis

- One engine pair governs the loop: NVG for wall enforcement, Nexus for action authority.
- One runtime contract governs each engine independently.
- One fixed authority model governs delegation, execution grants, and approval inside Nexus.
- One wall enforcement policy governs data classification and model routing inside NVG.
- Protocol adapters connect agents to the Nexus engine without baking protocol into the engine.
- Connectors abstract target systems without baking system-specific credential logic into the engine.
- Approval channels abstract human interface without baking channel-specific transport into the orchestrator.
- The identity-provider interface abstracts the identity source without baking IAM implementation into either engine.
- The control interface exposes governance surfaces without exposing engine internals.
- The workspace is the only authorized entry point — not a courtesy, a hard rule.
- The orchestration plane is enterprise-owned; the stack governs its envelope.
- The compile step is governed by OCT ceiling inheritance — not a style choice.

If the engines, runtime contracts, and execution-grant law are built correctly, new adapters,
new connectors, new approval channels, and new model tiers are additive implementations —
not architectural rewrites. This is the portability law of the Nexus Stack, enforced from
the first line of code.

TypeScript strict is the sole implementation language for the entire stack. REST API is
the polyglot integration surface. Agents and applications in other languages integrate via
REST — no proprietary multi-language SDK suite is shipped or planned.

---

## 3. What the Stack Is Not

The Nexus Stack is not:
- an IAM platform
- a secrets vault
- an OAuth wrapper
- an agent framework
- an orchestrator
- a compile engine
- a compliance reporting suite
- a model risk manager
- a certification system
- a multi-language SDK suite
- a data catalog or DLP system
- a model hosting platform

The enterprise identity provider (IAM, RBAC, or Reference Identity Adapter) remains the
source of truth for identity. The enterprise orchestrator remains the enterprise's. Agent
implementations remain the enterprise's. Compile implementations remain the enterprise's.
Model hosting and inference remain the enterprise's or a third-party provider's. The stack
governs the envelope they all operate in. It does not replace what the enterprise has.

---

## 4. Scope Boundary

### 4.1 Included in Blueprint Scope

This blueprint defines:

- system identity and purpose for the full Nexus Stack (NVG + NXS)
- two-checkpoint architecture and the independence law between NVG and NXS
- identity provider interface — three valid sources, five required claims, conflict rule
- OCT system — four tiers, four ceilings, assignment law, inheritance law, conflict rule
- operating modes — Observe, Advisory, Enforcing — and enforcing-lock
- workspace / user surface law — hard-rule entry point, run ID, agent catalog
- orchestration plane — governed actor law, agent registry, delegation authority
- actor model, actor class law, Principal definition, and non-human identity law
- delegation model, delegation-chain law, and trust boundaries
- NVG architecture — outbound classification, egress policy engine, model routing,
  inbound return logging, Routing Provenance Trail
- model tier registry — six tiers, fallback law, tier as open string type, routing policy format
- normalization boundary — zero governance, pure protocol translation
- Nexus gate pipeline — seven gates in fixed order, default-deny, branch law
- human approval law — request minimums, expiry invariant, approver key contract,
  approval decision service law, channel law
- evidence ledger law — append-only, hash-chain, signing, always-write, intent minimums,
  execution-grant metadata minimums, redaction law, CCV, chain integrity
- compile / return path — three modes, OCT-COMPILE inheritance rule, renderer exemption
- three audit streams — Routing Provenance Trail, Evidence Ledger, Run Ledger
- run ledger law — mandatory for all runs, cross-link law, bypass annotation law
- token and credential governance law
- seven-layer architecture and plane/layer assignments
- modularity law — 15 rules enforced from initial build
- assertion boundary and certification language prohibition
- monorepo package structure and package dependency law
- build order — layer sequence and gate-design-before-implementation law
- portability thesis
- drift prevention rules
- complete governed loop — standalone anti-drift architectural reference
- target systems — scoped execution law as distinct governed surface
- operational constraints — no-on-prem constraint table
- security model — standalone trust-boundary reference
- deferred items — explicit list of what is not built in this version

### 4.2 Excluded from Blueprint Scope

This blueprint does not define:

- implementation code or TypeScript interfaces (engineering spec)
- exact field-level schemas and governed constant value sets (engineering spec)
- database schema detail (engineering spec)
- API field-by-field definitions (engineering spec)
- exact signature envelope fields and key-rotation cadence (engineering spec)
- redaction marker format and redaction schema (engineering spec)
- field-level CCV schema and derivation rules (engineering spec; blueprint fixes
  semantic fields, invariants, and comparability law only)
- NVG routing policy YAML schema detail (engineering spec)
- Run Ledger schema (engineering spec)
- Routing Provenance Trail schema (engineering spec)
- vendor lock to any model provider, cloud provider, or protocol
- detailed infrastructure manifests
- pricing or commercial terms
- connector-specific integration behavior
- agent implementation details

---

## 5. Core Concepts

These are the governed concepts at architecture level. Field-level definitions belong in the
engineering spec. These definitions constrain the spec and the builder without becoming the spec.

**Actor**: A runtime identity that initiates or participates in an action. An Actor has a
registered class, a principal, an environment, an OCT assignment, and a bounded authority
ceiling. Actor class is an open governed type. The v1.4.12 governed actor classes are defined
in §12.1.

**Principal**: The human or organizational identity whose authority an Actor is borrowing.
A Principal is not an Actor class — it is the upstream owner of delegated authority. Every
Actor must have a resolvable Principal. A Principal may not delegate more authority than
the Principal holds.

**OCT (Operational Classification Tier)**: The governed envelope the actor operates in.
OCT defines four ceilings: data class ceiling, model tier ceiling, action risk ceiling, and
delegation ceiling. OCT is assigned at registration by the enterprise operator. The actor has
no visibility into its own OCT assignment. OCT is immutable during a run. Four tiers are
defined in this version: OCT-SECURE, OCT-CONFIDENTIAL, OCT-OPEN, OCT-COMPILE.

**DelegationContext**: A signed, time-bounded, scope-bounded authority grant from a Principal
to an Actor for a session. The DelegationContext carries actor identifier, principal
identifier, allowed systems, allowed capabilities, forbidden capabilities, maximum risk tier,
chain depth, parent context reference if sub-delegated, downstream propagation flag,
environment, expiry, and the signature of the issuing control plane. No actor may exceed the
authority defined in its DelegationContext.

**Session**: A runtime association between an Actor, a Principal, and a DelegationContext
that establishes the identity context for a bounded set of actions. Sessions are created
explicitly by the CLI or management API. No adapter may create a session from caller-supplied
headers. Gate 01 owns session expiry semantics.

**ActionVerb**: The operation class of an action. ActionVerb is an open governed type. The
v1.4.12 governed production set is: read, write, create, update, delete, execute, query,
search, publish, export, send, synthesize, transmit. A Capability is resolved from ActionVerb
plus target context — not from ActionVerb alone.

**Capability**: A normalized description of what an action does, more specific than a verb
alone. A Capability is resolved from ActionVerb, target resource type, and action context at
classification time. Capability is an open governed type.

**RiskTier**: A governed classification of action risk level computed deterministically from
Capability, DataClass, target environment, and external-facing flag. RiskTier is an open
governed type. The v1.4.12 set is: low, medium, high, critical.

**DataClass**: The sensitivity class of data touched by an action. DataClass is an open
governed type. The v1.4.12 set is: public, internal, confidential, pii, phi, financial.
An action may carry multiple data classes.

**ModelTier**: The classification of the model endpoint to which a request is routed by NVG.
ModelTier is an open governed string type. The v1.4.12 set is: on_prem_sensitive,
on_prem_general, frontier_general, frontier_reasoning, frontier_live, fallback. Tier
assignments are enforced by NVG outbound routing policy against OCT ceiling and data class.

**Environment**: The deployment environment in which an action occurs. Environment is an open
governed type. The v1.4.12 set is: dev, staging, production. Environment is a required
dimension for actor registration, risk computation, delegation context, grant scoping, and
evidence. Two logically identical actions in dev versus production are not semantically
equivalent.

**OutcomeLabel**: The normalized label for a policy evaluation outcome. OutcomeLabel is an
open governed type. The v1.4.12 set is: allow, deny, require_approval, escalate.
OutcomeLabel must be stored as a governed constant in EvidenceRecord — not derived from prose.

**ApprovalDecisionLabel**: The normalized label for a human approval decision.
ApprovalDecisionLabel is an open governed type. The v1.4.12 set is: approved, denied,
timed_out. Must be stored as a governed constant in EvidenceRecord.

**FinalOutcomeLabel**: The normalized label for the final disposition of an action.
FinalOutcomeLabel is an open governed type. The v1.4.12 set is: executed, denied_identity,
denied_classification, denied_delegation, denied_policy, denied_approval, denied_timeout,
denied_threat, error.

**ExecutionGrant**: A short-lived, scope-bounded, signed runtime authority artifact that
allows a connector to execute a specific action under specific identity, scope, constraints,
and expiry. ExecutionGrants are minted by NXS at Gate 06 under the template computed at
Gate 04. They are produced as a function of identity, delegation context, policy outcome,
capability, and approval state.

**ExecutionGrantTemplate**: An intermediate artifact computed by Gate 04 at policy evaluation
time. The template specifies required capability scope, expiry class, CredentialSubject
category, resource bounds, environment bound, approval linkage requirements, and approval
routing config. Gate 04 is the single authoritative computation point for grant template law.

**CredentialSubject**: The identity a downstream system sees when an ExecutionGrant is
redeemed by a connector. CredentialSubject selection is explicit engine law determined by the
ExecutionGrantTemplate at Gate 04.

**ApprovalRequest**: A signed artifact issued by the control plane when a high-risk action
requires human decision. Mandatory fields are defined in §19. An ApprovalRequest is a
first-class legal artifact. ApprovalRequest expiry must equal the policy approvalConfig
timeoutSeconds — signed expiry and runtime timeout are an invariant.

**ApprovalResponse**: A signed artifact produced by a registered human approver who has
reviewed an ApprovalRequest. An unsigned or unverifiable ApprovalResponse always produces
DENY. Timeout responses are system-generated and must never reach the external verification path.

**EvidenceRecord**: An immutable, hash-chained, Ed25519-signed record of an NXS action's
complete lifecycle through the gate pipeline. Mandatory content is defined in §20.

**CompilerComparisonView (CCV)**: A reduced, stable, versioned semantic view derivable from
every NXS EvidenceRecord. The CCV is the canonical surface for comparing NXS gate decisions
across runs, agents, and versions. Two runs are logically comparable if they share the same
blueprint version, runtime contract version, capability taxonomy version, and comparison input
version. The CCV is materialized from the EvidenceRecord at write time and stored within the
signed EvidenceRecord body. It is not a second ledger and not a separate store.

**AgentAction**: The canonical envelope for a normalized action request entering NXS.
Produced by a protocol adapter (MCP, REST) or the Post-Inference Action Normalizer. Contains
actor identity claims, session identifier, action verb, target descriptor, intent context,
model context, and run ID. AgentAction schema is defined in nexus-contracts and is the
boundary contract between NVG/adapters and the NXS engine.

**RoutingProvenanceTrail**: The NVG audit stream. Every NVG outbound and inbound event is
logged here: actor, OCT, data classification, model tier selected, outbound request,
inbound return, any denial with reason code, cost and latency metrics. Cross-linked to Run
Ledger and Evidence Ledger by run ID. Append-only. Queryable via management API and CLI.

**RunLedger**: The third audit stream — the full run-scoped record: orchestrator actor,
agents selected, delegation grants issued, model call events, system action events, partial
results, compile mode, final response delivery, run closed. Mandatory for every run including
NVG-bypass runs. Cross-linked to RoutingProvenanceTrail and Evidence Ledger by run ID.

**RunID**: A unique identifier assigned at workspace entry when a user submits a request.
RunID is propagated across all three audit streams. Every NVG event, every NXS evidence
record, and every run ledger entry in a governed run carries the same RunID.

**OperatingMode**: The signed infrastructure configuration governing whether stack decisions
are enforced. Three modes: Observe (evaluate and log — never block), Advisory (return
decisions — caller decides enforcement), Enforcing (full enforcement — block on DENY, route
to approval). Mode is not an agent-level setting. Mode change requires signed admin command.

**IdentityProviderInterface**: The abstraction layer through which the stack receives actor
identity claims. Any of three valid sources: enterprise IAM, enterprise RBAC, or the
Reference Identity Adapter. Runtime contract is identical across all three. Five required
claims regardless of source.

---

## 6. Two-Checkpoint Architecture

The Nexus Stack enforces governance at two independent checkpoints. NVG and NXS are
separate governed layers. They operate independently. They share type contracts through
nexus-contracts but never import each other's internals.

```
Checkpoint 1 — Nexus Vanguard (NVG)
  Question answered: Can this data leave the wall to this model tier? What came back?
  Surface: data egress, model routing, wall enforcement, inbound logging
  API: await nvg.classifyAndRoute(request)
  Returns: egress decision, model tier selected, reason codes, routing trail record ID

Checkpoint 2 — Nexus (NXS)
  Question answered: Can this actor execute this action against this system,
                     right now, under this authority?
  Surface: action authorization, execution grant minting, evidence ledger
  API: await nexus.authorizeAction(agentAction)
  Returns: ALLOW | REQUIRE_APPROVAL | DENY + signed evidence record ID
```

The two calls are the checkpoint integration surface. They are what an enterprise
integration produces. They are not the full runtime description. The complete governed
loop includes the workspace, orchestrator, agents, compile step, and run audit.

Independence law:
- NVG and NXS never import each other's internals.
- Both import from nexus-contracts only.
- An agent may call NVG without subsequently calling NXS (model-only interaction).
- An agent may call NXS without a prior NVG call (NVG-bypass path, §13.9).
- Neither engine's gate or enforcement logic depends on the other's internal state.
- Both engines write to their respective audit streams independently.
- Both audit streams are cross-linked by run ID — not by engine coupling.

---

## 7. Identity Provider Interface

### 7.1 Three Valid Sources

Before any request enters the stack, an identity provider supplies the required claims.
Any of three valid sources may supply these claims. The runtime contract is identical
regardless of which source is used:

1. **Enterprise IAM** (Okta / Azure AD / AWS IAM) — full identity lifecycle,
   SSO, MFA, role management, and capability ceilings. Answers: who is this actor
   and how did they authenticate?

2. **Enterprise RBAC** — roles and capability ceilings without a full IAM platform.
   An enterprise may have a standalone RBAC system as their capability governance source.
   Answers: what roles and permissions does this actor have?

3. **Reference Identity Adapter** — optional starter bootstrapper. Implements the same
   interface that enterprise integrations implement. Not a production IAM replacement.
   See §7.4 for scope and trust boundary.

### 7.2 Five Required Claims

Regardless of source, the identity provider must supply five claims for every actor
before the actor enters the governed stack:

1. **Principal identity** — who the actor is
2. **Role assignments** — what roles they hold in the organization
3. **Capability ceilings** — maximum scope of systems and actions permitted
4. **Environment context** — production, staging, or development
5. **Actor class** — the governed actor class from the v1.4.12 set (see §12.1)

Both NVG and NXS consume these five claims and enforce within their respective
boundaries. Neither engine replaces the identity provider. The identity provider sets
the org-level ceiling; OCT sets the runtime ceiling within that; more restrictive wins.

### 7.3 OCT vs Identity-Provider Ceiling Conflict Rule

The more restrictive of the identity-provider capability ceiling and the OCT ceiling
always governs. This rule is not configurable and requires no runtime decision.

- OCT can never grant more than the identity provider permits. If IAM restricts an
  actor to read-only operations, OCT cannot unlock write or execute actions.
- Identity-provider access cannot unlock what OCT has restricted. If OCT is SECURE,
  broad-access IAM roles do not enable frontier model calls.
- When ceilings differ, the lower ceiling applies automatically.

### 7.4 Reference Identity Adapter

The Reference Identity Adapter is an optional package for deployments without enterprise
IAM or RBAC. It implements the same identity-provider interface that enterprise
integrations implement. It is a bootstrapper — not a product.

What it provides:
- Simple actor and principal store — register actors, assign roles, set capability ceilings
- API-key or signed JWT authentication — sufficient to bootstrap a governed deployment
- The same interface contract that Okta / Azure AD / AWS IAM integrations implement
- Documented upgrade path — swap in enterprise IAM or RBAC without engine changes

What it is not:
- Not a user management system
- Not a permissions engine beyond what NVG and NXS need
- Not a production IAM replacement
- Not sufficient for high-assurance identity, SSO, MFA, identity lifecycle management,
  or compliance-grade identity requirements
- Not marketed as a feature — it is a starter kit

Labeled explicitly in the package: "Reference Identity Adapter — starter only.
Not for production deployments with enterprise IAM or RBAC in place."

Production upgrade path: disable or remove the Reference Identity Adapter and wire in
enterprise IAM or enterprise RBAC. No engine changes required — the interface is identical.

---

## 8. Agent Operational Classification Tiers (OCT)

### 8.1 Four OCT Levels

OCT is a governed envelope assigned to every actor in the system — human, agent,
orchestrator, compile actor, service automation. OCT is not self-declared. It is assigned
at registration by the enterprise operator. The actor has no visibility into its OCT.
OCT is immutable during a run.

**OCT-SECURE**
- Data class ceiling: sensitive / restricted
- Model tier ceiling: on_prem_sensitive only — frontier hard-denied
- Action risk ceiling: critical — full NXS scrutiny, human approval likely required
- Typical actors: agents handling PII, PHI, financial records, regulated data
- Compile inputs from OCT-SECURE actors: compile step must use on-prem or deterministic mode
- Hard operational constraint: enterprises with no on-prem models cannot run OCT-SECURE
  inference jobs. This is an explicit operational limit — not a silent fallback.

**OCT-CONFIDENTIAL**
- Data class ceiling: internal / general
- Model tier ceiling: frontier-eligible per routing policy
- Action risk ceiling: high — standard NXS gate
- Typical actors: internal analytics agents, workflow agents, internal search agents

**OCT-OPEN**
- Data class ceiling: public / unclassified (trusted source)
- Model tier ceiling: any configured frontier tier
- Action risk ceiling: medium / low — NXS gate, auto-allow likely
- Typical actors: public-facing agents, market intelligence, external research agents

**OCT-COMPILE**
- Special purpose: result assembly and response synthesis only
- Data class ceiling: inherited from highest OCT of all inputs at runtime — hard rule
- Model tier ceiling: derived from inherited data class at runtime
- Action risk ceiling: none — OCT-COMPILE actors do not execute system actions
- Output destination: workspace / user surface only
- Reference deterministic renderer is exempt from actor registration — see §21.4

### 8.2 Four Ceilings per OCT

| Ceiling               | What It Controls                                          |
|-----------------------|-----------------------------------------------------------|
| Data class ceiling    | Highest data classification the actor may handle          |
| Model tier ceiling    | Highest model tier the actor may call through NVG         |
| Action risk ceiling   | Highest NXS risk tier the actor may be authorized for     |
| Delegation ceiling    | Maximum delegation scope the actor may carry or grant     |

### 8.3 OCT Assignment Law

OCT is assigned at actor registration by the enterprise operator. OCT assignment produces
a mandatory audit event in the Run Ledger. OCT change requires a signed operator action and
produces a mandatory audit event. An actor cannot request its own OCT assignment or change.

### 8.4 OCT vs Identity-Provider Conflict Rule

See §7.3. The conflict rule applies to OCT ceiling versus identity-provider capability
ceiling. More restrictive always wins. Not configurable.

---

## 9. Operating Modes

### 9.1 Three Modes

Both NVG and NXS support three operating modes. Mode is signed infrastructure configuration.
It is not an agent-level setting and cannot be changed by agents, adapters, or any interface
that agents use.

In all three modes, every decision is fully evaluated and logged as if Enforcing.
Mode controls whether the decision is acted upon — not whether it is recorded.

| Mode       | Behavior                                              | Use When                              |
|------------|-------------------------------------------------------|---------------------------------------|
| Observe    | Evaluate and log all decisions. Never block.          | Day 1 trial. Zero production risk.    |
| Advisory   | Return decisions. Caller decides enforcement.         | Gradual rollout. Policy testing.      |
| Enforcing  | Full enforcement. Block on DENY. Route to approval.   | Production. The correct posture.      |

Recommended onboarding path: Observe (week 1) → Advisory (week 2) → Enforcing (production).

### 9.2 Mode Change Law

Mode changes require:
- A signed admin command (Ed25519 admin keypair — separate from agent credentials)
- A mandatory audit event in all three audit streams
- No mode change is possible through agent interfaces, adapters, or approval channels

Mode changes are not reversible without the admin keypair.

### 9.3 Enforcing-Lock

An enforcing-lock flag in signed infrastructure configuration prevents any downgrade from
Enforcing mode without multi-party admin approval. A compromised agent or adapter cannot
soften the enforcement posture. The enforcing-lock is the intended production configuration.
Disabling the enforcing-lock requires multi-party admin signatures and produces a mandatory
audit event in all three streams.

---

## 10. Workspace / User Surface

### 10.1 Hard-Rule Entry Point

In governed enterprise mode, the user enters through a managed workspace surface. This is
the only authorized entry point for governed work. This is a hard rule — not a recommendation.

Direct access to raw model UIs (Claude.ai, ChatGPT, Cursor, or any provider's native UI)
for governed enterprise work is outside the governed system. Work done outside the workspace
is not covered by NVG or NXS governance and must be treated as ungoverned by enterprise policy.

Observe mode provides a zero-risk onramp for evaluation — all decisions are logged but never
enforced, so existing workflows are uninterrupted while governance is being validated.

### 10.2 Workspace Responsibilities

The workspace provides:
- Identity-provider-gated access — user authenticated before anything else
- Agent catalog — user sees only agents their identity-provider capability ceiling permits
- Governed prompt entry — requests enter the orchestration plane, not a raw model
- Run ID assignment — every request gets a run ID at workspace entry; this ID is propagated
  across all three audit streams for the lifetime of the run
- Final response display — compiled answers return here, not from raw model output

### 10.3 Run ID Assignment Law

Run ID is assigned at workspace entry when the user submits a request. Run ID:
- is unique per governed run
- is generated by the workspace, not by agents, adapters, or the orchestrator
- is carried in every NVG event, every NXS AgentAction, and every Run Ledger entry
- is the cross-link key across all three audit streams
- must be present in all audit stream entries for a run — absence of run ID is an
  audit stream integrity violation

---

## 11. Orchestration Plane

### 11.1 Governed Actor

The orchestrator is a registered actor in the NXS actor registry with its own actor profile,
OCT assignment, delegation authority, and audit trail. It is not exempt from governance because
it is infrastructure. The stack defines the governance contract; the enterprise provides the
implementation; the stack governs the envelope.

The orchestrator's responsibilities:
- Receive the user request from the workspace
- Interpret the task — single-agent or multi-agent work
- Select agents from the governed agent registry per task requirements
- Issue delegation to each sub-agent — scoped, signed, bounded by orchestrator's own
  delegation ceiling (Gate 03 of NXS enforces: sub-agent cannot exceed parent bounds)
- Dispatch sub-tasks to selected agents
- Track run state and run ID propagation
- Collect partial results from agents
- Invoke compile step when results are ready
- Pass compiled result to workspace for delivery to user

The orchestrator does not call models directly. Every model-bound call routes through NVG.
Every system-action call routes through NXS.

### 11.2 Agent Registry

The agent registry is the governed catalog of all actors in the system. The orchestrator
selects agents from the registry. The workspace agent catalog filters registry entries by
the user's identity-provider capability ceiling.

Registering a new agent requires four steps:
1. Register with the identity provider (IAM, RBAC, or Reference Identity Adapter) —
   actor class, capability ceiling
2. Create actor profile in the NXS actor registry — name, class, environment, OCT
3. Attach or create policy profile — allowed verbs, allowed systems, risk tier, approval posture
4. Agent is now available in the registry — visible to orchestrator and workspace catalog

No code changes to the wall enforcement engine, authority engine, or orchestrator are
required to register a new agent. New agent = new config. That is the complete onboarding path.

For a new protocol or framework: implement one adapter once. All agents using that protocol
are then pure config onboarding thereafter.

### 11.3 Orchestrator Delegation Law

The orchestrator issues delegation to sub-agents. Delegation law from §17.3 (Gate 03)
applies to all sub-agent delegations issued by the orchestrator:
- Sub-agent delegation cannot expand allowedSystems, allowedCapabilities, or maxRiskTier
  beyond the orchestrator's own DelegationContext
- Sub-agent delegation is issued by the orchestrator but signed by the control-plane
  private key at mint time (§12.3) — the orchestrator specifies scope, the control
  plane signs
- Gate 03 of NXS verifies the full chain including the orchestrator hop

---

## 12. Actor Model and Trust Boundaries

### 12.1 Actor Classes

Actor class is an open governed type. The v1.4.12 governed set:

**HUMAN** — Person directly operating. Acts as their own Principal unless delegating.

**HUMAN_WITH_COPILOT** — Person operating with AI copilot. Human is the initiating
Principal. Copilot acts under bounded delegation.

**SUPERVISED_AGENT** — Automated agent operating under active human supervision. Must have
an identifiable human Principal who owns the action on their behalf.

**AUTONOMOUS_AGENT** — Automated agent operating without live human oversight. Requires
stronger controls: owner registration, review cadence, narrower risk ceiling.

**SCHEDULED_AGENT** — Batch or cron job. Operates under a registered schedule. Limited to
non-interactive, pre-approved capabilities.

**DELEGATED_SUBAGENT** — An agent that receives sub-delegated authority from another agent.
The parent agent's DelegationContext defines the ceiling for the sub-agent's authority.
Sub-agent delegation cannot expand beyond parent bounds.

**SERVICE_AUTOMATION** — Infrastructure-level service or bot. Non-human, always requires
registered owner and purpose.

### 12.2 Non-Human Identity Law

Non-human actors (all classes except HUMAN and HUMAN_WITH_COPILOT) must be registered with:
owner identity, purpose statement, and review cadence. Gate 01 rejects non-human actors with
incomplete registries.

### 12.3 Delegation Minting Law

DelegationContext is minted by the control plane. Minting law:

- A Principal may not delegate capabilities they do not hold.
- A Principal may not delegate systems outside their registered allowedSystems.
- A Principal may not delegate risk above their maxDelegableRiskTier.
- Root delegation environment must equal actor.environment. Minting a root delegation with
  a different environment from the actor is prohibited. DelegationError thrown on mismatch.
- Sub-delegation cannot expand allowedSystems, allowedCapabilities, or maxRiskTier beyond
  the parent DelegationContext.
- All DelegationContexts are signed by the control-plane private key at mint time.

---

## 13. Nexus Vanguard (NVG) — Wall Enforcement Engine (Checkpoint 1)

### 13.1 Wall Enforcement Law

NVG is the wall between the governed enterprise and the model tier ecosystem.
NVG governs the wall in both directions:
- Outbound: data leaving the wall to a model tier
- Inbound: model response returning through the wall — log, normalize, pass

NVG does not govern system actions — that is NXS's domain. NVG governs model calls.
An agent that needs to call a model routes through NVG. An agent that needs to take a
system action routes through NXS. An agent may need both in sequence for a single task.

The hard wall is law. Sensitive data cannot reach frontier tiers. This is not a
configuration switch. It is not subject to operator override. No policy rule may
allow sensitive data to reach a frontier tier. The wall is the product.

### 13.2 Outbound: Step 1 — Intake and Normalization

NVG receives the raw outbound request and normalizes it:
- Task intent and payload
- Actor identity claims from the identity provider — not supplied by the agent itself
- Actor OCT loaded from registry — not supplied by the agent
- Environment classification from actor registration
- Cost and latency preferences

Actors cannot supply their own identity claims or OCT at intake. Claims come exclusively
from the identity provider interface. Adapter-provided identity fields are ignored.

### 13.3 Outbound: Step 2 — Data Classification and Egress Policy Engine

This is the hard wall — an active enforcement point, not a detection heuristic.

Classification is label-driven. NVG reads classification labels the enterprise has already
applied — from data catalogs (Collibra, Alation, or equivalent), database classification
tags, DLP labels, and data residency policies. NVG enforces those labels. NVG does not
infer content meaning from raw text.

Classification decisions:

| Input State                             | NVG Decision                                           |
|-----------------------------------------|--------------------------------------------------------|
| Sensitive / Restricted                  | on_prem_sensitive only — frontier hard-denied          |
| General / Internal                      | frontier-eligible per routing policy                   |
| Public                                  | any configured tier                                    |
| Unclassified (trusted source)           | on_prem_general default until policy configured        |
| Unknown provenance                      | quarantine or deny — unknown is not safe               |

Optional: governed model-assisted labeling — on-prem-only classifier module, off by default,
requires explicit operator configuration in signed policy.

OCT enforcement: the actor's OCT model tier ceiling is applied as an additional constraint
on top of data classification. More restrictive wins. An OCT-CONFIDENTIAL actor requesting
a model call with sensitive-classified data is denied — data class governs.

### 13.4 Outbound: Step 3 — Policy-Governed Model Router

Routing decisions are based on: classification result, actor OCT ceiling, task complexity,
cost envelope, and model tier health status.

Model tier routing policy is expressed in versioned, signed YAML. A routing policy version
bump and re-signing are required for any routing policy change — not an ad hoc edit.

Routing policy is evaluated in priority order. First matching rule governs. If no rule
matches: deny. Default-deny posture applies in NVG routing, mirroring NXS gate law.

### 13.5 Outbound: Step 4 — Deny / Quarantine

Request terminates here if classification or OCT ceiling denies it:
- No model is invoked
- Structured denial with reason code returned to the agent
- Routing Provenance Trail entry written with full context
- No data leaves the enterprise boundary

A quarantined request does not proceed. The enterprise operator must review quarantined
requests before any action can be taken. Quarantine is not a soft hold — it is a denial
with deferred disposition.

### 13.6 Outbound: Step 5 — Model Invocation and Health Monitoring

For approved requests:
- Primary model selection per routing policy
- Health monitoring across all configured model endpoints
- Automatic fallback to secondary tier if primary is unavailable
- Fallback is constrained — it never widens the data-class or OCT ceiling
- Cost and latency tracking per request, linked to Routing Provenance Trail entry

Fallback law: on_prem_sensitive does not route to frontier_general on unavailability.
It denies. A constrained fallback to the fallback tier is permitted only within
the allowed ceiling. No silent widening of the wall is possible. No silent queueing.

### 13.7 Inbound: Step 6 — Return Path Logging

When the model responds, NVG:
- Logs the inbound event: actor, model tier, run ID, timestamp, response size
- Links the inbound log entry to the originating outbound Routing Provenance Trail entry
  by run ID and request correlation ID
- Normalizes the response into the standard result schema
- Passes the normalized result to the orchestrator boundary

NVG does not inspect the semantic content of model responses. No content parsing.
No token inspection. No response classification beyond size and format metadata.
The governed loop closes through NXS (if the result triggers a system action) and
the compile step OCT rules (if the result becomes compile input). Not here.

### 13.8 Routing Provenance Trail

Every NVG event — outbound and inbound — is logged in the Routing Provenance Trail:

- Actor identity and OCT
- Data classification decision and policy version applied
- Model tier selected and invoked
- Outbound request and inbound return linked by run ID
- Any denial or quarantine with reason code
- Fallback events with reason
- Cost and latency metrics

The Routing Provenance Trail is append-only. Records are written at every NVG event
regardless of outcome. Trail is queryable via management API and CLI. SIEM export formats
available. Cross-linked to Evidence Ledger and Run Ledger by run ID.

### 13.9 Direct-to-Nexus Bypass Law (NVG-Bypass Path)

Agents that do not need data egress governance — fully on-prem agents with pre-classified
inputs — may integrate directly with NXS via the AgentAction schema, bypassing NVG.

This bypass applies to NVG only. The following rules govern all bypass runs:

- The agent must still operate inside the governed workspace / orchestrator envelope
- A Run Ledger entry is mandatory — bypass runs are not exempt from run audit
- The NXS seven-gate authority path executes in full — no gates are skipped
- The agent must have an active session started through the governed workspace
- The Run Ledger entry for a bypass run explicitly notes: no NVG routing entries

A bypass run that is not inside the governed workspace / orchestrator envelope is a
trust boundary violation. There is no legitimate ungoverned bypass path.

---

## 14. Model Tier Registry

### 14.1 Six Governed Tiers

Model tiers are registered in a governed registry. The v1.4.12 set:

| Tier               | Purpose                                                         |
|--------------------|-----------------------------------------------------------------|
| on_prem_sensitive  | Models that never touch external APIs. Sensitive data only.     |
| on_prem_general    | Local general-purpose models for internal tasks.                |
| frontier_general   | Cloud models for routine, frontier-eligible work.               |
| frontier_reasoning | High-capability cloud models for complex reasoning.             |
| frontier_live      | Real-time / current-data models.                                |
| fallback           | Secondary selection when primary tier is unavailable.           |

### 14.2 Fallback Law

The fallback tier is constrained:
- Fallback never widens the data-class ceiling or OCT model tier ceiling.
- A request that is denied on data class grounds cannot be routed to fallback.
- A request whose primary tier is unavailable is routed to fallback only if fallback
  is within the same or a more restrictive ceiling than the primary.
- If no valid fallback exists within ceiling constraints: deny. Do not queue silently.

### 14.3 Tier as Open String Type

ModelTier is an open governed string type. Adding a new tier:
- Update the model tier registry (config — no code change to NVG routing engine)
- Publish a new signed routing policy version that references the new tier
- The routing engine resolves tiers from the registry — not from a closed enum

Treating ModelTier as a closed TypeScript union is a build violation (MODULAR-011).

### 14.4 Routing Policy Format

NVG routing policy is expressed in versioned, signed YAML. Routing policy law:
- Policy file carries a version identifier
- Policy file is signed by the control-plane keypair at authoring time
- NVG validates the signature before loading any policy file
- An unsigned or invalid-signature policy file is rejected at load time
- A routing policy that would route sensitive data to a frontier tier is rejected at
  load time as a classification-enforcement violation — even if the signature is valid

---

## 15. Normalization Boundary

### 15.1 Post-Inference Action Normalizer

After NVG inbound processing, the model's response passes through the Post-Inference Action
Normalizer before it can trigger a system action routed to NXS.

The normalizer:
- Converts model output into the standard AgentAction format
- Handles protocol translation between model APIs and NXS
- Makes zero governance decisions — pure normalization
- Produces a consistent AgentAction format entering NXS regardless of model source

The normalizer is not a gateway, not a gate, and not a governance layer. It is a translation
boundary. Any governance decision made inside the normalizer is a build violation.

### 15.2 AgentAction Schema

AgentAction is the canonical envelope contract defined in nexus-contracts. It is:
- Produced by a protocol adapter (MCP, REST) or the Post-Inference Action Normalizer
- The sole accepted input format for the NXS gate pipeline
- Carrying: actor identity claims, session identifier, action verb, target descriptor,
  intent context, model context, and run ID
- Not carrying: environment (resolved from actor registration at Gate 01),
  risk tier (computed at Gate 02), or execution scope (computed at Gate 04)

Adapters normalize to AgentAction. The normalizer produces AgentAction. NXS consumes
AgentAction. No layer between the adapter/normalizer and NXS gate 01 may alter the
AgentAction envelope.

---

## 16. Nexus (NXS) — Authority Engine (Checkpoint 2)

### 16.1 Default-Deny Posture

NXS is default-deny. An action reaches the next gate only when the current gate explicitly
passes. No gate assumes permission. No gate can be skipped by upstream outcome — Gate 07
always runs. Every action produces an EvidenceRecord regardless of outcome.

In Observe and Advisory modes, default-deny decisions are evaluated identically to Enforcing
mode — they are reported fully in the Evidence Ledger. Enforcement is what differs.

### 16.2 Gate Pipeline Overview

NXS executes seven gates in fixed order on every action. The seven-gate sequence is law.
No gate may be skipped. No gate may be reordered. Gate 07 executes regardless of all
upstream outcomes. The gates are: Identity (01), Classification (02), Delegation (03),
Policy (04), Approval (05 — conditional), Execution (06 — conditional), Evidence (07 — always).

The pipeline is an explicit stateful control-flow branch. It is not a generic loop over seven
gates. After Gate 04, the orchestrator branches deterministically on OutcomeLabel:
- ALLOW → Gate 06 → Gate 07
- REQUIRE_APPROVAL or ESCALATE → Gate 05; if Gate 05 passes → Gate 06 → Gate 07;
  if Gate 05 denies / times out / errors → Gate 07
- DENY or ERROR → Gate 07

---

## 17. Gate Pipeline Law

### 17.1 Gate 01 — Identity and Session Law

Gate 01 resolves the runtime identity tuple: Actor, Principal, Session, DelegationContext.
It enforces all identity prerequisites before any other gate runs.

Session law:
- Sessions must exist before any action proceeds through the gate pipeline.
- Sessions are created exclusively via CLI or management API. No adapter may create a
  session from caller-supplied headers.
- Gate 01 calls SessionStore.get(sessionId) to retrieve the session record regardless of
  expiry state. If null (session not found), Gate 01 returns SESSION_NOT_FOUND.
- Gate 01 computes session expiry explicitly: if session.expiresAt ≤ now, Gate 01 returns
  SESSION_EXPIRED. SessionStore does not own expiry semantics.
- Gate 01 is the sole owner of the SESSION_EXPIRED decision.

principalId derivation law:
- principalId is derived server-side from actor.principalId at session creation time.
- Session creation (CLI or management API) does not accept a caller-supplied principalId.
- The engine validates actor.principalId == delegation.principalId at session creation.
  Mismatch throws and session creation is rejected.

### 17.2 Gate 02 — Classification

Gate 02 normalizes the raw action verb, resolves the target, classifies data classes,
resolves the Capability identifier, and computes the RiskTier. All resolved fields are
written back to the AgentAction envelope for downstream gates.

Production verb taxonomy (Amendment C — ratified): read, write, create, update, delete,
execute, query, search, publish, export, send, synthesize, transmit.

Adapter-provided environment values are never trusted — actor.environment from the Gate 01
context is the only authoritative environment source for ResourceTarget.

OCT action risk ceiling is a Gate 02 input. If the action's RiskTier exceeds the actor's
OCT action risk ceiling, Gate 02 denies with RISK_CEILING_EXCEEDED. Gate 02 is the OCT
risk ceiling enforcement point.

### 17.3 Gate 03 — Delegation

Gate 03 verifies the DelegationContext signature, checks delegation expiry, enforces scope
ceilings, enforces environment match between resolved target and delegation, enforces chain
depth, checks propagation permission, and builds the DelegationContextSnapshot from the
full chain.

Gate 03 MUST deny any action where the resolved target environment differs from the
delegation context environment.

A broken chain (missing parent delegation) throws DelegationChainIntegrityError and Gate 03
returns CHAIN_INTEGRITY_BROKEN.

### 17.4 Gate 04 — Policy

Gate 04 evaluates the loaded policy bundle, finds the first matching rule in priority order,
determines the OutcomeLabel (allow, deny, require_approval, escalate), and computes the
ExecutionGrantTemplate. Default-deny if no policy loaded or no rule matches.

Gate 04 is the single authoritative point for grant template computation. No connector,
adapter, channel, or interface layer may supplement or override template computation.

Gate 04 pipeline branch: the orchestrator branches explicitly on Gate 04's OutcomeLabel
(see §16.2). This branch logic lives in the orchestrator — not inside any gate module.

Policy rule condition schema is versioned and extensible. Condition field additions require
a schema version bump. Ad hoc evaluator edits to add condition fields are a build violation.

### 17.5 Gate 05 — Approval

Gate 05 is invoked only on REQUIRE_APPROVAL or ESCALATE outcomes from Gate 04. Gate 05 is
never invoked on ALLOW paths. Gate 05 is invoked at most once per action.

Gate 05:
- Packages and signs the ApprovalRequest (expiry = approvalConfig.timeoutSeconds — invariant)
- Dispatches to the registered approval channel identified by ApprovalConfig.channelId
- Awaits a signed ApprovalResponse
- Verifies the approver's Ed25519 signature against the approver registry
- Processes the decision: approved → pass, denied → deny, timed_out → deny

Timeout always produces DENY. The machine never auto-approves an action due to timeout.
System-generated timeout responses (decidedBy: 'system:timeout') are never sent through
external signature verification.

ApprovalConfig carries a single channelId (string) in this version. Ordered multi-channel
fallback is deferred to Channel v2.

### 17.6 Gate 06 — Execution

Gate 06 is the data-plane gate. It runs only on ALLOW paths (directly from Gate 04) or on
approval-passed paths (after Gate 05 returns approved). Gate 06 is never invoked without a
valid prior Gate 04 pass and, on approval paths, a verified ApprovalResponse.

Control sub-step: assertTemplateIntegrity(), mintGrant().
Data sub-step: connector.redeemGrant(), connector.execute().

NexusSecurityViolation must be caught separately from generic connector errors:
- A security violation (broad token bypass, expired grant, template integrity failure) emits
  a ThreatEvent, preserves its denialCode, and maps to denied_threat FinalOutcome.
- A generic connector failure (network error, service unavailable) does not emit a
  ThreatEvent and maps to error FinalOutcome.
- These two categories must never be conflated.

Grant secret is cleared from vault in a finally block after every execution attempt.
Long-lived base secrets never circulate in agents, adapters, or approval payloads.

### 17.7 Gate 07 — Evidence

Gate 07 always runs regardless of upstream outcomes. No path skips Gate 07.

Gate 07:
- Builds the complete EvidenceRecord
- Materializes the CCV inside the record body before hashing
- Computes the record hash over the full body including CCV
- Signs that hash with the control-plane Ed25519 keypair
- Appends to the hash-chained evidence ledger with sequence integrity
- Records the final outcome

Evidence is always written — even on pipeline crash, partial evidence is preferred to
none. Gate 07 is never conditional.

### 17.8 Pipeline Branch Law

The pipeline branch after Gate 04 is an explicit stateful control-flow decision inside
the orchestrator. Gate 05 and Gate 06 conform to the standard gate interface:
evaluate(action, context, priorDecisions) → GateResult. Branch logic lives in the
orchestrator — not inside gate modules. The orchestrator is not a generic gate loop.

Gate sequence invariants (all absolute — no exceptions):
- Gate 01 through Gate 04 always execute in order before any branch
- Gate 05 executes only on REQUIRE_APPROVAL or ESCALATE outcomes — never on ALLOW
- Gate 06 executes only after Gate 04 ALLOW, or Gate 05 PASS — never before Gate 04
- Gate 07 executes exactly once per action, regardless of all upstream outcomes
- No gate may be skipped by outcome state, exception, or orchestrator design

### 17.9 Default-Deny Posture per Gate

Every gate is individually default-deny. A gate that returns an ambiguous or missing
result is treated as DENY by the orchestrator. Ambiguity is never resolved in favor
of the action. A gate that throws is treated as ERROR, which routes to Gate 07 directly.

---

## 18. Token and Action Replay

### 18.1 Replay Detection

The NXS engine assigns a unique actionId at ingress. The replay detector checks actionId
uniqueness in a SQLite-backed dedup table over a configurable TTL window (default 3600s).
A repeated actionId within the window produces DENIED with REPLAY_DETECTED and a ThreatEvent.

### 18.2 Sequence Assignment

The engine assigns a delegationSequence at ingress — a monotonically increasing counter
per delegationContext. Sequences are engine-assigned only. Adapters never provide sequence
numbers. Sequence numbers are stored in EvidenceRecord.actionSummary for forensic ordering
and audit. delegationSequence is a forensic field — not a CCV field.

### 18.3 Sequence Anomaly Law

SEQUENCE_ANOMALY is a governed denial code. It is emitted by the ledger chain verifier
when sequence discontinuities are detected — gaps or regressions in ledgerSequence across
evidence records. Sequences are engine-assigned atomically at ingress; no sequence anomaly
is possible at runtime without post-write tamper. The chain verifier checks expectedSeq
continuity on every verification pass. A gap or regression emits a ChainError with type
sequence_anomaly and denialCode SEQUENCE_ANOMALY.

SEQUENCE_ANOMALY is emitted by the chain verifier only. No other component may emit this
signal. Any ingress-time emission is a build violation.

### 18.4 Replay TTL Bounds

TTL is configurable with bounds: minimum 300s, maximum 86400s. Default 3600s.
Value outside bounds: engine refuses to start. A decrease below default is logged as a
posture change event in the Evidence Ledger.

---

## 19. Human Approval Law

### 19.1 When Approval Is Required

Any action with OutcomeLabel require_approval or escalate from Gate 04 must pass through
Gate 05 before Gate 06 may run. Timeout always produces DENY. The machine never auto-approves
an action due to timeout.

### 19.2 ApprovalRequest Minimums

Every ApprovalRequest must carry: approvalId, actionId, templateId, issuedAt, expiresAt,
actionSummary, contextSummary, proposedTarget, diff (if connector produces one),
estimatedImpact, principalDisplayName, actorDisplayName, riskTier, dataClasses,
modelConfidence, riskNote, signature (Ed25519 over canonicalized body).

### 19.3 Expiry Invariant

ApprovalRequest.expiresAt must equal addSeconds(issuedAt, approvalConfig.timeoutSeconds).
The signed expiry and the runtime timeout decision window must be identical. Hardcoded expiry
constants are prohibited. This is an invariant enforced by test.

### 19.4 Approver Key Contract

Approver private keys are stored per approverId in a gitignored directory. Keys are loaded
exclusively via key-manager by approverId. No approval command proceeds without an explicit
approverId. Dev key fallback is permitted in test fixtures only, labeled
FIXTURE_SYNTHETIC_SECRET. Approver public keys are stored in the approver registry.
ApprovalResponse signature is verified against the registry public key before acceptance.

The blueprint fixes the trust contract: per-approver keys, gitignored, loaded by ID,
never committed. Exact filesystem paths and key format are defined in the engineering spec.

### 19.5 Approval Channel Law

ApprovalConfig carries a single channelId (string) in this version. Ordered multi-channel
fallback is deferred to Channel v2. Gate 05 resolves the channel from the registry by
channelId. APPROVAL_CHANNEL_NOT_FOUND is returned if channelId is not registered.

Approval channels:
- CLI — Channel v1 — current release — fully implemented (channelId: 'cli')
- Webhook — Channel v2 — interface contract locked — implementation next build cycle
- Slack — Channel v3 — future roadmap

All channels implement the same approval channel interface (MODULAR-004). No webhook code,
stub, or partial implementation exists in this version. Treating the interface as permission
to scaffold partial webhook code is a build violation.

### 19.6 Approval Decision Service Law

The pending approval store must expose a getRequest(approvalId) method that returns the
stored, signed ApprovalRequest JSON for that approval ID. Both CLI and management API
approval handlers must use a single shared approval-decision service
(decideApproval(approvalId, approverId, decision, note?)) as the sole signing path.
No duplicate approval-signing logic may exist across CLI and API surfaces.

The shared service must:
1. load the pending record — reject if not found
2. reject if status is not pending
3. parse the stored ApprovalRequest via getRequest()
4. reject if expired
5. load the approver key via the key manager
6. build and sign the ApprovalResponse
7. persist via store.resolve()

CLI and management API are thin shells that call this service. They do not re-implement
signing logic.

### 19.7 ApprovalResponse Verification

Gate 05 verifies the approver's Ed25519 signature against the registered public key before
accepting any decision. An unsigned response, a response signed by an unregistered approver,
or a response with an invalid signature always produces DENY with APPROVAL_SIG_INVALID.

System-generated timeout responses (decidedBy: 'system:timeout') are never sent through
external signature verification.

### 19.8 Signed Approval Chain

The control plane signs the ApprovalRequest. The approver signs the ApprovalResponse.
Both signed artifacts are stored in EvidenceRecord. The full signed chain is provable
from a clean ledger read without any other context.

---

## 20. Evidence Ledger Law

### 20.1 Append-Only

The NXS evidence ledger is append-only. No UPDATE or DELETE operation may exist on the
ledger interface. Chain integrity depends on immutability. The ledger backend is an
interface (MODULAR-003). JSONL is the designated Backend v1 — this is an architecture
version designation, like "MCP is Adapter v1." JSONL-specific schema, format, and file
management details are defined in the engineering spec.

### 20.2 Hash Chain

Every EvidenceRecord carries previousHash (SHA-256 of the prior record) and recordHash
(SHA-256 of the full canonicalized record body including CCV). The first record carries
GENESIS_HASH as previousHash.

### 20.3 Signing

Each EvidenceRecord is signed by the control-plane Ed25519 private key at write time.
Signature covers recordHash — the hash of the full body including CCV.

### 20.4 Always-Write

Every action — allowed, denied, approval-denied, timed-out, or errored — produces an
EvidenceRecord. Gate 07 is never conditional. Even on pipeline crash, partial evidence
is preferred to no evidence.

### 20.5 Intent and Rationale Minimums

Every EvidenceRecord must include:

- actor identity and actor class
- principal identity
- environment (from actor registration — guaranteed present even on pre-classification failures)
- delegation-context identifier and chain snapshot (all hops)
- delegationSequence (engine-assigned per-delegation counter; forensic ordering; not in CCV)
- classified Capability
- ActionVerb
- target resource type
- DataClasses
- RiskTier
- objective summary (bounded extraction from intent context)
- triggering source or event
- toolchain or adapter context available at execution time
- model identity and model confidence when present
- policy rule identifier matched and OutcomeLabel
- approval-required flag
- ApprovalDecisionLabel
- FinalOutcomeLabel

**EvidenceRecord field-type law:** For EvidenceRecord encoding, applicability-governed
fields are typed as their normal governed type OR the governed sentinel string. This union
applies only to EvidenceRecord encoding — it does not change the governed type definitions
in §5. OutcomeLabel remains `allow | deny | require_approval | escalate` as a governed
type; inside an EvidenceRecord on a pre-policy-denial path, the OutcomeLabel field carries
the sentinel string instead. The same union applies to ApprovalDecisionLabel, RiskTier,
DataClasses, Capability, approval-required, and all other applicability-governed fields
listed below. The engineering spec defines the exact sentinel string and the union type
schema for EvidenceRecord fields.

**Early-denial applicability law:** Fields that depend on a gate that has not executed
carry a governed sentinel string value instead of their normal type. The sentinel is a
non-null string defined in the engineering spec. Fields are never null and never omitted —
the record is structurally complete with every field present in all cases. A Gate 01 denial
(identity failure) occurs before classification; classified Capability, DataClasses,
RiskTier, target resource type, policy rule identifier, OutcomeLabel, and approval-required
flag carry the sentinel. A Gate 02 denial occurs before policy evaluation; policy rule
identifier, OutcomeLabel, and approval-required flag carry the sentinel. A Gate 03 denial
occurs before policy evaluation; same fields carry the sentinel.

**Approval-field applicability law:** ApprovalDecisionLabel carries the sentinel on all
paths where Gate 05 did not execute: direct ALLOW (Gate 04 → Gate 06, no approval needed),
policy DENY, early identity/classification/delegation denials, and any error path that
bypasses Gate 05. The approval-required flag carries the sentinel on all paths where Gate 04
did not execute. On paths where Gate 04 executed and set approval-required to false,
ApprovalDecisionLabel still carries the sentinel — Gate 05 was correctly not invoked.

The blueprint fixes the architecture: one sentinel string type, one encoding strategy,
no nulls, every field present. The engineering spec defines the exact sentinel string value.

### 20.6 Execution-Grant Metadata Minimums

EvidenceRecord must include execution-grant metadata sufficient to prove authority without
exposing the secret. At minimum: grant identifier, scope descriptor, CredentialSubject type,
expiry class, issuance time, expiry, approval linkage, and template fingerprint.
Secret value must never be written into evidence.

**Applicability law:** Execution-grant metadata fields apply to all paths where Gate 06
minted a grant — regardless of whether execution succeeded, failed, or was interrupted.
A grant that was minted but whose execution ended in denied_threat (NexusSecurityViolation)
or error (connector failure) still has valid metadata: the grant existed, was scoped, and
was attempted. On paths where no grant was minted (denials before Gate 06, approval timeout,
policy deny), all execution-grant metadata fields carry the governed sentinel string defined
in §20.5 applicability law. On direct ALLOW paths where a grant was minted without Gate 05
approval (approval-required was false), the approvalLinkage field within grant metadata
carries the sentinel — the grant exists and is valid, but no approval artifact is linked.
Fields are never null and never omitted — the record is structurally complete in all cases.
The engineering spec defines the exact sentinel value.

### 20.7 Redaction Law

Before EvidenceRecord write, redact: PII, PHI, financial data in results; base-secret values
in any field; raw model prompts containing sensitive data; reasoning traces containing
sensitive user data; intent fields exceeding the defined length ceiling (truncate and flag).
Redacted fields are replaced by a governed redaction marker (defined in engineering spec).
Redacted fields are not removed — the record remains structurally complete.

### 20.8 Compiler Comparison View (CCV)

Every EvidenceRecord must contain a materialized CompilerComparisonView within its signed
body. The CCV is the stable semantic surface for comparing NXS gate decisions across agents,
runs, and versions. The CCV is inside the tamper-evident boundary: it is included in the
body before the record hash is computed. The CCV is never computed or stored outside the
signed EvidenceRecord body.

Two actions are logically comparable if they share: same blueprint version, same runtime
contract version, same capability taxonomy version, same comparison input version, and same
actor class, environment, capability, data classes, and risk tier.

The CCV must include at minimum:

**meta section**: blueprint version, runtime contract version, capability taxonomy version,
comparison input version, normalized action hash (SHA-256 of canonical action envelope),
policy bundle hash (hash of loaded policy file)

**identity section**: actor identifier, actor class, principal identifier, environment

**delegation section**: delegation context identifier, chain depth, chain hash (SHA-256 of
canonical chain snapshot), maximum risk tier from delegation

**classification section**: capability identifier, action verb, data classes sorted, risk tier

**policy and approval section**: policy rule identifier, OutcomeLabel, approval-required flag,
ApprovalDecisionLabel

**authority and execution section**: execution grant identifier, CredentialSubject type,
scope descriptor, expiry class, ExecutionGrantTemplate fingerprint (SHA-256 of template
minus live credential)

**result section**: FinalOutcomeLabel, error code family

CCV field definitions are blueprint law. CCV schema changes require a blueprint version bump.
No spec or implementation change may silently redefine CCV semantics. CCV is an NXS
evidence concept only — it is not a NVG routing concept. NVG routing comparison uses the
Routing Provenance Trail, cross-linked by run ID.

### 20.9 Chain Integrity and Sequence Continuity

The chain verifier must enforce both hash linkage and sequence continuity. A gap or regression
in ledgerSequence is a chain integrity violation. SEQUENCE_ANOMALY is emitted for sequence
discontinuities detected during chain verification. Sequence continuity enforcement is not
optional — a ledger with sequence gaps is not a valid ledger.

---

## 21. Compile / Return Path

### 21.1 OCT-COMPILE Actor

After agents return results to the orchestrator, the orchestrator invokes the compile step.
The compile actor is assigned OCT-COMPILE. The compile actor assembles the final response.

The stack does not mandate a compile implementation:
- Build a custom compile agent — register as OCT-COMPILE actor in NXS registry
- Use a third-party compile agent — register as OCT-COMPILE actor
- Use an on-prem synthesis model — register as OCT-COMPILE actor
- Use the reference deterministic renderer — no registration required (see §21.4)

All registered compile paths are governed identically. The stack enforces the OCT ceiling.
The enterprise owns the implementation.

### 21.2 Three Compile Modes

**Mode 1 — Deterministic Render**: reference implementation — always available, zero risk.
No model call. No wall crossing. Stays entirely inside the enterprise boundary. Produces
tables, charts, structured summaries, formatted text. Available to all enterprises
regardless of on-prem model availability.

**Mode 2 — On-Prem Synthesis**: enterprise provides an on-prem model as compile actor.
Inside the boundary. No NVG outbound call needed. OCT-COMPILE assigned. Inherits highest
data class of all inputs at runtime.

**Mode 3 — Frontier Synthesis**: permitted only if:
- Inherited data class of all compile inputs is not sensitive / restricted
- Operator has explicitly configured frontier synthesis in signed policy

The compile request routes through NVG (outbound) — same as any other model call.
The response returns through NVG (inbound logged, normalized). If any input is OCT-SECURE
or sensitive-classified: Mode 3 is hard-denied. Falls back to Mode 1 or Mode 2.
There is no silent fallback to frontier.

### 21.3 OCT-COMPILE Inheritance Rule

The compile actor's effective data class ceiling at runtime equals the highest data class
of all its inputs. This rule is not operator-configurable and not overridable.

Example: Sales Agent result is sensitive. Market Intelligence result is general.
Compile inherits sensitive. Mode 3 (frontier synthesis) is hard-denied for this run.
Only Mode 1 or Mode 2 is permitted.

Operational note: in mixed-OCT runs, the inheritance rule will frequently force Mode 1
(deterministic) rendering. Operators should design compile outputs with this in mind when
handling sensitive + general mixed workloads.

### 21.4 Reference Deterministic Renderer Exemption

The reference deterministic renderer is a built-in system utility, not a registered actor.
It is exempt from actor registration because it makes no model calls, executes no system
actions, and issues no delegations. It only formats data already inside the enterprise
boundary. This exemption is explicit and intentional. It does not weaken governance because
there is no governed surface for it to cross.

### 21.5 Final Response Law

The compiled answer returns to the user through the workspace surface only:
- Not from raw model output
- Not directly from a sub-agent
- Not directly from a frontier model provider
- Only from the governed workspace surface

The run is closed at final response delivery. A final Run Ledger entry is written.

---

## 22. Three Audit Streams

### 22.1 Stream 1 — Routing Provenance Trail (NVG)

The NVG audit stream. Append-only. Queryable via management API and CLI.

Every entry carries:
- Actor identity and OCT
- Data classification decision and routing policy version applied
- Model tier selected and invoked
- Outbound request and inbound return linked by run ID and correlation ID
- Any denial or quarantine with reason code
- Fallback events with reason and tier selected
- Cost and latency metrics

### 22.2 Stream 2 — Evidence Ledger (NXS)

The NXS audit stream. Append-only. Hash-chained. Signed. Sequence-continuous.
Every NXS action — successful or failed — produces an Evidence Ledger entry.
Full specification in §20. SEQUENCE_ANOMALY emitted by chain verifier only on any gap.
Queryable via management API and CLI. SIEM export formats available.

### 22.3 Stream 3 — Run Ledger

The run-scoped audit stream. Mandatory for all runs including NVG-bypass runs.
One Run Ledger is opened per run at workspace entry.

Every Run Ledger covers:
- Run ID assigned at workspace entry
- Orchestrator actor and OCT
- Task split and agents selected
- Delegation grants issued per agent
- Model call events (linked to Routing Provenance Trail entries by run ID)
- System action events (linked to Evidence Ledger entries by run ID)
- Partial results received per agent
- Compile mode selected and OCT ceiling applied
- Final response delivered and run closed

For NVG-bypass runs: Run Ledger explicitly notes bypass — no NVG entries for this run.
The absence of NVG trail entries is expected and recorded, not an integrity gap.

### 22.4 Cross-Link Law

All three streams are cross-linked by run ID. Every entry in every stream for a governed
run carries the same run ID. Cross-linking is mandatory — not optional. An Evidence Ledger
entry without a run ID is an audit integrity violation. A Routing Provenance Trail entry
without a run ID is an audit integrity violation. A Run Ledger entry without a run ID is
an integrity violation.

Run ID enables reconstruction of the complete forensic record: who asked what, which agents
were selected, what data left the boundary and to where, what actions were authorized, how
results were compiled, and what was delivered to the user.

### 22.5 Run Ledger Bypass Annotation Law

When a run uses the NVG-bypass path (§13.9):
- The Run Ledger entry must explicitly annotate: bypass_path: true, nvg_entries: false
- The NXS Evidence Ledger entries are present and intact
- No Routing Provenance Trail entries exist for the run — this is expected
- The annotation is required — an unannotated bypass run is an audit integrity violation

---

## 23. Token and Credential Governance Law

### 23.1 Base Secrets and Storage

Base secrets must live only in a governed vault connector or cloud identity path. Never
injected into agents, adapters, or approval payloads. Static tokens in code, config, or
chat logs are build violations. Test fixtures MAY contain synthetic secrets explicitly
labeled as non-production (using the FIXTURE_SYNTHETIC_SECRET prefix); such secrets must
never be used outside test harnesses.

### 23.2 Execution-Grant Law and Fingerprint Projection

ExecutionGrants must be short-lived, action-bounded or narrowly scoped, produced as a
function of the specific actor/delegation/policy/approval state for this action, a strict
subset of the DelegationContext that authorized them, and kept in memory only for the
duration of the action.

The ExecutionGrantTemplate fingerprint must be computed using a shared projection helper
that excludes templateFingerprint and approvalLinkage from the payload by field omission —
not by undefined substitution. buildGrantTemplate and assertTemplateIntegrity must call the
same helper. Any deviation between the two computation paths is a security violation.

Undefined values are illegal in all canonicalized payloads. The canonicalize() function must
strip undefined-valued keys and throw if a non-key undefined is encountered. This law applies
to all signature and hash computation paths.

### 23.3 Scope Law

Every ExecutionGrant scoped at minimum by: target system, Capability, relevant resource
bounds, and expiry. Scope law must distinguish at minimum: read-one versus bulk-export;
draft versus send; internal update versus customer-facing write; view-analytics versus
extract-PII.

### 23.4 Credential Subject Law

CredentialSubject selection is explicit engine law determined by the ExecutionGrantTemplate
at Gate 04. Connectors implement redemption against the specified CredentialSubject type —
they do not choose it.

### 23.5 Rotation and Posture

Rotation priority: write/send/publish/delete/export on customer-facing systems → high;
write on internal → medium; read-only on internal → low. Control interface must expose
token posture summary.

### 23.6 Cross-Connector Portability

ExecutionGrants must be redeemable across connector implementations without engine changes.
Engine produces grant; connector redeems it through the connector interface.

### 23.7 Execution Violation Law

NexusSecurityViolation must be caught separately from generic connector errors in Gate 06.
A security violation (broad token bypass, expired grant, template integrity failure) emits
a ThreatEvent, preserves its denialCode, and maps to denied_threat FinalOutcome.
A generic connector failure (network error, service unavailable) does not emit a ThreatEvent
and maps to error FinalOutcome. These two categories must never be conflated.

---

## 24. Plane and Layer Stack

### 24.1 Control Plane and Data Plane

The architecture is split across two planes. Each plane spans both NVG and NXS.

**Control Plane**: Owns every decision in both engines.
NVG control: data classification, egress policy evaluation, model tier routing decision,
denial / quarantine routing, Routing Provenance Trail write.
NXS control: actor resolution, delegation verification, policy evaluation, ExecutionGrantTemplate
computation, approval orchestration, approval signature verification, execution-grant minting,
Evidence Ledger write and chain management, CCV materialization.

**Data Plane**: Owns every forwarding operation.
NVG data: model invocation, inbound response normalization, cost / latency tracking.
NXS data: ingress normalization, protocol translation, connector forwarding, result capture,
redaction before evidence write.

### 24.2 Layer 1 — Core Engine (NXS / nexus/packages/core)

The NXS core engine. Receives a canonical AgentAction envelope from any adapter or the
Post-Inference Action Normalizer and executes all seven gates in fixed order. Enforces gate
order and default-deny at every gate. Owns execution-grant template computation and grant
minting under §23 law. Materializes the CCV within the signed EvidenceRecord at Gate 07.
Writes an evidence record for every action regardless of outcome.

Layer 1 must never import adapter-specific, connector-specific, channel-specific, vanguard-
specific, or control-interface-specific code. Layer 1 imports from Layer 2 only.

### 24.3 Layer 2 — Shared Contract (nexus-contracts / nexus/packages/contracts)

The canonical shared type layer. Defines all contract shapes, governed type constants,
gate interface, ledger backend interface, adapter interface, connector interface, approval
channel interface, identity provider interface, and AgentAction schema. Every other layer
imports from Layer 2. Layer 2 imports from nothing inside the monorepo.

Layer 2 must be fixed before any other layer is implemented. Any change to Layer 2 that
is not explicitly additive is a version-bump event for every layer that consumes the
changed interface.

### 24.4 Layer 3 — Wall Enforcement Engine (NVG / nexus/packages/vanguard)

The NVG wall enforcement engine. Governs outbound data classification, egress policy,
model routing, model invocation, inbound return logging, and Routing Provenance Trail writes.

Layer 3 imports from Layer 2 only. Layer 3 never imports from Layer 1. Layer 1 never
imports from Layer 3. NVG and NXS share type contracts — they never share internals.

### 24.5 Layer 4 — Protocol Adapters (nexus/packages/adapters)

Protocol adapters translate incoming agent actions from a specific wire protocol into the
Layer 2 canonical AgentAction envelope. Adapters extract intent context from protocol-
specific metadata. Adapters never alter gate behavior, never mint credentials, and never
define authority law.

**Adapters MUST NOT set or override environment.** Environment is resolved from actor
registration at Gate 01. No adapter-provided field may influence ResourceTarget.environment.

**Adapters MUST NOT create sessions.** Sessions are created exclusively via CLI or management
API. Any adapter path that auto-creates a session from caller-supplied headers is a trust
boundary violation.

MCP is Adapter v1 — fully implemented. REST is Adapter v2 — interface contract locked,
implementation is a production target for the next build cycle. No partial REST adapter
code exists in this version.

### 24.6 Layer 5 — Connector Registry (nexus/packages/connectors)

Pluggable connectors for executing actions against target systems. Connectors redeem
execution grants through governed paths. Connectors must never: define credential law,
pull long-lived base secrets directly from configuration, or expand scope beyond the grant.

Connectors implement the connector interface from Layer 2. StubConnector is the test
reference. HashiCorp Vault connector is the production reference.

### 24.7 Layer 6 — Identity Layer (nexus/packages/identity-ref)

The Reference Identity Adapter package. Implements the identity-provider interface from
Layer 2. Optional — present only for starter deployments without enterprise IAM or RBAC.
Production deployments with enterprise IAM or RBAC disable or remove this layer.

Enterprise IAM and enterprise RBAC integrations also implement the Layer 2 identity-provider
interface. They are enterprise-provided — not shipped in this stack.

### 24.8 Layer 7 — Control Interface (nexus/packages/interfaces)

Exposes governance surfaces to human operators: CLI, management API, and (deferred) dashboard.
Layer 7 is built last. Layer 7 imports from Layer 2 for all type contracts. The CLI package
may additionally import core/ (Layer 1) engine entry points for command dispatch — this is
the sole permitted cross-layer import and must not expose engine internals to the operator.
Layer 7 must not expose engine internals through its public surface.

Management API trust boundary (from §26.2): binds to 127.0.0.1 only. All routes require
admin bearer token. No exposure beyond localhost in this version.

**Gate-to-Plane Assignment:**

| Gate                | Plane                                                      |
|---------------------|------------------------------------------------------------|
| Gate 01 — Identity  | Control                                                    |
| Gate 02 — Classification | Control                                               |
| Gate 03 — Delegation | Control                                                   |
| Gate 04 — Policy    | Control                                                    |
| Gate 05 — Approval  | Control                                                    |
| Gate 06 — Execution | Control (grant minting) + Data (connector forwarding)      |
| Gate 07 — Evidence  | Control                                                    |

Gate 06 is hybrid. Grant minting is control-plane law. Connector forwarding is data-plane
operation. These two sub-steps must be physically distinct and must not share mutable state.

---

## 25. Modularity Law

**MODULAR-001**: Protocol never baked into core engine. Adapters implement the adapter
interface from Layer 2. MCP is Adapter v1. No adapter type may be imported by Layer 1.

**MODULAR-002**: Actor class is a governed open string type. Never a closed TypeScript
union ceiling. Adding an actor class requires no engine rewrite.

**MODULAR-003**: Ledger backend is an interface defined in Layer 2. JSONL is Backend v1.
No backend-specific logic belongs in core ledger law.

**MODULAR-004**: Approval channel is an interface defined in Layer 2. CLI is Channel v1.
No channel-specific transport logic belongs in the approval orchestrator core.

**MODULAR-005**: Connector is an interface defined in Layer 2. Resolved by registered type
at runtime. No connector type may define credential law or expand grant scope.

**MODULAR-006**: RiskTier is a governed open string type. Adding a tier requires no engine
changes. Evaluator reads tier from registry — not from a closed enum.

**MODULAR-007**: Policy rule condition schema is versioned and extensible. Condition field
additions require a schema version bump and re-signing. Ad hoc evaluator edits are a
build violation.

**MODULAR-008**: ExecutionGrant template computation is engine law. Gate 04 is the single
authoritative computation point. No connector, adapter, channel, or interface layer may
supplement or override it.

**MODULAR-009**: CCV field definitions are blueprint law. CCV schema changes require a
blueprint version bump. No spec or implementation change may silently redefine CCV semantics.

**MODULAR-010**: NVG (Layer 3) and NXS (Layer 1) are independent packages. Layer 1 never
imports Layer 3 internals. Layer 3 never imports Layer 1 internals. Communication is
through Layer 2 contracts only. Coupling NVG and NXS internals is a build violation.

**MODULAR-011**: ModelTier is a governed open string type in Layer 2. Adding a new model
tier is a registry update plus a new signed routing policy version — not a code change to
the NVG routing engine. Treating ModelTier as a closed TypeScript enum is a build violation.

**MODULAR-012**: The identity-provider interface is defined in Layer 2. The Reference
Identity Adapter (Layer 6), enterprise IAM integrations, and enterprise RBAC integrations
all implement this interface. Layer 1 (NXS) and Layer 3 (NVG) consume the interface —
never the implementation. No identity-provider implementation detail may be imported by
Layer 1 or Layer 3.

**MODULAR-013**: NVG routing policy is versioned, signed YAML. Adding a new routing rule
requires a policy version bump and re-signing — not a code change to the NVG routing engine.
The routing engine evaluates rules from the loaded policy — not from hardcoded logic.

**MODULAR-014**: Run Ledger is defined as an interface in Layer 2. Both NVG and NXS write
run events through that interface. The Run Ledger backend is pluggable. No Run Ledger
backend implementation may be imported by Layer 1 or Layer 3 directly.

**MODULAR-015**: OCT is a governed open string type in Layer 2. Adding a new OCT level
requires no engine rewrite in NVG or NXS — it requires an operator registry update and
a new signed policy that references the new tier. Treating OCT as a closed TypeScript enum
is a build violation.

Violation of any MODULAR rule is a CONTRA log entry and must be surfaced and resolved
before the build continues.

---

## 26. Assertion Boundary

### 26.1 Machine Assertion Law

The machine governs, routes, brokers bounded execution authority, classifies data,
enforces model-tier ceilings, and records. It does not certify. It does not guarantee
safety. It does not make compliance determinations. Compliance decisions remain with humans.
The stack provides the evidence. Humans provide the judgment.

The system MAY assert:
- Action allowed under policy rule X
- Action denied with denial code Y
- Human approval was received / denied / timed out
- Delegation chain is valid or broken at link Z
- Evidence record is cryptographically intact and sequentially verified
- Data classification routed payload to model tier T under policy P
- OCT ceiling prevented model call for actor A
- Actor not registered; delegation expired; policy file signature invalid
- Execution grant minted and redeemed under governed scope
- Replay detected

The system MAY NOT assert:
- This action is safe
- This agent is trustworthy
- The system certifies compliance with regulation X
- This action is approved by the system
- This routing decision certifies the data is safe
- The model response is compliant

Prohibited language anywhere in the stack or its outputs:
"approved by system" / "Nexus certifies" / "system confirms compliance" /
"this action is safe" / "compliant action" / "authorized by engine."

### 26.2 Management API Trust Boundary

The management API is a mutation surface. Its trust boundary is explicit architecture law:

- Binds to 127.0.0.1 only — no network exposure permitted in this version
- All routes (mutation and read) require a local admin bearer token
- Admin token is generated at initialization and must not be committed to the repo
- No exposure beyond localhost is permitted in this version
- Production upgrade path: replace bearer token with mTLS or local Unix socket —
  an architectural swap, not a new insertion

Exact token storage path, generation mechanism, and header format are defined in the
engineering spec. The blueprint fixes the trust contract; the spec fixes the implementation.

---

## 27. Monorepo Package Structure

The entire Nexus Stack is implemented in a single TypeScript strict monorepo.

```
nexus/
  packages/
    core/           Layer 1 — NXS authority engine, seven gates, ledger, crypto
    contracts/      Layer 2 — canonical shared types, interfaces, governed constants
    vanguard/       Layer 3 — NVG wall enforcement engine, routing, audit trail
    adapters/
      mcp/          Layer 4 — MCP Adapter v1 (current release, fully implemented)
      rest/         Layer 4 — REST Adapter v2 (interface contract locked; not implemented)
    connectors/
      stub/         Layer 5 — StubConnector (testing reference)
      vault/        Layer 5 — HashiCorp Vault connector (production reference)
    identity-ref/   Layer 6 — Reference Identity Adapter (optional starter package)
    interfaces/
      cli/          Layer 7 — CLI control interface
      api/          Layer 7 — Management API (localhost-only)
  docs/
    nexus-blueprint-v1-4-12.md        (this document)
    nexus-engineering-spec-v1-4-12.md (engineering spec — to be produced after owner approval)
  keys/
  fixtures/
  schemas/
  scripts/
```

**Package dependency law (hard rules):**
- contracts/ is imported by all packages — never the reverse
- core/ (Layer 1) and vanguard/ (Layer 3) never import each other
- adapters/ imports contracts/ — never core/ or vanguard/ internals
- connectors/ imports contracts/ — never core/ or vanguard/ internals
- identity-ref/ implements the identity-provider interface from contracts/
- interfaces/ imports contracts/ for types. The CLI package may additionally import core/
  engine entry points for command dispatch — this is the sole cross-layer exception and
  must not expose engine internals through the CLI surface
- Any violation of these dependency rules is a MODULAR violation

---

## 28. Build Order

Build layers in this sequence. No layer is started until the layer below it has its
interfaces fixed. Gate design precedes implementation. A red gate stops the build.

1. **Layer 2 — contracts**: all governed type constants, all interfaces, all contract
   shapes, AgentAction schema. Fixed before any other layer starts.

2. **Layer 1 — core engine (NXS)**: gate interface, crypto layer, all seven gates
   in spec order, pipeline orchestrator, ledger backend (JSONL Backend v1), SQLite schema,
   security layer (replay, injection guard, rate limiter, threat log), registries,
   delegation engine, policy signing utility, default policy.

3. **Layer 3 — vanguard (NVG)**: wall enforcement engine, data classification, egress
   policy engine, model routing, model invocation abstraction, inbound logging,
   Routing Provenance Trail backend.

4. **Layer 4 — adapters**: MCP Adapter v1 (full implementation). REST Adapter v2
   (interface contract only — no implementation in this version).

5. **Layer 5 — connectors**: StubConnector (test reference), Vault connector
   (production reference).

6. **Layer 6 — identity-ref**: Reference Identity Adapter (optional). Implements
   identity-provider interface from Layer 2.

7. **Layer 7 — control interface**: CLI (full implementation — imports core/ engine
   entry points for command dispatch), management API (full implementation — localhost-only).
   Dashboard: deferred.

**Gate design law (non-negotiable):**
- Every module has a defined gate before implementation begins
- Gates are written in the spec before code is written
- Each module passes its gate before the next module is built
- A red gate stops the build — no downstream work on a red gate
- Gates are not polish — they are the definition of done

---

## 29. Portability Thesis

The NXS engine, NVG engine, runtime contracts, and execution-grant law remain stable while
adapters, connectors, approval channels, model tier registrations, and identity-provider
integrations are additive implementations. This is the portability law:

- Changing the protocol adapter requires zero changes to core NXS engine or runtime contract
- Changing the downstream connector requires zero change to execution-authority law
- Changing the approval channel requires zero changes to the approval orchestrator's core
- Changing the model tier routing policy requires zero changes to the NVG routing engine
- Changing the identity provider implementation requires zero changes to NVG or NXS internals
- Adding a new actor class requires zero engine changes
- Adding a new OCT tier requires zero engine changes
- Adding a new model tier requires zero engine changes — registry update only

---

## 30. Drift Prevention Rules

- do not let NVG and NXS import each other's internals
- do not let contracts/ import from core/ or vanguard/
- do not let the adapter protocol become a core engine type
- do not let the approval channel become a core orchestrator type
- do not let the ledger backend become a core ledger type
- do not let the control interface drive gate pipeline design
- do not collapse NVG (Layer 3) and NXS (Layer 1) into one package
- do not let a connector define or modify credential law
- do not let an actor class addition require a core engine rewrite
- do not let any execution path bypass execution-grant law
- do not let a long-lived base secret enter an agent, adapter, or approval payload
- do not let the machine assert certification, compliance, or safety
- do not let timeout produce auto-approval
- do not let Gate 07 be conditional on upstream outcomes
- do not let sub-agent delegation expand beyond parent bounds
- do not let intent logging become unrestricted prompt capture
- do not let Gate 02 compute scope or grant template
- do not let Gate 04 grant template computation be overridden by a connector
- do not let the engineering spec introduce a new closed-union ceiling on any governed open type
- do not let CCV field definitions change without a blueprint version bump
- do not let CCV be computed or stored outside the signed EvidenceRecord body
- do not let canonicalization for signing or hashing be non-recursive
- do not let Gate 03 pass when action target environment differs from delegation environment
- do not let any adapter create a session from caller-supplied headers
- do not let the management API accept mutation routes without a local admin bearer token
- do not let ApprovalConfig carry a list of channels — it carries a single channelId in this version
- do not let session creation accept a caller-supplied principalId — derive from actor registration
- do not let buildGrantTemplate and assertTemplateIntegrity compute fingerprints over different payloads
- do not let undefined values enter canonicalize() or any signature / hash computation path
- do not let NexusSecurityViolation be caught by the generic connector error handler
- do not let ledger sequence gaps pass chain verification
- do not let model tier ceiling be widened by fallback routing under any configuration
- do not let sensitive data reach frontier tiers under any policy configuration
- do not let OCT assignment be self-declared by the actor
- do not let mode change proceed without a signed admin command and mandatory audit event
- do not let enforcing-lock be downgraded without multi-party admin approval and audit event
- do not let compile Mode 3 proceed when any input is OCT-SECURE or sensitive-classified
- do not let OCT-COMPILE inheritance rule be operator-configured — it is a hard rule
- do not let the reference deterministic renderer be used as an identity source
- do not let NVG inbound path perform content inspection on model responses
- do not let a new model tier be added without a registry update and new signed routing policy
- do not let OCT grant more authority than the identity-provider capability ceiling permits
- do not let Run Ledger entries be omitted for any run — bypass runs are not exempt
- do not let NVG-bypass runs omit the bypass annotation in the Run Ledger
- do not let the workspace be bypassed as an architectural pattern — it is the only authorized entry point
- do not let NVG routing policy contain a rule that routes sensitive data to a frontier tier

---

## 31. The Complete Governed Loop

This section is a standalone architecture-law surface preserving the full governed loop
as a single anti-drift reference. Every component described in §6–§22 participates in
this loop. If any component is removed, weakened, or bypassed, the loop is broken.

```
USER
  → Enterprise Workspace (identity-provider-gated — only authorized entry point)
  → Run ID assigned at workspace entry
  → Run Ledger opened at workspace entry (§22.3 — workspace owns timing)
  ↓
ORCHESTRATOR (governed actor, OCT assigned, registered in actor registry)
  → receives user request from workspace
  → selects agents from governed agent registry per task
  → issues scoped, signed delegation to each selected agent
  → dispatches sub-tasks
  ↓
FOR EACH AGENT:

  If model call needed:
    → NVG OUTBOUND (Checkpoint 1)
        classify data + enforce OCT model ceiling + enforce wall
        if denied: terminate, no model called, Routing Provenance Trail entry written
        if approved: route to selected model tier
    → Model executes (on-prem or frontier per classification + OCT)
    → NVG INBOUND
        log return event, normalize result, pass to orchestrator boundary
    → Result returned to orchestrator, Run Ledger updated

  If system action needed:
    → NXS (Checkpoint 2) — seven gates, default-deny
        Gate 01: identity / session
        Gate 02: action classification + OCT risk ceiling
        Gate 03: delegation chain verification
        Gate 04: policy evaluation → ALLOW / REQUIRE_APPROVAL / DENY
        Gate 05: human approval (if required — never on ALLOW)
        Gate 06: execution grant → connector → target system
        Gate 07: evidence written (always, every path)
    → Result returned to orchestrator, Run Ledger updated

  If agent bypasses NVG (on-prem pre-classified only):
    → NXS directly (same seven gates, no gates skipped)
    → Run Ledger still records the run (bypass annotated, no NVG entries)
    → Agent must still have active session from governed workspace

ORCHESTRATOR
  → collects all agent results
  → invokes compile step
  ↓
COMPILE ACTOR (OCT-COMPILE)
  → OCT ceiling inherited from highest-class input — hard rule
  → Mode 1 (deterministic render): no model call, stays inside wall
  → Mode 2 (on-prem synthesis): inside wall, no NVG outbound
  → Mode 3 (frontier synthesis): routes through NVG if inputs permit
  → assembles final answer
  ↓
FINAL RESPONSE
  → returns to workspace only — not from raw model, not from sub-agent
  → workspace delivers to user
  → Run Ledger closed
  → Three audit streams cross-linked by run ID: complete forensic record
```

Every path through this loop produces audit records. There is no ungoverned path through
the governed system. A path that bypasses any component other than NVG (§13.9) is a
trust boundary violation.

---

## 32. Target Systems — Scoped Execution

This section is a standalone architecture-law surface preserving the target-system
execution contract as a distinct governed surface.

For actions that reach Gate 06 (ALLOW from Gate 04 or PASS from Gate 05), the execution
grant flows to target systems with:

- **Time-bound scope** — grant expires automatically; no long-lived credential persists
- **Precise resource constraints** — only the systems and operations specified in the
  ExecutionGrantTemplate computed at Gate 04; scope cannot expand beyond delegation ceiling
- **Automatic secret clearing** — grant secret is cleared from vault in a finally block
  after every execution attempt; no long-lived credentials remain in circulation
- **Connector abstraction** — target-system interaction is mediated by a connector that
  implements the connector interface from Layer 2; connectors redeem grants, they do not
  define credential law
- **Violation separation** — NexusSecurityViolation (broad token bypass, expired grant,
  template integrity failure) is caught separately from generic connector errors; security
  violations emit ThreatEvent and map to denied_threat; generic failures map to error

Target systems are the real-world side-effect boundary. The stack's jurisdiction ends at
the connector interface. What happens inside the target system is outside governance scope.
The stack governs the authority to reach the target system — not the target system itself.

---

## 33. Operational Constraints — No On-Prem

This section is a standalone architecture-law surface preserving the explicit operational
constraints for deployments without on-prem model infrastructure.

| Scenario                                       | Behavior                                                  |
|------------------------------------------------|-----------------------------------------------------------|
| OCT-OPEN agent, general data, no on-prem       | Frontier permitted. No constraint.                        |
| OCT-CONFIDENTIAL agent, internal data          | Frontier permitted per routing policy. No constraint.     |
| OCT-SECURE agent, sensitive data, no on-prem   | Hard-denied. Sensitive data cannot reach frontier.        |
| Compile, non-sensitive inputs, no on-prem      | Deterministic render or frontier synthesis per policy.    |
| Compile, sensitive inputs, no on-prem          | Deterministic render only. Frontier hard-denied.          |

No silent weakening. The stack surfaces the constraint. The enterprise decides whether to
deploy on-prem model capability or accept the operational limit.

Enterprises with no on-prem models cannot run OCT-SECURE inference jobs. This is an
explicit operational limit — not a silent fallback, not a configuration override, and not
a policy exception. The hard wall is the product.

---

## 34. Security Model

This section is a standalone architecture-law surface preserving the full security model
as a single anti-drift reference.

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
  Execution Grant → Target System (scoped, time-bound, auto-cleared)
  Evidence Ledger (always — every path)
       |
       ↓
  Orchestrator collects results
       |
       ↓
  Compile Actor (OCT-COMPILE)
  [OCT ceiling inherited from highest-class input — hard rule]
  Mode 1: deterministic (always available, zero risk)
  Mode 2: on-prem synthesis (inside wall)
  Mode 3: frontier synthesis (through NVG if permitted)
       |
       ↓
  Final Response → Workspace → User
  Run Ledger closed
  Three audit streams cross-linked by run ID
```

Trust boundaries enforced at every layer:
- Identity provider sets org-level ceiling; OCT sets runtime ceiling; more restrictive wins
- Workspace is the only authorized entry point — not a courtesy
- Orchestrator is governed — not exempt because it is infrastructure
- NVG enforces the hard wall — sensitive data cannot reach frontier tiers
- NXS enforces action authority — default-deny, seven gates, no gate skipped
- Gate 07 always runs — every action produces evidence regardless of outcome
- Timeout produces DENY — never auto-approval
- Long-lived base secrets never circulate in agents, adapters, or approval payloads
- SEQUENCE_ANOMALY emitted by chain verifier only — no other emission point

---

## 35. Deferred Items

### 35.1 Deferred from This Build — Production Targets (Interface Contracts Locked)

These items have interface contracts locked in this version. They are production targets
for the next build cycle. No partial implementation, no stub, no placeholder code for
any of these items exists in this version.

- **REST Adapter v2**: adapter interface is locked in Layer 4. Implementation next cycle.
- **Webhook Approval Channel (Channel v2)**: approval channel interface is locked in Layer 2.
  Implementation next cycle.

### 35.2 Deferred to Future Blueprint Versions

These items are named as future deliverables. They are not blocked, not scoped, and not
started in this version. No code or interface for any of these items belongs in this build.

- Dashboard UI (Layer 7 — browser-based governance surface)
- Slack Approval Channel (Channel v3)
- PostgreSQL ledger backend (Backend v2)
- S3 ledger backend (Backend v3)
- Multi-node ledger replication
- SOC 2 export formatting
- Production Kubernetes manifests
- Connector marketplace / self-service connector onboarding
- Self-service actor registration portal
- MFA / SSO for approver identity
- Live credential rotation automation
- Okta / Azure AD / AWS IAM connector packages (enterprise-provided by integrator)
- Advanced NVG content classification beyond label-enforcement (ML-assisted labeling
  is off by default; full ML classification pipeline is deferred)
- Multi-party orchestrator (multi-layer orchestration tree)
- Cross-enterprise run ledger federation
- NVG cost management and optimization surfaces

---

## 36. Final Blueprint Statement

Nexus Stack v1.4.12 is a two-checkpoint, seven-layer, TypeScript-strict governed runtime for
the full human → agent → model → action → compile → user loop. Two enforcement checkpoints.
Three audit streams. Every actor governed. Every wall crossing logged. Every action evidence-
recorded. The best umpire is felt, not seen.

One wall enforcement engine (NVG) governs data egress to model tiers. One authority engine
(NXS) governs system actions through seven fixed gates, default-deny. One runtime contract
per engine. One fixed authority model governs delegation, execution-grant minting, and
approval inside NXS. One hard wall — sensitive data cannot reach frontier tiers — enforced
by NVG, not configurable, not subject to policy override.

The workspace is the only authorized entry point. The orchestration plane is enterprise-owned
and stack-governed. The compile step is governed by OCT ceiling inheritance — not an
operator-configured choice for sensitive inputs. Three audit streams cross-linked by run ID
produce a complete forensic record of every governed AI run.

Protocol adapters are additive — MCP is Adapter v1. Connectors are additive — Vault is
the reference. Approval channels are additive — CLI is Channel v1. Model tiers are additive
— registry-governed open strings. Identity providers are swappable — the interface is the
contract. OCT is immutable per run — assigned by operators, not self-declared by actors.
Operating modes are signed infrastructure configuration — not agent-level settings.

Sessions are created exclusively via CLI or management API — never by adapters. principalId
is derived server-side — never trusted from caller input. Root delegation environment must
equal actor environment at mint time — enforcement is explicit and throws. Execution authority
is governed by explicit execution-grant law, produced deterministically as a function of
identity, delegation, policy, and approval state. The evidence ledger is append-only,
hash-chained, sequence-continuous, and signed by construction. Human approval is a signed
legal artifact chain. Timeout produces APPROVAL_TIMEOUT denial — never auto-approval. Gate 07
always runs — every action produces evidence regardless of outcome.

The machine classifies, enforces, routes, mints bounded execution authority, and produces
tamper-evident proof of every action. Human operators remain the final decision authority
on high-risk actions. Compliance decisions remain with humans. The stack provides the
evidence. You provide the judgment.

Blueprint governs purpose, architecture, and boundaries.
Spec governs implementation law.
No spec section may contradict blueprint law. Blueprint wins all conflicts.
Build instructions govern builder-session behavior only. They are not product law.

---

*Blueprint version: v1.4.12*
*Owner: James Huson / Lake Area LLC*
*Date: 2026-04-19*
*Canonical outline: nexus-complete-end-to-end-flow-v4.8.md (LOCKED)*
*Governing spec: nexus-engineering-spec-v1-4-12.md (to be produced after owner approval)*
*Supersedes: nexus-blueprint-v0-3-6.md*
