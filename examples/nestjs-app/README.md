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

In another terminal, mint a short-lived JWT and hit the API with it.
The example signs tokens with the dev secret defined in
[`src/auth/tokens.ts`](./src/auth/tokens.ts) (`dev-secret-not-for-production`);
production deployments override `JWT_SECRET` with a high-entropy value
from a secret manager.

```bash
# Mint a token (Node one-liner — same secret the guard verifies against)
ALICE_TOKEN=$(node -e "
  const { JwtService } = require('@nestjs/jwt');
  const svc = new JwtService({ secret: 'dev-secret-not-for-production' });
  console.log(svc.sign(
    { sub: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaa0001',
      tenantId: '11111111-1111-1111-1111-111111111111' },
    { expiresIn: '15m' }
  ));
")

curl -H "Authorization: Bearer $ALICE_TOKEN" http://localhost:3000/merchants
# → 2 results: Acme Coffee + Acme Plumbing
#   Note: roles are NOT in the token — JwtAuthGuard reads them from
#   `tenant_memberships` so a tampered token cannot escalate privileges.
```

**The trust-boundary check in action.** Pat the platform admin has
memberships in both tenants (iso-admin in ACME, viewer in BETA).
Minting two tokens for the same `sub` with different `tenantId`
claims produces two different role sets, because the server reads
roles from the DB at request time:

```bash
# Same sub (USER_PAT), different tenantId claims:
PAT_ACME=$(node -e "/* sign for tenantId=ACME */ ...")
PAT_BETA=$(node -e "/* sign for tenantId=BETA */ ...")

curl -H "Authorization: Bearer $PAT_ACME" http://localhost:3000/merchants
# → all 3 ACME merchants (iso-admin)
curl -H "Authorization: Bearer $PAT_BETA" http://localhost:3000/merchants
# → 1 BETA merchant (merchant-viewer-public — narrower scope)
```

If Pat's token claims a tenantId he has no membership in, the server
returns 403 — exactly the "tampered claim" failure mode the
server-side lookup is designed to catch.

## Run the test suite

```bash
pnpm test:e2e            # Requires Docker; spins up Postgres in testcontainers
```

The E2E suite has these top-level files:

  1. `rls-isolation.e2e.test.ts` — **proves RLS works** at the DB layer
     independent of the application. Even with `SELECT * FROM merchants`
     and no WHERE, Postgres returns only rows matching the active
     `app.current_tenant_id`.

  2. `auth.e2e.test.ts` — exercises `JwtAuthGuard` end-to-end:
     valid token → 200, missing header → 401, valid token but no
     membership in the claimed tenant → 403. Includes a
     `describe.skip` block of adversarial scenarios (tampered
     signature, expired token, alg-confusion) tracked under Theme 7
     PR E in the roadmap.

  3. `merchants-controller.e2e.test.ts` + `payments-controller.e2e.test.ts`
     — exercise the full stack: JWT guard → tenant-context-interceptor
     → policies guard → service → `accessibleBy(...)` → SQL → DB →
     RLS → response.

  4. `common.e2e.test.ts` — cross-cutting pagination DTO behaviour
     shared between merchants and payments.

## What's intentionally not in this example

- **Token issuance UI.** The example mints tokens directly via the
  `JwtService` from `@nestjs/jwt` for demo simplicity. A real app
  would have a `/auth/login` endpoint that verifies a password
  against the `users` table (or a federated identity provider) and
  returns the signed token.
- **Pagination, sorting, search.** Out of scope; the listing endpoints
  return everything the user can see.
- **Migrations / schema management.** `sql/init.sql` handles bootstrap;
  a real app would use TypeORM migrations or a tool like Atlas.
- **Real impersonation flow.** The `crossTenant` opt-out is shown for
  platform-admin reads; the audit trail and step-up MFA that production
  needs are the consumer's responsibility.

## License

MIT — same as the parent library.
