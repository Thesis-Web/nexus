// scripts/build-tool-schemas.ts
//
// Phase C buildToolDefinitions, part 2 of 4 (composition-boundary side).
//
// Resolves an agent's reachable tool surface: walks every connector the
// agent can reach (via allowedSystems), pulls each connector's
// describeToolSchemas(), and filters down to descriptors whose
// `capability` is in the agent's allowedCapabilities. The result is the
// neutral ToolSchemaDescriptor[] the orchestrator attaches to the NVG
// outbound payload.
//
// Lives at the composition boundary (scripts/) on purpose: the
// composition root knows how to walk the connector registry; the
// adapters in vanguard handle per-provider translation; the contract
// in @nexus/contracts owns the descriptor shape. This file is the glue.
//
// Pure function — easy to unit-test against a fake registry. The
// downstream audit event (P-tool-3) reads from the returned array to
// log toolNames + capabilityRefs + targetSystems.

import type { Actor, Connector, ToolSchemaDescriptor } from '@nexus/contracts';

/**
 * Read-only view of the connector registry — just enough to enumerate
 * connectors by systemType. Avoids importing the full
 * SimpleConnectorRegistry into pure helpers.
 */
export interface ConnectorLookup {
  /** Returns the registered connector for a given systemType, or null. */
  get(systemType: string): Connector | null;
}

/**
 * Build the tool surface presented to the LLM for one agent on one
 * dispatch turn. The result is a deterministic, deduplicated array
 * sorted by tool name so audit-log digests are replay-stable.
 *
 *  - Walks `agent.allowedSystems` (explicit list — wildcards are
 *    rejected at agent registration time).
 *  - For each system, looks up the connector in the registry.
 *  - Calls `describeToolSchemas()`.
 *  - Filters to descriptors whose `capability` is in
 *    `agent.allowedCapabilities`.
 *  - Returns `[]` when no connectors are reachable, the agent has no
 *    allowedCapabilities, or the registry has no matching entries.
 */
export function buildToolDescriptorsForAgent(
  agent: Actor,
  registry: ConnectorLookup
): ToolSchemaDescriptor[] {
  const allowedCaps = new Set(agent.allowedCapabilities ?? []);
  if (allowedCaps.size === 0) return [];

  const out: ToolSchemaDescriptor[] = [];
  const seen = new Set<string>();

  for (const system of agent.allowedSystems) {
    if (system === '*') continue; // explicit defensive — wildcards forbidden upstream
    const connector = registry.get(system);
    if (!connector) continue;
    const descriptors = connector.describeToolSchemas();
    for (const d of descriptors) {
      if (!allowedCaps.has(d.capability)) continue;
      if (seen.has(d.name)) continue; // first-write-wins on name collisions
      seen.add(d.name);
      out.push(d);
    }
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}
