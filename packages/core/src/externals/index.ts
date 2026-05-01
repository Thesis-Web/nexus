// packages/core/src/externals/index.ts
// AMEND-spec §4.8 — Externals infrastructure barrel
// Layer 1 — baked externals infrastructure.

export { ExternalSocketRegistryImpl } from './external-socket-registry.js';
export type {
  ExternalSocketRegistry,
  ExternalSocketRegistryDeps,
} from './external-socket-registry.js';
