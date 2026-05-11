# nest-warden

Tenant-aware authorization for NestJS + TypeORM, built on top of [`@casl/ability`](https://casl.js.org/).

> **Status: 0.2.0-alpha — under active development.** API surface is stabilizing; do not use in production yet.

## Why

`@casl/ability` is an excellent declarative authorization DSL, but it has four gaps for multi-tenant SaaS:

1. **No first-class tenant primitive.** Forgetting `tenantId` in a rule's conditions silently leaks data across tenants.
2. **No graph-relationship traversal.** Rules like *"Alice is an agent of Merchant M of Tenant X → Alice can approve M's payments"* can't be expressed without denormalization or pre-flight queries.
3. **No TypeORM adapter for reverse lookups.** CASL ships official adapters only for `@casl/mongoose` and `@casl/prisma`. The single SQL adapter is Prisma — TypeORM users get nothing. CASL also can't answer *"which Ys can Alice access?"* without loading them all and filtering — O(n) DB I/O.
4. **Underspecified conditional authorization.** Hand-rolled condition translators (a common pattern in CASL consumers) silently drop conditions when the translator is wrong — e.g., emitting `{ equals: value }` instead of MongoDB's `{ $eq: value }` produces a rule that matches everything, with no error at runtime.

`nest-warden` closes all four gaps as a thin layer above CASL.

## Headline features

- **Tenant safety by construction** — rules can't be built without a tenant predicate (or explicit `crossTenant` opt-out).
- **Relationship graph + `$relatedTo`** — register relationships once; rules express multi-hop access; the TypeORM adapter compiles paths to JOIN / EXISTS.
- **First-class `accessibleBy()` for TypeORM** — fills the gap CASL doesn't. Single SQL query for "all resources this subject can access," with tenant + graph applied automatically. Same shape as `@casl/prisma`'s `accessibleBy()`, adapted to TypeORM's QueryBuilder.
- **Conditional authorization, correctly wired** — uses CASL's own `mongoQueryMatcher`; unsupported operators throw at compile time, never silently filter wrong.
- **First-party NestJS integration** — module, guard, decorators, request-scoped tenant context, RLS hook.
- **Generic tenant ID** — `string | number`, defaults to `string` (UUID-friendly).
- **Isomorphic core** — same rules drive backend enforcement and frontend UI gating.

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
