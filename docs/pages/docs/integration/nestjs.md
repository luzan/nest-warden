---
title: NestJS Integration
---

The `nest-warden/nestjs` module is a first-party NestJS integration —
not a third-party adapter. One `forRoot()` call wires up the full
stack: tenant resolution, per-request ability building, route-level
policy enforcement, and the `@CurrentTenant` parameter decorator.

## Setup

### 1. Define your action and subject vocabulary

```ts
// src/auth/permissions.ts
import { type MongoAbility } from '@casl/ability';
import type { TenantAbilityBuilder, TenantContext } from 'nest-warden';

export type AppAction = 'read' | 'create' | 'update' | 'delete' | 'manage';
export type AppSubject = 'Merchant' | 'Payment' | 'Agent' | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

export function defineAbilities(
  builder: TenantAbilityBuilder<AppAbility>,
  ctx: TenantContext,
): void {
  if (ctx.roles.includes('iso-admin')) {
    builder.can('manage', 'Merchant');
  }
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', { agentId: ctx.subjectId });
  }
}
```

### 2. Register the module

```ts
// src/app.module.ts
import { Module } from '@nestjs/common';
import { TenantAbilityModule } from 'nest-warden/nestjs';
import { defineAbilities, type AppAbility } from './auth/permissions';

@Module({
  imports: [
    TenantAbilityModule.forRoot<AppAbility>({
      // Server-side resolution — see callout below.
      resolveTenantContext: async (req) => {
        const user = (req as { user: JwtPayload }).user;
        const m = await tenantMembershipsRepo.findOneBy({
          userId: user.sub,
          tenantId: user.claimedTenantId,
          status: 'ACTIVE',
        });
        if (!m) throw new ForbiddenException('No active tenant membership');
        return {
          tenantId: m.tenantId,
          subjectId: m.userId,
          roles: m.roles,
        };
      },

      // Define per-request rules.
      defineAbilities,

      // Optional: the shared permission vocabulary, referenced by
      // roles and any future composer (user-level grants, etc.).
      permissions,

      // Optional groups — omit any group to take the defaults.
      builder: { tenantField: 'tenantId' },
      roles: { systemRoles, loadCustomRoles },
      graph: relationshipGraph,
      module: { registerAsGlobal: true },
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

{% callout type="warning" title="Server-side resolution is the security contract" %}
The `resolveTenantContext` callback **must** verify the claimed
tenant against a server-side membership table — never trust the JWT
claim directly. A forged token could swap `tenantId` to access
another customer's data; only the database knows whether the user
actually has a membership in that tenant.
{% /callout %}

### 3. Use it in controllers

```ts
import { Controller, Get, Param, Inject } from '@nestjs/common';
import { CheckPolicies } from 'nest-warden/nestjs';
import type { AppAbility } from '../auth/permissions';

@Controller('merchants')
export class MerchantsController {
  constructor(
    @Inject(MerchantsService)
    private readonly merchants: MerchantsService,
  ) {}

  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
  @Get()
  list() {
    return this.merchants.findAll();
  }

  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
  @Get(':id')
  get(@Param('id') id: string) {
    return this.merchants.findOne(id);
  }
}
```

The `TenantPoliciesGuard` (registered as a global `APP_GUARD` by
default) runs every `@CheckPolicies` handler and throws
`ForbiddenException` on any `false` return.

## Decorators

| Decorator | Purpose |
|---|---|
| `@Public()` | Skip auth + tenant context entirely. Use for health checks, public landing pages. |
| `@CheckPolicies(...handlers)` | Attach one or more policy handlers to a route. Each handler is `(ability) => boolean`. |
| `@AllowCrossTenant(reasonCode)` | Mark a route as deliberately cross-tenant. Used with `crossTenant.can()` rules and audited. |
| `@CurrentTenant()` | Inject the resolved `TenantContext` into a controller param. |
| `@CurrentTenant('tenantId')` | Inject a single field from the context. |

## Custom auth integration

The library doesn't ship its own auth — it expects `request.user` to
be populated by your auth guard (Passport JWT, Auth0, custom JWT
middleware, etc.) **before** `TenantPoliciesGuard` runs.

A typical setup uses two global guards:

```ts
// app.module.ts
@Module({
  imports: [TenantAbilityModule.forRoot({ ... })],
  providers: [
    // Your auth guard runs FIRST and populates request.user.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // (TenantPoliciesGuard is auto-registered by TenantAbilityModule)
  ],
})
export class AppModule {}
```

The example app at `examples/nestjs-app/` uses a `FakeAuthGuard` that
reads `request.user` from a header — replace with `@nestjs/passport`'s
JWT guard for production.

## Guard ordering

NestJS runs guards in registration order. The library's default
arrangement:

1. **Your auth guard** (sets `request.user`).
2. **`TenantPoliciesGuard`** (lazy-resolves `TenantContext`, builds
   the per-request ability, runs `@CheckPolicies` handlers).

The policies guard **lazy-resolves** the tenant context — it doesn't
depend on `TenantContextInterceptor` running first. NestJS runs
guards before interceptors, so depending on an interceptor here would
be a bug; we explicitly avoid that.

This means `TenantContextInterceptor` is optional. Register it
manually if you have middleware-style consumers (request loggers,
metric emitters) that need the context **before** the policies guard
runs — for instance, a logger that tags every request with its
tenant ID.

## esbuild and decorators

NestJS's auto-DI uses TypeScript's `emitDecoratorMetadata` to discover
constructor parameter types. Tools that compile via esbuild (tsup,
tsx, Vitest's default transformer) **do not implement** this metadata
emit. Class-typed constructor parameters resolve to `undefined` and
guards / services crash at runtime.

The library uses explicit `@Inject(<Token>)` everywhere internally,
so it works under all bundlers. **Your app code should follow the
same pattern:**

```ts
// ❌ Breaks under esbuild-based tools
constructor(private readonly merchants: MerchantsService) {}

// ✅ Bundler-agnostic
constructor(
  @Inject(MerchantsService)
  private readonly merchants: MerchantsService,
) {}
```

## Module options reference

The options surface groups related fields under `builder`, `roles`,
and `module` sub-objects. The two required callbacks
(`defineAbilities`, `resolveTenantContext`) and the foundational
`permissions` registry stay at the top level. See the 0.5.0-alpha
CHANGELOG for the complete before/after mapping if you're migrating
from 0.4.x.

```ts
interface TenantAbilityModuleOptions<TAbility, TId extends TenantIdValue = string> {
  // Required callbacks ─────────────────────────────────────────────────

  /** Define rules for the resolved context (per request). May be async. */
  defineAbilities: (
    builder: TenantAbilityBuilder<TAbility, TId>,
    ctx: TenantContext<TId>,
    req: unknown,
  ) => void | Promise<void>;

  /** Resolve the canonical TenantContext from a request. Server-side lookup. */
  resolveTenantContext: (req: unknown) => TenantContext<TId> | Promise<TenantContext<TId>>;

  // Foundational vocabulary ────────────────────────────────────────────

  /**
   * Permission registry. Referenced by `roles.systemRoles`,
   * `roles.loadCustomRoles`, and any future composer (user-level
   * grants, group permissions, …). Intentionally top-level rather
   * than nested under `roles`.
   */
  permissions?: PermissionRegistry;

  // Optional config groups ─────────────────────────────────────────────

  /** How the per-request TenantAbilityBuilder is constructed. */
  builder?: {
    /** Resource field carrying the tenant ID. Default: 'tenantId'. */
    tenantField?: string;
    /** CASL ability factory or class. Default: createMongoAbility. */
    abilityClass?: AbilityClass<TAbility> | CreateAbility<TAbility>;
    /** Run validateTenantRules at .build() time. Default: true. */
    validateRules?: boolean;
  };

  /** Role registries + custom-role loader (RFC 001). */
  roles?: {
    systemRoles?: RoleRegistry;
    loadCustomRoles?: (tenantId, ctx) => readonly CustomRoleEntry[] | Promise<...>;
    /** Logger for custom-role dropouts. Defaults to NestJS Logger. */
    logger?: LoggerService;
    /** Suppress per-request dropout logs. Default: false. */
    silentDropouts?: boolean;
  };

  /** Optional relationship graph; required for $relatedTo rules. */
  graph?: RelationshipGraph;

  /** NestJS module wiring. */
  module?: {
    /** Predicate for non-decorator-marked public routes. */
    isPublic?: (ctx: ExecutionContext) => boolean;
    /** Auto-register the global APP_GUARD + APP_INTERCEPTOR. Default: true. */
    registerAsGlobal?: boolean;
  };
}
```

## See also

- [TypeORM integration](/docs/integration/typeorm/) — wiring up `accessibleBy()`.
- [Postgres RLS](/docs/integration/rls-postgres/) — the defense-in-depth layer.
- [Tenant Context](/docs/core-concepts/tenant-context/) — what `resolveTenantContext` produces.
