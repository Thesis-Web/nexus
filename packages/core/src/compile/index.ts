// packages/core/src/compile/index.ts
// AMEND-spec §8, §3.10 — Compile infrastructure barrel
// Layer 1 — baked compile infrastructure.

export { CompileServiceImpl } from './compile-service.js';
export { DeterministicRenderer } from './deterministic-renderer.js';
export { signArtifact, verifyArtifactSignature } from './final-response-signer.js';
export {
  CompileReturnDispatcherImpl,
  recomputeArtifactDigest,
  verifyCallbackAuth,
} from './compile-return-dispatcher.js';
export type {
  CompileReturnDispatchInput,
  CompileReturnDispatcher,
  CompileReturnDispatcherDeps,
} from './compile-return-dispatcher.js';
export {
  CompileTemplateError,
  CompileAssemblyError,
  CompileGuardHaltError,
} from './compile-errors.js';
