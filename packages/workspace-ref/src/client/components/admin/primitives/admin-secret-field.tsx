// packages/workspace-ref/src/client/components/admin/primitives/admin-secret-field.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §6 — AdminSecretField primitive.
// OR-DASH-009 (owner ruling): secret presence status only; never raw values.
// Claude B turn 04 Q-A ruling: status pill only — also never display secret-store ref.
//
// Renders one of three lowercase status pills: present | missing | unknown.
// Accepts a `fieldPath` for label/aria but never echoes secret material.

import type { DashboardSecretFieldStatus } from '@nexus/contracts';

interface Props {
  fieldPath: string;
  status: DashboardSecretFieldStatus;
}

const STATUS_LABEL: Record<DashboardSecretFieldStatus, string> = {
  present: 'present',
  missing: 'missing',
  unknown: 'unknown',
};

export function AdminSecretField({ fieldPath, status }: Props) {
  return (
    <div className="nx-admin-secret-field">
      <span className="nx-admin-secret-field__path">{fieldPath}</span>
      <span
        className={`nx-admin-secret-field__pill nx-admin-secret-field__pill--${status}`}
        aria-label={`Secret status: ${STATUS_LABEL[status]}`}
      >
        {STATUS_LABEL[status]}
      </span>
    </div>
  );
}
