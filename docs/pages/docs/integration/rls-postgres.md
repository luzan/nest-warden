---
title: Postgres Row-Level Security
---

nest-warden's auto-injection at the rule layer is the **first line**
of tenant defense. Postgres Row-Level Security (RLS) is the **second
line** — enforced by the database regardless of any application bug,
forgotten WHERE clause, or developer using a raw `Repository<T>`.

We strongly recommend running both layers in production.

## How they relate

| Layer | What it catches |
|---|---|
| nest-warden tenant injection | Auto-pins `tenantId` in every CASL rule. Catches forgotten predicates at the rule level. |
| `TenantSubscriber` insert/update guards | Catches cross-tenant writes via raw `Repository<T>.insert(...)`. |
| Postgres RLS | Catches **everything else** — even raw `dataSource.query('SELECT * FROM merchants')`, even with a typo, even from a misconfigured ORM. The database physically refuses to return the rows. |

If any layer is bypassed, the next one catches the leak. Defense in
depth.

## Apply RLS policies

For each tenant-scoped table:

```sql
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON merchants
  USING (tenant_id::text = current_setting('app.current_tenant_id', true));
```

Notes:
- `FORCE ROW LEVEL SECURITY` makes the policy apply even to the table
  owner. Without it, the application user (often the table owner)
  bypasses RLS — a common gotcha.
- `current_setting('app.current_tenant_id', true)` — the second
  argument (`missing_ok = true`) returns `NULL` when the variable
  isn't set, instead of raising an exception. Combined with the
  `tenant_id::text = NULL` evaluation (which is `NULL`, not `true`),
  this means **no rows are visible** when the variable is unset —
  fail-closed.

{% callout type="warning" title="PERMISSIVE vs RESTRICTIVE" %}
The example above uses Postgres's default `PERMISSIVE` policy kind.
Postgres combines policies as
`(P1 OR P2 OR ...) AND R1 AND R2 AND ...` — at least one PERMISSIVE
policy must grant access for any row to be visible.

A table with **only `RESTRICTIVE` policies** denies every row,
because the PERMISSIVE chain (which grants access) is empty. Earlier
versions of the example app's `init.sql` used `AS RESTRICTIVE` and
silently returned zero rows. Plain (PERMISSIVE) policies are the
right default for tenant isolation.
{% /callout %}

## Set the session variable per request

Use `set_config(...)` (not `SET LOCAL`) so the value can be bound as
a parameter:

```ts
const [sql, params] = buildRlsSet(tenantId);
// → ['SELECT set_config($1, $2, true)', ['app.current_tenant_id', tenantId]]
await queryRunner.query(sql, [...params]);
```

`SET LOCAL <name> = $1` doesn't work — Postgres parses `SET` at parse
time, before parameter binding. `set_config(name, value, is_local)`
is the executor-level equivalent and is fully parameterizable.
`is_local = true` makes the change transaction-scoped.

## Auto-set with `RlsTransactionInterceptor`

The library ships a NestJS interceptor that wraps every
non-public request in a transaction and runs `set_config(...)` before
the route handler. Register it as a global APP_INTERCEPTOR:

```ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RlsTransactionInterceptor } from 'nest-warden/typeorm';

@Module({
  imports: [TenantAbilityModule.forRoot({ ... })],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RlsTransactionInterceptor },
  ],
})
export class AppModule {}
```

The interceptor:
- Skips public routes (no tenant context, no transaction).
- Opens a transaction, sets `app.current_tenant_id`, runs the
  handler, commits on success / rolls back on error.
- Releases the connection regardless of outcome.

## Performance considerations

Opening a transaction per request:
- Adds one round-trip at the start (the `SELECT set_config(...)`).
- Holds a pooled connection for the request's lifetime.

For most request volumes this is negligible. For very-high-RPS
read-mostly endpoints (e.g., a webhook ingestion service), consider
scoping the transaction more narrowly — wrap a single service method
instead of the whole request, so connections aren't held open during
network I/O.

## Two roles: app vs system

The library assumes a two-role pattern in production:

```sql
-- App user: subject to RLS, used by the request-handling pool
CREATE ROLE app_user LOGIN PASSWORD '...' NOBYPASSRLS;

-- Admin role: bypasses RLS, used for migrations and scheduled jobs
CREATE ROLE app_admin NOLOGIN BYPASSRLS;
```

The connection pool uses `app_user`. Migrations and cross-tenant
scheduled jobs run as `app_admin`. The two are never interchangeable
at runtime — keep their credentials in separate secrets and rotate
independently.

## Verifying RLS works

The example app's `test/e2e/rls-isolation.e2e.test.ts` is the
canonical verification. It:

1. Creates two tenants seeded with overlapping data.
2. Connects as a non-superuser app role.
3. Runs `SELECT * FROM merchants` (no WHERE) under each tenant.
4. Asserts only the active tenant's rows come back.
5. Asserts that omitting `set_config(...)` returns zero rows
   (fail-closed).
6. Asserts that inserting a row with mismatching `tenant_id` is
   rejected at write time (PERMISSIVE policy's implicit
   `WITH CHECK`).

Drop a similar test into your own E2E suite to lock in the property.

## INSERT / UPDATE rejection

PERMISSIVE policies derive a default `WITH CHECK` clause from `USING`,
so an attempt to insert a row whose `tenant_id` doesn't match the
active session fails with `new row violates row-level security policy`.

This is **stronger** than the example originally documented (where I
expected the insert to succeed silently and the row to be invisible
to the inserter). PERMISSIVE policies hard-reject; RESTRICTIVE
policies require explicit `WITH CHECK`. For PERMISSIVE the rejection
is automatic.

The end result is the same: cross-tenant exfiltration is structurally
impossible from the app role.

## See also

- [TypeORM integration](/docs/integration/typeorm/)
- [`buildRlsSet` reference](/docs/api/overview/) — the helper signature.
- [PostgreSQL RLS docs](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) — the canonical reference.
