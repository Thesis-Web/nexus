// packages/contracts/src/externals/workspace-governed.ts
// AMEND-nexus-spec-workspace-v1-1-1 §1.4, §2, §3
// Layer 2 — workspace governed contract types and port interfaces.
//
// All workspace-specific types and port interfaces for the governed workspace
// reference implementation. Blueprint-pinned types materialized per
// B-NOTE-WS-TYPES-001 (owner-authorized).
//
// This file MUST NOT import from @nexus/core, @nexus/vanguard, or any
// implementation package. Internal contract imports only.
export const OUTPUT_FORMAT_VALUES = ['prose', 'table', 'raw', 'mixed', 'file_bundle'];
// ── [blueprint §3.9] ElevatedAuth types — AMENDED §2.4 ─────────────────────
export const ELEVATED_AUTH_METHOD = {
    PASSWORD_REAUTH: 'password_reauth',
    API_KEY_REAUTH: 'api_key_reauth',
};
