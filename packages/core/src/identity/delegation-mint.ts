/**
 * Baked Delegation Mint — F4.15 / Hard Law #15.
 *
 * Owns the three-way symmetric intersection arithmetic for run effective
 * permissions. Each invocation reads ALL THREE sources for ALL SIX
 * dimensions (target_systems, capabilities, oct_level, firewall_rights,
 * run_types, risk_tier) and returns a discriminated DelegationMintResult.
 * No fabricated identifiers; no asymmetric ad-hoc fallbacks; no
 * silent fail-open. The post-Phase-B-session-1 cleanup is enforced via
 * scripts/ci-gate.ts GOV-04 (verifies the impl reads all three sources
 * for every dimension by AST scan).
 *
 * Hard Laws this implements:
 *   #10 — every signed envelope is Ed25519-signed; failure is fail-closed.
 *   #13 — default-secure: no permissions absent positive intersection.
 *   #15 — lesser wins in every dimension.
 *
 * Caller contract (orch consumer, §3.3 of F4.15):
 *   const result = await delegationMint.mint(input);
 *   switch (result.kind) {
 *     case 'success': dispatch with result.delegation
 *     case 'empty_intersection': ledger + workspace callback; no dispatch
 *     case 'mint_error': ledger + workspace receipt; run terminates
 *   }
 */
import type {
  AgentDeclaration,
  Capability,
  DelegationContext,
  DelegationMintErrorRef,
  DelegationMintInput,
  DelegationMintPort,
  DelegationMintResult,
  EffectiveDelegationScope,
  ExplicitDelegationScope,
  FirewallTransitMap,
  IdentityClaimsCapabilityCeiling,
  IntersectionDimension,
  IsoTimestamp,
  NonEmpty,
  OctLevel,
  RiskTier,
  RunTypeKind,
  Uuid,
} from '@nexus/contracts';
import { OCT_RANK, RISK_TIER_ORDER } from '@nexus/contracts';

/**
 * Signs a fully-intersected delegation envelope. Mirrors the
 * mintRootDelegation control-plane signing surface; the mint port stays
 * abstract over the signing function so unit tests can pass a
 * deterministic mock + production can pass the loaded control-plane
 * signer.
 */
export type DelegationSigner = (
  delegationBody: Omit<DelegationContext, 'signature'>
) => Promise<DelegationContext>;

/**
 * Optional persistence hook. The mint itself does NOT persist (separation
 * of concerns: signing vs. storage); callers like orch handle save +
 * ledger writes. The hook is here for callers that want one-call mint+save
 * semantics; production wires it to delegationStore.save.
 */
export type DelegationPersister = (delegation: DelegationContext) => Promise<void>;

export interface BakedDelegationMintDeps {
  readonly signer: DelegationSigner;
  /** Stable opaque error ref generator. Production passes randomUUID(); tests pass deterministic. */
  readonly newErrorRef: () => DelegationMintErrorRef;
  readonly persister?: DelegationPersister;
}

/** Concrete baked port implementation. */
export class BakedDelegationMint implements DelegationMintPort {
  constructor(private readonly deps: BakedDelegationMintDeps) {}

  async mint(input: DelegationMintInput): Promise<DelegationMintResult> {
    // ── §3.1 three-way intersection ────────────────────────────────────
    const userClaims = input.userClaims;
    const agent = input.agentDeclaration;
    const explicit = input.explicitDelegatedScope;

    // target_systems: user ∩ agent ∩ explicit (string equality).
    //
    // F-15 owner ruling 2026-05-22: empty target_systems is a hard
    // empty_intersection denial ONLY when `input.requiresSystemAction`
    // is true (NXS / connector-bound dispatch). For model-bound tasks
    // (kind:nvg, free_chat, synthesize-only) the intersection is still
    // computed — the resulting set is whatever it is, possibly empty —
    // and the signed delegation carries that set verbatim. Downstream
    // NXS gates still fail-closed on `allowedSystems=[]` if someone
    // attempts a system action with such a delegation; what changes is
    // ONLY that NVG-bound runs no longer pre-fail at mint time on a
    // chat-agent whose visibleTargetSystems is disjoint from the
    // user's. Other dimensions (capabilities / OCT / firewall /
    // run_types / risk) remain symmetric for ALL tasks.
    const targetSystems = intersectStrings(
      userClaims.permittedTargetSystems,
      agent.visibleTargetSystems,
      explicit.targetSystems
    );
    if (targetSystems.length === 0 && input.requiresSystemAction) {
      return emptyIntersection(
        'target_systems',
        userClaims.permittedTargetSystems,
        agent.visibleTargetSystems,
        explicit.targetSystems
      );
    }

    // capabilities: user ∩ agent ∩ explicit (string equality on Capability).
    const capabilities = intersectStrings(
      userClaims.permittedCapabilities,
      agent.allowedCapabilities,
      explicit.capabilities
    ) as ReadonlyArray<Capability>;
    if (capabilities.length === 0) {
      return emptyIntersection(
        'capabilities',
        userClaims.permittedCapabilities,
        agent.allowedCapabilities,
        explicit.capabilities
      );
    }

    // oct_level: lesser wins via OCT_RANK lookup.
    const octCandidates: ReadonlyArray<OctLevel> = [
      userClaims.octLevel,
      agent.maxOctLevel,
      explicit.maxOctLevel,
    ];
    const octLevel = lesserOct(octCandidates);
    if (octLevel === null) {
      // Unknown OCT level (ranks missing) — treat as empty intersection.
      return emptyIntersection(
        'oct_level',
        [userClaims.octLevel],
        [agent.maxOctLevel],
        [explicit.maxOctLevel]
      );
    }

    // firewall_rights: per-direction string intersection.
    const firewallTransitRights: FirewallTransitMap = {
      outbound: intersectStrings(
        userClaims.firewallTransitRights.outbound,
        agent.firewallTransitRights.outbound,
        explicit.firewallTransitRights.outbound
      ) as ReadonlyArray<NonEmpty>,
      inbound: intersectStrings(
        userClaims.firewallTransitRights.inbound,
        agent.firewallTransitRights.inbound,
        explicit.firewallTransitRights.inbound
      ) as ReadonlyArray<NonEmpty>,
    };
    if (firewallTransitRights.outbound.length === 0 && firewallTransitRights.inbound.length === 0) {
      return emptyIntersection(
        'firewall_rights',
        [...userClaims.firewallTransitRights.outbound, ...userClaims.firewallTransitRights.inbound],
        [...agent.firewallTransitRights.outbound, ...agent.firewallTransitRights.inbound],
        [...explicit.firewallTransitRights.outbound, ...explicit.firewallTransitRights.inbound]
      );
    }

    // run_types: string intersection over RunTypeKind enumeration.
    const runTypes = intersectStrings(
      userClaims.permittedRunTypes,
      agent.permittedRunTypes,
      explicit.runTypes
    ) as ReadonlyArray<RunTypeKind>;
    if (runTypes.length === 0) {
      return emptyIntersection(
        'run_types',
        userClaims.permittedRunTypes,
        agent.permittedRunTypes,
        explicit.runTypes
      );
    }

    // risk_tier: lesser wins via RISK_TIER_RANK.
    const riskCandidates: ReadonlyArray<RiskTier> = [
      userClaims.maxRiskTier,
      agent.maxRiskTier,
      explicit.maxRiskTier,
    ];
    const riskTier = lesserRisk(riskCandidates);
    if (riskTier === null) {
      return emptyIntersection(
        'risk_tier',
        [userClaims.maxRiskTier],
        [agent.maxRiskTier],
        [explicit.maxRiskTier]
      );
    }

    // ── All six dimensions non-empty — build the signed envelope ──────
    const effectiveScope: EffectiveDelegationScope = {
      targetSystems,
      capabilities,
      firewallTransitRights,
      runTypes,
      octLevel,
      riskTier,
    };

    const body: Omit<DelegationContext, 'signature'> = {
      delegationId: '' as Uuid, // filled by signer
      principalId: userClaims.principalId,
      actorId: agent.agentId,
      parentDelegationId: null,
      chainDepth: 0,
      maxChainDepth: input.maxChainDepth,
      allowedSystems: [...targetSystems],
      allowedCapabilities: [...capabilities],
      forbiddenCapabilities: [],
      maxRiskTier: riskTier,
      allowDownstreamPropagation: false,
      environment: '' as DelegationContext['environment'], // caller-supplied via signer override path
      mintedAt: input.issuedAt,
      expiresAt: input.explicitDelegatedScope.expiresAt,
      mintedBy: '' as NonEmpty, // signer assigns DELEGATION_ENGINE_ID
    };

    let delegation: DelegationContext;
    try {
      delegation = await this.deps.signer(body);
    } catch (err) {
      return {
        kind: 'mint_error',
        reason: classifyMintError(err),
        errorRef: this.deps.newErrorRef(),
        detail: ((err as Error).message ?? 'unknown_signing_failure') as NonEmpty,
      };
    }

    if (this.deps.persister) {
      try {
        await this.deps.persister(delegation);
      } catch (err) {
        return {
          kind: 'mint_error',
          reason: 'persistence_failed',
          errorRef: this.deps.newErrorRef(),
          detail: ((err as Error).message ?? 'unknown_persistence_failure') as NonEmpty,
        };
      }
    }

    return { kind: 'success', delegation, effectiveScope };
  }
}

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

/**
 * Three-way string intersection, preserving the order of the first source
 * for stable downstream replay. Strings that appear in source 1 but not
 * in sources 2 or 3 are dropped.
 */
export function intersectStrings<T extends string>(
  a: ReadonlyArray<T>,
  b: ReadonlyArray<T>,
  c: ReadonlyArray<T>
): ReadonlyArray<T> {
  if (a.length === 0 || b.length === 0 || c.length === 0) return [];
  const bSet = new Set(b);
  const cSet = new Set(c);
  const out: T[] = [];
  for (const item of a) {
    if (bSet.has(item) && cSet.has(item)) {
      out.push(item);
    }
  }
  return out;
}

/**
 * Pick the OCT level with the LEAST rank among the candidates (lesser
 * wins). Returns null if any candidate is missing from OCT_RANK.
 */
export function lesserOct(candidates: ReadonlyArray<OctLevel>): OctLevel | null {
  let best: OctLevel | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const oct of candidates) {
    const rank = (OCT_RANK as Record<string, number>)[oct];
    if (typeof rank !== 'number') return null;
    if (rank < bestRank) {
      bestRank = rank;
      best = oct;
    }
  }
  return best;
}

/**
 * Pick the RiskTier with the LEAST rank among the candidates (lesser
 * wins). Returns null if any candidate is not in RISK_TIER_ORDER (the
 * established rank source per RISK_TIER_ORDER + riskTierExceeds).
 */
export function lesserRisk(candidates: ReadonlyArray<RiskTier>): RiskTier | null {
  let best: RiskTier | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const r of candidates) {
    const rank = RISK_TIER_ORDER.indexOf(r);
    if (rank < 0) return null;
    if (rank < bestRank) {
      bestRank = rank;
      best = r;
    }
  }
  return best;
}

function emptyIntersection(
  dimension: IntersectionDimension,
  userValues: ReadonlyArray<unknown>,
  agentValues: ReadonlyArray<unknown>,
  explicitValues: ReadonlyArray<unknown>
): DelegationMintResult {
  return {
    kind: 'empty_intersection',
    dimension,
    userValues,
    agentValues,
    explicitValues,
  };
}

function classifyMintError(err: unknown): 'signing_unavailable' | 'signature_failed' {
  const msg = ((err as Error)?.message ?? '').toLowerCase();
  if (
    msg.includes('signing_unavailable') ||
    msg.includes('key not found') ||
    msg.includes('no signing key')
  ) {
    return 'signing_unavailable';
  }
  return 'signature_failed';
}

// Re-export agent + user types for downstream consumers that want to
// build inputs to {@link BakedDelegationMint.mint}. The contract package
// already owns the canonical declarations; this re-export is for
// ergonomic single-import in orch composition roots.
export type {
  AgentDeclaration,
  ExplicitDelegationScope,
  IdentityClaimsCapabilityCeiling,
  DelegationMintInput,
  DelegationMintResult,
  DelegationMintPort,
  EffectiveDelegationScope,
  IsoTimestamp,
};
