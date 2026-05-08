---
title: Recipes
---

Common patterns assembled from the library's primitives.

## Impersonation flow

A platform-staff user temporarily acts as another user inside a tenant:

```ts
// In your auth flow:
async function startImpersonation(realActor: User, target: User, reasonCode: string) {
  // 1. Verify allow-list (actor role × target role × reason)
  await assertAllowedToImpersonate(realActor, target, reasonCode);

  // 2. Issue a short-lived token with impersonation claim
  const token = await jwt.sign({
    sub: target.id,                // the acted-as user
    tenantId: target.tenantId,
    realActorId: realActor.id,     // the real human
    impersonationReason: reasonCode,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  await auditLog.record({
    event: 'impersonation_start',
    actor: realActor.id,
    target: target.id,
    reason: reasonCode,
  });

  return token;
}
```

Then in `resolveTenantContext`, surface the impersonation metadata:

```ts
resolveTenantContext: async (req) => {
  const claims = await verifyJwt(req);
  return {
    tenantId: claims.tenantId,
    subjectId: claims.sub,
    roles: claims.roles,
    attributes: {
      realActorId: claims.realActorId,
      impersonationReason: claims.impersonationReason,
    },
  };
}
```

`defineAbilities` reads `ctx.attributes.realActorId` to scope rules
appropriately (e.g., the impersonator can read but not approve
financial actions).

The route that receives impersonated requests is marked:

```ts
@AllowCrossTenant('platform-staff-impersonation')
@CheckPolicies(/* ability check that runs as the target */)
async someEndpoint() { ... }
```

Audit logger uses `ctx.attributes.realActorId` to record the human
actor alongside `ctx.subjectId` (the impersonated identity).

## Role inheritance

If your roles form a hierarchy (`super-admin > admin > member`), express
inheritance via shared rule blocks:

```ts
function defineAbilities(builder, ctx) {
  // Member: base permissions
  if (ctx.roles.includes('member') ||
      ctx.roles.includes('admin') ||
      ctx.roles.includes('super-admin')) {
    builder.can('read', 'Merchant');
  }

  // Admin: member + management
  if (ctx.roles.includes('admin') || ctx.roles.includes('super-admin')) {
    builder.can('manage', 'Merchant');
    builder.can('manage', 'Agent');
  }

  // Super-admin: admin + cross-tenant
  if (ctx.roles.includes('super-admin')) {
    builder.crossTenant.can('read', 'Merchant');
  }
}
```

For more complex inheritance, define a helper:

```ts
function rolesIncluding(role: string, ctx: TenantContext): boolean {
  const hierarchy: Record<string, string[]> = {
    'member':      ['member', 'admin', 'super-admin'],
    'admin':       ['admin', 'super-admin'],
    'super-admin': ['super-admin'],
  };
  return hierarchy[role]?.some(r => ctx.roles.includes(r)) ?? false;
}

if (rolesIncluding('admin', ctx)) {
  builder.can('manage', 'Merchant');
}
```

## Attribute-based conditions (ABAC-style)

Express attribute conditions on the resource itself:

```ts
// Compliance officers can read merchants with high-risk score in their tenant
if (ctx.roles.includes('compliance-officer')) {
  builder.can('read', 'Merchant', {
    riskScore: { $gte: 80 },
  });
}

// Only managers approve payments above $10k
if (ctx.roles.includes('manager')) {
  builder.can('approve', 'Payment', {
    amountCents: { $gte: 1_000_000 },
  });
}
```

These compose naturally with the auto-injected tenant predicate and
with `$relatedTo` graph traversal.

## Time-bounded access

For temporary access (e.g., a vendor with read access until a date):

```ts
const now = new Date().toISOString();

if (ctx.roles.includes('vendor-read-only')) {
  builder.can('read', 'Order', {
    accessGrantedUntil: { $gte: now },
    status: { $in: ['shipped', 'delivered'] },
  });
}
```

If `accessGrantedUntil` is in the past, the rule's condition fails
and the vendor sees no orders. No additional cleanup logic needed.

## "Active membership" check inline in rules

A common need: even within a tenant, the user's membership row may
be revoked or expired without a fresh logout. Express this in
`resolveTenantContext` (the membership query is THE source of truth):

```ts
resolveTenantContext: async (req) => {
  const claims = req.user;
  const m = await memberships.findOne({
    userId: claims.sub,
    tenantId: claims.claimedTenantId,
    status: 'ACTIVE',
    expiresAt: MoreThan(new Date()),
  });
  if (!m) throw new ForbiddenException('No active membership');
  return { tenantId: m.tenantId, subjectId: m.userId, roles: m.roles };
}
```

If the membership is revoked, `resolveTenantContext` throws on the
**very next request** — the JWT is still valid until expiry, but the
authorization layer rejects it. This is the correct behavior:
revocation is server-side, not client-side.

## Multi-tenant search with pagination

```ts
async search(query: string, page: number, perPage: number) {
  const ability = await abilityFactory.build();
  const qb = repo
    .createQueryBuilder('m')
    .where('m.name ILIKE :q', { q: `%${query}%` })
    .orderBy('m.name')
    .skip(page * perPage)
    .take(perPage);

  accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
  return qb.getManyAndCount();
}
```

`accessibleBy()`'s WHERE composes with your filter / ORDER BY /
LIMIT — pagination is server-side, not "load all then slice."

## Conditional cross-tenant access (escalation)

A pattern where a regular user temporarily gains cross-tenant rights
after MFA + manager approval:

```ts
function defineAbilities(builder, ctx) {
  // Normal scope
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', { /* tenant-scoped */ });
  }

  // Escalated: only after step-up MFA AND active escalation row
  if (ctx.attributes?.escalationActive === true) {
    builder.crossTenant.can('read', 'Merchant');
  }
}
```

The `escalationActive` flag is set in `resolveTenantContext` after
checking a separate `escalations` table:

```ts
const escalation = await escalations.findOne({
  userId: claims.sub,
  status: 'ACTIVE',
  expiresAt: MoreThan(new Date()),
});

return {
  tenantId,
  subjectId: claims.sub,
  roles: claims.roles,
  attributes: { escalationActive: !!escalation },
};
```

## See also

- [Tenant Context](/docs/core-concepts/tenant-context/) — `attributes` field for impersonation / escalation metadata.
- [Audit Logging](/docs/advanced/audit-logging/) — recording the patterns above.
- [`@AllowCrossTenant`](/docs/integration/nestjs/) — the route-level marker.
