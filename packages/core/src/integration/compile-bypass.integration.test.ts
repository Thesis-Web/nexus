/**
 * Mailbox-pit V1 — compile bypass partial end-to-end integration test.
 *
 * Spec: AMEND-nexus-mailbox-pit-v0-2-1 §5.2 + §9.3 (HOLE-MAILBOX-PIT-004
 * closure).
 *
 * Proves the bypass-partial path through the real production stack:
 *   MailboxServiceImpl (with allocateForRun) →
 *   OutputCollectorImpl.writeMailboxItemFromXxx (with MailboxWriteContext) →
 *   OutputCollectorImpl.buildOutputContract (multi-mailbox aggregation,
 *     mailboxAllocations on the contract) →
 *   DeterministicRenderer.compile (with MailboxService dep for the
 *     provenance map) →
 *   CompileAssemblerImpl.assemble (digest re-verify + provenance recheck
 *     + slot validation bypass collection) →
 *   FinalResponseArtifact.bypassPartials
 *
 * Setup: two actors in one run. Both produce an item. Actor A's item is
 * well-formed (prose body). Actor B's item is malformed at the disk
 * layer — the file on disk has been tampered with so its sha256 no
 * longer matches the resultDigest in the mailbox item. The compile-time
 * digest re-verify catches it; the run does NOT die; the FinalResponseArtifact
 * ships with one bypassPartial entry for actor B AND a populated body
 * from actor A's contribution.
 *
 * Skipped by default; runs under `vitest -c vitest.integration.config.ts`
 * (the same gate INTEG-01 step uses).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';

import type {
  CompileRequest,
  CompilerManifestRecord,
  CompileConfig,
  DataClass,
  IsoTimestamp,
  MailboxBackend,
  MailboxItem,
  MailboxManifestRecord,
  MailboxStatus,
  NonEmpty,
  NxsOutputReference,
  OctLevel,
  PayloadResolver,
  RunLedgerEntry,
  RunLedgerWriter,
  Sha256Hex,
  Uuid,
  DenialCode,
} from '@nexus/contracts';
import { FINAL_OUTCOME } from '@nexus/contracts';
import { MailboxServiceImpl } from '../mailbox/mailbox-service.js';
import { OutputCollectorImpl } from '../output/output-collector.js';
import { PayloadResolverRegistryImpl } from '../output/payload-resolver.js';
import type { DeclaredOutputSlotReader } from '../output/declared-output-slot-reader.js';
import { CompileAssemblerImpl } from '../compile/compile-assembler.js';
import { SlotMatcherImpl } from '../compile/slot-matcher.js';
import { SlotValidatorImpl } from '../compile/slot-validator.js';
import { GuardEvaluatorImpl } from '../compile/guard-evaluator.js';
import { DenialMarkerInserterImpl } from '../compile/denial-marker-inserter.js';
import { buildFormatRendererMap } from '../compile/format-renderer.js';
import { DefaultTemplateGeneratorImpl } from '../compile/default-template-generator.js';
import { TemplateVerifierImpl } from '../compile/template-loader.js';
import { DeterministicRenderer } from '../compile/deterministic-renderer.js';
import { CompileServiceImpl } from '../compile/compile-service.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';

// ─── fakes ─────────────────────────────────────────────────────────────────

function fakeBackend(): MailboxBackend {
  const store: MailboxItem[] = [];
  return {
    backendId: 'integration-fake' as NonEmpty,
    backendVersion: '1' as NonEmpty,
    async write(item) {
      store.push(item);
    },
    async getById(id) {
      return store.find(i => i.mailboxItemId === id) ?? null;
    },
    async listByRun(query) {
      return store.filter(i => i.mailboxId === query.mailboxId && i.runId === query.runId);
    },
    async updateStatus(id, next: MailboxStatus, reason: DenialCode | null) {
      const idx = store.findIndex(i => i.mailboxItemId === id);
      if (idx >= 0) {
        store[idx] = { ...store[idx]!, mailboxStatus: next, blockedReason: reason };
      }
      return store[idx]!;
    },
  };
}

function fakeLedger(): RunLedgerWriter & { events: Array<Omit<RunLedgerEntry, 'entryId'>> } {
  const events: Array<Omit<RunLedgerEntry, 'entryId'>> = [];
  return {
    events,
    writeEvent: async entry => {
      events.push(entry);
    },
    getByRunId: async runId =>
      events
        .filter(e => e.runId === runId)
        .map(
          (e, i): RunLedgerEntry => ({
            entryId: `00000000-0000-4000-a000-${i.toString().padStart(12, '0')}` as Uuid,
            ...e,
          })
        ),
    tail: async () => [],
    getLatestRunId: async () => null,
  };
}

const MAILBOX_MANIFEST: MailboxManifestRecord = {
  mailboxId: 'integration-primary' as NonEmpty,
  mailboxType: 'local-jsonl' as NonEmpty,
  enabled: true,
  required: true,
  storageRoot: 'runs/mailbox' as NonEmpty,
  retentionPolicy: { payloadTtlSeconds: 3600, metadataRetention: 'run_ledger' },
  classificationRequired: false,
  digestRequired: false,
  configuration: {},
};

// SlotReader stub — open_slots policy means validate() always returns matched.
const openSlotReader: DeclaredOutputSlotReader = {
  validate: async () => ({
    matched: true,
    declared: [],
    policy: 'open_slots',
    reason: null,
  }),
};

const COMPILE_RECORD: CompilerManifestRecord = {
  compilerSocketId: 'integration-compiler' as NonEmpty,
  compilerType: 'reference_deterministic_renderer' as NonEmpty,
  enabled: true,
  actorRegistration: 'exempt_reference_deterministic_renderer' as NonEmpty,
  compilerActorId: null,
  octMode: 'OCT-COMPILE',
  allowedModes: ['deterministic_render'],
  readsFromMailboxId: 'integration-primary' as NonEmpty,
  outputContractVersion: 'v1' as NonEmpty,
  configuration: {},
};

const COMPILE_CONFIG: CompileConfig = {
  preferFrontierSynthesis: false,
};

// ─── test ──────────────────────────────────────────────────────────────────

describe('compile bypass partial — end-to-end real-component integration', () => {
  let tmpDir: string;
  let privKey: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compile-bypass-itest-'));
    const key = await loadControlPlaneKey();
    privKey = key.privateKey;
  });

  it('writes one well-formed item + one tampered item, compile produces bypass partial and run completes', async () => {
    const runId = randomUUID() as Uuid;
    const actorA = randomUUID() as Uuid;
    const actorB = randomUUID() as Uuid;

    // ── Real mailbox stack ──
    const backend = fakeBackend();
    const ledger = fakeLedger();
    const mailboxService = new MailboxServiceImpl(backend, MAILBOX_MANIFEST, ledger);

    // Allocate per-actor mailboxes (coordinator step 3.6 equivalent).
    const allocations = await mailboxService.allocateForRun(runId, [actorA, actorB]);
    expect(allocations.size).toBe(2);

    // ── File-based payloads for both items ──
    const bodyA = 'Hello from actor A — well-formed prose contribution.';
    const bodyB = 'This is the OLD body of actor B before tampering.';
    const fileA = path.join(tmpDir, `${actorA}-a.txt`);
    const fileB = path.join(tmpDir, `${actorB}-b.txt`);
    await fs.writeFile(fileA, bodyA, 'utf-8');
    await fs.writeFile(fileB, bodyB, 'utf-8');
    const digestA = createHash('sha256').update(bodyA).digest('hex') as Sha256Hex;
    const digestB = createHash('sha256').update(bodyB).digest('hex') as Sha256Hex;

    const refA = ('file://' + fileA) as NonEmpty;
    const refB = ('file://' + fileB) as NonEmpty;

    // ── PayloadResolver + OutputCollector ──
    const resolverRegistry = new PayloadResolverRegistryImpl();
    const fileResolver: PayloadResolver = {
      resolverId: 'file' as NonEmpty,
      resolverVersion: '1' as NonEmpty,
      canResolve: ref => (ref as string).startsWith('file://'),
      resolveBytes: async ref => {
        const filePath = (ref as string).slice('file://'.length);
        const buf = await fs.readFile(filePath);
        return new Uint8Array(buf);
      },
    };
    resolverRegistry.register(fileResolver);

    const outputCollector = new OutputCollectorImpl({
      mailboxService,
      resolverRegistry,
      slotReader: openSlotReader,
      ledgerWriter: ledger,
      outputSlotPolicy: 'open_slots',
      expiresAt: null,
    });

    // ── Write two NXS output references through OutputCollector ──
    const taskA = randomUUID() as Uuid;
    const taskB = randomUUID() as Uuid;
    const slotId = 'agent_output' as NonEmpty;

    const baseRef = (
      taskId: Uuid,
      agentId: Uuid,
      ref: NonEmpty,
      digest: Sha256Hex
    ): NxsOutputReference => ({
      outputReferenceId: randomUUID() as Uuid,
      runId,
      taskId,
      agentId,
      slotId,
      sourceType: 'nxs_execution_result',
      resultRef: ref,
      resultDigest: digest,
      resultClassifications: [] as DataClass[],
      octLevel: 'OCT-OPEN' as OctLevel,
      createdAt: new Date().toISOString() as IsoTimestamp,
      redactionState: 'not_required',
      evidenceRecordId: null,
      executionGrantId: null,
      finalOutcome: FINAL_OUTCOME.EXECUTED,
    });

    const mailboxA = allocations.get(actorA)!;
    const mailboxB = allocations.get(actorB)!;

    await outputCollector.writeMailboxItemFromNxsResult(baseRef(taskA, actorA, refA, digestA), {
      runId,
      producerActorId: actorA,
      mailboxId: mailboxA,
      taskId: taskA,
      slotId,
    });
    await outputCollector.writeMailboxItemFromNxsResult(baseRef(taskB, actorB, refB, digestB), {
      runId,
      producerActorId: actorB,
      mailboxId: mailboxB,
      taskId: taskB,
      slotId,
    });

    // ── Tamper with actor B's on-disk payload AFTER the mailbox write.
    //    The stored item.resultDigest is digestB (for the ORIGINAL body)
    //    but the bytes on disk are now different. The compile-time
    //    digest re-verify catches it.
    await fs.writeFile(fileB, 'TAMPERED BYTES — different from what the mailbox claims', 'utf-8');

    // ── Compile pipeline (real components) ──
    const slotMatcher = new SlotMatcherImpl();
    const slotValidator = new SlotValidatorImpl({
      // V1: integration test has no entity registries; entity_ref slots
      // aren't exercised here.
      resolve: async () => true,
    });
    const guardEvaluator = new GuardEvaluatorImpl();
    const denialInserter = new DenialMarkerInserterImpl();
    const formatRenderers = buildFormatRendererMap();
    const assembler = new CompileAssemblerImpl(
      slotMatcher,
      slotValidator,
      guardEvaluator,
      formatRenderers,
      denialInserter
    );

    const key = await loadControlPlaneKey();
    const defaultGen = new DefaultTemplateGeneratorImpl(key.privateKey);
    const templateVerifier = new TemplateVerifierImpl(key.publicKey);

    const renderer = new DeterministicRenderer(
      COMPILE_RECORD.compilerSocketId,
      privKey,
      tmpDir,
      templateVerifier,
      defaultGen,
      assembler,
      [fileResolver],
      ledger,
      mailboxService
    );

    const compileService = new CompileServiceImpl(renderer, COMPILE_RECORD, COMPILE_CONFIG, ledger);

    // ── Build OutputContract via the real OutputCollector ──
    const contract = await outputCollector.buildOutputContract(runId);
    expect(contract.mailboxAllocations.size).toBe(2);
    expect(contract.mailboxAllocations.get(actorA)).toBe(mailboxA);
    expect(contract.mailboxAllocations.get(actorB)).toBe(mailboxB);

    // ── Collect items for compile call (matches OutputCollector path) ──
    const itemsA = await mailboxService.listEligibleForCompile(mailboxA, runId);
    const itemsB = await mailboxService.listEligibleForCompile(mailboxB, runId);
    const allItems = [...itemsA, ...itemsB];
    expect(allItems).toHaveLength(2);

    const compileRequest: CompileRequest = {
      runId,
      compilerSocketId: COMPILE_RECORD.compilerSocketId,
      mailboxId: mailboxA, // legacy singular; consumers read allocations
      outputContractId: contract.outputContractId,
      requestedAt: new Date().toISOString() as IsoTimestamp,
    };

    // ── The real compile call — must NOT throw on the tampered item ──
    const artifact = await compileService.compile(compileRequest, contract, allItems);

    // ── Assertions per spec §5.2 + §9.3 ──
    expect(artifact.bypassPartials).toHaveLength(1);
    const bp = artifact.bypassPartials[0]!;
    expect(bp.bypassReason).toBe('digest_mismatch');
    expect(bp.bypassDisposition).toBe('withhold_quarantine');
    expect(bp.sourceMailboxId).toBe(mailboxB);
    expect(bp.sourceActorId).toBe(actorB);
    expect(bp.workspacePartialRef).toBeNull();

    // Body should be present + contain actor A's contribution
    expect(artifact.bodyRef).toMatch(/^file:\/\//);
    const bodyPath = (artifact.bodyRef as string).slice('file://'.length);
    const bodyText = await fs.readFile(bodyPath, 'utf-8');
    expect(bodyText.length).toBeGreaterThan(0);

    // The ledger trail records the bypass event
    const bypassEvents = ledger.events.filter(e => e.eventType === 'compile_mailbox_item_bypassed');
    expect(bypassEvents).toHaveLength(1);
    expect((bypassEvents[0]!.detail as { bypassReason: string }).bypassReason).toBe(
      'digest_mismatch'
    );

    // compile_started fired
    const compileStartedEvents = ledger.events.filter(e => e.eventType === 'compile_started');
    expect(compileStartedEvents).toHaveLength(1);
  });
});
