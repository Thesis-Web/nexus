/**
 * Mode Runtime — MODE-001 fix
 * Runtime mode resolver/decision boundary.
 *
 * Spec §9.1: "In all three modes, every decision is fully evaluated and logged
 * as if Enforcing. Mode controls whether the decision is acted upon — not
 * whether it is recorded."
 *
 * Blueprint §9.1: "Mode is signed infrastructure configuration. It is not an
 * agent-level setting and cannot be changed by agents, adapters, or any
 * interface that agents use."
 *
 * This module is pure functions. No side effects. No file I/O. No imports
 * beyond Layer 2 contracts.
 *
 * Layer 1 — imports from Layer 2 (contracts) only.
 */
import {
  OPERATING_MODE,
  type OperatingMode,
  type ModeConfiguration,
  type RuntimeDisposition,
} from '../types/index.js';

/**
 * Resolve the active operating mode for an engine from signed config.
 * Returns the mode string. Does NOT validate the config signature —
 * that's mode-manager.ts loadModeConfig() responsibility at startup.
 */
export function getRuntimeMode(
  modeConfig: ModeConfiguration,
  engine: 'nxs' | 'nvg'
): OperatingMode {
  return engine === 'nxs' ? modeConfig.nxsMode : modeConfig.nvgMode;
}

/**
 * Determine whether the pipeline should enforce decisions (run Gates 05/06)
 * or only evaluate and log (skip Gates 05/06, go straight to Gate 07).
 *
 * In observe and advisory modes, all gates 01-04 still evaluate identically.
 * Gate 07 still writes evidence identically. The ONLY difference is whether
 * the enforcement branch (Gates 05/06) executes.
 */
export function shouldEnforce(mode: OperatingMode): boolean {
  return mode === OPERATING_MODE.ENFORCING;
}

/**
 * Map an operating mode to the runtime disposition that callers use
 * to decide their response behavior.
 *
 * - enforcing → 'enforce' (block on deny, route approvals, execute actions)
 * - observe → 'observe' (log everything, never block, never execute)
 * - advisory → 'advisory' (log everything, return decision for caller)
 * - unknown mode → 'enforce' (fail closed — unknown mode does not weaken posture)
 */
export function resolveDisposition(mode: OperatingMode): RuntimeDisposition {
  switch (mode) {
    case OPERATING_MODE.OBSERVE:
      return 'observe';
    case OPERATING_MODE.ADVISORY:
      return 'advisory';
    case OPERATING_MODE.ENFORCING:
      return 'enforce';
    default:
      // Unknown mode fails closed — never weaken enforcement posture
      return 'enforce';
  }
}
