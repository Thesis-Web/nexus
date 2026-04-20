/**
 * CLI mode commands — spec §22.1
 * nexus mode show — show current operating modes
 * nexus mode set — set operating mode (requires admin key)
 */
import {
  loadModeConfig,
  saveModeConfig,
  changeMode,
  createDefaultModeConfig,
  loadControlPlaneKey,
  JsonlRunLedgerWriter,
  nowIso,
} from '@nexus/core';
import type { OperatingMode, NonEmpty } from '@nexus/core';
import * as path from 'path';

const MODE_CONFIG_PATH = path.join('keys', 'mode-config.json');
const RUN_LEDGER_PATH = path.join('runs', 'infra.run-ledger.jsonl');

export async function cmdModeShow(): Promise<void> {
  try {
    const config = await loadModeConfig(MODE_CONFIG_PATH);
    console.log(`NXS mode:         ${config.nxsMode}`);
    console.log(`NVG mode:         ${config.nvgMode}`);
    console.log(`Enforcing-locked: ${config.enforcingLocked}`);
    console.log(`Updated at:       ${config.updatedAt}`);
    console.log(`Updated by:       ${config.updatedBy.adminId}`);
  } catch {
    console.log('No mode configuration found. Run nexus init to create one.');
    console.log('Default: observe / observe / unlocked');
  }
}

export async function cmdModeSet(opts: { engine: string; mode: string }): Promise<void> {
  const engine = opts.engine as 'nxs' | 'nvg';
  if (engine !== 'nxs' && engine !== 'nvg') {
    console.error('✗ --engine must be nxs or nvg');
    process.exit(1);
  }
  const newMode = opts.mode as OperatingMode;

  const adminKeypair = await loadControlPlaneKey();
  const adminId = 'dev-admin' as NonEmpty;
  const runLedger = new JsonlRunLedgerWriter(RUN_LEDGER_PATH);

  let currentConfig;
  try {
    currentConfig = await loadModeConfig(MODE_CONFIG_PATH);
  } catch {
    // No config exists — create default first
    currentConfig = await createDefaultModeConfig(adminId, adminKeypair);
    await saveModeConfig(currentConfig, MODE_CONFIG_PATH);
  }

  const updated = await changeMode(
    engine,
    newMode,
    adminId,
    adminKeypair,
    currentConfig,
    runLedger
  );
  await saveModeConfig(updated, MODE_CONFIG_PATH);

  console.log(`✓ ${engine} mode set to ${newMode}`);
  console.log(`  Enforcing-locked: ${updated.enforcingLocked}`);
  console.log(`  Updated at:       ${updated.updatedAt}`);
}
