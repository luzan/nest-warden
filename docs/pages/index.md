---
title: nest-warden
---

**An opinionated, stack-specific bundle for NestJS + TypeORM
multi-tenant SaaS, built on top of [`@casl/ability`](https://casl.js.org/).**

`nest-warden` is a bundle, not a replacement for CASL. Three
additions that the underlying tools don't ship today, plus the
integration glue most NestJS + TypeORM teams end up writing
themselves:

- **Relationship graph + `$relatedTo`** — register relationships
  once; rules express multi-hop access (*"Alice is an agent of
  Merchant M of Tenant X → Alice can approve M's payments"*);
  the TypeORM compiler emits correlated `EXISTS` subqueries.
- **Runtime tenant-predicate guarantee** — every emitted rule
  auto-pins the tenant predicate, and `validateTenantRules` throws
  at `.build()` time if any rule is missing it and isn't explicitly
  `crossTenant`. Type-level patterns catch static misuse; this
  catches everything else (`as any`, generic abilities, library
  boundaries).
- **`accessibleBy()` for TypeORM** — same shape as
  `@casl/prisma.accessibleBy()`, adapted to TypeORM's `QueryBuilder`,
  with multi-hop `$relatedTo` paths and tenant scope folded in.

Plus a NestJS module + global guard + four decorators + a TypeORM
subscriber + an RLS hook — the wiring, packaged and tested in a
real example app.

## Where to start

- [Introduction](/docs/get-started/introduction/) — what nest-warden is and isn't.
- [Why nest-warden?](/docs/get-started/why/) — what it adds, what it doesn't, the boundaries.
- [When (not) to use](/docs/get-started/when-to-use/) — Zanzibar trade-offs.
- [Installation](/docs/get-started/installation/) — get the package into your project.
- [Tenant Context](/docs/core-concepts/tenant-context/) — the central abstraction.
- [`$relatedTo` operator](/docs/core-concepts/related-to/) — the headline graph feature.
- [NestJS integration](/docs/integration/nestjs/) — wiring up the module.

{% callout type="tip" title="Try the example" %}
A complete runnable example with two tenants, three roles, RLS-enforced
isolation, and reverse-lookup queries lives in
[`examples/nestjs-app`](https://github.com/luzan/nest-warden/tree/main/examples/nestjs-app)
on GitHub. The E2E suite spins up a fresh Postgres in Docker via
testcontainers and proves every claim in these docs.
{% /callout %}
