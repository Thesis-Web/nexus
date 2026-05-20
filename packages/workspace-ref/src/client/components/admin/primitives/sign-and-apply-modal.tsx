// packages/workspace-ref/src/client/components/admin/primitives/sign-and-apply-modal.tsx
//
// F4.13 §4 — Sign-and-Apply modal primitive.
//
// Every governance-relevant admin mutation flows through the server-side
// `SignedAdminMutation` envelope wrapper (HL #10). The browser NEVER holds
// the admin signing keypair (feedback_signing_keys_server_side, 2026-05-15);
// instead the server's AdminMutationServerSignerPort signs the canonical
// payload internally from `keys/admins/<opener>.keypair.json`.
//
// This modal is the explicit UI gate the spec calls for:
//
//   1. Shows the canonical payload preview before any submit happens, so
//      the operator can verify what is about to be signed + applied.
//   2. Renders the `mutationKind` + opener identity so the operator knows
//      what audit event will pair with the action.
//   3. Single "Sign and apply" button — the actual signing happens
//      server-side via the wrapper; the modal just gates the form submit.
//   4. Surfaces the wrapper's 207 `state: 'committed_but_audit_failed'`
//      response with a remediation banner (spec §3.2 / §4).
//
// Panels integrate this primitive by replacing direct fetch calls with
// `await signAndApply({ url, mutationKind, payload, method })` — the
// helper opens the modal, awaits user confirmation, posts, and returns the
// server response.

import { useState, type ReactNode } from 'react';
import type { AdminMutationKind } from '@nexus/contracts';

/** Wire shape for the wrapper's success / 207 / failure responses. */
export interface AdminMutationResponse {
  readonly ok: boolean;
  /** 207 `committed_but_audit_failed` carries `state` set. */
  readonly state?: 'committed_but_audit_failed';
  readonly data?: Record<string, unknown>;
  readonly error?: string;
  readonly denialCode?: string;
  readonly warning?: string;
}

export interface SignAndApplyModalProps {
  readonly open: boolean;
  readonly mutationKind: AdminMutationKind;
  readonly canonicalPreview: unknown;
  readonly busy?: boolean;
  readonly errorMessage?: string;
  readonly auditFailedWarning?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly footerChildren?: ReactNode;
}

export function SignAndApplyModal(props: SignAndApplyModalProps) {
  if (!props.open) return null;
  const preview = JSON.stringify(props.canonicalPreview, null, 2);
  return (
    <div className="nx-admin-modal nx-admin-sign-modal" role="dialog" aria-modal="true">
      <div className="nx-admin-modal__panel">
        <header className="nx-admin-modal__header">
          <h3>Sign and apply admin mutation</h3>
          <span className="nx-admin-modal__kind">
            <code>{props.mutationKind}</code>
          </span>
        </header>
        <p className="nx-admin-modal__hint">
          The canonical payload below will be signed server-side using the elevated admin's keypair
          (<code>keys/admins/&lt;principal&gt;.keypair.json</code>) and recorded in the infra Run
          Ledger before the mutation runs.
        </p>
        <pre className="nx-admin-modal__preview" aria-label="canonical payload preview">
          {preview}
        </pre>
        {props.auditFailedWarning && (
          <div className="nx-admin-modal__audit-warning" role="alert">
            <strong>Audit ledger gap:</strong> {props.auditFailedWarning}
          </div>
        )}
        {props.errorMessage && (
          <div className="nx-admin-modal__error" role="alert">
            {props.errorMessage}
          </div>
        )}
        <footer className="nx-admin-modal__footer">
          {props.footerChildren}
          <button
            type="button"
            className="nx-admin-modal__cancel"
            onClick={props.onCancel}
            disabled={props.busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="nx-admin-modal__confirm"
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? 'Signing…' : 'Sign and apply'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Hook that wires a panel's form submit through the Sign-and-Apply modal.
 *
 * Usage:
 *
 *   const sign = useSignAndApply();
 *   const onSubmit = async () => {
 *     const result = await sign.run({
 *       url: '/workspace/admin/setup/endpoints',
 *       method: 'POST',
 *       mutationKind: 'manifest_entry_add',
 *       payload: formState,
 *     });
 *     if (result.ok) { ... }
 *   };
 *
 *   return (
 *     <>
 *       ...form...
 *       <SignAndApplyModal {...sign.modalProps} />
 *     </>
 *   );
 */
export interface SignAndApplyRunArgs {
  readonly url: string;
  readonly method?: 'POST' | 'PUT' | 'DELETE';
  readonly mutationKind: AdminMutationKind;
  readonly payload: unknown;
  readonly headers?: Record<string, string>;
}

export function useSignAndApply(): {
  modalProps: SignAndApplyModalProps;
  run: (args: SignAndApplyRunArgs) => Promise<AdminMutationResponse>;
} {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [warning, setWarning] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<unknown>(null);
  const [pendingKind, setPendingKind] = useState<AdminMutationKind>('manifest_entry_add');
  const [resolver, setResolver] = useState<((r: AdminMutationResponse) => void) | null>(null);
  const [args, setArgs] = useState<SignAndApplyRunArgs | null>(null);

  const handleConfirm = async () => {
    if (!args || !resolver) return;
    setBusy(true);
    setError(undefined);
    try {
      const method = args.method ?? 'POST';
      const requestInit: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(args.headers ?? {}),
        },
      };
      if (method !== 'DELETE') {
        requestInit.body = JSON.stringify(args.payload);
      }
      const res = await fetch(args.url, requestInit);
      const body: AdminMutationResponse = await res.json().catch(
        (): AdminMutationResponse => ({
          ok: false,
          error: `non-JSON response (HTTP ${res.status})`,
        })
      );
      if (res.status === 207 && body.state === 'committed_but_audit_failed') {
        setWarning(body.warning ?? 'mutation applied but audit ledger write failed');
        setBusy(false);
        resolver(body);
        return;
      }
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setBusy(false);
        resolver(body);
        return;
      }
      setBusy(false);
      setOpen(false);
      resolver(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setBusy(false);
      resolver({ ok: false, error: msg });
    }
  };

  const handleCancel = () => {
    if (busy) return;
    setOpen(false);
    if (resolver) resolver({ ok: false, error: 'cancelled' });
  };

  const run = (a: SignAndApplyRunArgs): Promise<AdminMutationResponse> => {
    setArgs(a);
    setPendingKind(a.mutationKind);
    setPreview({ mutationKind: a.mutationKind, payload: a.payload });
    setError(undefined);
    setWarning(undefined);
    setOpen(true);
    return new Promise(resolve => setResolver(() => resolve));
  };

  return {
    modalProps: {
      open,
      mutationKind: pendingKind,
      canonicalPreview: preview,
      busy,
      ...(error ? { errorMessage: error } : {}),
      ...(warning ? { auditFailedWarning: warning } : {}),
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
    run,
  };
}
