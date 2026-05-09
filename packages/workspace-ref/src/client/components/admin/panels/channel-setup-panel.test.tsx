// @vitest-environment jsdom
//
// CLAUDE-CODE-ADMIN-PANELS-PHASE-D §4 — ChannelSetupPanel tests.
// Verifies the panel:
//   - renders the CLI channel from real surface data
//   - falls back to the placeholder when no data is supplied
//   - surfaces CLI approval instructions when the CLI channel is selected
//   - surfaces the enabled column

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ChannelSetupPanel } from './channel-setup-panel.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';

afterEach(cleanup);

const REAL_SURFACE: DashboardSurfaceStatus = {
  surfaceId: 'channels_approval',
  title: 'Approval Channels',
  category: 'channels_approval',
  state: 'configured',
  sourcePaths: ['config/channels/channels.v1.yaml'],
  currentConfiguredValue: {
    entries: [
      {
        channelId: 'cli',
        channelType: 'cli',
        configuration: {},
        enabled: true,
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [],
  allowedActions: ['view'],
};

describe('ChannelSetupPanel', () => {
  it('renders the CLI channel from real surface data', () => {
    render(<ChannelSetupPanel data={REAL_SURFACE} />);
    // 'cli' appears in both the channelId column and the channelType
    // column — assert presence rather than uniqueness.
    expect(screen.getAllByText('cli').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/✓ enabled/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows CLI approval instructions when the CLI channel is selected', () => {
    render(<ChannelSetupPanel data={REAL_SURFACE} />);
    // The CLI channel is the only entry, so it's auto-selected.
    const cliBlock = screen.getByTestId('cli-channel-instructions');
    expect(cliBlock).toBeDefined();
    // The block names the actual CLI commands operators run.
    expect(cliBlock.textContent).toMatch(/nexus approve/);
    expect(cliBlock.textContent).toMatch(/nexus deny/);
  });

  it('falls back to the placeholder surface when no data is provided', () => {
    // Without `data`, the panel uses CHANNELS_PLACEHOLDER. The test
    // only asserts that something renders — the placeholder content
    // shape is allowed to evolve, but the panel must not blow up.
    expect(() => render(<ChannelSetupPanel />)).not.toThrow();
  });

  it('omits CLI instruction block for non-CLI channels', () => {
    const surface: DashboardSurfaceStatus = {
      ...REAL_SURFACE,
      currentConfiguredValue: {
        entries: [
          {
            channelId: 'webhook-1',
            channelType: 'webhook',
            configuration: {},
            enabled: true,
          },
        ],
      },
    };
    render(<ChannelSetupPanel data={surface} />);
    expect(screen.queryByTestId('cli-channel-instructions')).toBeNull();
  });
});
