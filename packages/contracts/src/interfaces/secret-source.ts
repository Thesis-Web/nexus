/**
 * SecretSource — spec §12.3.39
 *
 * File: packages/contracts/src/interfaces/secret-source.ts
 *
 * Startup canResolve vs invoke-time resolve semantics:
 *   - canResolve: startup presence-check, no value exposed, no logging
 *   - resolve: invoke-time value fetch
 *     - null return → NVG_TRANSPORT_AUTH_MISSING (invoke-time only)
 *     - throw       → NVG_TRANSPORT_SECRET_SOURCE_ERROR
 *
 * AUTH_MISSING is invoke-time only — startup canResolve === false is a
 * fail-closed bootstrap error, not an invocation denial.
 */
export interface SecretSource {
  /**
   * Startup check: can this secretRef be resolved by this backend?
   * Does NOT read or log the secret value.
   *
   * Loader calls this at manifest load time for each enabled endpoint's
   * secretRef (§26.5 Step 7). If canResolve returns false, the loader
   * throws a fail-closed startup error.
   */
  canResolve(secretRef: string): Promise<boolean>;

  /**
   * Invoke-time resolution: resolve the secret value.
   *
   * @returns string — the resolved secret value
   * @returns null — secret not resolvable → caller maps to NVG_TRANSPORT_AUTH_MISSING
   * @throws Error — backend failure → caller maps to NVG_TRANSPORT_SECRET_SOURCE_ERROR
   */
  resolve(secretRef: string): Promise<string | null>;
}
