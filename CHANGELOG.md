# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No changes yet._

## [0.2.0-alpha] - 2026-05-11

### Added (0.2.0-alpha cycle)

- **Roadmap reconciliation.** `docs/pages/docs/roadmap/things-to-do.md`
  bumped to v0.2.0-alpha. "Where we are" now enumerates RFC 001 phases
  A–E as shipped in 0.1.0-alpha; Theme 1 (Roles on top of PBAC) is
  reframed from "future work" to "shipped, refining" with remaining
  design questions queued for Phase F / v1.0; Theme 2 (Deeper example
  coverage) bullets marked done where covered by existing E2E suites.

- **Roadmap Theme 8 — library coupling + API freeze hardening.**
  Captures the v1.0 blockers from the 2026-05 staff review: CASL
  internal-coupling invariant + version-range tightening, options
  surface grouping (`builder`/`tenant`/`roles`/`graph`), silent
  role-dropouts surfaced via injectable Logger + opt-in flag,
  `MultiTenantCaslError` rename to `NestWardenError` with deprecated
  alias, and explicit documentation of supported tenancy models.

- **Roadmap Theme 9 — scope discipline for v1.0.** Marks
  `loadCustomRoles` and custom-role validation as candidates for
  experimental status pending production soak; demotes
  `RlsTransactionInterceptor` from a core export to a docs recipe;
  notes the empty `test/integration/` and `test/e2e/` directories at
  the library root for cleanup.

- **Docs — supported tenancy models.** New "Supported tenancy models"
  section in `/docs/get-started/why/` makes the
  shared-database/shared-schema assumption explicit; schema-per-tenant
  and database-per-tenant are not supported in v1.0.

- **Example — payments module.** `examples/nestjs-app/src/payments/`
  ships `PaymentsModule`, `PaymentsService`, and `PaymentsController`
  with `GET /payments`, `GET /payments/:id`, `POST /payments/:id/capture`,
  and `POST /payments/:id/refund` endpoints. Exercises the two-hop
  `Payment → Merchant → Agent` relationship path end-to-end against
  real Postgres.

- **Example — common utilities.** `examples/nestjs-app/src/common/`
  exposes a shared `resolvePagination` helper (used by both
  `/merchants` and `/payments`) and an `@AnyOf(...handlers)`
  decorator that composes `@CheckPolicies` as disjunction.

- **Example — payment permissions and roles.** Permission registry
  adds `payments:read`, `payments:capture` (with
  `conditions: { status: 'authorized' }`), and `payments:refund`,
  plus a `payment-approver` system role. `permissions.ts` adds an
  inline `cautious-refunder` role demonstrating
  `cannot('refund', 'Payment', { amountCents: { $gt: 10000 } })`.

- **Example — 21 new E2E scenarios.** 16 payments tests covering
  cross-tenant isolation, two-hop graph scoping, conditional state
  transitions, negative-auth refund threshold, and forward-check /
  reverse-lookup parity; 5 common tests covering shared pagination
  invariants. Test count: 31 → 52.

### Changed (0.2.0-alpha cycle)

- **Library version bumped from `0.1.0` to `0.2.0-alpha`** to align
  the package metadata with the alpha labeling used in the README,
  docs site, and CLAUDE.md.

- **Example services — `ORDER BY id` for paginated reads.** Seeding
  rows in a single INSERT statement assigns identical `created_at`
  timestamps to every row; the previous `ORDER BY created_at`
  produced non-deterministic pagination. Documented inline.

### Added

- **RFC 001 Phase A — typed permission/role registry primitives.**
  `definePermissions<TAction, TSubject>` and `defineRoles<TPermission>`
  return their input map unchanged at runtime; the value is in the
  typing — `const`-modifier preserves literal-typed keys so consumers
  derive `Permission = keyof typeof permissions` for autocomplete +
  compile-time checks. Plus `validatePermissionReferences` and
  `assertNoSystemRoleCollision` runtime validators, and the
  `UnknownPermissionError` / `SystemRoleCollisionError` error classes.

- **RFC 001 Phase B — `TenantAbilityBuilder.applyRoles(roleNames)`.**
  Expands named roles into rules using the registries from Phase A.
  System-role lookups silently drop unknown names (forward compat
  for live-session JWTs); permission-reference validation throws
  `UnknownPermissionError` on misconfiguration. Every emitted rule
  carries a `reason` field with `{ role, permission }` JSON for
  future audit-log attribution (Theme 5). `TenantAbilityModule.forRoot`
  gains `permissions` and `systemRoles` fields that thread through
  the factory to the per-request builder.

- **RFC 001 Phase C — `loadCustomRoles` for tenant-managed roles.**
  Module options gain an optional async `loadCustomRoles(tenantId,
  ctx)` callback; the factory invokes it once per request, validates
  each returned role (collision with system roles → drop + warn;
  unknown permission reference → drop + warn), and threads the
  surviving custom roles into the per-request builder. `applyRoles`
  resolves names against system roles first, then custom roles by
  name. New `TenantAbilityModule.forRootAsync` mirrors NestJS's
  conventional `useFactory + inject + imports` shape so the loader
  can DI a repository (or any other data source).

- **RFC 001 Phase D — example fully migrated to the registry
  pattern.** `platform-admin`, `iso-admin`, `merchant-approver`, and
  `merchant-viewer-public` roles now flow through the registry +
  `applyRoles`; `agent` (uses `$relatedTo` referencing
  `ctx.subjectId`) and `cautious-approver` (uses `cannot`) remain
  inline because their rule shapes don't fit `PermissionDef`
  cleanly. The hybrid pattern in
  `examples/nestjs-app/src/auth/permissions.ts` is the reference
  for consumers in similar shape. Existing 31 E2E tests continue
  to pass — the registry emits behaviorally identical rules.

- **RFC 001 Phase E — tutorial-style documentation.** New page at
  `/docs/integration/roles-and-permissions/` covers the full
  lifecycle: defining permissions, declaring system roles,
  expanding via `applyRoles`, loading tenant-managed custom roles
  from a database, sample data model, migration guide from raw
  `if/include` rules, and an API reference section. Includes a
  Mermaid diagram of the registry → roles → applyRoles → ability
  pipeline. Sidebar entry added under Integration Guides.

- **Documentation site** — Markdoc-powered docs at `docs/`. New
  pages: "When (not) to use" (Get Started), "Security Best
  Practices" (Advanced Concepts), "Roadmap" section with RFC 001 and
  "Things to do." Mermaid support — fenced ` ```mermaid ` blocks
  route to a client-only React component via `next/dynamic` so
  static export keeps working. JWT trust-boundary diagram and the
  custom-roles load-validate-apply pipeline rendered inline.

- **Example app — registry pattern, custom roles, soft delete,
  field projection, mutations, conditional & negative authz,
  multi-role merge.** Theme 2 slices added to
  `examples/nestjs-app/`: 14 → 31 E2E tests covering deeper
  scenarios. New `custom_roles` table + `CustomRole` entity wire
  the Phase C `loadCustomRoles` end-to-end.

- **CI** — separate workflow for docs deployment to GitHub Pages
  (`actions/deploy-pages@v4`), `example-e2e` job runs the example
  E2E against testcontainers Postgres, GitHub issue templates
  (`bug_report.yml`, `feature_request.yml`, `config.yml`).

### Changed

- **Renamed package from `multi-tenant-casl` to `nest-warden`** ahead of
  the first publish. All `from 'multi-tenant-casl/...'` imports become
  `from 'nest-warden/...'`. Symbol-keyed reflect-metadata constants
  rebrand from `multi-tenant-casl:*` to `nest-warden:*` (consumers of
  the public API don't see these). Repository home is
  https://github.com/luzan/nest-warden.

- **CI now enforces 100% coverage.** The 100% line / branch / function
  / statement thresholds in `vitest.config.ts` had been silently
  unenforced because the workflow ran `pnpm test`. Switched to
  `pnpm test:coverage` so future PRs that drift below 100% fail
  the build.

- **Bundle size budget measured on the packed tarball, not the dist
  directory.** The earlier check ran `du -sk dist` which counted
  ESM + CJS + `.d.ts` + source maps for three subpath exports
  uncompressed (~5x the published tarball). The CI step now invokes
  `pnpm pack` and asserts the resulting `.tgz` is under 200 KB —
  i.e., what `npm install nest-warden` actually downloads.

- **Source maps no longer ship in the published tarball** (saved
  ~120 KB; tarball went from 212 KB to 88 KB). Source maps are
  still generated under `dist/*.map` for local development — the
  example app consumes the library via `file:../..` and benefits
  when stepping through code — but excluded from the npm package
  via a negation in `package.json` `files`. Stack traces from
  bundled code are informative enough for production bug reports.

### Fixed

- **Cross-request registry mutation in `applyRoles`** — caught
  during Phase C example-app integration. The per-rule conditions
  object passed to CASL's `can()` was mutated in place by the
  tenant-predicate injection wrapper. Because the registry's
  `permission.conditions` was the same shared object across
  requests, the previous request's `tenantId` leaked into the
  next request's rule. Fixed by cloning conditions and fields at
  the call site; regression test
  (`does NOT mutate the registry across builder invocations`)
  pins the behavior.

- **Coverage gaps in `tenant-policies.guard.ts:87-90` and
  `related-to.ts:157-163, 228-229`** — pre-existing uncovered ranges
  that were slipping past CI because the unit-tests job didn't enforce
  the 100% threshold. Backfilled with tests covering the guard's
  lazy-resolve branch and the foreignKey-as-subsequent-hop / custom-
  resolver-as-subsequent-hop / empty-where-clause branches in the
  `$relatedTo` SQL emitter.

- **`pnpm-workspace.yaml` files at root, `examples/nestjs-app/`,
  and `docs/`** — added `packages: ['.']` to each. The previous files
  carried only an `allowBuilds:` map and crashed `actions/setup-node@v4`'s
  pnpm cache step (`pnpm store path` requires the field).

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
