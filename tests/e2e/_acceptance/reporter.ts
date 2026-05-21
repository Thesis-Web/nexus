/**
 * tests/e2e/_acceptance/reporter.ts — acceptance-wall failure reporter.
 *
 * Hooks Vitest's `onFinished` after the full E2E suite has run, walks
 * every test result, parses any embedded `AcceptanceWallFailure` detail
 * out of the error messages, and writes a structured failure ledger:
 *
 *   runs/acceptance-wall-2026-05-21/FAILURE-LEDGER.md     (human-read)
 *   runs/acceptance-wall-2026-05-21/FAILURE-LEDGER.jsonl  (machine-read)
 *
 * The reporter classifies every non-passing test:
 *   - failures with an `AcceptanceWallFailure` detail are pinned to the
 *     declared FailureClass / blockedBy / lawPins
 *   - any other failure (real assertion, real product bug) is recorded
 *     as UNCLASSIFIED with the raw error message — these need owner /
 *     audit triage to assign a class
 *
 * The ledger is the truth surface: it does NOT hide UNCLASSIFIED
 * failures (the user's directive — "if we fake green Claude thinks fake
 * is permitted"). Every red test is visible.
 *
 * The reporter writes the ledger regardless of pass/fail mix; if every
 * E2E test passed, the ledger records a zero-failure summary. The
 * Vitest exit code is unaffected — the wall is still red when failures
 * exist, by design.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import {
  parseAcceptanceDetail,
  type AcceptanceWallFailureDetail,
  type FailureClass,
} from './failure.js';

/** Minimal duck-typed view of Vitest's File / Task / Test shape — we
 * walk the tree by structural typing rather than depending on internal
 * runner type re-exports (which moved between minor versions). */
interface VitestTaskNode {
  type: 'suite' | 'test' | 'custom';
  name: string;
  tasks?: ReadonlyArray<VitestTaskNode>;
  result?: {
    state?: 'pass' | 'fail' | 'skip' | 'todo' | 'only' | 'run';
    errors?: ReadonlyArray<{ message?: string; name?: string; stack?: string }>;
  };
}

interface VitestFileNode extends VitestTaskNode {
  filepath?: string;
  name: string;
}

interface RecordedRow {
  testFile: string;
  testName: string;
  state: string;
  detail: AcceptanceWallFailureDetail | null;
  rawErrorMessage: string | null;
  rawErrorName: string | null;
}

const FAILURE_CLASSES: ReadonlyArray<FailureClass> = [
  'UNIMPLEMENTED_TEST_BODY',
  'HARNESS_BUG',
  'INFRA_MISSING',
  'CONNECTOR_MISSING',
  'EXTERNAL_DEPENDENCY',
  'PRODUCT_RUNTIME',
  'LAW_VIOLATION',
  'SPEC_DRIFT',
  'UNIMPLEMENTED_SURFACE',
  'FLAKE',
];

export default class AcceptanceWallReporter {
  private rows: RecordedRow[] = [];
  private outDir: string;

  constructor() {
    // Owner-pinned dated run dir. Once 2026-05-21 wall is locked we
    // can branch into 2026-05-22/ etc. for re-runs, but for now every
    // wall run rewrites this single ledger so the truth surface
    // reflects HEAD's actual state.
    this.outDir = path.join(process.cwd(), 'runs', 'acceptance-wall-2026-05-21');
  }

  onInit(): void {
    /* no-op — required by Reporter interface in some vitest versions */
  }

  async onFinished(files?: ReadonlyArray<VitestFileNode>): Promise<void> {
    if (!files || files.length === 0) {
      // Nothing ran (filter selected zero files, etc.) — don't clobber
      // an existing ledger with an empty one.
      return;
    }
    for (const file of files) {
      this.walk(file, file.filepath ?? file.name);
    }
    await this.writeLedger();
  }

  private walk(node: VitestTaskNode, filepath: string): void {
    if (node.type === 'test' || node.type === 'custom') {
      const state = node.result?.state ?? 'unknown';
      // Only record terminal failure/skip/todo states. Passing tests are
      // counted in the summary but don't fill the ledger detail.
      if (state === 'pass') {
        this.rows.push({
          testFile: filepath,
          testName: node.name,
          state,
          detail: null,
          rawErrorMessage: null,
          rawErrorName: null,
        });
        return;
      }
      const firstErr = node.result?.errors?.[0];
      const rawMsg = firstErr?.message ?? null;
      const detail = rawMsg ? parseAcceptanceDetail(rawMsg) : null;
      this.rows.push({
        testFile: filepath,
        testName: node.name,
        state,
        detail,
        rawErrorMessage: rawMsg,
        rawErrorName: firstErr?.name ?? null,
      });
      return;
    }
    // Suite — recurse.
    for (const child of node.tasks ?? []) {
      this.walk(child, filepath);
    }
  }

  private async writeLedger(): Promise<void> {
    await fs.mkdir(this.outDir, { recursive: true });

    const totals = {
      total: this.rows.length,
      pass: this.rows.filter(r => r.state === 'pass').length,
      fail: this.rows.filter(r => r.state === 'fail').length,
      skip: this.rows.filter(r => r.state === 'skip').length,
      todo: this.rows.filter(r => r.state === 'todo').length,
      other: 0,
    };
    totals.other = totals.total - totals.pass - totals.fail - totals.skip - totals.todo;

    const failingRows = this.rows.filter(r => r.state !== 'pass');
    const classCounts = new Map<string, number>();
    const blockerCounts = new Map<string, string[]>(); // blockerId -> [testId, ...]

    for (const row of failingRows) {
      const cls = row.detail?.failureClass ?? 'UNCLASSIFIED';
      classCounts.set(cls, (classCounts.get(cls) ?? 0) + 1);
      const blocker = row.detail?.blockedBy;
      if (blocker) {
        const list = blockerCounts.get(blocker) ?? [];
        list.push(row.detail?.testId ?? row.testName);
        blockerCounts.set(blocker, list);
      }
    }

    // --- jsonl ---
    const jsonlPath = path.join(this.outDir, 'FAILURE-LEDGER.jsonl');
    const jsonlBody = failingRows
      .map(row => {
        const rec = {
          generatedAt: new Date().toISOString(),
          testFile: path.relative(process.cwd(), row.testFile),
          testName: row.testName,
          state: row.state,
          failureClass: row.detail?.failureClass ?? 'UNCLASSIFIED',
          testId: row.detail?.testId ?? null,
          reason: row.detail?.reason ?? null,
          blockedBy: row.detail?.blockedBy ?? null,
          owner: row.detail?.owner ?? null,
          lawPins: row.detail?.lawPins ?? null,
          suspectedRootCause: row.detail?.suspectedRootCause ?? null,
          nextRecommendedAction: row.detail?.nextRecommendedAction ?? null,
          rawErrorName: row.rawErrorName,
          rawErrorMessage: row.rawErrorMessage,
        };
        return JSON.stringify(rec);
      })
      .join('\n');
    await fs.writeFile(jsonlPath, jsonlBody + (jsonlBody ? '\n' : ''), 'utf-8');

    // --- md ---
    const mdPath = path.join(this.outDir, 'FAILURE-LEDGER.md');
    const lines: string[] = [];
    lines.push('# Nexus E2E Acceptance Wall — Failure Ledger');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- total tests: **${totals.total}**`);
    lines.push(`- passing: **${totals.pass}**`);
    lines.push(`- failing: **${totals.fail}**`);
    if (totals.skip > 0) lines.push(`- skipped (BANNED — should be 0): **${totals.skip}**`);
    if (totals.todo > 0) lines.push(`- todo (BANNED — should be 0): **${totals.todo}**`);
    if (totals.other > 0) lines.push(`- other (run/only/unknown): **${totals.other}**`);
    lines.push('');
    lines.push('## Failure breakdown by class');
    lines.push('');
    lines.push('| class | count |');
    lines.push('| --- | --- |');
    const sortedClasses = [...classCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [cls, n] of sortedClasses) {
      lines.push(`| ${cls} | ${n} |`);
    }
    if (sortedClasses.length === 0) lines.push('| (none) | 0 |');
    lines.push('');

    if (blockerCounts.size > 0) {
      lines.push('## Blocker graph');
      lines.push('');
      lines.push('Tests blocked on the same upstream blocker are grouped here. Resolving a top blocker unblocks every test below it.');
      lines.push('');
      const sortedBlockers = [...blockerCounts.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [blocker, tests] of sortedBlockers) {
        lines.push(`### \`${blocker}\` — blocks ${tests.length} test${tests.length === 1 ? '' : 's'}`);
        lines.push('');
        for (const t of tests) lines.push(`- ${t}`);
        lines.push('');
      }
    }

    lines.push('## Failures (per test)');
    lines.push('');
    if (failingRows.length === 0) {
      lines.push('_None. The wall is fully green._');
      lines.push('');
    } else {
      // Group by file for readability.
      const byFile = new Map<string, RecordedRow[]>();
      for (const row of failingRows) {
        const rel = path.relative(process.cwd(), row.testFile);
        const list = byFile.get(rel) ?? [];
        list.push(row);
        byFile.set(rel, list);
      }
      const sortedFiles = [...byFile.keys()].sort();
      for (const file of sortedFiles) {
        lines.push(`### \`${file}\``);
        lines.push('');
        for (const row of byFile.get(file) ?? []) {
          const cls = row.detail?.failureClass ?? 'UNCLASSIFIED';
          const tid = row.detail?.testId ?? '—';
          lines.push(`#### [${cls}] ${tid} — \`${row.testName}\``);
          lines.push('');
          lines.push(`- state: \`${row.state}\``);
          if (row.detail?.reason) lines.push(`- reason: ${row.detail.reason}`);
          if (row.detail?.blockedBy) lines.push(`- blockedBy: \`${row.detail.blockedBy}\``);
          if (row.detail?.owner) lines.push(`- owner: ${row.detail.owner}`);
          if (row.detail?.lawPins && row.detail.lawPins.length > 0) {
            lines.push(`- lawPins: ${row.detail.lawPins.map(p => `\`${p}\``).join(', ')}`);
          }
          if (row.detail?.suspectedRootCause) {
            lines.push(`- suspectedRootCause: ${row.detail.suspectedRootCause}`);
          }
          if (row.detail?.nextRecommendedAction) {
            lines.push(`- nextRecommendedAction: ${row.detail.nextRecommendedAction}`);
          }
          if (!row.detail && row.rawErrorMessage) {
            lines.push('- raw error (needs triage):');
            lines.push('  ```');
            const msg = row.rawErrorMessage.split('\n').slice(0, 8).join('\n  ');
            lines.push(`  ${msg}`);
            lines.push('  ```');
          }
          lines.push('');
        }
      }
    }

    // Footer.
    lines.push('---');
    lines.push('');
    lines.push('## Failure-class taxonomy reference');
    lines.push('');
    for (const cls of FAILURE_CLASSES) {
      lines.push(`- \`${cls}\``);
    }
    lines.push('');
    lines.push('Source: `tests/e2e/_acceptance/failure.ts`. Repair-mode priority follows owner ratification — typically PRODUCT_RUNTIME and LAW_VIOLATION before UNIMPLEMENTED_*.');
    lines.push('');

    await fs.writeFile(mdPath, lines.join('\n'), 'utf-8');
  }
}
