// packages/contracts/src/types/index.ts
// Spec: nexus-engineering-spec-v1-7-25.md §12.1 — Primitive Aliases
// Layer 2 — shared type definitions. Imports nothing inside the monorepo.

/** UUID v4 — from crypto.randomUUID() */
export type Uuid = string;

/** ISO 8601 UTC — from new Date().toISOString() */
export type IsoTimestamp = string;

/** 64-char lowercase hex */
export type Sha256Hex = string;

/** URL-safe base64, no padding */
export type Base64Url = string;

/** Validated non-empty at construction */
export type NonEmpty = string;

/** Semantic version string, e.g. "v1.4.12" */
export type SemVer = string;
