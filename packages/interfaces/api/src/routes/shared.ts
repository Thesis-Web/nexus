/**
 * API Routes — shared utilities
 * Spec: §23.2 | Blueprint: §24.7
 * Layer 7 — imports @nexus/contracts ONLY.
 */
import type { LoadedPolicyFile } from '@nexus/contracts';

/** Shared mutable state across route modules. */
export interface ApiSharedState {
  currentPolicy: LoadedPolicyFile | null;
}

/** Sanitize error messages for API responses (no secrets leak). */
export function san(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown error';
  return err.message
    .replace(/(secret|password|key|token|credential)[=:\s][^\s,;]*/gi, '[REDACTED]')
    .slice(0, 300);
}
