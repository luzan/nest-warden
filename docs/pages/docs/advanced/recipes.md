---
title: Recipes
---

Common patterns assembled from the library's primitives.

## Impersonation flow

A platform-staff user temporarily acts as another user inside a tenant:

```ts
// In your auth flow:
async function startImpersonation(realActor: User, target: User, reasonCode: string) {
  // 1. Verify allow-list (actor role × target role × reason)
  await assertAllowedToImpersonate(realActor, target, reasonCode);

  // 2. Issue a short-lived token with impersonation claim
  const token = await jwt.sign({
    sub: target.id,                // the acted-as user
    tenantId: target.tenantId,
    realActorId: realActor.id,     // the real human
    impersonationReason: reasonCode,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  await auditLog.record({
    event: 'impersonation_start',
    actor: realActor.id,
    target: target.id,
    reason: reasonCode,
  });

  return token;
}
```

Then in `resolveTenantContext`, surface the impersonation metadata:

```ts
resolveTenantContext: async (req) => {
  const claims = await verifyJwt(req);
  return {
    tenantId: claims.tenantId,
    subjectId: claims.sub,
    roles: claims.roles,
    attributes: {
      realActorId: claims.realActorId,
      impersonationReason: claims.impersonationReason,
    },
  };
}
```

`defineAbilities` reads `ctx.attributes.realActorId` to scope rules
appropriately (e.g., the impersonator can read but not approve
financial actions).

The route that receives impersonated requests is marked:

```ts
@AllowCrossTenant('platform-staff-impersonation')
@CheckPolicies(/* ability check that runs as the target */)
async someEndpoint() { ... }
```

Audit logger uses `ctx.attributes.realActorId` to record the human
actor alongside `ctx.subjectId` (the impersonated identity).

## Role inheritance

If your roles form a hierarchy (`super-admin > admin > member`), express
inheritance via shared rule blocks:

```ts
function defineAbilities(builder, ctx) {
  // Member: base permissions
  if (ctx.roles.includes('member') ||
      ctx.roles.includes('admin') ||
      ctx.roles.includes('super-admin')) {
    builder.can('read', 'Merchant');
  }

  // Admin: member + management
  if (ctx.roles.includes('admin') || ctx.roles.includes('super-admin')) {
    builder.can('manage', 'Merchant');
    builder.can('manage', 'Agent');
  }

  // Super-admin: admin + cross-tenant
  if (ctx.roles.includes('super-admin')) {
    builder.crossTenant.can('read', 'Merchant');
  }
}
```

For more complex inheritance, define a helper:

```ts
function rolesIncluding(role: string, ctx: TenantContext): boolean {
  const hierarchy: Record<string, string[]> = {
    'member':      ['member', 'admin', 'super-admin'],
    'admin':       ['admin', 'super-admin'],
    'super-admin': ['super-admin'],
  };
  return hierarchy[role]?.some(r => ctx.roles.includes(r)) ?? false;
}

if (rolesIncluding('admin', ctx)) {
  builder.can('manage', 'Merchant');
}
```

## Attribute-based conditions (ABAC-style)

Express attribute conditions on the resource itself:

```ts
// Compliance officers can read merchants with high-risk score in their tenant
if (ctx.roles.includes('compliance-officer')) {
  builder.can('read', 'Merchant', {
    riskScore: { $gte: 80 },
  });
}

// Only managers approve payments above $10k
if (ctx.roles.includes('manager')) {
  builder.can('approve', 'Payment', {
    amountCents: { $gte: 1_000_000 },
  });
}
```

These compose naturally with the auto-injected tenant predicate and
with `$relatedTo` graph traversal.

## Time-bounded access

For temporary access (e.g., a vendor with read access until a date):

```ts
const now = new Date().toISOString();

if (ctx.roles.includes('vendor-read-only')) {
  builder.can('read', 'Order', {
    accessGrantedUntil: { $gte: now },
    status: { $in: ['shipped', 'delivered'] },
  });
}
```

If `accessGrantedUntil` is in the past, the rule's condition fails
and the vendor sees no orders. No additional cleanup logic needed.

## "Active membership" check inline in rules

A common need: even within a tenant, the user's membership row may
be revoked or expired without a fresh logout. Express this in
`resolveTenantContext` (the membership query is THE source of truth):

```ts
resolveTenantContext: async (req) => {
  const claims = req.user;
  const m = await memberships.findOne({
    userId: claims.sub,
    tenantId: claims.claimedTenantId,
    status: 'ACTIVE',
    expiresAt: MoreThan(new Date()),
  });
  if (!m) throw new ForbiddenException('No active membership');
  return { tenantId: m.tenantId, subjectId: m.userId, roles: m.roles };
}
```

If the membership is revoked, `resolveTenantContext` throws on the
**very next request** — the JWT is still valid until expiry, but the
authorization layer rejects it. This is the correct behavior:
revocation is server-side, not client-side.

## Multi-tenant search with pagination

```ts
async search(query: string, page: number, perPage: number) {
  const ability = await abilityFactory.build();
  const qb = repo
    .createQueryBuilder('m')
    .where('m.name ILIKE :q', { q: `%${query}%` })
    .orderBy('m.name')
    .skip(page * perPage)
    .take(perPage);

  accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph }).applyTo(qb);
  return qb.getManyAndCount();
}
```

`accessibleBy()`'s WHERE composes with your filter / ORDER BY /
LIMIT — pagination is server-side, not "load all then slice."

## Conditional cross-tenant access (escalation)

A pattern where a regular user temporarily gains cross-tenant rights
after MFA + manager approval:

```ts
function defineAbilities(builder, ctx) {
  // Normal scope
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', { /* tenant-scoped */ });
  }

  // Escalated: only after step-up MFA AND active escalation row
  if (ctx.attributes?.escalationActive === true) {
    builder.crossTenant.can('read', 'Merchant');
  }
}
```

The `escalationActive` flag is set in `resolveTenantContext` after
checking a separate `escalations` table:

```ts
const escalation = await escalations.findOne({
  userId: claims.sub,
  status: 'ACTIVE',
  expiresAt: MoreThan(new Date()),
});

return {
  tenantId,
  subjectId: claims.sub,
  roles: claims.roles,
  attributes: { escalationActive: !!escalation },
};
```

## Auto-setting the RLS session variable

[Postgres RLS policies](/docs/integration/rls-postgres/) read the
tenant id from a session variable (`app.current_tenant_id` by default).
Something has to set that variable before each authenticated request
hits a tenant-scoped table. There are three strategies; pick based on
your app's request volume and existing transaction-management
patterns.

### Strategy 1 — `RlsTransactionInterceptor` (the simplest)

The library ships a NestJS interceptor that wraps every non-public
request in a transaction and runs `SELECT set_config(...)` before the
route handler. Register it as a global APP_INTERCEPTOR:

```ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RlsTransactionInterceptor } from 'nest-warden/typeorm';

@Module({
  imports: [TenantAbilityModule.forRoot({ ... })],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RlsTransactionInterceptor },
    // Optional: suppress the one-time startup warning once you've
    // audited the trade-off below.
    // { provide: 'MTC_RLS_OPTIONS', useValue: { silentStartupWarning: true } },
  ],
})
export class AppModule {}
```

What it does:
- Skips public routes (no tenant context, no transaction).
- Opens a transaction, sets `app.current_tenant_id`, runs the handler,
  commits on success / rolls back on error.
- Releases the connection regardless of outcome.

**Trade-off — pool pressure.** The interceptor opens a transaction
for *every* request, including read-only routes that don't otherwise
need one. Each request holds a pooled connection for its lifetime.
For high-RPS workloads (~hundreds of RPS or more), this can saturate
the connection pool faster than you'd expect. The interceptor emits
a one-time startup warning on its first instantiation flagging this;
pass `{ silentStartupWarning: true }` via `MTC_RLS_OPTIONS` once you've
explicitly decided this trade-off is acceptable for your app.

Use this strategy when:
- You're in the early/medium stages of a SaaS app where RPS is in
  the tens-of-RPS range.
- You value wiring simplicity over peak throughput.
- Your route handlers do more than trivial DB work — the round-trip
  cost is amortised.

### Strategy 2 — `set_config` via a TypeORM subscriber

Avoid the per-request transaction by setting the session variable on
the connection itself, just before TypeORM's first query in the
request. This needs the same
[`AsyncLocalStorage` bridge](https://github.com/luzan/nest-warden/blob/main/examples/nestjs-app/src/auth/tenant-als.ts)
the example app already uses for `TenantSubscriber`:

```ts
@EventSubscriber()
export class RlsSessionSubscriber implements EntitySubscriberInterface {
  beforeQuery(event: QueryEvent) {
    const tenantId = tenantAls.getStore()?.tenantId;
    if (!tenantId) return; // public route, no scope to set
    // set_config with is_local=false applies for the rest of the
    // session; no transaction required. Connection-pool reuse is
    // safe because the pool resets session state on release.
    return event.queryRunner.query(
      'SELECT set_config($1, $2, false)',
      ['app.current_tenant_id', tenantId],
    );
  }
}
```

Caveats:
- TypeORM's `beforeQuery` hook is not part of the stable public API
  in every TypeORM version. Verify with your version before relying
  on this.
- With `is_local = false`, you depend on the pool resetting session
  state between checkouts. Standard `pg-pool` does this; PgBouncer in
  transaction-pooling mode does NOT. See "PgBouncer" below.

Use this strategy when:
- Connection pool pressure is a concern.
- You're comfortable with a TypeORM-internal hook.

### Strategy 3 — scoped transactions inside services

Wrap only the service methods that hit the database in transactions
that set the variable, instead of the whole request:

```ts
async findManyAsTenant<T>(fn: (qr: QueryRunner) => Promise<T>): Promise<T> {
  const qr = this.dataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await qr.query('SELECT set_config($1, $2, true)', [
      'app.current_tenant_id', this.tenantContext.tenantId,
    ]);
    const result = await fn(qr);
    await qr.commitTransaction();
    return result;
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}
```

This is the most flexible but also the most boilerplate-y. Use when:
- You have a small number of DB-heavy service methods rather than
  many DB-light controllers.
- You want explicit control over transaction boundaries.

### PgBouncer caveat (applies to all three)

If you front Postgres with [PgBouncer](https://www.pgbouncer.org/) in
**transaction-pooling** or **statement-pooling** mode, the underlying
connection is returned to the pool between transactions / statements
respectively. Session-scoped state like `app.current_tenant_id`
**does not persist** across pool checkouts.

Strategies 1 and 3 use `is_local = true` (transaction-scoped), which
works correctly under transaction pooling — the SET only lives for
the duration of the transaction, which is also the duration of the
pool checkout.

Strategy 2's session-scoped SET (`is_local = false`) is **incompatible**
with transaction-pooling PgBouncer. Use session-pooling mode, or
switch to Strategy 1.

### What about `SET LOCAL`?

The native Postgres statement is `SET LOCAL <var> = <value>`. It
doesn't accept bound parameters in the value position — Postgres
parses `SET` at parse time, before parameter binding. `set_config(name,
value, is_local)` is the executor-level equivalent and is fully
parameterizable. Always use `set_config`. The library's `buildRlsSet`
helper emits the right thing.

## See also

- [Postgres RLS policies](/docs/integration/rls-postgres/) — defining the policies and the two-role pattern.
- [Tenant Context](/docs/core-concepts/tenant-context/) — `attributes` field for impersonation / escalation metadata.
- [Audit Logging](/docs/advanced/audit-logging/) — recording the patterns above.
- [`@AllowCrossTenant`](/docs/integration/nestjs/) — the route-level marker.
