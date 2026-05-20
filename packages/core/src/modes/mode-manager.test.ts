/**
 * Mode Manager Tests — spec §9, §38
 *
 * Covers: createDefaultModeConfig, loadModeConfig, saveModeConfig,
 * changeMode, disableEnforcingLock, getInfraRunId, emitInfrastructureAuditEvent
 *
 * Uses loadControlPlaneKey() — never generateControlPlaneKeypair().
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createDefaultModeConfig,
  loadModeConfig,
  saveModeConfig,
  changeMode,
  disableEnforcingLock,
  getInfraRunId,
  emitInfrastructureAuditEvent,
} from './mode-manager.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';
import { OPERATING_MODE } from '../types/index.js';
import type { KeyPair } from '../crypto/key-manager.js';
import type { NonEmpty, Base64Url, ModeConfiguration } from '../types/index.js';

// ── Mock RunLedgerWriter ─────────────────────────────────────────────────────
interface CapturedEvent {
  runId: string;
  eventType: string;
  timestamp: string;
  actorId: string | null;
  detail: Record<string, unknown>;
}

class MockRunLedgerWriter {
  events: CapturedEvent[] = [];
  async writeEvent(event: CapturedEvent): Promise<void> {
    this.events.push(event);
  }
}

describe('Mode Manager — spec §9', () => {
  let keypair: KeyPair;
  let tmpDir: string;
  const adminId = 'test-admin' as NonEmpty;

  beforeAll(async () => {
    keypair = await loadControlPlaneKey();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-mode-test-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── §9.2: createDefaultModeConfig ──────────────────────────────────────────

  it('createDefaultModeConfig returns observe/observe unlocked with valid signature', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    expect(config.nxsMode).toBe(OPERATING_MODE.OBSERVE);
    expect(config.nvgMode).toBe(OPERATING_MODE.OBSERVE);
    expect(config.enforcingLocked).toBe(false);
    expect(config.updatedBy.adminId).toBe(adminId);
    expect(config.updatedBy.publicKey).toBe(keypair.publicKey);
    expect(config.signature).toBeTruthy();
    expect(typeof config.updatedAt).toBe('string');
  });

  // ── §9.2: save + load roundtrip with signature validation ─────────────────

  it('saveModeConfig + loadModeConfig roundtrip preserves config', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const filepath = path.join(tmpDir, 'roundtrip.json');
    await saveModeConfig(config, filepath);
    const loaded = await loadModeConfig(filepath);
    expect(loaded.nxsMode).toBe(config.nxsMode);
    expect(loaded.nvgMode).toBe(config.nvgMode);
    expect(loaded.enforcingLocked).toBe(config.enforcingLocked);
    expect(loaded.signature).toBe(config.signature);
  });

  // ── §9.2: invalid signature prevents load ─────────────────────────────────

  it('loadModeConfig throws on tampered config', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const tampered = { ...config, nxsMode: OPERATING_MODE.ENFORCING };
    const filepath = path.join(tmpDir, 'tampered.json');
    await fs.writeFile(filepath, JSON.stringify(tampered, null, 2), 'utf-8');
    await expect(loadModeConfig(filepath)).rejects.toThrow('MODE_CONFIG_SIGNATURE_INVALID');
  });

  // ── §9.2: missing file throws ─────────────────────────────────────────────

  it('loadModeConfig throws on missing file', async () => {
    const filepath = path.join(tmpDir, 'nonexistent.json');
    await expect(loadModeConfig(filepath)).rejects.toThrow();
  });

  // ── §9.3: changeMode happy path ───────────────────────────────────────────

  it('changeMode updates engine mode and re-signs', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const ledger = new MockRunLedgerWriter();
    const updated = await changeMode(
      'nxs',
      OPERATING_MODE.ENFORCING,
      adminId,
      keypair,
      config,
      ledger as any
    );
    expect(updated.nxsMode).toBe(OPERATING_MODE.ENFORCING);
    expect(updated.nvgMode).toBe(OPERATING_MODE.OBSERVE);
    expect(updated.signature).not.toBe(config.signature);
    // Verify re-signed config can roundtrip (signature valid)
    const filepath = path.join(tmpDir, 'changed.json');
    await saveModeConfig(updated, filepath);
    const reloaded = await loadModeConfig(filepath);
    expect(reloaded.nxsMode).toBe(OPERATING_MODE.ENFORCING);
  });

  // ── §9.4: enforcing-lock blocks downgrade ─────────────────────────────────

  it('changeMode throws when enforcing-lock blocks downgrade', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const lockedConfig: ModeConfiguration = {
      ...config,
      enforcingLocked: true,
      signature: config.signature, // stale sig but enforcing-lock check is pre-sig
    };
    const ledger = new MockRunLedgerWriter();
    await expect(
      changeMode('nxs', OPERATING_MODE.OBSERVE, adminId, keypair, lockedConfig, ledger as any)
    ).rejects.toThrow('MODE_DOWNGRADE_BLOCKED');
  });

  // ── §9.3: invalid mode value ──────────────────────────────────────────────

  it('changeMode throws on invalid mode value', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const ledger = new MockRunLedgerWriter();
    await expect(
      changeMode('nxs', 'invalid-mode', adminId, keypair, config, ledger as any)
    ).rejects.toThrow('INVALID_MODE');
  });

  // ── §9.4: insufficient signatures ─────────────────────────────────────────

  it('disableEnforcingLock throws when insufficient admin signatures', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const ledger = new MockRunLedgerWriter();
    await expect(
      disableEnforcingLock(
        [{ adminId: 'admin-1' as NonEmpty, signature: 'fake' as Base64Url }],
        config,
        adminId,
        keypair,
        ledger as any,
        2
      )
    ).rejects.toThrow('MULTI_PARTY_REQUIRED');
  });

  // F4.17 / Q4 — single-admin dashboard unlock is retired. Any caller that
  // tries to pass minRequired=1 fails at function entry; tests assert the
  // override path is gone (ELM-01).
  it('disableEnforcingLock rejects minRequired < 2 (F4.17 ELM-01)', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const ledger = new MockRunLedgerWriter();
    await expect(
      disableEnforcingLock(
        [{ adminId: 'admin-1' as NonEmpty, signature: 'fake' as Base64Url }],
        config,
        adminId,
        keypair,
        ledger as any,
        1 // retired single-admin path
      )
    ).rejects.toThrow('MULTI_PARTY_REQUIRED: minRequired must be ≥ 2');
  });

  // F4.17 — duplicate signers from the same admin do not meet the
  // distinct-signer requirement (ELM-03).
  it('disableEnforcingLock rejects duplicate signers (F4.17 ELM-03)', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const ledger = new MockRunLedgerWriter();
    await expect(
      disableEnforcingLock(
        [
          { adminId: 'admin-1' as NonEmpty, signature: 'sig-a' as Base64Url },
          { adminId: 'admin-1' as NonEmpty, signature: 'sig-b' as Base64Url },
        ],
        config,
        adminId,
        keypair,
        ledger as any,
        2
      )
    ).rejects.toThrow('DUPLICATE_SIGNER');
  });

  // ── §9.3.1: getInfraRunId deterministic ───────────────────────────────────

  it('getInfraRunId returns deterministic UUID for same day', () => {
    const id1 = getInfraRunId();
    const id2 = getInfraRunId();
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // ── §9.3.1: emitInfrastructureAuditEvent writes to run ledger ─────────────

  it('emitInfrastructureAuditEvent writes event to run ledger', async () => {
    const ledger = new MockRunLedgerWriter();
    await emitInfrastructureAuditEvent('test_event', { foo: 'bar' }, ledger as any);
    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0]!;
    expect(event.eventType).toBe('test_event');
    expect(event.detail).toEqual({ foo: 'bar' });
    expect(event.runId).toBe(getInfraRunId());
    expect(event.actorId).toBeNull();
  });

  // ── §9.3: changeMode emits mandatory audit event ──────────────────────────

  it('changeMode emits mode_change infrastructure audit event', async () => {
    const config = await createDefaultModeConfig(adminId, keypair);
    const ledger = new MockRunLedgerWriter();
    await changeMode('nvg', OPERATING_MODE.ADVISORY, adminId, keypair, config, ledger as any);
    expect(ledger.events).toHaveLength(1);
    const event = ledger.events[0]!;
    expect(event.eventType).toBe('mode_change');
    expect(event.detail).toHaveProperty('engine', 'nvg');
    expect(event.detail).toHaveProperty('newMode', OPERATING_MODE.ADVISORY);
  });
});
