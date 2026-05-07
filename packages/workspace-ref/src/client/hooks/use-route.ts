// packages/workspace-ref/src/client/hooks/use-route.ts
// Owner ruling SCOPE-A01 (2026-05-06): real /admin URL route.
//
// Vanilla History-API route state. No react-router-dom dependency added —
// keeps the patch minimal and avoids new bundle weight for two routes.

import { useState, useEffect, useCallback } from 'react';

export type RouteName = 'workspace' | 'admin';

function pathToRoute(pathname: string): RouteName {
  return pathname.startsWith('/admin') ? 'admin' : 'workspace';
}

export interface RouteApi {
  route: RouteName;
  navigate: (next: RouteName) => void;
}

export function useRoute(): RouteApi {
  const [route, setRoute] = useState<RouteName>(() => pathToRoute(window.location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(pathToRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: RouteName) => {
    const pathname = next === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== pathname) {
      window.history.pushState({}, '', pathname);
    }
    setRoute(next);
  }, []);

  return { route, navigate };
}
