# nest-warden — NestJS Example App

A runnable MVP that demonstrates **every** headline capability of the
`nest-warden` library against a real Postgres database, with **RLS
policies enforced at the database layer**.

This example was built **TDD-first**: the E2E tests (`test/e2e/`) were
written before any application code. Run `pnpm test:e2e` to see the
proof — the tests spin up a fresh Postgres 16 container, apply
`sql/init.sql` (which contains the RLS policies), seed two tenants, and
verify every property the library promises.

## What this example demonstrates

| Capability | Where to look |
|---|---|
| Tenant safety by construction | `src/auth/permissions.ts` — every `builder.can()` auto-pins `tenantId`. |
| Conditional authorization (correct) | Same file — `$eq`, `$in`, etc. compile to real SQL. |
| Relationship graph + `$relatedTo` | `src/app.relationships.ts`, agent rules in `permissions.ts`. |
| Reverse lookups via `accessibleBy()` | `src/merchants/merchants.service.ts:findAll`. |
| First-party NestJS integration | `src/app.module.ts:TenantAbilityModule.forRoot`. |
| RLS at the database layer | `sql/init.sql`, verified by `test/e2e/rls-isolation.e2e.test.ts`. |
| Cross-tenant opt-out (platform staff) | `permissions.ts: builder.crossTenant.can(...)`. |

## Topology

```
tenant ACME                          tenant BETA
├── agent alice                      └── agent carol
│     ├── merchant Acme Coffee   ←      └── merchant Beta Bakery
│     └── merchant Acme Plumbing       
├── agent bob                            
│     └── merchant Acme Plumbing  ←  (shared with alice)
└── merchant Acme Closed (no agents assigned)
```

Each merchant has 0–N payments, scoped to the same tenant.

## Run locally

```bash
pnpm install
pnpm db:up               # start Postgres in Docker (host port 54329)
pnpm start:dev           # NestJS on http://localhost:3000
```

The Postgres container is bound to **54329** on the host — chosen
deliberately so it doesn't conflict with a developer's main Postgres on
5432 or a secondary instance on 5433. If 54329 is also taken on your
machine, override it:

```bash
MTC_EXAMPLE_DB_PORT=55432 pnpm db:up
DB_PORT=55432 pnpm start:dev
```

The E2E suite uses testcontainers, which always picks a free random
port — no manual port management needed there.

In another terminal, hit the API with the fake-auth header:

```bash
# Alice — agent in ACME, assigned to m1+m2
curl -H "x-fake-user: $(printf '%s' '{"userId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001","tenantId":"11111111-1111-1111-1111-111111111111","roles":["agent"]}' | tr -d '\n')" \
  http://localhost:3000/merchants
# → 2 results: Acme Coffee + Acme Plumbing

# Carol — agent in BETA
curl -H "x-fake-user: $(printf '%s' '{"userId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0003","tenantId":"22222222-2222-2222-2222-222222222222","roles":["agent"]}' | tr -d '\n')" \
  http://localhost:3000/merchants
# → 1 result: Beta Bakery
```

## Run the test suite

```bash
pnpm test:e2e            # Requires Docker; spins up Postgres in testcontainers
```

The E2E suite has two top-level files:

  1. `rls-isolation.e2e.test.ts` — **proves RLS works** at the DB layer
     independent of the application. Even with `SELECT * FROM merchants`
     and no WHERE, Postgres returns only rows matching the active
     `app.current_tenant_id`.

  2. `merchants-controller.e2e.test.ts` — exercises the full stack:
     fake-auth header → guard → tenant-context-interceptor → policies
     guard → service → `accessibleBy(...)` → SQL → DB → RLS → response.

## What's intentionally not in this example

- **Real authentication.** The fake-auth header is for demonstration. A
  production app would replace `FakeAuthGuard` with a JWT guard that
  verifies the token and looks up `tenant_memberships`.
- **Pagination, sorting, search.** Out of scope; the listing endpoints
  return everything the user can see.
- **Migrations / schema management.** `sql/init.sql` handles bootstrap;
  a real app would use TypeORM migrations or a tool like Atlas.
- **Real impersonation flow.** The `crossTenant` opt-out is shown for
  platform-admin reads; the audit trail and step-up MFA that production
  needs are the consumer's responsibility.

## License

MIT — same as the parent library.
