---
title: Testing Strategies
---

nest-warden's library suite has 285 tests at 100% coverage; the
example app has 14 E2E tests against real Postgres. Lessons from
that test design that apply to consumer apps:

## Two test layers, not one

| Layer | Speed | Coverage | What it catches |
|---|---|---|---|
| Unit (rule + ability) | ms | Permission logic | Rule definition mistakes, missing role branches, condition typos. |
| E2E (controller → DB) | seconds | Integration | Bundler / DI / RLS bugs, ordering problems, real SQL. |

Don't skip either. Unit tests give fast feedback during development;
E2E tests catch the integration bugs unit tests can't see.

## Unit tests: building abilities directly

```ts
import { TenantAbilityBuilder } from 'nest-warden';
import { createMongoAbility, type MongoAbility } from '@casl/ability';
import { defineAbilities, type AppAbility } from '../auth/permissions';

function buildAbility(roles: string[], subjectId = 'u1', tenantId = 't1'): AppAbility {
  const ctx = { tenantId, subjectId, roles };
  const builder = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
  defineAbilities(builder, ctx);
  return builder.build();
}

describe('Agent role', () => {
  it('cannot read merchants without an assignment', () => {
    const ability = buildAbility(['agent']);
    expect(
      ability.can('read', { __caslSubjectType__: 'Merchant', tenantId: 't1' }),
    ).toBe(false);
  });
});
```

Speed: <10ms per test. Run on every save.

For `$relatedTo` rules, supply eager-loaded relations:

```ts
const merchant = {
  __caslSubjectType__: 'Merchant',
  tenantId: 't1',
  agents: [{ id: 'u1' }],  // matches the $relatedTo rule
};
expect(ability.can('read', merchant)).toBe(true);
```

## E2E tests: testcontainers Postgres + RLS

The example app's pattern:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  dataSource = await connectDataSource(container);
  await applySchema(dataSource);  // including RLS policies
  await seedFixture(dataSource);
});

it('Alice sees only her assigned merchants', async () => {
  const res = await request(app.getHttpServer())
    .get('/merchants')
    .set('x-fake-user', JSON.stringify({ userId: 'alice', tenantId: 't1', roles: ['agent'] }));

  expect(res.status).toBe(200);
  expect(res.body.map((m) => m.id)).toEqual(['m1', 'm2']);
});
```

testcontainers spins up a fresh Postgres per test run. Slower than
sqlite (~10s setup, ~50ms per test) but gives you:

- Real RLS policies executing against real Postgres.
- The same SQL the library generates in production.
- No drift between test and production environments.

## Property-based tests for invariants

The library uses `fast-check` to assert **structural** properties
that should hold across all rule definitions:

```ts
import fc from 'fast-check';

it('every rule produced via .can()/.cannot() carries the tenant predicate', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 16 }),
      (tenantId) => {
        const ctx = { tenantId, subjectId: 'u1', roles: [] };
        const builder = new TenantAbilityBuilder(createMongoAbility, ctx);
        builder.can('read', 'Merchant');
        for (const rule of builder.rules) {
          expect(rule.conditions?.tenantId).toBe(tenantId);
        }
      },
    ),
  );
});
```

For consumer apps, useful properties to check:

- "Forward `ability.can(action, x)` matches inclusion in
  `accessibleBy(...)` for any seed data."
- "Every `crossTenant.can()` rule carries a corresponding
  `@AllowCrossTenant` decorator on the route."
- "Every entity with `@TenantColumn` has a corresponding RLS
  policy on its table."

The third one is automated by inspecting `getTenantColumn(...)` for
every registered entity and querying `pg_policies` to verify.

## Fixtures: two tenants, overlapping data

The example app's seed pattern:

```
tenant ACME                          tenant BETA
├── agent alice (assigned to m1, m2) └── agent carol (assigned to m4)
├── agent bob   (assigned to m2)
├── merchant m1 (active)
├── merchant m2 (pending)
├── merchant m3 (closed, no agents)
└── ... payments scoped to merchants

tenant BETA
└── merchant m4 (active)
```

Two tenants with overlapping IDs / names is the right shape for
catching cross-tenant leaks. If your test fixture has only one
tenant, you can't possibly verify isolation.

## Cross-tenant assertion pattern

Every E2E test that lists or fetches resources should assert
**zero** cross-tenant rows in the response:

```ts
const res = await request(app)
  .get('/merchants')
  .set('x-fake-user', acmeAdmin);

const allTenants = new Set(res.body.map((m) => m.tenantId));
expect(allTenants).toEqual(new Set(['t1']));  // ACME only
```

Catching one cross-tenant row in 1000 is hard with random sampling;
making the assertion **categorical** (zero of any other tenant)
catches the leak deterministically.

## Testing without Docker

If your CI doesn't have Docker, use `better-sqlite3` for unit-style
tests of the TypeORM adapter:

```ts
const dataSource = new DataSource({
  type: 'better-sqlite3',
  database: ':memory:',
  entities: [Merchant],
  synchronize: true,
});
```

Caveats:
- sqlite has no RLS. RLS-layer tests must use real Postgres.
- sqlite's parameter binding works fine for `accessibleBy()` — the
  library's tests use sqlite for this exact purpose.
- Avoid sqlite for `$relatedTo` SQL tests if you use Postgres-specific
  features (recursive CTEs, ::text casts).

## Test the failure modes

Just as important as testing the happy path:

- Calling `tenantContext.get()` from a `@Public()` route should
  throw `MissingTenantContextError`.
- Defining a rule without `tenantId` should throw
  `CrossTenantViolationError` at `.build()`.
- An agent reading a merchant they're not assigned to should get
  403 (or 404 if you prefer existence-hiding — the example accepts
  either).
- Using an unsupported operator should throw
  `UnsupportedOperatorError` from `accessibleBy()`.

If those don't throw, your defense-in-depth has a hole.

## See also

- [Performance](/docs/advanced/performance/) — including the example app's E2E latency baseline.
- [Recipes](/docs/advanced/recipes/) — common patterns including impersonation tests.
