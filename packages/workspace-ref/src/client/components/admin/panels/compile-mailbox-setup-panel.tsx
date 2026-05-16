// packages/workspace-ref/src/client/components/admin/panels/compile-mailbox-setup-panel.tsx
//
// AMEND-nexus-admin-dashboard-full-buildout §3.5 — three independent
// sub-surface writers: mailboxes / compilers / return-endpoints. Wired
// across Commits 6 (mailbox), 7 (compiler), 8 (return-endpoint).

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { MAILBOX_COMPILE_RETURN_PLACEHOLDER } from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '@nexus/contracts';
import { PanelChrome } from './_panel-chrome.js';
import {
  addCompiler,
  addMailbox,
  addReturnEndpoint,
  removeCompiler,
  removeMailbox,
  removeReturnEndpoint,
  updateCompiler,
  updateMailbox,
  updateReturnEndpoint,
} from '../../../admin-writer-api.js';
import type { AdminCatalog } from '../../../admin-catalog-api.js';

interface Props {
  data?: DashboardSurfaceStatus;
  elevatedSessionId?: string;
  catalog?: AdminCatalog;
  onCatalogReload?: () => void;
}

interface MailboxEntry extends Record<string, unknown> {
  mailboxId: string;
  mailboxType: string;
  enabled: boolean;
  required: boolean;
}
interface CompilerEntry extends Record<string, unknown> {
  compilerSocketId: string;
  compilerType: string;
  enabled: boolean;
  octMode: string;
}
interface ReturnEntry extends Record<string, unknown> {
  returnEndpointId: string;
  endpointType: string;
  enabled: boolean;
  targetWorkspaceSocketId: string;
}

const MAILBOX_COLS: readonly ManifestTableColumn<MailboxEntry>[] = [
  { key: 'mailboxId', label: 'mailboxId' },
  { key: 'mailboxType', label: 'kind' },
  {
    key: 'enabled',
    label: 'enabled',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
  { key: 'required', label: 'required', render: v => String(v) },
];
const COMPILER_COLS: readonly ManifestTableColumn<CompilerEntry>[] = [
  { key: 'compilerSocketId', label: 'socketId' },
  { key: 'compilerType', label: 'kind' },
  { key: 'octMode', label: 'octMode' },
  {
    key: 'enabled',
    label: 'enabled',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
];
const RETURN_COLS: readonly ManifestTableColumn<ReturnEntry>[] = [
  { key: 'returnEndpointId', label: 'returnEndpointId' },
  { key: 'endpointType', label: 'kind' },
  { key: 'targetWorkspaceSocketId', label: 'targetWorkspace' },
  {
    key: 'enabled',
    label: 'enabled',
    render: v => (v === true ? '✓ enabled' : v === false ? '✗ disabled' : '—'),
  },
];

type SubKey = 'mailboxes' | 'compilers' | 'returnEndpoints';

const MAILBOX_TYPES = ['jsonl-file', 'sqlite', 'memory', 'local_jsonl_reference'] as const;
const COMPILER_TYPES = ['reference_deterministic_renderer', 'customer_onprem_synthesis'] as const;
const COMPILER_ALLOWED_MODES = [
  'deterministic_render',
  'on_prem_synthesis',
  'frontier_synthesis',
] as const;
const RETURN_ENDPOINT_TYPES = ['http_callback'] as const;

interface MailboxDraft {
  mailboxId: string;
  mailboxType: string;
  required: boolean;
  storageRoot: string;
  payloadTtlSeconds: number;
  classificationRequired: boolean;
  digestRequired: boolean;
}
function defaultMailboxDraft(): MailboxDraft {
  return {
    mailboxId: '',
    mailboxType: 'jsonl-file',
    required: true,
    storageRoot: 'runs/mailbox',
    payloadTtlSeconds: 3600,
    classificationRequired: true,
    digestRequired: true,
  };
}

interface CompilerDraft {
  compilerSocketId: string;
  compilerType: (typeof COMPILER_TYPES)[number];
  actorRegistration: 'exempt_reference_deterministic_renderer' | 'required';
  compilerActorId: string;
  readsFromMailboxId: string;
  allowedMode: (typeof COMPILER_ALLOWED_MODES)[number];
}
function defaultCompilerDraft(): CompilerDraft {
  return {
    compilerSocketId: '',
    compilerType: 'reference_deterministic_renderer',
    actorRegistration: 'exempt_reference_deterministic_renderer',
    compilerActorId: '',
    readsFromMailboxId: '',
    allowedMode: 'deterministic_render',
  };
}

interface ReturnDraft {
  returnEndpointId: string;
  targetWorkspaceSocketId: string;
  url: string;
  authKeyId: string;
  acceptedArtifactType: string;
}
function defaultReturnDraft(): ReturnDraft {
  return {
    returnEndpointId: '',
    targetWorkspaceSocketId: '',
    url: '',
    authKeyId: 'dev-compile-return-key',
    acceptedArtifactType: 'final_response.v1',
  };
}

export function CompileMailboxSetupPanel({
  data,
  elevatedSessionId,
  catalog,
  onCatalogReload,
}: Props) {
  const surface = data ?? MAILBOX_COMPILE_RETURN_PLACEHOLDER;
  const cv = surface.currentConfiguredValue;
  const mailboxes = (cv['mailboxes'] as MailboxEntry[]) ?? [];
  const compilers = (cv['compilers'] as CompilerEntry[]) ?? [];
  const returns = (cv['returnEndpoints'] as ReturnEntry[]) ?? [];

  const [activeSub, setActiveSub] = useState<SubKey>('mailboxes');
  const [selM, setSelM] = useState<string | undefined>(mailboxes[0]?.mailboxId);
  const [selC, setSelC] = useState<string | undefined>(compilers[0]?.compilerSocketId);
  const [selR, setSelR] = useState<string | undefined>(returns[0]?.returnEndpointId);

  const [showAddForm, setShowAddForm] = useState(false);
  const [mailboxDraft, setMailboxDraft] = useState<MailboxDraft>(defaultMailboxDraft());
  const [compilerDraft, setCompilerDraft] = useState<CompilerDraft>(defaultCompilerDraft());
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(defaultReturnDraft());
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = !!elevatedSessionId;

  const workspaceOptions = ((catalog?.allWorkspaces ?? []) as Array<Record<string, unknown>>)
    .map(w => ({
      id: String(w['workspaceSocketId'] ?? ''),
      enabled: w['enabled'] !== false,
    }))
    .filter(w => w.id.length > 0 && w.enabled);

  const mailboxOptionsForCompiler = mailboxes.filter(m => m.enabled).map(m => m.mailboxId);

  const selectedEntry: Record<string, unknown> | null =
    activeSub === 'mailboxes'
      ? (mailboxes.find(m => m.mailboxId === selM) ?? null)
      : activeSub === 'compilers'
        ? (compilers.find(c => c.compilerSocketId === selC) ?? null)
        : (returns.find(r => r.returnEndpointId === selR) ?? null);
  const selectedTitle =
    activeSub === 'mailboxes'
      ? `Mailbox — ${selM ?? '(none)'}`
      : activeSub === 'compilers'
        ? `Compiler — ${selC ?? '(none)'}`
        : `Return endpoint — ${selR ?? '(none)'}`;
  const selectedId = activeSub === 'mailboxes' ? selM : activeSub === 'compilers' ? selC : selR;

  // ── Mailbox handlers ─────────────────────────────────────────────────────
  async function handleAddMailbox() {
    if (!elevatedSessionId || !mailboxDraft.mailboxId) return;
    setBusy(true);
    setFeedback(null);
    const res = await addMailbox(elevatedSessionId, {
      mailboxId: mailboxDraft.mailboxId,
      mailboxType: mailboxDraft.mailboxType,
      enabled: true,
      required: mailboxDraft.required,
      storageRoot: mailboxDraft.storageRoot,
      retentionPolicy: {
        payloadTtlSeconds: mailboxDraft.payloadTtlSeconds,
        metadataRetention: 'run_ledger',
      },
      classificationRequired: mailboxDraft.classificationRequired,
      digestRequired: mailboxDraft.digestRequired,
      configuration: {},
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Mailbox ${mailboxDraft.mailboxId} added. Restart server to apply.`,
      });
      setShowAddForm(false);
      setMailboxDraft(defaultMailboxDraft());
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add mailbox' });
    }
  }

  // ── Compiler handlers ────────────────────────────────────────────────────
  async function handleAddCompiler() {
    if (!elevatedSessionId || !compilerDraft.compilerSocketId || !compilerDraft.readsFromMailboxId)
      return;
    setBusy(true);
    setFeedback(null);
    const body: Record<string, unknown> = {
      compilerSocketId: compilerDraft.compilerSocketId,
      compilerType: compilerDraft.compilerType,
      enabled: true,
      actorRegistration: compilerDraft.actorRegistration,
      compilerActorId:
        compilerDraft.actorRegistration === 'required'
          ? compilerDraft.compilerActorId || null
          : null,
      octMode: 'OCT-COMPILE',
      allowedModes: [compilerDraft.allowedMode],
      readsFromMailboxId: compilerDraft.readsFromMailboxId,
      outputContractVersion: 'v1',
      artifactSigning:
        compilerDraft.actorRegistration === 'required'
          ? { kind: 'actor_registry_key', keyId: 'dev-compiler-actor-key' }
          : { kind: 'control_plane' },
      configuration: {},
    };
    const res = await addCompiler(elevatedSessionId, body);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Compiler ${compilerDraft.compilerSocketId} added. Restart required.`,
      });
      setShowAddForm(false);
      setCompilerDraft(defaultCompilerDraft());
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add compiler' });
    }
  }

  // ── Return endpoint handlers ─────────────────────────────────────────────
  async function handleAddReturn() {
    if (!elevatedSessionId || !returnDraft.returnEndpointId || !returnDraft.targetWorkspaceSocketId)
      return;
    setBusy(true);
    setFeedback(null);
    const res = await addReturnEndpoint(elevatedSessionId, {
      returnEndpointId: returnDraft.returnEndpointId,
      endpointType: 'http_callback',
      enabled: true,
      targetWorkspaceSocketId: returnDraft.targetWorkspaceSocketId,
      url: returnDraft.url,
      auth: { kind: 'signed_callback', keyId: returnDraft.authKeyId },
      acceptedArtifactTypes: [returnDraft.acceptedArtifactType],
      configuration: {},
    });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `Return endpoint ${returnDraft.returnEndpointId} added. Restart required.`,
      });
      setShowAddForm(false);
      setReturnDraft(defaultReturnDraft());
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to add return endpoint' });
    }
  }

  async function handleDelete() {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res =
      activeSub === 'mailboxes'
        ? await removeMailbox(elevatedSessionId, selectedId)
        : activeSub === 'compilers'
          ? await removeCompiler(elevatedSessionId, selectedId)
          : await removeReturnEndpoint(elevatedSessionId, selectedId);
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `${activeSub === 'mailboxes' ? 'Mailbox' : activeSub === 'compilers' ? 'Compiler' : 'Return endpoint'} ${selectedId} removed. Restart required.`,
      });
      if (activeSub === 'mailboxes') setSelM(undefined);
      else if (activeSub === 'compilers') setSelC(undefined);
      else setSelR(undefined);
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to remove entry' });
    }
  }

  async function handleToggleEnabled(nextEnabled: boolean) {
    if (!elevatedSessionId || !selectedId) return;
    setBusy(true);
    setFeedback(null);
    const res =
      activeSub === 'mailboxes'
        ? await updateMailbox(elevatedSessionId, selectedId, { enabled: nextEnabled })
        : activeSub === 'compilers'
          ? await updateCompiler(elevatedSessionId, selectedId, { enabled: nextEnabled })
          : await updateReturnEndpoint(elevatedSessionId, selectedId, { enabled: nextEnabled });
    setBusy(false);
    if (res.ok) {
      setFeedback({
        type: 'success',
        msg: `${selectedId} ${nextEnabled ? 'enabled' : 'disabled'}. Restart required.`,
      });
      onCatalogReload?.();
    } else {
      setFeedback({ type: 'error', msg: res.error ?? 'Failed to update entry' });
    }
  }

  const isSelectedEnabled = (selectedEntry?.['enabled'] as boolean | undefined) === true;
  const addLabel =
    activeSub === 'mailboxes'
      ? 'Add mailbox'
      : activeSub === 'compilers'
        ? 'Add compiler'
        : 'Add return endpoint';

  return (
    <PanelChrome surface={surface}>
      {feedback && (
        <div className={`nx-admin-panel__feedback nx-admin-panel__feedback--${feedback.type}`}>
          {feedback.msg}
        </div>
      )}
      <div className="nx-admin-panel__subnav">
        <button
          type="button"
          className={
            activeSub === 'mailboxes'
              ? 'nx-admin-panel__subnav-item nx-admin-panel__subnav-item--active'
              : 'nx-admin-panel__subnav-item'
          }
          onClick={() => {
            setActiveSub('mailboxes');
            setShowAddForm(false);
          }}
        >
          Mailboxes ({mailboxes.length})
        </button>
        <button
          type="button"
          className={
            activeSub === 'compilers'
              ? 'nx-admin-panel__subnav-item nx-admin-panel__subnav-item--active'
              : 'nx-admin-panel__subnav-item'
          }
          onClick={() => {
            setActiveSub('compilers');
            setShowAddForm(false);
          }}
        >
          Compilers ({compilers.length})
        </button>
        <button
          type="button"
          className={
            activeSub === 'returnEndpoints'
              ? 'nx-admin-panel__subnav-item nx-admin-panel__subnav-item--active'
              : 'nx-admin-panel__subnav-item'
          }
          onClick={() => {
            setActiveSub('returnEndpoints');
            setShowAddForm(false);
          }}
        >
          Return endpoints ({returns.length})
        </button>
      </div>

      <div className="nx-admin-panel__table">
        {activeSub === 'mailboxes' && (
          <AdminManifestTable<MailboxEntry>
            rows={mailboxes}
            idKey="mailboxId"
            columns={MAILBOX_COLS}
            selectedId={selM}
            onSelect={setSelM}
          />
        )}
        {activeSub === 'compilers' && (
          <AdminManifestTable<CompilerEntry>
            rows={compilers}
            idKey="compilerSocketId"
            columns={COMPILER_COLS}
            selectedId={selC}
            onSelect={setSelC}
          />
        )}
        {activeSub === 'returnEndpoints' && (
          <AdminManifestTable<ReturnEntry>
            rows={returns}
            idKey="returnEndpointId"
            columns={RETURN_COLS}
            selectedId={selR}
            onSelect={setSelR}
          />
        )}
      </div>

      <div className="nx-admin-panel__form">
        <AdminManifestReadForm
          entry={selectedEntry}
          title={selectedTitle}
          secretFields={surface.secretFields}
        />
      </div>

      <div className="nx-admin-panel__actions">
        {canWrite ? (
          <>
            <button type="button" disabled={busy} onClick={() => setShowAddForm(!showAddForm)}>
              + {addLabel}
            </button>
            {selectedId && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleToggleEnabled(!isSelectedEnabled)}
                >
                  {isSelectedEnabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" disabled={busy} onClick={handleDelete}>
                  Delete selected
                </button>
              </>
            )}
          </>
        ) : (
          <button type="button" disabled title="Elevated session required">
            + {addLabel}
          </button>
        )}
      </div>

      {showAddForm && canWrite && activeSub === 'mailboxes' && (
        <div className="nx-admin-panel__add-form">
          <h4>Add mailbox</h4>
          <label>
            mailboxId:{' '}
            <input
              value={mailboxDraft.mailboxId}
              onChange={e => setMailboxDraft(d => ({ ...d, mailboxId: e.target.value }))}
            />
          </label>
          <label>
            mailboxType:{' '}
            <select
              value={mailboxDraft.mailboxType}
              onChange={e => setMailboxDraft(d => ({ ...d, mailboxType: e.target.value }))}
            >
              {MAILBOX_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            storageRoot:{' '}
            <input
              value={mailboxDraft.storageRoot}
              onChange={e => setMailboxDraft(d => ({ ...d, storageRoot: e.target.value }))}
            />
          </label>
          <label>
            payloadTtlSeconds (60–86400):{' '}
            <input
              type="number"
              min={60}
              max={86400}
              value={mailboxDraft.payloadTtlSeconds}
              onChange={e =>
                setMailboxDraft(d => ({
                  ...d,
                  payloadTtlSeconds: Math.max(60, Math.min(86400, Number(e.target.value) || 60)),
                }))
              }
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={mailboxDraft.required}
              onChange={e => setMailboxDraft(d => ({ ...d, required: e.target.checked }))}
            />{' '}
            required (bootstrap must allocate this mailbox)
          </label>
          <label>
            <input
              type="checkbox"
              checked={mailboxDraft.classificationRequired}
              onChange={e =>
                setMailboxDraft(d => ({ ...d, classificationRequired: e.target.checked }))
              }
            />{' '}
            classificationRequired
          </label>
          <label>
            <input
              type="checkbox"
              checked={mailboxDraft.digestRequired}
              onChange={e => setMailboxDraft(d => ({ ...d, digestRequired: e.target.checked }))}
            />{' '}
            digestRequired
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !mailboxDraft.mailboxId}
              onClick={handleAddMailbox}
            >
              {busy ? 'Saving…' : 'Save mailbox'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showAddForm && canWrite && activeSub === 'compilers' && (
        <div className="nx-admin-panel__add-form">
          <h4>Add compiler</h4>
          <label>
            compilerSocketId:{' '}
            <input
              value={compilerDraft.compilerSocketId}
              onChange={e => setCompilerDraft(d => ({ ...d, compilerSocketId: e.target.value }))}
            />
          </label>
          <label>
            compilerType:{' '}
            <select
              value={compilerDraft.compilerType}
              onChange={e =>
                setCompilerDraft(d => ({
                  ...d,
                  compilerType: e.target.value as (typeof COMPILER_TYPES)[number],
                }))
              }
            >
              {COMPILER_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            allowedMode:{' '}
            <select
              value={compilerDraft.allowedMode}
              onChange={e =>
                setCompilerDraft(d => ({
                  ...d,
                  allowedMode: e.target.value as (typeof COMPILER_ALLOWED_MODES)[number],
                }))
              }
            >
              {COMPILER_ALLOWED_MODES.map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            actorRegistration:{' '}
            <select
              value={compilerDraft.actorRegistration}
              onChange={e =>
                setCompilerDraft(d => ({
                  ...d,
                  actorRegistration: e.target.value as CompilerDraft['actorRegistration'],
                }))
              }
            >
              <option value="exempt_reference_deterministic_renderer">exempt</option>
              <option value="required">required (with actor key)</option>
            </select>
          </label>
          {compilerDraft.actorRegistration === 'required' && (
            <label>
              compilerActorId:{' '}
              <input
                value={compilerDraft.compilerActorId}
                onChange={e => setCompilerDraft(d => ({ ...d, compilerActorId: e.target.value }))}
                placeholder="UUID"
              />
            </label>
          )}
          <label>
            readsFromMailboxId:{' '}
            <select
              value={compilerDraft.readsFromMailboxId}
              onChange={e => setCompilerDraft(d => ({ ...d, readsFromMailboxId: e.target.value }))}
            >
              <option value="">— select a mailbox —</option>
              {mailboxOptionsForCompiler.map(id => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          {mailboxOptionsForCompiler.length === 0 && (
            <p className="nx-admin-panel__hint">
              No enabled mailboxes available — define a mailbox first (Mailboxes sub-tab).
            </p>
          )}
          <div>
            <button
              type="button"
              disabled={
                busy || !compilerDraft.compilerSocketId || !compilerDraft.readsFromMailboxId
              }
              onClick={handleAddCompiler}
            >
              {busy ? 'Saving…' : 'Save compiler'}
            </button>
            <button type="button" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {showAddForm && canWrite && activeSub === 'returnEndpoints' && (
        <div className="nx-admin-panel__add-form">
          <h4>Add return endpoint</h4>
          <label>
            returnEndpointId:{' '}
            <input
              value={returnDraft.returnEndpointId}
              onChange={e => setReturnDraft(d => ({ ...d, returnEndpointId: e.target.value }))}
            />
          </label>
          <label>
            endpointType:{' '}
            <select value="http_callback" disabled>
              {RETURN_ENDPOINT_TYPES.map(t => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="nx-admin-panel__hint">
              (only http_callback today; cli/mcp variants are a future spec)
            </span>
          </label>
          <label>
            targetWorkspaceSocketId:{' '}
            <select
              value={returnDraft.targetWorkspaceSocketId}
              onChange={e =>
                setReturnDraft(d => ({ ...d, targetWorkspaceSocketId: e.target.value }))
              }
            >
              <option value="">— select an enabled workspace —</option>
              {workspaceOptions.map(opt => (
                <option key={opt.id} value={opt.id}>
                  {opt.id}
                </option>
              ))}
            </select>
          </label>
          {workspaceOptions.length === 0 && (
            <p className="nx-admin-panel__hint">
              No enabled workspaces — define a workspace first (Workspace surface).
            </p>
          )}
          <label>
            url:{' '}
            <input
              value={returnDraft.url}
              onChange={e => setReturnDraft(d => ({ ...d, url: e.target.value }))}
              placeholder="http://127.0.0.1:7701/compile-return/..."
            />
          </label>
          <label>
            auth keyId:{' '}
            <input
              value={returnDraft.authKeyId}
              onChange={e => setReturnDraft(d => ({ ...d, authKeyId: e.target.value }))}
            />
          </label>
          <label>
            acceptedArtifactType:{' '}
            <input
              value={returnDraft.acceptedArtifactType}
              onChange={e => setReturnDraft(d => ({ ...d, acceptedArtifactType: e.target.value }))}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={
                busy ||
                !returnDraft.returnEndpointId ||
                !returnDraft.targetWorkspaceSocketId ||
                !returnDraft.url
              }
              onClick={handleAddReturn}
            >
              {busy ? 'Saving…' : 'Save return endpoint'}
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
