// packages/workspace-ref/src/client/components/prompt-panel.tsx
// Blueprint §3.2 (prompt tab system), §3.2.1-3.2.3 (three tabs).
// OD-WS-003: component internals not spec-governed.

import { useState, useRef } from 'react';
import type { CatalogItem } from '../api.js';

export type PromptMode = 'free_text' | 'sectioned' | 'secure_rails';

export interface PromptSubmission {
  promptMode: PromptMode;
  prompt: string;
  agents?: string[];
  /**
   * EndpointId selected from the model dropdown (CatalogItem.id).
   * Omitted when the user chose "Auto (policy)".
   */
  preferredEndpointId?: string;
  attachmentIds?: string[];
  templateId?: string;
  templateVersion?: string;
  outputFormat?: string;
  connectors?: string[];
  executionMode?: string;
  railId?: string;
  railVersion?: string;
  elevatedSessionId?: string;
  constrainedInputs?: Record<string, string>;
}

interface PromptPanelProps {
  agents: CatalogItem[];
  /**
   * EndpointId selected from the topbar model dropdown ("" → Auto/policy).
   * Threaded through PromptSubmission.preferredEndpointId on submit.
   */
  preferredEndpointId?: string;
  onSubmit: (submission: PromptSubmission) => void;
  onFileUpload?: () => void;
  disabled?: boolean;
}

export function PromptPanel({
  agents,
  preferredEndpointId,
  onSubmit,
  onFileUpload,
  disabled,
}: PromptPanelProps) {
  const [tab, setTab] = useState<PromptMode>('free_text');
  const [prompt, setPrompt] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sectioned state
  const [templateId, setTemplateId] = useState('');
  const [outputFormat, setOutputFormat] = useState('prose');
  const [execMode, setExecMode] = useState('human_in_the_loop');

  const handleSubmit = () => {
    if (!prompt.trim() && tab !== 'secure_rails') return;

    const submission: PromptSubmission = { promptMode: tab, prompt: prompt.trim() };

    if (selectedAgents.length > 0) submission.agents = selectedAgents;
    if (preferredEndpointId) {
      submission.preferredEndpointId = preferredEndpointId;
    }

    if (tab === 'sectioned') {
      if (templateId) {
        submission.templateId = templateId;
        submission.templateVersion = '1.0.0';
      }
      submission.outputFormat = outputFormat;
      submission.executionMode = execMode;
    }

    onSubmit(submission);
    setPrompt('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleAgent = (id: string) => {
    setSelectedAgents(prev => (prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]));
  };

  return (
    <div className="nx-prompt-panel">
      {/* Tab bar */}
      <div className="nx-tabs">
        <button
          className={`nx-tab ${tab === 'free_text' ? 'nx-tab--active' : ''}`}
          onClick={() => setTab('free_text')}
        >
          Free text
        </button>
        <button
          className={`nx-tab ${tab === 'sectioned' ? 'nx-tab--active' : ''}`}
          onClick={() => setTab('sectioned')}
        >
          Sectioned
        </button>
        <button
          className={`nx-tab ${tab === 'secure_rails' ? 'nx-tab--active' : ''}`}
          onClick={() => setTab('secure_rails')}
        >
          Secure Rails
        </button>

        {/* File upload button — right side */}
        <div style={{ flex: 1 }} />
        <button
          className="nx-btn nx-prompt-file-btn"
          onClick={onFileUpload}
          style={{ alignSelf: 'center', marginRight: 4 }}
        >
          + File
        </button>
      </div>

      {/* Sectioned fields (Tab 2 only) */}
      {tab === 'sectioned' && (
        <div className="nx-section-grid">
          <div className="nx-section-field">
            <label>Template</label>
            <input
              placeholder="Template ID (optional)"
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
            />
          </div>
          <div className="nx-section-field">
            <label>Output Format</label>
            <select value={outputFormat} onChange={e => setOutputFormat(e.target.value)}>
              <option value="prose">Prose</option>
              <option value="table">Table</option>
              <option value="raw">Raw</option>
              <option value="mixed">Mixed</option>
              <option value="file_bundle">File Bundle</option>
            </select>
          </div>
          <div className="nx-section-field">
            <label>Agents</label>
            <select
              multiple
              value={selectedAgents}
              onChange={e => {
                const opts = Array.from(e.target.selectedOptions, o => o.value);
                setSelectedAgents(opts);
              }}
              style={{ minHeight: 60 }}
            >
              {agents
                .filter(a => a.selectable)
                .map(a => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="nx-section-field">
            <label>Execution Mode</label>
            <select value={execMode} onChange={e => setExecMode(e.target.value)}>
              <option value="human_in_the_loop">Human in the loop</option>
              <option value="autonomous">Autonomous</option>
            </select>
          </div>
        </div>
      )}

      {/* Secure Rails (Tab 3) — placeholder for elevated session */}
      {tab === 'secure_rails' && (
        <div style={{ padding: '12px 16px', color: 'var(--nx-text-muted)', fontSize: '13px' }}>
          Secure Rails require elevated session assurance. Use Vault auth to unlock.
        </div>
      )}

      {/* Prompt input area */}
      <div className="nx-prompt-input-area">
        <textarea
          ref={textareaRef}
          className="nx-prompt-textarea"
          placeholder="What would you like to do?"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || tab === 'secure_rails'}
          rows={2}
        />
        <button
          className="nx-btn nx-btn--send"
          onClick={handleSubmit}
          disabled={disabled || (!prompt.trim() && tab !== 'secure_rails')}
        >
          Send
        </button>
      </div>
    </div>
  );
}
