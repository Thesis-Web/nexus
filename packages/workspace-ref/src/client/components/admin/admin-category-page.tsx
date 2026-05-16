// packages/workspace-ref/src/client/components/admin/admin-category-page.tsx
// AMEND-nexus-admin-dashboard-full-buildout (Arc 3 fixup) — defensive fallback
// for unknown surfaceIds.
//
// All registered NAV surfaces in admin-dashboard-shell.tsx have real,
// writer-enabled panels. This page renders only when an unknown surfaceId
// reaches the shell's switch fallback (defensive against future drift —
// e.g. a typo in NAV or a new surface added to NAV before its panel
// lands). The previous "Claude B/C/D phase" body copy + "Read-only"
// banner were dead state from before the admin buildout completed.

interface Props {
  surfaceId: string;
  title: string;
}

export function AdminCategoryPage({ surfaceId, title }: Props) {
  return (
    <div className="nx-admin-category-page">
      <h2>{title}</h2>
      <p className="nx-admin-category-page__breadcrumb">
        surface id: <code>{surfaceId}</code>
      </p>
      <p className="nx-admin-category-page__placeholder">
        No panel registered for this surface. Add a case to <code>admin-dashboard-shell.tsx</code>{' '}
        to wire one.
      </p>
    </div>
  );
}
