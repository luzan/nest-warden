---
title: Relationship Graph
---

The **`RelationshipGraph`** is nest-warden's first-class concept for
"how subject types are connected in the database." Register
relationships once at module bootstrap, then reference them by name
inside rule conditions via [`$relatedTo`](/docs/core-concepts/related-to/).

## Why declarative graphs

Without a graph, multi-hop authorization rules either denormalize keys
onto every resource or run pre-flight queries. Both approaches
silently get out of sync as the data shape evolves. A registered
graph:

- Lives in **one place** (your `app.relationships.ts`), discoverable
  by `git grep`.
- Compiles to SQL **the same way every time** — both forward checks
  (in-memory accessors) and reverse lookups (`accessibleBy()`) walk
  the same path metadata.
- Validates at module bootstrap that every relationship referenced in
  rules actually exists.
- Catches cycles and overly-deep paths before they reach the database.

## Defining a graph

```ts
import { RelationshipGraph, foreignKey, joinTable } from 'nest-warden';

export const relationshipGraph = new RelationshipGraph()
  .define({
    name: 'merchant_of_payment',
    from: 'Payment',
    to: 'Merchant',
    resolver: foreignKey({
      fromColumn: 'merchant_id',
      toColumn: 'id',
    }),
  })
  .define({
    name: 'agents_of_merchant',
    from: 'Merchant',
    to: 'Agent',
    resolver: joinTable({
      table: 'agent_merchant_assignments',
      fromKey: 'merchant_id',
      toKey: 'agent_id',
    }),
  });
```

Each relationship has:

| Field | Purpose |
|---|---|
| `name` | Unique identifier referenced from `$relatedTo.path`. Pick a descriptive snake_case name. |
| `from` | Source subject type (string). |
| `to` | Target subject type (string). |
| `resolver` | How to traverse this edge: foreign key, join table, or custom SQL. See [Resolvers](#resolvers). |
| `accessor` | Optional. In-memory function `(fromInstance) => toInstance \| toInstance[]` for forward-direction `$relatedTo` checks. |

## Directionality

Relationships are **directed**. `agents_of_merchant` (Merchant → Agent)
is a different edge from `merchant_agents` (Agent → Merchant). If you
need to traverse in both directions, define both.

This is intentional: bidirectional relationships are usually a sign
the resolver should be different on each side (e.g., FK direction
matters for SQL).

## Resolvers

Three built-in resolver kinds cover ~95% of real-world schemas:

### `foreignKey`

A 1:N or N:1 relationship via a single FK column.

```ts
foreignKey({
  fromColumn: 'merchant_id',  // column on the `from` table
  toColumn: 'id',             // column on the `to` table (default: 'id')
})
```

Generated SQL (inside an EXISTS subquery):

```sql
FROM merchants m_rt_0
WHERE p.merchant_id = m_rt_0.id
```

### `joinTable`

A many-to-many relationship via a junction table.

```ts
joinTable({
  table: 'agent_merchant_assignments',
  fromKey: 'merchant_id',     // column on junction → from-side
  toKey: 'agent_id',          // column on junction → to-side
  fromPrimaryKey: 'id',       // PK of from table (default 'id')
  toPrimaryKey: 'id',         // PK of to table (default 'id')
})
```

Generated SQL:

```sql
FROM agent_merchant_assignments j_rt_0
INNER JOIN agents a_rt_0 ON j_rt_0.agent_id = a_rt_0.id
WHERE j_rt_0.merchant_id = m.id
```

### `custom`

Escape hatch for relationships that don't fit the FK or join-table
patterns — closure tables, recursive CTEs, materialized hierarchies.
The resolver embeds your raw SQL inside the EXISTS subquery; consumers
are responsible for parameterization safety.

```ts
custom({
  sql: `
    FROM agents {to_alias}
    WHERE EXISTS (
      SELECT 1 FROM agent_hierarchy
      WHERE ancestor_id = {from_alias}.id
        AND descendant_id = {to_alias}.id
    )
  `,
})
```

The compiler substitutes `{from_alias}`, `{from_column}`, and
`{to_alias}` placeholders. Use `{:paramName}` for bound values:

```ts
custom({
  sql: `
    FROM agents {to_alias}
    WHERE {to_alias}.parent_id = {from_alias}.id
      AND {to_alias}.status = {:active}
  `,
  params: { active: 'active' },
})
```

## Path resolution

`graph.path(from, to)` returns the shortest sequence of relationships
linking two subject types, computed via BFS. Useful for diagnostics:

```ts
const path = graph.path('Payment', 'Agent');
console.log(path?.hops.map((h) => h.name));
// → ['merchant_of_payment', 'agents_of_merchant']
```

Path lookups are cached per (`from`, `to`, `maxDepth`) triple.

`graph.resolvePath(['name1', 'name2', ...])` validates a hand-specified
path: every name must be registered, and consecutive hops must chain
(`hops[i].to === hops[i+1].from`). This is what `$relatedTo` uses
internally.

## Depth limit

The default maximum path depth is 5. Prevents accidental N-hop joins
that would generate massive SQL queries:

```ts
graph.path('Payment', 'CreditOrigin', { maxDepth: 8 });
//                                       ^ explicit override
```

Throws `RelationshipDepthExceededError` if `throwOnMissing: true` is
set and no path is found within the limit.

## Cycle safety

The BFS path resolver tracks visited subject types — revisiting a
type is rejected (BFS guarantees the first visit was the shortest, so
revisits add length without value). This means cycles in the graph
are safe; they don't cause infinite loops.

## See also

- [`$relatedTo` operator](/docs/core-concepts/related-to/) — using the graph in rules.
- [Custom resolvers](/docs/advanced/custom-resolvers/) — exotic schemas.
- [Multi-hop graph design](/docs/advanced/multi-hop-design/) — schema patterns for deep traversal.
