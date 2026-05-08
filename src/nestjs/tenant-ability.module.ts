import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { AnyAbility } from '@casl/ability';
import type { TenantIdValue } from '../core/tenant-id.js';
import { TenantPoliciesGuard } from './guards/tenant-policies.guard.js';
import type { TenantAbilityModuleOptions } from './options.js';
import { TenantAbilityFactory } from './tenant-ability.factory.js';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';
import { TenantContextService } from './tenant-context.service.js';
import { MTC_OPTIONS } from './tokens.js';

/**
 * The library's NestJS entry point.
 *
 * Usage in `app.module.ts`:
 *
 * ```ts
 * @Module({
 *   imports: [
 *     TenantAbilityModule.forRoot<AppAbility>({
 *       resolveTenantContext: async (req) => { ... server-side membership lookup ... },
 *       defineAbilities: (builder, ctx) => {
 *         if (ctx.roles.includes('agent')) {
 *           builder.can('read', 'Merchant', { agentId: ctx.subjectId });
 *         }
 *       },
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * The default `forRoot` registration is **global** (registers a global
 * `TenantContextInterceptor` and `TenantPoliciesGuard`) so every route
 * gets tenant scoping automatically. Disable this with
 * `registerAsGlobal: false` and wire the guard/interceptor manually for
 * incremental migration.
 *
 * The module is itself `@Global()` so the providers it exports
 * (`TenantContextService`, `TenantAbilityFactory`, ...) are available to
 * any feature module without re-importing.
 */
@Module({})
export class TenantAbilityModule {
  static forRoot<TAbility extends AnyAbility = AnyAbility, TId extends TenantIdValue = string>(
    options: TenantAbilityModuleOptions<TAbility, TId>,
  ): DynamicModule {
    const optionsProvider: Provider = {
      provide: MTC_OPTIONS,
      useValue: options,
    };

    const baseProviders: Provider[] = [
      optionsProvider,
      TenantContextService,
      TenantAbilityFactory,
      TenantContextInterceptor,
      TenantPoliciesGuard,
    ];

    const globalProviders: Provider[] =
      options.registerAsGlobal !== false
        ? [
            { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
            { provide: APP_GUARD, useClass: TenantPoliciesGuard },
          ]
        : [];

    return {
      module: TenantAbilityModule,
      global: true,
      providers: [...baseProviders, ...globalProviders],
      exports: [
        MTC_OPTIONS,
        TenantContextService,
        TenantAbilityFactory,
        TenantContextInterceptor,
        TenantPoliciesGuard,
      ],
    };
  }
}
