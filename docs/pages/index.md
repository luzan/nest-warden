---
title: nest-warden
---

**Tenant-aware authorization for NestJS + TypeORM, built on top of [`@casl/ability`](https://casl.js.org/).**

`nest-warden` closes four gaps in `@casl/ability` that bite multi-tenant
SaaS:

1. **No first-class tenant primitive** — forgetting `tenantId` in a rule's
   conditions silently leaks data across tenants.
2. **No graph-relationship traversal** — rules like *"Alice is an agent of
   Merchant M of Tenant X → Alice can approve M's payments"* can't be
   expressed without denormalization or pre-flight queries.
3. **No TypeORM adapter for reverse lookups** — CASL ships only Mongoose
   and Prisma adapters; TypeORM users get nothing. CASL also can't
   answer *"which Ys can Alice access?"* without loading them all and
   filtering — O(n) DB I/O.
4. **Underspecified conditional authorization** — hand-rolled condition
   translators silently drop conditions when wrong.

## Where to start

- [Introduction](/docs/get-started/introduction/) — what nest-warden is and isn't.
- [Why nest-warden?](/docs/get-started/why/) — the four gaps in detail.
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
