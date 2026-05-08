---
title: Conditional Authorization
---

Conditions are MongoDB-style queries that filter which instances of a
subject type a rule applies to. nest-warden uses CASL's stock
`mongoQueryMatcher` for forward checks and compiles the same shape to
SQL for reverse lookups.

## Supported operators

The TypeORM compiler supports these operators in v1:

| Operator | Meaning | Example |
|---|---|---|
| `$eq` (or scalar) | Equal to | `{ status: 'active' }` |
| `$ne` | Not equal | `{ status: { $ne: 'closed' } }` |
| `$in` | In set | `{ status: { $in: ['active', 'pending'] } }` |
| `$nin` | Not in set | `{ status: { $nin: ['closed'] } }` |
| `$gt`, `$gte`, `$lt`, `$lte` | Comparisons | `{ amountCents: { $lt: 100_000 } }` |
| `and`, `or`, `not` | Boolean composition | `{ $or: [{ a: 1 }, { b: 2 }] }` |
| `$relatedTo` | nest-warden's graph operator | see [`$relatedTo`](/docs/core-concepts/related-to/) |

Operators outside this set throw `UnsupportedOperatorError` at compile
time — see [§ unsupported operators](#unsupported-operators) below.

## Forward checks

Forward checks evaluate a rule against a **specific instance** loaded
from the database:

```ts
const merchant = await repo.findOneBy({ id });
if (!ability.can('update', merchant)) {
  throw new ForbiddenException();
}
```

CASL's `mongoQueryMatcher` walks the merchant instance and the rule's
conditions, returning true/false. nest-warden adds nothing here —
forward checks are stock CASL behavior.

The instance must carry `__caslSubjectType__` (or equivalent CASL
subject detection), so the matcher knows which rules apply. TypeORM
entities don't auto-tag — for forward checks, either:

```ts
// Tag manually
import { subject } from '@casl/ability';
ability.can('update', subject('Merchant', merchant));

// Or define a TaggedInterface convention on your entities
// (kind / __typename / __caslSubjectType__ properties)
```

## Reverse lookups

Reverse lookups answer **"which instances pass the rule?"** via SQL:

```ts
const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const merchants = await qb.take(50).getMany();
```

The same conditions you used in `builder.can()` compile to TypeORM
WHERE clauses. The SQL output for `{ status: 'active' }`:

```sql
WHERE m.status = $1  -- $1 = 'active'
```

For `{ status: { $in: ['active', 'pending'] }, amountCents: { $lt: 100_000 } }`:

```sql
WHERE (m.status IN ($1)) AND (m.amountCents < $2)
-- $1 = ['active', 'pending'], $2 = 100000
```

Multiple `can()` rules combine with OR. Multiple conditions in one
rule combine with AND. `cannot()` rules wrap in `NOT (...)`. The
behavior matches CASL's runtime evaluation exactly — the same rule
gives the same answer to forward and reverse queries.

## Null handling

Special-cased to use `IS NULL` / `IS NOT NULL` for SQL correctness:

```ts
builder.can('read', 'Merchant', { deletedAt: null });
// → WHERE m.deletedAt IS NULL  (NOT WHERE m.deletedAt = NULL)

builder.can('read', 'Merchant', { deletedAt: { $ne: null } });
// → WHERE m.deletedAt IS NOT NULL
```

## Empty arrays

Empty `$in` arrays compile to `1 = 0` (the false tautology) — matches
nothing, as expected:

```ts
builder.can('read', 'Merchant', { id: { $in: [] } });
// → WHERE 1 = 0
```

Empty `$nin` arrays compile to `1 = 1` (matches everything):

```ts
builder.can('read', 'Merchant', { id: { $nin: [] } });
// → WHERE 1 = 1
```

These are technically no-ops in the compiled query, but the compiler
emits the explicit form so combining fragments stays unambiguous.

## Unsupported operators

Operators outside the v1 set throw at compile time:

```ts
// Throws UnsupportedOperatorError when accessibleBy() runs
builder.can('read', 'Merchant', { name: { $regex: '^acme' } });
```

This is **deliberate**. CASL's `mongoQueryMatcher` understands more
operators than nest-warden's TypeORM compiler. Silently dropping
unsupported operators (which is what hand-rolled translators tend to
do — see the bug story in [Why nest-warden?](/docs/get-started/why/#gap-4-underspecified-conditional-authorization))
is unacceptable: it produces "match everything" rules that look
restrictive but aren't.

If you need an operator we don't support, two options:

1. **Use a `$relatedTo` with a custom resolver** — drop down to raw
   SQL inside an EXISTS subquery for that one rule.
2. **Open an issue** with the use case — operators that have clean
   SQL equivalents (`$exists`, `$mod`) are good candidates for v2.

For forward-check-only rules (you don't use `accessibleBy()` for that
subject), CASL's full operator set still works — the compiler error
only fires when the SQL adapter sees the operator.

## Field-level restrictions

Rules can scope **which fields** of a subject the action applies to,
not just whether the action applies at all. Pass an array of field
names as the third argument to `can`:

```ts
builder.can('read', 'Merchant', ['id', 'name', 'status']);
```

The rule grants `read Merchant` only for those fields. CASL's
`permittedFieldsOf` (re-exported from `@casl/ability/extra`) walks
every matching rule and returns the intersection of their field
arrays:

```ts
import { permittedFieldsOf } from '@casl/ability/extra';

const fields = permittedFieldsOf(ability, 'read', 'Merchant', {
  fieldsFrom: (rule) => rule.fields ?? ALL_MERCHANT_FIELDS,
});
// → ['id', 'name', 'status']  (for the role above)
```

The `fieldsFrom` callback returns a fallback list for rules that
**don't** specify fields — typically every column on the entity.
A rule without a field list grants every field; a rule with one
narrows the result.

### nest-warden does NOT auto-mask responses

Unlike value-level conditions (which the SQL compiler enforces in
the database), field-level restrictions are **not** propagated to
the response by the library. The controller has to project
explicitly:

```ts
const merchant = await repo.findOne({ where: { id, tenantId: ctx.tenantId } });
const fields = permittedFieldsOf(ability, 'read', 'Merchant', {
  fieldsFrom: (rule) => rule.fields ?? ALL_MERCHANT_FIELDS,
});

return Object.fromEntries(fields.map((f) => [f, merchant[f]]));
```

Two reasons for this design:

1. **The set of "all fields" lives outside CASL.** The library
   doesn't know what columns your entity has. You provide them via
   `fieldsFrom`.
2. **Projection is a presentation concern.** Different endpoints
   may want different shapes for the same authorized fields. A
   library-level interceptor would prescribe one.

For an end-to-end example, see the example app's
`MerchantsService#findOneProjected` and the
`merchant-viewer-public` role.

### Forward checks against specific fields

Per-field forward checks work too — useful for input-validation
gates on update paths:

```ts
if (!ability.can('update', merchant, 'status')) {
  throw new ForbiddenException('Cannot change status.');
}
```

The matcher returns true only if at least one rule grants `update
Merchant` AND covers the `status` field (or has no field list).

## Composition: rules + `cannot` + tenant predicate

A realistic example combining everything:

```ts
defineAbilities(builder, ctx) {
  // Agents see active merchants assigned to them
  builder.can('read', 'Merchant', {
    status: { $in: ['active', 'pending'] },
    $relatedTo: {
      path: ['agents_of_merchant'],
      where: { id: ctx.subjectId },
    },
  } as never);

  // ... but never closed merchants, regardless of assignment
  builder.cannot('read', 'Merchant', { status: 'closed' });
}
```

After `accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph })`,
the compiled WHERE looks roughly like:

```sql
(
  (m.status IN ($1))
  AND (m.tenantId = $2)
  AND EXISTS (SELECT 1 FROM agent_merchant_assignments j
              INNER JOIN agents a ON j.agent_id = a.id
              WHERE j.merchant_id = m.id AND a.id = $3)
)
AND NOT (m.status = $4 AND m.tenantId = $2)
```

Tenant predicate auto-injected, leaf-level $relatedTo as EXISTS, and
the `cannot` clause wrapped in `NOT (...)` — all from declarative rule
definitions, no manual SQL.

## See also

- [`$relatedTo` operator](/docs/core-concepts/related-to/) — graph traversal in conditions.
- [Forward vs Reverse Lookups](/docs/core-concepts/forward-vs-reverse/) — when each shape is appropriate.
- [TypeORM integration](/docs/integration/typeorm/) — `accessibleBy()` in detail.
