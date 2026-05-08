---
title: 'RFC 001: Roles abstraction on top of PBAC'
---

| | |
|---|---|
| **Status** | Draft — proposed for v0.2.0 |
| **Author** | nest-warden maintainers |
| **Started** | 2026-05-08 |
| **Targets** | Theme 1 of the [roadmap](/docs/roadmap/things-to-do/) |

This is a request for comments. The proposal here is opinionated but
reversible — comments below the "Open questions" section gate
acceptance. RFCs land before code.

## Summary

Add a first-class **role** primitive to nest-warden so that
non-technical tenant admins can manage permissions through a UI
without writing CASL rules. A role is a named bundle of permissions;
permissions are typed `(action, subject, conditions?, fields?)` rules
declared once at application boot. Roles compose by union (no
inheritance). The library stays storage-agnostic: consumers wire
permissions and roles through callbacks, not built-in entities.

## Problem

Today, every authorization concern in nest-warden flows through a
`defineAbilities` callback that runs per request:

```ts
TenantAbilityModule.forRoot({
  defineAbilities: (builder, ctx) => {
    if (ctx.roles.includes('iso-admin')) {
      builder.can('manage', 'Merchant');
    }
    if (ctx.roles.includes('agent')) {
      builder.can('read', 'Merchant', { /* ... */ });
    }
  },
});
```

This works for engineering teams who can author rules in TypeScript.
It does not work for the (common) case of a **non-technical tenant
admin** who needs to create a "QA Reviewer" role through a UI and
attach a curated subset of permissions. There is no way to do that
without redeploying the application.

The pattern most multi-tenant SaaS apps converge on:

1. **System roles** — hard-coded by engineering (Admin, Developer,
   Viewer). Stable across tenants. Defined in code.
2. **Custom roles** — created at runtime by tenant admins. Stored in
   the consumer's database. Composed of references to permissions.
3. **A small permission registry** — a centralized list of
   permissions (`merchants:read`, `merchants:approve`, etc.) that
   both system roles and custom roles draw from.

nest-warden has no affordance for any of these layers. The bare-rule
API forces every consumer to invent the abstraction themselves, and
in practice they all reinvent the same thing.

## Goals

- **G1.** Provide a typed `definePermissions` registry that maps
  named permissions to CASL rules.
- **G2.** Provide a typed `defineRoles` helper for system roles.
- **G3.** Provide a `loadCustomRoles(tenantId)` callback so tenant
  admins can compose custom roles persisted in the consumer's
  database.
- **G4.** Compose roles into the per-request ability via a single
  call: `builder.applyRoles(ctx.roles)`.
- **G5.** Stay storage-agnostic. The library defines no entities,
  no migrations, no DB tables. Consumers wire whatever ORM and
  schema they have.
- **G6.** Stay backwards-compatible. Existing `defineAbilities`
  callbacks keep working unchanged. Roles are additive.

## Non-goals

- **NG1.** Role inheritance ("Admin extends Developer plus X"). Roles
  compose by union. If you need "Admin's permissions plus 3 more",
  define an Admin permission set and a separate role that includes
  it. CASL itself doesn't have inheritance, and adding it here
  buys edge cases without unlocking real use cases.
- **NG2.** A built-in management UI for tenant admins. UI is the
  consumer's problem. The library exposes the data model the UI
  needs; rendering is out of scope.
- **NG3.** Persistence schema. We don't ship `@Entity Role`. The
  example app may demonstrate a pattern, but the library doesn't
  prescribe one.
- **NG4.** Cross-tenant role sharing. A custom role created in
  tenant A is not visible in tenant B, full stop. Tenants share the
  permission registry (defined globally) and the system role list
  (defined globally), nothing else.

## Proposed design

### Permission registry — `definePermissions`

Permissions are named, typed bundles of `(action, subject,
conditions?, fields?)`. Defined once at module bootstrap, immutable
thereafter.

```ts
import { definePermissions } from 'nest-warden';

export const permissions = definePermissions<AppAction, AppSubject>({
  'merchants:read': {
    action: 'read',
    subject: 'Merchant',
  },
  'merchants:approve': {
    action: 'approve',
    subject: 'Merchant',
    conditions: { status: 'pending' },
  },
  'merchants:read-public': {
    action: 'read',
    subject: 'Merchant',
    fields: ['id', 'name', 'status'],
  },
  'payments:refund': {
    action: 'refund',
    subject: 'Payment',
    conditions: { amount: { $lte: 10_000 } },
  },
});

export type Permission = keyof typeof permissions;
```

Why a registry vs. raw `(action, subject)` pairs everywhere:

- **UI affordance.** The tenant admin's role editor lists
  `'merchants:approve'`, not `(action='approve', subject='Merchant',
  conditions={ status: 'pending' })`. The registry decouples the
  display name from the underlying CASL rule shape.
- **Refactor safety.** Renaming an action from `'approve'` to
  `'review'` happens in one place; consumers reference the named
  permission, not the action.
- **Type narrowing.** `Permission` is a string-literal union of
  every defined name. Roles, role assignments, and audit logs all
  benefit from autocomplete + compile-time checking.

The registry is **closed**: a permission must exist in
`definePermissions` before it can be referenced anywhere. Unknown
names throw `UnknownPermissionError` at registry build time, not at
request time.

### System roles — `defineRoles`

A role is an ordered set of permission names plus optional metadata.

```ts
import { defineRoles } from 'nest-warden';

export const systemRoles = defineRoles<Permission>({
  admin: {
    description: 'Full tenant administration',
    permissions: [
      'merchants:read',
      'merchants:approve',
      'payments:refund',
    ],
  },
  developer: {
    description: 'Read access for engineering staff',
    permissions: ['merchants:read', 'merchants:read-public'],
  },
  viewer: {
    description: 'Read-only public listings',
    permissions: ['merchants:read-public'],
  },
});

export type SystemRoleName = keyof typeof systemRoles;
```

System roles are immutable at runtime. They define the **shape** of
authorization across all tenants. Custom roles can reference any
permission but cannot redefine system roles.

### Custom roles — `loadCustomRoles`

The consumer provides a callback that returns custom roles for the
current tenant. The library invokes it at most once per request,
after the tenant context resolves.

```ts
TenantAbilityModule.forRoot({
  permissions,
  systemRoles,

  loadCustomRoles: async (tenantId, ctx) => {
    const rows = await db.customRoles.findMany({
      where: { tenantId },
    });
    return rows.map((r) => ({
      name: r.name,
      permissions: r.permissions, // string[]
    }));
  },

  defineAbilities: (builder, ctx) => {
    builder.applyRoles(ctx.roles);
    // builder.can(...) for any rule that doesn't fit the role model
  },
});
```

Custom roles must reference permission names that exist in the
registry. The library validates the references and throws
`UnknownPermissionError` (with the offending permission name + role
name) when a custom role references a permission that's not
registered. Failed validation is a deny-by-default outcome: the
library returns an empty rule set for that role rather than a partial
set, so a misconfigured custom role can't accidentally widen access.

`ctx.roles` is the union of the JWT-claimed role names. The library
resolves each name to either a system role or a custom role by
looking up:

1. System roles (synchronous, in-process).
2. Custom roles for the active tenant (returned by
   `loadCustomRoles`).

If a name doesn't resolve, it's silently dropped (with a warning if
`logUnknownRoles: true`). This matters for forward compatibility:
adding a new role to the registry shouldn't require coordinating
JWTs across all live sessions.

### Composition into the ability

`builder.applyRoles(roleNames)` walks the resolved permissions and
calls `builder.can(...)` for each. Equivalent to writing the rules
by hand, but generated from the registry.

```ts
// What the user writes
builder.applyRoles(['admin', 'qa-reviewer']);

// What the library expands to (illustrative, not the actual API)
permissions['merchants:read'].forEach(p => builder.can(p.action, p.subject));
permissions['merchants:approve'].forEach(p =>
  builder.can(p.action, p.subject, p.conditions),
);
// ... etc, deduped where rules are identical.
```

Tenant predicate auto-injection (the existing nest-warden behavior)
applies as usual. A permission with `crossTenant: true` opts out
explicitly; that's covered in the [cross-tenant docs](/docs/core-concepts/cross-tenant/).

### Type surface (sketch)

```ts
// Permission registry entry
interface PermissionDef<TAction extends string, TSubject extends string> {
  readonly action: TAction;
  readonly subject: TSubject;
  readonly conditions?: Record<string, unknown>; // CASL Mongo query
  readonly fields?: readonly string[];
  readonly crossTenant?: boolean;
}

// Role entry
interface RoleDef<TPermission extends string> {
  readonly description?: string;
  readonly permissions: readonly TPermission[];
}

// Custom role (loaded at runtime)
interface CustomRoleEntry<TPermission extends string> {
  readonly name: string;
  readonly permissions: readonly TPermission[];
  readonly description?: string;
}
```

The `<TPermission extends string>` parameter narrows to the registry's
key union, so role definitions get autocomplete + compile-time checks
on permission names.

## Backwards compatibility

- **Existing `defineAbilities` consumers** are unaffected. Roles are
  opt-in. A consumer that doesn't supply `permissions` or
  `systemRoles` keeps the v0.1 behavior verbatim.
- **No breaking changes to module options.** `permissions`,
  `systemRoles`, and `loadCustomRoles` are all optional new fields.
- **Migration path.** Callers can incrementally migrate by extracting
  one or two roles to the registry while leaving complex
  `$relatedTo` rules in `defineAbilities`. The two coexist cleanly.

## Alternatives considered

### A1 — Skip the registry, accept raw rule arrays per role

```ts
const systemRoles = defineRoles({
  admin: [
    { action: 'manage', subject: 'Merchant' },
    { action: 'manage', subject: 'Payment' },
  ],
});
```

**Rejected.** Loses the "rename a permission once" property and
forces UIs to render `(action, subject, conditions)` triples. Custom
role tables would have to store rule shape, not just permission
names — which makes audit logs and role-diff UIs awkward.

### A2 — Store the registry as data (DB-backed)

A persistent `permissions` table managed by tenant admins.

**Rejected.** Permissions reflect the application's vocabulary
(actions and subject types). Letting tenants invent permissions at
runtime means the application code has to handle permission names it
doesn't know about — an unsolvable problem for a general-purpose
library. System roles are extensible at runtime via `loadCustomRoles`;
the permission set is not.

### A3 — Inheritance ("Admin extends Developer + adds X")

**Rejected.** Adds resolution complexity (cycle detection, override
semantics, conflict resolution) and produces no behavior the union
model can't already express. If a role needs to be "Developer plus
3 more permissions", define a permission set and reference it from
both roles.

### A4 — Ship a TypeORM schema for custom roles

**Rejected as a library feature; accepted as an example pattern.**
A reference implementation in `examples/nestjs-app/` showing the
typical `custom_roles(tenant_id, name, permissions jsonb)` table
plus `loadCustomRoles` wiring will be added alongside the
implementation work, but the library itself stays storage-agnostic
per the existing project posture.

## Open questions

These are the decisions that block "Draft" → "Accepted." Comments
welcome on the tracking issue (link will live here once filed).

### Q1 — Permission name format

`'merchants:read'` (colon-delimited) is the proposal. Alternatives:

- `'merchants.read'` (dot-delimited, mirrors GCP IAM conventions)
- `'merchant:read'` (singular subject, mirrors action naming in
  current example app)
- A two-segment object: `{ subject: 'Merchant', action: 'read' }`

**Pull on this:** Colon-delimited reads naturally as
`<resource>:<verb>`, is the most common convention in published SaaS
permission sets, and is unambiguously parseable. Dot-delimited
collides with property paths in some UIs.

**Recommended:** colon-delimited (`'merchants:read'`).

### Q2 — Are conditions and field arrays per-permission, or per-role?

The proposal puts them per-permission (a permission carries its own
conditions). Alternative: permissions are pure `(action, subject)`
identifiers; conditions live on the role-permission attachment.

```ts
// Alternative: conditions on the attachment
const adminRole = {
  permissions: [
    { name: 'merchants:approve', conditions: { region: 'NA' } },
  ],
};
```

**Pull on this:** Per-permission keeps the registry self-contained
("`merchants:approve` is *always* gated by `status: 'pending'`") and
makes audit easy ("who has the unconditional approve power?"). The
attachment approach lets one role tighten a permission for a
specific assignment, which is rarely useful and creates audit
ambiguity.

**Recommended:** per-permission, no per-attachment overrides.

### Q3 — Where does `crossTenant` live?

A permission that should grant cross-tenant access (platform admin
type roles) needs to opt in. The proposal puts the flag on the
permission itself. Alternative: opt-in only when the role is
assigned to a specific user.

**Recommended:** on the permission. A permission either is or isn't
cross-tenant in spirit; that's a property of the action, not the
assignment.

### Q4 — Do system roles compose with custom roles, or replace?

If a tenant has both a system `admin` role and a custom `admin` role,
what happens?

- **Compose** (default): both apply, union of permissions.
- **Override**: custom hides system if names collide.
- **Reject**: throw on name collision at module bootstrap (for
  system roles) and at custom role load (for custom).

**Recommended:** Reject collisions. System role names are reserved.
Custom roles must use distinct names. Avoids ambiguity entirely.

### Q5 — How are custom roles cached?

`loadCustomRoles(tenantId)` runs per request. For a busy tenant with
many users, that's potentially many DB reads per second.

- Library-internal cache (TTL or LRU): forces a cache invalidation
  story we don't currently have.
- Consumer's responsibility: cache in their own DAL (Redis, etc.).
- Per-request memoization: each request calls once even if multiple
  rule rebuilds happen.

**Recommended:** Per-request memoization (inside the library). For
cross-request caching, document the pattern and let consumers ship
their own (the same way they handle DB connections, JWTs, etc.).

### Q6 — Audit log integration

The role abstraction is the natural place for audit hooks ("user X
exercised role Y to perform action Z on resource Q"). This RFC
deliberately doesn't propose an audit hook — that's
[Theme 5 (decision logging)](/docs/roadmap/things-to-do/#5-authorization-decision-logging),
which lands separately. The role API should be designed so that the
audit hook (when added) can attribute decisions back to a specific
role-permission pair without re-engineering.

**Constraint:** the rules emitted by `applyRoles` carry hidden
metadata (role name, permission name) that the future decision
logger can read. CASL rules already support a `reason` string field;
we'll use that, structured as JSON.

## Implementation phasing

Once accepted, work splits into thin slices, each its own PR:

1. **Phase A — Core registry types.** `definePermissions`,
   `defineRoles`, `Permission`, `Role` types. Library-only, no
   builder integration. Unit tests for type narrowing and validation.

2. **Phase B — Builder integration.** `builder.applyRoles(roleNames)`
   inside `TenantAbilityBuilder`. Resolves system roles synchronously.
   No `loadCustomRoles` wiring yet.

3. **Phase C — Custom roles.** Add `loadCustomRoles` to module
   options. Per-request memoization. End-to-end test against the
   example app's `custom_roles` table (added in same PR).

4. **Phase D — Example app integration.** Replace the current
   `if (ctx.roles.includes('admin'))` style with the registry-based
   pattern. Demonstrate one custom role end-to-end.

5. **Phase E — Documentation.** Tutorial for "creating roles in
   nest-warden", migration guide from raw rules, API reference for
   the new helpers.

Each phase is its own PR; no phase merges before the previous one
unless explicitly noted.

## What "accepted" looks like

This RFC moves to **Accepted** when:

- The five open questions above are resolved (with rationale
  captured here, replacing "Recommended").
- A maintainer-tagged comment signs off.
- A tracking issue is filed for Phase A.

Until then it's **Draft**. Code that references the API in this
document should not land — the API may shift in response to comments.

## See also

- [Roadmap — Things to do](/docs/roadmap/things-to-do/) — where this RFC sits in the broader plan.
- [Tenant-aware Builder](/docs/core-concepts/tenant-builder/) — what `applyRoles` plugs into.
- [Conditional Authorization](/docs/core-concepts/conditional-authorization/) — how per-permission conditions compile to rules.
- [Cross-tenant Opt-out](/docs/core-concepts/cross-tenant/) — how `crossTenant: true` permissions interact with the tenant predicate.
