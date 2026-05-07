// packages/workspace-ref/src/client/hooks/use-elevated-session.ts
// SPEC-addendum-beta1-admin-dashboard-v0-1 §2 (elevated reauth gate).
// SPEC-addendum §9 prohibition: no localStorage long-lived admin token.
// Hard rule 31: elevated session via X-Elevated-Session header — not query string.
//
// Manages elevated session lifecycle:
//   - holds elevatedSessionId (UUID only — never a bearer secret)
//   - polls /workspace/vault/session every 30s for principal-bound validity
//   - clears state on expiry/invalid/principal-mismatch
//   - sessionStorage (not localStorage) for tab-bounded persistence

import { useState, useEffect, useCallback } from 'react';
import { vaultSessionStatus } from '../api.js';

const STORAGE_KEY = 'nexus_ws_elev_sid';
const POLL_INTERVAL_MS = 30_000;

export interface ElevatedSessionState {
  elevatedSessionId: string | null;
  valid: boolean;
  remainingSeconds: number;
  error: string | null;
}

export interface ElevatedSessionApi extends ElevatedSessionState {
  set: (id: string) => void;
  clear: () => void;
}

const INITIAL: ElevatedSessionState = {
  elevatedSessionId: null,
  valid: false,
  remainingSeconds: 0,
  error: null,
};

export function useElevatedSession(): ElevatedSessionApi {
  const [state, setState] = useState<ElevatedSessionState>(() => {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? { ...INITIAL, elevatedSessionId: saved } : INITIAL;
  });

  const set = useCallback((id: string) => {
    sessionStorage.setItem(STORAGE_KEY, id);
    setState({
      elevatedSessionId: id,
      valid: true,
      remainingSeconds: 0,
      error: null,
    });
  }, []);

  const clear = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setState(INITIAL);
  }, []);

  // Server-authoritative validity poll.
  useEffect(() => {
    const sid = state.elevatedSessionId;
    if (!sid) return;
    let cancelled = false;

    const probe = async () => {
      try {
        const res = await vaultSessionStatus(sid);
        if (cancelled) return;
        if (!res.ok || !res.data || !res.data.valid) {
          sessionStorage.removeItem(STORAGE_KEY);
          setState({
            elevatedSessionId: null,
            valid: false,
            remainingSeconds: 0,
            error: res.data?.reason ?? res.error ?? 'Session invalid',
          });
          return;
        }
        setState(s => ({
          ...s,
          valid: true,
          remainingSeconds: res.data!.remainingSeconds,
          error: null,
        }));
      } catch (err) {
        if (cancelled) return;
        setState(s => ({
          ...s,
          error: err instanceof Error ? err.message : 'Network error',
        }));
      }
    };

    void probe();
    const timer = setInterval(probe, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state.elevatedSessionId]);

  return { ...state, set, clear };
}
