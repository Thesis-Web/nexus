/**
 * Reference Actor Store — spec §32.2
 * Layer 6 internal type. Not exported to contracts.
 * In-memory store for starter deployments.
 */
import type { Uuid, ActorClass, EnvironmentId, RiskTier, NonEmpty } from '@nexus/contracts';

export interface ReferenceActorRecord {
  actorId: Uuid;
  actorClass: ActorClass;
  principalId: Uuid;
  environment: EnvironmentId;
  riskCeiling: RiskTier;
  allowedSystems: string[];
  allowedCapabilities?: string[];
  roles?: string[];
  owner?: NonEmpty;
  purpose?: NonEmpty;
  reviewCadence?: NonEmpty;
}

export interface ReferenceActorStore {
  get(actorIdentifier: NonEmpty): Promise<ReferenceActorRecord | null>;
  register(record: ReferenceActorRecord): Promise<void>;
}

export class InMemoryActorStore implements ReferenceActorStore {
  private readonly actors = new Map<string, ReferenceActorRecord>();

  async get(actorIdentifier: NonEmpty): Promise<ReferenceActorRecord | null> {
    return this.actors.get(actorIdentifier) ?? null;
  }

  async register(record: ReferenceActorRecord): Promise<void> {
    this.actors.set(record.actorId, record);
  }
}
