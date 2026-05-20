/**
 * SigningCouncil dispatchers — F4.1 §3.3 + F4.8 §3.3.
 *
 * Three factory builders, one per V1 federated operation that lands in
 * this patch (Phase B Patch 34). policy_bundle_replace lands in Patch
 * F4.2; until then SigningCouncil's missing-dispatcher path denies cleanly
 * with `no_dispatcher_for_operation:policy_bundle_replace`.
 *
 * Every dispatcher operates on a SigningRequest that the council has
 * already validated:
 *   - signatures.length >= getThreshold(operation)
 *   - signatures verified over canonical envelope
 *   - signers distinct
 *   - request not expired, payload immutable since open
 *
 * The dispatcher therefore TRUSTS the signer list. Re-verifying the
 * signatures against a different canonical form (e.g., the
 * disable_enforcing_lock envelope) would force dual-signing in two
 * envelopes, contradicting F4.1 §3.2.
 *
 * Layer: core (BAKED).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  Base64Url,
  LexiconMutation,
  LexiconMutationExecutor,
  ModeConfiguration,
  NonEmpty,
  RunLedgerWriter,
  SigningCouncilDispatcher,
  SigningRequest,
} from '@nexus/contracts';
import type { KeyPair } from '../crypto/key-manager.js';
import { applyDisableEnforcingLockTrusted } from '../modes/mode-manager.js';

// ─── F4.8 lexicon_mutation dispatcher ─────────────────────────────────────

/**
 * Build the lexicon_mutation dispatcher. Decodes the SigningRequest
 * payload as a LexiconMutation discriminated-union member, invokes
 * `executor.apply(mutation, signers)`. The executor is responsible for
 * appending the canonical JSONL line (Phase 1) or running the SQLite
 * insert (Phase 2 — same interface), and emitting
 * `lexicon_mutation_applied` with the full signer chain.
 *
 * On invalid payload kind: throws — SigningCouncil marks the request
 * denied with `dispatcher_failed`.
 */
export function buildLexiconMutationDispatcher(
  executor: LexiconMutationExecutor
): SigningCouncilDispatcher {
  return async (req: SigningRequest): Promise<void> => {
    const payload = req.payload as { mutation?: LexiconMutation };
    if (!payload || typeof payload !== 'object' || !payload.mutation) {
      throw new Error('LEXICON_DISPATCH_BAD_PAYLOAD: expected { mutation: LexiconMutation }');
    }
    const mutation = payload.mutation;
    if (!isValidLexiconMutationKind(mutation)) {
      throw new Error(
        'LEXICON_DISPATCH_UNKNOWN_KIND: ' +
          (typeof (mutation as { kind?: string }).kind === 'string'
            ? (mutation as { kind: string }).kind
            : 'undefined')
      );
    }
    const signers = req.signatures.map(s => s.principalId);
    await executor.apply(mutation, signers);
  };
}

const VALID_LEXICON_MUTATION_KINDS = new Set<string>([
  'entity_add',
  'entity_update',
  'entity_disable',
  'edge_add',
  'edge_update',
  'edge_disable',
  'confidence_set',
  'workflow_template_add',
  'workflow_template_update',
  'guard_add',
  'guard_update',
]);

function isValidLexiconMutationKind(mut: LexiconMutation): boolean {
  return VALID_LEXICON_MUTATION_KINDS.has(mut.kind);
}

// ─── F4.17 mode_unlock dispatcher ─────────────────────────────────────────

export interface ModeUnlockDispatcherDeps {
  readonly loadModeConfig: () => Promise<ModeConfiguration>;
  readonly saveModeConfig: (next: ModeConfiguration) => Promise<void>;
  readonly loadAdminKeypair: (adminId: NonEmpty) => Promise<KeyPair | null>;
  readonly runLedger: RunLedgerWriter;
}

/**
 * Build the mode_unlock dispatcher. The council has aggregated 2 distinct
 * admin signatures over `{requestId, 'mode_unlock', payloadDigest, openedAt}`;
 * this dispatcher applies `enforcingLocked=false` and signs the new
 * mode config with the request opener's keypair.
 *
 * The opener (request.openedBy) must have a keypair on disk; otherwise
 * the dispatcher throws and the council marks the request denied
 * (federated_operation_dispatch_failed).
 */
export function buildModeUnlockDispatcher(
  deps: ModeUnlockDispatcherDeps
): SigningCouncilDispatcher {
  return async (req: SigningRequest): Promise<void> => {
    const primaryAdminId = req.openedBy;
    const primaryKeypair = await deps.loadAdminKeypair(primaryAdminId);
    if (!primaryKeypair) {
      throw new Error('MODE_UNLOCK_DISPATCH_NO_OPENER_KEYPAIR: ' + primaryAdminId);
    }
    const currentConfig = await deps.loadModeConfig();
    if (!currentConfig.enforcingLocked) {
      throw new Error('MODE_UNLOCK_DISPATCH_NOT_LOCKED: enforcingLocked is already false');
    }
    const signers = req.signatures.map(s => s.principalId);
    const next = await applyDisableEnforcingLockTrusted(
      signers,
      currentConfig,
      primaryAdminId,
      primaryKeypair,
      deps.runLedger
    );
    await deps.saveModeConfig(next);
  };
}

// ─── F4.1 signing_council_change dispatcher ───────────────────────────────

/**
 * Payload shape for signing_council_change operations. Two action verbs:
 * - add_admin_key: registers a new admin signing public key at
 *   keys/admins/<principalId>.public.json. Idempotent IF the same
 *   publicKey is presented (overwrite); throws if a different key is
 *   already present for that principal (a key-rotation must dereg + reg).
 * - remove_admin_key: removes keys/admins/<principalId>.public.json.
 *
 * Bootstrap chicken-and-egg: the FIRST admin key must already exist on
 * disk (typically the dev keypair shipped in keys/admins/dev.public.json
 * for the portable build) before any signing_council_change request can
 * be opened. Subsequent additions/removals are 2-of-2 through the council.
 */
export interface SigningCouncilChangePayload {
  readonly action: 'add_admin_key' | 'remove_admin_key';
  readonly principalId: NonEmpty;
  readonly publicKey?: Base64Url;
}

export interface SigningCouncilChangeDispatcherDeps {
  readonly keyDirectory: string;
  readonly clock?: () => string;
}

export function buildSigningCouncilChangeDispatcher(
  deps: SigningCouncilChangeDispatcherDeps
): SigningCouncilDispatcher {
  return async (req: SigningRequest): Promise<void> => {
    const payload = req.payload as Partial<SigningCouncilChangePayload>;
    if (
      !payload ||
      (payload.action !== 'add_admin_key' && payload.action !== 'remove_admin_key') ||
      !payload.principalId ||
      typeof payload.principalId !== 'string'
    ) {
      throw new Error(
        'SIGNING_COUNCIL_CHANGE_BAD_PAYLOAD: expected { action, principalId, publicKey? }'
      );
    }
    const principalId = payload.principalId;
    const keyPath = path.join(deps.keyDirectory, 'admins', `${principalId}.public.json`);
    const now = deps.clock?.() ?? new Date().toISOString();
    if (payload.action === 'add_admin_key') {
      if (!payload.publicKey || typeof payload.publicKey !== 'string') {
        throw new Error('SIGNING_COUNCIL_CHANGE_MISSING_PUBLIC_KEY');
      }
      let prior: string | null = null;
      try {
        const raw = await fs.readFile(keyPath, 'utf-8');
        prior = (JSON.parse(raw) as { publicKey?: string }).publicKey ?? null;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      if (prior !== null && prior !== payload.publicKey) {
        throw new Error(
          'SIGNING_COUNCIL_CHANGE_KEY_ROTATION_FORBIDDEN: ' +
            'remove existing key before registering a different public key for ' +
            principalId
        );
      }
      await fs.mkdir(path.dirname(keyPath), { recursive: true });
      await fs.writeFile(
        keyPath,
        JSON.stringify({ principalId, publicKey: payload.publicKey, registeredAt: now }, null, 2),
        { encoding: 'utf-8', mode: 0o600 }
      );
    } else {
      // remove_admin_key
      try {
        await fs.unlink(keyPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        throw new Error(
          'SIGNING_COUNCIL_CHANGE_UNKNOWN_PRINCIPAL: ' +
            principalId +
            ' has no registered public key to remove'
        );
      }
    }
  };
}
