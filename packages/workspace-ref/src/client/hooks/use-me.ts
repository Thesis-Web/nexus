// packages/workspace-ref/src/client/hooks/use-me.ts
// SPEC-addendum-beta1-admin-dashboard-v0-1 §2.2 (admin gate inputs).
// Fetches /workspace/me after authentication and exposes admin eligibility.

import { useState, useEffect } from 'react';
import { getMe, type WorkspaceMe } from '../api.js';
import { hasAdminRole } from '../admin-role.js';

export interface MeState {
  loading: boolean;
  data: WorkspaceMe | null;
  error: string | null;
  isAdmin: boolean;
}

const INITIAL: MeState = {
  loading: false,
  data: null,
  error: null,
  isAdmin: false,
};

export function useMe(authenticated: boolean): MeState {
  const [state, setState] = useState<MeState>(INITIAL);

  useEffect(() => {
    if (!authenticated) {
      setState(INITIAL);
      return;
    }
    let cancelled = false;
    setState({ ...INITIAL, loading: true });
    void (async () => {
      try {
        const res = await getMe();
        if (cancelled) return;
        if (!res.ok || !res.data) {
          setState({
            loading: false,
            data: null,
            error: res.error ?? 'Failed to load /workspace/me',
            isAdmin: false,
          });
          return;
        }
        const isAdmin = hasAdminRole(res.data.claims?.roleAssignments ?? null);
        setState({ loading: false, data: res.data, error: null, isAdmin });
      } catch (err) {
        if (cancelled) return;
        setState({
          loading: false,
          data: null,
          error: err instanceof Error ? err.message : 'Network error',
          isAdmin: false,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  return state;
}
