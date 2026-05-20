/**
 * OCT Manager — spec §11.3
 * OCT assignment with signed operator verification and mandatory Run Ledger audit event.
 *
 * Layer 1 — imports from Layer 2 (contracts) + core identity/crypto.
 *
 * OCT-003 FIX: Full signed operator action verification per owner ruling HOLE-S3-001.
 * - Operator keys are infrastructure admin keys at keys/admins/<operatorId>.public.json
 * - Self-assignment guard: actor cannot assign own OCT
 * - Signature verified over canonical payload
 * - oct_assignment for new, oct_change for update — previousOctLevel must match
 */
import {
  OCT_LEVEL,
  OCT_RANK,
  type Uuid,
  type OctLevel,
  type NonEmpty,
  type IsoTimestamp,
  type Base64Url,
  type ActorRegistry,
  type RunLedgerWriter,
  type SignedOctAssignmentRequest,
} from '../types/index.js';
import { nowIso } from '../utils/time.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { verify } from '../crypto/verifier.js';
import { sha256 } from '../crypto/signer.js';
import { loadAdminPublicKey, emitInfrastructureAuditEvent } from '../modes/mode-manager.js';

/**
 * Signed OCT assignment/change request — HOLE-S3-001 approved shape.
 * Type now lives in @nexus/contracts (F4.5); re-exported here for callers
 * that imported from this module historically.
 */
export type { SignedOctAssignmentRequest } from '../types/index.js';

/**
 * §11.3: Assign or change OCT level for an actor.
 * Validates signed operator action, updates actor registry, emits mandatory audit event.
 * An actor cannot request its own OCT assignment or change.
 */
export async function assignOct(
  request: SignedOctAssignmentRequest,
  actorRegistry: ActorRegistry,
  runLedger: RunLedgerWriter
): Promise<void> {
  const {
    action,
    actorId,
    previousOctLevel,
    newOctLevel,
    operatorId,
    requestedAt,
    reason,
    signature,
  } = request;

  // 1. Validate OCT level is in governed set
  const validLevels = Object.values(OCT_LEVEL);
  if (!(validLevels as readonly string[]).includes(newOctLevel)) {
    throw new Error(`INVALID_OCT_LEVEL: ${newOctLevel} — must be one of ${validLevels.join(', ')}`);
  }

  // 2. Self-assignment guard — §11.3: actor cannot request own OCT
  if (operatorId === actorId) {
    throw new Error(
      `OCT_SELF_ASSIGNMENT: actor ${actorId} cannot assign or change its own OCT level`
    );
  }

  // 3. Load operator public key from keys/admins/<operatorId>.public.json
  const operatorPubKey = await loadAdminPublicKey(operatorId);
  if (!operatorPubKey) {
    throw new Error(`OCT_UNKNOWN_OPERATOR: no public key found for operator ${operatorId}`);
  }

  // 4. Verify signature over canonical payload (requestedAt is caller-provided, not generated here)
  const payload = canonicalize({
    action,
    actorId,
    previousOctLevel,
    newOctLevel,
    operatorId,
    requestedAt,
    reason,
  });
  const valid = await verify(payload, signature, operatorPubKey);
  if (!valid) {
    throw new Error(`OCT_INVALID_SIGNATURE: operator ${operatorId} signature verification failed`);
  }

  // 5. Verify actor exists
  const actor = await actorRegistry.get(actorId);
  if (!actor) {
    throw new Error(`ACTOR_NOT_FOUND: ${actorId}`);
  }

  // 6. Validate action type against current state
  if (action === 'oct_assignment' && actor.octLevel !== null && actor.octLevel !== undefined) {
    // Actor already has OCT — require oct_change action
    throw new Error(
      `OCT_ALREADY_ASSIGNED: actor ${actorId} already has OCT ${actor.octLevel} — use oct_change`
    );
  }
  if (action === 'oct_change') {
    if (previousOctLevel !== actor.octLevel) {
      throw new Error(
        `OCT_PREVIOUS_MISMATCH: expected ${actor.octLevel}, request says ${previousOctLevel}`
      );
    }
    // F4.5 §2.1 / Q2 / HL #10 — assignOct accepts only strictly-higher
    // rank changes. Downward equivalents are deregister-then-register-new
    // (§3.3); equal-rank changes are no-ops and rejected (OCT-UI-04).
    if (previousOctLevel === null || newOctLevel === null) {
      throw new Error('OCT_NULL_LEVEL: oct_change requires non-null previous and new levels');
    }
    const prevRank = OCT_RANK[previousOctLevel];
    const nextRank = OCT_RANK[newOctLevel];
    if (prevRank === undefined || nextRank === undefined) {
      throw new Error(
        `OCT_UNRANKED_LEVEL: ${previousOctLevel} or ${newOctLevel} is not in the principal-data rank`
      );
    }
    if (nextRank <= prevRank) {
      throw new Error(
        `OCT_DOWNWARD_OR_EQUAL_FORBIDDEN: rank[${newOctLevel}]=${nextRank} must exceed rank[${previousOctLevel}]=${prevRank}; lower via deregister-then-register-new`
      );
    }
  }

  // 7. Update actor registry
  await actorRegistry.updateOct(actorId, newOctLevel);

  // 8. Mandatory Run Ledger audit event — §11.3
  await emitInfrastructureAuditEvent(
    action,
    {
      actorId,
      previousOctLevel,
      newOctLevel,
      operatorId,
      requestedAt,
      reason,
      signatureHash: sha256(signature),
    },
    runLedger
  );
}
