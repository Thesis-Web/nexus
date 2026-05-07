// packages/workspace-ref/src/client/components/admin/primitives/admin-manifest-table.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §6 — AdminManifestTable primitive.
//
// Renders an array of manifest entries (one per row) showing primary identifier
// + per-entry enabled/disabled state derived from manifest data. Used by every
// multi-entry surface panel (connectors, endpoints, compilers, etc.).
//
// Generic over entry shape — caller provides:
//   - rows: array of arbitrary records (each row's `enabled` field drives status)
//   - idKey: which property contains the row identifier
//   - columns: ordered list of columns to render
//
// Row click (when `onSelect` provided) sets the selected entry — typically the
// owning panel scrolls AdminManifestReadForm to the selected row.

import { AdminStatusBadge } from '../admin-status-badge.js';
import type { DashboardReadinessState } from '../admin-status.js';

export interface ManifestTableColumn<T> {
  key: keyof T & string;
  label: string;
  /** Optional renderer for non-string columns (objects, booleans). */
  render?: (value: unknown, row: T) => string;
}

interface Props<T extends Record<string, unknown>> {
  rows: readonly T[];
  idKey: keyof T & string;
  columns: readonly ManifestTableColumn<T>[];
  selectedId?: string | undefined;
  onSelect?: ((id: string) => void) | undefined;
  /** Override per-row state derivation. Default: row.enabled === true → 'configured', false → 'disabled'. */
  rowState?: ((row: T) => DashboardReadinessState) | undefined;
}

function defaultRowState<T extends Record<string, unknown>>(row: T): DashboardReadinessState {
  const enabled = row['enabled'];
  if (enabled === true) return 'configured';
  if (enabled === false) return 'disabled';
  return 'partial';
}

function defaultRender(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length}]`;
  if (typeof value === 'object') return '{…}';
  return String(value);
}

export function AdminManifestTable<T extends Record<string, unknown>>({
  rows,
  idKey,
  columns,
  selectedId,
  onSelect,
  rowState,
}: Props<T>) {
  if (rows.length === 0) {
    return (
      <div className="nx-admin-manifest-table nx-admin-manifest-table--empty">
        (no entries configured)
      </div>
    );
  }
  return (
    <table className="nx-admin-manifest-table">
      <thead>
        <tr>
          {columns.map(c => (
            <th key={c.key}>{c.label}</th>
          ))}
          <th>state</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const id = String(row[idKey]);
          const state = (rowState ?? defaultRowState)(row);
          const isSelected = selectedId === id;
          return (
            <tr
              key={id}
              className={
                isSelected
                  ? 'nx-admin-manifest-table__row nx-admin-manifest-table__row--selected'
                  : 'nx-admin-manifest-table__row'
              }
              onClick={onSelect ? () => onSelect(id) : undefined}
              data-row-id={id}
            >
              {columns.map(c => {
                const raw = row[c.key];
                const text = c.render ? c.render(raw, row) : defaultRender(raw);
                return <td key={c.key}>{text}</td>;
              })}
              <td>
                <AdminStatusBadge state={state} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
