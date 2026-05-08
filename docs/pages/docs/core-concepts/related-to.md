---
title: $relatedTo Operator
---

`$relatedTo` is nest-warden's headline operator. It expresses
**graph-based authorization** in a declarative, single-rule form that
works for both forward checks and reverse lookups.

## The problem it solves

Pure CASL with this rule:

> "An Agent can approve a Payment if she's assigned to its Merchant."

requires either:
- denormalizing `agentIds` onto every Payment row (stale-data hazard), or
- running a separate query before every check (`SELECT 1 FROM
  agent_merchant_assignments WHERE ...`) — defeating CASL's "single
  evaluation" model.

Both approaches scale poorly for listing endpoints.

## The shape

```ts
{
  $relatedTo: {
    path: string[];                       // names of registered relationships
    where: Record<string, unknown>;       // Mongo-style filter on the leaf
  }
}
```

| Field | Meaning |
|---|---|
| `path` | Sequence of relationship names to traverse. The first hop's `from` must match the rule's subject. The last hop's `to` is the leaf type. |
| `where` | Mongo-style condition applied to the **leaf** instance(s). All standard operators (`$eq`, `$in`, etc.) are supported. |

## A complete example

Schema:

```
agents (id, tenant_id, ...)
agent_merchant_assignments (agent_id, merchant_id, tenant_id)
merchants (id, tenant_id, ...)
payments (id, tenant_id, merchant_id, ...)
```

Graph:

```ts
graph
  .define({ name: 'merchant_of_payment', from: 'Payment', to: 'Merchant',
            resolver: foreignKey({ fromColumn: 'merchant_id' }) })
  .define({ name: 'agents_of_merchant', from: 'Merchant', to: 'Agent',
            resolver: joinTable({ table: 'agent_merchant_assignments',
                                  fromKey: 'merchant_id', toKey: 'agent_id' }) });
```

Rule:

```ts
builder.can('approve', 'Payment', {
  $relatedTo: {
    path: ['merchant_of_payment', 'agents_of_merchant'],
    where: { id: ctx.subjectId },  // Alice's user ID
  },
} as never);
```

## What this compiles to

For a forward check `ability.can('approve', payment)`, the matcher:

1. Resolves the path through the graph (cached after first lookup).
2. For each hop, calls the relationship's `accessor(instance)` to
   walk forward in memory. If the accessor returns nothing or the hop
   has no accessor, returns `false`.
3. Applies `where` to the leaf instance(s); returns `true` if any match.

For a reverse lookup `accessibleBy(...)`, the SQL compiler emits an
EXISTS subquery:

```sql
EXISTS (
  SELECT 1
  FROM agent_merchant_assignments j_rt_0
  INNER JOIN agents a_rt_1 ON j_rt_0.agent_id = a_rt_1.id
  WHERE j_rt_0.merchant_id = p.merchant_id
    AND a_rt_1.id = $1
)
-- $1 = ctx.subjectId
```

(Aliases are auto-generated and unique. Outer alias `p` is the rule's
subject — the EXISTS correlates back to it via WHERE, **not** JOIN.)

## Combining with other conditions

`$relatedTo` is a top-level operator. It composes with sibling
conditions via implicit AND:

```ts
builder.can('approve', 'Payment', {
  status: 'pending',                              // scalar
  amountCents: { $lt: 100_000 },                  // operator form
  $relatedTo: {                                   // graph operator
    path: ['merchant_of_payment', 'agents_of_merchant'],
    where: { id: ctx.subjectId },
  },
} as never);
```

Compiles to:

```sql
WHERE p.tenantId = $1
  AND p.status = $2
  AND p.amountCents < $3
  AND EXISTS (...)
```

## Forward checks need accessors

For `ability.can(action, instance)` to evaluate `$relatedTo` in
memory, every hop in the path must have an `accessor` defined. The
accessor returns the loaded relation:

```ts
graph.define({
  name: 'agents_of_merchant',
  from: 'Merchant',
  to: 'Agent',
  resolver: joinTable({ ... }),
  accessor: (merchant) => (merchant as Merchant).agents,
  //          ^ requires the calling code to eager-load `agents`
});
```

If your TypeORM call doesn't `relations: ['agents']`, the accessor
returns `undefined` and the rule evaluates to `false` — fail-closed.

For listing endpoints (`accessibleBy()`), accessors are NOT needed —
the SQL compiler walks the resolver metadata, not the in-memory
graph. This is the typical case: most apps don't eager-load
permission relations on every record.

## Multi-hop design

The path can be any number of hops up to the configured `maxDepth`
(default 5). Best practice: keep paths to 3-4 hops max for SQL
performance and rule readability. Deeper trees are usually a
denormalization hint.

```ts
// 3-hop path: User → Tenant → Project → Task
builder.can('read', 'Task', {
  $relatedTo: {
    path: ['project_of_task', 'tenant_of_project', 'users_of_tenant'],
    where: { id: ctx.subjectId },
  },
} as never);
```

See [Multi-hop graph design](/docs/advanced/multi-hop-design/) for
schema patterns.

## Type-safety caveat

CASL's `MongoQuery` type doesn't know about `$relatedTo` (it's a
nest-warden extension). Cast through `as never`:

```ts
builder.can('read', 'Merchant', {
  $relatedTo: { path: ['agents_of_merchant'], where: { id: ctx.subjectId } },
} as never);
```

This is a TypeScript-only friction; the runtime compiler handles the
operator end-to-end. A future v2 may add a TS module-augmentation
layer that extends `MongoQuery` with our operators — until then, the
cast is the documented escape valve.

## Where it doesn't fit

- **Cross-database joins.** `$relatedTo` compiles to a single SQL
  query against one database. If your relationship spans schemas or
  databases, you'll need a custom resolver that handles the boundary
  (or a different architecture).
- **Computed permissions.** `$relatedTo` is a structural traversal;
  it doesn't run business logic. Rules that need "is this payment
  fraud-flagged AND not yet refunded" should use plain conditions on
  the subject's own columns.

## See also

- [Relationship Graph](/docs/core-concepts/relationship-graph/) — defining the edges.
- [Conditional Authorization](/docs/core-concepts/conditional-authorization/) — operators in `where`.
- [Forward vs Reverse Lookups](/docs/core-concepts/forward-vs-reverse/) — when to use which.
