---
title: FAQ
---

## Is this a CASL replacement?

No. nest-warden **builds on** CASL — `@casl/ability` is a peer
dependency. We reuse CASL's `Ability` class, rule index, and
`mongoQueryMatcher`, and add the multi-tenant primitives plus a TypeORM
adapter on top.

If you ever need to migrate off, only the `TenantAbilityBuilder`
wrapper is nest-warden-specific; the resulting `Ability` instance is
plain CASL.

## Why not just OpenFGA?

OpenFGA is excellent if you need:
- Cross-service authorization decisions (a tuple store separate from
  the database).
- Sub-second global revocation events.
- Authorization decisions that span microservices or systems.

For most NestJS + TypeORM SaaS apps where the relationship graph
already lives in your domain tables, an in-process library is simpler:
no extra service to deploy, no extra latency, no eventual consistency
between two stores. nest-warden is the in-process choice; OpenFGA is
the out-of-process choice. They're not mutually exclusive — you can
adopt nest-warden today and migrate to OpenFGA later if you outgrow
the in-process model.

## Does it work without NestJS?

Yes. The core (`nest-warden`) and TypeORM adapter (`nest-warden/typeorm`)
are framework-agnostic. The NestJS adapter (`nest-warden/nestjs`) is
optional — install only the modules you need.

You can use the core in browser bundles too; it has no Node-specific
dependencies. The NestJS module pulls in `@nestjs/common` etc., which
should not be in browser code.

## Does it work with Mongoose / Prisma / Drizzle?

Not yet for reverse lookups. v1 ships only the TypeORM `accessibleBy()`
adapter because that's the gap CASL itself doesn't fill (CASL has
official Mongoose and Prisma adapters).

Forward checks (`ability.can(action, instance)`) work with any
persistence layer because they operate on the loaded instance, not a
query — `nest-warden`'s core matcher is identical to CASL's.

A Mongoose adapter is on the roadmap. A Drizzle adapter is feasible
but not yet planned.

## How do I migrate from `@casl/ability`?

See the [migration guide](/docs/integration/migration-from-casl/).
Summary: swap `AbilityBuilder` for `TenantAbilityBuilder`, pass a
`TenantContext`, drop the `tenantId` field from your conditions (it's
auto-injected), and add `validateTenantRules` to your build step.

## How do I migrate from `@casl/prisma`?

See the [migration guide](/docs/integration/migration-from-prisma/).
The `accessibleBy(ability, action, type)` shape is intentionally
preserved; the main difference is that nest-warden's version returns a
TypeORM `SqlFragment` you apply to a `QueryBuilder`, instead of a
Prisma where-clause object.

## What's the bundle size impact?

The core (no adapters) is ≈8 KB minified + gzipped. With NestJS and
TypeORM adapters tree-shaken in, expect ≈30 KB additional weight on
your server bundle (which is normally not size-constrained).

For browser-side rule evaluation, only import the core entry — the
NestJS and TypeORM adapters are on separate subpath exports and won't
be pulled in.

## Does it support GraphQL?

The library doesn't ship a GraphQL-specific adapter, but
`accessibleBy()` and `ability.can()` are framework-agnostic — wire them
into your resolvers the same way you'd wire any access check. The
NestJS module's `TenantPoliciesGuard` works for both REST and GraphQL
contexts since NestJS abstracts the execution context.

## Is it production-ready?

**Not yet.** v0.1 is alpha. The API surface is stabilizing but may
still change. Test coverage is 100% and the canonical example app
passes 14 E2E tests against real Postgres including RLS verification,
but we haven't yet exercised the library in production traffic.

The v1.0 milestone is "exercised in a real production NestJS + TypeORM
app under sustained traffic for at least one quarter."

## Where do I report issues?

GitHub: [github.com/luzan/nest-warden/issues](https://github.com/luzan/nest-warden/issues)
