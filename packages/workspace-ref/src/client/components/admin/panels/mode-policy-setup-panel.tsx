// packages/workspace-ref/src/client/components/admin/panels/mode-policy-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 — Modes / Policy / OCT surface.
// HANDOFF-CLAUDE-B §6.1 surface #9 — submit DISABLED, CLI-only per OR-DASH-007.
//
// Renders current mode posture as a non-editable read view. Selection radios
// are present (observe / advise / deny) for visual completeness but they are
// disabled; a banner directs operators to the CLI command.

import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminDisabledMutationBanner } from '../admin-disabled-mutation-banner.js';
import {
  MODES_POLICY_OCT_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
}

const MODE_OPTIONS = ['observe', 'advise', 'deny'] as const;

export function ModePolicySetupPanel({ data }: Props) {
  const surface = data ?? MODES_POLICY_OCT_PLACEHOLDER;
  const cv = surface.currentConfiguredValue;
  const nxsMode = String(cv['nxsMode'] ?? '(unknown)');
  const nvgMode = String(cv['nvgMode'] ?? '(unknown)');

  return (
    <PanelChrome surface={surface}>
      <AdminDisabledMutationBanner reason="Mode change is CLI-only in Beta1. Run `nexus mode set <observe|advise|deny>` (OR-DASH-007). Future signed HTTP route requires admin-key law (not ratified)." />

      <div className="nx-admin-panel__form">
        <h3>Current mode posture</h3>
        <div className="nx-admin-mode-radios">
          <fieldset disabled aria-disabled="true">
            <legend>NXS mode</legend>
            {MODE_OPTIONS.map(opt => (
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
            {MODE_OPTIONS.map(opt => (
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

        <h3>Configured policy view</h3>
        <AdminManifestReadForm
          entry={cv}
          title="Mode + policy + OCT defaults"
          secretFields={surface.secretFields}
          saveLabel="Apply mode (CLI-only)"
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>
    </PanelChrome>
  );
}
