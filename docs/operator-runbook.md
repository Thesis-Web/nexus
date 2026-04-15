# Nexus Operator Runbook

## Purpose

This runbook is the operator-facing guide for running, checking, and troubleshooting Nexus in the current POC shape.

Use this document for:
- local bring-up
- key and token handling
- policy signing workflow
- session and delegation bootstrap
- gate verification
- run-artifact inspection
- local management API handling

Do not treat this file as product law.
Canonical product law remains the blueprint and engineering spec.

## Canonical references

- `docs/nexus-blueprint-v0-3-6.md`
- `docs/nexus-engineering-spec-v0-4-6.md`
- `docs/NEXUS-CANONIZED-SPEC-DEVIATION-MEMO-2026-04-14.md`

## Repo root discipline

All commands in this runbook start from repository root.

  cd ~/repos/nexus || exit 1

## Pre-flight

Required:
- Node.js 20+
- pnpm 9.x
- repository root shell
- local filesystem write access
- localhost access for management API

Verify toolchain:

  node -v
  pnpm -v

## Standard operator bring-up

Run in this order:

  pnpm install
  pnpm build
  pnpm format:check
  pnpm ci:gate

Then prove built bins:

  pnpm exec nexus --help
  pnpm exec nexus-mcp-proxy --help

## Key and token material

### Control-plane key

Development control-plane key path:

  keys/dev.keypair.json

This key is used for:
- policy signing
- approval request signing
- evidence record signing
- chain verification inputs

### Admin bearer token

Management API admin token path:

  keys/admin.token

This token is local operator material.
Do not expose it outside the host.
Do not commit it.

### Approver keys

Approver key path shape:

  keys/approvers/<approverId>.keypair.json

Approver keys are loaded by approver ID.
Approval and denial actions must use an explicit approver ID.

## Management API boundary

The management API is localhost-only in this version.

Expected bind:
- `127.0.0.1` only

Do not expose it publicly.
Do not proxy it externally without a deliberate architecture change and canon update.

## Normal operator flow

### 1. Initialize local materials

Use the CLI help surface first:

  pnpm nexus --help
  pnpm nexus init --help

Run initialization:

  pnpm nexus init

Expected result:
- control-plane dev key present
- admin token present
- local runtime state initialized

### 2. Register or prepare identities

Use the command help for the exact current contract:

  pnpm nexus actor --help
  pnpm nexus principal --help
  pnpm nexus approver --help

Generate an approver key when needed:

  pnpm nexus approver keygen --approver-id <approverId>

### 3. Sign policy files

Inspect current policy helpers:

  pnpm nexus policy --help

If a signing utility is used directly, keep policy edits followed by signing.
Do not hand-edit a signed policy and assume it is still valid.

### 4. Create session context

Session creation is explicit.
Adapters do not create sessions.

Use:

  pnpm nexus session start --help

Expected path:
- actor exists
- delegation exists
- principal is derived server-side
- session is created with bounded expiry

### 5. Delegate authority

Use:

  pnpm nexus delegate --help

Expected constraints:
- cannot exceed principal or parent delegation bounds
- environment must remain valid
- downstream propagation cannot expand beyond parent scope

### 6. Execute or run scenarios

Use:

  pnpm nexus run --help

For fixture-driven verification, use the scenario-aware run path.
For general runtime use, inspect the help surface and keep runs tied to explicit session and delegation context.

### 7. Review outputs

Primary operator checks:
- `pnpm ci:gate`
- run artifact directory under `runs/`
- ledger output
- posture output
- replay checks
- chain verification

Useful help surfaces:

  pnpm nexus ledger --help
  pnpm nexus posture --help
  pnpm nexus replay --help

## Approval workflow

Inspect help first:

  pnpm nexus approve --help
  pnpm nexus deny --help

General rule:
- all approval actions require explicit approver ID
- signed ApprovalResponse must verify against the approver registry
- timeout never auto-approves

## Run artifacts

Expect run outputs under:

  runs/RUN-<id>/

Operator expectation:
- artifacts should match the filename contract declared by the spec
- evidence must always be written
- replay and chain checks should remain stable across reruns under the approved comparability rule

## Safety boundaries

Do not:
- expose the management API beyond localhost
- bypass signed policy handling
- bypass approval signature handling
- inject long-lived secrets into adapters or prompts
- treat the system as a certifier of safety or compliance
- run multi-instance production with the in-memory rate limiter

## Known operational limitations

### Rate limiter

Single-process only.
No guarantee across restarts or multiple instances.

### Localhost management API

Current version is intentionally local-only.

### Canonized deviation memo

Current Step 6 and Step 10 canon behavior is partially carried by the temporary memo file until absorbed into the main spec text.

## End-of-run operator check

Before commit or release-oriented handoff, run:

  pnpm build
  pnpm format:check
  pnpm ci:gate
  pnpm exec nexus --help
  pnpm exec nexus-mcp-proxy --help

Then inspect:

  git status --short
