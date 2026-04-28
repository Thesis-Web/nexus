# AMEND-spec-v2.9.29-NISP-001-A-r4.md

**Source spec:** `nexus-engineering-spec-v1-8-26.md` (live HEAD `b818085`, verified 2026-04-25)
**Target spec version:** **v2.9.29** (proposed under owner's S9-T11 versioning convention)
**Paired blueprint:** `nexus-blueprint-v2-6-16.md` (PROPOSED, S9-T11)
**Amendment scope:** NISP-001.A (model transport layer) + NISP-002 (signed manifest law, 4-domain)
**Session:** S10-T3 build (arch session continuation) — produced by Arch (Claude) for owner + audit re-review
**Status:** PROPOSED — REVISION 4 — incorporates audit S10-T3 ruling on r3 (5 merge blockers + 3 cleanups, all accepted on merit) + owner ratification of HOLE-S10-001 (canonicalize compat re-export path)
**Supersedes:** `AMEND-spec-v2.9.29-NISP-001-A-r3.md` (r3)

---

## 0. Audit context — what changed in r4

r4 corrects every blocker and cleanup audit S10-T3 flagged on r3. None of audit's items were spurious — every catch was real and precise. r4 also closes HOLE-S10-001 per the owner ruling adopted from audit's drafted text at S10-T3.

### 0.1 Audit S10-T3 dispositions → r4 changes

| Blocker / Cleanup | r4 resolution | Fragment(s) touched |
|---|---|---|
| **B1** EndpointManifestEntrySchema missing `adapterConfig` field | r3 said §26.5 schema "unchanged from r1/r2," but the r1/r2 schema did not include `adapterConfig` — under `.strict()`, that schema would reject the new field BEFORE the loader's Step 6.4/6.5 ever ran. r4 emits the schema body explicitly in §32a.2.4 with `adapterConfig: z.record(z.unknown()).optional()` and `.strict()` preserved. | F-09 §32a.2.4 |
| **B2** Factory types referenced but not defined | r3 imported `IdentityProviderFactory`, `ConnectorFactory`, `ApprovalChannelFactory` in the registry interfaces but said those types were "existing or to-be-defined" — not line-buildable. r4 defines the three factory interfaces inline as §12.3.49 / §12.3.50 / §12.3.51 with minimal acceptable shape (typed providerType/connectorType/channelType + create method). | F-04 §12.3.49–.51 |
| **B3** runtime-utils layer wording contradiction | r3 said `packages/runtime-utils/` is "Importable by Layers 3+ implementation packages," but the importer allow-list includes `packages/core` which is Layer 1. r4 replaces with: "Importable only by the approved packages listed below" + the explicit allow-list. The imports-into rule (`@nexus/contracts` + approved Node built-ins + approved external libs only; no implementation packages) is preserved. | F-09 §32a.0 |
| **B4** HOLE-S10-001 owner ratification required | Owner ratification adopted at S10-T3 (per audit-drafted ruling text + owner's "proceed" directive): canonicalize physical implementation moves to `packages/runtime-utils/src/canonicalize.ts`; `packages/core/src/crypto/canonicalize.ts` becomes a thin re-export from runtime-utils; `@nexus/core` export compatibility preserved; existing relative imports unchanged. r4 removes "pending owner ratification" language and marks HOLE-S10-001 CLOSED. | F-09 §32a.0.1, F-13, F-14 |
| **B5** Timeout doesn't cover body read | r3 set `AbortController` timeout around `fetch()` and cleared the timer immediately after fetch resolution — but `fetch()` resolves on headers; `response.arrayBuffer()` could still hang indefinitely. r4 wraps fetch + body read in a single try/finally; `clearTimeout(timer)` runs ONLY in `finally`. AbortError from either fetch or body read maps to `nvg_endpoint_timeout`. New conformance test in §38.10: provider sends headers then stalls body → asserts `nvg_endpoint_timeout`. | F-07 §24.5.4, §24.5.6, §38.10 |
| **C-A** Clean-clone wording: "MUST NOT include legacy bridge" overbroad | Bridge code may exist in repo as a transitional path guarded by `NEXUS_RIA_LEGACY_BRIDGE=1`. Clean clone must not ENGAGE it. r4 corrects the §6.6 prose. | F-02 §6.6 |
| **C-B** Zod imported into `@nexus/contracts` via `configSchema: z.ZodSchema<TConfig>` | r4 adds a structural `AdapterConfigSchema<TConfig>` interface to contracts (no Zod import) that any object exposing `safeParse(input: unknown): { success: true; data } \| { success: false; error: { issues: ... } }` satisfies. Zod's `z.ZodSchema` satisfies this structurally. Vanguard adapter implementations still author their schemas in Zod; contracts has no zod dependency. | F-04 §12.3.40 |
| **C-C** Ollama `num_predict` placement | r3 placed `num_predict` at top level of Ollama body. Per Ollama wire format, `num_predict` lives inside `options.num_predict`. r4 pins it in `options`. The Ollama config schema now exposes `options` (a record) and `keep_alive` only — operators put `num_predict` inside their `options` object. | F-07 §24.5.4, §24.5.6 (Ollama deltas), §38.9 (test update) |

### 0.2 Owner ratification at S10-T3 (closes HOLE-S10-001)

Adopted from audit-drafted text at S10-T3 audit cycle (owner's "proceed" directive on the audit pasteback that included this drafted ruling):

> **Owner ruling: APPROVE HOLE-S10-001.**
>
> canonicalize currently lives in `@nexus/core`, not `@nexus/contracts`. Approved path:
> - move physical implementation to `packages/runtime-utils/src/canonicalize.ts`
> - keep `packages/core/src/crypto/canonicalize.ts` as a thin re-export
> - keep `@nexus/core` export compatibility
> - do not break existing relative imports
> - close HOLE-S10-001

r4 §32a.0.1 prose updated; HOLE-S10-001 marked CLOSED in F-13. F-14 completion criteria refreshed.

### 0.3 What did NOT change in r4

- All r3 architectural decisions: opaque carriage chain, NvgTransportContext DI, four-domain signed manifest law, qualified identifier convention, RIA-as-default-manifest-entry, globalThis.fetch lockdown, transport package boundary import allow-list, fail-closed on all four manifests, same-tier retry law, 9-scenario Step 18, factory registry shared behavior law (§12.3.48), explicit body construction (no `...adapterConfig` spread), forbidden adapterConfig keys list, byte-count response sizing, lower_snake denial code values, NvgNormalizedResponse opaque-carriage extension (D2 closure), F-07 file-path resolution Option A
- Fragment IDs F-01 through F-15
- All blueprint pinning
- The seven new transport denial codes (names and values)
- The four-domain manifest layout
- The RIA bridge three-condition containment

---

## 1. Format

Same pinned-amendment format as r1/r2/r3. Audit re-review request: per-fragment APPROVE / REVISE / REJECT.

---

## 2. Fragment TOC — r4

| # | Target | Action | r4 status |
|---|---|---|---|
| F-01 | header lines 1–12 | UPDATE-PARAGRAPH | unchanged from r3 |
| F-02 | §6.4 + §6.5 + §6.6 | UPDATE-FIELD | revised: §6.6 RIA bridge wording (C-A) |
| F-03 | §12.2 governed constants | UPDATE-FIELD | unchanged from r3 |
| F-04 | §12.3 — INSERT new subsections | INSERT-AFTER | revised: structural `AdapterConfigSchema` interface (C-B) replaces direct Zod import; +3 factory interface definitions §12.3.49–.51 (B2) |
| F-05 | §12.3.x existing types | UPDATE-FIELD | unchanged from r3 |
| F-06 | §27.1 Trail Record | UPDATE-FIELD | unchanged from r1/r2/r3 |
| F-07 | §24.5 + §24.6 | REPLACE | revised: B5 timeout law (single try/finally covering body read) in §24.5.4 + §24.5.6; C-C Ollama num_predict pinned to `options.num_predict` |
| F-08 | INSERT-AFTER §26.4 → new §26.5 | INSERT-AFTER | unchanged from r3 (loader procedure unchanged; the schema shape was the missing piece — that's in §32a.2.4 / F-09) |
| F-09 | INSERT-AFTER §32 → new §32a | INSERT-AFTER | revised: B3 wording fix in §32a.0; B4 HOLE-S10-001 CLOSED in §32a.0.1; B1 EndpointManifestEntrySchema emitted explicitly in §32a.2.4 with adapterConfig field |
| F-10 | §32.1 + §32.3 | UPDATE-FIELD | unchanged from r1/r2/r3 |
| F-11 | §37 — APPEND §37.19/.20/.21 | APPEND | unchanged from r3 |
| F-12 | §38 — APPEND §38.9/.10/.11/.12 | APPEND | revised: +headers-then-body-stall test in §38.10 (B5); +Ollama options.num_predict tests in §38.9 (C-C); +zod-not-in-contracts type test in §38.11 (C-B); +factory type definition tests in §38.11 (B2); +endpoint manifest accepts adapterConfig test in §38.11 (B1) |
| F-13 | §41 Known Holes Log | UPDATE-FIELD | revised: HOLE-S10-001 CLOSED |
| F-14 | §43 Completion Criteria | UPDATE-FIELD | revised: HOLE-S10-001 closure recorded; B1/B2/B3/B5 completion criteria added |
| F-15 | §44 Final Spec Statement | UPDATE-PARAGRAPH | unchanged from r1/r2/r3 |

---

## F-01 — Version bump and changelog header

**r4 status:** unchanged from r3. See r1 for full text. Header bump to v2.9.29 PROPOSED, paired with blueprint v2.6.16, NISP-001.A + NISP-002 incorporated.

---

## F-02 — §6.4 ci:gate + §6.5 push checkpoints + §6.6 clean-clone — r4 revised

**Target:** §6.4 (lines 347–370), §6.5 (lines 372–392), §6.6 (lines 396–402)
**Action:** UPDATE-FIELD on each
**Closes:** ADD-S9-003, audit S10-T3 cleanup C-A
**r4 changes:** §6.6 RIA bridge wording — "MUST NOT include" → "MUST NOT engage"; bridge code may exist as transitional path guarded by `NEXUS_RIA_LEGACY_BRIDGE=1`. §6.4 + §6.5 unchanged from r3.

### F-02a — §6.4 ci:gate contract (unchanged from r3 — emitted here for completeness)

```
Step 17: signed manifest signature gate (all four domain manifests have valid Ed25519
         signatures; in CI environments, RIA legacy bridge engagement is also detected
         and fails the gate per §32a.4 + §37.19)
Step 18: transport adapter conformance gate (runtime wire-through: NvgService → invokeModel
         → callEndpoint → registered ModelTransportAdapter → mocked provider →
         handleInboundResponse → Routing Provenance Trail write; all five §24.5 transport
         invariants asserted; for each registered adapter, NINE conformance scenarios run
         [1 success + 8 invoke-time denial codes: TIMEOUT, UNREACHABLE, AUTH_MISSING,
         AUTH_FAILED, RATE_LIMITED, PROVIDER_ERROR, PARSE_ERROR, SECRET_SOURCE_ERROR];
         dispatcher-level code UNKNOWN_ADAPTER is covered by §38.12 threat test 14, not
         Step 18; same-tier retry law verified — all eligible primary endpoints attempted
         in manifest order before fallbackTier considered)
Step 19: transport package boundary gate (AST-walk packages/vanguard/src/transport/** AND
         packages/runtime-utils/src/** — only allow-listed imports per §37.21; any other
         import = gate failure)

All 19 steps must pass. No step may be skipped. No gate waived without owner approval.
```

### F-02b — §6.5 push checkpoints (unchanged from r3)

```
PUSH-13: After clean-clone assertion verified               → Steps 1-16
PUSH-14: After NISP-001.A transport + NISP-002 manifests    → Steps 1-19 (FULL GATE)
```

### F-02c — §6.6 clean-clone assertion (r4 — RIA bridge wording corrected per audit C-A)

```
A fresh clone must complete: `pnpm install → format:check → lint → typecheck → test →
ci:gate` without inventing missing config files. Every file referenced by a script must
exist in the repo layout. A build that cannot pass ci:gate from a clean clone is not
conformant.

Clean-clone must include all four signed manifest fixtures with valid signatures:
- `config/identity/providers.v1.yaml`     — RIA enabled
- `config/nvg/endpoints.v1.yaml`           — at least one enabled endpoint; auth-bearing
                                             enabled endpoints must use fixture-synthetic
                                             secretRefs (FIXTURE_SYNTHETIC_SECRET prefix
                                             enforced by ci:gate Step 11)
- `config/connectors/connectors.v1.yaml`   — stub connector enabled
- `config/channels/channels.v1.yaml`       — CLI approval channel enabled

Clean-clone must include all three reference transport adapter implementations under
`packages/vanguard/src/transport/adapters/` (Ollama, Anthropic Claude, OpenAI-compatible).
A clone missing any of the above fails ci:gate Step 17 or Step 18.

Clean-clone must include the `packages/runtime-utils/` package with its loadSignedManifest,
signManifest, canonicalize, and qualified-identifier helpers built and exported. A missing
runtime-utils build fails ci:gate Step 17.

Clean-clone MUST NOT engage the legacy RIA constructor-wired bridge (§32a.4). Bridge code
may exist in the repository only as a transitional path guarded by the explicit env flag
`NEXUS_RIA_LEGACY_BRIDGE=1`. ci:gate Step 17 detects bridge engagement in CI environments
and fails with explicit error.
```

### Reasoning (r4)

Audit C-A is correct: the prior wording forbade the bridge from existing in the codebase, but the bridge is a documented transitional path. What must not happen in clean-clone is bridge ENGAGEMENT — bridge code presence is fine as long as it's behind the env flag and the ci:gate detection of engagement is in place. r4 corrects.

---

## F-03 — §12.2 transport denial codes (UPDATE-FIELD) — unchanged from r3

(Verbatim from r3 — seven new transport denial codes, lower_snake values, AUTH_MISSING comment scoped to invoke-time only, mapping table annotated with originating layer per code.)

<!-- chunk C1 end -->

---

## F-04 — §12.3 new transport types (INSERT) — r4 revised

**Target:** INSERT new subsections at end of §12.3 (after §12.3.36 Error Classes, before §12.4)
**Action:** INSERT-AFTER §12.3.36
**Closes:** DIFF-S9-001, HOLE-S9-001, HOLE-S9-003, HOLE-S9-004, B1 (configSchema field), B2 (priorAttempts), B3 (factory registry interfaces), audit S10-T3 B2 (factory types defined inline), audit S10-T3 C-B (zod-not-in-contracts via structural interface)
**r4 changes:** §12.3.40 ModelTransportAdapter — `configSchema` field type changed from `z.ZodSchema<TConfig>` to a new structural `AdapterConfigSchema<TConfig>` interface defined in this same fragment. Three factory interfaces (`IdentityProviderFactory`, `ConnectorFactory`, `ApprovalChannelFactory`) defined inline as §12.3.49 / §12.3.50 / §12.3.51 — registries in §12.3.45–.47 are now line-buildable.

### After — insert new §12.3.37 through §12.3.51

#### 12.3.37 ModelTransportAdapterId

Open governed string. One adapter per provider wire-format family.

```typescript
// File: packages/contracts/src/interfaces/transport-adapter.ts
import type { NonEmpty } from '../types/non-empty.js';

export type ModelTransportAdapterId = NonEmpty;
```

Reserved IDs (registered by reference adapters at bootstrap):
- `'ollama-chat-v1'`         — Ollama POST `/api/chat`
- `'anthropic-messages-v1'`  — Anthropic POST `/v1/messages`
- `'openai-chat-v1'`         — OpenAI / OpenAI-compatible POST `/v1/chat/completions`

#### 12.3.38 ModelEndpointAuth

(Verbatim from r3 — discriminated union by `kind`; secretRef/headerName/prefix presence rules; `.strict()` schema enforcement.)

#### 12.3.39 SecretSource

(Verbatim from r3 — startup `canResolve` vs invoke-time `resolve`; null-vs-throw semantics mapped to AUTH_MISSING vs SECRET_SOURCE_ERROR; AUTH_MISSING is invoke-time only.)

#### 12.3.40 AdapterConfigSchema + ModelTransportAdapter (r4 — structural validation interface per audit C-B; configSchema field per audit B1)

`AdapterConfigSchema<TConfig>` is the structural validation interface that adapters use to declare their per-adapter config schema. Any object that exposes a `safeParse(input: unknown)` method matching this signature satisfies it — including (but not requiring) Zod's `z.ZodSchema<TConfig>`. **`@nexus/contracts` does NOT import `zod`.** Adapter implementations in vanguard are free to author their schemas in Zod (recommended); other validation libraries with the same shape also work.

```typescript
// File: packages/contracts/src/interfaces/adapter-config-schema.ts
/**
 * Structural validation interface for per-adapter configuration schemas
 * (§12.3.40 ModelTransportAdapter.configSchema).
 *
 * Designed to be satisfied STRUCTURALLY by Zod's z.ZodSchema<TConfig> without
 * requiring contracts to import zod. Vanguard adapter implementations typically
 * author their schemas in Zod; other validation libraries with the same shape
 * also work.
 *
 * The endpoint manifest loader (§26.5 Step 6.5) calls safeParse(entry.adapterConfig)
 * after the forbidden-key check (§26.5 Step 6.4). On success, the loader has a
 * typed config; on failure, the loader throws a fail-closed startup error including
 * the issue path and message.
 */
export interface AdapterConfigSchema<TConfig> {
  safeParse(input: unknown):
    | { readonly success: true;  readonly data: TConfig }
    | { readonly success: false; readonly error: { readonly issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[] } };
}
```

```typescript
// File: packages/contracts/src/interfaces/transport-adapter.ts (continued)
import type { NonEmpty } from '../types/non-empty.js';
import type { ModelEndpoint } from './model-endpoint.js';
import type { ModelEndpointResponse } from './model-endpoint-response.js';
import type { NvgOutboundRequest } from './nvg-outbound-request.js';
import type { SecretSource } from './secret-source.js';
import type { AdapterConfigSchema } from './adapter-config-schema.js';
// ModelTransportAdapterId defined above in this same file.

export interface ModelTransportAdapter<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  readonly adapterId:      ModelTransportAdapterId;
  readonly adapterVersion: NonEmpty;

  /**
   * Per-adapter configuration schema (audit B1).
   *
   * The endpoint manifest loader (§26.5 Step 6.5) validates each enabled endpoint's
   * `endpoint.adapterConfig` against the registered adapter's `configSchema` BEFORE
   * Step 7 (secretRef resolvability check). Validation is fail-closed at startup —
   * an adapter that ships an invalid adapterConfig in its manifest entry halts boot
   * with a buildable operator-readable error.
   *
   * The schema MUST reject unknown fields (e.g., Zod `.strict()`). The manifest
   * loader additionally enforces a globally forbidden adapterConfig key list BEFORE
   * invoking this schema (see §26.5 Step 6.4) — keys controlled at the endpoint or
   * framework level (stream, streaming, model, messages, auth, url, adapterId,
   * endpointId, tier, enabled, healthy) cannot appear in any adapter's
   * adapterConfig.
   *
   * The type is the structural AdapterConfigSchema<TConfig> interface (§12.3.40,
   * audit C-B). Zod's z.ZodSchema<TConfig> satisfies this structurally.
   * @nexus/contracts does NOT import zod; adapter authors choose their validator.
   */
  readonly configSchema: AdapterConfigSchema<TConfig>;

  /**
   * Mechanical provider dispatch. Adapter:
   *   1. Resolves auth via `secretSource.resolve(...)` if auth.kind !== 'none'
   *      - null return → NVG_TRANSPORT_AUTH_MISSING
   *      - throw       → NVG_TRANSPORT_SECRET_SOURCE_ERROR
   *   2. Constructs provider-required request body and headers (mechanical wire-format only)
   *      - May read `endpoint.adapterConfig` (already schema-validated at manifest load)
   *        for adapter-specific tuning per §24.5.5
   *      - MUST construct body fields EXPLICITLY (no `...adapterConfig` spread); each
   *        field is pulled from the validated adapterConfig by name
   *   3. Issues HTTP POST via globalThis.fetch with timeout = endpoint.timeoutMs ?? 30_000
   *      - Timeout MUST cover BOTH fetch resolution AND body consumption (§24.5.4 r4).
   *   4. Maps provider HTTP status → governed denial code per §12.2 mapping table
   *   5. On success: returns ModelEndpointResponse with success: true, latencyMs, responseSize
   *      (BYTE COUNT, not character count), opaqueProviderResponse (parsed body)
   *   6. On failure: returns ModelEndpointResponse with success: false, denialCode, reason, latencyMs
   *
   * Adapter MUST NOT inspect, classify, redact, summarize, truncate, cache, replay,
   * or mutate semantic payload content. Envelope/status metadata inspection is permitted
   * only for mapping provider errors to governed denial codes.
   *
   * Adapter MUST request non-streaming responses.
   */
  invoke(
    endpoint:     ModelEndpoint,
    request:      NvgOutboundRequest,
    secretSource: SecretSource
  ): Promise<ModelEndpointResponse>;
}
```

#### 12.3.41 ModelTransportAdapterRegistry

(Verbatim from r3 — register/get/list; duplicate adapterId throws; not hot-reloadable per §12.3.48 behavior law.)

#### 12.3.42 NvgTransportContext

(Verbatim from r3 — DIFF-S9-001 grouped DI: registry + secretSource.)

#### 12.3.43 SignedManifest (NISP-002 generic envelope)

(Verbatim from r3 — manifestVersion / issuer / issuedAt / signature / body envelope; type lives in contracts; runtime loader in `packages/runtime-utils/`.)

#### 12.3.44 InvocationAttempt

(Verbatim from r3 — failed attempt record for trail-visible same-tier retry and cross-tier fallback; endpointUsed / denialCode / reason / responseSize / latencyMs / attemptedAt.)

#### 12.3.45 IdentityProviderFactoryRegistry

(Verbatim from r3 — register / get / list with `IdentityProviderFactory` from §12.3.49.)

#### 12.3.46 ConnectorFactoryRegistry

(Verbatim from r3 — register / get / list with `ConnectorFactory` from §12.3.50.)

#### 12.3.47 ApprovalChannelFactoryRegistry

(Verbatim from r3 — register / get / list with `ApprovalChannelFactory` from §12.3.51.)

#### 12.3.48 Shared factory-registry behavior law

(Verbatim from r3 — duplicate registration throws; unknown manifest type fails closed at loader; bootstrap registration before manifest load; not hot-reloadable.)

#### 12.3.49 IdentityProviderFactory (NEW in r4 — audit B2)

Minimal acceptable shape so the four manifest loaders can resolve factories at bootstrap. Domain-specific extension lives in `packages/identity-ref/`.

```typescript
// File: packages/contracts/src/interfaces/identity-provider-factory.ts
import type { NonEmpty } from '../types/non-empty.js';
import type { IdentityProviderInterface } from './identity-provider-interface.js';

export interface IdentityProviderFactory {
  /**
   * Discriminator string registered with IdentityProviderFactoryRegistry.
   * Manifest entries reference this string in `providerType`.
   */
  readonly providerType: NonEmpty;

  /**
   * Construct an IdentityProviderInterface from a manifest entry's `configuration`
   * object. The factory is responsible for validating its own configuration shape
   * (a per-factory Zod or structural schema is recommended) and throwing a
   * fail-closed startup error if the configuration is invalid.
   *
   * The returned provider is owned by the manifest loader's caller (typically the
   * identity bootstrap step) for the lifetime of the process.
   */
  create(configuration: Record<string, unknown>): Promise<IdentityProviderInterface>;
}
```

`IdentityProviderInterface` is the existing identity-provider contract defined in `packages/contracts/src/interfaces/identity-provider-interface.ts` (per spec §32 RIA + identity-ref domain). It is referenced here by relative path; this amendment does NOT modify its definition.

#### 12.3.50 ConnectorFactory (NEW in r4 — audit B2)

```typescript
// File: packages/contracts/src/interfaces/connector-factory.ts
import type { NonEmpty } from '../types/non-empty.js';
import type { Connector } from './connector.js';

export interface ConnectorFactory {
  /**
   * Discriminator string registered with ConnectorFactoryRegistry.
   * Manifest entries reference this string in `connectorType`.
   */
  readonly connectorType: NonEmpty;

  /**
   * Construct a Connector from a manifest entry's `configuration` object.
   * The factory is responsible for validating its own configuration shape and
   * throwing a fail-closed startup error if invalid.
   *
   * Connector lifetime ownership follows the same pattern as IdentityProviderFactory.
   */
  create(configuration: Record<string, unknown>): Promise<Connector>;
}
```

`Connector` is the existing connector contract defined in `packages/contracts/src/interfaces/connector.ts` (per blueprint §35.1 + connectors domain). Referenced here by relative path; this amendment does NOT modify its definition.

#### 12.3.51 ApprovalChannelFactory (NEW in r4 — audit B2)

```typescript
// File: packages/contracts/src/interfaces/approval-channel-factory.ts
import type { NonEmpty } from '../types/non-empty.js';
import type { ApprovalChannel } from './approval-channel.js';

export interface ApprovalChannelFactory {
  /**
   * Discriminator string registered with ApprovalChannelFactoryRegistry.
   * Manifest entries reference this string in `channelType`.
   */
  readonly channelType: NonEmpty;

  /**
   * Construct an ApprovalChannel from a manifest entry's `configuration` object.
   * The factory is responsible for validating its own configuration shape and
   * throwing a fail-closed startup error if invalid.
   */
  create(configuration: Record<string, unknown>): Promise<ApprovalChannel>;
}
```

`ApprovalChannel` is the existing approval-channel contract defined in `packages/contracts/src/interfaces/approval-channel.ts` (per blueprint §36.1/§36.2 + core/approval domain). Referenced here by relative path; this amendment does NOT modify its definition.

### Reasoning (r4)

**Audit C-B (zod-not-in-contracts):** the structural `AdapterConfigSchema<TConfig>` interface preserves the original B1 intent (uniform per-adapter validation contract; loader has no per-adapter logic) without dragging zod into Layer 2 contracts. Zod's `z.ZodSchema<TConfig>` satisfies the structural interface — every property and call signature lines up — so existing Zod-authored adapter schemas work unchanged. Adapter authors who prefer other validators (or hand-rolled `safeParse`) are also accommodated.

**Audit B2 (factory types defined inline):** the three factory interfaces are genuinely small (three fields each) and the four manifest loaders depend on them at bootstrap time, not after — so deferring their definition to "later domain modules" was incorrect. r4 defines them in the same amendment that introduces the registries. The referenced product-domain types (`IdentityProviderInterface`, `Connector`, `ApprovalChannel`) are NOT introduced or modified by this amendment — they exist in the current repo state and are imported by relative path; this amendment only adds the factory wrappers around them.

<!-- chunk C2 end -->

---

## F-05 — §12.3 existing types extended (UPDATE-FIELD) — unchanged from r3

(Verbatim from r3 — ModelEndpoint adds `adapterConfig?: Record<string, unknown>`; ModelEndpointResponse extension HOLE-S9-004; NvgInvocationResult adds `priorAttempts?`; NvgNormalizedResponse extended with `opaqueModelOutput?` and `providerModelNameReturned?` per drift D2; normalizeInboundResponse extension per drift D2.)

---

## F-06 — §27.1 RoutingProvenanceTrailEntry — unchanged from r1/r2/r3

(Verbatim from r1. Trail entry extended with endpointId / adapterId / modelName / providerModelNameReturned at event time. Trail content prohibition unchanged.)

<!-- chunk C3 end -->

---

## F-07 — §24.5 + §24.6 transport dispatch + opaque inbound (REPLACE) — r4 revised

**Target:** §24.5 (lines 4633–4744) and §24.6 (lines 4746–4782)
**Action:** REPLACE both subsections
**Closes:** HOLE-S9-002, HOLE-S9-004, DIFF-S9-001, ADD-S9-001, B1 (explicit body construction), B2 (fallback law), B4 (same-tier retry), C1 (byte count), C2 (SECRET_SOURCE_ERROR), C4 (complete imports), D2 (normalizer call pattern), audit S10-T3 B5 (timeout covers body read), audit S10-T3 C-C (Ollama num_predict pinned to options.num_predict)
**r4 changes vs r3:** §24.5.4 Ollama exemplar — single `try`/`finally` around fetch + body read; `clearTimeout` in `finally` only; AbortError from either `fetch()` or `arrayBuffer()` maps to `nvg_endpoint_timeout`. §24.5.4 Ollama config schema — `num_predict` removed from top level; operators specify it inside `options.num_predict`. §24.5.6 Anthropic + OpenAI skeletons — same single try/finally timeout pattern documented. §24.5.1, §24.5.2, §24.5.3, §24.5.5, §24.6 unchanged from r3.

### After — full replacement of §24.5 and §24.6

```
### 24.5 Outbound: Step 5 — Model Invocation and Health Monitoring

Blueprint §13.6.

#### 24.5.1 Five Governed Transport Invariants — unchanged from r1/r2/r3

(verbatim from r1 — five invariants on transport adapter purity)

#### 24.5.2 callEndpoint dispatcher — unchanged from r3

(verbatim from r3 — registry.get + adapter.invoke; UNKNOWN_ADAPTER mapping; five invariants apply)

#### 24.5.3 invokeModel — same-tier retry + fallback law — unchanged from r3

(verbatim from r3 — iterates ALL healthy primary endpoints in manifest order before
fallbackTier eligibility; FALLBACK_TRIGGERING_CODES set [TIMEOUT, UNREACHABLE, RATE_LIMITED,
PROVIDER_ERROR]; tryFallback constraint check + single-shot fallback endpoint;
priorAttempts captures every same-tier and cross-tier failed attempt)
```

#### 24.5.4 Reference Adapter — Ollama exemplar (r4: B5 timeout-covers-body-read + C-C options.num_predict pinned)

File: `packages/vanguard/src/transport/adapters/ollama-chat-v1.ts`

```typescript
import { z } from 'zod';
import {
  DENIAL_CODE,
  type ModelEndpoint,
  type ModelEndpointResponse,
  type ModelTransportAdapter,
  type NvgOutboundRequest,
  type SecretSource,
  type NonEmpty,
} from '@nexus/contracts';

const TIMEOUT_DEFAULT_MS = 30_000;

// Per-adapter config schema (§12.3.40 configSchema; audit B1).
// Validated at MANIFEST LOAD time by the endpoint manifest loader (§26.5 Step 6.5).
// `.strict()` rejects unknown fields. Forbidden keys (stream, model, etc.) rejected by
// the loader earlier in §26.5 Step 6.4 BEFORE this schema is invoked.
//
// r4 (audit C-C): num_predict is NOT a top-level field — Ollama API places it inside
// `options.num_predict`. Operators set it via adapterConfig.options = { num_predict: <int>, ... }.
export const OllamaAdapterConfigSchema = z.object({
  options:    z.record(z.unknown()).optional(),       // Ollama options bag (num_predict, temperature, etc.)
  keep_alive: z.union([z.string(), z.number()]).optional(),
}).strict();

export type OllamaAdapterConfig = z.infer<typeof OllamaAdapterConfigSchema>;

export class OllamaChatV1Adapter implements ModelTransportAdapter<OllamaAdapterConfig> {
  readonly adapterId      = 'ollama-chat-v1';
  readonly adapterVersion = '1.0.0';
  readonly configSchema   = OllamaAdapterConfigSchema;

  async invoke(
    endpoint:     ModelEndpoint,
    request:      NvgOutboundRequest,
    secretSource: SecretSource
  ): Promise<ModelEndpointResponse> {
    const startMs   = Date.now();
    const timeoutMs = endpoint.timeoutMs ?? TIMEOUT_DEFAULT_MS;

    // 1. Auth resolution
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (endpoint.auth.kind !== 'none') {
      let secret: string | null;
      try {
        secret = await secretSource.resolve(endpoint.auth.secretRef);
      } catch (err: unknown) {
        return {
          success:    false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_SECRET_SOURCE_ERROR,
          reason:     err instanceof Error ? err.message : 'secret source threw',
          latencyMs:  Date.now() - startMs,
        };
      }
      if (secret === null) {
        return {
          success:    false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_AUTH_MISSING,
          reason:     `secret ${endpoint.auth.secretRef} not resolvable`,
          latencyMs:  Date.now() - startMs,
        };
      }
      headers[endpoint.auth.headerName] = (endpoint.auth.prefix ?? '') + secret;
    }

    // 2. EXPLICIT body construction (audit B1). adapterConfig has been schema-validated
    //    at manifest load by the loader (§26.5 Step 6.5) using this adapter's
    //    configSchema. Forbidden keys (stream, model, messages, etc.) were already
    //    rejected by the loader's forbidden-key check (§26.5 Step 6.4). We pull
    //    individual validated fields by name — NEVER spread adapterConfig.
    //
    //    r4 (audit C-C): num_predict lives inside options.num_predict per Ollama API.
    //    Operators set adapterConfig.options = { num_predict: 2048, ... }.
    const cfg = (endpoint.adapterConfig ?? {}) as OllamaAdapterConfig;
    const body: Record<string, unknown> = {
      model:    endpoint.modelName,           // from endpoint (NOT operator-overridable)
      messages: request.payload,              // from request (NOT operator-overridable)
      stream:   false,                        // NISP-001.A streaming forbidden — HARDCODED
    };
    if (cfg.options    !== undefined) body.options    = cfg.options;
    if (cfg.keep_alive !== undefined) body.keep_alive = cfg.keep_alive;

    // 3. HTTP dispatch via globalThis.fetch — r4 (audit B5): timeout MUST cover BOTH
    //    fetch resolution AND response body consumption. fetch() resolves on headers;
    //    body reading via response.arrayBuffer() can still hang. Single try/finally
    //    around BOTH operations; clearTimeout runs ONLY in finally.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;
      try {
        response = await globalThis.fetch(endpoint.url, {
          method:  'POST',
          headers,
          body:    JSON.stringify(body),
          signal:  controller.signal,
        });
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        return {
          success:    false,
          denialCode: isTimeout
            ? DENIAL_CODE.NVG_ENDPOINT_TIMEOUT
            : DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
          reason:     err instanceof Error ? err.message : 'network failure',
          latencyMs:  Date.now() - startMs,
        };
      }

      // 4. Status → denial code (§12.2 mapping table)
      if (response.status === 401 || response.status === 403) {
        return {
          success:    false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_AUTH_FAILED,
          reason:     `provider ${response.status}`,
          latencyMs:  Date.now() - startMs,
        };
      }
      if (response.status === 429) {
        return {
          success:    false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_RATE_LIMITED,
          reason:     'provider rate limit',
          latencyMs:  Date.now() - startMs,
        };
      }
      if (response.status >= 500 || !response.ok) {
        return {
          success:    false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_PROVIDER_ERROR,
          reason:     `provider ${response.status}`,
          latencyMs:  Date.now() - startMs,
        };
      }

      // 5. Body read + size measurement (BYTE COUNT per audit C1).
      //    r4 (audit B5): arrayBuffer() can throw AbortError if the body stalls past
      //    the same controller.signal — that maps to nvg_endpoint_timeout, identical
      //    to a fetch-level timeout. Any other throw maps to nvg_endpoint_unreachable.
      let responseBuffer: ArrayBuffer;
      try {
        responseBuffer = await response.arrayBuffer();
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        return {
          success:    false,
          denialCode: isTimeout
            ? DENIAL_CODE.NVG_ENDPOINT_TIMEOUT
            : DENIAL_CODE.NVG_ENDPOINT_UNREACHABLE,
          reason:     err instanceof Error ? err.message : 'body read failure',
          latencyMs:  Date.now() - startMs,
        };
      }
      const responseSize = responseBuffer.byteLength;

      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(responseBuffer));
      } catch {
        return {
          success:    false,
          denialCode: DENIAL_CODE.NVG_TRANSPORT_PARSE_ERROR,
          reason:     'response body not valid JSON',
          latencyMs:  Date.now() - startMs,
          responseSize,
        };
      }

      // 6. Provider-returned model identifier (best-effort extraction)
      const providerModelNameReturned: string | undefined =
        typeof parsed === 'object' && parsed !== null && 'model' in parsed
          ? typeof (parsed as { model: unknown }).model === 'string' && (parsed as { model: string }).model.length > 0
            ? (parsed as { model: string }).model
            : undefined
          : undefined;

      return {
        success:                    true,
        responseSize,
        latencyMs:                  Date.now() - startMs,
        opaqueProviderResponse:     parsed,                        // OPAQUE — never inspected downstream by NVG
        providerModelNameReturned:  providerModelNameReturned as NonEmpty | undefined,
      };
    } finally {
      // r4 (audit B5): clear timer ONLY here, after fetch + body read have either
      // completed OR returned a denial response. Earlier clearTimeout placement
      // (r3) left arrayBuffer() unprotected against body-stall.
      clearTimeout(timer);
    }
  }
}
```

```
#### 24.5.5 Adapter Config Defaults — unchanged from r3

(verbatim from r3 — Ollama no required defaults; Anthropic max_tokens=4096 required;
OpenAI temperature/max_tokens optional. Note: Ollama operators set num_predict via
adapterConfig.options.num_predict per audit C-C; the defaults table is unchanged
because Ollama has no required default — model-shipped defaults apply.)
```

#### 24.5.6 Anthropic and OpenAI Reference Adapter Skeletons (r4: B5 timeout-covers-body-read deltas)

Both adapters follow the §24.5.4 Ollama skeleton with the same single try/finally timeout pattern (audit B5). All three adapters now share IDENTICAL timeout law: AbortController signal covers fetch + body read; clearTimeout runs only in `finally`; AbortError from either operation maps to `nvg_endpoint_timeout`. Per-provider deltas:

**`anthropic-messages-v1.ts`:**
- Required headers: `x-api-key: <secret>` (auth.headerName = `'x-api-key'`, no prefix), `anthropic-version: 2023-06-01`, `Content-Type: application/json`
- `AnthropicAdapterConfigSchema = z.object({ max_tokens: z.number().int().positive().optional(), system: z.string().min(1).optional(), top_p: z.number().min(0).max(1).optional(), top_k: z.number().int().nonnegative().optional(), temperature: z.number().min(0).max(2).optional() }).strict()`
- Body construction (EXPLICIT, no spread):
  ```typescript
  const body: Record<string, unknown> = {
    model:      endpoint.modelName,
    messages:   request.payload,
    stream:     false,
    max_tokens: cfg.max_tokens ?? 4096,        // §24.5.5 default
  };
  if (cfg.system      !== undefined) body.system      = cfg.system;
  if (cfg.top_p       !== undefined) body.top_p       = cfg.top_p;
  if (cfg.top_k       !== undefined) body.top_k       = cfg.top_k;
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
  ```
- Response parse: `{ id, model, role, content, stop_reason, usage }` — `model` field is provider-returned identifier
- Timeout law (audit B5): same single try/finally as Ollama §24.5.4

**`openai-chat-v1.ts`:**
- Required headers: `Authorization: Bearer <secret>` (auth.headerName = `'Authorization'`, prefix = `'Bearer '`), `Content-Type: application/json`
- `OpenAiAdapterConfigSchema = z.object({ temperature: z.number().min(0).max(2).optional(), max_tokens: z.number().int().positive().optional(), top_p: z.number().min(0).max(1).optional(), frequency_penalty: z.number().min(-2).max(2).optional(), presence_penalty: z.number().min(-2).max(2).optional(), stop: z.union([z.string(), z.array(z.string())]).optional() }).strict()`
- Body construction (EXPLICIT, no spread):
  ```typescript
  const body: Record<string, unknown> = {
    model:    endpoint.modelName,
    messages: request.payload,
    stream:   false,
  };
  if (cfg.temperature       !== undefined) body.temperature       = cfg.temperature;
  if (cfg.max_tokens        !== undefined) body.max_tokens        = cfg.max_tokens;
  if (cfg.top_p             !== undefined) body.top_p             = cfg.top_p;
  if (cfg.frequency_penalty !== undefined) body.frequency_penalty = cfg.frequency_penalty;
  if (cfg.presence_penalty  !== undefined) body.presence_penalty  = cfg.presence_penalty;
  if (cfg.stop              !== undefined) body.stop              = cfg.stop;
  ```
- Response parse: `{ id, model, choices, usage }` — `model` field is provider-returned identifier
- Timeout law (audit B5): same single try/finally as Ollama §24.5.4

All three adapters share: `globalThis.fetch` HTTP, identical status-code-to-denial-code mapping, identical secret-source-error vs auth-missing handling, identical byte-count response sizing, identical opaque-carriage of parsed body, identical EXPLICIT body construction (no `...adapterConfig` spread anywhere), identical timeout-covers-body-read law (audit B5 — single try/finally; clearTimeout in finally; AbortError from fetch OR arrayBuffer maps to TIMEOUT).

```
### 24.6 Inbound: Step 6 — Return Path Logging + Opaque Carriage — unchanged from r3

(verbatim from r3 — handleInboundResponse iterates priorAttempts and writes one trail
entry per attempt before final-outcome entry; calls normalizeInboundResponse for
response shape; sibling-file Option A for response-logger.ts file layout)
```

### Reasoning (r4)

**Audit B5 (timeout covers body read):** the prior `clearTimeout` placement immediately after fetch resolution left `response.arrayBuffer()` unprotected. In Node fetch (and the WHATWG fetch standard), `fetch()` resolves once headers arrive; the body is consumed lazily. A misbehaving provider that sends headers and stalls the body would hang for the full Node default keep-alive (often minutes) instead of the configured `endpoint.timeoutMs`. r4 wraps fetch + body read in a single try/finally with the same `AbortController.signal` covering both; `clearTimeout` runs only in `finally`. `AbortError` from `arrayBuffer()` maps to `NVG_ENDPOINT_TIMEOUT` identically to a fetch-level timeout. New conformance test in §38.10 verifies the headers-then-stall scenario.

**Audit C-C (Ollama num_predict):** Ollama's `/api/chat` request body places sampling parameters inside an `options` object, not at top level. Top-level `num_predict` would be silently ignored by Ollama. r4 removes `num_predict` from the top-level Ollama config schema; operators specify it via `adapterConfig.options.num_predict`. This is a wire-format precision fix, not a governance change.

<!-- chunk C4 end -->

---

## F-08 — §26.5 Endpoint Manifest Loader Contract — unchanged from r3

(Verbatim from r3 — Steps 6.1–6.5 with FORBIDDEN_ADAPTER_CONFIG_KEYS list + per-adapter `configSchema.safeParse` validation; Step 7 secretSource throw vs canResolve-false; Step 8 ModelEndpoint construction; Step 9 at-least-one-enabled invariant.)

**r4 note:** The schema definition that the loader parses against (`EndpointManifestEntrySchema` / `EndpointManifestBodySchema`) was r3's missing-piece per audit B1 — it was referenced but never emitted explicitly. r4 emits the schema body in F-09 §32a.2.4 with `adapterConfig: z.record(z.unknown()).optional()` added. The loader procedure itself does not change.

---

## F-09 — §32a Signed Manifest Law — r4 substantially revised

**Target:** INSERT-AFTER §32 → new §32a
**Action:** INSERT-AFTER
**Closes:** NISP-002, B2 (runtime-utils layer law definitive), B5 (Step 18/threat split — covered in F-11/F-12), Buffer cleanup (F-09), audit S10-T3 B3 (wording contradiction fixed), audit S10-T3 B4 (HOLE-S10-001 closed), audit S10-T3 B1 (EndpointManifestEntrySchema emitted with adapterConfig)
**r4 changes vs r3:** §32a.0 importer-allow-list wording corrected per audit B3 (no more "Layer 3+" framing — explicit allow-list only); §32a.0.1 HOLE-S10-001 marked CLOSED per owner ratification S10-T3; §32a.2.4 emits the EndpointManifestEntrySchema explicitly with `adapterConfig` field per audit B1.

### 32a.0 Package: `packages/runtime-utils/` (RATIFIED at S10-T1)

This amendment introduces a new package: **`packages/runtime-utils/`**.

**Status:** RATIFIED at owner ruling S10-T1 (2026-04-25). Definitive layer law — no pending-ratification carve-outs. Renaming the package later (e.g. to `manifest-runtime`) is mechanical and not a barrier to canonicalization.

**Importer allow-list (locked — r4 corrects r3 wording per audit B3):** `packages/runtime-utils/` is **importable only by the approved packages listed below**. There is no general "Layer N+" rule; the importer set is closed and explicit:

- `packages/core`
- `packages/vanguard`
- `packages/connectors`
- `packages/identity-ref`
- `packages/interfaces/*`
- `scripts/*`

No other package may import from `@nexus/runtime-utils`.

**Imports-into allow-list (locked):** `@nexus/runtime-utils` itself may import only:
- `@nexus/contracts`
- approved Node 20+ built-ins (per §37.21): `node:crypto`, `node:fs`, `node:fs/promises`, `node:path`, `node:url`, `node:buffer`, `node:stream`, `node:timers`, `node:util`
- approved external libraries: `js-yaml`, `zod`, `@noble/ed25519`, `@noble/hashes`

**Prohibited:** `@nexus/runtime-utils` MUST NOT import from any implementation package (`@nexus/core`, `@nexus/vanguard`, `@nexus/connectors`, `@nexus/identity-ref`, `@nexus/interfaces/*`). This prohibition is enforced by ci:gate Step 19 (§37.21).

**Surface boundary:** runtime-utils carries **only shared signed-manifest runtime helpers and pure utilities**. It is NOT a new product surface. It is NOT a governance engine. It does NOT contain domain business logic. The four manifest loaders' domain-specific validation (uniqueness, cross-references, secret resolvability, factory registry checks) lives in each domain's own package — runtime-utils provides only the generic shape (file read + YAML parse + Ed25519 signature verify + schema validate).

**Files in this package:**
- `packages/runtime-utils/src/manifest/load-signed-manifest.ts` — generic loader
- `packages/runtime-utils/src/manifest/sign-manifest.ts` — generic signing helper
- `packages/runtime-utils/src/canonicalize.ts` — physical implementation (see §32a.0.1 below)
- `packages/runtime-utils/src/qualified-identifier.ts` — qualified identifier helpers per §32a.3
- `packages/runtime-utils/src/index.ts` — barrel export

**Drift rule:** ci:gate Step 19 (transport package boundary, §37.21) AST-walks BOTH `packages/vanguard/src/transport/**` AND `packages/runtime-utils/src/**` against this allow-list, with the additional implementation-package prohibition for runtime-utils.

#### 32a.0.1 canonicalize compat-rule — HOLE-S10-001 CLOSED (owner ratification S10-T3)

**Sibling-code reality (S10-T2 grep):** `canonicalize` is currently exported from `@nexus/core`, NOT `@nexus/contracts`. Its physical location is `packages/core/src/crypto/canonicalize.ts`. It has 20+ relative-path callers within `packages/core/` (gates, policy, identity, ledger, approval, etc.) and one external import via `@nexus/core` from CLI (`packages/interfaces/cli/src/commands/init.ts`).

**Owner ruling at S10-T3 (closes HOLE-S10-001):**

> APPROVE HOLE-S10-001. canonicalize currently lives in `@nexus/core`, not `@nexus/contracts`.
> Approved path:
> - move physical implementation to `packages/runtime-utils/src/canonicalize.ts`
> - keep `packages/core/src/crypto/canonicalize.ts` as a thin re-export
> - keep `@nexus/core` export compatibility
> - do not break existing relative imports
> - close HOLE-S10-001

**Canonical implementation per ratified path:**

1. Physical implementation at `packages/runtime-utils/src/canonicalize.ts`. Implementation is verbatim what currently lives in `packages/core/src/crypto/canonicalize.ts` — pure JSON canonical-string production, no dependencies beyond standard JS.

2. `packages/core/src/crypto/canonicalize.ts` becomes a thin re-export:
   ```typescript
   // packages/core/src/crypto/canonicalize.ts
   export { canonicalize } from '@nexus/runtime-utils';
   ```

3. `packages/core/src/index.ts` keeps its existing `export * from './crypto/canonicalize.js';` line — no change required there.

4. All 20+ relative-path callers within `packages/core/` (`import { canonicalize } from '../crypto/canonicalize.js'`, `'../../crypto/canonicalize.js'`, etc.) continue to work without modification.

5. The CLI's `import { canonicalize } from '@nexus/core'` continues to work.

This is legal under the ratified importer allow-list (`packages/core` is on the list). It is the minimum-displacement path: zero caller-file modifications, single source of truth in runtime-utils, full backward compatibility. **HOLE-S10-001 is CLOSED.**

### 32a.1 Generic Loader (lives in `packages/runtime-utils/`, NOT contracts)

(Verbatim from r3 — `loadSignedManifest<TBody>(manifestPath, bodySchema, controlPlanePub)`; envelope-shape check; Ed25519 verify over canonicalize(body); schema validation; explicit `import { Buffer } from 'node:buffer';` per F-09 cleanup.)

### 32a.2 Four-Domain Schemas (r4 — endpoint manifest schema emitted explicitly per audit B1)

#### 32a.2.1 Identity Provider Manifest

(Verbatim from r3 — `IdentityProviderManifestEntrySchema` with open governed `providerType` string; `IdentityProviderManifestBodySchema`; loader-side factory registry validation per §12.3.48.)

#### 32a.2.2 Connector Manifest

(Verbatim from r3 — `ConnectorManifestEntrySchema` with open governed `connectorType` string; starter `ConnectorFactoryRegistry` registers `'stub'`, `'vault'`.)

#### 32a.2.3 Approval Channel Manifest

(Verbatim from r3 — `ApprovalChannelManifestEntrySchema` with open governed `channelType` string; starter `ApprovalChannelFactoryRegistry` registers `'cli'`.)

#### 32a.2.4 Endpoint Manifest (r4 — schema emitted explicitly per audit B1)

r3 deferred this schema to "see §26.5"; the §26.5 prose did not actually contain the schema body, and a strict schema would reject the new `adapterConfig` field. r4 emits the schema body explicitly here so the §26.5 loader's `loadSignedManifest(manifestPath, EndpointManifestBodySchema, controlPlanePub)` call has a complete schema to point at.

File: `packages/vanguard/src/transport/endpoints/endpoint-manifest-schema.ts`

```typescript
import { z } from 'zod';

const NonEmptyStringSchema = z.string().min(1);

// Auth schema mirrors §12.3.38 ModelEndpointAuth discriminated union with .strict()
// branches (kind: 'none' rejects secretRef/headerName/prefix; kind: api_key | bearer
// requires secretRef + headerName, allows optional prefix).
const ModelEndpointAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({
    kind:       z.union([z.literal('api_key'), z.literal('bearer')]),
    secretRef:  NonEmptyStringSchema,
    headerName: NonEmptyStringSchema,
    prefix:     NonEmptyStringSchema.optional(),
  }).strict(),
]);

// Endpoint entry schema — one per ModelEndpoint (§12.3) record in the manifest.
// .strict() rejects unknown TOP-LEVEL fields. The adapterConfig field accepts an
// open Record<string, unknown> at this layer; per-adapter validation runs at the
// loader's Step 6.5 against the registered adapter's configSchema (§12.3.40, §26.5).
// Forbidden keys (stream, streaming, model, messages, auth, url, adapterId,
// endpointId, tier, enabled, healthy) are rejected at loader Step 6.4 BEFORE
// per-adapter schema runs.
export const EndpointManifestEntrySchema = z.object({
  endpointId:    NonEmptyStringSchema,
  tier:          NonEmptyStringSchema,
  url:           z.string().url(),
  adapterId:     NonEmptyStringSchema,
  modelName:     NonEmptyStringSchema,
  auth:          ModelEndpointAuthSchema,
  timeoutMs:     z.number().int().positive().optional(),
  /**
   * NEW in r4 per audit B1.
   * Open shape at the manifest layer. Loader §26.5 Step 6.4 rejects forbidden keys;
   * Step 6.5 invokes the registered adapter's configSchema for shape validation.
   * Defaults applied at adapter invoke time per §24.5.5.
   */
  adapterConfig: z.record(z.unknown()).optional(),
  enabled:       z.boolean(),
}).strict();

export const EndpointManifestBodySchema = z.object({
  endpoints: z.array(EndpointManifestEntrySchema).min(0),
}).strict();
```

Loader is `packages/vanguard/src/transport/endpoints/endpoint-manifest-loader.ts` per §26.5. Adapter validation against `ModelTransportAdapterRegistry.list()` follows the same factory-registry pattern as the other three domains (§12.3.48 behavior law). The adapter's `configSchema` field provides an additional per-entry adapterConfig validation step (§26.5 Steps 6.4 + 6.5).

### 32a.3 Cross-Domain Identifier Convention — runtime-utils path

(Verbatim from r1/r2/r3 — qualified identifiers, within-domain uniqueness mandatory, cross-domain warnings non-blocking. Detector/parse helpers live in `packages/runtime-utils/src/qualified-identifier.ts`.)

### 32a.4 RIA as Default Identity Manifest Entry — unchanged from r2/r3

(Verbatim from r2 — RIA is enabled identity-provider manifest entry; transitional bridge requires NEXUS_RIA_LEGACY_BRIDGE=1 + manifest absent + non-CI environment simultaneously; cannot bypass invalid signature/schema; ci:gate Step 17 detects bridge engagement in CI and fails. Cleared per audit C-A: bridge code may exist as transitional path; clean-clone forbids ENGAGEMENT, not presence.)

### 32a.5 Signing Utilities — runtime-utils path

(Verbatim from r3 — four signing scripts under `scripts/` wrap the shared `signManifest` helper at `packages/runtime-utils/src/manifest/sign-manifest.ts`.)

### 32a.6 Bootstrap Order

(Verbatim from r1/r2/r3 — 10 steps. Step 1 registers all four factory registries — `ModelTransportAdapterRegistry`, `IdentityProviderFactoryRegistry`, `ConnectorFactoryRegistry`, `ApprovalChannelFactoryRegistry` — and the factories themselves (per §12.3.49–.51) before any manifest loader runs, per §12.3.48 invariant 3. Step 4 evaluates RIA bridge conditions per §32a.4.)

### Reasoning (r4)

**Audit B3 (wording contradiction):** the prior "Importable by Layers 3+" framing contradicted the importer allow-list which includes `packages/core` (Layer 1). r4 removes the layer framing entirely and replaces with an explicit closed allow-list. The actual security/governance property (runtime-utils never reaches Layer 1+ via dependency chain) is preserved by the imports-INTO rule and ci:gate Step 19 enforcement — those are unchanged. This is purely a wording cleanup that aligns the prose with the rule.

**Audit B4 (HOLE-S10-001 closed):** owner ratification adopted at S10-T3 (audit-drafted ruling text + owner's "proceed" directive). r4 removes "pending owner ratification" language; the architectural answer (runtime-utils physical impl + core thin re-export) is now canonical. Zero existing-caller modifications required, single source of truth in runtime-utils.

**Audit B1 (schema emitted):** r3's "see §26.5" was a forward reference to prose that didn't actually contain the schema body. Under `.strict()`, the prior schema would have rejected `adapterConfig` before the loader's per-adapter validation ever ran. r4 emits `EndpointManifestEntrySchema` and `EndpointManifestBodySchema` here in §32a.2.4 with the new `adapterConfig: z.record(z.unknown()).optional()` field. `.strict()` is preserved at both levels (top-level body and per-entry).

<!-- chunk C6 end -->

---

## F-10 — §32 RIA — unchanged from r1/r2/r3

(Verbatim from r1/r2/r3 — RIA-as-manifest-entry note in §32.1; fromManifestEntry static in §32.3.)

---

## F-11 — §37 validation gate specs — unchanged from r3

(Verbatim from r3 — §37.19 signature gate; §37.20 transport adapter conformance gate with NINE scenarios per adapter + same-tier retry assertion (f); §37.21 transport package boundary gate AST-walking both `packages/vanguard/src/transport/**` and `packages/runtime-utils/src/**` with implementation-package prohibition for runtime-utils.)

---

## F-12 — §38 testing requirements — r4 revised

**Target:** APPEND new subsections after §38.8
**Action:** APPEND
**Closes:** testing, audit S10-T3 cleanups
**r4 changes vs r3:** §38.9 adds Ollama options.num_predict tests (audit C-C); §38.10 adds headers-then-body-stall test (audit B5); §38.11 adds endpoint-manifest-accepts-adapterConfig test (audit B1) + factory-type-definitions test (audit B2) + zod-not-in-contracts type-imports test (audit C-B); §38.12 unchanged.

### After — append §38.9 through §38.12 (r4 revised tests)

```
### 38.9 Transport Adapter Unit Tests (r4 revised — Ollama num_predict in options per audit C-C)

```
packages/vanguard/src/transport/registry.test.ts
  — register / get / list round trip
  — duplicate adapterId throws (per §12.3.48 invariant 1)
  — unregistered adapter returns null on get

packages/vanguard/src/transport/secrets/env-secret-source.test.ts
  — canResolve returns true for present env var
  — canResolve returns false for absent env var
  — canResolve does not log or expose the value (assert on captured logs)
  — resolve returns the value for present env var
  — resolve returns null for absent env var
  — resolve does not log the value
  — resolve throws on backend failure path (synthetic) → caller maps to SECRET_SOURCE_ERROR

packages/vanguard/src/transport/adapters/ollama-chat-v1.test.ts
  — invoke success: returns success: true, opaqueProviderResponse populated, responseSize is byte count
  — invoke 401: returns nvg_transport_auth_failed
  — invoke 429: returns nvg_transport_rate_limited
  — invoke 500: returns nvg_transport_provider_error
  — invoke timeout (fetch level): returns nvg_endpoint_timeout
  — invoke timeout (body-stall — NEW in r4 per audit B5): provider sends headers, stalls
    body past endpoint.timeoutMs → returns nvg_endpoint_timeout
  — invoke unreachable: returns nvg_endpoint_unreachable
  — invoke malformed JSON: returns nvg_transport_parse_error (with responseSize set)
  — invoke with secretSource.resolve returning null: returns nvg_transport_auth_missing
  — invoke with secretSource.resolve throwing: returns nvg_transport_secret_source_error
  — invoke does not log payload
  — invoke does not log secret value
  — invoke body construction: stream === false ALWAYS in posted body, regardless of adapterConfig
  — invoke body construction: model === endpoint.modelName ALWAYS, regardless of adapterConfig
  — invoke body construction: messages === request.payload ALWAYS, regardless of adapterConfig
  — invoke body construction NEW r4 (audit C-C): num_predict at TOP LEVEL of adapterConfig
    is REJECTED at manifest load (Ollama schema is .strict(); top-level num_predict is unknown)
  — invoke body construction NEW r4 (audit C-C): num_predict inside adapterConfig.options
    flows into body.options.num_predict in the posted Ollama request
  — invoke body construction: optional fields (options, keep_alive) only present
    when set in adapterConfig (no default-spread leakage)
  — invoke timer cleanup NEW r4 (audit B5): clearTimeout runs in finally regardless of
    success or denial path (assert via spy on global setTimeout/clearTimeout)
  — configSchema rejects unknown field 'stream' (defense-in-depth; loader rejects first)

packages/vanguard/src/transport/adapters/anthropic-messages-v1.test.ts
  — same NINE scenarios as Ollama (success + 8 denial codes)
  — invoke timeout (body-stall — NEW in r4 per audit B5): same assertion as Ollama
  — request body always includes max_tokens (default 4096 when adapterConfig absent)
  — request body uses adapterConfig.max_tokens when provided
  — required header anthropic-version: '2023-06-01' present in request
  — auth header is x-api-key (no prefix)
  — body construction explicit (no spread) — model/messages/stream not operator-overridable
  — invoke timer cleanup NEW r4 (audit B5): same assertion as Ollama
  — configSchema rejects unknown fields

packages/vanguard/src/transport/adapters/openai-chat-v1.test.ts
  — same NINE scenarios as Ollama
  — invoke timeout (body-stall — NEW in r4 per audit B5): same assertion as Ollama
  — auth header is Authorization with prefix 'Bearer '
  — adapterConfig fields (temperature, max_tokens, top_p, frequency_penalty, presence_penalty, stop)
    flow into request body when set; absent when unset
  — body construction explicit (no spread) — model/messages/stream not operator-overridable
  — invoke timer cleanup NEW r4 (audit B5): same assertion as Ollama
  — configSchema rejects unknown fields
```

### 38.10 Transport Conformance Suite (r4 revised — body-stall scenario added per audit B5)

```
tests/conformance/transport-five-invariants.test.ts          — unchanged from r3
tests/conformance/transport-runtime-wire-through.test.ts     — unchanged from r3
tests/conformance/transport-fallback.test.ts                 — unchanged from r3
tests/conformance/transport-same-tier-retry.test.ts          — unchanged from r3
tests/conformance/transport-fallback-trail-visibility.test.ts — unchanged from r3

tests/conformance/transport-timeout-body-stall.test.ts (NEW in r4 — audit B5)
  — Mock provider sends 200 OK headers, then withholds body bytes indefinitely.
    For each registered adapter (Ollama, Anthropic, OpenAI):
      - invoke with endpoint.timeoutMs = 200ms
      - assert denialCode === 'nvg_endpoint_timeout' within ~250ms
      - assert latencyMs >= 200 and < 500 (timeout fired, not hung)
      - assert no opaqueProviderResponse leaked
  — Mock provider sends 200 OK headers, then sends body slowly (one byte every 10ms).
    Total body completes BEFORE timeoutMs:
      - invoke with endpoint.timeoutMs = 5000ms, body completes in ~1000ms
      - assert success: true
      - assert responseSize equals total bytes received
  — Mock provider sends 200 OK headers, then sends body slowly past timeoutMs:
      - invoke with endpoint.timeoutMs = 200ms, body would take 1000ms
      - assert denialCode === 'nvg_endpoint_timeout'
      - assert no partial body parsed (no opaqueProviderResponse on result)
```

<!-- chunk C7 end -->

### 38.11 Manifest Signature + Schema Tests (r4 revised — adapterConfig acceptance + factory type definitions + zod-not-in-contracts)

```
tests/manifest/endpoint-manifest-signature.test.ts          — unchanged from r3

tests/manifest/endpoint-manifest-schema.test.ts (r4: adapterConfig field accepted by schema)
  — strict schema rejects unknown TOP-LEVEL fields (manifest envelope)
  — auth.kind === 'none' with secretRef present: load throws schema error
  — auth.kind === 'api_key' missing headerName: load throws schema error
  — adapterConfig field accepted as Record<string, unknown> at envelope level NEW r4
    (audit B1): manifest entry with `adapterConfig: { foo: 'bar' }` PARSES; per-adapter
    validation runs at loader Step 6.5 (separate test in adapter-config-schema-validation)
  — adapterConfig field absent: schema parse succeeds (adapterConfig is optional)
  — duplicate endpointId: load throws explicit duplicate error
  — unknown adapterId: load throws "adapterId not registered" error
  — disabled entry skips secretRef resolvability check
  — enabled entry with unresolvable secretRef (canResolve false): load throws
  — enabled entry with secretSource throwing on canResolve: load throws "secret backend threw"
  — manifest with zero enabled entries: load throws "fail closed"
  — adapterConfig forbidden key 'stream': load throws "adapterConfig.stream is forbidden"
  — adapterConfig forbidden key 'streaming': load throws (parallel)
  — adapterConfig forbidden key 'model': load throws (parallel)
  — adapterConfig forbidden key 'messages': load throws (parallel)
  — adapterConfig forbidden key 'auth': load throws (parallel)
  — adapterConfig forbidden key 'url': load throws (parallel)
  — adapterConfig forbidden key 'adapterId': load throws (parallel)
  — adapterConfig forbidden key 'endpointId': load throws (parallel)
  — adapterConfig forbidden key 'tier': load throws (parallel)
  — adapterConfig forbidden key 'enabled': load throws (parallel)
  — adapterConfig forbidden key 'healthy': load throws (parallel)

tests/manifest/adapter-config-schema-validation.test.ts (r4 cascade — Ollama options shape per audit C-C)
  — Ollama adapterConfig invalid (e.g. options: 'not-an-object'): load throws naming the issue
  — Ollama adapterConfig with unknown TOP-LEVEL field: load throws (Ollama schema is .strict())
  — Ollama adapterConfig.options.num_predict accepted as record value (NEW r4 audit C-C)
  — Ollama adapterConfig.num_predict at top-level rejected (NEW r4 audit C-C)
  — Anthropic adapterConfig invalid max_tokens (string instead of int): load throws
  — Anthropic adapterConfig with unknown field: load throws
  — OpenAI adapterConfig invalid temperature (out of range): load throws
  — OpenAI adapterConfig with unknown field: load throws
  — adapterConfig absent: load succeeds (no validation invoked)
  — adapterConfig empty object: load succeeds (no fields to validate)

tests/manifest/identity-manifest-signature.test.ts        — parallel coverage
tests/manifest/connector-manifest-signature.test.ts       — parallel coverage
tests/manifest/channel-manifest-signature.test.ts         — parallel coverage

tests/manifest/factory-registry-validation.test.ts        — unchanged from r3 cascade

tests/manifest/factory-type-definitions.test.ts (NEW in r4 — audit B2)
  — IdentityProviderFactory interface satisfied by a minimal stub: { providerType: 'stub',
    create: async () => ({ ...IdentityProviderInterface impl }) } — typecheck passes
  — ConnectorFactory interface satisfied by a minimal stub — typecheck passes
  — ApprovalChannelFactory interface satisfied by a minimal stub — typecheck passes
  — IdentityProviderFactoryRegistry.register accepts the stub factory and round-trips
    via get/list — verifies the import wiring §12.3.45 → §12.3.49 builds
  — ConnectorFactoryRegistry.register accepts the stub factory — verifies §12.3.46 → §12.3.50
  — ApprovalChannelFactoryRegistry.register accepts the stub factory — verifies §12.3.47 → §12.3.51

tests/manifest/cross-domain-collision.test.ts             — unchanged from r3
tests/manifest/ria-bridge.test.ts                         — unchanged from r3
tests/manifest/canonicalize-compat-reexport.test.ts       — unchanged from r3 (HOLE-S10-001 closed; test stays)

tests/contracts/no-zod-import.test.ts (NEW in r4 — audit C-B)
  — AST-walk packages/contracts/src/**/*.ts:
      - assert no file contains `import ... from 'zod'`
      - assert no file contains `import 'zod'`
      - assert no file contains `require('zod')`
  — Verify ModelTransportAdapter type-checks against an ad-hoc structural schema
    object (no Zod) that exposes safeParse — confirms AdapterConfigSchema<TConfig>
    is genuinely structural and does not require Zod
  — Verify ModelTransportAdapter type-checks against a Zod schema (z.object({...}))
    via TConfig = z.infer<...> — confirms backward compatibility for Zod authors
```

### 38.12 NVG Transport Threat Tests — unchanged from r3

(Verbatim from r3: tests/threat/14 unknown-adapter, tests/threat/15 auth-missing-startup, tests/threat/16 stream-field-rejected, tests/threat/17 content-leak. SECRET_SOURCE_ERROR remains adapter-level per r3 — covered by Step 18 §38.9 unit tests + transport-fallback.test.ts.)

### Reasoning (r4)

Test surfaces extended for the new audit S10-T3 cleanups: body-stall scenario per adapter (audit B5) verifies the single-try/finally timeout law; Ollama options.num_predict tests (audit C-C) prove the wire-format precision fix; endpoint-manifest-accepts-adapterConfig test (audit B1) prevents regression where the schema rejects the new field; factory-type-definitions test (audit B2) confirms the three new factory interfaces are line-buildable and the registry round-trip works; no-zod-import test (audit C-B) prevents regression of the structural AdapterConfigSchema<TConfig> by AST-walking contracts for any zod import. All other r3 tests preserved verbatim.

---

## F-13 — §41 known holes log — r4 revised: HOLE-S10-001 CLOSED

(r1/r2/r3 closures preserved.)

**Closure additions in r4:**

- **HOLE-S10-001 (introduced r3, CLOSED in r4):** canonicalize physical location wording correction. Owner ratification at S10-T3 (audit-drafted ruling text + owner's "proceed" directive on the audit pasteback). Approved path: physical implementation moves to `packages/runtime-utils/src/canonicalize.ts`; `packages/core/src/crypto/canonicalize.ts` becomes a thin re-export from runtime-utils; `@nexus/core` export compatibility preserved; existing relative imports unchanged. **CLOSED.**

All other r3 closure prose preserved unchanged: priorAttempts wire (B2), adapterConfig (B3), runtime-utils package (B5/owner S10-T1), SECRET_SOURCE_ERROR (C2), same-tier retry (B4), explicit body construction (B1), factory registries (B3), NvgNormalizedResponse extension (drift D2).

---

## F-14 — §43 completion criteria — r4 revised

**r4 changes:** added HOLE-S10-001 closure record; added body-stall timeout coverage (audit B5); added Ollama options.num_predict pinning (audit C-C); added factory-type definitions (audit B2); added structural AdapterConfigSchema interface (audit C-B); added EndpointManifestEntrySchema explicit emission with adapterConfig field (audit B1); added clean-clone wording fix (audit C-A).

### After (append additional bullets to r1/r2/r3 list)

(r1 / r2 / r3 bullets preserved verbatim. r4 appends:)

```
- HOLE-S10-001 CLOSED: canonicalize compat re-export pattern ratified at S10-T3.
  packages/runtime-utils/src/canonicalize.ts is the physical implementation;
  packages/core/src/crypto/canonicalize.ts re-exports from runtime-utils;
  zero existing-caller modifications required and verified.
- Endpoint manifest schema (EndpointManifestEntrySchema) explicitly emitted with
  `adapterConfig: z.record(z.unknown()).optional()` and `.strict()` preserved at
  both top-level body and per-entry; verified via tests/manifest/endpoint-manifest-schema
  acceptance test (audit B1 cascade closure).
- Three factory interfaces (IdentityProviderFactory, ConnectorFactory,
  ApprovalChannelFactory) defined inline in §12.3.49 / §12.3.50 / §12.3.51 with
  minimal acceptable shape (typed providerType/connectorType/channelType + create
  method); registry interfaces §12.3.45-.47 are now line-buildable; verified via
  tests/manifest/factory-type-definitions (audit B2 cascade closure).
- runtime-utils importer-allow-list framing corrected to closed explicit list
  (no more "Layer 3+" wording); imports-into rule preserved; verified via
  ci:gate Step 19 AST-walk (audit B3 cascade closure).
- Adapter timeout law (B5): single AbortController.signal covers BOTH fetch
  resolution AND response body consumption; clearTimeout runs ONLY in finally;
  AbortError from either operation maps to nvg_endpoint_timeout; verified by
  tests/conformance/transport-timeout-body-stall.test.ts and per-adapter
  body-stall unit tests (audit B5 cascade closure).
- Ollama wire-format: `num_predict` lives inside `options.num_predict` per
  Ollama API (NOT top-level adapterConfig); top-level num_predict is rejected
  by OllamaAdapterConfigSchema .strict() at manifest load; verified via
  tests/manifest/adapter-config-schema-validation Ollama options.num_predict
  cases (audit C-C cascade closure).
- @nexus/contracts has NO zod dependency: `configSchema` is typed against the
  structural AdapterConfigSchema<TConfig> interface (§12.3.40); Zod's
  z.ZodSchema<TConfig> satisfies it structurally; verified via
  tests/contracts/no-zod-import (AST-walk) and structural-vs-Zod typecheck
  cases (audit C-B cascade closure).
- Clean-clone forbids RIA bridge ENGAGEMENT (not presence); bridge code may
  exist as transitional path guarded by NEXUS_RIA_LEGACY_BRIDGE=1; ci:gate
  Step 17 detects engagement in CI (audit C-A cascade closure).
```

---

## F-15 — §44 final spec statement — unchanged from r1/r2/r3

(Verbatim from r1: v2.9.29 PROPOSED, paired with blueprint v2.6.16 PROPOSED.)

---

## 3. Closing notes for review

**r4 supersedes r3.** r3 is reference for diff purposes only. Recommend audit verifies r4 by checking just the deltas listed below — full re-read of r3-unchanged fragments not required.

**Net new content in r4 vs r3:**
- F-04 §12.3.40: structural `AdapterConfigSchema<TConfig>` interface (audit C-B); `configSchema` field type changed from `z.ZodSchema<TConfig>` to `AdapterConfigSchema<TConfig>`
- F-04 §12.3.49 / §12.3.50 / §12.3.51: three factory interfaces defined inline (audit B2)
- F-07 §24.5.4 Ollama: single try/finally timeout-covers-body-read pattern (audit B5); `num_predict` removed from top-level config schema (audit C-C — operators specify via `adapterConfig.options.num_predict`)
- F-07 §24.5.6 Anthropic + OpenAI: same body-stall timeout pattern documented (audit B5)
- F-09 §32a.0: importer allow-list wording corrected (audit B3)
- F-09 §32a.0.1: HOLE-S10-001 CLOSED with owner ratification text (audit B4)
- F-09 §32a.2.4: `EndpointManifestEntrySchema` and `EndpointManifestBodySchema` emitted explicitly with `adapterConfig: z.record(z.unknown()).optional()` (audit B1)
- F-12 §38.9: per-adapter body-stall test + Ollama options.num_predict tests + timer-cleanup tests (audit B5 + C-C)
- F-12 §38.10: `transport-timeout-body-stall.test.ts` conformance suite (audit B5)
- F-12 §38.11: `endpoint-manifest-schema` adapterConfig acceptance test (audit B1) + `factory-type-definitions.test.ts` (audit B2) + `tests/contracts/no-zod-import.test.ts` (audit C-B)
- F-02 §6.6: clean-clone wording corrected to "MUST NOT engage" (audit C-A)
- F-13: HOLE-S10-001 CLOSED entry
- F-14: r4 completion-criteria additions (8 new bullets covering all audit S10-T3 closures)

**r3 carve-outs removed in r4:**
- "Importable by Layers 3+ implementation packages" wording (replaced with closed allow-list)
- "pending owner ratification" language for HOLE-S10-001 (CLOSED)
- "existing or to-be-defined" language for factory types (defined inline)
- "see §26.5" forward reference to a schema body that wasn't actually present (emitted explicitly)
- `import type { z } from 'zod'` from `@nexus/contracts` `transport-adapter.ts` snippet (replaced with structural AdapterConfigSchema import)
- Top-level `num_predict` field in Ollama config schema (moved to options bag per Ollama wire format)
- Clean-clone "MUST NOT include" RIA bridge wording (corrected to "MUST NOT engage")
- `clearTimeout(timer)` placement immediately after fetch resolution (moved to `finally` block covering body read)

**Owner ratification needed for r4 specifically:**
- v2.9.29 spec version number under owner's S9-T11 convention math (math may differ; owner adjusts if needed)
- HOLE-S10-001 closure interpretation — r4 treats audit S10-T3 ruling text + owner's "proceed" directive as ratification. Owner to confirm in next turn or correct if interpretation is wrong (in which case r5 reopens the hole and waits for explicit ruling).

**Pairing unchanged:** spec v2.9.29 paired with blueprint v2.6.16. Both go canonical jointly.

**Next deliverable when audit-blesses r4:** full merged spec file `nexus-engineering-spec-v2-9-29.md` produced mechanically from spec v1.8.26 base + these 15 fragments.

---

*End of AMEND-spec-v2.9.29-NISP-001-A-r4.md*

<!-- chunk C8 end -->
