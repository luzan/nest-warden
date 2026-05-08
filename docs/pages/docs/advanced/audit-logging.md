---
title: Audit Logging
---

Multi-tenant SaaS — especially in regulated domains (PCI, HIPAA,
SOC 2) — needs to record **who did what across tenant boundaries**.
nest-warden provides three primitives for audit-friendly logging.

## 1. The `crossTenant` rule marker

Every rule created via `builder.crossTenant.can(...)` is tagged with
a non-enumerable `__mtCrossTenant` symbol on the raw rule object.
The marker survives `Rule.origin` so it's accessible from the
compiled ability:

```ts
import { isCrossTenantRule } from 'nest-warden';

const ability = await abilityFactory.build();
const crossTenantRules = ability.rules.filter((rule) =>
  isCrossTenantRule(rule.origin),
);

console.log(`User has ${crossTenantRules.length} cross-tenant rules active`);
```

Fold into your audit log to record every cross-tenant capability the
acting user has on a given request — even if no cross-tenant action
fires, the *capability* is auditable.

## 2. The `@AllowCrossTenant(reasonCode)` decorator

Routes that intentionally allow cross-tenant access carry a
human-readable reason code:

```ts
import { AllowCrossTenant, CheckPolicies } from 'nest-warden/nestjs';

@AllowCrossTenant('platform-staff-impersonation')
@CheckPolicies(/* ability check */)
@Post('admin/impersonate/:userId')
async impersonate(@Param('userId') userId: string) {
  // ...
}
```

The decorator stores the reason on the route's metadata. Audit-log
scrapers can:

- `git grep '@AllowCrossTenant'` — list every cross-tenant route.
- Read the metadata at runtime to attach the reason to every audit
  entry from that route.

```ts
import { Reflector } from '@nestjs/core';
import { ALLOW_CROSS_TENANT_KEY } from 'nest-warden/nestjs';

const reasonCode = reflector.get<string>(
  ALLOW_CROSS_TENANT_KEY,
  context.getHandler(),
);
```

## 3. Tagging audit entries with the resolved tenant

Inside any service or interceptor, the `TenantContextService` knows
the active tenant. Tag every audit entry with it:

```ts
@Injectable()
export class AuditLogger {
  constructor(
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  log(action: string, target: string, metadata?: Record<string, unknown>) {
    const ctx = this.tenantContext.get();
    return auditRepo.insert({
      timestamp: new Date(),
      action,
      target,
      tenantId: ctx.tenantId,
      actorId: ctx.subjectId,
      actorRoles: ctx.roles,
      metadata,
    });
  }
}
```

For impersonation flows (where the **actor** and the **acting tenant**
are different), include both:

```ts
log(action: string, target: string, metadata?: Record<string, unknown>) {
  const ctx = this.tenantContext.get();
  const realActorId = ctx.attributes?.realActorId ?? ctx.subjectId;
  return auditRepo.insert({
    // ...
    realActorId,
    actingAsId: ctx.subjectId,
    targetTenantId: ctx.tenantId,
  });
}
```

The `attributes` field of `TenantContext` is exactly the right place
to carry impersonation metadata.

## Audit-log schema suggestion

The library doesn't ship an audit table — that's app-specific. A
reasonable starting schema:

```sql
CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  -- Tenant context
  tenant_id       uuid NOT NULL,        -- the tenant the action affects
  acting_tenant   uuid NOT NULL,        -- the tenant the actor is acting as
                                         -- (= tenant_id unless impersonating)

  -- Actor identity
  real_actor_id   uuid NOT NULL,        -- the human / service that triggered it
  acting_as_id    uuid,                 -- the user being impersonated, if any
  actor_roles     text[] NOT NULL,

  -- Action
  action          text NOT NULL,        -- 'read', 'update', 'approve', etc.
  target_type     text NOT NULL,        -- 'Merchant', 'Payment', etc.
  target_id       uuid,
  was_cross_tenant boolean NOT NULL DEFAULT false,
  reason_code     text,                  -- from @AllowCrossTenant

  -- Result
  outcome         text NOT NULL CHECK (outcome IN ('allow','deny','error')),
  metadata        jsonb
);

CREATE INDEX idx_audit_tenant_time ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_log (real_actor_id, occurred_at DESC);
CREATE INDEX idx_audit_cross_tenant ON audit_log (was_cross_tenant) WHERE was_cross_tenant;
```

The third index lets compliance reviews answer "show me every
cross-tenant action in the last 90 days" in one query.

## What to audit

The PCI-aware default in production:

- **Every mutation** (`POST` / `PUT` / `PATCH` / `DELETE`).
- **Every cross-tenant read** (route has `@AllowCrossTenant`).
- **Every authorization deny** (the policies guard threw
  `ForbiddenException`).
- **Every login / logout / step-up MFA event** (handled by your auth
  layer, but include in the same audit table for chronological
  correlation).

Reads inside a tenant's own scope typically aren't audited at the
per-record level — that volume is usually impractical and
information-low. RLS at the database layer makes accidental cross-
tenant reads structurally impossible, so per-read auditing has
diminishing returns.

## Retention

PCI DSS requires 1 year of audit retention with 3 months immediately
queryable. Plan for partition rotation (`audit_log_2025_q1`, etc.) or
an external archival pipeline.

## See also

- [Cross-tenant Opt-out](/docs/core-concepts/cross-tenant/)
- [`@AllowCrossTenant`](/docs/integration/nestjs/) decorator reference
- [Tenant Context](/docs/core-concepts/tenant-context/) — `attributes` field for impersonation metadata.
