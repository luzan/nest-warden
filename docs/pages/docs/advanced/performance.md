---
title: Performance
---

`accessibleBy()` produces parameterized SQL fragments — the runtime
cost is the cost of running that SQL. nest-warden adds nothing
measurable on top.

## What the library spends time on

Per request, nest-warden does:

1. Resolve the tenant context (your `resolveTenantContext` callback).
   - Typically one DB lookup against `tenant_memberships`. Constant
     time, ~1ms.
2. Build the per-request ability (`abilityFactory.build()`).
   - Calls your `defineAbilities` callback. Constant time —
     proportional to the number of `builder.can()` calls, not the
     number of resources.
   - Validates rules (`validateTenantRules`) at build time. Linear
     in rule count, microseconds for typical role definitions.
3. Run policy handlers (the `@CheckPolicies(...)` lambdas).
   - Each is a forward `ability.can()` check. Constant time.
4. (Reverse-lookup endpoints) Compile the rules to SQL via
   `accessibleBy()`.
   - Linear in rule count, microseconds. The result is one
     `andWhere(sql, params)` call on the QueryBuilder.

The first three are typically <2ms total. The fourth is microseconds
of compilation plus the cost of the resulting SQL.

## What the resulting SQL costs

The library's compiled query shape:

```sql
SELECT ... FROM your_table alias
WHERE
  -- Tenant predicate (auto-injected at rule level)
  alias.tenant_id = $1
  AND (
    -- Each can() rule's conditions, ORed
    (alias.status IN ($2)) OR
    (alias.agent_id = $3) OR
    EXISTS (...)
  )
  AND NOT (
    -- Each cannot() rule's conditions
    alias.status = $4
  )
```

Performance characteristics:

| Pattern | Cost |
|---|---|
| Tenant predicate alone | Index scan on `(tenant_id)`. Fast. |
| Scalar conditions (`status = ?`) | Index scan on `(tenant_id, status)` if compound index exists. |
| `$in` over arrays | Postgres expands to `= ANY(...)`. Index works. |
| Single-hop `$relatedTo` (FK) | One nested-loop join inside EXISTS. Fast with FK index. |
| Multi-hop `$relatedTo` | One join per hop inside EXISTS. Fast with FK indexes on every hop's column. |
| `cannot` with conditions | NOT-EXISTS-equivalent. Slightly more expensive than positive conditions. |

The bottleneck is **always** the underlying query, not the library.

## Indexing checklist

For the typical multi-tenant + agent-merchant pattern:

```sql
-- Tenant scope
CREATE INDEX merchants_tenant_id_idx ON merchants(tenant_id);

-- Compound for tenant-scoped status filter
CREATE INDEX merchants_tenant_status_idx ON merchants(tenant_id, status);

-- Junction table FKs (often missing — Postgres doesn't auto-index FKs)
CREATE INDEX agent_merchant_assignments_agent_idx
  ON agent_merchant_assignments(agent_id);
CREATE INDEX agent_merchant_assignments_merchant_idx
  ON agent_merchant_assignments(merchant_id);

-- Payments → merchant FK
CREATE INDEX payments_merchant_idx ON payments(merchant_id);
CREATE INDEX payments_tenant_status_idx ON payments(tenant_id, status);
```

Run `EXPLAIN ANALYZE` on the generated SQL early — Postgres's planner
is good but won't fix missing indexes.

## Reverse lookup vs forward check + filter

The biggest single win when adopting nest-warden is replacing this:

```ts
// O(n) — loads all, filters in memory
const all = await repo.find({ where: { tenantId } });
const visible = all.filter((m) => ability.can('read', m));
return visible.slice(0, 50);  // pagination AFTER filter — wrong
```

with:

```ts
// O(1) — server-side filter and pagination
const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
return qb.take(50).getMany();
```

For an ISO admin with 10K merchants, the listing query goes from
~1.5s (round-trip + 10K-row materialization + JS filter) to ~5ms
(single SQL with LIMIT 50).

## Caching abilities across requests

The library deliberately does **not** cache the per-request ability
across requests. Two reasons:

1. Roles can change between requests (membership revoked, role
   downgraded). A cached ability would serve stale permissions.
2. Building the ability is cheap (microseconds for typical role
   definitions) — the cache complexity isn't worth the speedup.

If your `defineAbilities` callback does expensive work (e.g., loads
custom permission rows from a database), cache the **inputs** to that
work outside `defineAbilities` rather than caching the ability
itself. A `Cache-Control` semantics is always wrong for security
state.

## Caching the relationship graph

The graph itself is built **once** at module bootstrap and shared
across requests. Path lookups are memoized per (`from`, `to`,
`maxDepth`) triple, so a graph with 20 relationships can resolve any
path in O(1) after first lookup.

If you ever modify the graph at runtime (you shouldn't, but the API
allows it for testing), the cache invalidates automatically.

## Production-traffic baseline (expected)

The library is **alpha** as of v0.1; production traffic data isn't
yet available. The plan-of-record is "exercise in a real production
deployment for one quarter before claiming v1.0 production-readiness."

In testing on Apple Silicon Postgres (testcontainers, no tuning):
- Tenant-scoped listing (no `$relatedTo`): ~3-5ms with 10K rows.
- 1-hop `$relatedTo` listing: +2-3ms.
- 2-hop `$relatedTo` listing: +5-8ms.
- 3+ hops: highly schema-dependent; benchmark on real data.

These are floor numbers — real production traffic with real query
patterns and real connection pools will be different.

## See also

- [`accessibleBy()` API](/docs/integration/typeorm/)
- [Multi-hop graph design](/docs/advanced/multi-hop-design/)
- [Testing strategies](/docs/advanced/testing/)
