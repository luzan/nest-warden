# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Renamed package from `multi-tenant-casl` to `nest-warden`** ahead of
  the first publish. All `from 'multi-tenant-casl/...'` imports become
  `from 'nest-warden/...'`. Symbol-keyed reflect-metadata constants
  rebrand from `multi-tenant-casl:*` to `nest-warden:*` (consumers of
  the public API don't see these). Repository home is
  https://github.com/luzan/nest-warden.

### Added

- **Phase 0** — Initial scaffold: pnpm + tsup ESM/CJS dual build, vitest,
  ESLint 9 flat config, Prettier, changesets, GitHub Actions CI/release.
- **Phase 1** — Core: `TenantContext`, `TenantAbilityBuilder` with auto
  tenant-predicate injection, `crossTenant` opt-out, `validateTenantRules`,
  error classes, `tenantConditionsMatcher`. Built on `@casl/ability` peer.
  100% test coverage.
- **Phase 2** — Relationship graph: `RelationshipGraph` (BFS path
  resolver, cycle safety, memoization, depth limit), `Relationship`
  definition, `foreignKey` / `joinTable` / `custom` resolver factories,
  `evaluateRelatedTo` for forward-direction `$relatedTo`,
  `createTenantConditionsMatcher` factory wrapping `mongoQueryMatcher`.
- **Phase 3** — TypeORM SQL compiler + `accessibleBy()` reverse-lookup
  API. Mirrors the shape of `@casl/prisma`'s `accessibleBy()` but
  generates TypeORM `QueryBuilder` fragments. Supports `$eq`, `$ne`,
  `$in`, `$nin`, `$lt`, `$lte`, `$gt`, `$gte`, `and`, `or`, `not`, plus
  `$relatedTo` with multi-hop traversal compiled into `EXISTS` subqueries.
- **Phase 4** — First-party NestJS adapter:
  `TenantContextService` (request-scoped), `TenantContextInterceptor`,
  `TenantAbilityFactory`, `TenantPoliciesGuard`, decorators (`@Public`,
  `@CheckPolicies`, `@AllowCrossTenant`, `@CurrentTenant`),
  `TenantAbilityModule.forRoot()`. Plus TypeORM lifecycle pieces:
  `@TenantColumn`, `TenantSubscriber`, `TenantAwareRepository`,
  `RlsTransactionInterceptor`.
- **Example app** — Runnable MVP at `examples/nestjs-app/` that
  exercises every headline capability against real Postgres with RLS
  enforced at the database layer. TDD-built: E2E tests written before
  application code.

### Fixed (during integration testing)

- **`buildRlsSet()` now uses `set_config(...)` instead of `SET LOCAL ... = $1`.**
  Postgres `SET` is a parser-level statement and rejects bound
  parameters in the value position; `set_config(name, value, is_local)`
  is the executor-level equivalent and accepts them. See `FINDINGS.md`
  in the example app for the full discovery story.

- **NestJS `@Inject(...)` is now explicit on every class-typed constructor
  parameter** in the library's NestJS classes. esbuild (used by `tsup`,
  `tsx`, and Vitest) does not implement TypeScript's
  `emitDecoratorMetadata` transform, so NestJS's auto-discovery via
  `Reflect.getMetadata('design:paramtypes', ...)` returns `undefined`
  for class types. Explicit `@Inject` is bundler-agnostic.

- **`TenantPoliciesGuard` now lazy-resolves the tenant context** when
  `TenantContextService` isn't yet populated. NestJS's request lifecycle
  runs guards BEFORE interceptors, so depending on
  `TenantContextInterceptor` to populate the context first is
  unworkable. The interceptor remains an optional explicit hook for
  middleware-style consumers.

- **`compileRelatedTo()` in the TypeORM compiler** was rewritten to
  emit correlated EXISTS subqueries with a WHERE-based correlation to
  the outer alias instead of a JOIN — JOINs against the outer alias
  generate `relation "<alias>" does not exist` errors at runtime.

- **`@CheckPolicies(...)` is now generic** on the ability type
  (`<TAbility extends AnyAbility>`), so `(ability: AppAbility) => boolean`
  handlers compose without manual casts.

### Notes

- Detailed engineering findings from building the example app are
  documented in `examples/nestjs-app/FINDINGS.md`. Read that before
  debugging similar symptoms.
