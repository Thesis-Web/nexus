// packages/workspace-ref/src/client/components/admin/admin-entry-button.tsx
// SPEC-addendum §6 — AdminEntryButton.
// Owner ruling OR-001 (2026-05-06): role 'nexus-admin'.
// Acceptance gate #1: non-admin users do not see the admin button.

import { ADMIN_DISPLAY_LABEL } from '../../admin-role.js';

interface Props {
  isAdmin: boolean;
  onClick: () => void;
}

export function AdminEntryButton({ isAdmin, onClick }: Props) {
  if (!isAdmin) return null;
  return (
    <button
      type="button"
      className="nx-admin-entry-button"
      onClick={onClick}
      title={`Enter ${ADMIN_DISPLAY_LABEL} dashboard`}
    >
      {ADMIN_DISPLAY_LABEL}
    </button>
  );
}
