/**
 * EnvSecretSource — spec §12.3.39
 *
 * File: packages/vanguard/src/transport/secrets/env-secret-source.ts
 * Layer 3 — imports from @nexus/contracts only.
 *
 * Environment-variable-backed SecretSource. secretRef is the env var name.
 *
 * Semantics:
 *   - canResolve: returns true if env var is defined (non-undefined); does NOT
 *     read or log the value. Loader calls this at manifest load time (§26.5 Step 7).
 *   - resolve: returns the env var value (string) or null if undefined.
 *     Caller maps null → NVG_TRANSPORT_AUTH_MISSING.
 *     Caller maps thrown Error → NVG_TRANSPORT_SECRET_SOURCE_ERROR.
 *   - MUST NOT log or expose the secret value in any code path.
 */
import type { SecretSource } from '@nexus/contracts';

export class EnvSecretSource implements SecretSource {
  async canResolve(secretRef: string): Promise<boolean> {
    // Presence check only — does not read or expose the value
    return process.env[secretRef] !== undefined;
  }

  async resolve(secretRef: string): Promise<string | null> {
    const value = process.env[secretRef];
    if (value === undefined) {
      return null;
    }
    return value;
  }
}
