// packages/workspace-ref/src/client/components/admin/panels/orchestrator-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.3 — writer-enabled
// orchestrator CRUD. The loader's OrchestratorManifestEntrySchema requires
// a deep object with nested secureMode/retryPolicy/timeouts/planAmendment/
// partialCompletion — the writer schema mirrors it. The add form exposes
// the spec's primary fields (socketId, type, plannerMode, plannerType,
// plannerVersion, maxToolTurnsPerNode) and pre-populates loader-correct
// defaults for the nested objects.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { ORCHESTRATOR_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import {
  addOrchestrator,
  removeOrchestrator,
  updateOrchestrator,
} from '../../../admin-writer-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  onCatalogReload?: () => void;
}

interface OrchestratorEntry extends Record<string, unknown> {
  orchestratorSocketId: string;
  orchestratorType: string;
  enabled: boolean;
  plannerMode: string;
  plannerType: string;
  plannerVersion: string;
  maxToolTurnsPerNode: number;
}

const COLUMNS: readonly ManifestTableColumn<OrchestratorEntry>[] = [
  { key: 'orchestratorSocketId', label: 'socketId' },
  { key: 'orchestratorType', label: 'type' },
  { key: 'plannerMode', label: 'plannerMode' },
  { key: 'plannerType', label: 'plannerType' },
  { key: 'maxToolTurnsPerNode', label: 'toolTurnCap' },
  {
    key: 'enabled',
    label: 'enabled',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
];

const PLANNER_TYPES = ['db-lexicon-transformer-v0', 'nvg-deterministic', 'other'] as const;
const PLANNER_MODES = ['deterministic_first', 'policy_template', 'llm_assisted'] as const;

interface OrchestratorAddDraft {
  orchestratorSocketId: string;
  orchestratorType: string;
  orchestratorActorId: string;
  plannerMode: (typeof PLANNER_MODES)[number];
  plannerType: string;
  plannerVersion: string;
  maxToolTurnsPerNode: number;
  maxSplitDepth: number;
  systemActionMs: number;
  modelCallMs: number;
}

function defaultDraft(): OrchestratorAddDraft {
  return {
    orchestratorSocketId: '',
    orchestratorType: 'reference_deterministic',
    orchestratorActorId: '00000000-0000-4000-a000-000000000001',
    plannerMode: 'deterministic_first',
    plannerType: 'db-lexicon-transformer-v0',
    plannerVersion: '0.1.0',
    maxToolTurnsPerNode: 1,
    maxSplitDepth: 3,
    systemActionMs: 30000,
    modelCallMs: 60000,
  };
}

export function OrchestratorSetupPanel({ data, elevatedSessionId, onCatalogReload }: Props) {
  const surface = data ?? ORCHESTRATOR_PLACEHOLDER;
  const entries = (surface.currentConfiguredValue['entries'] as OrchestratorEntry[]) ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(
    entries[0]?.orchestratorSocketId
  );
  const selected = entries.find(e => e.orchestratorSocketId === selectedId) ?? null;

  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState<OrchestratorAddDraft>(defaultDraft());
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  async function handleAdd() {
    if (!elevatedSessionId || !draft.orchestratorSocketId) return;
    setBusy(true);
    setFeedback(null);
    const res = await addOrchestrator(elevatedSessionId, {
      orchestratorSocketId: draft.orchestratorSocketId,
      orchestratorType: draft.orchestratorType,
      enabled: true,
      orchestratorActorId: draft.orchestratorActorId,
      plannerMode: draft.plannerMode,
      maxSplitDepth: draft.maxSplitDepth,
      planCheckbackDefault: true,
      secureMode: {
        octSecureDefault: 'single_agent_no_helper',
        allowSecureMultiAgentOnlyBySignedPolicy: true,
      },
      retryPolicy: { transientAutoRetryCount: 1 },
      timeouts: {
        systemActionMs: draft.systemActionMs,
        modelCallMs: draft.modelCallMs,
      },
      outputSlotPolicy: 'strict_declared_slots',
      configuration: {},
      plannerType: draft.plannerType,
      plannerVersion: draft.plannerVersion,
      plannerConfiguration: {},
      planAmendment: { enabled: true, maxAmendments: 3, requiresCheckback: false },
      partialCompletion: {
        enabled: true,
        minRequiredCompletedNodes: 1,
        compileOnPartial: true,
      },
      maxToolTurnsPerNode: draft.maxToolTurnsPerNode,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Orchestrator ${draft.orchestratorSocketId} added. Restart server to apply.`,
      });
      setShowAddForm(false);
      setDraft(defaultDraft());
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add orchestrator' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res = await removeOrchestrator(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Orchestrator ${selectedId} removed. Restart required.`,
      });
      setSelectedId(undefined);
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove orchestrator' });
    }
  }

  async function handleToggleEnabled(target: OrchestratorEntry, nextEnabled: boolean) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await updateOrchestrator(elevatedSessionId, target.orchestratorSocketId, {
      enabled: nextEnabled,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Orchestrator ${target.orchestratorSocketId} ${nextEnabled ? 'enabled' : 'disabled'}. Restart required.`,
      });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update orchestrator' });
    }
  }

  async function handleAdjustToolTurnCap(target: OrchestratorEntry, next: number) {
    if (!elevatedSessionId) return;
    setBusy(true);
    setFeedback(null);
    const res = await updateOrchestrator(elevatedSessionId, target.orchestratorSocketId, {
      maxToolTurnsPerNode: next,
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Tool-turn cap set to ${next} for ${target.orchestratorSocketId}. Restart required.`,
      });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update tool-turn cap' });
    }
  }

  return (
    <PanelChrome surface={surface}>
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}
      <div className="nx-admin-panel__table">
        <AdminManifestTable<OrchestratorEntry>
          rows={entries}
          idKey="orchestratorSocketId"
          columns={COLUMNS}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selected}
          title={selected ? `Orchestrator — ${selected.orchestratorSocketId}` : undefined}
          secretFields={surface.secretFields}
          {...(canWrite
            ? {}
            : { disabledReason: 'Writer not available — elevated session required' })}
        />
        {selected && canWrite ? (
          <div className="nx-admin-panel__quick-edit">
            <h4>Quick edit</h4>
            <label>
              maxToolTurnsPerNode (≥1):{' '}
              <input
                type="number"
                min={1}
                max={10}
                defaultValue={selected.maxToolTurnsPerNode}
                onBlur={e => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next >= 1 && next !== selected.maxToolTurnsPerNode) {
                    void handleAdjustToolTurnCap(selected, next);
                  }
                }}
              />
            </label>
          </div>
        ) : null}
      </div>
      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <>
            <button type="button" disabled={busy} onClick={() => setShowAddForm(!showAddForm)}>
              + Add orchestrator
            </button>
            {selected && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(selected, !selected.enabled)}
                >
                  {selected.enabled ? 'Disable' : 'Enable'} orchestrator
                </button>
                <button type="button" disabled={busy} onClick={handleDelete}>
                  Delete selected
                </button>
              </>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + Add orchestrator
          </button>
        )}
      </div>
      {showAddForm && canWrite && (
        <div className="nx-admin-panel__add-form">
          <h4>Add orchestrator</h4>
          <label>
            Socket ID:{' '}
            <input
              value={draft.orchestratorSocketId}
              onChange={e => setDraft(d => ({ ...d, orchestratorSocketId: e.target.value }))}
              placeholder="e.g. ref-2"
            />
          </label>
          <label>
            Orchestrator type:{' '}
            <input
              value={draft.orchestratorType}
              onChange={e => setDraft(d => ({ ...d, orchestratorType: e.target.value }))}
            />
          </label>
          <label>
            Orchestrator actor ID (UUID):{' '}
            <input
              value={draft.orchestratorActorId}
              onChange={e => setDraft(d => ({ ...d, orchestratorActorId: e.target.value }))}
            />
          </label>
          <label>
            Planner mode:{' '}
            <select
              value={draft.plannerMode}
              onChange={e =>
                setDraft(d => ({
                  ...d,
                  plannerMode: e.target.value as (typeof PLANNER_MODES)[number],
                }))
              }
            >
              {PLANNER_MODES.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            Planner type:{' '}
            <select
              value={draft.plannerType}
              onChange={e => setDraft(d => ({ ...d, plannerType: e.target.value }))}
            >
              {PLANNER_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            Planner version:{' '}
            <input
              value={draft.plannerVersion}
              onChange={e => setDraft(d => ({ ...d, plannerVersion: e.target.value }))}
            />
          </label>
          <label>
            maxToolTurnsPerNode (≥1):{' '}
            <input
              type="number"
              min={1}
              value={draft.maxToolTurnsPerNode}
              onChange={e =>
                setDraft(d => ({
                  ...d,
                  maxToolTurnsPerNode: Math.max(1, Number(e.target.value) || 1),
                }))
              }
            />
          </label>
          <label>
            maxSplitDepth:{' '}
            <input
              type="number"
              min={0}
              value={draft.maxSplitDepth}
              onChange={e =>
                setDraft(d => ({ ...d, maxSplitDepth: Math.max(0, Number(e.target.value) || 0) }))
              }
            />
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !draft.orchestratorSocketId}
              onClick={handleAdd}
            >
              {busy ? 'Saving…' : 'Save orchestrator'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </PanelChrome>
  );
}
