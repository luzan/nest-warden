# Findings — Things We Learned Building This Example

This document captures non-obvious gotchas discovered while building the
example from scratch using TDD. Future contributors (and AI agents
resuming work) should consult this list **before** debugging similar
symptoms — saves a full discovery loop.

Each finding documents: the **symptom** as it first appeared, the
**root cause**, the **fix**, and where the fix lives now (so the issue
should not recur).

---

## 1. Postgres `SET LOCAL` does not accept bound parameters in the value position

**Symptom.** `SET LOCAL app.current_tenant_id = $1` with a parameter
binding throws `syntax error at or near "$1"`.

**Root cause.** `SET` is a parser-level statement in Postgres (executed
during query parsing, not the executor). Parameter binding happens
during execution, so `$1` in the value position is unrecognized.

**Fix.** Use the `set_config(name, value, is_local)` function instead:

```sql
SELECT set_config($1, $2, true)
-- $1 = 'app.current_tenant_id', $2 = tenant ID, true = transaction-local
```

`set_config()` is a regular function call and accepts parameters
normally. Semantically identical to `SET LOCAL` when `is_local = true`.

**Where this lives.** `src/typeorm/rls-session.ts` in the parent library
ships `buildRlsSet()` that emits the correct shape; the example's
`test/e2e/rls-isolation.e2e.test.ts` uses the same pattern in its
fixture helper.

---

## 2. PERMISSIVE vs RESTRICTIVE RLS policies — RESTRICTIVE alone denies all rows

**Symptom.** Queries return zero rows even when the session variable
`app.current_tenant_id` is correctly set to a value matching existing
data. The policy looked right; nothing matched.

**Root cause.** Postgres RLS combines policies as
`PERMISSIVE_or_PERMISSIVE_or_… AND RESTRICTIVE_and_RESTRICTIVE_and_…`.
A table with **only** RESTRICTIVE policies is effectively "deny all" —
because no PERMISSIVE policy ever grants access, so the RESTRICTIVE
constraint has nothing to subtract from.

Some production multi-tenant patterns use `RESTRICTIVE` deliberately,
but they always pair it with a base PERMISSIVE policy (e.g., a
`USING (true)` or a role-based grant). Our example originally had only
`RESTRICTIVE` policies and silently denied everything — a mistake worth
flagging because the policy syntax compiles fine, the table has RLS
enabled, and yet every query returns zero rows.

**Fix.** Use plain (PERMISSIVE-by-default) policies for the example:

```sql
CREATE POLICY tenant_isolation ON merchants
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));
```

For production, the recommended pattern is:
- One PERMISSIVE policy per role granting access to its scope.
- One RESTRICTIVE policy enforcing tenant isolation across all roles.

**Where this lives.** `sql/init.sql` documents the choice in a comment
above the policies.

---

## 3. tsup / esbuild strip TypeScript decorator metadata — NestJS DI breaks

**Symptom.** `Cannot read properties of undefined (reading 'getAllAndOverride')`
or `Cannot read properties of undefined (reading 'build')` at the first
guard / interceptor / service that has class-typed constructor
parameters.

**Root cause.** NestJS's DI relies on `Reflect.getMetadata('design:paramtypes', ...)`
to discover constructor parameter types at runtime. TypeScript emits
this metadata **only** when `emitDecoratorMetadata: true` AND the
compiler is `tsc` (or `swc`/`babel-plugin-transform-typescript-metadata`).
**esbuild does not implement this transform** — and `tsup`, `tsx`, and
Vitest's transformer all use esbuild.

When the metadata is missing, NestJS resolves class-typed params to
`undefined` and fails on the first method call.

**Fix.** Use explicit `@Inject(<Token>)` on every class-typed
constructor parameter throughout the library and the example. Verbose
but unambiguous and bundler-agnostic:

```ts
constructor(
  @Inject(Reflector) private readonly reflector: Reflector,
  @Inject(TenantAbilityFactory)
  private readonly factory: TenantAbilityFactory<TAbility>,
) {}
```

**Where this lives.** All NestJS classes in
`nest-warden/src/nestjs/` use explicit `@Inject`. The example's
`MerchantsController`, `MerchantsService`, and `FakeAuthGuard` follow
the same pattern.

---

## 4. NestJS runs guards BEFORE interceptors — tenant context can't depend on the interceptor

**Symptom.** `TenantContextService.get() called before TenantContextInterceptor ran`
even though the interceptor was registered globally. The guard
(`TenantPoliciesGuard`) needed the context but the interceptor that
set it hadn't run yet.

**Root cause.** NestJS's request lifecycle is
`Middleware → Guards → Interceptors (pre) → Pipes → Handler →
 Interceptors (post) → Filters`. Guards run before interceptors. So
`TenantContextInterceptor` can never populate the context in time for
`TenantPoliciesGuard` to read it.

**Fix.** The guard now lazy-resolves the tenant context itself if not
already set. The interceptor is kept as an optional explicit hook for
middleware-style consumers, but the guard is now self-sufficient and
no longer requires the interceptor to be registered first.

**Where this lives.** `nest-warden/src/nestjs/guards/tenant-policies.guard.ts`
contains the lazy-resolve block with a comment explaining the ordering.

---

## 5. EXISTS subqueries inside outer queries need correlated WHERE, not JOIN

**Symptom.** SQL error `relation "m" does not exist` (or whatever the
outer alias is) when running an `accessibleBy` query with `$relatedTo`.

**Root cause.** The first version of the `$relatedTo` SQL compiler tried
to emit:

```sql
EXISTS (
  SELECT 1 FROM merchants m1 INNER JOIN m ON m.merchant_id = m1.id
  -- ↑ "m" isn't a table inside the subquery, it's the outer alias
)
```

The outer-query alias is **not** a table inside an EXISTS subquery — it's
a correlated reference accessible via column lookup. The correct shape:

```sql
EXISTS (
  SELECT 1 FROM merchants m1 WHERE m.merchant_id = m1.id
  -- ↑ correlation: outer.col = inner.col, no JOIN
)
```

**Fix.** The compiler's `compileRelatedTo` was rewritten to:
- The first hop (closest to the outer alias) generates `FROM <table>`
  + a WHERE conjunct correlating with the outer alias.
- Subsequent hops use INNER JOIN inside the subquery normally.

**Where this lives.** `src/typeorm/compiler/related-to.ts` —
`buildHopSegment` distinguishes `isFirst` and emits the appropriate
form. Comments at the top of `compileRelatedTo` describe the algorithm.

---

## 6. CASL's `MongoQuery` type rejects custom operators like `$relatedTo`

**Symptom.** `Object literal may only specify known properties, and
'$relatedTo' does not exist in type ...` when defining a rule with
`$relatedTo` via `builder.can(...)`.

**Root cause.** CASL's `MongoQuery` type only knows about the operators
it ships natively. `$relatedTo` is an extension we introduce; CASL's
type system doesn't know about it.

**Fix.** Cast the conditions object to `as never` at the call site:

```ts
builder.can('read', 'Merchant', {
  $relatedTo: { path: [...], where: { ... } },
} as never);
```

This is the pattern documented in the example's `permissions.ts`. A
nicer long-term fix would be to extend `MongoQuery` with our operators
via TypeScript module augmentation, but that's library-internal cleanup
work.

**Where this lives.** `examples/nestjs-app/src/auth/permissions.ts`
shows the pattern with a comment explaining why.

---

## 7. CASL's strict generic — `MongoAbility<[Action, Subject]>` plus narrow conditions

**Symptom.** `Object literal may only specify known properties, and
'agentId' does not exist in type 'string[]'` when `MongoQuery<never>`
gets inferred as the conditions parameter type.

**Root cause.** When `MongoAbility<[Action, Subject]>` has subjects
typed as plain strings (not classes/interfaces), CASL infers
`MongoQuery<never>` for the conditions, which rejects every property
name.

**Fix.** Either:
1. Define typed interfaces and use them in the second tuple position
   (`MongoAbility<[Action, Merchant | Payment | ...]>`).
2. Cast conditions to `as never` at the call site for ergonomic call
   sites.

The library's tests use option 1 in `_fixtures.ts`; the example uses
option 2 for `$relatedTo` calls and option 1 for everything else.

---

## 8. pnpm 11 blocks unapproved build scripts globally

**Symptom.** `pnpm install` exits 1 with `[ERR_PNPM_IGNORED_BUILDS]`.
Every subsequent `pnpm <script>` re-runs install, re-fails, blocks the
whole development loop.

**Root cause.** pnpm 11 introduced a strict global gate: build scripts
(esbuild, native deps like `better-sqlite3`, `ssh2`) must be explicitly
approved per-user or per-project before they run.

**Fix.** Run once after the first install:

```bash
pnpm approve-builds --all
```

This sets the global pnpm config to allow these scripts. The fix is
per-user, not per-project, so it persists across reclones.

**Where this lives.** `package.json` declares `pnpm.onlyBuiltDependencies`
listing the packages we deliberately approve, but pnpm 11's strict mode
still requires the one-time `approve-builds` ack. Documented in this
file because it's the friction point for new contributors.

---

## 9. Returning 404 vs 403 for unauthorized access to existing resources

**Decision.** When a caller is authenticated and tenant-matched but
lacks permission to a specific resource (e.g., agent Bob requesting a
merchant assigned to agent Alice in the same tenant), the example
returns **404 Not Found**, not 403 Forbidden.

**Rationale.** 403 explicitly tells the caller "this resource exists
but you can't see it." That's an information leak — the caller now
knows the resource ID is valid, useful for enumeration attacks. 404
treats unauthorized-to-see as equivalent to nonexistent.

**Tradeoff.** Some clients prefer explicit 403 for UX (e.g., showing
"contact your admin" instead of "page not found"). Both are valid; the
library doesn't dictate. The example's controllers default to 404.

The E2E test (`merchants-controller.e2e.test.ts`) accepts either status
code so the example can flex either way without breaking the contract.

---

## 10. Local pnpm `file:../..` link doesn't refresh on parent rebuild

**Symptom.** Edits to the parent library don't show up in the example
even after `pnpm build`. Old behavior persists in the example's
`node_modules/nest-warden`.

**Root cause.** pnpm caches the resolved tarball of `file:` deps and
doesn't re-link automatically when the source path changes.

**Fix.** After every parent-library rebuild that the example needs to
see:

```bash
cd examples/nestjs-app
rm -rf node_modules/nest-warden
pnpm install --ignore-workspace --force
```

A future improvement would be to convert the project to a real pnpm
workspace (with `pnpm-workspace.yaml`) so symlinks are live. We've
deferred that decision to keep the example installable as a standalone
project for users who copy it out of the repo.

**Where this lives.** `examples/nestjs-app/README.md` mentions the
rebuild dance in the "Run the test suite" section.

## 11. `tenant_memberships` must NOT live under RLS

**Symptom.** Tempting to add `ENABLE ROW LEVEL SECURITY` + tenant-scoped
policy to `tenant_memberships`, matching every other tenant-bearing
table in the schema. Doing so breaks `JwtAuthGuard`: the lookup
returns zero rows for every legitimate request and every user gets
403.

**Root cause.** The membership lookup runs BEFORE any tenant context
is set on the session — that's the whole point. The guard's job is
to *establish* the tenant context by verifying the user's claim
against the membership row. If the table is under RLS, the lookup
runs with no `app.current_tenant_id` set, the policy denies, the
guard sees no row, and the request is rejected.

Defense in depth here is the explicit `WHERE user_id = ? AND
tenant_id = ?` predicate in `MembershipService.findRoles`, plus the
FK constraints. RLS would be a second layer for everything the user
DOES after auth resolves — but it can't gate the auth resolution
itself.

**Fix.** Keep `tenant_memberships` (and the `users` table) un-RLS'd.
Comment the omission explicitly in `sql/init.sql` so a future
reviewer doesn't "fix" it.

## 12. Postgres parameter-type inference fails when a row's only typed value is jsonb

**Symptom.** A multi-row INSERT like

```sql
INSERT INTO tenant_memberships(user_id, tenant_id, roles) VALUES
  ($1, $16, '["agent"]'::jsonb),
  ($2, $16, '["agent"]'::jsonb),
  ...
```

errors with `could not determine data type of parameter $16` —
even though `$16` is clearly a uuid (the third column in the same
row is `'["agent"]'::jsonb`).

**Root cause.** Postgres's parameter-type inferencer looks at each
row independently. The `'…'::jsonb` literal has an explicit cast,
so the engine knows the third column is `jsonb`. But the second
column (`$16`) has no context — the column type alone isn't enough
when the same parameter slot is repeated across rows and only
literal-cast neighbours.

**Fix.** Add an explicit `::uuid` cast on the uuid parameters:

```sql
($1, $16::uuid, '["agent"]'::jsonb)
```

One cast per parameter slot is enough; subsequent uses of the same
`$N` inherit the inferred type. See `test/fixtures/seed.ts` for the
applied pattern.
