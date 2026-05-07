// packages/workspace-ref/src/client/components/admin/primitives/admin-add-new-button.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §6 — AdminAddNewButton primitive.
// HANDOFF-CLAUDE-B §8 acceptance gate: every save/apply/remove button MUST be
// disabled in Beta1.
// OR-DASH-005 (owner ruling): start read-only.
// CONTRA-B01 (Claude B turn 03 owner ruling): defer writers; stay disabled.
//
// Renders a disabled button with a `title` reason. Never receives an enabled
// path in this window. Reserved as the single insertion point for future
// writer wiring.

interface Props {
  label: string;
  reason?: string;
}

export function AdminAddNewButton({ label, reason }: Props) {
  return (
    <button
      type="button"
      className="nx-admin-add-new-button"
      disabled
      title={reason ?? 'Disabled — writer endpoints not yet ratified (Beta1 read-only)'}
      aria-disabled="true"
    >
      + {label}
    </button>
  );
}
