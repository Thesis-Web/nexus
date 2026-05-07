// packages/workspace-ref/src/client/components/admin/admin-reauth-gate.tsx
// SPEC-addendum §2.1 (auth state machine), §6 — AdminReauthGate.
//
// Calls vaultChallenge → vaultVerify; on success calls onSuccess(elevatedSessionId).
// Reference impl supports password_reauth and api_key_reauth methods only,
// per packages/workspace-ref/src/auth/elevated-auth-provider.ts.

import { useState } from 'react';
import { vaultChallenge, vaultVerify } from '../../api.js';

interface Props {
  principalId: string;
  onSuccess: (elevatedSessionId: string) => void;
  onCancel: () => void;
}

type Method = 'password_reauth' | 'api_key_reauth';
type Phase = 'idle' | 'challenging' | 'awaiting_response' | 'verifying';

export function AdminReauthGate({ principalId, onSuccess, onCancel }: Props) {
  const [method, setMethod] = useState<Method>('password_reauth');
  const [phase, setPhase] = useState<Phase>('idle');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleChallenge = async () => {
    setPhase('challenging');
    setError(null);
    const res = await vaultChallenge(principalId, method);
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Challenge failed');
      setPhase('idle');
      return;
    }
    setChallengeId(res.data.challengeId);
    setPrompt(res.data.prompt);
    setPhase('awaiting_response');
  };

  const handleVerify = async () => {
    if (!challengeId) return;
    setPhase('verifying');
    setError(null);
    const res = await vaultVerify({
      challengeId,
      principalId,
      method,
      response,
    });
    if (!res.ok || !res.data) {
      setError(res.error ?? 'Verification failed');
      setPhase('awaiting_response');
      return;
    }
    onSuccess(res.data.elevatedSessionId);
  };

  return (
    <div className="nx-admin-reauth-gate" role="dialog" aria-modal="true">
      <div className="nx-admin-reauth-gate__panel">
        <h2>Elevated re-authentication required</h2>
        <p className="nx-admin-reauth-gate__principal">
          Principal: <code>{principalId || '(unknown)'}</code>
        </p>

        {phase === 'idle' && (
          <>
            <label>
              Method:{' '}
              <select value={method} onChange={e => setMethod(e.target.value as Method)}>
                <option value="password_reauth">Password</option>
                <option value="api_key_reauth">API key</option>
              </select>
            </label>
            <div className="nx-admin-reauth-gate__actions">
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" onClick={() => void handleChallenge()}>
                Continue
              </button>
            </div>
          </>
        )}

        {phase === 'challenging' && <p>Requesting challenge…</p>}

        {phase === 'awaiting_response' && (
          <>
            <p className="nx-admin-reauth-gate__prompt">{prompt}</p>
            <input
              type="password"
              autoFocus
              value={response}
              onChange={e => setResponse(e.target.value)}
              className="nx-admin-reauth-gate__response"
              placeholder="Response"
            />
            <div className="nx-admin-reauth-gate__actions">
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleVerify()}
                disabled={response.length === 0}
              >
                Verify
              </button>
            </div>
          </>
        )}

        {phase === 'verifying' && <p>Verifying…</p>}

        {error && (
          <p className="nx-admin-reauth-gate__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
