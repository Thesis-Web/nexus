/**
 * SigningCouncil dispatchers — F4.1 §3.3 + F4.8 §3.3 + F4.2 §3.2.
 *
 * Four factory builders, one per V1 federated operation. Phase B Patch
 * 34 wired lexicon_mutation / mode_unlock / signing_council_change;
 * Patch 35 (this file's policy_bundle_replace addition) closes the
 * fourth and final V1 dispatcher binding.
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
  PolicyFile,
  RunLedgerWriter,
  SigningCouncilDispatcher,
  SigningRequest,
} from '@nexus/contracts';
import type { KeyPair } from '../crypto/key-manager.js';
import {
  applyDisableEnforcingLockTrusted,
  emitInfrastructureAuditEvent,
} from '../modes/mode-manager.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sign } from '../crypto/signer.js';
import { sha256 } from '../crypto/signer.js';

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
  // ── Fourth-layer (AMEND-nexus-lexicon-arena-evidence-layer-v0-1-0 §6.1)
  'path_profile_add',
  'path_profile_update',
  'path_profile_disable',
  'path_evidence_add',
  'path_contradiction_add',
  'path_contradiction_resolve',
  'path_requirement_add',
  'path_requirement_update',
  'checkback_template_add',
  'checkback_template_update',
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

// ─── F4.2 policy_bundle_replace dispatcher ────────────────────────────────

/**
 * Payload for `policy_bundle_replace` SigningRequest. The author submits
 * the full PolicyFile *body* (no signature field); the dispatcher
 * validates the OCT axis is non-empty on every condition, signs the
 * canonical form with the control-plane keypair, and writes the signed
 * bundle to disk. The next `loadPolicyBundleSet()` call picks up the
 * new bundle.
 */
export interface PolicyBundleReplacePayload {
  /** The PolicyFile body to install (signature is computed by the dispatcher). */
  readonly bundle: Omit<PolicyFile, 'signature'>;
  /** Filesystem path where the signed bundle should be persisted. */
  readonly targetPath: NonEmpty;
}

export interface PolicyBundleReplaceDispatcherDeps {
  readonly controlPlaneKeypair: KeyPair;
  readonly runLedger: RunLedgerWriter;
  /** Override the fs root (for tests). Defaults to cwd-relative paths. */
  readonly fsRoot?: string;
  readonly clock?: () => string;
}

export function buildPolicyBundleReplaceDispatcher(
  deps: PolicyBundleReplaceDispatcherDeps
): SigningCouncilDispatcher {
  return async (req: SigningRequest): Promise<void> => {
    const payload = req.payload as Partial<PolicyBundleReplacePayload>;
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.targetPath !== 'string' ||
      payload.targetPath.length === 0 ||
      !payload.bundle ||
      typeof payload.bundle !== 'object'
    ) {
      throw new Error(
        'POLICY_BUNDLE_REPLACE_BAD_PAYLOAD: expected { bundle: PolicyFile-body, targetPath: string }'
      );
    }
    const bundle = payload.bundle;
    if (!Array.isArray(bundle.rules)) {
      throw new Error('POLICY_BUNDLE_REPLACE_BAD_BUNDLE: rules[] missing');
    }

    // F4.2 §3.2 — validate every condition's `octLevels` is a non-empty
    // array of strings. Empty / missing / wrong-shape rejects the entire
    // bundle (default-secure — partial-application is never permitted).
    bundle.rules.forEach((rule, idx) => {
      const cond = rule?.conditions as unknown;
      if (!cond || typeof cond !== 'object') {
        throw new Error(
          `POLICY_BUNDLE_REPLACE_INVALID_RULE: rule ${idx} (ruleId='${
            rule?.ruleId ?? '<none>'
          }') missing conditions`
        );
      }
      const octLevels = (cond as { octLevels?: unknown }).octLevels;
      if (!Array.isArray(octLevels) || octLevels.length === 0) {
        throw new Error(
          `POLICY_BUNDLE_REPLACE_EMPTY_OCT_LEVELS: rule ${idx} (ruleId='${
            rule?.ruleId ?? '<none>'
          }') must declare a non-empty octLevels list (F4.2 / Q3 / HL #13)`
        );
      }
      for (const level of octLevels) {
        if (typeof level !== 'string' || level.length === 0) {
          throw new Error(
            `POLICY_BUNDLE_REPLACE_INVALID_OCT_LEVEL: rule ${idx} octLevels carries a non-string entry`
          );
        }
      }
    });

    // Sign the canonical bundle body with the control-plane keypair.
    const signature = (await sign(canonicalize(bundle), deps.controlPlaneKeypair)) as Base64Url;
    const signedFile: PolicyFile = { ...(bundle as PolicyFile), signature };
    const json = JSON.stringify(signedFile, null, 2) + '\n';

    const fsRoot = deps.fsRoot ?? process.cwd();
    const targetPath = path.isAbsolute(payload.targetPath)
      ? payload.targetPath
      : path.join(fsRoot, payload.targetPath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, json, 'utf-8');

    // Domain-specific audit event — pairs with the council's generic
    // federated_operation_executed event via requestId. Detail carries
    // the bundle hash (digest of the canonical body) so audit can
    // verify integrity without storing the bundle inline.
    const bundleHash = sha256(canonicalize(bundle));
    await emitInfrastructureAuditEvent(
      'policy_bundle_replaced',
      {
        requestId: req.requestId,
        targetPath: payload.targetPath,
        bundleId: bundle.bundleId ?? null,
        bundleVersion: bundle.bundleVersion ?? null,
        bundleHash,
        ruleCount: bundle.rules.length,
        signers: req.signatures.map(s => s.principalId),
        appliedAt: deps.clock?.() ?? new Date().toISOString(),
      },
      deps.runLedger
    );
  };
}
