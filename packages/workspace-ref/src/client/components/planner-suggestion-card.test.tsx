// @vitest-environment jsdom
//
// PlannerSuggestionCard tests — HL#4 + fix-spec post-consolidation 2026-05-23
// §4 + DRIFT-LOG D-02. Covers the no-checkback-payload fallback for the
// planner_infeasible event. Five behaviors:
//
//   1. Renders the canonical reason + reasonDetail with the "Orch suggests"
//      framing (NOT "Plan failed" / "Request Denied") and the two-button
//      view-mode affordances.
//   2. Cancel Run calls closeRun(source, 'user_cancelled_after_checkback')
//      then resolves with null (no new runId).
//   3. Edit Prompt and Retry switches the card into edit mode with a
//      textarea pre-populated with the originating prompt.
//   4. Submit New Run closes the source run with the cancel reason FIRST
//      THEN creates the retry run; resolves with the new runId. Failure of
//      the close path fail-closes and does NOT call createRun.
//   5. Surfaces server errors via the alert region without trapping the
//      operator (resolves on cancel regardless of API outcome).

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PlannerSuggestionCard } from './planner-suggestion-card.js';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SOURCE_RUN_ID = '00000000-0000-4000-8000-0000000000d1';
const NEW_RUN_ID = '00000000-0000-4000-8000-0000000000d2';

describe('PlannerSuggestionCard — render', () => {
  it('renders the "Orch suggests" framing with reason + reasonDetail and Cancel/Edit buttons', () => {
    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="no_capable_agent"
        reasonDetail="No agent in the workspace has the required compose:email capability"
        prompt="Send a status note to ops@example.test"
        preferredEndpointId={null}
        onResolved={vi.fn()}
      />
    );

    // "Orch suggests" — load-bearing framing per the owner correction. NOT
    // "Plan failed" / "Request Denied" — those imply orch decided to fail
    // the run, which HL#4 explicitly forbids. The phrase appears twice (in
    // the badge and in the summary copy), so we scope to the region label
    // and assert both occurrences are present.
    const region = screen.getByRole('region', { name: /orch suggestion/i });
    expect(region).toBeTruthy();
    expect(screen.getAllByText(/orch suggests/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('no_capable_agent')).toBeTruthy();
    expect(
      screen.getByText(/No agent in the workspace has the required compose:email capability/)
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel run/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit prompt and retry/i })).toBeTruthy();
  });
});

describe('PlannerSuggestionCard — Cancel Run flow', () => {
  it('calls closeRun with the cancel reason and resolves with null', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: true, data: { ok: true as const } });
    const onResolved = vi.fn();

    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="malformed_request"
        reasonDetail="plan validation failed"
        prompt="something garbled"
        preferredEndpointId={null}
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel run/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(SOURCE_RUN_ID, 'user_cancelled_after_checkback');
    expect(onResolved).toHaveBeenCalledWith(null);
  });

  it('resolves even when closeRun fails (operator must not be trapped)', async () => {
    vi.spyOn(api, 'closeRun').mockResolvedValue({ ok: false, error: 'simulated 500' });
    const onResolved = vi.fn();

    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="no_capable_agent"
        reasonDetail=""
        prompt="prompt"
        preferredEndpointId={null}
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel run/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
    // The card surfaces the server error in its alert region but still
    // resolves so the failing run doesn't pin the operator into a dead UI.
    expect(screen.getByRole('alert').textContent).toMatch(/simulated 500/);
  });
});

describe('PlannerSuggestionCard — Edit Prompt and Retry flow', () => {
  it('switches into edit mode with the textarea pre-populated', () => {
    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="no_capable_agent"
        reasonDetail=""
        prompt="original prompt text"
        preferredEndpointId={null}
        onResolved={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit prompt and retry/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.value).toBe('original prompt text');
    expect(screen.getByRole('button', { name: /submit new run/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^back$/i })).toBeTruthy();
  });

  it('closes the source run THEN issues the retry, resolving with the new runId', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: true, data: { ok: true as const } });
    const createSpy = vi
      .spyOn(api, 'createRun')
      .mockResolvedValue({ ok: true, data: { runId: NEW_RUN_ID } });
    const onResolved = vi.fn();

    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="no_capable_agent"
        reasonDetail=""
        prompt="original"
        preferredEndpointId="frontier-gpt"
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit prompt and retry/i }));
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'reframed prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /submit new run/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));

    // Close first, create second. Fail-closed on close → no create — but
    // here both succeed, so we assert order + arguments.
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledWith(SOURCE_RUN_ID, 'user_cancelled_after_checkback');
    expect(createSpy).toHaveBeenCalledTimes(1);
    const createArgs = createSpy.mock.calls[0]![0];
    expect(createArgs).toMatchObject({
      promptMode: 'free_text',
      prompt: 'reframed prompt',
      checkbackSourceRunId: SOURCE_RUN_ID,
      preferredEndpointId: 'frontier-gpt',
    });
    expect(onResolved).toHaveBeenCalledWith(NEW_RUN_ID);
  });

  it('does NOT issue the retry when closing the source run fails', async () => {
    const closeSpy = vi
      .spyOn(api, 'closeRun')
      .mockResolvedValue({ ok: false, error: 'close failed' });
    const createSpy = vi.spyOn(api, 'createRun');
    const onResolved = vi.fn();

    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="no_capable_agent"
        reasonDetail=""
        prompt="original"
        preferredEndpointId={null}
        onResolved={onResolved}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit prompt and retry/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit new run/i }));

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(createSpy).not.toHaveBeenCalled();
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/close failed/);
  });
});
