// @vitest-environment jsdom
//
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §6.2 Commit 8 — PlanCheckbackModal
// component tests. Proves §3.7 Accept-Suggestions + Cancel-Run flow:
//   - Accept calls closeRun(source, 'user_accepted_checkback_reissued')
//     THEN createRun(...) with the correct re-issue body
//   - Cancel calls closeRun(source, 'user_cancelled_after_checkback')
//     THEN onDismiss
//   - Accept fails closed when closeRun fails — does NOT call createRun
//   - Disabled Accept button when recommendedSelectedAgentIds is empty
//   - Renders missing capabilities + alternatives table

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PlanCheckbackModal } from './plan-checkback-modal.js';
import type { PlannerCheckbackPayload } from './run-stage-reducer.js';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SOURCE_RUN_ID = '00000000-0000-4000-8000-0000000000c1';
const NEW_RUN_ID = '00000000-0000-4000-8000-0000000000c2';
const WAREHOUSE_AGENT_ID = '00000000-0000-4000-8000-0000000000a1';
const SALES_AGENT_ID = '00000000-0000-4000-8000-0000000000a2';

const REJECTION_PAYLOAD: PlannerCheckbackPayload = {
  reason: 'no_capable_agent',
  reasonDetail: 'preflight_preferred_agents_insufficient: update:record:internal',
  missingCapabilities: ['update:record:internal'],
  rejectedSelectedAgentIds: [SALES_AGENT_ID],
  recommendedSelectedAgentIds: [WAREHOUSE_AGENT_ID],
  alternativesByCapability: {
    'update:record:internal': [
      {
        agentId: WAREHOUSE_AGENT_ID,
        capability: 'update:record:internal',
        reason: 'warehouse-agent has update:record:internal',
      },
    ],
  },
};

const EMPTY_PAYLOAD: PlannerCheckbackPayload = {
  reason: 'no_capable_agent',
  reasonDetail: 'no usable alternatives',
  missingCapabilities: ['update:record:internal'],
  rejectedSelectedAgentIds: [SALES_AGENT_ID],
  recommendedSelectedAgentIds: [],
  alternativesByCapability: {
    'update:record:internal': [],
  },
};

describe('PlanCheckbackModal — render', () => {
  it('shows missing capabilities + suggested agents + Accept/Cancel buttons', () => {
    render(
      <PlanCheckbackModal
        sourceRunId={SOURCE_RUN_ID}
        payload={REJECTION_PAYLOAD}
        prompt="pull the warehouse inventory"
        preferredEndpointId={null}
        onDismiss={vi.fn()}
        onAccepted={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Preferred selection can't complete this run/)).toBeTruthy();
    expect(screen.getByText('update:record:internal')).toBeTruthy();
    expect(screen.getByText(WAREHOUSE_AGENT_ID)).toBeTruthy();
    expect(screen.getByRole('button', { name: /accept suggestions/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel run/i })).toBeTruthy();
  });

  it('disables Accept Suggestions when recommendedSelectedAgentIds is empty', () => {
    render(
      <PlanCheckbackModal
        sourceRunId={SOURCE_RUN_ID}
        payload={EMPTY_PAYLOAD}
        prompt="prompt"
        preferredEndpointId={null}
        onDismiss={vi.fn()}
        onAccepted={vi.fn()}
      />
    );
    const acceptBtn = screen.getByRole('button', { name: /accept suggestions/i });
    expect((acceptBtn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('PlanCheckbackModal — Accept Suggestions flow', () => {
  it('closes source run THEN creates a new run with corrected agents', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: true, data: { ok: true as const } });
    const createSpy = vi
      .spyOn(api, 'createRun')
      .mockResolvedValue({ ok: true, data: { runId: NEW_RUN_ID } });
    const onAccepted = vi.fn();

    render(
      <PlanCheckbackModal
        sourceRunId={SOURCE_RUN_ID}
        payload={REJECTION_PAYLOAD}
        prompt="pull the warehouse inventory"
        preferredEndpointId="qwen3.5-on-prem"
        onDismiss={vi.fn()}
        onAccepted={onAccepted}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /accept suggestions/i }));

    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));

    // closeRun fired first with the accept reason
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(SOURCE_RUN_ID, 'user_accepted_checkback_reissued');

    // createRun fired second with the corrected body
    const createArgs = createSpy.mock.calls[0]![0];
    expect(createArgs).toMatchObject({
      promptMode: 'free_text',
      prompt: 'pull the warehouse inventory',
      agents: [WAREHOUSE_AGENT_ID],
      checkbackSourceRunId: SOURCE_RUN_ID,
      preferredEndpointId: 'qwen3.5-on-prem',
    });

    // Parent informed of the new runId
    expect(onAccepted).toHaveBeenCalledWith(NEW_RUN_ID);
  });

  it('fails closed — does NOT call createRun when closeRun fails', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: false, error: 'close failed' });
    const createSpy = vi.spyOn(api, 'createRun').mockResolvedValue({
      ok: true,
      data: { runId: NEW_RUN_ID },
    });
    const onAccepted = vi.fn();

    render(
      <PlanCheckbackModal
        sourceRunId={SOURCE_RUN_ID}
        payload={REJECTION_PAYLOAD}
        prompt="prompt"
        preferredEndpointId={null}
        onDismiss={vi.fn()}
        onAccepted={onAccepted}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /accept suggestions/i }));

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    // Error surfaced to UI
    expect(screen.getByText(/close failed/i)).toBeTruthy();
  });
});

describe('PlanCheckbackModal — Cancel Run flow', () => {
  it('closes source run with cancel reason THEN dismisses', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: true, data: { ok: true as const } });
    const onDismiss = vi.fn();

    render(
      <PlanCheckbackModal
        sourceRunId={SOURCE_RUN_ID}
        payload={REJECTION_PAYLOAD}
        prompt="prompt"
        preferredEndpointId={null}
        onDismiss={onDismiss}
        onAccepted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel run/i }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(SOURCE_RUN_ID, 'user_cancelled_after_checkback');
  });

  it('dismisses anyway when closeRun fails (defense in depth)', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: false, error: 'transient network error' });
    const onDismiss = vi.fn();

    render(
      <PlanCheckbackModal
        sourceRunId={SOURCE_RUN_ID}
        payload={REJECTION_PAYLOAD}
        prompt="prompt"
        preferredEndpointId={null}
        onDismiss={onDismiss}
        onAccepted={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel run/i }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // Error from API surfaced (mock returned 'transient network error');
    // modal still dismissed (onDismiss called) per defense-in-depth.
    expect(screen.getByText(/transient network error/i)).toBeTruthy();
  });
});
