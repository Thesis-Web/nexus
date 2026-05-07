// packages/workspace-ref/src/client/components/admin/admin-disabled-mutation-banner.tsx
// SPEC-addendum §6 — AdminDisabledMutationBanner.
// SPEC-addendum §9 — explicit prohibition on writes without ratified mutation law.
//
// Renders the "writes are not yet wired" banner that every panel with disabled
// save/apply affordances must display. Prevents users from believing the form
// will persist when no writer endpoint exists.

interface Props {
  reason?: string;
}

export function AdminDisabledMutationBanner({ reason }: Props) {
  return (
    <div className="nx-admin-disabled-mutation-banner" role="status">
      <strong>Read-only.</strong>{' '}
      {reason ?? 'Save/apply is disabled until backend writer endpoints are ratified.'}
    </div>
  );
}
