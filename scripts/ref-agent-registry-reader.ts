/**
 * AgentRegistryReader — read-only projection over NXS ActorRegistry.
 *
 * Filters to agent actor classes, maps Actor → AgentCapabilityEntry.
 * Composition root file — UNLAYERED.
 *
 * [blueprint §11.4.3] — planner never mutates the registry.
 * [spec §20.2] — NXS ActorRegistry is the canonical governed source of truth.
 */
import type { ActorRegistry, Uuid, NonEmpty } from '@nexus/contracts';
import type { AgentRegistryReader, AgentCapabilityEntry } from '@nexus/contracts';
import { ACTOR_CLASS } from '@nexus/contracts';

/** Agent actor classes per governed taxonomy [spec §12.3.1, constants/index.ts]. */
const AGENT_ACTOR_CLASSES: ReadonlySet<string> = new Set([
  ACTOR_CLASS.SUPERVISED_AGENT,
  ACTOR_CLASS.AUTONOMOUS_AGENT,
  ACTOR_CLASS.SCHEDULED_AGENT,
  ACTOR_CLASS.DELEGATED_SUBAGENT,
  ACTOR_CLASS.SERVICE_AUTOMATION,
]);

function isAgentClass(actorClass: string): boolean {
  return AGENT_ACTOR_CLASSES.has(actorClass);
}

function toCapabilityEntry(actor: {
  actorId: Uuid;
  actorClass: string;
  environment: string;
  octLevel: string | null;
  allowedCapabilities?: string[];
  enabled?: boolean;
}): AgentCapabilityEntry {
  return {
    agentId: actor.actorId,
    actorClass: actor.actorClass as NonEmpty,
    capabilities: (actor.allowedCapabilities ?? []) as NonEmpty[],
    octTier: (actor.octLevel ?? 'OCT-OPEN') as NonEmpty,
    environment: actor.environment as NonEmpty,
    enabled: actor.enabled ?? true,
  };
}

/**
 * Projection-based AgentRegistryReader.
 * Reads from NXS ActorRegistry; returns only agent-class actors.
 */
export class ActorRegistryAgentReader implements AgentRegistryReader {
  constructor(private readonly actorRegistry: ActorRegistry) {}

  async findByCapability(capability: NonEmpty): Promise<AgentCapabilityEntry[]> {
    const all = await this.actorRegistry.list();
    return all
      .filter(a => isAgentClass(a.actorClass) && (a.enabled ?? true))
      .filter(a => (a.allowedCapabilities ?? []).includes(capability))
      .map(toCapabilityEntry);
  }

  async getById(agentId: Uuid): Promise<AgentCapabilityEntry | null> {
    const actor = await this.actorRegistry.get(agentId);
    if (!actor || !isAgentClass(actor.actorClass)) return null;
    return toCapabilityEntry(actor);
  }

  async listVisible(capabilityCeiling: NonEmpty[]): Promise<AgentCapabilityEntry[]> {
    const all = await this.actorRegistry.list();
    return all
      .filter(a => isAgentClass(a.actorClass) && (a.enabled ?? true))
      .filter(a => {
        // Agent is visible if at least one of its capabilities is within the ceiling.
        // Wildcard '*' in ceiling means all capabilities visible.
        if (capabilityCeiling.includes('*' as NonEmpty)) return true;
        const caps = a.allowedCapabilities ?? [];
        return caps.some(c => capabilityCeiling.includes(c as NonEmpty));
      })
      .map(toCapabilityEntry);
  }
}
