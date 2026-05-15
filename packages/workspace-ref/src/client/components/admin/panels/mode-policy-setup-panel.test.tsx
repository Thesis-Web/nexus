// @vitest-environment jsdom
//
// AMEND-nexus-admin-dashboard-full-buildout §3.6 — ModePolicySetupPanel tests.
// The panel is writer-enabled with server-side signed envelope. Without an
// elevated session, radios stay disabled. With an elevated session AND a
// provisioned admin signing keypair, radios become live and a click POSTs
// to /workspace/admin/setup/mode.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModePolicySetupPanel } from './mode-policy-setup-panel.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    signingKeypairPresent: false,
  },
  secretFields: [],
  blockers: [],
  evidence: [],
  allowedActions: ['view'],
};

describe('ModePolicySetupPanel', () => {
  it('renders NXS=observe and NVG=enforcing with correct radio selection', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    const checkedValues = radios
      .filter(r => r.checked)
      .map(r => r.value)
      .sort();
    expect(checkedValues).toEqual(['enforcing', 'observe']);
  });

  it('disables all radios when elevatedSessionId is absent', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.length).toBeGreaterThan(0);
    for (const r of radios) {
      expect(r.disabled).toBe(true);
    }
  });

  it('shows the "admin signing keypair missing" fallback when keypair is absent', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    expect(document.body.textContent).toMatch(/Admin signing keypair missing/i);
    expect(document.body.textContent).toMatch(/nexus init/);
  });

  it('hides the keypair-missing fallback when signingKeypairPresent is true', () => {
    const withKey: DashboardSurfaceStatus = {
      ...BASE_SURFACE,
      currentConfiguredValue: {
        ...BASE_SURFACE.currentConfiguredValue,
        signingKeypairPresent: true,
      },
    };
    render(<ModePolicySetupPanel data={withKey} />);
    expect(document.body.textContent).not.toMatch(/Admin signing keypair missing/i);
  });

  it('surfaces "Enforcing-lock not active" when unlocked', () => {
    render(<ModePolicySetupPanel data={BASE_SURFACE} />);
    expect(screen.getByText(/Enforcing-lock not active/i)).toBeDefined();
  });

  it('surfaces locked indicator when enforcingLocked=true', () => {
    const locked: DashboardSurfaceStatus = {
      ...BASE_SURFACE,
      currentConfiguredValue: {
        ...BASE_SURFACE.currentConfiguredValue,
        enforcingLocked: true,
      },
    };
    render(<ModePolicySetupPanel data={locked} />);
    expect(document.body.textContent).toMatch(/locked/i);
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
