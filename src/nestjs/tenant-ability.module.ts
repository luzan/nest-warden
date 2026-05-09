import { type DynamicModule, type ModuleMetadata, Module, type Provider } from '@nestjs/common';
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
 * Options for {@link TenantAbilityModule.forRootAsync}. Mirrors the
 * NestJS convention used by `TypeOrmModule.forRootAsync` etc. — pass
 * a `useFactory` plus an `inject` list and the framework resolves
 * dependencies before constructing the module's options object.
 *
 * The most common use is wiring `loadCustomRoles` to a database
 * connection that's also managed by NestJS DI.
 */
export interface TenantAbilityModuleAsyncOptions<
  TAbility extends AnyAbility = AnyAbility,
  TId extends TenantIdValue = string,
> extends Pick<ModuleMetadata, 'imports'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly inject?: readonly any[];
  readonly useFactory: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: readonly any[]
  ) =>
    | TenantAbilityModuleOptions<TAbility, TId>
    | Promise<TenantAbilityModuleOptions<TAbility, TId>>;
  /**
   * Mirrors {@link TenantAbilityModuleOptions.registerAsGlobal}. The
   * factory result's `registerAsGlobal` is also honored — if both
   * are set, the factory's value wins.
   */
  readonly registerAsGlobal?: boolean;
}

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

  /**
   * Async variant of {@link TenantAbilityModule.forRoot}. Use when the
   * module options depend on injectable services — most commonly when
   * `loadCustomRoles` (RFC 001 Phase C) needs a database connection.
   *
   * @example
   *   TenantAbilityModule.forRootAsync<AppAbility>({
   *     imports: [TypeOrmModule.forFeature([CustomRole])],
   *     inject: [getRepositoryToken(CustomRole)],
   *     useFactory: (customRolesRepo: Repository<CustomRole>) => ({
   *       resolveTenantContext: ...,
   *       defineAbilities: ...,
   *       permissions,
   *       systemRoles,
   *       loadCustomRoles: (tenantId) =>
   *         customRolesRepo.find({ where: { tenantId } }),
   *     }),
   *   })
   */
  static forRootAsync<TAbility extends AnyAbility = AnyAbility, TId extends TenantIdValue = string>(
    asyncOptions: TenantAbilityModuleAsyncOptions<TAbility, TId>,
  ): DynamicModule {
    const optionsProvider: Provider = {
      provide: MTC_OPTIONS,
      useFactory: asyncOptions.useFactory,
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
      inject: asyncOptions.inject ? ([...asyncOptions.inject] as any[]) : [],
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any */
    };

    const baseProviders: Provider[] = [
      optionsProvider,
      TenantContextService,
      TenantAbilityFactory,
      TenantContextInterceptor,
      TenantPoliciesGuard,
    ];

    const globalProviders: Provider[] =
      asyncOptions.registerAsGlobal !== false
        ? [
            { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
            { provide: APP_GUARD, useClass: TenantPoliciesGuard },
          ]
        : [];

    return {
      module: TenantAbilityModule,
      global: true,
      imports: asyncOptions.imports ? [...asyncOptions.imports] : [],
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
