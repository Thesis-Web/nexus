# Nexus

Nexus is a private-runtime, policy-aware action router and authority governance layer for AI agents and automated systems.

## Canonical product law

1. `docs/nexus-blueprint-v0-3-6.md`
2. `docs/nexus-engineering-spec-v0-4-6.md`

Temporary canon override until the spec text is absorbed:

- `docs/NEXUS-CANONIZED-SPEC-DEVIATION-MEMO-2026-04-14.md`

## Build posture

- The blueprint governs purpose, architecture, and boundaries.
- The engineering spec governs implementation law.
- Build instructions govern builder-session behavior only and are not product law.
- License for this repository is All Rights Reserved.

## Quickstart

From repository root:

pnpm install
pnpm build
pnpm format:check
pnpm ci:gate

Development entry points:

pnpm nexus --help
pnpm nexus:mcp

Built-bin proof path:

pnpm exec nexus --help
pnpm exec nexus-mcp-proxy --help

## Clean-clone proof

A clean clone should be able to complete:

pnpm install
pnpm build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm ci:gate
pnpm exec nexus --help
pnpm exec nexus-mcp-proxy --help

## Documentation map

- `docs/operator-runbook.md` — operator workflow, safety boundaries, key handling, run validation
- `docs/cli-usage.md` — CLI command families and common flows
- `docs/troubleshooting.md` — common failures and deterministic fixes

## Operator Notes

### Rate Limiter — Single-Process Limitation (spec §17.3)

The rate limiter uses an in-memory Map (max 60 actions/minute per actor).
It provides no guarantee across process restarts or multiple instances.
A SQLite-backed implementation is deferred to post-POC.
Do not deploy in multi-process or multi-instance configurations without replacing
the rate limiter with a shared backend first.
