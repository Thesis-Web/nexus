# Runbook: Connect compiler v0.1

## Purpose

Connect this external surface through a Nexus governed socket without moving governance authority into the external tool.

## Standard validation

- Identify the Nexus socket.
- Add or update signed manifest/config where required.
- Verify actor/principal/OCT ownership.
- Run targeted test.
- Run `pnpm ci:gate` before commit.

## Do not

- Do not move governance decisions into the external tool.
- Do not store raw secrets in manifests.
- Do not bypass NXS/NVG for governed work.
