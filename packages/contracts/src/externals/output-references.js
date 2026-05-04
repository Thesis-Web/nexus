// packages/contracts/src/externals/output-references.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.4 — Output References
// Layer 2 — architecture-level output reference schemas.
//
// An output reference is NOT raw payload. It is metadata plus a payload
// reference and digest. NVG/NXS internals do not write mailbox items directly;
// the composition boundary adapts their returns into these output references.
//
// Law:
// - resultRef must be resolvable by the configured output collector and mailbox backend.
// - resultDigest must be SHA-256 of the exact bytes stored at or represented by resultRef.
// - resultClassifications must be non-empty when mailbox classificationRequired = true.
// - redactionState = 'blocked' makes the reference non-compile-eligible.
export {};
