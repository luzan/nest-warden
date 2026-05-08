---
title: Migrate from @casl/ability
---

If you're already using stock `@casl/ability` in a multi-tenant app,
adopting nest-warden is mostly mechanical: swap the builder, drop the
manual `tenantId` from your conditions, and add a `TenantContext`
resolver.

## Step 1 — Install

```bash
pnpm add nest-warden
# (@casl/ability stays as a peer — no version change needed)
```

## Step 2 — Replace `AbilityBuilder` with `TenantAbilityBuilder`

Before:

```ts
import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';

type AppAbility = MongoAbility<[Action, Subject]>;
const builder = new AbilityBuilder<AppAbility>(createMongoAbility);

if (user.role === 'agent') {
  builder.can('read', 'Merchant', {
    tenantId: user.tenantId,           // manual
    agentId: user.id,
  });
}
const ability = builder.build();
```

After:

```ts
import { TenantAbilityBuilder } from 'nest-warden';
import { createMongoAbility, type MongoAbility } from '@casl/ability';
import type { TenantContext } from 'nest-warden';

type AppAbility = MongoAbility<[Action, Subject]>;

function defineAbilities(builder: TenantAbilityBuilder<AppAbility>, ctx: TenantContext) {
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', {
      // tenantId removed — auto-injected
      agentId: ctx.subjectId,
    });
  }
}

// Per-request:
const ctx: TenantContext = await resolveContext(request);
const builder = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
defineAbilities(builder, ctx);
const ability = builder.build();  // throws if any rule lacks a tenant predicate
```

## Step 3 — Adopt the NestJS module (optional)

If your app uses NestJS, replace your custom guard / factory with
`TenantAbilityModule.forRoot()`:

```ts
import { TenantAbilityModule } from 'nest-warden/nestjs';

@Module({
  imports: [
    TenantAbilityModule.forRoot<AppAbility>({
      resolveTenantContext: async (req) => { /* server-side lookup */ },
      defineAbilities,
    }),
  ],
})
export class AppModule {}
```

This auto-registers the policies guard globally; remove your old
`PoliciesGuard` from the providers list.

The `@CheckPolicies(...)` decorator works the same way — handlers
receive an `AppAbility` and return `boolean`. Object-form
`PolicyHandler`s with a `.handle(ability)` method also work as before.

## Step 4 — Convert tests

Tests that constructed an ability via stock CASL need a `TenantContext`:

```ts
// Before
const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
builder.can('read', 'Merchant', { tenantId: 't1' });
const ability = builder.build();

// After
const ctx: TenantContext = { tenantId: 't1', subjectId: 'u1', roles: [] };
const builder = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
builder.can('read', 'Merchant');  // tenantId injected from ctx
const ability = builder.build();
```

The runtime ability behaves identically. Same `ability.can(...)`,
same operator semantics, same field-level permissions.

## Step 5 — Migrate cross-tenant rules

Rules that intentionally span tenants need the explicit opt-out:

```ts
// Before
if (user.role === 'platform-admin') {
  builder.can('read', 'Merchant');  // no tenantId
}
// → would fail nest-warden's validateTenantRules with CrossTenantViolationError

// After
if (ctx.roles.includes('platform-admin')) {
  builder.crossTenant.can('read', 'Merchant');  // explicit opt-out
}
```

Audit-log scrapers can detect cross-tenant rules via
`isCrossTenantRule(rule.origin)` — making the security review
of "where do we cross tenants?" easy to answer.

## Step 6 — Add `accessibleBy()` to listing endpoints (optional but high-impact)

The biggest single performance win. Replace this:

```ts
// O(n) — loads all, filters in memory
const all = await repo.find({ where: { tenantId } });
const visible = all.filter((m) => ability.can('read', m));
```

with:

```ts
import { accessibleBy } from 'nest-warden/typeorm';

const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const visible = await qb.take(50).getMany();
// → single SQL query with WHERE auto-built from rules
```

For the relationship-heavy rules, define a `RelationshipGraph` (see
[Relationship Graph](/docs/core-concepts/relationship-graph/)) so
`$relatedTo` rules compile to EXISTS subqueries.

## Migration checklist

- [ ] Install `nest-warden`.
- [ ] Replace `AbilityBuilder` with `TenantAbilityBuilder`.
- [ ] Pass a `TenantContext` instead of reading `user.tenantId` inline.
- [ ] Remove `tenantId: user.tenantId` from every rule's conditions.
- [ ] Mark intentionally cross-tenant rules with `builder.crossTenant.*`.
- [ ] (NestJS) Register `TenantAbilityModule.forRoot()`.
- [ ] (NestJS) Remove your old `PoliciesGuard`.
- [ ] (TypeORM) Add `@TenantColumn()` to entities with a tenant FK.
- [ ] (TypeORM) Replace listing endpoints with `accessibleBy()`.
- [ ] (Optional) Define a `RelationshipGraph` for graph-based rules.
- [ ] (Optional) Add Postgres RLS policies as defense-in-depth.

## Common errors during migration

### `CrossTenantViolationError` at `.build()`

A rule lacks the tenant predicate AND isn't marked cross-tenant. Two
fixes:

```ts
// Option A: it should be tenant-scoped
builder.can('read', 'Merchant');  // auto-injects tenantId

// Option B: it's intentionally cross-tenant
builder.crossTenant.can('read', 'Merchant');
```

### `MissingTenantContextError` from `TenantContextService.get()`

The context isn't resolved yet — common when a route is `@Public()`
or runs outside a request. Either:
- Don't call services that need the context from public routes.
- Resolve and pass the context manually for service-layer calls
  outside the request scope.

### `UnsupportedOperatorError` from `accessibleBy()`

A rule uses a Mongo operator the SQL compiler doesn't support
(e.g., `$regex`, `$where`). Either remove that rule from
listing-endpoint code paths (forward checks still work for it), or
rewrite using supported operators.

## See also

- [Why nest-warden?](/docs/get-started/why/) — the four gaps in detail.
- [Tenant-aware Builder](/docs/core-concepts/tenant-builder/) — the new abstraction.
- [`accessibleBy()`](/docs/integration/typeorm/#accessibleby-for-listing-endpoints) — the perf upgrade.
