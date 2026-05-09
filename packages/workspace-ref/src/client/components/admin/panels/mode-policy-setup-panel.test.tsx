// @vitest-environment jsdom
//
// CLAUDE-CODE-ADMIN-PANELS-PHASE-D §4 — ModePolicySetupPanel tests.
// The panel is read-only by design (§9.3 — mode changes require an
// Ed25519-signed admin command via CLI). Tests assert:
//   - current NXS / NVG modes render with correct radio selection
//   - ALL radios are disabled — no clickable mode change
//   - enforcing-lock state surfaces explicitly
//   - CLI command block is present and lists every (engine, mode) pair
//   - policy summary renders bundle / version / outcome counts when
//     the surface carries it; otherwise hides cleanly

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModePolicySetupPanel } from './mode-policy-setup-panel.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';

afterEach(cleanup);

const BASE_SURFACE: DashboardSurfaceStatus = {
  surfaceId: 'modes_policy_oct',
  title: 'Modes / OCT / Policy',
  category: 'modes_policy_oct',
  state: 'configured',
  sourcePaths: [],
  currentConfiguredValue: {
    nxsMode: 'observe',
    nvgMode: 'enforcing',
    enforcingLocked: false,
    updatedAt: '2026-05-09T12:00:00.000Z',
    updatedBy: 'nexus-control-plane',
    nxsPolicySummary: null,
  },
  secretFields: [],
  blockers: [],
  evidence: [],
  allowedActions: ['view'],
};

describe('ModePolicySetupPanel', () => {
  it('renders NXS=observe and NVG=enforcing with correct radio selection', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    // Both engines render their own radio set with shared values, so
    // assert via the checked state across all radios. The selected
    // values must be the union {NXS=observe, NVG=enforcing}.
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const checkedValues = radios
      .filter(r => r.checked)
      .map(r => r.value)
      .sort();
    expect(checkedValues).toEqual(['enforcing', 'observe']);

    // Also assert the radio belongs to the correct fieldset.
    const nxsObserve = radios.find(r => r.name === 'nxsMode' && r.value === 'observe');
    const nvgEnforcing = radios.find(r => r.name === 'nvgMode' && r.value === 'enforcing');
    expect(nxsObserve?.checked).toBe(true);
    expect(nvgEnforcing?.checked).toBe(true);
  });

  it('disables ALL radios — no dashboard mode change is allowed', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.length).toBeGreaterThan(0);
    for (const r of radios) {
      expect(r.disabled).toBe(true);
    }
  });

  it('shows the CLI command block with both engine commands', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/nexus mode set --engine nxs --mode/);
    expect(text).toMatch(/nexus mode set --engine nvg --mode/);
  });

  it('surfaces "enforcing-lock active" with unlock command when locked', () => {
    const locked: DashboardSurfaceStatus = {
      ...BASE_SURFACE,
      currentConfiguredValue: {
        ...BASE_SURFACE.currentConfiguredValue,
        enforcingLocked: true,
      },
    };
    render(<ModePolicySetupPanel data={locked} />);
    expect(screen.getByText(/Enforcing-lock active/i)).toBeDefined();
    expect(document.body.textContent).toMatch(/nexus mode unlock/);
  });

  it('surfaces "enforcing-lock not active" when unlocked', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    expect(screen.getByText(/Enforcing-lock not active/i)).toBeDefined();
  });

  it('renders policy summary when surface carries it', () => {
    const withPolicy: DashboardSurfaceStatus = {
      ...BASE_SURFACE,
      currentConfiguredValue: {
        ...BASE_SURFACE.currentConfiguredValue,
        nxsPolicySummary: {
          bundleId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          version: 'v0.1.0-dev',
          issuer: 'nexus-dev',
          defaultOutcome: 'deny',
          ruleCount: 6,
          outcomeCounts: { allow: 3, require_approval: 2, escalate: 1 },
        },
      },
    };
    render(<ModePolicySetupPanel data={withPolicy} />);
    const summary = screen.getByTestId('policy-summary');
    expect(summary.textContent).toContain('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(summary.textContent).toContain('v0.1.0-dev');
    expect(summary.textContent).toContain('deny');
    expect(summary.textContent).toMatch(/6.*3 allow.*2 require_approval.*1 escalate/);
  });

  it('hides policy summary when surface does not carry one', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    expect(screen.queryByTestId('policy-summary')).toBeNull();
  });
});
