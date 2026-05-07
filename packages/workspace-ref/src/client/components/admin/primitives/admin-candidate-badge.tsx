// packages/workspace-ref/src/client/components/admin/primitives/admin-candidate-badge.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §6 — AdminCandidateBadge primitive.
// OR-DASH-008 (owner ruling): candidate vendor/provider/model/connector items
// must display as disabled/non-enableable catalog items until factory + manifest
// + runtime + tests exist.
//
// Renders a small italic badge plus optional tooltip-style reason text.
// Pairs with AdminStatusBadge state="candidate" or "future" on enclosing card.

interface Props {
  label: string;
  reason?: string;
}

export function AdminCandidateBadge({ label, reason }: Props) {
  return (
    <span
      className="nx-admin-candidate-badge"
      title={reason ?? 'Catalog candidate — not enableable until factory + runtime exist'}
    >
      <span className="nx-admin-candidate-badge__icon" aria-hidden="true">
        ◇
      </span>
      <span className="nx-admin-candidate-badge__label">{label}</span>
    </span>
  );
}
