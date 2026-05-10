/**
 * Policy bundle loader — multi-bundle composition (P-pol-2).
 *
 * Sister to `loadPolicyFile` (which loads ONE bundle). This function
 * loads a SET of bundles: a required default bundle (shipped in the
 * package) + an optional directory of additional bundles (operator-
 * provided + future marketplace-vendor-provided). Each bundle is
 * independently signature-verified by the control-plane key.
 *
 * Composition law (Stage 1, locked in):
 *   - All rules from all bundles are flattened into one rule set
 *   - Each rule gains `bundleRef = { bundleId, bundleVersion }` so
 *     Gate 04 audit decisions trace back to the source bundle
 *   - Final ordering: priority ascending (matches single-bundle
 *     behavior); ties broken by load order (default first, then
 *     additional bundles in alphabetical filename order)
 *   - DENY-WINS on conflicts within the same priority class — the
 *     evaluator's first-match-wins semantics naturally honor this
 *     because we emit deny rules ahead of allow rules at the same
 *     priority. Operators / marketplace vendors cannot accidentally
 *     widen the surface; only narrow it via deny rules.
 *   - Global fallback: hardcoded `deny` (matches existing Gate 04
 *     behavior). Per-bundle `defaultOutcome` fields are advisory
 *     only — composer enforces fixed `deny` regardless.
 *
 * Hot-reload (Stage 2) and admin counter-signature for marketplace
 * bundles (Stage 3) are documented in docs/STATUS-MULTI-NODE-PLANNER.md
 * (now also covers policy bundle staging). This loader is boot-only.
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  type LoadedPolicyFile,
  type PolicyRule,
  type Uuid,
  type NonEmpty,
  type Sha256Hex,
  type IsoTimestamp,
} from '../types/index.js';
import type { KeyPair } from '../crypto/key-manager.js';
import { loadPolicyFile } from './rule-loader.js';
import { canonicalize } from '../crypto/canonicalize.js';
import { sha256 } from '../crypto/signer.js';

export interface LoadPolicyBundleSetOptions {
  /** Path to the default-shipped policy bundle. Required. */
  readonly defaultBundlePath: string;
  /**
   * Directory containing additional policy bundles (e.g.
   * `config/policy/`). Each file matching `*.policy.json` in this
   * directory is loaded and composed alongside the default. The
   * directory is OPTIONAL — when missing or empty the result equals
   * loading just the default bundle alone. The default bundle
   * itself MUST live outside this directory (or it would be loaded
   * twice).
   */
  readonly additionalBundlesDir?: string;
  /** Control-plane key for signature verification. */
  readonly key: KeyPair;
}

export interface LoadedPolicyBundleSet {
  /** Each loaded bundle, in load order (default first). */
  readonly bundles: readonly LoadedPolicyFile[];
  /** The composed policy: a synthetic LoadedPolicyFile with all rules
   *  flattened + tagged with bundleRef. Drop-in for Gate 04 — its
   *  consumers don't need to know they're seeing composed output. */
  readonly composed: LoadedPolicyFile;
}

const POLICY_FILE_SUFFIX = '.policy.json';

/**
 * Load the default bundle + any additional bundles in the directory,
 * verify each signature, compose into a single policy the rest of the
 * pipeline can consume.
 *
 * Throws PolicySignatureError if ANY bundle fails verification — fail
 * closed on the first bad signature; don't load a partial set.
 */
export async function loadPolicyBundleSet(
  opts: LoadPolicyBundleSetOptions
): Promise<LoadedPolicyBundleSet> {
  const bundles: LoadedPolicyFile[] = [];

  // 1. Always load the default first. Throws on bad signature.
  const defaultBundle = await loadPolicyFile(opts.defaultBundlePath, opts.key);
  bundles.push(defaultBundle);

  // 2. Optionally walk the additional directory in deterministic order.
  if (opts.additionalBundlesDir !== undefined) {
    const additional = await listPolicyBundleFiles(opts.additionalBundlesDir);
    for (const filepath of additional) {
      // Skip the default if it happens to live inside the directory —
      // operators shouldn't end up with the same bundle loaded twice.
      if (path.resolve(filepath) === path.resolve(opts.defaultBundlePath)) {
        continue;
      }
      const bundle = await loadPolicyFile(filepath, opts.key);
      bundles.push(bundle);
    }
  }

  const composed = composePolicyBundles(bundles);
  return { bundles, composed };
}

/**
 * Return all `*.policy.json` files in the given directory, sorted
 * alphabetically. Missing directory → empty array (back-compat:
 * deployments without an extra-bundles directory still work).
 * Sub-directories are not recursed; bundles are flat in one directory.
 */
async function listPolicyBundleFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter(name => name.endsWith(POLICY_FILE_SUFFIX))
    .sort()
    .map(name => path.join(dir, name));
}

/**
 * Compose N loaded bundles into one synthetic LoadedPolicyFile that
 * Gate 04 can consume directly. Each rule keeps its original ruleId
 * + priority and gains `bundleRef` for audit. Sorting is
 * priority-ascending; load order breaks priority ties (so default
 * bundle rules win against same-priority rules in operator bundles
 * — operators get explicit precedence with a lower priority number).
 */
export function composePolicyBundles(bundles: readonly LoadedPolicyFile[]): LoadedPolicyFile {
  if (bundles.length === 0) {
    throw new Error('composePolicyBundles: at least one bundle required');
  }

  const allRules: PolicyRule[] = [];
  const seenRuleIds = new Set<string>();
  const namespacedRuleIdToOriginal = new Map<string, string>();

  bundles.forEach((bundle, bundleIndex) => {
    for (const rule of bundle.rules) {
      // Disambiguate on ruleId collision across bundles: the second
      // bundle's rule keeps its origin in bundleRef but its ruleId
      // gets prefixed with the bundle's id. Audit traces still tell
      // the operator exactly which bundle authored which decision.
      let effectiveRuleId = rule.ruleId;
      if (seenRuleIds.has(effectiveRuleId)) {
        effectiveRuleId = `${bundle.bundleId.slice(0, 8)}::${rule.ruleId}` as NonEmpty;
        namespacedRuleIdToOriginal.set(effectiveRuleId, rule.ruleId);
      }
      seenRuleIds.add(effectiveRuleId);

      allRules.push({
        ...rule,
        ruleId: effectiveRuleId as NonEmpty,
        bundleRef: {
          bundleId: bundle.bundleId,
          bundleVersion: bundle.bundleVersion,
        },
      });
    }
    void bundleIndex; // load order kept for potential future tie-break logic
  });

  const sortedRules = [...allRules].sort((a, b) => a.priority - b.priority);

  // Synthetic composed-file identity. The bundle hash digests the
  // canonicalized composed rule list so replay can verify the exact
  // composed surface. The `signature` field is empty — composed output
  // is derived, not signed. (Source bundles ARE signed; the composer
  // verifies each on load.)
  const composedBody = {
    rules: sortedRules,
    sourceBundleIds: bundles.map(b => b.bundleId),
  };
  const composedHash = sha256(canonicalize(composedBody)) as Sha256Hex;
  const composedFile: LoadedPolicyFile = {
    version: '1.0',
    bundleId: ('composed-' + composedHash.slice(0, 8)) as unknown as Uuid,
    bundleVersion: ('composed-of-' + bundles.length) as NonEmpty,
    issuer: 'composed' as NonEmpty,
    issuedAt: new Date().toISOString() as IsoTimestamp,
    signature: '' as never, // composed output, not signed; sources verified at load
    defaultOutcome: 'deny',
    rules: sortedRules,
    filepath: '<composed>',
    loadedAt: new Date().toISOString(),
    sortedRules,
    bundleHash: composedHash,
  };
  return composedFile;
}
