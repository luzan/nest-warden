---
title: Why nest-warden?
---

`nest-warden` is an opinionated, stack-specific bundle for one
shape of app: **NestJS + TypeORM + multi-tenant SaaS**. It builds
on top of [`@casl/ability`](https://casl.js.org/) without trying to
replace or fix it.

This page is the honest pitch — what nest-warden adds, what it
doesn't, and where the boundaries are. If you came here expecting
a "four gaps in CASL" framing, that was the earlier version of
this page; the rationale for the rewrite is in CHANGELOG
`0.5.1-alpha`.

## What nest-warden adds

Three additions that the underlying tools don't ship today, plus
the NestJS / TypeORM integration glue.

### 1. Relationship graph + `$relatedTo`

A registered-once graph of relationships between resources, plus a
`$relatedTo` operator that walks the graph at rule time. CASL's
conditions are flat MongoDB queries. Rules like *"Alice can approve
a Payment if she's an Agent assigned to its Merchant"* otherwise
require either (a) denormalising `agentId` onto the Payment row, or
(b) running a pre-flight query on every check.

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
and reverse lookups (`accessibleBy()`). The TypeORM compiler emits
correlated `EXISTS` subqueries from the path. There's no equivalent
in CASL or its current ecosystem.

### 2. Runtime tenant-predicate guarantee

CASL has no built-in tenant concept. Multi-tenant rules in plain
CASL look like:

```ts
// CASL — manual tenant scoping
builder.can('read', 'Merchant', { tenantId: user.tenantId, status: 'active' });
builder.can('update', 'Merchant', { tenantId: user.tenantId, agentId: user.id });
//                                  ^^^^^^^^^^^^^^^^^^^^^^^^
//                                  forget this once → cross-tenant leak
```

CASL's type system has extension points that can express "tenantId
is mandatory" at the type level, which catches *static* misuse at
compile time. nest-warden adds the *runtime* guarantee on top:

- `TenantAbilityBuilder.can(...)` / `.cannot(...)` automatically
  pin the tenant predicate on every emitted rule.
- `validateTenantRules` runs at `.build()` time and throws
  `CrossTenantViolationError` if any rule is missing the predicate
  and isn't explicitly marked `crossTenant`.

Together: type-level patterns catch what's reachable through types;
runtime validation catches everything else (`as any`, generic
abilities, library boundaries, dynamic rule construction). Defense
in depth, not redundant.

```ts
// nest-warden — auto tenant-scoped at runtime
builder.can('read', 'Merchant', { status: 'active' });
//   ^ tenantId injected automatically from TenantContext

builder.crossTenant.can('read', 'Merchant');
//                  ^ explicit, auditable, marked on the rule
//                    so validateTenantRules accepts it
```

### 3. `accessibleBy()` for TypeORM

CASL ships official reverse-lookup adapters for Mongoose
(`@casl/mongoose`) and Prisma (`@casl/prisma`). TypeORM users
currently write their own. The workaround in pure CASL:

```ts
// O(n) anti-pattern: load all, filter in memory
const all = await repo.find({ where: { tenantId } });
const visible = all.filter((m) => ability.can('read', m));
```

For an ISO admin with 10,000 merchants that's a 10,000-row hit per
list endpoint. nest-warden ships a TypeORM adapter:

```ts
const qb = repo.createQueryBuilder('m');
accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
const merchants = await qb.take(50).getMany();
//                                 ^^^^^^^^^^
//                              single SQL query, server-side limit
```

Same shape as `@casl/prisma.accessibleBy()`, adapted to TypeORM's
`QueryBuilder`. Multi-hop `$relatedTo` paths compile to `EXISTS`
subqueries with correlated WHERE. Tenant scope is folded in
automatically.

The compiler validates every operator at compile time and throws
`UnsupportedOperatorError` for anything outside the documented set.
Consumers can't accidentally silent-drop a misspelt operator into
"no filter" — every operator is either compiled or rejected.

**Note on the upstream roadmap.** A broader SQL-adapter effort
exists upstream (`@ucast/sql`). As it matures, nest-warden's
TypeORM compiler may migrate to consume it rather than continue
re-implementing the AST→SQL layer. The migration path is tracked
in the roadmap (Theme 11C).

### 4. NestJS / TypeORM integration glue

A module (`TenantAbilityModule.forRoot` / `.forRootAsync`), a
request-scoped `TenantContextService`, a global `TenantPoliciesGuard`,
four decorators (`@CheckPolicies`, `@CurrentTenant`,
`@AllowCrossTenant`, `@Public`), a TypeORM subscriber that stamps
`tenantId` on insert and rejects cross-tenant updates, and an RLS
session-variable hook.

None of this is novel design — it's the wiring most teams end up
writing themselves. Packaging it once, tested against a real
example app with Postgres + RLS, removes a class of boilerplate
plus a class of "did the team get the wiring right" bug.

## What nest-warden isn't

- **Not a replacement for `@casl/ability`.** Every rule you build
  is a CASL rule. nest-warden is the bundle around CASL, not a
  reimplementation.
- **Not a fix for CASL bugs.** CASL's matchers behave correctly
  and its shipped adapters (`@casl/prisma`, `@casl/mongoose`)
  validate properly. nest-warden's additions sit on top of a
  sound foundation — they're not patches for a leaky one. Earlier
  drafts of this page used a "four gaps in CASL" framing; that
  framing was too strong, and the change history is in CHANGELOG
  `0.5.1-alpha`.
- **Not a Zanzibar / OpenFGA replacement.** Single app, single
  database. No cross-service relationship propagation. See
  [`When (not) to use`](/docs/get-started/when-to-use/) for the
  full boundary.
- **Not the right tool if you don't use NestJS + TypeORM.** The
  core (`nest-warden`) is isomorphic and works anywhere CASL does,
  but the integration value lives in `nest-warden/nestjs` and
  `nest-warden/typeorm`. On Fastify standalone or Mongoose, you'd
  import core and write the rest yourself — at which point CASL
  alone may serve you.

## A note on conditional-authorization correctness

A previous version of this page claimed CASL "underspecified"
conditional authorization — i.e., that misspelt operator keys
silently produced rules that match every row. The claim was
imprecise. What CASL actually does:

- `ObjectQueryParser` reinterprets unknown operator keys as field
  names. The misspelt rule compiles without complaint.
- The forward-check matcher then compares the field value to the
  unintended right-hand-side (typically `false`), so the rule
  *never matches*. `ability.can(...)` fails closed — annoying for
  users, but safe.
- CASL's shipped reverse-lookup adapters (`@casl/prisma`,
  `@casl/mongoose`) validate the shape and throw on the bad
  operator key. They don't silently drop.

The "matches every row" failure mode is real, but specific to
**consumer-written SQL adapters** — which exists because no
official `@casl/typeorm` ships today (see point 3 above). It's a
downstream symptom of the missing adapter, not a CASL flaw.

nest-warden's TypeORM compiler avoids the failure mode by
explicit operator allow-list (every operator is either compiled
or rejected with `UnsupportedOperatorError`). The runnable repro
that originally motivated this section lives at
[`examples/casl-conditions-demo`](https://github.com/luzan/nest-warden/tree/main/examples/casl-conditions-demo)
if you want to see the behaviour first-hand.

## Where this doesn't compete

nest-warden is **not** a Zanzibar / OpenFGA replacement. It runs
in-process, stays inside one database, and offers no cross-service
relationship propagation. If you need:

- Sub-second global revocation across services
- A dedicated tuple store with a separate query language
- Multi-region replication of relationship state

… an external authorization service is the right answer.

nest-warden's sweet spot is **single-database, multi-tenant SaaS
where the relationship graph already lives in your domain
tables**. For ~95% of NestJS + TypeORM SaaS apps, that's the case
— and shipping a Zanzibar service alongside the app is operational
overhead the team doesn't need.

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
- [When (not) to use](/docs/get-started/when-to-use/) — the full boundary.
- [Installation](/docs/get-started/installation/) — get started.
- [Tenant Context](/docs/core-concepts/tenant-context/) — the central abstraction.
- [`$relatedTo`](/docs/core-concepts/related-to/) — the multi-hop operator in detail.
