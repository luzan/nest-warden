# Changelog

## [0.3.1-alpha] - 2026-05-12

### Fixed

- **Documentation — Gap 4 wording corrected.** The previous claim
  that `{ equals: value }` instead of `{ $eq: value }` "produces a
  rule that matches everything" was imprecise. CASL's parser
  silently reinterprets unknown operator keys as field names; the
  resulting forward-check (`ability.can(...)`) fails *closed*
  (never matches). The "matches everything" failure mode is real
  but specific to the reverse-lookup path through hand-rolled SQL
  adapters that drop unknown operators from the WHERE clause. The
  README, docs landing page, and `docs/get-started/why/` now
  describe both failure modes accurately. Surface raised during a
  conversation with the CASL author (@stalniy).

### Added

- **`examples/casl-conditions-demo`** — runnable 7-case repro
  demonstrating CASL's silent-fallback behaviour for unknown
  operator keys, the forward-check fails-closed vs reverse-lookup
  fails-open distinction, and a validation asymmetry between
  `@casl/prisma`'s `equals` (validates, throws) and `@casl/ability`
  Mongo's `$eq` (no `validate()`, silently returns false). Tested
  against `@casl/ability@6.8.1` + `@casl/prisma@1.4.1`.

## [0.3.0-alpha] - 2026-05-11

### Minor Changes

- a5367f7: # 0.2.0-alpha — roadmap reconciliation + payments example

  This release does not change the library's public API. It reconciles
  the public roadmap with the work that shipped in 0.1.0-alpha, captures
  the v1.0 blockers from the 2026-05 staff review as new roadmap themes,
  and fills out the example app's previously-empty `payments/` and
  `common/` directories with a working payments domain and shared
  cross-cutting utilities.

  ## Added
  - **Docs roadmap — Theme 8: library coupling + API freeze hardening.**
    Captures the v1.0 blockers identified in the 2026-05 staff review:
    CASL coupling invariant + version-range tightening, options-surface
    grouping into `builder`/`tenant`/`roles`/`graph` sub-objects,
    surfacing silent role-dropouts via an injectable Logger and an
    opt-in `silentRoleDropouts` flag, renaming `MultiTenantCaslError`
    to `NestWardenError` with a deprecated alias, and documenting the
    supported tenancy models explicitly.
  - **Docs roadmap — Theme 9: scope discipline for v1.0.** Marks
    `loadCustomRoles` and custom-role validation as candidates for
    experimental status; demotes `RlsTransactionInterceptor` from a
    core export to a docs recipe; deletes or documents the empty
    `test/integration/` and `test/e2e/` directories at the library root.
  - **Docs — supported tenancy models.** New "Supported tenancy models"
    section in `/docs/get-started/why/` makes the
    shared-database/shared-schema assumption explicit. Schema-per-tenant
    and database-per-tenant are not supported in v1.0 and not on the
    roadmap.
  - **Example — payments module.**
    `examples/nestjs-app/src/payments/payments.{module,service,controller}.ts`
    expose `GET /payments`, `GET /payments/:id`,
    `POST /payments/:id/capture`, and `POST /payments/:id/refund`.
    The service uses `accessibleBy()` for reverse lookups and falls
    back to an EXISTS query when in-memory `$relatedTo` matching can't
    traverse the agent-merchant join. Exercises a two-hop relationship
    path (`Payment → Merchant → Agent`) end-to-end.
  - **Example — common utilities.** `examples/nestjs-app/src/common/`
    ships a shared `PaginationQuery` DTO (`?limit` + `?offset` with
    defaults and clamps) used by both `/merchants` and `/payments`,
    plus an `@AnyOf(...handlers)` decorator that composes
    `@CheckPolicies` as disjunction.
  - **Example — payment-approver and cautious-refunder roles.** The
    registry gains `payments:read`, `payments:capture` (with
    `{ status: 'authorized' }`), and `payments:refund` permissions and
    a `payment-approver` system role; `permissions.ts` adds an inline
    `cautious-refunder` role demonstrating the negative-auth pattern
    on the refund-amount threshold.
  - **Example — 21 new E2E scenarios.** 16 payments tests covering
    cross-tenant isolation, two-hop graph scoping, conditional capture,
    negative-auth refund threshold, and forward-check / reverse-lookup
    parity. 5 common tests covering shared pagination invariants
    across both controllers. Test count: 31 → 52.

  ## Changed
  - **Docs roadmap — reconciled with shipped work.** "Where we are"
    bumped to 0.2.0-alpha (May 2026); Theme 1 (Roles on top of PBAC)
    reframed as "shipped in 0.1.0-alpha (Phases A–E)" with the
    remaining design questions queued for Phase F / v1.0; Theme 2
    (Deeper example coverage) bullets marked done where 0.1.0 +
    0.2.0 already covered them.
  - **Example — both services now `ORDER BY id` for paginated reads.**
    Seeding rows in a single INSERT statement gives every row the same
    `created_at` timestamp; ordering by it produced non-deterministic
    offsets. Documented inline.
  - **Library version bumped from `0.1.0` to `0.2.0-alpha`** to
    reflect that the API surface remains unstable and the version
    string is aligned with the alpha labeling used in the README, docs
    site, and CLAUDE.md.

  ## Not changed
  - **No library source modified.** Workstreams 1 and 2 touch
    documentation (`docs/`), the example app (`examples/nestjs-app/`),
    and changelog/version metadata only. The library's 100% test
    coverage is unchanged.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Theme 8A — CASL coupling invariant.** New exported function
  `assertCaslCouplingInvariant({can, cannot, build})` in
  `src/core/tenant-ability.builder.ts`. The `TenantAbilityBuilder`
  constructor calls it right after capturing the three base methods
  from `super()`, ensuring the wrap technique (which injects the
  tenant predicate into every emitted rule) can't silently no-op
  if a future `@casl/ability` release refactors `AbilityBuilder` to
  put `can` / `cannot` / `build` on the prototype instead of as
  instance properties. Throws a `NestWardenError` that names the
  missing method(s) and the compatible peer-dep range so consumers
  can diagnose at-a-glance.

- **`NestWardenError` — renamed base error class.** Replaces
  `MultiTenantCaslError` as the canonical base for every library
  error. All nine subclasses (`CrossTenantViolationError`,
  `MissingTenantContextError`, `UnsupportedOperatorError`,
  `RelationshipNotDefinedError`, `InvalidRelationshipPathError`,
  `RelationshipDepthExceededError`, `DuplicateRelationshipError`,
  `UnknownPermissionError`, `SystemRoleCollisionError`) now extend
  `NestWardenError`. Instances' `.name` property reads as
  `'NestWardenError'`. Tests at `test/core/errors-rename.test.ts`
  pin the rename contract end-to-end.

### Changed

- **Peer-dependency upper bound on `@casl/ability` made explicit.**
  Bumped from `"^6.7.0"` to `">=6.7.0 <7.0.0"`. The semantic range
  is the same — caret-prefixed `^6.x` already excludes 7.x — but the
  explicit form documents the v1.0 contract: nest-warden's tenant
  predicate injection is built against CASL 6.x's `AbilityBuilder`
  internals, and crossing the major boundary requires the coupling
  invariant (`assertCaslCouplingInvariant`) to be re-validated.

### Deprecated

- **`MultiTenantCaslError` is now a `@deprecated` alias for
  `NestWardenError`.** Exported as both a value (`export const
MultiTenantCaslError = NestWardenError`) and a type (`export type
MultiTenantCaslError = NestWardenError`) so every existing
  call-site — `catch (e instanceof MultiTenantCaslError)`, `class
MyError extends MultiTenantCaslError`, function signatures — keeps
  compiling and behaving identically. The alias is the **same
  constructor reference** (not a subclass), which is the only shape
  that lets `instanceof` work symmetrically against errors thrown
  with the new name. Slated for removal in v1.0; migrate by
  find-and-replacing the identifier across your codebase.

### Notes

- Internal symbol-keyed metadata constants (`MTC_OPTIONS` injection
  token, `:mtc_N` SQL parameter placeholders, `__mtCrossTenant`
  rule marker) keep their `mt`-prefixed runtime values. They're
  internal-only — consumers never see them — but changing the
  `__mtCrossTenant` marker would be a runtime-protocol break for
  any code that has been stamping it directly on rules. Defer
  the cleanup to a later cycle.

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
