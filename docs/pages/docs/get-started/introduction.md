---
title: Introduction
---

`nest-warden` is a small TypeScript library that adds three capabilities
on top of [`@casl/ability`](https://casl.js.org/):

1. **Tenant safety by construction.** Every authorization rule is
   automatically pinned to the active tenant — you cannot accidentally
   write a rule that leaks across tenants.
2. **A relationship graph with the `$relatedTo` operator.** Multi-hop
   permission rules ("agent → assigned merchant → payment") become
   declarative and compile to a single SQL `EXISTS` subquery.
3. **A TypeORM `accessibleBy()` adapter** that fills the gap CASL
   itself doesn't fill — CASL ships official SQL adapters only for
   Prisma. nest-warden gives TypeORM consumers reverse lookups in a
   single query, with tenant scope and graph traversal applied
   automatically.

It also ships a first-party NestJS module (guard, decorators, request-
scoped tenant context, optional Postgres RLS interceptor), so adopting
nest-warden in a NestJS app is one `forRoot()` call and a few
decorators on your controllers.

## Who is this for

- **NestJS + TypeORM teams** building multi-tenant SaaS who want
  declarative, testable authorization without writing SQL by hand for
  every list endpoint.
- **Existing CASL users** hitting CASL's tenant-isolation footguns,
  CASL's per-rule condition repetition, or CASL's lack of a TypeORM
  reverse-lookup adapter.
- **Teams considering Zanzibar / OpenFGA** for relationship
  authorization but who want to stay inside their existing CASL +
  TypeORM stack with zero extra infrastructure.

## Who this is *not* for

- **Single-tenant apps.** The library's main value is multi-tenant
  enforcement; in single-tenant apps stock CASL is fine.
- **Non-NestJS / non-TypeORM stacks.** The core is isomorphic and
  framework-agnostic, but the adapters in v1 are NestJS + TypeORM.
  Mongoose support is on the roadmap.
- **Teams that need authorization-as-a-service** (sub-second cross-
  service propagation, distributed tuple stores, global revocation
  events) — that's where Zanzibar / OpenFGA / Permit.io shine.
  nest-warden is in-process and stops at the database.

## What's in the box

| Module | What it gives you |
|---|---|
| `nest-warden` (core) | `TenantAbilityBuilder`, `TenantContext`, `validateTenantRules`, `RelationshipGraph`, `$relatedTo` operator, error classes. Isomorphic — runs in the browser too. |
| `nest-warden/typeorm` | `accessibleBy()`, `TenantAwareRepository`, `TenantSubscriber`, `@TenantColumn`, RLS session helper, `RlsTransactionInterceptor`. |
| `nest-warden/nestjs` | `TenantAbilityModule.forRoot()`, `TenantPoliciesGuard`, `TenantContextService`, decorators (`@Public`, `@CheckPolicies`, `@CurrentTenant`, `@AllowCrossTenant`). |

## How it relates to CASL

nest-warden **builds on** CASL — it's a peer dependency and we reuse
CASL's `Ability`, `Rule`, rule indexing, and `mongoQueryMatcher` core.
We don't fork CASL or replace it; we add the multi-tenant primitives
CASL leaves out, plus the TypeORM adapter that doesn't ship in CASL
itself.

If your CASL rules already work, migrating is mostly a matter of
swapping `AbilityBuilder` for `TenantAbilityBuilder` and adding a
`resolveTenantContext` callback to the NestJS module — see the
[migration guide](/docs/integration/migration-from-casl/).

## Where to go next

- **Quick install** → [Installation](/docs/get-started/installation/)
- **Deep "why"** → [Why nest-warden?](/docs/get-started/why/)
- **Core abstractions** → [Tenant Context](/docs/core-concepts/tenant-context/)
- **NestJS wiring** → [NestJS integration](/docs/integration/nestjs/)
