// packages/workspace-ref/src/client/components/admin/admin-category-page.tsx
// SPEC-addendum §6 — generic per-category placeholder page.
// Renders until per-surface detail panels (Claude B) ship.

import { AdminDisabledMutationBanner } from './admin-disabled-mutation-banner.js';

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
      <AdminDisabledMutationBanner
        reason={`Detail panel for "${title}" pending Claude B implementation. Read-only data pending Claude C projection at GET /workspace/admin/setup/surfaces/${surfaceId}.`}
      />
      <div className="nx-admin-category-page__placeholder">
        <p>This panel is part of the Beta1 admin dashboard scope (SPEC §6).</p>
        <ul>
          <li>UI fields → Claude B (dashboard-forms window).</li>
          <li>Read projection → Claude C (admin-read-projections window).</li>
          <li>Mutation writers → ratified separately (writer-scope-A01).</li>
        </ul>
      </div>
    </div>
  );
}
