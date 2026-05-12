---
title: Why nest-warden?
---

`@casl/ability` is the de facto authorization library for TypeScript
SaaS. Its declarative DSL, condition matcher, and field-level
permissions are excellent. But four gaps make it painful for
multi-tenant systems at scale.

## Gap 1: No first-class tenant primitive

CASL has no concept of a "tenant." Multi-tenant rules are written by
manually adding `tenantId` to every condition:

```ts
// CASL — manual tenant scoping
builder.can('read', 'Merchant', { tenantId: user.tenantId, status: 'active' });
builder.can('update', 'Merchant', { tenantId: user.tenantId, agentId: user.id });
//                                  ^^^^^^^^^^^^^^^^^^^^^^^^
//                                  forget this once → cross-tenant leak
```

Forgetting `tenantId` in a single rule produces a silent
cross-tenant data leak. There's no compile-time or runtime check.

**nest-warden's fix.** Every `builder.can()` / `builder.cannot()` call
is automatically pinned to the active tenant. To intentionally write a
cross-tenant rule (platform support, audit), use the explicit
`builder.crossTenant.can(...)` — making the choice visible and
auditable. `validateTenantRules` runs at `.build()` time and throws if
any rule lacks a tenant predicate AND isn't marked cross-tenant.

```ts
// nest-warden — auto tenant-scoped, fail-loud on the rare opt-out
builder.can('read', 'Merchant', { status: 'active' });
//   ^ tenantId injected automatically from TenantContext

builder.crossTenant.can('read', 'Merchant');
//                  ^ explicit, auditable, marked on the rule
```

## Gap 2: No graph-relationship traversal

CASL's conditions are flat MongoDB queries. Rules like *"Alice can
approve a Payment if she's an Agent assigned to its Merchant"* require
either (a) denormalizing `agentId` onto the Payment row, or (b) running
a pre-flight query on every check.

```ts
// CASL — needs denormalized field on Payment
builder.can('approve', 'Payment', { merchantAgentIds: { $in: [user.id] } });
//                                    ^^^^^^^^^^^^^^^^
//                                    denormalized; gets stale on agent reassignment
```

**nest-warden's fix.** Register relationships once at module bootstrap;
rules reference them via `$relatedTo`:

```ts
graph
  .define({ name: 'merchant_of_payment', from: 'Payment', to: 'Merchant',
            resolver: foreignKey({ fromColumn: 'merchant_id' }) })
  .define({ name: 'agents_of_merchant', from: 'Merchant', to: 'Agent',
            resolver: joinTable({ table: 'agent_merchant_assignments',
                                  fromKey: 'merchant_id', toKey: 'agent_id' }) });

builder.can('approve', 'Payment', {
  $relatedTo: {
    path: ['merchant_of_payment', 'agents_of_merchant'],
    where: { id: ctx.subjectId },
  },
});
```

The same rule drives both forward checks (`ability.can(action, payment)`)
and reverse lookups (`accessibleBy()`) — no denormalization required.

## Gap 3: No TypeORM reverse-lookup adapter

CASL's `accessibleBy()` answers *"which records can the user see?"* in
a single query. CASL ships official adapters for Mongoose
(`@casl/mongoose`) and Prisma (`@casl/prisma`). TypeORM users get
**nothing**.

The workaround in pure CASL with TypeORM:

```ts
// O(n) anti-pattern: load all, filter in memory
const all = await repo.find({ where: { tenantId } });
const visible = all.filter((m) => ability.can('read', m));
```

For an ISO admin with 10,000 merchants this is a 10,000-row hit on
every list endpoint.

**nest-warden's fix.** First-class `accessibleBy()` for TypeORM:

```ts
const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const merchants = await qb.take(50).getMany();
//                                 ^^^^^^^^^^
//                              single SQL query, server-side limit
```

The same shape as `@casl/prisma.accessibleBy()`, adapted to TypeORM's
`QueryBuilder`. Multi-hop `$relatedTo` paths compile to `EXISTS`
subqueries. Tenant scope is folded in automatically.

## Gap 4: Underspecified conditional authorization

CASL's MongoDB-style condition matcher works at runtime, but in
practice consumers often write hand-rolled translators that introduce
subtle bugs. A representative pattern that's bitten real codebases:

```ts
// Buggy translator — emits an unrecognised operator key
private translateCondition(cond: any): MongoQuery {
  if (cond.StringEquals) {
    Object.entries(cond.StringEquals).forEach(([f, v]) => {
      query[f] = { equals: v };  // ← invalid Mongo; should be `$eq` or scalar
    });
  }
  return query;
}
```

CASL doesn't error on this. Its `ObjectQueryParser` walks the
conditions object key-by-key; if a key isn't a registered operator
(e.g. `$eq`, `$in`), the parser falls back to treating it as a
**field name** and the value as the right-hand side of the default
operator. The misspelt rule compiles and runs without complaint.

What happens next depends on which side of CASL you're on:

- **Forward check (`ability.can(subject)`)** — fails *closed*. The
  matcher compares `subject.status` (a string) to the literal object
  `{ equals: 'value' }`, always returns `false`, and the rule never
  grants access. Annoying but visible: users open tickets when
  permissions disappear.
- **Reverse lookup (`accessibleBy(...)`) through a hand-rolled
  adapter** — fails *open* in the unsafe case. The CASL-shipped
  adapters (`@casl/prisma`, `@casl/mongoose`) tend to throw on
  unknown shapes, but consumer-written SQL/TypeORM/Drizzle adapters
  — common because no official `@casl/typeorm` exists — frequently
  drop unknown operators when assembling a WHERE clause. The rule's
  conditions collapse to "no filter" and **every row** is returned.
  Silent permission *escalation*; no ticket because the UI looks
  fine.

A runnable 7-case repro is at
[`examples/casl-conditions-demo`](https://github.com/luzan/nest-warden/tree/main/examples/casl-conditions-demo);
it also documents an asymmetry inside CASL itself — Prisma's `equals`
instruction validates and rejects object/array RHS, while Mongo's
`$eq` has no `validate()` at all.

**nest-warden's fix.** Conditions go through CASL's own
`mongoQueryMatcher` directly — no hand-rolled translator. The TypeORM
compiler `accessibleBy()` validates supported operators at compile
time and throws `UnsupportedOperatorError` for anything outside the
documented set. **Silent drops are impossible** because every
operator is either compiled or rejected.

## Where this *doesn't* compete

nest-warden is **not** a Zanzibar / OpenFGA replacement. It runs
in-process, stays inside one database, and offers no cross-service
relationship propagation. If you need:

- Sub-second global revocation across services
- A dedicated tuple store with a separate query language
- Multi-region replication of relationship state

… an external authorization service is the right answer.

nest-warden's sweet spot is **single-database, multi-tenant SaaS where
the relationship graph already lives in your domain tables**. For
~95% of NestJS + TypeORM SaaS apps, that's the case — and shipping a
Zanzibar service alongside the app is operational overhead the team
doesn't need.

## Supported tenancy models

`nest-warden` targets **shared database + shared schema** (a
`tenant_id` column on every tenant-bearing table). Schema-per-tenant
and database-per-tenant are not supported in v1.0.

See [Tenancy Models](/docs/core-concepts/tenancy-models/) for the
full comparison table, the work that would be needed to support the
unsupported variants, and a decision matrix for picking the right
model in a new app.

## Read next

- [Tenancy Models](/docs/core-concepts/tenancy-models/) — the supported model, in detail.
- [Installation](/docs/get-started/installation/) — get started.
- [Tenant Context](/docs/core-concepts/tenant-context/) — the central abstraction.
- [`$relatedTo`](/docs/core-concepts/related-to/) — the multi-hop operator in detail.
