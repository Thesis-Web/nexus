/**
 * Operating Modes Manager — spec §9
 * Signed infrastructure configuration. Not agent-level.
 *
 * §9.1: Three modes (observe, advisory, enforcing)
 * §9.2: ModeConfiguration shape (signed)
 * §9.3: Mode change law (admin keypair, audit event, enforcing-lock)
 * §9.3.1: Infrastructure audit events via Run Ledger
 * §9.4: Enforcing-lock (multi-party disable)
 *
 * Layer 1 — imports from Layer 2 (contracts) + core crypto.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  ModeConfiguration,
  OperatingMode,
  RunLedgerWriter,
  RunEventType,
  // KeyPair imported from core crypto below
  Base64Url,
  NonEmpty,
  IsoTimestamp,
  Uuid,
} from '../types/index.js';
import type { KeyPair } from '../crypto/key-manager.js';
import { OPERATING_MODE, NEXUS_INFRA_NAMESPACE } from '../types/index.js';
import { nowIso } from '../utils/time.js';
import { sign } from '../crypto/signer.js';
import { verify } from '../crypto/verifier.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';

// ── Default mode config file path ────────────────────────────────────────────
const DEFAULT_MODE_CONFIG_PATH = path.join('keys', 'mode-config.json');

// ── §9.3.1: Deterministic infrastructure run ID ─────────────────────────────
export function getInfraRunId(): Uuid {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const hash = sha256(`${NEXUS_INFRA_NAMESPACE}:${today}`);
  const h = hash.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` as Uuid;
}

// ── §9.3.1: Infrastructure audit event emitter ──────────────────────────────
export async function emitInfrastructureAuditEvent(
  eventType: string,
  detail: Record<string, unknown>,
  runLedger: RunLedgerWriter
): Promise<void> {
  const infraRunId = getInfraRunId();
  await runLedger.writeEvent({
    runId: infraRunId,
    eventType: eventType as RunEventType,
    timestamp: nowIso(),
    actorId: null,
    detail,
  });
}

// ── §9.2: Load + verify mode config ─────────────────────────────────────────
export async function loadModeConfig(
  filepath: string = DEFAULT_MODE_CONFIG_PATH
): Promise<ModeConfiguration> {
  const raw = await fs.readFile(filepath, 'utf-8');
  const config = JSON.parse(raw) as ModeConfiguration;

  // Verify signature — §9.2: invalid signature prevents engine start
  const { signature, ...body } = config;
  const payload = canonicalize(body);
  const valid = await verify(payload, signature, config.updatedBy.publicKey);
  if (!valid) {
    throw new Error(
      'MODE_CONFIG_SIGNATURE_INVALID: mode configuration signature verification failed'
    );
  }

  return config;
}

// ── §9.2: Save mode config ──────────────────────────────────────────────────
export async function saveModeConfig(
  config: ModeConfiguration,
  filepath: string = DEFAULT_MODE_CONFIG_PATH
): Promise<void> {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, JSON.stringify(config, null, 2), 'utf-8');
}

// ── §9.3: Change mode ───────────────────────────────────────────────────────
export async function changeMode(
  engine: 'nxs' | 'nvg',
  newMode: OperatingMode,
  adminId: NonEmpty,
  adminKeypair: KeyPair,
  currentConfig: ModeConfiguration,
  runLedger: RunLedgerWriter
): Promise<ModeConfiguration> {
  // Validate mode value
  const validModes = Object.values(OPERATING_MODE);
  if (!(validModes as readonly string[]).includes(newMode)) {
    throw new Error(`INVALID_MODE: ${newMode} — must be one of ${validModes.join(', ')}`);
  }

  // Enforcing-lock check — §9.4
  if (currentConfig.enforcingLocked && newMode !== OPERATING_MODE.ENFORCING) {
    throw new Error('MODE_DOWNGRADE_BLOCKED: enforcing-lock is active');
  }

  const updated: ModeConfiguration = {
    ...currentConfig,
    [engine === 'nxs' ? 'nxsMode' : 'nvgMode']: newMode,
    updatedAt: nowIso() as IsoTimestamp,
    updatedBy: { adminId, publicKey: adminKeypair.publicKey as Base64Url },
    signature: '' as Base64Url, // placeholder
  };

  const { signature: _, ...body } = updated;
  updated.signature = await sign(canonicalize(body), adminKeypair);

  // §9.3.1: Mandatory infrastructure audit event
  await emitInfrastructureAuditEvent(
    'mode_change',
    { engine, newMode, updatedBy: updated.updatedBy, updatedAt: updated.updatedAt },
    runLedger
  );

  return updated;
}

// ── §9.4: Disable enforcing-lock (multi-party) ─────────────────────────────
// F4.17 / Q4 / HL #10 — `minRequired` is now floored at 2; any caller
// requesting a lower threshold throws at function entry. This blocks the
// retired single-admin dashboard unlock path (P0-023, P0-034).
export async function disableEnforcingLock(
  adminSignatures: Array<{ adminId: NonEmpty; signature: Base64Url }>,
  currentConfig: ModeConfiguration,
  primaryAdminId: NonEmpty,
  primaryAdminKeypair: KeyPair,
  runLedger: RunLedgerWriter,
  minRequired: number = 2,
  requestedAt: IsoTimestamp = nowIso() as IsoTimestamp // MODE-003 FIX: caller-provided for multi-party
): Promise<ModeConfiguration> {
  if (minRequired < 2) {
    throw new Error(
      'MULTI_PARTY_REQUIRED: minRequired must be ≥ 2 — single-admin dashboard unlock retired (F4.17 / Q4)'
    );
  }
  if (adminSignatures.length < minRequired) {
    throw new Error('MULTI_PARTY_REQUIRED: need ' + minRequired + ' admin signatures');
  }
  const distinctIds = new Set(adminSignatures.map(s => s.adminId));
  if (distinctIds.size < minRequired) {
    throw new Error('DUPLICATE_SIGNER: ' + minRequired + ' distinct admin signatures required');
  }

  // Verify each admin signature over canonical unlock-request payload
  // MODE-003 FIX: use caller-provided requestedAt so all parties sign the same payload
  const unlockPayload = canonicalize({
    action: 'disable_enforcing_lock',
    configSignature: currentConfig.signature,
    requestedAt,
  });
  for (const sig of adminSignatures) {
    const adminKey = await loadAdminPublicKey(sig.adminId);
    if (!adminKey) throw new Error('UNKNOWN_ADMIN: ' + sig.adminId);
    const valid = await verify(unlockPayload, sig.signature, adminKey);
    if (!valid) throw new Error('INVALID_ADMIN_SIGNATURE: ' + sig.adminId);
  }

  const updated: ModeConfiguration = {
    ...currentConfig,
    enforcingLocked: false,
    updatedAt: nowIso() as IsoTimestamp,
    updatedBy: { adminId: primaryAdminId, publicKey: primaryAdminKeypair.publicKey as Base64Url },
    signature: '' as Base64Url,
  };
  const { signature: _, ...body } = updated;
  updated.signature = await sign(canonicalize(body), primaryAdminKeypair);

  // §9.3.1: Mandatory infrastructure audit event
  await emitInfrastructureAuditEvent(
    'enforcing_lock_disabled',
    {
      adminSigners: adminSignatures.map(s => s.adminId),
      minRequired,
      disabledAt: updated.updatedAt,
    },
    runLedger
  );

  return updated;
}

// ── §9.4: Load admin public key from filesystem ─────────────────────────────
export async function loadAdminPublicKey(adminId: NonEmpty): Promise<Base64Url | null> {
  const keyPath = path.join('keys', 'admins', `${adminId}.public.json`);
  try {
    const raw = await fs.readFile(keyPath, 'utf-8');
    return JSON.parse(raw).publicKey;
  } catch {
    return null;
  }
}

// ── Create default mode config (observe/observe, unlocked) ──────────────────
export async function createDefaultModeConfig(
  adminId: NonEmpty,
  adminKeypair: KeyPair
): Promise<ModeConfiguration> {
  const config: ModeConfiguration = {
    nxsMode: OPERATING_MODE.OBSERVE,
    nvgMode: OPERATING_MODE.OBSERVE,
    enforcingLocked: false,
    updatedAt: nowIso() as IsoTimestamp,
    updatedBy: { adminId, publicKey: adminKeypair.publicKey as Base64Url },
    signature: '' as Base64Url,
  };
  const { signature: _, ...body } = config;
  config.signature = await sign(canonicalize(body), adminKeypair);
  return config;
}
