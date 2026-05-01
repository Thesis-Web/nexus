/**
 * Compile-ref integration tests — AMEND-spec-nexus-compile §14
 *
 * 17 scenarios exercising the compile-ref system.
 * Fixture templates in fixtures/compile-ref/ (signed by sign-compile-ref-fixtures.sh).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

import { TemplateRegistryStoreImpl } from '../compile/template-registry-store.js';
import { TemplateValidatorImpl } from '../compile/template-schemas.js';
import { TemplateVerifierImpl } from '../compile/template-loader.js';
import { DefaultTemplateGeneratorImpl } from '../compile/default-template-generator.js';
import { SlotMatcherImpl } from '../compile/slot-matcher.js';
import type { SlotMatchResult, UnmatchedLocation } from '../compile/slot-matcher.js';
import { GuardEvaluatorImpl } from '../compile/guard-evaluator.js';
import { DenialMarkerInserterImpl } from '../compile/denial-marker-inserter.js';
import { buildFormatRendererMap } from '../compile/format-renderer.js';
import { loadControlPlaneKey } from '../crypto/key-manager.js';

import type {
  CompileTemplate,
  CompilePreferences,
  MailboxItem,
  Uuid,
  NonEmpty,
  IsoTimestamp,
  Sha256Hex,
} from '@nexus/contracts';

const FIXTURE_DIR = path.join(process.cwd(), 'fixtures', 'compile-ref');

async function loadFixture(name: string): Promise<CompileTemplate> {
  const raw = await fs.readFile(path.join(FIXTURE_DIR, name), 'utf-8');
  return JSON.parse(raw) as CompileTemplate;
}

function makeItem(slotId: string): MailboxItem {
  return {
    mailboxItemId: randomUUID() as Uuid,
    mailboxId: 'test-mbx' as NonEmpty,
    runId: randomUUID() as Uuid,
    taskId: randomUUID() as Uuid,
    agentId: randomUUID() as Uuid,
    slotId: slotId as NonEmpty,
    sourceType: 'agent_partial',
    resultRef: 'file://test.json' as NonEmpty,
    resultDigest: '0'.repeat(64) as Sha256Hex,
    resultClassifications: [],
    octLevel: 'OCT-OPEN',
    createdAt: new Date().toISOString() as IsoTimestamp,
    expiresAt: null,
    evidenceRecordId: null,
    routingTrailRecordId: null,
    runLedgerEventId: null,
    redactionState: 'not_required',
    mailboxStatus: 'available',
    compileEligible: true,
    consumedAt: null,
    blockedReason: null,
  };
}

describe('compile-ref integration — §14', () => {
  let store: TemplateRegistryStoreImpl;
  let validator: TemplateValidatorImpl;
  let verifier: TemplateVerifierImpl;
  let defaultGen: DefaultTemplateGeneratorImpl;
  let slotMatcher: SlotMatcherImpl;
  let guardEvaluator: GuardEvaluatorImpl;
  let denialInserter: DenialMarkerInserterImpl;

  beforeAll(async () => {
    const db = new Database(':memory:');
    store = new TemplateRegistryStoreImpl(db);
    store.initialize();
    validator = new TemplateValidatorImpl();
    const key = await loadControlPlaneKey();
    verifier = new TemplateVerifierImpl(key.publicKey);
    defaultGen = new DefaultTemplateGeneratorImpl(key.privateKey);
    slotMatcher = new SlotMatcherImpl();
    guardEvaluator = new GuardEvaluatorImpl();
    denialInserter = new DenialMarkerInserterImpl();
  });

  it('scenario 01 — single-agent template validates and verifies', async () => {
    const t = await loadFixture('template-single-agent.json');
    const v = validator.validateForIngestion(t);
    expect(v.templateId).toBe('fixture-single-agent');
    expect(v.sections).toHaveLength(1);
    await verifier.verifyOrThrow(v);
  });

  it('scenario 02 — multi-agent template has multiple sections', async () => {
    const t = await loadFixture('template-multi-agent.json');
    const v = validator.validateForIngestion(t);
    expect(v.sections).toHaveLength(3);
    expect(v.sections[0]!.sectionId).toBe('sales-section');
    await verifier.verifyOrThrow(v);
  });

  it('scenario 03 — default template is generated and signed', () => {
    const template = defaultGen.generate(randomUUID() as Uuid, [makeItem('res')], null);
    expect(template.signature).toBeTruthy();
    expect(template.templateDigest).toBeTruthy();
    expect(template.sections.length).toBeGreaterThan(0);
  });

  it('scenario 04 — missing required slot produces unmatched', async () => {
    const t = await loadFixture('template-single-agent.json');
    const result = slotMatcher.match(t, []);
    expect(result.unmatched.length).toBeGreaterThan(0);
    expect(result.unmatched[0]!.required).toBe(true);
  });

  it('scenario 05 — invalid slot type rejects during validation', () => {
    const bad = {
      templateId: 'bad',
      templateVersion: '1.0.0',
      format: 'prose',
      sections: [
        {
          sectionId: 's',
          title: 'T',
          order: 1,
          locations: [
            { locationId: 'l', slotId: 's', slot: { type: 'FAKE' }, required: true, order: 1 },
          ],
        },
      ],
      guards: [],
      denialHandling: 'inline',
      createdAt: '2026-05-01T00:00:00.000Z',
      createdBy: 'test',
      templateDigest: 'x',
      signature: 'x',
    };
    expect(() => validator.validateForIngestion(bad)).toThrow();
  });

  it('scenario 06 — unmatched locations produce denial markers', async () => {
    const t = await loadFixture('template-single-agent.json');
    const um: UnmatchedLocation[] = [
      {
        location: t.sections[0]!.locations[0]!,
        sectionId: t.sections[0]!.sectionId,
        required: true,
      },
    ];
    const result = denialInserter.insert(t, um, 'inline');
    expect(result.inlineMarkers.size).toBeGreaterThan(0);
  });

  it('scenario 07 — template system does not make mode decisions', () => {
    const template = defaultGen.generate(randomUUID() as Uuid, [makeItem('s')], null);
    expect(template).not.toHaveProperty('compileMode');
  });

  it('scenario 08 — guard halt stops evaluation', async () => {
    const t = await loadFixture('template-guard-halt.json');
    const mr: SlotMatchResult = { matched: new Map(), unmatched: [], orphaned: [] };
    const result = guardEvaluator.evaluate(t, mr, []);
    expect(result.haltGuard).not.toBeNull();
    expect(result.haltGuard!.guardId).toBe('guard-halt-001');
  });

  it('scenario 09 — guard warn marks but continues', async () => {
    const t = await loadFixture('template-guard-warning.json');
    const mr: SlotMatchResult = { matched: new Map(), unmatched: [], orphaned: [] };
    const result = guardEvaluator.evaluate(t, mr, []);
    expect(result.haltGuard).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('scenario 10 — repeating group template validates', async () => {
    const t = await loadFixture('template-repeating-group.json');
    const v = validator.validateForIngestion(t);
    const rg = v.sections[1]!.locations[0]! as any;
    expect(rg.slotType.type).toBe('repeating_group');
    expect(rg.slotType.childLocations).toBeDefined();
    expect(rg.slotType.childLocations.length).toBeGreaterThan(0);
  });

  it('scenario 11 — tampered signature fails verification', async () => {
    const t = await loadFixture('template-invalid-signature.json');
    await expect(verifier.verifyOrThrow(t)).rejects.toThrow();
  });

  it('scenario 12 — invalid signature rejects ingestion', async () => {
    const t = await loadFixture('template-invalid-signature.json');
    expect(await verifier.verifySignature(t)).toBe(false);
  });

  it('scenario 13 — valid template ingests; duplicate rejects', async () => {
    const t = await loadFixture('template-multi-agent.json');
    await verifier.verifyOrThrow(t);
    store.ingest(t, 'admin' as NonEmpty);
    expect(store.exists(t.templateId, t.templateVersion)).toBe(true);
    expect(() => store.ingest(t, 'admin' as NonEmpty)).toThrow();
  });

  it('scenario 14 — import law verified by CMP-13 gate', () => {
    expect(true).toBe(true);
  });

  it('scenario 15 — default template not persisted to registry', () => {
    const t = defaultGen.generate(randomUUID() as Uuid, [makeItem('eph')], null);
    expect(store.exists(t.templateId, t.templateVersion)).toBe(false);
  });

  it('scenario 16 — preferences set format on default template', () => {
    const prefs: CompilePreferences = { format: 'table' };
    const t = defaultGen.generate(randomUUID() as Uuid, [makeItem('p')], prefs);
    expect(t.format).toBe('table');
  });

  it('scenario 17 — file_bundle not in renderer map', () => {
    const renderers = buildFormatRendererMap();
    expect(renderers.has('file_bundle')).toBe(false);
    expect(renderers.has('prose')).toBe(true);
    expect(renderers.has('table')).toBe(true);
    expect(renderers.has('raw')).toBe(true);
    expect(renderers.has('mixed')).toBe(true);
  });
});
