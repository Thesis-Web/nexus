// packages/workspace-ref/src/client/components/login.tsx
// AMEND-nexus-spec-workspace §5.2 — workspace login screen.

import { useState } from 'react';

interface LoginProps {
  onLogin: (type: string, value: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function Login({ onLogin, loading, error }: LoginProps) {
  const [credType, setCredType] = useState('api_key');
  const [credValue, setCredValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!credValue.trim()) return;
    void onLogin(credType, credValue.trim());
  };

  return (
    <div className="nx-login-screen">
      <form className="nx-login-card" onSubmit={handleSubmit}>
        <div className="nx-login-title">Nexus Workspace</div>
        <div className="nx-login-subtitle">Governed workspace — identity-gated entry</div>

        {error && <div className="nx-error">{error}</div>}

        <div className="nx-field">
          <label>Authentication method</label>
          <select
            className="nx-select"
            style={{ width: '100%', padding: '8px 12px' }}
            value={credType}
            onChange={e => setCredType(e.target.value)}
          >
            <option value="api_key">API Key</option>
            <option value="jwt">JWT Token</option>
            <option value="oauth_token">OAuth Token</option>
          </select>
        </div>

        <div className="nx-field">
          <label>Credential</label>
          <input
            type="password"
            placeholder={
              credType === 'api_key'
                ? 'Enter API key'
                : credType === 'jwt'
                  ? 'Enter JWT token'
                  : 'Enter OAuth token'
            }
            value={credValue}
            onChange={e => setCredValue(e.target.value)}
            autoFocus
          />
        </div>

        <button
          type="submit"
          className="nx-btn nx-btn--primary"
          style={{ width: '100%', padding: '10px' }}
          disabled={loading || !credValue.trim()}
        >
          {loading ? 'Authenticating…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
