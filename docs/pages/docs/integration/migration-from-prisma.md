---
title: Migrate from @casl/prisma
---

`@casl/prisma`'s `accessibleBy()` is the closest thing to nest-warden's
TypeORM adapter — they intentionally share the same call shape. If
you're moving from Prisma to TypeORM (or running both during a
transition), the migration is small.

{% callout type="note" title="Read first" %}
This guide assumes you're already comfortable with
[`accessibleBy()`](/docs/integration/typeorm/) on TypeORM. If you're
new to the concept, start with the [reverse-lookup
guide](/docs/core-concepts/forward-vs-reverse/) first.
{% /callout %}

## Side-by-side

```ts
// @casl/prisma
import { accessibleBy } from '@casl/prisma';

const where = accessibleBy(ability).Merchant;
const merchants = await prisma.merchant.findMany({ where });
```

```ts
// nest-warden
import { accessibleBy } from 'nest-warden/typeorm';

const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const merchants = await qb.getMany();
```

The signatures differ in two ways:

| Aspect | @casl/prisma | nest-warden/typeorm |
|---|---|---|
| Action | Defaults to `'read'`; pass via 2nd arg | Required, 2nd arg |
| Subject | Property accessor (`.Merchant`) | String, 3rd arg |
| Output | Prisma `where` object | TypeORM `SqlFragment` |
| Application | `prisma.merchant.findMany({ where })` | `fragment.applyTo(qb)` |

## Step 1 — Install

```bash
pnpm remove @casl/prisma
pnpm add nest-warden typeorm
```

(Keep `@casl/ability`; both libraries depend on it.)

## Step 2 — Define entities (or migrate from Prisma schema)

Prisma's `schema.prisma` becomes TypeORM `@Entity` classes:

```ts
// Was: model Merchant { id String @id ... }
// Now:
@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column('uuid', { name: 'tenant_id' }) @TenantColumn() tenantId!: string;
  @Column('text') name!: string;
  // ...
}
```

Same columns, same DB. The migration is at the ORM layer, not the
database layer.

## Step 3 — Adopt the relationship graph

Prisma's nested `where` clauses for relationships (`{ merchant: { agent: { id: '...' } } }`)
become explicit `RelationshipGraph` definitions plus `$relatedTo`
operators in nest-warden. This is more verbose but gives you:

- A single declaration per relationship, reusable across rules.
- Multi-hop paths in one operator (Prisma's nested filters get
  cumbersome past 2 hops).
- The same rules drive both forward checks and reverse lookups —
  Prisma's nested filters only work for queries, not in-memory
  `ability.can()`.

```ts
// Prisma nested filter (rule-level)
builder.can('read', 'Payment', {
  merchant: {
    agents: { some: { id: ctx.subjectId } },
  },
});

// nest-warden $relatedTo
graph
  .define({ name: 'merchant_of_payment', from: 'Payment', to: 'Merchant',
            resolver: foreignKey({ fromColumn: 'merchant_id' }) })
  .define({ name: 'agents_of_merchant', from: 'Merchant', to: 'Agent',
            resolver: joinTable({ table: 'agent_merchant_assignments',
                                  fromKey: 'merchant_id', toKey: 'agent_id' }) });

builder.can('read', 'Payment', {
  $relatedTo: {
    path: ['merchant_of_payment', 'agents_of_merchant'],
    where: { id: ctx.subjectId },
  },
} as never);
```

## Step 4 — Tenant scoping is now automatic

`@casl/prisma` doesn't have a tenant primitive — you'd have added
`tenantId: user.tenantId` to every rule. nest-warden auto-injects the
tenant predicate; remove the manual entries.

## Step 5 — Convert call sites

Anywhere you had:

```ts
const where = accessibleBy(ability).SubjectName;
const records = await prisma.subjectName.findMany({ where, take: 50 });
```

becomes:

```ts
const qb = dataSource.getRepository(SubjectClass).createQueryBuilder('s');
accessibleBy(ability, 'read', 'SubjectName', { alias: 's', graph }).applyTo(qb);
const records = await qb.take(50).getMany();
```

For aggregate/count queries:

```ts
// Prisma
const count = await prisma.subjectName.count({ where });

// nest-warden
const qb = repo.createQueryBuilder('s');
accessibleBy(ability, 'read', 'SubjectName', { alias: 's', graph }).applyTo(qb);
const count = await qb.getCount();
```

## What's the same

- The rule definitions themselves (`builder.can('action', 'Subject', { conditions })`).
- Forward checks (`ability.can(action, instance)`) — identical
  semantics; same matcher.
- Field-level permissions (CASL's `fields` mechanism is unchanged).
- `cannot()` rules with explicit deny precedence over `can()` rules.

## What's different

| Concept | Prisma | nest-warden |
|---|---|---|
| Tenant scoping | Manual on every rule | Auto-injected |
| Cross-tenant rules | Manual / no marker | Explicit `crossTenant.can(...)` with audit marker |
| Multi-hop relationships | Nested where filters | Declarative `RelationshipGraph` + `$relatedTo` |
| Rule validation | None | `validateTenantRules` at `.build()` |
| Output type | Prisma where object | TypeORM SqlFragment |
| Custom operators | Limited | `$relatedTo` (with custom-resolver escape hatch) |

## What's missing (vs Prisma)

A few `@casl/prisma` features have no direct nest-warden equivalent
yet:

- **Recursive relationships out of the box.** Prisma's nested filter
  syntax handles tree relationships somewhat naturally. nest-warden
  needs an explicit `custom` resolver with a recursive CTE for
  closure-table or path-enumeration trees.
- **Implicit eager-loading.** Prisma loads relations on demand;
  TypeORM requires explicit `relations` arrays. For forward checks
  with `$relatedTo`, you'll need to eager-load the right relations
  or use the SQL fallback.

## See also

- [`accessibleBy()` API](/docs/integration/typeorm/#accessibleby-for-listing-endpoints)
- [Relationship Graph](/docs/core-concepts/relationship-graph/)
- [Custom resolvers](/docs/advanced/custom-resolvers/) — for non-FK / non-junction patterns.
