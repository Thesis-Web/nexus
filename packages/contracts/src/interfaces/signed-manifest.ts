/**
 * SignedManifest — spec §12.3.43 (NISP-002)
 *
 * File: packages/contracts/src/interfaces/signed-manifest.ts
 *
 * Generic signed manifest envelope. Type lives in contracts;
 * runtime loader lives in packages/runtime-utils/.
 */
import type { NonEmpty, IsoTimestamp, Base64Url } from '../types/index.js';

export interface SignedManifest<TBody> {
  readonly manifestVersion: NonEmpty;
  readonly issuer: NonEmpty;
  readonly issuedAt: IsoTimestamp;
  readonly signature: Base64Url;
  readonly body: TBody;
}
