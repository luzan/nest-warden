---
title: Multi-hop Graph Design
---

`$relatedTo` paths can be any depth up to the configured `maxDepth`
(default 5). In practice, deep paths are usually a sign the schema
or rule architecture wants tightening.

## Rule of thumb

| Path depth | Diagnosis |
|---|---|
| 1 hop | The most common case. `Payment → Merchant`, `User → Tenant`. |
| 2 hops | Common, healthy. `Payment → Merchant → Agent`, `Comment → Post → Author`. |
| 3 hops | Acceptable for genuine multi-level membership. `Task → Project → Tenant → User`. |
| 4 hops | Smell. Consider whether you're modeling a deep hierarchy that should use a closure table or computed shortcut. |
| 5+ hops | Likely a denormalization opportunity. The query plan is suspect. |

The library enforces `maxDepth` purely as a sanity gate against
runaway joins; staying well under it is the right pattern.

## Shortcut relationships

If a 4-hop traversal appears in many rules, define a single
`shortcut` relationship that compiles to the same logical query. For
example, instead of:

```
Comment → Post → Project → Tenant → User
```

denormalize a `tenant_id` onto Comment and define:

```
Comment → User (via tenant_id)
```

Trade-off: the denormalized column needs to stay consistent (insert
trigger, application logic, or both). For static graphs (a comment's
tenant doesn't change) this is cheap.

## Many-to-many in the middle of a path

When a path has a many-to-many hop in the middle, the EXISTS
subquery's join multiplies rows. Postgres's planner deduplicates
correctly via `EXISTS` semantics (we're testing presence, not
counting), but other databases can struggle.

Test the query plan early:

```ts
const fragment = buildAccessibleSql(ability, 'read', 'Payment', {
  alias: 'p', graph,
});
console.log(fragment?.sql);
// Run EXPLAIN on the resulting query against representative data
```

## Cycles

The graph supports cycles in registration (e.g., `User →
Workspace → User` to express co-membership). The BFS path resolver
won't loop indefinitely — it tracks visited subject types and
rejects revisits.

If you want to traverse a cycle deliberately (e.g., "every user in
my workspace"), define a custom resolver that handles the
traversal in raw SQL. Path-based traversal can't expand a cycle
because BFS treats already-visited types as terminal.

## Multi-tenancy + multi-hop interaction

Tenant scope is enforced at the **outer** subject level by the
auto-injected `tenantId` predicate. The `$relatedTo` EXISTS
subquery doesn't re-apply the tenant predicate to every joined
table — that's redundant when all the data lives in one tenant's
rows anyway.

If your schema has cross-tenant references **inside** a graph
(e.g., a system role that bridges tenants), explicitly include the
tenant predicate in the leaf `where`:

```ts
builder.can('read', 'Payment', {
  $relatedTo: {
    path: ['platform_admin_role'],
    where: {
      id: ctx.subjectId,
      // No tenantId here — system role spans tenants
    },
  },
} as never);
```

Combined with `crossTenant.can()` for the platform-admin path, this
keeps the bridge intentional and auditable.

## Eager-loading vs SQL fallback for forward checks

Forward checks via `ability.can(action, instance)` walk the
`$relatedTo` path through in-memory accessors. If the relations
aren't eager-loaded, the rule conservatively returns `false`.

Two patterns to handle this:

### Pattern 1: eager-load the path's relations

```ts
const merchant = await repo.findOne({
  where: { id, tenantId },
  relations: ['agents'],  // for $relatedTo path ['agents_of_merchant']
});
const allowed = ability.can('read', merchant);
```

Works for short paths. For 3+ hop paths, the eager-load gets
expensive and leaks query shape into auth logic.

### Pattern 2: SQL fallback

When the in-memory check returns `false`, run a single-row
`accessibleBy()` to confirm:

```ts
async function canAccess(merchantId: string, ability: AppAbility): Promise<boolean> {
  const qb = repo.createQueryBuilder('m').select('1').where('m.id = :id', { id: merchantId });
  accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
  return (await qb.getRawOne()) !== undefined;
}
```

This is what the example app's `MerchantsService.findOne()` does.
The SQL is a single fast EXISTS-style query (with `LIMIT 1`-like
semantics from `getRawOne`). Pattern 2 scales better than Pattern
1 for deep paths.

## Performance baseline

The example app's E2E suite seeds:

- 10 merchants per tenant × 2 tenants = 20 merchants
- ~30 payments distributed across merchants
- ~10 agent ↔ merchant assignments

For an ISO-admin listing query (no `$relatedTo`, just tenant +
status filter), end-to-end latency is < 5ms on testcontainers
Postgres on Apple Silicon. The agent listing query (1-hop
`$relatedTo` via join table) adds ~2ms.

For your own performance baseline:

1. Capture the generated SQL for each listing endpoint via
   `buildAccessibleSql(...)` + `console.log(fragment.sql)`.
2. Run `EXPLAIN ANALYZE` on representative data shapes (1k rows,
   10k rows, 100k rows).
3. Index the columns you join on. The library doesn't manage
   indexes; you do.

## See also

- [`$relatedTo` operator](/docs/core-concepts/related-to/)
- [Performance](/docs/advanced/performance/)
- [Custom resolvers](/docs/advanced/custom-resolvers/)
