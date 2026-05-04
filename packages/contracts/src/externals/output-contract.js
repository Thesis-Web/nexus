// packages/contracts/src/externals/output-contract.ts
// AMEND-spec-nexus-infra-externals-v0-2-5 §3.7, §3.8 — OutputContract + OutputCollector
// Layer 2 — output contract metadata and output collector interface.
//
// OutputContract is metadata, not payload. Run Ledger stores OutputContract
// reference/digest by runId. Payloads live behind MailboxItem resultRef.
//
// Digest law:
//   contractDigest = sha256(canonicalize({
//     outputContractId, runId, mailboxId, mailboxItems,
//     inputDataClasses, inheritedCompileDataClass, compileEligibility,
//     runLedgerRefs, evidenceRefs, routingTrailRefs, createdAt
//   }))
//
// OutputCollector law:
// - Only lawful writer from engine/orchestrator results into mailbox.
// - Engine outputs are adapted into output references at the composition boundary.
// - Must write or cause a Run Ledger partial_result event for every
//   successful mailbox write.
export {};
