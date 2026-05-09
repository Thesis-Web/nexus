// packages/workspace-ref/src/client/components/admin/primitives/admin-manifest-read-form.tsx
//
// SPEC-addendum-beta1-admin-dashboard-v0-1 §6 — AdminManifestReadForm primitive.
// HANDOFF-CLAUDE-B §8 acceptance gate: save/apply MUST be disabled.
// OR-DASH-011 (owner ruling): no raw YAML editor for Beta1.
//
// Renders a manifest entry as a list of label/value rows. Nested objects are
// rendered as indented sub-rows. Array values render as count-prefixed
// previews. Secret-bearing fields must be passed via a separate
// AdminSecretField (not rendered here) — this form refuses to display anything
// keyed `secretRef`, `apiKey`, `bearer`, etc., to enforce no-raw-secrets.
//
// The footer holds a disabled save button + reason banner. The save button is
// the canonical insertion point for future writer wiring (when ratified).

import { AdminDisabledMutationBanner } from '../admin-disabled-mutation-banner.js';
import { AdminSecretField } from './admin-secret-field.js';
import type { DashboardSecretField } from '@nexus/contracts';

interface Props {
  /** Manifest entry to render (any record shape). */
  entry: Record<string, unknown> | null;
  /** Optional title for the form (e.g. "Identity provider — ria"). */
  title?: string | undefined;
  /** Secret fields associated with this entry (rendered via AdminSecretField). */
  secretFields?: readonly DashboardSecretField[] | undefined;
  /** Save button label — defaults to "Save (disabled)". */
  saveLabel?: string | undefined;
  /** Reason text on disabled mutation banner. */
  disabledReason?: string | undefined;
}

const REDACT_KEYS = new Set([
  'secretref',
  'apikey',
  'api_key',
  'bearer',
  'token',
  'password',
  'passphrase',
  'privatekey',
  'private_key',
]);

function shouldRedact(key: string): boolean {
  return REDACT_KEYS.has(key.toLowerCase());
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  }
  if (typeof value === 'object') {
    return '{…}';
  }
  return String(value);
}

interface RowProps {
  k: string;
  v: unknown;
  depth: number;
}

function Row({ k, v, depth }: RowProps) {
  // Recursively expand plain objects (but never arrays — those render as count).
  const isPlainObject =
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;

  if (shouldRedact(k)) {
    return (
      <li
        className={`nx-admin-manifest-read-form__row nx-admin-manifest-read-form__row--depth-${depth}`}
      >
        <span className="nx-admin-manifest-read-form__key">{k}</span>
        <span className="nx-admin-manifest-read-form__value nx-admin-manifest-read-form__value--redacted">
          (redacted — see secret fields)
        </span>
      </li>
    );
  }

  if (isPlainObject) {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return (
        <li
          className={`nx-admin-manifest-read-form__row nx-admin-manifest-read-form__row--depth-${depth}`}
        >
          <span className="nx-admin-manifest-read-form__key">{k}</span>
          <span className="nx-admin-manifest-read-form__value">{'{ }'}</span>
        </li>
      );
    }
    return (
      <li
        className={`nx-admin-manifest-read-form__row nx-admin-manifest-read-form__row--depth-${depth} nx-admin-manifest-read-form__row--object`}
      >
        <span className="nx-admin-manifest-read-form__key">{k}</span>
        <ul className="nx-admin-manifest-read-form__sublist">
          {keys.map(sk => (
            <Row key={sk} k={sk} v={obj[sk]} depth={depth + 1} />
          ))}
        </ul>
      </li>
    );
  }

  return (
    <li
      className={`nx-admin-manifest-read-form__row nx-admin-manifest-read-form__row--depth-${depth}`}
    >
      <span className="nx-admin-manifest-read-form__key">{k}</span>
      <span className="nx-admin-manifest-read-form__value">{renderValue(v)}</span>
    </li>
  );
}

export function AdminManifestReadForm({
  entry,
  title,
  secretFields,
  saveLabel,
  disabledReason,
}: Props) {
  if (!entry) {
    return (
      <div className="nx-admin-manifest-read-form nx-admin-manifest-read-form--empty">
        (select an entry to view details)
      </div>
    );
  }
  const keys = Object.keys(entry);
  return (
    <div className="nx-admin-manifest-read-form">
      {title && <h3 className="nx-admin-manifest-read-form__title">{title}</h3>}
      <ul className="nx-admin-manifest-read-form__list">
        {keys.map(k => (
          <Row key={k} k={k} v={entry[k]} depth={0} />
        ))}
      </ul>

      {secretFields && secretFields.length > 0 && (
        <div className="nx-admin-manifest-read-form__secrets">
          <h4 className="nx-admin-manifest-read-form__secrets-title">Secret fields</h4>
          {secretFields.map(sf => (
            <AdminSecretField key={sf.fieldPath} fieldPath={sf.fieldPath} status={sf.status} />
          ))}
        </div>
      )}

      <AdminDisabledMutationBanner
        {...(disabledReason !== undefined ? { reason: disabledReason } : {})}
      />

      <div className="nx-admin-manifest-read-form__actions">
        <button
          type="button"
          className="nx-admin-manifest-read-form__save"
          disabled
          aria-disabled="true"
          title={disabledReason ?? 'Save disabled — writer endpoints not yet ratified'}
        >
          {saveLabel ?? 'Save (disabled)'}
        </button>
      </div>
    </div>
  );
}
