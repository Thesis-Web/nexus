/**
 * OCT Manager — spec §11.3
 * OCT assignment with mandatory Run Ledger audit event.
 *
 * Layer 1 — imports from Layer 2 (contracts) + core identity.
 */
import {
  OCT_LEVEL,
  type Uuid,
  type OctLevel,
  type NonEmpty,
  type ActorRegistry,
  type RunLedgerWriter,
} from '../types/index.js';
import { nowIso } from '../utils/time.js';
import { emitInfrastructureAuditEvent } from '../modes/mode-manager.js';

/**
 * §11.3: Assign OCT level to an actor.
 * Validates OCT level, updates actor registry, emits mandatory audit event.
 * An actor cannot request its own OCT assignment.
 */
export async function assignOct(
  actorId: Uuid,
  octLevel: OctLevel,
  operatorId: NonEmpty,
  actorRegistry: ActorRegistry,
  runLedger: RunLedgerWriter
): Promise<void> {
  // Validate OCT level is in governed set
  const validLevels = Object.values(OCT_LEVEL);
  if (!(validLevels as readonly string[]).includes(octLevel)) {
    throw new Error(`INVALID_OCT_LEVEL: ${octLevel} — must be one of ${validLevels.join(', ')}`);
  }

  // OCT-003 FIX: §11.3 — an actor cannot request its own OCT assignment or change
  if (operatorId === actorId) {
    throw new Error(
      `OCT_SELF_ASSIGNMENT: actor ${actorId} cannot assign or change its own OCT level`
    );
  }

  // Verify actor exists
  const actor = await actorRegistry.get(actorId);
  if (!actor) {
    throw new Error(`ACTOR_NOT_FOUND: ${actorId}`);
  }

  // Update actor registry
  await actorRegistry.updateOct(actorId, octLevel);

  // §11.3: Mandatory audit event
  await emitInfrastructureAuditEvent(
    'oct_assignment',
    { actorId, octLevel, operatorId, previousOctLevel: actor.octLevel },
    runLedger
  );
}
