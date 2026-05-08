---
title: Forward vs Reverse Lookups
---

Authorization questions come in two shapes:

1. **Forward**: *"Can this subject perform this action on this
   specific resource?"* — `ability.can(action, instance)`.
2. **Reverse**: *"Which resources can this subject perform this
   action on?"* — `accessibleBy(ability, action, type)`.

Both shapes apply the same rules but at different times in the
request lifecycle. Picking the right one matters for both correctness
and performance.

## Forward checks

Used when you've already loaded a specific record and want to gate an
action on it.

```ts
const merchant = await repo.findOneBy({ id });
if (!ability.can('update', merchant)) {
  throw new ForbiddenException();
}
await repo.update({ id }, { status: 'active' });
```

**Best for:**

- Detail-page reads (`GET /merchants/:id`)
- Mutating actions (`POST /merchants/:id/approve`)
- Per-record audit checks inside a service

**Performance:** Constant time. The matcher walks the loaded instance
against the rule's conditions in memory.

**Caveat for `$relatedTo`:** Forward checks need the relationship
relations eager-loaded for `$relatedTo` rules to evaluate correctly.
Without eager loading, the rule conservatively returns `false`. The
example app's `MerchantsService.findOne()` falls back to a single-row
EXISTS query when the eager load isn't available — see [`merchants.service.ts`](https://github.com/luzan/nest-warden/blob/main/examples/nestjs-app/src/merchants/merchants.service.ts).

## Reverse lookups

Used when you want a list of records the subject is allowed to see —
without loading every row and filtering in memory.

```ts
const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const merchants = await qb
  .andWhere('m.status = :status', { status: 'active' })
  .orderBy('m.name')
  .take(50)
  .getMany();
```

**Best for:**

- Listing endpoints (`GET /merchants`)
- Search and filter UIs
- Reports and dashboards

**Performance:** Single SQL query. Server-side `LIMIT`/`ORDER BY`
work normally. The compiled WHERE includes:

- The tenant predicate (auto-injected at rule-build time).
- All `can` rules ORed together.
- All `cannot` rules wrapped in `NOT (...)`.
- Multi-hop `$relatedTo` paths as `EXISTS` subqueries.

For an ISO admin with 10K merchants, the listing endpoint stays
fast — the SQL is one bounded query, not 10K filter calls.

## When to use which

| Scenario | Recommended shape |
|---|---|
| `GET /merchants` (listing) | Reverse — `accessibleBy()` |
| `GET /merchants/:id` (detail) | Forward — `ability.can()` after `findOne` |
| `POST /merchants/:id/approve` | Forward — load + `ability.can()` |
| Sidebar widget showing accessible counts | Reverse — `accessibleBy().getCount()` |
| Service-level guard inside a multi-step transaction | Forward — load + check per record |
| GraphQL resolver returning a connection | Reverse — pagination depends on it |

## They give the same answer

For any rule, forward check on instance `X` matches reverse-lookup
inclusion of `X`:

> `ability.can(action, X) === (accessibleBy(...).getMany() includes X)`

The library's E2E test suite (`merchants-controller.e2e.test.ts` in the
example app) verifies this property — Alice's listing endpoint
returns exactly the merchants for which `ability.can('read', m)`
returns true, no more, no less. If you ever observe a divergence,
that's a bug — please file an issue.

## Anti-patterns

{% callout type="danger" title="Don't load all and filter (the O(n) anti-pattern)" %}
```ts
// O(n) — won't scale past a few hundred records per tenant
const all = await repo.find({ where: { tenantId } });
const visible = all.filter((m) => ability.can('read', m));
```

This is what teams write before adopting `accessibleBy()`. It's
correct but slow, and it doesn't compose with database-side
pagination, ordering, or counting. Always prefer reverse lookups for
listing.
{% /callout %}

{% callout type="warning" title="Don't reverse-lookup for single-record actions" %}
```ts
// Wasteful — runs a query when a forward check would do
const allowed = await accessibleBy(ability, 'update', 'Merchant', { alias: 'm', graph })
  .applyTo(repo.createQueryBuilder('m').where('m.id = :id', { id }))
  .getOne();
if (!allowed) throw new ForbiddenException();
```

For "load this record and check permission", just load the record and
call `ability.can('update', merchant)`. Reverse lookups are for
**lists**.
{% /callout %}

## See also

- [TypeORM integration](/docs/integration/typeorm/) — `accessibleBy()` in detail.
- [Performance](/docs/advanced/performance/) — query plans, indexes, and scale notes.
