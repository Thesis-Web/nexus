# AMEND — Nexus Package Import Law Resolver

**Version:** v0.1.0
**Status:** RATIFIED (resolver-based scanner; no relative cross-package escapes)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §2 Plug-and-play vs. Baked, §3 G NVG, §3 H NXS
**Audit packet:** Turn 1 P0-007, Turn 2 P0-014, Turn 4 P0-038

---

## §0 Disposition

Repo evidence (`scripts/ci-gate.ts:2870-2943` + `2973-2975`) shows the import-law gate skips relative imports before checking Nexus package law. As a result, `packages/vanguard/src/nvg-policy-unsigned.threat.test.ts` imports `../../core/src/crypto/...` undetected (P0-007). Other tests escape via the same loophole (P0-014). The gate cannot enforce a law it cannot see.

This spec ratifies a resolver-based scanner that normalizes relative imports to repo-absolute paths, maps each source file's package and each import target's package, and rejects cross-package edges that violate layer law — including tests, unless explicitly allowlisted in `tests/law-exceptions.json`.

**Hard Laws this spec preserves:**
- **#16** Agents touch mailboxes only — partly enforced via package law (an agent runtime cannot import NXS internals).
- General architecture: Vanguard imports contracts only; never Core internals (canonical package law).

**Q-rulings applied:**
- **Q3** BAKED enforcement — the CI gate is the executable expression of package law; specs that name boundaries without an executable gate drift.

**Audit findings closed:** P0-007 (Turn 1), P0-014 (Turn 2), P0-038 (Turn 4).

---

## §1 Scope

In scope (V1):
- Resolver in `scripts/ci-gate.ts` that normalizes every `import`/`require` (relative or package-specifier) to repo-absolute path.
- Maps source file → source package; target path → target package.
- Layer-law table (existing) consulted for every edge.
- Tests scanned by default; opt-out via `tests/law-exceptions.json` with owner-ratified entries.
- Move shared crypto test helpers/fixtures into a lawful package (`@nexus/runtime-utils` or `packages/test-fixtures/`) so Vanguard doesn't need Core internals.
- CI gate per Spec F4.19 (`GOV-16 resolved relative import law`).

Out of scope:
- Dynamic import / re-export chain following (V2 if needed).
- Cross-tenant / cross-org package boundaries (V2).

---

## §2 Resolver behavior

### §2.1 Edge resolution

For each `import` / `require` in any `.ts` / `.tsx` / `.js` / `.mjs` file under `packages/**`, `scripts/**`, `tests/**`:
1. Compute the source file's package by walking up to the nearest `package.json`.
2. Resolve the import specifier:
   - Package-specifier (`@nexus/foo`) → look up `foo` in workspace; target package = `foo`.
   - Relative (`../...`, `./...`) → resolve to repo-absolute path using `path.resolve(dirname(source), specifier)`; walk up to nearest `package.json`; target package = that.
   - Node built-in / external → ignored.
3. Edge = `(source_package, target_package, source_file, target_file)`.

### §2.2 Layer-law table

```ts
type LayerRule = {
  source: PackagePath;        // glob
  forbiddenTargets: PackagePath[];  // glob list; source may NOT import from these
  notes?: string;
};

const LAYER_LAW: readonly LayerRule[] = [
  {
    source: 'packages/vanguard/**',
    forbiddenTargets: ['packages/core/**'],  // tightened: ALL core internals, not just mailbox/output/compile
    notes: 'Vanguard imports contracts only; never Core internals',
  },
  // ... other rules (planners/db-lexicon/**, connectors/**, interfaces/**)
];
```

### §2.3 Tests included by default

`tests/law-exceptions.json`:
```json
{
  "exceptions": []
}
```

Empty by default. Any test exception requires owner ratification and an entry like:
```json
{
  "exceptions": [
    {
      "source": "packages/vanguard/src/some-specific-test.test.ts",
      "allowedTarget": "packages/core/src/specific-helper.ts",
      "ratifiedBy": "owner-decision-2026-MM-DD",
      "expiresAt": "2026-12-31"
    }
  ]
}
```

V1 ships with NO entries. The vanguard→core test edges (P0-007 evidence) must be eliminated by moving shared helpers into a lawful package.

---

## §3 Implementation sequence

1. Refactor `scripts/ci-gate.ts:2870-2975` to use the resolver pattern.
2. Add `tests/law-exceptions.json` (empty).
3. Move shared crypto test helpers from `packages/core/src/crypto/` to `packages/test-fixtures/` (new lawful package) OR generate them inline in vanguard tests.
4. Update Vanguard threat test imports to use the new helper location.
5. Run gate; expect zero violations after migration.
6. Tests per §4.

---

## §4 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| PIL-01 | Resolver normalizes `../../core/src/crypto/foo.js` from a Vanguard file → target package = `core`; edge violates layer law → CI fails | Unit |
| PIL-02 | Resolver normalizes `@nexus/contracts` from any source → target package = `contracts`; edge OK if allowed by layer law | Unit |
| PIL-03 | Test file with same forbidden edge → fails by default (no allowlist) | Integration |
| PIL-04 | Test file with explicit `tests/law-exceptions.json` entry → passes; entry without `ratifiedBy` → CI fails | Integration |
| PIL-05 | `packages/vanguard/src/*` → `packages/core/src/*` → CI fails; `packages/vanguard/src/*` → `packages/contracts/*` → passes | Integration |
| PIL-06 | Migrated Vanguard threat test (using `@nexus/test-fixtures` instead of Core internals) → CI passes | Integration |

**CI static gates (Spec F4.19):**
- `GOV-16 resolved relative import law` — runs the resolver scan; reports violations with source/target paths.

---

## §5 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-007 | Vanguard test no longer imports Core internals; lawful helper package; gate enforces |
| P0-014 | Resolver normalizes relative imports; layer-law table checked against absolute paths; tests included by default |
| P0-038 | CI gate GOV-16 runs the resolver; no relative-import escapes |

---

*End of v0.1.0.*
