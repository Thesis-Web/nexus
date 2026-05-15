// packages/workspace-ref/src/client/components/admin/panels/mode-policy-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.6 — Modes / Policy / OCT.
// Server-side signed envelope: the browser NEVER holds the signing key
// (feedback_signing_keys_server_side memory). The elevated admin clicks
// a radio; the server loads keys/admins/<principalId>.keypair.json,
// signs the envelope via changeMode(), writes mode-config.json, and
// emits the mode_change event to the run ledger.

import { useEffect, useState } from 'react';
import { MODES_POLICY_OCT_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import {
  getModeState,
  setMode,
  unlockEnforcing,
  type ModeStateResponse,
} from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  onCatalogReload?: () => void;
}

const NXS_MODE_OPTIONS = ['observe', 'advisory', 'enforcing'] as const;
const NVG_MODE_OPTIONS = ['observe', 'advisory', 'enforcing'] as const;
type ModeValue = (typeof NXS_MODE_OPTIONS)[number];

interface NxsPolicySummaryView {
  bundleId: string;
  version: string;
  issuer: string;
  defaultOutcome: string;
  ruleCount: number;
  outcomeCounts: Record<string, number>;
}

function isPolicySummary(v: unknown): v is NxsPolicySummaryView {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o['bundleId'] === 'string' &&
    typeof o['version'] === 'string' &&
    typeof o['ruleCount'] === 'number'
  );
}

export function ModePolicySetupPanel({ data, elevatedSessionId, onCatalogReload }: Props) {
  const surface = data ?? MODES_POLICY_OCT_PLACEHOLDER;
  const cv = surface.currentConfiguredValue;
  const policySummary = isPolicySummary(cv['nxsPolicySummary']) ? cv['nxsPolicySummary'] : null;
  const surfaceSigningKeypairPresent = cv['signingKeypairPresent'] === true;

  const [modeState, setModeState] = useState<ModeStateResponse | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const canWrite = !!elevatedSessionId;

  useEffect(() => {
    if (!elevatedSessionId) return;
    void (async () => {
      const res = await getModeState(elevatedSessionId);
      if (res.ok && res.data) setModeState(res.data);
    })();
  }, [elevatedSessionId]);

  async function refreshState() {
    if (!elevatedSessionId) return;
    const res = await getModeState(elevatedSessionId);
    if (res.ok && res.data) setModeState(res.data);
  }

  const liveCfg = modeState?.currentConfig;
  const liveSigningKeypairPresent =
    modeState?.signingKeypairPresent ?? surfaceSigningKeypairPresent;
  const nxsMode = liveCfg?.nxsMode ?? (String(cv['nxsMode'] ?? '(unknown)') as string);
  const nvgMode = liveCfg?.nvgMode ?? (String(cv['nvgMode'] ?? '(unknown)') as string);
  const enforcingLocked = liveCfg?.enforcingLocked ?? cv['enforcingLocked'] === true;
  const updatedAt =
    liveCfg?.updatedAt ?? (typeof cv['updatedAt'] === 'string' ? cv['updatedAt'] : null);
  const updatedBy =
    liveCfg?.updatedBy?.adminId ?? (typeof cv['updatedBy'] === 'string' ? cv['updatedBy'] : null);

  const formActive = canWrite && liveSigningKeypairPresent;

  async function handleModeChange(engine: 'nxs' | 'nvg', mode: ModeValue) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await setMode(elevatedSessionId, engine, mode);
    setBusy(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: `${engine.toUpperCase()} mode set to ${mode}.` });
      await refreshState();
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to change mode' });
    }
  }

  async function handleUnlock() {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await unlockEnforcing(elevatedSessionId);
    setBusy(false);
    setUnlockModalOpen(false);
    if (res.ok) {
      setFeedback({ type: 'success', msg: 'Enforcing-lock disabled.' });
      await refreshState();
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to unlock enforcing' });
    }
  }

  return (
    <PanelChrome surface={surface}>
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}

      <div className="nx-admin-panel__form">
        <h3>Current mode posture</h3>

        {!liveSigningKeypairPresent && (
          <div className="nx-admin-mode-cli">
            <h4>Admin signing keypair missing</h4>
            <p>
              Mode changes require an Ed25519-signed admin command. The server signs on your behalf
              using <code>keys/admins/&lt;principalId&gt;.keypair.json</code>. Provision your
              keypair via <em>Toolchain &amp; Keys → Upload key (admin-signing)</em>, or run:
            </p>
            <pre>nexus init</pre>
          </div>
        )}

        <div className="nx-admin-mode-radios">
          <fieldset disabled={!formActive || busy}>
            <legend>NXS mode</legend>
            {NXS_MODE_OPTIONS.map(opt => (
              <label key={opt} className="nx-admin-mode-radio">
                <input
                  type="radio"
                  name="nxsMode"
                  value={opt}
                  checked={nxsMode === opt}
                  onChange={() => void handleModeChange('nxs', opt)}
                  disabled={!formActive || busy}
                />
                {opt}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={!formActive || busy}>
            <legend>NVG mode</legend>
            {NVG_MODE_OPTIONS.map(opt => (
              <label key={opt} className="nx-admin-mode-radio">
                <input
                  type="radio"
                  name="nvgMode"
                  value={opt}
                  checked={nvgMode === opt}
                  onChange={() => void handleModeChange('nvg', opt)}
                  disabled={!formActive || busy}
                />
                {opt}
              </label>
            ))}
          </fieldset>
        </div>

        {updatedAt || updatedBy ? (
          <p className="nx-admin-mode-meta">
            Last changed: {updatedAt ?? '(unknown)'} by {updatedBy ?? '(unknown)'}
          </p>
        ) : null}

        <div className="nx-admin-mode-cli">
          <h4>Enforcing-lock</h4>
          {enforcingLocked ? (
            <>
              <p>
                <strong>🔒 locked.</strong> Downgrading NXS/NVG out of enforcing requires unlocking
                first. The dashboard unlock is single-admin (signed server-side).
              </p>
              {formActive && (
                <button type="button" disabled={busy} onClick={() => setUnlockModalOpen(true)}>
                  Unlock enforcing
                </button>
              )}
            </>
          ) : (
            <p>🔓 Enforcing-lock not active.</p>
          )}
        </div>

        {unlockModalOpen && (
          <div className="nx-admin-mode-cli">
            <h4>Confirm unlock</h4>
            <p>
              This will allow downgrading NXS/NVG out of enforcing mode. The action is signed
              server-side and logged to the run ledger as <code>enforcing_lock_disabled</code>.
            </p>
            <div>
              <button type="button" disabled={busy} onClick={handleUnlock}>
                {busy ? 'Unlocking…' : 'Confirm unlock'}
              </button>
              <button type="button" onClick={() => setUnlockModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {policySummary ? (
          <div className="nx-admin-policy-summary" data-testid="policy-summary">
            <h4>NXS Policy</h4>
            <dl>
              <dt>Bundle:</dt>
              <dd>{policySummary.bundleId}</dd>
              <dt>Version:</dt>
              <dd>{policySummary.version}</dd>
              <dt>Issuer:</dt>
              <dd>{policySummary.issuer}</dd>
              <dt>Default outcome:</dt>
              <dd>{policySummary.defaultOutcome}</dd>
              <dt>Rules:</dt>
              <dd>
                {policySummary.ruleCount}
                {Object.keys(policySummary.outcomeCounts).length > 0 ? (
                  <>
                    {' ('}
                    {Object.entries(policySummary.outcomeCounts)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(', ')}
                    {')'}
                  </>
                ) : null}
              </dd>
            </dl>
          </div>
        ) : null}
      </div>
    </PanelChrome>
  );
}
