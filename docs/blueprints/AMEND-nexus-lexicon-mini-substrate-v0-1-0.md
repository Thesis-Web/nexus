# AMEND — Nexus Lexicon Mini-Substrate (Phase 2)

**Version:** v0.1.0
**Status:** RATIFIED (Q15 — Phase 2 SQLite mini-substrate sequenced immediately after Phase 1 code lands)
**Date:** 2026-05-20
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (Phase B dangerous-mode session)
**Base commit:** Phase B HEAD (post-Patch 21)
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §3 E Lexicon Mini-Substrate, §3 K Admin Dashboard, Hard Law #14
**Companion spec:** AMEND-nexus-lexicon-admin-ui-v0-2-0.md (F4.8 Phase 1)

---

## §0 Disposition

Phase 1 (Spec F4.8) ships double-admin lexicon mutations via SigningCouncil 2-of-2 with JSONL append as the storage backend. Phase 2 (this spec) migrates the storage backend to a SQLite mini-substrate while preserving every governance invariant Phase 1 established. JSONL becomes the seed / export / disaster-recovery format; SQLite becomes the runtime read backend + the executor's write target.

**Q15 ruling (verbatim):** Phase 2 lexicon SQLite migration begins as the immediately-following arc after Phase 1 (SigningCouncil over JSONL) code lands. Next session can author the Phase 2 spec in parallel with Phase 1 code, so the spec is ready when Phase 1 ships.

**Hard Laws preserved (unchanged from Phase 1):**
- **#10** Every lexicon mutation Ed25519-signed by two admins; every gate outcome to ledger; failure path fail-closed.
- **#13** Default-secure — runtime cannot mutate lexicon (prompt-channel learning forbidden).
- **#14** Admin-mediated growth via review queues; no implicit RBAC drift.

---

## §1 Scope

In scope (V2):
- SQLite schema: `lexicon_entity`, `lexicon_edge`, `lexicon_confidence`, `lexicon_arena`, `workflow_template`, `lexicon_guard`.
- Migration tool that imports the current JSONL fixtures into SQLite + verifies parity post-migration.
- Runtime lexicon reader swap: `@nexus/planner-db-lexicon`'s reader port re-pointed from JSONL loader to SQLite reader.
- `LexiconMutationExecutor` implementation swap: `JsonlLexiconMutationExecutor` → `SqliteLexiconMutationExecutor` (same interface; SigningCouncil dispatcher injection unchanged).
- Arena scoring + A* search support (unblocked by the SQL backend).

Out of scope:
- Cross-tenant lexicon federation (V3).
- Hot-reload from external lexicon feeds (V3).
- Graph-walk admin tools (V3 — separate from runtime).

---

## §2 SQLite schema

### §2.1 Tables

```sql
CREATE TABLE lexicon_entity (
  entity_id        TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  disabled         INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- ULID of the LexiconMutation that created/last-updated this row
  mutation_id      TEXT NOT NULL
);

CREATE TABLE lexicon_edge (
  edge_id              TEXT PRIMARY KEY,
  source_entity_id     TEXT NOT NULL,
  target_entity_id     TEXT NOT NULL,
  relation             TEXT NOT NULL,
  weight               REAL,
  disabled             INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  mutation_id          TEXT NOT NULL,
  FOREIGN KEY (source_entity_id) REFERENCES lexicon_entity(entity_id),
  FOREIGN KEY (target_entity_id) REFERENCES lexicon_entity(entity_id)
);

CREATE TABLE lexicon_arena (
  arena_id   TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  policy     TEXT NOT NULL,  -- JSON: per-arena classifier config
  created_at TEXT NOT NULL,
  mutation_id TEXT NOT NULL
);

CREATE TABLE lexicon_confidence (
  entity_id  TEXT NOT NULL,
  arena_id   TEXT NOT NULL,
  score      REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  set_at     TEXT NOT NULL,
  mutation_id TEXT NOT NULL,
  PRIMARY KEY (entity_id, arena_id),
  FOREIGN KEY (entity_id) REFERENCES lexicon_entity(entity_id),
  FOREIGN KEY (arena_id) REFERENCES lexicon_arena(arena_id)
);

CREATE TABLE workflow_template (
  template_id  TEXT PRIMARY KEY,
  slots        TEXT NOT NULL,  -- JSON: ReadonlyArray<{slotId, required}>
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  mutation_id  TEXT NOT NULL
);

CREATE TABLE lexicon_guard (
  guard_id    TEXT PRIMARY KEY,
  when_expr   TEXT NOT NULL,
  then_action TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  mutation_id TEXT NOT NULL
);

CREATE TABLE lexicon_mutation_log (
  mutation_id    TEXT PRIMARY KEY,
  applied_at     TEXT NOT NULL,
  mutation_kind  TEXT NOT NULL,
  signer_a       TEXT NOT NULL,
  signer_b       TEXT NOT NULL,
  payload_json   TEXT NOT NULL,
  signature_ref  TEXT NOT NULL  -- SigningCouncil signing request id
);

CREATE INDEX idx_lexicon_edge_source ON lexicon_edge(source_entity_id);
CREATE INDEX idx_lexicon_edge_target ON lexicon_edge(target_entity_id);
CREATE INDEX idx_lexicon_confidence_arena ON lexicon_confidence(arena_id);
CREATE INDEX idx_lexicon_mutation_kind ON lexicon_mutation_log(mutation_kind);
```

### §2.2 Mutation provenance row

Every row in every domain table carries `mutation_id`. The `lexicon_mutation_log` row for that mutation_id holds the full signer chain + payload + SigningCouncil request id. Audit replay reads the log table to reconstruct the apply history.

---

## §3 Runtime behavior

### §3.1 Reader

`@nexus/planner-db-lexicon`'s reader port is unchanged from Phase 1's perspective; only the implementation switches from JSONL → SQLite. Queries:

- Entity lookup by id: `SELECT * FROM lexicon_entity WHERE entity_id = ? AND disabled = 0`.
- Edge traversal: `SELECT * FROM lexicon_edge WHERE source_entity_id = ? AND disabled = 0`.
- Confidence join: `SELECT le.*, lc.score FROM lexicon_entity le JOIN lexicon_confidence lc ON le.entity_id = lc.entity_id WHERE lc.arena_id = ? ORDER BY lc.score DESC`.

Arena-scoped A* search becomes feasible (indexed edge + confidence tables; the JSONL backend required full-table scans).

### §3.2 Executor

`SqliteLexiconMutationExecutor` implements the same `LexiconMutationExecutor` interface as the Phase 1 JSONL implementation:

1. Validate signer count (>=2 distinct) — unchanged from Phase 1.
2. Per mutation.kind, run the corresponding SQL inside a single transaction:
   - `entity_add` → `INSERT INTO lexicon_entity`.
   - `entity_update` → `UPDATE lexicon_entity SET ...`.
   - `entity_disable` → `UPDATE lexicon_entity SET disabled = 1`.
   - `edge_*` → analogous.
   - `confidence_set` → `INSERT OR REPLACE INTO lexicon_confidence`.
   - `workflow_template_*` → analogous.
   - `guard_*` → analogous.
3. Insert one row into `lexicon_mutation_log` with the signer chain + payload + signing request id.
4. Commit transaction; emit `lexicon_mutation_applied` ledger event (unchanged from Phase 1).

If the transaction fails → roll back, emit `lexicon_mutation_failed`, return error to SigningCouncil dispatcher (which marks the request denied).

### §3.3 Hot reload

SQLite reader uses `better-sqlite3`'s prepared-statement cache; the next read sees the new row immediately after commit. No process restart required.

### §3.4 Three-mode behavior

Same as Phase 1 (observe/advisory/enforcing matrix). Storage backend choice does not change governance semantics.

---

## §4 Migration tool

`scripts/migrate-lexicon-jsonl-to-sqlite.ts`:

1. Read every JSONL fixture under `fixtures/lexicon/`.
2. For each line, derive the canonical row + `mutation_id` (preserve the existing seqNo if present; otherwise generate ULID).
3. Insert into SQLite within a single transaction.
4. Compute SHA-256 of the canonical-line export from SQLite vs the JSONL source; assert parity.
5. On parity success: write a `migration_complete.json` record; on mismatch: roll back + report.

Migration is one-shot at deployment time. Subsequent runs read from SQLite; JSONL becomes export-only.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| LEX-SQL-01 | Migration: known JSONL fixture imports cleanly + SHA-256 parity check passes | Integration |
| LEX-SQL-02 | Reader returns same result set as JSONL backend for the canonical lookup queries | Integration |
| LEX-SQL-03 | SqliteLexiconMutationExecutor applies entity_add inside transaction; rollback on SQL error | Unit |
| LEX-SQL-04 | Below-threshold signers rejected (same invariant as Phase 1 JSONL executor) | Unit |
| LEX-SQL-05 | Hot reload: write entity → immediate next read sees it | Integration |
| LEX-SQL-06 | Arena scoring query returns top-N entities by score | Integration |
| LEX-SQL-07 | Concurrent applies serialized via SQLite write lock (no torn writes) | Integration |
| LEX-SQL-08 | Foreign-key violation (edge referencing missing entity) → transaction rolls back | Integration |

**CI static gates (extension of Spec F4.19):**
- `GOV-14` (Phase 2 amendment): assert SqliteLexiconMutationExecutor enforces the same signers.length >= 2 + distinct check as the JSONL impl.

---

## §6 Phase 2 sequencing

1. Spec ratification (this document).
2. Implement `packages/core/src/lexicon/sqlite-schema.sql` + migration tool.
3. Implement `SqliteLexiconMutationExecutor` against the same `LexiconMutationExecutor` interface.
4. Implement the SQLite reader behind `@nexus/planner-db-lexicon`'s existing port.
5. Run migration in a staging environment; verify parity.
6. Swap composition root to use the SQLite executor + reader; JSONL becomes export-only.
7. Land tests + CI gate amendments.

Phase 2 ships on the existing Phase 1 governance surface — no contract changes; only implementation swap.

---

## §7 Backwards compatibility

Phase 1 (JSONL) and Phase 2 (SQLite) coexist via the LexiconMutationExecutor + reader interfaces. Composition root chooses which implementation to inject. Phase 1 deployments continue to work; Phase 2 deployments use SQLite. The migration tool provides the one-shot copy from one to the other.

---

## §8 Audit closure mapping

| Finding | How closed in Phase 2 |
|---|---|
| (Phase 1 closes the governance gap) | Phase 2 extends without weakening |
| Q7 sequencing | Phase 2 spec ratified per Q15 timing — implementation follows |
| Q15 | This document satisfies "Phase 2 spec authored in parallel with Phase 1 implementation" |

---

*End of v0.1.0.*
