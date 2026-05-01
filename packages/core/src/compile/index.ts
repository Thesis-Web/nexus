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
export { TemplateRegistryStoreImpl } from './template-registry-store.js';
export type { TemplateRegistryStore } from './template-registry-store.js';
export {
  TemplateValidatorImpl,
  CompileTemplateSchema,
  CompileLocationSchema,
  CompileSectionSchema,
  CompileGuardSchema,
  SlotTypeSchema,
} from './template-schemas.js';
export type { TemplateValidator } from './template-schemas.js';
export {
  TemplateVerifierImpl,
  TemplateLoaderImpl,
  computeTemplateDigest,
} from './template-loader.js';
export type { TemplateVerifier, TemplateLoader } from './template-loader.js';
export { DefaultTemplateGeneratorImpl } from './default-template-generator.js';
export type { DefaultTemplateGenerator } from './default-template-generator.js';
export { SlotMatcherImpl } from './slot-matcher.js';
export type {
  SlotMatcher,
  SlotMatchResult,
  MatchedSlot,
  UnmatchedLocation,
  OrphanedItem,
} from './slot-matcher.js';
export { SlotValidatorImpl } from './slot-validator.js';
export type {
  SlotValidator,
  SlotValidationResult,
  SlotValidationError,
  EntityRefResolver,
} from './slot-validator.js';
export { GuardEvaluatorImpl } from './guard-evaluator.js';
export type {
  GuardEvaluator,
  GuardEvaluationResult,
  FiredGuard,
  GuardModification,
  GuardWarning,
} from './guard-evaluator.js';
export { DenialMarkerInserterImpl } from './denial-marker-inserter.js';
export type { DenialMarkerInserter, DenialOutput, DenialEntry } from './denial-marker-inserter.js';
export {
  ProseRenderer,
  TableRenderer,
  RawRenderer,
  MixedRenderer,
  buildFormatRendererMap,
  assertNotFileBundleFormat,
} from './format-renderer.js';
export type { FormatRenderer } from './format-renderer.js';
export { CompileAssemblerImpl } from './compile-assembler.js';
export type { CompileAssembler, AssemblyResult, ValidationFailure } from './compile-assembler.js';
