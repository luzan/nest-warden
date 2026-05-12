---
title: Tenancy Models
---

`nest-warden` targets one tenancy model and deliberately doesn't try
to cover the rest. This page makes the choice explicit, lists what
would have to change to support each of the alternatives, and gives
a quick decision matrix for picking the right model in a new app.

## What the library assumes

**Shared database, shared schema.** Every tenant-bearing table
carries a `tenant_id` column. A single Postgres database holds rows
for every tenant; isolation is enforced by:

- the tenant predicate the library auto-injects into every CASL rule
  (`src/core/tenant-ability.builder.ts`),
- the `accessibleBy()` SQL adapter, which folds `tenant_id = ?` into
  every emitted `WHERE` (`src/typeorm/accessible-by.ts`),
- the optional Postgres RLS hook, which makes the database itself
  reject rows from other tenants regardless of any application bug
  (`src/typeorm/rls-session.ts`).

This is the model the example app demonstrates end-to-end, and the
only one the v1.0 API contract covers. If your schema has a
`tenant_id` column on every tenant-bearing table, you're in the
supported lane.

## What the library does NOT cover in v1.0

| Tenancy model | Status | One-sentence reason |
|---|---|---|
| **Shared database, shared schema** | ✅ Supported | The library was designed around this shape end-to-end. |
| **Shared database, schema-per-tenant** (one Postgres schema per tenant, switched via `search_path`) | ❌ Not supported | Would require request-scoped `search_path` injection and a `DataSource` that respects it. The library's `accessibleBy()` SQL emitter currently composes a single `WHERE tenant_id = ?` predicate; with schema-per-tenant, the predicate is absent because the schema selection is doing the isolating. |
| **Database-per-tenant** (a distinct `DataSource` per tenant) | ❌ Not supported | Would require DI-scoping a `DataSource` per request and routing repositories accordingly. The NestJS module's `TenantAbilityModule.forRoot()` registers a single application-wide `DataSource`; mapping multiple connections per request is outside the v0.x feature surface. |

The authz primitives — the builder, `$relatedTo`, the matcher, the
`accessibleBy()` AST → SQL translator — are not philosophically
incompatible with the unsupported models. They'd still hold up the
"rules form a CASL ability that compiles to a database query" part.
What changes is the integration layer: the column-level predicate
moves out of the rule and into the connection layer, and the NestJS
module has to learn to route the right connection per request.

## What would have to change to support each unsupported model

The notes below are not commitments — they're the rough shape of the
work for an interested consumer wanting to prototype outside the
official surface.

### Schema-per-tenant

- **`TenantContextInterceptor` (or its equivalent).** Set the
  connection's `search_path` to the tenant's schema before any query
  runs. Postgres-specific; mirror the pattern in
  `src/typeorm/rls-session.ts:buildRlsSet` for `set_config`.
- **The tenant predicate.** Drop it from the rules — the
  `search_path` selection is now what isolates. Either turn off
  `validateRulesAtBuild` (currently used only for the bypass path)
  or extend the validator to recognise schema-scoped rules as
  "tenant-safe by construction."
- **`accessibleBy()` emitter.** Stop folding `tenant_id` into every
  `WHERE`. The cleanest path is a config option that flips the
  emitter from "predicate mode" to "schema mode."
- **RLS hook.** Inapplicable. RLS predicates live inside a single
  schema; the protection moves to schema-level grants instead.

### Database-per-tenant

- **`DataSource` resolution.** Replace the single TypeORM
  `DataSource` registered at module bootstrap with a per-request
  resolver — `{ tenantId } → DataSource`. NestJS supports
  request-scoped providers; the wiring is non-trivial because every
  `Repository` injection has to flow through the resolver.
- **The tenant predicate.** Same as schema-per-tenant — drop it
  from rules, because the connection selection is the isolator.
- **Pooling.** A pool per tenant scales sub-linearly; most teams
  going this route pre-cluster tenants into shards. Out of scope
  for the library, but a sharp edge worth flagging.
- **Migrations.** Each tenant's database needs the schema applied
  independently. Most consumers in this shape already have tooling
  for this; if you don't, it's a precondition.

## Decision matrix

| Choose this model | If… |
|---|---|
| **Shared DB + shared schema** | You're starting a new SaaS app and don't have a strong reason to do something else. The vast majority of B2B SaaS apps live here. Operations are simplest (one database to back up, one schema to migrate, one set of indexes). |
| **Shared DB + schema-per-tenant** | Per-tenant DDL needs to diverge (custom columns, table-level encryption keys), but the operational cost of separate databases is too high. Rare in TypeScript shops; common in old-line PostgreSQL deployments. |
| **Database-per-tenant** | You have hard regulatory requirements (data sovereignty, per-tenant encryption keys with hardware backing) OR a single noisy tenant must not be able to consume IOPS from the rest. Operationally heavy — only worth it when the alternative is impossible. |

`nest-warden`'s sweet spot is the first row. If you're in row two or
three, you'd be using the library's authz primitives independently
of its tenant-scoping plumbing, and you should probably ask whether
CASL alone — without `nest-warden`'s NestJS module — would serve
you just as well.

## See also

- [Why nest-warden?](/docs/get-started/why/) — the four CASL gaps that motivated the library.
- [Tenant Context](/docs/core-concepts/tenant-context/) — the request-scoped abstraction that carries the tenant ID.
- [Postgres RLS](/docs/integration/rls-postgres/) — the database-layer defense in depth, supported only in the shared-schema model.
