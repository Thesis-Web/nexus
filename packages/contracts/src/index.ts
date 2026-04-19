// packages/contracts/src/index.ts
// @nexus/contracts — Layer 2 barrel export
// Spec: nexus-engineering-spec-v1-7-25.md §12
//
// All shared types, interfaces, and governed constants.
// Every other layer imports from this package.
// This package imports NOTHING inside the monorepo.

export * from './types/index.js';
export * from './constants/index.js';
export * from './interfaces/index.js';
