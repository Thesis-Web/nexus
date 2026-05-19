# AMEND — Nexus OCT Bypass Removal

**Version:** v0.1.0
**Status:** RATIFIED (strip octLevel from generic actor schema/UI; signed OCT path is only lawful mutation)
**Date:** 2026-05-19
**Owner:** James Huson / Lake Area LLC
**Author:** Claude (dangerous-mode spec rework session)
**Base commit:** 3ae197d
**Outline pin:** docs/alignment/nexus-component-outline-v0-1-0.md §4 O, §3 K, Hard Laws #10/#13
**Audit packet:** Turn 2 P0-008, Turn 4 P0-035
**Companion spec:** AMEND-nexus-admin-oct-level-ui-v0-1-0.md (F4.5)

---

## §0 Disposition

The generic actor editor (`packages/workspace-ref/src/client/components/admin/panels/actor-agent-setup-panel.tsx`) and the generic admin actor update route (`packages/interfaces/api/src/routes/admin-writer.ts`) accept `octLevel` in their update payload, bypassing the signed `assignOct` OCT manager. The dashboard exposes a normal `<select>` for OCT with no direction check. This is the bypass path (P0-008, P0-035).

This spec strips `octLevel` from the generic actor update schema, UI, and admin-writer route. The only lawful OCT mutation path is the signed `assignOct` flow in Spec F4.5; the only lawful OCT lower-equivalent is the deregister-then-register-new flow per Q2.

**Hard Laws this spec enforces:**
- **#10** OCT change is a signed envelope; cannot be laundered through actor update.
- **#13** Default-secure — OCT cannot drift without explicit signed evidence.

**Q-rulings applied:**
- **Q2** Registration is the auth gate; downward path is deregister-re-register only.
- **Q3** BAKED enforcement — baked OCT manager is the only legitimate mutation surface; plug-in admin-writer rejects malformed payloads.

**Audit findings closed:** P0-008 (Turn 2), P0-035 (Turn 4).

---

## §1 Scope

In scope (V1):
- Remove `octLevel` from `ActorUpdateSchema` in `packages/interfaces/api/src/routes/admin-writer.ts:132-147`.
- Remove `octLevel` from `DraftActor` editable fields in `actor-agent-setup-panel.tsx:58-69`.
- Remove `octLevel` from generic actor update payload constructor (`actor-agent-setup-panel.tsx:277-286`).
- Remove OCT `<select>` from generic actor editor UI (`actor-agent-setup-panel.tsx:576-591`); replace with read-only badge linking to the dedicated OCT manager UI (Spec F4.5).
- Update the OCT manager (`packages/core/src/identity/oct-manager.ts:112-121`) to enforce strict-higher rank check on `oct_change` operation.
- CI gate per Spec F4.19 (`GOV-12 OCT single lawful mutation path`).

Out of scope:
- Initial registration OCT (handled in Spec F4.5 via signed `SignedActorRegistrationRequest`).
- Break-glass OCT lower (V2; SigningCouncil 2-of-2 + owner ratification).

---

## §2 Contract changes

### §2.1 `ActorUpdateSchema` (after)

```ts
const ActorUpdateSchema = z.object({
  displayName: z.string().optional(),
  notes: z.string().optional(),
  enabled: z.boolean().optional(),
  capabilities: z.array(CapabilitySchema).optional(),
  // octLevel: REMOVED — see Spec F4.5 for the lawful signed path
  // ... other existing safe fields
});
```

If client sends `octLevel`, the schema validator rejects with `octLevel_not_permitted_in_generic_update`.

### §2.2 OCT manager strict-higher enforcement

```ts
function assertStrictlyHigher(prev: OctLevel, next: OctLevel): void {
  if (OCT_RANK[next] <= OCT_RANK[prev]) {
    throw new OctAssignmentRejected({
      reason: 'downward_or_equal_oct_change_forbidden',
      previousOctLevel: prev,
      newOctLevel: next,
    });
  }
}
```

Called from `assignOct(...)` before mutation. The audit-found path at `oct-manager.ts:112-121` adopts this check. Test `OCT-UI-03` from Spec F4.5 verifies.

---

## §3 Runtime behavior

### §3.1 Generic actor update flow (post-removal)

1. Admin opens actor editor.
2. Edits display name, capabilities, notes, enabled flag.
3. Submits via signed `SignedAdminMutation<ActorUpdate>` (Spec F4.13).
4. Server schema rejects any `octLevel` in payload.
5. Mutation applies to non-OCT fields only.

OCT changes require a separate operator action: open OCT manager UI → use signed assign-OCT flow per Spec F4.5.

### §3.2 OCT badge

Generic actor detail panel displays current OCT as a read-only badge with a link "Manage OCT level →" that opens the dedicated OCT manager surface (Spec F4.5).

### §3.3 Three-mode behavior

| Mode      | Gate behavior                                                                                       | Run continues? | Ledger writes? |
|-----------|-----------------------------------------------------------------------------------------------------|----------------|----------------|
| observe   | client sends `octLevel`; server schema logs `would_reject_oct_in_generic_update`; mutation proceeds on other fields | n/a (admin op) | always |
| advisory  | same as observe + workspace warning                                                                  | n/a            | always         |
| enforcing | client sends `octLevel`; server schema rejects 400; mutation does not proceed                       | n/a            | always         |

### §3.4 BAKED vs plug-in

- **BAKED (floor):** OCT manager strict-higher enforcement; CI gate scanning every actor-update path for `octLevel`.
- **PLUG-IN (defense in depth):** admin-writer schema rejection; dashboard form omits OCT control.

---

## §4 Implementation sequence

1. Update `ActorUpdateSchema` (remove `octLevel`).
2. Update `DraftActor` shape (remove `octLevel` editable field).
3. Update actor update payload constructor (omit `octLevel`).
4. Update actor editor UI (remove `<select>`, add read-only badge + link).
5. Update OCT manager to enforce strict-higher rank check.
6. CI gate per Spec F4.19.
7. Tests per §5.

---

## §5 Tests (acceptance gates)

| Gate | Purpose | Type |
|---|---|---|
| OCT-BP-01 | POST `/workspace/admin/setup/actors/:id` with `octLevel` in body → 400 + `octLevel_not_permitted_in_generic_update` | Integration |
| OCT-BP-02 | Same request without `octLevel` → 200, mutation applied | Integration |
| OCT-BP-03 | Actor detail UI omits OCT `<select>`; renders OCT as read-only badge | E2E |
| OCT-BP-04 | OCT manager `assignOct(prev=OCT_INTERNAL, next=OCT_OPEN)` → throws `downward_or_equal_oct_change_forbidden` | Unit |
| OCT-BP-05 | OCT manager `assignOct(prev=OCT_INTERNAL, next=OCT_INTERNAL)` → throws (equal not allowed) | Unit |
| OCT-BP-06 | OCT manager `assignOct(prev=OCT_OPEN, next=OCT_CONFIDENTIAL)` → success | Unit |
| OCT-BP-07 | Static gate detects any actor-update payload constructor passing `octLevel` → CI fails | Static |
| OCT-BP-08 | observe mode: client sends `octLevel`; server logs would-reject; mutation proceeds on other fields | Integration |

**CI static gates (Spec F4.19):**
- `GOV-12 OCT mutation single lawful path` — verifies generic actor update schema does not accept `octLevel`; verifies `assignOct` is the only mutation point.

---

## §6 Audit closure mapping

| Finding | How closed |
|---|---|
| P0-008 | `octLevel` removed from generic actor schema + UI + payload; signed `assignOct` path (Spec F4.5) is the only mutation; tests OCT-BP-01/-03 |
| P0-035 | OCT manager strict-higher enforcement; downward/equal rejected; tests OCT-BP-04/-05/-06 |

---

*End of v0.1.0.*
