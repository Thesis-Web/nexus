// packages/workspace-ref/src/client/components/admin/panels/mode-policy-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Modes / Policy / OCT surface.
// HANDOFF-CLAUDE-B §6.1 surface #9 — submit DISABLED, CLI-only per OR-DASH-007.
// CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3 — improved CLI-instruction display
// + NXS policy summary surfaced from admin-setup-status.
//
// Mode mutation MUST stay CLI-only per spec §9.3 — mode changes require
// Ed25519-signed admin commands. The radios show current state and stay
// disabled; the panel surfaces the CLI invocation operators need to run.

import { AdminDisabledMutationBanner } from '../admin-disabled-mutation-banner.js';
import { MODES_POLICY_OCT_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

const NXS_MODE_OPTIONS = ['observe', 'advisory', 'enforcing'] as const;
const NVG_MODE_OPTIONS = ['observe', 'advisory', 'enforcing'] as const;

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

export function ModePolicySetupPanel({ data }: Props) {
  const surface = data ?? MODES_POLICY_OCT_PLACEHOLDER;
  const cv = surface.currentConfiguredValue;
  const nxsMode = String(cv['nxsMode'] ?? '(unknown)');
  const nvgMode = String(cv['nvgMode'] ?? '(unknown)');
  const enforcingLocked = cv['enforcingLocked'] === true;
  const updatedAt = typeof cv['updatedAt'] === 'string' ? (cv['updatedAt'] as string) : null;
  const updatedBy = typeof cv['updatedBy'] === 'string' ? (cv['updatedBy'] as string) : null;
  const policySummary = isPolicySummary(cv['nxsPolicySummary']) ? cv['nxsPolicySummary'] : null;

  return (
    <PanelChrome surface={surface}>
      <AdminDisabledMutationBanner reason="Mode change is CLI-only per §9.3. The /mode HTTP route returns 501 by design — mode changes require an Ed25519-signed admin command, not a dashboard click." />

      <div className="nx-admin-panel__form">
        <h3>Current mode posture</h3>
        <div className="nx-admin-mode-radios">
          <fieldset disabled aria-disabled="true">
            <legend>NXS mode</legend>
            {NXS_MODE_OPTIONS.map(opt => (
              <label key={opt} className="nx-admin-mode-radio">
                <input
                  type="radio"
                  name="nxsMode"
                  value={opt}
                  checked={nxsMode === opt}
                  readOnly
                  disabled
                />
                {opt}
              </label>
            ))}
          </fieldset>
          <fieldset disabled aria-disabled="true">
            <legend>NVG mode</legend>
            {NVG_MODE_OPTIONS.map(opt => (
              <label key={opt} className="nx-admin-mode-radio">
                <input
                  type="radio"
                  name="nvgMode"
                  value={opt}
                  checked={nvgMode === opt}
                  readOnly
                  disabled
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

        {/* CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3b — explicit CLI command
            block. The HTTP /mode POST stays 501 forever (§9.3); this is
            where operators learn what to type. Lock indicator surfaces
            the enforcing-lock state so an operator who tried to flip
            from enforcing can see why nothing happened. */}
        <div className="nx-admin-mode-cli">
          <h4>Change mode (CLI-only)</h4>
          <p>Mode mutations require a signed admin command. Use the management CLI:</p>
          <pre>
            {`nexus mode set --engine nxs --mode observe
nexus mode set --engine nxs --mode advisory
nexus mode set --engine nxs --mode enforcing

nexus mode set --engine nvg --mode observe
nexus mode set --engine nvg --mode advisory
nexus mode set --engine nvg --mode enforcing`}
          </pre>
          {enforcingLocked ? (
            <div className="nx-admin-mode-cli-lock">
              <strong>🔒 Enforcing-lock active.</strong> Downgrading from enforcing requires
              unlocking first:
              <pre>nexus mode unlock --confirm</pre>
            </div>
          ) : (
            <p className="nx-admin-mode-meta">🔓 Enforcing-lock not active.</p>
          )}
        </div>

        {/* CLAUDE-CODE-ADMIN-PANELS-PHASE-D §3c — NXS policy summary.
            Bundle id + version are public; rule outcomes aggregate as
            counts so operators see what the engine is enforcing without
            opening the JSON file. Hidden when bootstrap couldn't load
            the policy (the surface state already shows that as
            'partial'). */}
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
