/**
 * Structural validation interface for per-adapter configuration schemas
 * — spec §12.3.40 (audit C-B).
 *
 * File: packages/contracts/src/interfaces/adapter-config-schema.ts
 *
 * Designed to be satisfied STRUCTURALLY by Zod's z.ZodSchema<TConfig> without
 * requiring contracts to import zod. Vanguard adapter implementations typically
 * author their schemas in Zod; other validation libraries with the same shape
 * also work.
 *
 * The endpoint manifest loader (§26.5 Step 6.5) calls safeParse(entry.adapterConfig)
 * after the forbidden-key check (§26.5 Step 6.4). On success, the loader has a
 * typed config; on failure, the loader throws a fail-closed startup error including
 * the issue path and message.
 */
export interface AdapterConfigSchema<TConfig> {
  safeParse(input: unknown):
    | { readonly success: true; readonly data: TConfig }
    | {
        readonly success: false;
        readonly error: {
          readonly issues: readonly {
            readonly path: readonly (string | number)[];
            readonly message: string;
          }[];
        };
      };
}
