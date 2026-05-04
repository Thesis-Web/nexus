// packages/workspace-ref/src/client/hooks/use-auth.ts
// AMEND-nexus-spec-workspace §5.2 — workspace JWT auth consumer.

import { useState, useCallback, useEffect } from 'react';
import { login as apiLogin, setToken, getToken, type LoginResult } from '../api.js';

export interface AuthState {
  authenticated: boolean;
  token: string | null;
  sessionId: string | null;
  expiresAt: string | null;
  loading: boolean;
  error: string | null;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(() => {
    const saved = sessionStorage.getItem('nexus_ws_token');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { token: string; sessionId: string; expiresAt: string };
        if (new Date(parsed.expiresAt).getTime() > Date.now()) {
          setToken(parsed.token);
          return {
            authenticated: true,
            token: parsed.token,
            sessionId: parsed.sessionId,
            expiresAt: parsed.expiresAt,
            loading: false,
            error: null,
          };
        }
      } catch {
        /* expired or corrupt — fall through */
      }
      sessionStorage.removeItem('nexus_ws_token');
    }
    return {
      authenticated: false,
      token: null,
      sessionId: null,
      expiresAt: null,
      loading: false,
      error: null,
    };
  });

  const login = useCallback(async (type: string, value: string) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiLogin(type, value);
      if (!res.ok || !res.data) {
        setState(s => ({ ...s, loading: false, error: res.error ?? 'Login failed' }));
        return;
      }
      const { token, workspaceAuthSessionId, expiresAt } = res.data;
      setToken(token);
      sessionStorage.setItem(
        'nexus_ws_token',
        JSON.stringify({ token, sessionId: workspaceAuthSessionId, expiresAt })
      );
      setState({
        authenticated: true,
        token,
        sessionId: workspaceAuthSessionId,
        expiresAt,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState(s => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Login failed',
      }));
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    sessionStorage.removeItem('nexus_ws_token');
    setState({
      authenticated: false,
      token: null,
      sessionId: null,
      expiresAt: null,
      loading: false,
      error: null,
    });
  }, []);

  // Auto-expire check
  useEffect(() => {
    if (!state.expiresAt) return;
    const ms = new Date(state.expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      logout();
      return;
    }
    const timer = setTimeout(logout, ms);
    return () => clearTimeout(timer);
  }, [state.expiresAt, logout]);

  return { ...state, login, logout };
}
