/**
 * Canonical serialization — thin re-export from @nexus/runtime-utils
 *
 * Per §32a.0.1 (HOLE-S10-001 CLOSED, owner ratification S10-T3):
 * Physical implementation lives in packages/runtime-utils/src/canonicalize.ts.
 * This file re-exports for backward compatibility — all 20+ relative-path
 * callers within packages/core/ continue to work unchanged.
 *
 * @nexus/core export compatibility preserved: CLI and other external
 * importers of { canonicalize } from '@nexus/core' continue to work.
 */
export { canonicalize } from '@nexus/runtime-utils';
