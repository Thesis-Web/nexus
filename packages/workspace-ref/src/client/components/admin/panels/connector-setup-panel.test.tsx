// @vitest-environment jsdom
//
// CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §3 — ConnectorSetupPanel tests.
// Three real behaviors covered:
//   1. Real surface data renders into the connector table.
//   2. Add form rejects wildcard ('*') in allowedSystems with a clear
//      error message before any network call is made.
//   3. Without elevatedSessionId the writer surface stays disabled.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConnectorSetupPanel } from './connector-setup-panel.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';

// Hoisted mock so the panel's import of admin-writer-api hits a vi.fn we
// can interrogate from each test. addConnector / removeConnector /
// updateConnector are the three exports the panel touches.
const addConnectorMock = vi.fn();
const removeConnectorMock = vi.fn();
const updateConnectorMock = vi.fn();
vi.mock('../../../admin-writer-api.js', () => ({
  addConnector: (...args: unknown[]) => addConnectorMock(...args),
  removeConnector: (...args: unknown[]) => removeConnectorMock(...args),
  updateConnector: (...args: unknown[]) => updateConnectorMock(...args),
}));

afterEach(() => {
  cleanup();
  addConnectorMock.mockReset();
  removeConnectorMock.mockReset();
  updateConnectorMock.mockReset();
});

beforeEach(() => {
  // Default: addConnector + updateConnector resolve successfully.
  addConnectorMock.mockResolvedValue({ ok: true, data: {} });
  updateConnectorMock.mockResolvedValue({ ok: true, data: {} });
});

const REAL_SURFACE: DashboardSurfaceStatus = {
  surfaceId: 'connectors_targets',
  title: 'Connectors & Target Systems',
  category: 'connectors_targets',
  state: 'configured',
  sourcePaths: ['config/connectors/connectors.v1.yaml'],
  currentConfiguredValue: {
    entries: [
      {
        connectorId: 'stub',
        connectorType: 'stub',
        allowedSystems: ['stub'],
        configuration: {},
        enabled: true,
      },
      {
        connectorId: 'vault',
        connectorType: 'vault',
        allowedSystems: ['vault'],
        configuration: {},
        enabled: false,
      },
    ],
  },
  secretFields: [],
  blockers: [],
  evidence: [],
  allowedActions: ['view', 'mutate_available'],
};

describe('ConnectorSetupPanel', () => {
  it('renders the connector table from real surface data', () => {
    render(<ConnectorSetupPanel data={REAL_SURFACE} elevatedSessionId="elev-1" />);

    // Both manifest entries appear in the rendered output. Each id /
    // type may show in multiple places (the table cell and the read
    // form for the selected row), so use getAllByText to assert
    // presence without uniqueness.
    expect(screen.getAllByText('stub').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('vault').length).toBeGreaterThanOrEqual(1);
    // The enabled column renders an explicit ✓/✗ glyph derived from the
    // boolean — proves the new column from Phase B threads through.
    expect(screen.getAllByText(/✓ enabled/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/✗ disabled/i).length).toBeGreaterThanOrEqual(1);
  });

  it('rejects wildcard in allowedSystems before calling the API', () => {
    render(<ConnectorSetupPanel data={REAL_SURFACE} elevatedSessionId="elev-1" />);

    // Open the add form.
    fireEvent.click(screen.getByRole('button', { name: /\+ add connector/i }));

    // Fill required fields and put a wildcard in allowedSystems.
    fireEvent.change(screen.getByLabelText(/connector id/i), {
      target: { value: 'newone' },
    });
    fireEvent.change(screen.getByLabelText(/connector type/i), {
      target: { value: 'newtype' },
    });
    fireEvent.change(screen.getByLabelText(/allowed systems/i), {
      target: { value: '*' },
    });

    // Click save.
    fireEvent.click(screen.getByRole('button', { name: /save connector/i }));

    // The wildcard guard fires BEFORE the API call.
    expect(addConnectorMock).not.toHaveBeenCalled();
    // A wildcard-rejection feedback message is rendered.
    expect(screen.getByText(/wildcards.*not allowed/i)).toBeDefined();
  });

  it('disables the writer surface when no elevated session is supplied', () => {
    render(<ConnectorSetupPanel data={REAL_SURFACE} />);

    // The "+ Add connector" control is rendered as a disabled button when
    // elevatedSessionId is absent.
    const addButtons = screen.getAllByRole('button', { name: /\+ add connector/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(1);
    const disabled = addButtons.find(b => (b as HTMLButtonElement).disabled);
    expect(disabled).toBeDefined();
  });

  it('renders reported capabilities for the selected connector', () => {
    // CLAUDE-CODE-ADMIN-PANELS-PHASE-D §1b — capabilities thread from
    // the runtime connector via composeConnectorsSurface. Stub here is
    // a representative value; the real bootstrap call uses
    // `new StubConnector().supportedCapabilities()`.
    const surface: DashboardSurfaceStatus = {
      ...REAL_SURFACE,
      currentConfiguredValue: {
        entries: [
          {
            connectorId: 'stub',
            connectorType: 'stub',
            allowedSystems: ['stub'],
            configuration: {},
            enabled: true,
            capabilities: ['execute', 'preview', 'health'],
          },
        ],
      },
    };
    render(<ConnectorSetupPanel data={surface} elevatedSessionId="elev-1" />);
    expect(screen.getByText(/Reported capabilities/i)).toBeDefined();
    expect(screen.getByText('execute')).toBeDefined();
    expect(screen.getByText('preview')).toBeDefined();
    expect(screen.getByText('health')).toBeDefined();
  });

  it('disable button calls updateConnector with { enabled: false }', async () => {
    render(<ConnectorSetupPanel data={REAL_SURFACE} elevatedSessionId="elev-1" />);

    // The first entry (stub, enabled=true) is auto-selected, so the
    // toggle button reads "Disable connector".
    const disableBtn = screen.getByRole('button', { name: /disable connector/i });
    fireEvent.click(disableBtn);

    // Wait for the awaited fetch to settle. We resolve the mock
    // synchronously above, so a single microtask flush suffices.
    await Promise.resolve();

    expect(updateConnectorMock).toHaveBeenCalledTimes(1);
    expect(updateConnectorMock).toHaveBeenCalledWith('elev-1', 'stub', { enabled: false });
  });
});
