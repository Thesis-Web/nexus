# Nexus

Nexus is a private-runtime, policy-aware action router and authority governance layer for AI agents and automated systems.

## Canonical product law

1. `docs/nexus-blueprint-v0-3-6.md`
2. `docs/nexus-engineering-spec-v0-4-6.md`

## Build posture

- The blueprint governs purpose, architecture, and boundaries.
- The engineering spec governs implementation law.
- Build instructions govern builder-session behavior only and are not product law.
- License for this repository is All Rights Reserved.

## Operator Notes

### Rate Limiter — Single-Process Limitation (spec §17.3)

The rate limiter uses an in-memory Map (max 60 actions/minute per actor).
It provides **no guarantee across process restarts or multiple instances**.
A SQLite-backed implementation is deferred to post-POC.
Do not deploy in multi-process or multi-instance configurations without replacing
the rate limiter with a shared backend first.
