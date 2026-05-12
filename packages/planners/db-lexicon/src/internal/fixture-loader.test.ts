// packages/planners/db-lexicon/src/internal/fixture-loader.test.ts
// AMEND-nexus-planner-db-lexicon-v0-2-1.md §9.1 fixture-loader tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadLexiconFixtures } from './fixture-loader.js';

const PROD_FIXTURE_ROOT = 'fixtures/planner/db-lexicon';
const DEV_PUBLIC_KEY = 'zlwFwfovYQTY85H2DIy1jbFgBpNP868RH0As5bbLb4A';

describe('loadLexiconFixtures — happy path against signed prod fixtures', () => {
  it('loads + verifies the 8 signed fixtures and builds the in-memory tables', async () => {
    const tables = await loadLexiconFixtures({
      fixtureRoot: PROD_FIXTURE_ROOT,
      controlPlanePublicKey: DEV_PUBLIC_KEY,
    });

    expect(tables.lexicalTerms.length).toBeGreaterThan(0);
    expect(tables.aliasRules.length).toBeGreaterThan(0);
    expect(tables.taskIntents.length).toBeGreaterThan(0);
    expect(tables.taskCapabilities.length).toBeGreaterThan(0);
    expect(tables.targetCatalog.length).toBeGreaterThan(0);
    expect(tables.workflowTemplates.length).toBeGreaterThan(0);
    expect(tables.workflowNodes.length).toBeGreaterThan(0);
    expect(tables.workflowEdges.length).toBeGreaterThan(0);

    // Spot-check warehouse worked-example entries are present
    expect(tables.intentById.has('inventory.adjust_from_receiving')).toBe(true);
    expect(tables.templateById.has('workflow_inventory_adjust_from_receiving_v1')).toBe(true);
    expect(tables.nodesByTemplate.get('workflow_inventory_adjust_from_receiving_v1')?.length).toBe(
      3
    );
    expect(tables.edgesByTemplate.get('workflow_inventory_adjust_from_receiving_v1')?.length).toBe(
      2
    );
  });
});

describe('loadLexiconFixtures — fail-closed paths', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexus-lexicon-test-'));
    // Copy the prod fixtures so we can tamper with them per test
    const filenames = await fs.readdir(PROD_FIXTURE_ROOT);
    for (const f of filenames) {
      const src = path.join(PROD_FIXTURE_ROOT, f);
      const dst = path.join(tempRoot, f);
      await fs.copyFile(src, dst);
    }
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('rejects when a fixture file is missing', async () => {
    await fs.unlink(path.join(tempRoot, 'planner-lexical-term.v1.jsonl'));
    await expect(
      loadLexiconFixtures({
        fixtureRoot: tempRoot,
        controlPlanePublicKey: DEV_PUBLIC_KEY,
      })
    ).rejects.toThrow(/cannot read/i);
  });

  it('rejects on contentDigest mismatch (tampered record)', async () => {
    const filePath = path.join(tempRoot, 'planner-task-intent.v1.jsonl');
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.length > 0);
    // Modify the first record line so the digest no longer matches
    const records = lines.slice(1);
    records[0] = records[0]!.replace('inventory.adjust_from_receiving', 'tampered_intent');
    const newContent = [lines[0], ...records].join('\n') + '\n';
    await fs.writeFile(filePath, newContent, 'utf-8');

    await expect(
      loadLexiconFixtures({
        fixtureRoot: tempRoot,
        controlPlanePublicKey: DEV_PUBLIC_KEY,
      })
    ).rejects.toThrow(/contentDigest mismatch/i);
  });

  it('rejects on invalid Ed25519 signature', async () => {
    const filePath = path.join(tempRoot, 'planner-alias-rule.v1.jsonl');
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.length > 0);
    const header = JSON.parse(lines[0]!);
    // Flip the signature so verification fails
    header.signature = 'AAAA' + header.signature.slice(4);
    const newContent = [JSON.stringify(header), ...lines.slice(1)].join('\n') + '\n';
    await fs.writeFile(filePath, newContent, 'utf-8');

    await expect(
      loadLexiconFixtures({
        fixtureRoot: tempRoot,
        controlPlanePublicKey: DEV_PUBLIC_KEY,
      })
    ).rejects.toThrow(/signature verification failed/i);
  });

  it('rejects on recordCount mismatch', async () => {
    const filePath = path.join(tempRoot, 'planner-workflow-edge.v1.jsonl');
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.length > 0);
    // Remove one record line — header still says 2 but only 1 record present
    const newContent = [lines[0], lines[1]].join('\n') + '\n';
    await fs.writeFile(filePath, newContent, 'utf-8');

    await expect(
      loadLexiconFixtures({
        fixtureRoot: tempRoot,
        controlPlanePublicKey: DEV_PUBLIC_KEY,
      })
    ).rejects.toThrow(/recordCount/i);
  });
});
