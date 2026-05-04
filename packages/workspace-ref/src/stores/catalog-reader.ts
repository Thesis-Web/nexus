// packages/workspace-ref/src/stores/catalog-reader.ts
// AMEND-nexus-spec-workspace-v1-1-1 §7.2, blueprint §4.2-4.4
// Layer 7 — reference WorkspaceCatalogReaderPort implementation.
//
// Read-only views filtered by identity ceiling + OCT.
// Reference impl returns empty catalogs — production wires real registries.
// Blueprint §3.4.3: visible + selectable + struck-through + hidden filtering.

import type { WorkspaceCatalogReaderPort, CatalogItem, IdentityClaims } from '@nexus/contracts';

/**
 * Reference catalog reader.
 * Returns empty catalogs by default. Production implementations query
 * agent/model/connector registries filtered by the caller's identity
 * ceiling, OCT level, and NVG policy.
 */
export class ReferenceCatalogReader implements WorkspaceCatalogReaderPort {
  async listAgents(_claims: IdentityClaims): Promise<CatalogItem[]> {
    // Production: query agent registry, filter by claims.principalIdentity ceiling
    return [];
  }

  async listModels(_claims: IdentityClaims): Promise<CatalogItem[]> {
    // Production: query model tier registry, filter by OCT + NVG policy
    return [];
  }

  async listConnectors(_claims: IdentityClaims): Promise<CatalogItem[]> {
    // Production: query connector registry, filter by identity ceiling
    return [];
  }
}
