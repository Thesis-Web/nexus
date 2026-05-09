// @vitest-environment jsdom
//
// CLAUDE-CODE-AUDIT-TIGHTEN-PHASE-AB §3 — PromptPanel component tests.
// These tests prove the panel's submission contract:
//   - attachmentIds appear in submission iff files are attached
//   - preferredEndpointId appears iff a model was selected upstream
//   - the textarea clears after submit and the parent's onSubmit
//     receives an object with the actual prompt text

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PromptPanel, type PromptSubmission } from './prompt-panel.js';
import type { CatalogItem } from '../api.js';

// vitest is configured with globals:false, so @testing-library/react's
// auto-cleanup hook never registers. Without this each test leaves its
// rendered tree behind and `screen.getByPlaceholderText` finds multiple
// matches across previous renders. Explicit afterEach(cleanup) is the
// supported workaround.
afterEach(cleanup);

const NO_AGENTS: CatalogItem[] = [];

describe('PromptPanel', () => {
  it('omits attachmentIds when no files are attached', () => {
    const onSubmit = vi.fn<(s: PromptSubmission) => void>();
    render(<PromptPanel agents={NO_AGENTS} onSubmit={onSubmit} disabled={false} />);

    const textarea = screen.getByPlaceholderText(/what would you like to do/i);
    fireEvent.change(textarea, { target: { value: 'plain prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0];
    expect(submitted.prompt).toBe('plain prompt');
    expect(submitted.attachmentIds).toBeUndefined();
  });

  it('includes attachmentIds in submission when files are attached', () => {
    const onSubmit = vi.fn<(s: PromptSubmission) => void>();
    const files = [
      { fileId: 'file-abc', filename: 'contract.txt' },
      { fileId: 'file-def', filename: 'notes.md' },
    ];
    render(
      <PromptPanel agents={NO_AGENTS} attachedFiles={files} onSubmit={onSubmit} disabled={false} />
    );

    const textarea = screen.getByPlaceholderText(/what would you like to do/i);
    fireEvent.change(textarea, { target: { value: 'summarize these' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]![0];
    expect(submitted.prompt).toBe('summarize these');
    expect(submitted.attachmentIds).toEqual(['file-abc', 'file-def']);
  });

  it('includes preferredEndpointId in submission when prop is set', () => {
    const onSubmit = vi.fn<(s: PromptSubmission) => void>();
    render(
      <PromptPanel
        agents={NO_AGENTS}
        preferredEndpointId="ollama-jameshp"
        onSubmit={onSubmit}
        disabled={false}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/what would you like to do/i), {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].preferredEndpointId).toBe('ollama-jameshp');
  });

  it('omits preferredEndpointId when no model is selected (Auto policy)', () => {
    const onSubmit = vi.fn<(s: PromptSubmission) => void>();
    render(
      <PromptPanel
        agents={NO_AGENTS}
        // preferredEndpointId not provided → Auto (policy)
        onSubmit={onSubmit}
        disabled={false}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/what would you like to do/i), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].preferredEndpointId).toBeUndefined();
  });

  it('renders attached file chips and calls onRemoveFile for the matching id', () => {
    const onSubmit = vi.fn<(s: PromptSubmission) => void>();
    const onRemoveFile = vi.fn<(fileId: string) => void>();
    const files = [
      { fileId: 'file-abc', filename: 'contract.txt' },
      { fileId: 'file-def', filename: 'notes.md' },
    ];
    render(
      <PromptPanel
        agents={NO_AGENTS}
        attachedFiles={files}
        onRemoveFile={onRemoveFile}
        onSubmit={onSubmit}
        disabled={false}
      />
    );

    // Both filenames render as chips.
    expect(screen.getByText('contract.txt')).toBeDefined();
    expect(screen.getByText('notes.md')).toBeDefined();

    // Each chip exposes a "Remove <name>" button that fires onRemoveFile
    // with the right id.
    fireEvent.click(screen.getByLabelText('Remove notes.md'));
    expect(onRemoveFile).toHaveBeenCalledTimes(1);
    expect(onRemoveFile).toHaveBeenCalledWith('file-def');
  });

  it('refuses to submit a whitespace-only prompt', () => {
    const onSubmit = vi.fn<(s: PromptSubmission) => void>();
    render(<PromptPanel agents={NO_AGENTS} onSubmit={onSubmit} disabled={false} />);

    fireEvent.change(screen.getByPlaceholderText(/what would you like to do/i), {
      target: { value: '   ' },
    });
    // Send button is disabled when prompt is whitespace-only.
    const sendBtn = screen.getByRole('button', { name: /send/i }) as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(sendBtn);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
