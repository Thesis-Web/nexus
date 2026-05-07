// packages/workspace-ref/src/client/components/admin/panels/compile-mailbox-setup-panel.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §4.x — Mailbox / Compile / Return.
// HANDOFF-CLAUDE-B §6.1 surface #8 — triple. OR-DASH-010: compile-return target
// /nexus/compile-return harness routing pending.
//
// This panel renders three sub-tables side-by-side: mailboxes, compilers,
// returnEndpoints. Each can be selected independently to view details.

import { useState } from 'react';
import {
  AdminManifestTable,
  type ManifestTableColumn,
} from '../primitives/admin-manifest-table.js';
import { AdminManifestReadForm } from '../primitives/admin-manifest-read-form.js';
import { AdminAddNewButton } from '../primitives/admin-add-new-button.js';
import {
  MAILBOX_COMPILE_RETURN_PLACEHOLDER,
  PLACEHOLDER_BANNER_REASON,
} from '../placeholder/placeholder-data.js';
import type { DashboardSurfaceStatus } from '../placeholder/placeholder-types.js';
import { PanelChrome } from './_panel-chrome.js';

interface Props {
  data?: DashboardSurfaceStatus;
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
  { key: 'required', label: 'required', render: v => String(v) },
];
const COMPILER_COLS: readonly ManifestTableColumn<CompilerEntry>[] = [
  { key: 'compilerSocketId', label: 'socketId' },
  { key: 'compilerType', label: 'kind' },
  { key: 'octMode', label: 'octMode' },
];
const RETURN_COLS: readonly ManifestTableColumn<ReturnEntry>[] = [
  { key: 'returnEndpointId', label: 'returnEndpointId' },
  { key: 'endpointType', label: 'kind' },
  { key: 'targetWorkspaceSocketId', label: 'targetWorkspace' },
];

type SubKey = 'mailboxes' | 'compilers' | 'returnEndpoints';

export function CompileMailboxSetupPanel({ data }: Props) {
  const surface = data ?? MAILBOX_COMPILE_RETURN_PLACEHOLDER;
  const cv = surface.currentConfiguredValue;
  const mailboxes = (cv['mailboxes'] as MailboxEntry[]) ?? [];
  const compilers = (cv['compilers'] as CompilerEntry[]) ?? [];
  const returns = (cv['returnEndpoints'] as ReturnEntry[]) ?? [];

  const [activeSub, setActiveSub] = useState<SubKey>('mailboxes');
  const [selM, setSelM] = useState<string | undefined>(mailboxes[0]?.mailboxId);
  const [selC, setSelC] = useState<string | undefined>(compilers[0]?.compilerSocketId);
  const [selR, setSelR] = useState<string | undefined>(returns[0]?.returnEndpointId);

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

  return (
    <PanelChrome surface={surface}>
      <div className="nx-admin-panel__subnav">
        <button
          type="button"
          className={
            activeSub === 'mailboxes'
              ? 'nx-admin-panel__subnav-item nx-admin-panel__subnav-item--active'
              : 'nx-admin-panel__subnav-item'
          }
          onClick={() => setActiveSub('mailboxes')}
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
          onClick={() => setActiveSub('compilers')}
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
          onClick={() => setActiveSub('returnEndpoints')}
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
          disabledReason={PLACEHOLDER_BANNER_REASON}
        />
      </div>

      <div className="nx-admin-panel__actions">
        <AdminAddNewButton
          label={
            activeSub === 'mailboxes'
              ? 'Add mailbox'
              : activeSub === 'compilers'
                ? 'Add compiler'
                : 'Add return endpoint'
          }
        />
      </div>
    </PanelChrome>
  );
}
