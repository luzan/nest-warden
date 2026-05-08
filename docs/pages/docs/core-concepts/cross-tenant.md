---
title: Cross-tenant Opt-out
---

The library's central guarantee is that **every rule is tenant-scoped
unless you explicitly opt out**. The `crossTenant` opt-out is the
explicit, auditable way to say "this rule reaches across tenants on
purpose."

## When to use it

Three legitimate scenarios in production multi-tenant SaaS:

1. **Platform staff support / customer success** — internal users who
   read across tenant boundaries to help customers. Always paired with
   audit logging and step-up MFA in production.
2. **Aggregate reporting / analytics** — read-only roles that compute
   metrics across tenants for the platform operator's own dashboards.
3. **System / migration jobs** — background tasks that process every
   tenant's data (residual calculations, settlement runs, scheduled
   exports). Usually run as a separate `system` role outside the
   request scope.

For everything else — agents, ISO admins, merchant staff, customer
end-users — the default tenant-scoped rules are what you want.

## How

```ts
// Tenant-scoped (default)
builder.can('read', 'Merchant', { status: 'active' });
//      ↑ rule auto-pinned to ctx.tenantId

// Cross-tenant (explicit opt-out)
builder.crossTenant.can('read', 'Merchant');
//              ↑ no tenantId injected; matches every tenant's data
```

`builder.crossTenant.can(...)` and `.cannot(...)` have the same shape
as the regular `can` / `cannot`. The only difference is the rule is
**not** auto-scoped, and the rule object is tagged with a
non-enumerable `__mtCrossTenant` marker that:

- Tells `validateTenantRules` to allow the rule despite missing the
  tenant predicate.
- Lets audit-log scrapers identify cross-tenant rules in the rule set.
- Survives `Rule.origin` so it remains observable from the compiled
  ability.

## Combine with role checks

Pure cross-tenant rules without a role check would defeat tenant
isolation entirely. The pattern is to gate the opt-out on a specific
role:

```ts
defineAbilities(builder, ctx) {
  // Default rules — tenant-scoped
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', {
      $relatedTo: { path: ['agents_of_merchant'], where: { id: ctx.subjectId } },
    } as never);
  }

  // Cross-tenant — gated on platform-admin role
  if (ctx.roles.includes('platform-admin')) {
    builder.crossTenant.can('read', 'Merchant');
    builder.crossTenant.can('read', 'Payment');
    builder.crossTenant.can('read', 'Agent');
  }
}
```

## Combine with `@AllowCrossTenant` for routes

For NestJS routes that are intentionally cross-tenant (e.g., a support-
staff impersonation endpoint), pair the rule with the
`@AllowCrossTenant(reasonCode)` decorator:

```ts
import { AllowCrossTenant, CheckPolicies } from 'nest-warden/nestjs';

@AllowCrossTenant('platform-staff-impersonation')
@CheckPolicies((ability) => ability.can('manage', 'all'))
@Post('admin/impersonate/:userId')
async impersonate(@Param('userId') userId: string) {
  // ...
}
```

The decorator stores a reason code on the route's metadata. Audit-log
scrapers can surface every cross-tenant action with its declared
justification — making the security review of "where do we ever cross
tenants?" a `git grep '@AllowCrossTenant'` operation.

The decorator does **not** bypass the policies guard or the rule
check; it's purely declarative. The actual cross-tenant rule must
exist in `defineAbilities` for the role.

## Audit logging

The marker is queryable. To log every cross-tenant rule that fired in
a given request, walk the built ability's rules:

```ts
import { isCrossTenantRule } from 'nest-warden';

const crossTenantRules = ability.rules.filter((r) =>
  isCrossTenantRule(r.origin),
);
```

Combine with `request.ability` (set by the policies guard) and your
audit-log infrastructure to record the actor, target tenant(s), and
reason code on every cross-tenant action.

## Anti-patterns

{% callout type="danger" title="Don't make every rule crossTenant" %}
Using `crossTenant.can()` for all rules defeats the library's main
guarantee. If you find yourself doing this, you probably don't have a
multi-tenant system — and you don't need nest-warden. Stock CASL is
fine for single-tenant apps.
{% /callout %}

{% callout type="warning" title="Don't gate crossTenant on `if (ctx.tenantId === '...')`" %}
Hardcoding a tenant-ID check is fragile and misses the point —
crossTenant rules should match across tenants by construction. Gate on
the **role**, not the tenant ID.
{% /callout %}

## See also

- [Tenant-aware Builder](/docs/core-concepts/tenant-builder/) — the default tenant-scoped path.
- [Audit Logging](/docs/advanced/audit-logging/) — operational details.
