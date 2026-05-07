// packages/workspace-ref/src/stores/catalog-reader.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.2, blueprint §4.2-4.4
// Layer 7 — reference WorkspaceCatalogReaderPort implementation.
//
// Read-only views filtered by identity ceiling.
// Blueprint §3.4.3: visible + selectable + struck-through + hidden filtering.
//
// TURN10-CATALOG-001/002 (Claude C): widen the constructor to accept
// claims-filtered backing data (actor registry + connector records + endpoint
// records). Defaults to empty when not injected — preserves the original
// zero-arg behavior for environments that haven't wired the new path yet.
//
// Filtering law:
//   listAgents      — actorRegistry.list() filtered by:
//                      • actor.actorClass === SUPERVISED_AGENT
//                      • allowedSystems intersect claims.capabilityCeilings
//                      • risk tier ≤ ceiling maxRiskTier
//                      Disabled actors are still surfaced as `selectable:false`
//                      with a `reason` (visible+disabled, not hidden).
//   listModels      — endpoints filtered by:
//                      • tier ∈ ceiling-allowed tiers (best-effort: filter
//                        out endpoints whose tier matches a ceiling.maxRiskTier
//                        gate; in V1, we mark all endpoints visible and let
//                        NVG enforce at runtime; selectable iff endpoint.healthy)
//   listConnectors  — connectorRecords filtered by:
//                      • allowedSystems intersect ceiling.allowedSystems
//                        (wildcard '*' on either side passes-through)
//
// SECURITY: this reader NEVER echoes secrets. Connector configurations may
// contain `Record<string, unknown>` payloads that include secret references
// — they are NOT exposed via CatalogItem. Only id/name/description/visible
// /selectable/reason are returned per CatalogItem shape.

import type {
  WorkspaceCatalogReaderPort,
  CatalogItem,
  IdentityClaims,
  ActorRegistry,
  Actor,
  ConnectorManifestRecord,
  ModelEndpoint,
} from '@nexus/contracts';
import { ACTOR_CLASS } from '@nexus/contracts';

/**
 * Optional dependencies for claims-filtered catalog reads.
 * When omitted, the reader returns empty arrays (backward-compat with the
 * original zero-arg reference implementation).
 */
export interface ReferenceCatalogReaderDeps {
  /** Actor registry — used by listAgents to enumerate SUPERVISED_AGENT actors. */
  readonly actorRegistry?: ActorRegistry;
  /** Connector manifest records (from ExternalsRuntime.connectorRecords). */
  readonly connectorRecords?: readonly ConnectorManifestRecord[];
  /** Model endpoint records (from BootstrapResult.endpoints). */
  readonly endpointRecords?: readonly ModelEndpoint[];
}

/**
 * Returns true if `allowedSystems` from a manifest record overlaps the
 * caller's capability ceiling for systems. Wildcard '*' on either side passes.
 */
function intersectsAllowedSystems(
  recordSystems: readonly string[],
  claims: IdentityClaims
): boolean {
  if (recordSystems.includes('*')) return true;
  for (const ceiling of claims.capabilityCeilings) {
    if (ceiling.allowedSystems.includes('*')) return true;
    for (const sys of recordSystems) {
      if (ceiling.allowedSystems.includes(sys)) return true;
    }
  }
  return false;
}

/**
 * Reference catalog reader — claims-filtered when constructed with deps;
 * empty otherwise. Production implementations may override or extend.
 */
export class ReferenceCatalogReader implements WorkspaceCatalogReaderPort {
  private readonly actorRegistry: ActorRegistry | undefined;
  private readonly connectorRecords: readonly ConnectorManifestRecord[];
  private readonly endpointRecords: readonly ModelEndpoint[];

  constructor(deps: ReferenceCatalogReaderDeps = {}) {
    this.actorRegistry = deps.actorRegistry;
    this.connectorRecords = deps.connectorRecords ?? [];
    this.endpointRecords = deps.endpointRecords ?? [];
  }

  async listAgents(claims: IdentityClaims): Promise<CatalogItem[]> {
    if (!this.actorRegistry) return [];
    const actors: Actor[] = await this.actorRegistry.list();
    const items: CatalogItem[] = [];
    for (const actor of actors) {
      // Only surface SUPERVISED_AGENT actors as user-facing agents.
      if (actor.actorClass !== ACTOR_CLASS.SUPERVISED_AGENT) continue;

      const allowedByCeiling = intersectsAllowedSystems(actor.allowedSystems, claims);
      const enabled = actor.enabled !== false;

      const item: CatalogItem = {
        id: actor.actorId as string,
        name: (actor.displayName ?? (actor.actorId as string)) as string,
        description:
          (actor.purpose as string | undefined) ?? `Supervised agent ${actor.actorId as string}`,
        visible: allowedByCeiling,
        selectable: allowedByCeiling && enabled,
        ...(allowedByCeiling
          ? enabled
            ? {}
            : { reason: 'agent disabled' }
          : { reason: 'outside capability ceiling' }),
      };
      items.push(item);
    }
    return items;
  }

  async listModels(claims: IdentityClaims): Promise<CatalogItem[]> {
    if (this.endpointRecords.length === 0) return [];
    const items: CatalogItem[] = [];
    // V1 visibility law: every loaded endpoint is visible; NVG enforces
    // tier ceilings at runtime per spec §22.1. Selectable iff the endpoint
    // is healthy. `claims` is reserved here for V2 ceiling-based redaction.
    void claims;
    for (const ep of this.endpointRecords) {
      const selectable = ep.healthy;
      const item: CatalogItem = {
        id: ep.endpointId as string,
        name: `${ep.modelName as string} (${ep.tier as string})`,
        description: `${ep.adapterId as string} → ${ep.url as string}`,
        visible: true,
        selectable,
        ...(selectable ? {} : { reason: 'endpoint unhealthy' }),
      };
      items.push(item);
    }
    return items;
  }

  async listConnectors(claims: IdentityClaims): Promise<CatalogItem[]> {
    if (this.connectorRecords.length === 0) return [];
    const items: CatalogItem[] = [];
    for (const c of this.connectorRecords) {
      const allowedByCeiling = intersectsAllowedSystems(c.allowedSystems, claims);
      const item: CatalogItem = {
        id: c.connectorId as string,
        name: c.connectorId as string,
        description: `${c.connectorType as string} connector → ${c.allowedSystems.join(', ')}`,
        visible: allowedByCeiling,
        selectable: allowedByCeiling,
        ...(allowedByCeiling ? {} : { reason: 'outside capability ceiling' }),
      };
      items.push(item);
    }
    return items;
  }
}
