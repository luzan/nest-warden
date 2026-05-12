---
title: Things to do
---

Where nest-warden is headed after v0.1.0-alpha. This page is the
public roadmap — items here are deliberately scoped, not promised
on a date. Concrete design decisions show up as RFC issues on the
GitHub repo before any of these ship.

## Where we are

**v0.2.0-alpha** — released May 2026.

Shipped in 0.1.0-alpha:

- Tenant-aware ability builder with cross-tenant safety enforced
  at `.build()` time
- Conditional authorization wired through `@ucast/mongo2js` (no
  silent-drop bugs)
- Relationship graph + `$relatedTo` operator (foreignKey, joinTable,
  custom resolvers)
- TypeORM `accessibleBy()` reverse-lookup adapter — single-query
  resolution, parameterized SQL, EXISTS subqueries for graph hops
- NestJS module, guards, decorators, request-scoped context
- Postgres RLS interceptor (defense-in-depth)
- Documentation site (this site)

Shipped in 0.1.0-alpha as RFC 001 (Phases A–E):

- Typed permission registry — `definePermissions`,
  `validatePermissionReferences`, `UnknownPermissionError`
- System role registry — `defineRoles`,
  `assertNoSystemRoleCollision`, `SystemRoleCollisionError`
- `TenantAbilityBuilder.applyRoles(roleNames)` — expands role names
  into rules using the registries, with `reason: { role, permission }`
  attribution metadata on each emitted rule
- Tenant-managed custom roles loaded per request via
  `loadCustomRoles(tenantId, ctx)` on `TenantAbilityModule.forRootAsync`
- Example app fully migrated to the registry pattern; hybrid pattern
  documented in
  [`examples/nestjs-app/src/auth/permissions.ts`](https://github.com/luzan/nest-warden/blob/main/examples/nestjs-app/src/auth/permissions.ts)
- Tutorial documentation at
  [Roles and Permissions](/docs/integration/roles-and-permissions/)

What changed in 0.2.0-alpha:

- Public roadmap (this page) reconciled with shipped work — completed
  items in Themes 1 and 2 marked done.
- New Theme 8 — library coupling and API-freeze hardening —
  captures the v1.0 blockers from the 2026-05 staff review (CASL
  internal-coupling invariant, options-surface restructuring,
  silent role-dropout surfacing, public error-class rename,
  supported tenancy models documented).
- New Theme 9 — scope discipline for v1.0 — captures the
  experimental-status decision for custom roles and the demotion
  of the RLS interceptor from a core export to a docs recipe.
- Example app expansion — `examples/nestjs-app/src/payments/` and
  `src/common/` filled with a payments module, shared pagination
  DTO and decorator, and new E2E scenarios covering tenant isolation
  on the graph (`$relatedTo` via `merchant_of_payment →
  agents_of_merchant`), conditional updates, negative authorization
  on a refund threshold, and forward-check / reverse-lookup parity.
  E2E count: 31 → ~40.

The library remains 100% test-covered. **API still unstable** —
names, signatures, and module boundaries may change before v1.0.0.
See Theme 4 (API stability commitment) and Theme 8 for the freeze
plan.

## Roadmap themes

The work below is grouped by theme, in rough priority order. Within
each theme, items are concrete enough to land in a milestone but
loose enough that the API design is still open for input.

### 1. Roles on top of PBAC

**Status: shipped in 0.1.0-alpha (RFC 001, Phases A–E).** This theme
now tracks the remaining open design questions and any Phase F+ work.

The primitives the theme called for —
`definePermissions`, `defineRoles`, `TenantAbilityBuilder.applyRoles`,
and `loadCustomRoles` for tenant-managed custom roles — are all in
the public API. See the
[Roles and Permissions](/docs/integration/roles-and-permissions/)
tutorial and the example at
[`examples/nestjs-app/src/auth/permissions.ts`](https://github.com/luzan/nest-warden/blob/main/examples/nestjs-app/src/auth/permissions.ts)
for the working pattern, including the documented hybrid where
roles that depend on per-request context (e.g., `agent` closing over
`ctx.subjectId`) remain inline and roles that compose `can` + `cannot`
(e.g., `cautious-approver`) also remain inline.

**Still open (for Phase F / v1.0):**

- **Inheritance model.** Today, multiple role names compose by union —
  rules from each role are concatenated and CASL's normal precedence
  applies. A formal "RoleA extends RoleB" relation may help large
  permission sets, but it adds resolution complexity (cycles,
  ordering) and the union model has been sufficient in production
  patterns we've seen.
- **Permission naming convention.** Names (`merchants:read`) are the
  primary identifier in the registry. The underlying
  `(action, subject)` pair is the CASL-native form. The two compose,
  but the canonical convention for permission strings (colon-
  separated? dot-separated? include the verb tense?) is not pinned
  by the library and should be.
- **Storage.** The library stays storage-agnostic — `loadCustomRoles`
  is the consumer's repository hook. We could ship an optional sample
  TypeORM entity for custom roles (`@Entity CustomRole` with a
  `permissions` jsonb column) as a docs recipe. The example app's
  `custom_roles` table is the de facto reference.
- **Role assignment audit.** When and where role assignments change
  is the consumer's domain, but a thin hook
  (`onRoleResolution(ctx, resolved)`) on the factory would let
  consumers log "which roles were active for this request" without
  re-implementing the lookup.

These will be tracked as separate RFCs or follow-on PRs against the
existing registry primitives — not a rewrite.

### 2. Deeper example coverage

**Status: mostly shipped in 0.1.0-alpha (E2E count 14 → 31) and
0.2.0-alpha (31 → ~40 with payments).** Remaining items are
called out below. TDD-first remains the convention — E2E test
lands in the same change as the code or fixture it covers.

**Done:**

- ✅ **Conditional rules in flight** — rules with `{ status: 'pending' }`
  filter at the SQL layer; see `conditional-authz` cases in
  `examples/nestjs-app/test/e2e/merchants-controller.e2e.test.ts`.
- ✅ **Field-level restrictions** —
  `GET /merchants/:id/projected` exercises `permittedFieldsOf`
  end-to-end. A user with `can('read', 'Merchant', ['id', 'name',
  'status'])` sees only those fields.
- ✅ **Multi-role merge** — `[agent, merchant-approver]` is covered;
  rules from both roles union and respect tenant scope.
- ✅ **Negative authorization** — `cautious-approver` mixes `can` +
  `cannot`; the `cannot` rule subtracts a specific merchant by name
  even though the role's positive grants would otherwise permit it.
  A second `cautious-refunder` role added in 0.2.0-alpha exercises
  the same pattern for refund amounts above a threshold.
- ✅ **Soft-deleted rows** — `@DeleteDateColumn` on `Merchant` is
  covered; `with_deleted=true` surfaces soft-deleted rows under
  the same tenant scope.
- ✅ **Custom roles loaded at request time (Phase C)** —
  `loadCustomRoles` is wired to a real `custom_roles` table; tests
  prove tenant-scoped registration (a role registered for ACME does
  nothing for BETA users).
- ✅ **Payments module with end-to-end scenarios** (0.2.0-alpha) —
  the `payments/` and `common/` modules in `examples/nestjs-app/`
  exercise `accessibleBy()` against the `merchant_of_payment →
  agents_of_merchant` graph hop, conditional updates
  (`authorized → captured` status transitions), and negative auth
  on a refund-amount threshold.

**Still pending:**

- ⬜ **Update/Delete paths against `TenantSubscriber.beforeUpdate`** —
  the subscriber should reject rows whose persisted `tenantId`
  doesn't match the request context. Today this is unit-tested but
  not E2E-tested against a real Postgres + RLS path. Add a dedicated
  E2E that mutates a row whose persisted `tenantId` differs from
  the active context and assert the subscriber rejects.
- ⬜ **Adversarial scenarios paired with the JWT-auth example
  (Theme 7 PR A)** — once `FakeAuthGuard` is replaced with a real
  JWT path, E2E coverage for tampered claims, expired tokens, and
  missing-membership cases lands alongside.

### 3. Tenant-aware webhook security

**Problem.** Inbound webhooks (Stripe, Twilio, GitHub, etc.)
arrive without a JWT. They carry an HMAC signature, and the
correct tenant must be identified before any business logic
runs. nest-warden's current `TenantContextInterceptor` assumes
a JWT-bearing request.

**Sketch.**

```ts
@Controller('webhooks')
export class StripeWebhookController {
  @Post(':tenantId/stripe')
  @UseGuards(WebhookGuard)
  @WebhookProvider('stripe')          // names which secret to use
  async handle(
    @CurrentTenant() ctx: TenantContext,
    @Body() payload: StripeEvent,
  ) {
    // ctx is verified-via-HMAC at this point; payload is the
    // verified payload. Repos called from here are tenant-scoped
    // exactly like a JWT-authenticated request.
  }
}
```

**Open design questions:**

- **Tenant identification.** From URL path (`/webhooks/:tenantId/...`),
  HTTP header, or payload inspection? Each has tradeoffs — URL is
  simplest but exposes tenant IDs; header requires provider support;
  payload requires parse-before-verify which is a footgun.
- **Per-tenant secrets.** Where does the webhook secret live?
  Ship a sample table, or require a callback
  `resolveWebhookSecret(tenantId, provider)`?
- **Provider scope.** First class for "generic HMAC" only, or
  ship Stripe/Twilio/GitHub adapters? Generic is more useful
  long-term; provider-specific is more useful short-term for
  consumers who don't want to read 5 different signature schemes.
- **Outbound webhooks.** Out of scope for v0.x or in scope?
  Outbound is more about secret rotation and per-tenant URL
  storage than authorization, so it may not belong here at all.

### 4. API stability commitment

**Problem.** v0.1 is alpha and the API will change. Without an
explicit "API freeze" gate, every rename is a downstream
breaking change with no warning.

**Plan.**

- Tag v0.x releases with explicit `BREAKING CHANGE` entries in
  the CHANGELOG when the public surface shifts.
- Before v1.0.0, publish an **API freeze RFC** — a single doc
  enumerating every exported symbol with a "stable / experimental
  / deprecated" tag. Anything still experimental at freeze gets
  hidden from `index.ts` until it's ready.
- Adopt `@deprecated` JSDoc tags + an ESLint rule
  (`@typescript-eslint/no-deprecated`) so consumers see warnings
  before removal.
- The freeze gate is one of two v1.0.0 prerequisites. The other
  is theme 6 (production soak).

### 4a. Library coupling + API freeze hardening (Theme 8)

**Source.** 2026-05 staff review of the v0.1.0-alpha codebase. The
items here are the v1.0 blockers identified during that review —
all five must land before the API freeze in Theme 4.

**A. CASL coupling invariant.** ✅ **Shipped in 0.3.0-alpha.**
`TenantAbilityBuilder` captures `this.can` / `this.cannot` /
`this.build` after `super()` and wraps them so every rule gets a
tenant predicate injected. This relies on CASL's `AbilityBuilder`
assigning those names as **instance properties** — if a future CASL
release moves them to the prototype, the wraps would silently no-op
and rules would ship without a tenant predicate. That is a silent
data-leak class.

Landed:

- `assertCaslCouplingInvariant({can, cannot, build})` is exported
  from `src/core/tenant-ability.builder.ts` and called inside the
  `TenantAbilityBuilder` constructor right after the three base
  methods are captured. Throws `NestWardenError` naming the missing
  method(s) plus the compatible peer-dependency range.
- Peer dep tightened from `"@casl/ability": "^6.7.0"` to
  `">=6.7.0 <7.0.0"` to document the upper bound explicitly.
- Tests at `test/core/casl-coupling-invariant.test.ts` exercise the
  positive path (real CASL + real `TenantAbilityBuilder` doesn't
  throw) and the negative path (each missing method triggers the
  throw with a diagnostic message naming the method and the version
  range).

**B. Options ergonomics.** `TenantAbilityModule.forRoot` and
`forRootAsync` currently carry 9+ optional fields at the top level
(`defineAbilities`, `resolveTenantContext`, `permissions`,
`systemRoles`, `loadCustomRoles`, `relationships`, `tenantField`,
`validateRules`, `registerAsGlobal`). Each is individually
defensible; the aggregate is a god interface.

Concrete action: group semantically into sub-objects —
`{ builder: { defineAbilities, validateRules, tenantField },
   tenant: { resolveTenantContext, registerAsGlobal },
   roles: { permissions, systemRoles, loadCustomRoles },
   graph: { relationships } }`.
Breaking change, but appropriate while we're still pre-1.0.
Publish a migration table in the CHANGELOG.

**E. Surface silent role-dropouts.** `TenantAbilityFactory` drops
invalid custom roles (collision with system role names, unknown
permission references) via `console.warn`. On a busy SaaS request
path that's at best noisy and at worst silently broken.

Concrete actions:

- Replace `console.warn` with an injectable
  `Logger` (NestJS `LoggerService`) instance, defaulting to the
  NestJS root logger so structured logs route through whatever
  pino / winston pipeline the consumer already runs.
- Add a `silentRoleDropouts: false` option (default `false`)
  that escalates dropouts from "log + drop" to "throw a structured
  `CustomRoleValidationError`." Production deployments where a
  missing role would silently degrade access can opt into hard
  failure.

**F. Public error-class name.** ✅ **Shipped in 0.3.0-alpha.**
`MultiTenantCaslError` was the base error class consumers caught
on. The name carried the old project name — "multi-tenant-casl" —
into every downstream try/catch. Renaming post-1.0 would have been
a breaking change for every consumer.

Landed:

- Class renamed to `NestWardenError`. All nine subclasses
  (`CrossTenantViolationError`, `MissingTenantContextError`,
  `UnsupportedOperatorError`, `RelationshipNotDefinedError`,
  `InvalidRelationshipPathError`, `RelationshipDepthExceededError`,
  `DuplicateRelationshipError`, `UnknownPermissionError`,
  `SystemRoleCollisionError`) extend the new base.
- `MultiTenantCaslError` retained as a `@deprecated` alias —
  exported as both a value (`export const MultiTenantCaslError =
  NestWardenError`) and a type (`export type MultiTenantCaslError =
  NestWardenError`). The alias is the **same constructor reference**,
  not a subclass, so `instanceof` checks work symmetrically and
  existing catch-sites match library-thrown errors transparently.
- Scheduled for removal in v1.0. Tests at
  `test/core/errors-rename.test.ts` pin the alias contract from
  outside.

**Not yet:** the internal symbol-keyed metadata constants
(`MTC_OPTIONS` token, `:mtc_N` parameter placeholders, the
`__mtCrossTenant` rule marker) still use the old prefix. They're
internal, consumers don't see them, and changing the rule marker
in particular would be a runtime-protocol break. Defer to a later
cycle if the cleanup is worth the risk.

**G. Document supported multi-tenancy models.** The library assumes
a shared-database, shared-schema tenancy model — `tenantId`-column
scoping plus optional RLS. Schema-per-tenant (different
`search_path` per request) and database-per-tenant (different
`DataSource` per request) are **not** supported in v1.0. Today this
constraint is implicit.

Concrete actions:

- Add a "Supported tenancy models" subsection at the bottom of
  [Why nest-warden?](/docs/get-started/why/) with an explicit
  table: shared-DB/shared-schema ✅, schema-per-tenant ❌,
  DB-per-tenant ❌.
- Add a one-page reference at `/docs/core-concepts/tenancy-models/`
  explaining what each model is, where the library would have to
  change to support the others (DI scoping of `DataSource`,
  `search_path` injection), and that future support is **not** on
  the roadmap unless concrete demand surfaces post-v1.0.

### 4b. Scope discipline for v1.0 (Theme 9)

**Source.** Same staff review. These items are about *removing*
or *demoting* surface, not adding. v1.0 ships a smaller, more
defensible API by deferring two pieces that are weakly differentiated
from what a consumer can write in 30 lines.

**C. Custom-roles is experimental in v1.0.** `loadCustomRoles` and
the custom-role validation/collision logic landed in 0.1.0-alpha as
RFC 001 Phase C. It works, the example uses it, and the tutorial
documents it. But "tenant-managed custom roles" is an RBAC subsystem
that will accumulate ongoing feature requests (inheritance,
versioning, assignment audit) — the kind of surface that locks the
library into a maintenance trajectory.

Concrete actions:

- Mark `loadCustomRoles`, `CustomRoleEntry`, and the validation
  helpers as `@experimental` in JSDoc with a one-line note linking
  to this theme.
- Keep the API as-is for v1.0. Re-evaluate after the production
  soak (Theme 6). If churn exceeds two breaking changes per
  cycle, extract to a `nest-warden-roles` companion package post-
  v1.0 so the core library's API surface doesn't churn with it.

**D. RLS interceptor demotion.** `RlsTransactionInterceptor` wraps
every request (including reads) in a Postgres transaction and runs
`SELECT set_config('app.current_tenant_id', $1, true)`. Useful, but
~30 lines of meaningful logic. Most of the value is in the
*explanation* (why `set_config` instead of `SET LOCAL`, RLS as
defense-in-depth) — not the importable class.

The current default is also a footgun for high-RPS workloads
because every request holds a pool connection for its lifetime.

Concrete actions:

- Move the canonical example to a docs recipe at
  `/docs/advanced/recipes/` titled "RLS as defense-in-depth."
  Include the full `set_config` rationale and the trade-off
  discussion.
- Keep `RlsTransactionInterceptor` as an export but default it to
  **off** in module options (`rls: { enabled: false }`), with the
  JSDoc emphasizing that consumers should think about connection-
  pool pressure before enabling.
- Add a section to the recipe on alternative strategies: scoped
  transactions inside services, request-time
  `SET app.current_tenant_id` via a TypeORM subscriber, or
  Postgres's `app.current_tenant_id` via session pooling
  (PgBouncer caveat).

**H. Empty `test/integration/` and `test/e2e/` directories.** At
the library root, both directories exist but are empty — the real
E2E suite lives in `examples/nestjs-app/test/e2e/`. New
maintainers reading the layout will assume these are unfilled
TODOs.

Concrete action: delete the empty directories, or replace each
with a `README.md` that points to the example app's E2E suite.

### 5. Authorization decision logging

**Problem.** CASL has no hook for "rule X allowed/denied this
request for tenant Y." For PCI-scoped systems, audit trails of
authorization decisions are a compliance ask. Today, consumers
who want this either monkey-patch CASL or wrap every check site.

**Sketch.**

```ts
TenantAbilityModule.forRoot({
  decisionLogger: (decision) => {
    // decision: { allowed, action, subject, tenantId, subjectId,
    //   matchedRule, conditions, timestamp }
    auditLog.write(decision);
  },
});
```

The library would call the logger from `TenantPoliciesGuard`
after each check (and from `accessibleBy()` for reverse lookups,
where the "decision" is the SQL emitted). Logger is sync to keep
the surface simple; consumers can buffer/batch async on their
side.

**Open questions:**

- Log every decision (high volume, full trail) or only denials
  (low volume, partial trail)?
- Include the loaded entity in `read`/`update` decisions? PII
  concern — the entity may contain CHD or PII that doesn't belong
  in the audit log.
- Coverage: does the `accessibleBy()` reverse lookup get logged
  per-row or per-query? Per-query is the only sane choice for
  performance, but it changes the audit grain.

### 6. Production soak — the v1.0 gate

**Problem.** Library code can be 100%-covered and still wrong in
ways only production traffic surfaces — race conditions on the
RLS session variable across pooled connections, transaction
boundaries that don't compose with consumer middleware, edge
cases in `$relatedTo` paths that the example schema doesn't
hit.

The v1.0 milestone is "exercised in a real production NestJS +
TypeORM app for at least one quarter." That's not a feature; it's
a soak period. It exists on the roadmap so the v1.0 cut isn't
arbitrary.

Concrete asks of the soak phase:

- Capture every issue surfaced under real load in the
  `examples/nestjs-app/FINDINGS.md` format (symptom, root cause,
  fix, regression test) — these are the highest-value
  documentation artifacts the project produces.
- Benchmark `accessibleBy()` against
  `loadAll().filter(can(...))` on a realistic dataset (10k+
  resources). Publish the numbers.
- Stress-test RLS under connection pooling — a leaked session
  variable across requests is the failure mode that's hardest
  to detect and worst to ship.

### 7. Security hardening test plan

**Problem.** The library enforces tenant safety at `.build()`,
auto-injects predicates, parameterizes SQL, and pairs with RLS.
What it cannot do is enforce the *contract* between consumer
code and the trust boundary — JWT verification, server-side
membership lookups, and the absence of cross-request state
leakage in the registry. We caught one cross-request leak
during Phase B integration testing (the registry's `conditions`
object was being mutated in place); we want a systematic story
that catches the next one before it reaches consumers.

**Plan — six PRs of testing infrastructure.** Most are small
(< 200 LOC); together they raise the floor of what a consumer
gets out of the box.

**A — Production-style JWT auth flow in the example.** Replace
`FakeAuthGuard` with a real JWT verification path plus
server-side membership lookup. Demonstrates the trust boundary
end-to-end. The hardest thing for consumers to get right —
doing it once, well, in the example saves dozens of consumers
from the same mistake.

**B — Multi-request invariant tests.** A test helper that
snapshots the in-process registry / module state before a
sequence of E2E requests and asserts byte-equality afterwards.
Would have caught the cross-tenant leak fixed during Phase B.
~50 LOC test helper.

**C — Concurrent multi-tenant stress E2E.** Fire `N` parallel
requests across `M` tenants with different roles. Assert each
response only contains its own tenant's data. Catches
state-sharing bugs that strictly-sequential tests miss. Adds
runtime to CI but the value is high.

**D — Property test pairing forward checks with reverse
lookups.** For randomly generated rule shapes, assert
`ability.can(action, instance)` and
`accessibleBy(...).getMany()` agree on every entity in a fixture.
Catches matcher / SQL-compiler divergence — the class of bug
that's nearly impossible to find by hand because both halves
look "obviously correct" in isolation.

**E — Adversarial JWT scenarios in the example.** Once A lands:
tampered claim → 403; expired token → 401; user with no
membership in claimed tenant → 403. Tests in the example
demonstrate the expected failure modes so consumers can copy
them.

**F — Lint rule for direct repository access.** ESLint rule
that flags `dataSource.getRepository(...)` outside whitelisted
files (admin / migration code paths). Forces consumers through
`TenantAwareRepository` or `accessibleBy`. Defense against
"accidentally bypass the auto-injected tenant predicate."

**Priority order if we do these one at a time:** A → B → D →
E → C → F. A is highest leverage (production-realistic example);
B is cheapest insurance against the bug class we just hit; D
catches a different class; E completes A; C is more expensive
but valuable for teams running at scale; F is nice to have.

## Not on this roadmap

Items that have been considered and deliberately deferred:

- **Mongoose / Sequelize / Drizzle adapters.** TypeORM-only for
  v0.x. If demand surfaces post-v1.0, an adapter can mirror the
  shape of the TypeORM compiler.
- **Distributed relationship store / Zanzibar tuples.**
  Relationships live in the application's own tables, by design.
  If a consumer needs sub-second propagation across services, they
  can pair nest-warden with OpenFGA or SpiceDB directly — those
  are decision engines and we're not.
- **A built-in role management UI.** Storage-agnostic. UI is
  always the consumer's problem.
- **Policy persistence.** Where rules come from
  (database, JWT, hardcoded registry) is the consumer's concern.

## How to influence this roadmap

- Open a GitHub Discussion for design questions (no commitment,
  early input).
- Open a GitHub Issue with the `rfc:` prefix for a concrete
  proposal you'd like reviewed.
- Pull requests welcome — the open design questions in each
  theme are the natural starting points.

## See also

- [CHANGELOG](https://github.com/luzan/nest-warden/blob/main/CHANGELOG.md) — what shipped, what's pending
- [Why nest-warden?](/docs/get-started/why/) — what the library is, what it adds, what it isn't
