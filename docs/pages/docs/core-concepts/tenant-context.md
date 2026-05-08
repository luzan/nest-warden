---
title: Tenant Context
---

The **`TenantContext`** is the single source of truth for the active
request's tenant identity. Every authorization decision in nest-warden
reads from it; nothing in the library trusts a client-supplied claim
directly.

## Shape

```ts
interface TenantContext<TId extends TenantIdValue = string> {
  readonly tenantId: TId;
  readonly subjectId: string | number;
  readonly roles: readonly string[];
  readonly attributes?: Readonly<Record<string, unknown>>;
}
```

| Field | Purpose |
|---|---|
| `tenantId` | The canonical tenant boundary. UUID by default; integer ID also supported via the `TId` generic. **Resolved server-side** — never the raw JWT claim. |
| `subjectId` | The acting user's stable ID. Used by rules like `{ id: ctx.subjectId }`. |
| `roles` | The roles active in this tenant. Drives which permission branches `defineAbilities` activates. |
| `attributes` | Free-form bag for application-specific extras (`actingNodeId`, locale, feature flags). Treated as opaque by the library; rules can reference fields inside it. |

## Where it's set

In a NestJS app using `TenantAbilityModule`, the context is resolved
**once per request** by the `resolveTenantContext` callback you pass to
`forRoot()`:

```ts
TenantAbilityModule.forRoot<AppAbility>({
  resolveTenantContext: async (req) => {
    const user = (req as { user: JwtPayload }).user;
    const membership = await memberships.findActive({
      userId: user.sub,
      tenantId: user.claimedTenantId,
    });
    if (!membership) throw new ForbiddenException('No active tenant membership');
    return {
      tenantId: membership.tenantId,
      subjectId: membership.userId,
      roles: membership.roles,
      attributes: { actingNodeId: membership.nodeId },
    };
  },
  defineAbilities: (builder, ctx, req) => {
    /* ... */
  },
});
```

{% callout type="warning" title="Server-side resolution is non-negotiable" %}
The `resolveTenantContext` callback **must** load the tenant from a
trusted server-side source — typically a `tenant_memberships` table
keyed by JWT `sub`. **Never trust the JWT's `tenantId` claim
directly**: a forged or replayed token could swap it.

The library can't enforce this — it's a contract on the consumer's
implementation. The example app at `examples/nestjs-app/` demonstrates
the correct pattern.
{% /callout %}

## Where it's read

Anywhere in your request scope, inject `TenantContextService`:

```ts
import { Injectable, Scope, Inject } from '@nestjs/common';
import { TenantContextService } from 'nest-warden/nestjs';

@Injectable({ scope: Scope.REQUEST })
export class MerchantsService {
  constructor(
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  listMine() {
    const tenantId = this.tenantContext.tenantId; // throws if unset
    // ...
  }
}
```

Or use the `@CurrentTenant()` parameter decorator on a controller:

```ts
import { CurrentTenant } from 'nest-warden/nestjs';
import type { TenantContext } from 'nest-warden';

@Get('me/tenant')
me(@CurrentTenant() ctx: TenantContext) {
  return { tenantId: ctx.tenantId, roles: ctx.roles };
}

@Get('me/id')
id(@CurrentTenant('tenantId') tenantId: string) {
  return { tenantId };
}
```

## When it isn't set

`TenantContextService.get()` throws `MissingTenantContextError` if
called before the context is resolved. This is intentional fail-closed
behavior — never silently fall back to a default tenant.

The context is automatically resolved by `TenantPoliciesGuard` (the
guard `lazy-resolves` it on first read, so the order of guards vs
interceptors doesn't matter — see [NestJS guide § ordering](/docs/integration/nestjs/#guard-ordering)).

For routes marked `@Public()`, the resolver is skipped — anything in
those handlers that calls `tenantContext.get()` will throw. That's the
right behavior: public endpoints shouldn't read tenant scope.

## Generic tenant ID type

Default is `string` (UUID-friendly). For projects using integer
tenant IDs:

```ts
const builder = new TenantAbilityBuilder<AppAbility, number>(createMongoAbility, {
  tenantId: 42,
  subjectId: 1,
  roles: ['agent'],
});
```

Both `string` and `number` are first-class. The `TenantIdValue` type
admits both; pick one per project and pass it as the second generic
to `TenantAbilityBuilder` and `TenantContext`.
