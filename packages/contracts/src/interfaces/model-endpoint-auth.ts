/**
 * ModelEndpointAuth — spec §12.3.38
 *
 * File: packages/contracts/src/interfaces/model-endpoint-auth.ts
 *
 * Discriminated union governing endpoint authentication shape.
 * Schema-level enforcement via .strict() branches ensures correct
 * field presence/absence by kind at manifest load time.
 *
 * - kind: 'none'    → secretRef, headerName, prefix MUST be absent
 * - kind: 'api_key' → secretRef + headerName REQUIRED; prefix optional
 * - kind: 'bearer'  → secretRef + headerName REQUIRED; prefix optional
 */
import type { NonEmpty } from '../types/index.js';

export type ModelEndpointAuth =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'api_key' | 'bearer';
      readonly secretRef: NonEmpty;
      readonly headerName: NonEmpty;
      readonly prefix?: NonEmpty;
    };
