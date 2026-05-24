// @vitest-environment jsdom
//
// PlannerSuggestionCard tests — HL#4 + fix-spec post-consolidation 2026-05-23
// §4 + DRIFT-LOG D-02. Covers the no-checkback-payload fallback for the
// planner_infeasible event.
//
// Owner ratification 2026-05-23 second round: Edit Prompt and Retry was
// pulled as a prompt-rewrite bypass surface. The card now offers a single
// Cancel Run affordance. "Run it anyway" / bypass orch is logged at
// DRIFT-LOG D-03 pending contract + RBAC + audit-event design.
//
// Three behaviors:
//   1. Render the canonical reason + reasonDetail with the "Orch suggests"
//      framing (NOT "Plan failed" / "Request Denied") and a single
//      Cancel Run button.
//   2. Cancel Run calls closeRun(source, 'user_cancelled_after_checkback')
//      then resolves with null.
//   3. Server failure surfaces through the alert region without trapping
//      the operator (resolves regardless of API outcome).

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PlannerSuggestionCard } from './planner-suggestion-card.js';
import * as api from '../api.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SOURCE_RUN_ID = '00000000-0000-4000-8000-0000000000d1';

describe('PlannerSuggestionCard — render', () => {
  it('renders the "Orch suggests" framing with reason + reasonDetail and a single Cancel Run button', () => {
    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason="no_capable_agent"
        reasonDetail="No agent in the workspace has the required compose:email capability"
        onResolved={vi.fn()}
      />
    );

    // "Orch suggests" — load-bearing framing per the owner correction. NOT
    // "Plan failed" / "Request Denied" — those imply orch decided to fail
    // the run, which HL#4 explicitly forbids. The phrase appears twice (in
    // the badge and in the summary copy), so we scope to the region label.
    const region = screen.getByRole('region', { name: /orch suggestion/i });
    expect(region).toBeTruthy();
    expect(screen.getAllByText(/orch suggests/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('no_capable_agent')).toBeTruthy();
    expect(
      screen.getByText(/No agent in the workspace has the required compose:email capability/)
    ).toBeTruthy();

    // Cancel Run is the only affordance. Edit Prompt and Retry was pulled
    // (security: prompt-rewrite bypass surface) — verify it's gone.
    expect(screen.getByRole('button', { name: /cancel run/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /edit prompt and retry/i })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('falls back to "planner_infeasible" when reason is the empty string', () => {
    render(
      <PlannerSuggestionCard
        sourceRunId={SOURCE_RUN_ID}
        reason=""
        reasonDetail=""
        onResolved={vi.fn()}
      />
    );
    expect(screen.getByText('planner_infeasible')).toBeTruthy();
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
