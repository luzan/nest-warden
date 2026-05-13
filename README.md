# nest-warden

Tenant-aware authorization for NestJS + TypeORM, built on top of [`@casl/ability`](https://casl.js.org/).

> **⚠️ Alpha / experimental — do not use in production yet.**
>
> `nest-warden` is **0.5.3-alpha**. The API surface is stabilizing but
> remains subject to breaking changes between alpha releases. Names,
> signatures, and module boundaries may shift before v1.0.
>
> **v1.0 target:** end of May 2026. The v1.0 milestone is gated on a
> production-soak period — "exercised in a real NestJS + TypeORM app
> for at least one quarter" — plus the API freeze and library-coupling
> hardening tracked in the [public roadmap](./docs/pages/docs/roadmap/things-to-do.md)
> (Themes 4 and 8). Until then, treat every alpha release as
> experimental and pin to an exact version (`"nest-warden": "0.5.3-alpha"`)
> rather than a range.

## What this is

`nest-warden` is an opinionated, stack-specific bundle for one
shape of app: **NestJS + TypeORM + multi-tenant SaaS**. It builds
on top of [`@casl/ability`](https://casl.js.org/) without trying to
replace or fix it.

If you already know CASL, the simplest framing is: nest-warden
packages the patterns that work for the multi-tenant case, adds
runtime-safety enforcement on top of the type-level patterns CASL
supports, and ships the NestJS + TypeORM integration glue.

Three things it adds that the underlying tools don't (today):

- **Relationship graph + `$relatedTo`.** A registered-once graph of
  relationships between resources, plus a `$relatedTo` operator
  that walks the graph at rule time. Multi-hop access like *"Alice
  is an agent of Merchant M of Tenant X → Alice can approve M's
  payments"* compiles directly to `EXISTS` subqueries without
  denormalization or pre-flight loads. There's no equivalent in
  CASL or its current ecosystem.

- **Runtime tenant-predicate guarantee.** Forgetting `tenantId` in a
  CASL rule's conditions is a silent cross-tenant leak in plain
  CASL. nest-warden's `TenantAbilityBuilder` auto-injects the
  predicate on every emitted rule, and `validateTenantRules`
  throws at `.build()` time if any rule is missing the predicate
  and isn't explicitly marked `crossTenant`. The check runs even
  when the type system would have allowed the rule (`as never`,
  generic abilities, cross-package boundaries) — type-level
  patterns catch static misuse; this catches everything else.

- **`accessibleBy()` for TypeORM.** CASL ships official adapters
  for Mongoose and Prisma. TypeORM users currently have to write
  their own. nest-warden ships one — same shape as
  `@casl/prisma.accessibleBy()`, adapted to TypeORM's QueryBuilder,
  with `$relatedTo` paths compiled to correlated `EXISTS`
  subqueries and tenant scope folded in automatically. A broader
  SQL-adapter effort is on the upstream roadmap (`@ucast/sql`); as
  it matures, nest-warden's compiler may migrate to consume it
  rather than re-implement.

Plus the NestJS integration: a module, a global guard,
request-scoped tenant context, four decorators, a TypeORM
subscriber + RLS session hook. None of this is novel design — it's
the wiring most teams end up writing themselves, packaged once and
tested in an example app that ships with the library.

## What it isn't

- **Not a replacement for `@casl/ability`.** CASL is the rule
  engine; nest-warden is a bundle around it. Every rule you build
  is a CASL rule.
- **Not a fix for CASL bugs.** Earlier drafts of this README
  described nest-warden as filling "gaps" in CASL; the framing was
  too strong. CASL's matchers and shipped adapters behave correctly.
  The runtime tenant guarantee and `accessibleBy()` for TypeORM are
  additions on top of a sound foundation, not patches for a leaky
  one. (The history of that framing — and why it changed — is in
  CHANGELOG `0.5.3-alpha`.)
- **Not a Zanzibar / OpenFGA replacement.** Single app, single
  database. No cross-service relationship propagation. See
  [`/docs/get-started/when-to-use/`](./docs/pages/docs/get-started/when-to-use.md)
  for the full boundary.
- **Not the right tool if you don't use NestJS + TypeORM.** The
  core (`nest-warden`) is isomorphic and works anywhere CASL does,
  but the integration value lives in `nest-warden/nestjs` and
  `nest-warden/typeorm` — if you're on Fastify standalone or
  Mongoose, you'd be importing core and writing the rest yourself
  (at which point CASL alone may serve you).

## Install

```bash
pnpm add nest-warden @casl/ability
# Plus the adapters you need:
pnpm add @nestjs/common @nestjs/core typeorm reflect-metadata rxjs
```

## Quick start

See [`examples/nestjs-app`](./examples/nestjs-app) for a runnable demo.

## Documentation

Full docs site at [`docs/`](./docs/) — Markdoc + Next.js, authored
in Markdown. Run `pnpm dev` from `docs/` to preview locally:

```bash
cd docs
pnpm install
pnpm dev   # http://localhost:3000
```

Sections:
- **Get Started** — Introduction, Why, Installation, FAQ
- **Core Concepts** — Tenant Context, Builder, `$relatedTo`, Relationship Graph, Forward vs Reverse
- **Integration Guides** — NestJS, TypeORM, Postgres RLS, migration from `@casl/ability` and `@casl/prisma`
- **Advanced Concepts** — Custom resolvers, multi-hop design, audit logging, performance, testing, recipes
- **API Reference** — public-surface enumeration

## License

MIT
