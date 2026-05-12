import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { InjectDataSource, TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { TenantAbilityModule } from 'nest-warden/nestjs';
import { TenantSubscriber } from 'nest-warden/typeorm';
import type { ForbiddenException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt.guard.js';
import { TenantAlsInterceptor } from './auth/tenant-als.interceptor.js';
import { resolveTenantIdFromAls } from './auth/tenant-als.js';
import { TenantMembership } from './auth/tenant-membership.entity.js';
import { User } from './auth/user.entity.js';
import { defineAbilities, type AppAbility } from './auth/permissions.js';
import { permissions, systemRoles } from './auth/permission-registry.js';
import { Tenant } from './entities/tenant.entity.js';
import { Merchant } from './entities/merchant.entity.js';
import { Agent } from './entities/agent.entity.js';
import { Payment } from './entities/payment.entity.js';
import { AgentMerchantAssignment } from './entities/agent-merchant-assignment.entity.js';
import { CustomRole } from './entities/custom-role.entity.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { getExampleDataSourceConfig } from './database/datasource.config.js';
import { relationshipGraph } from './app.relationships.js';

void (null as unknown as ForbiddenException); // type-only retain

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...getExampleDataSourceConfig(),
        entities: [
          Tenant,
          Merchant,
          Agent,
          Payment,
          AgentMerchantAssignment,
          CustomRole,
          User,
          TenantMembership,
        ],
        // `TenantSubscriber` is wired in `AppModule.onModuleInit`
        // below — TypeORM's `DataSourceOptions.subscribers` accepts
        // class refs only (instances are silently dropped during
        // loading), and our subscriber needs a captured-closure
        // resolver. The `AppModule` lifecycle hook constructs the
        // instance with the closure and pushes it onto
        // `dataSource.subscribers` after the DataSource is up but
        // before the first request arrives.
        synchronize: false,
        logging: false,
      }),
    }),
    AuthModule,
    TenantAbilityModule.forRootAsync<AppAbility>({
      // CustomRole repository injected so `loadCustomRoles` can hit
      // the database. RFC 001 Phase C — bridges the typed registry
      // primitives to tenant-managed roles loaded at request time.
      imports: [TypeOrmModule.forFeature([CustomRole])],
      inject: [getRepositoryToken(CustomRole)],
      useFactory: (customRolesRepo: Repository<CustomRole>) => ({
        // The request comes pre-authenticated by `JwtAuthGuard`, which
        // verified the token signature, freshness, and the
        // server-side membership before setting `request.user`. The
        // `roles` array on `request.user` is sourced from
        // `tenant_memberships` — never the JWT claims — so a
        // tampered or stale token cannot escalate privileges past
        // this point. See `src/auth/jwt.guard.ts` for the contract.
        resolveTenantContext: (req) => {
          const user = (req as { user?: { userId: string; tenantId: string; roles: string[] } })
            .user;
          if (!user)
            throw new Error(
              'No authenticated user — JwtAuthGuard must run before TenantContextInterceptor.',
            );
          return {
            tenantId: user.tenantId,
            subjectId: user.userId,
            roles: user.roles,
          };
        },
        defineAbilities,
        builder: { tenantField: 'tenantId' },
        graph: relationshipGraph,
        // `permissions` is intentionally NOT under `roles` — it's the
        // shared vocabulary that roles, custom roles, and any future
        // composer (user-level grants, group permissions, …)
        // reference. See JSDoc on `TenantAbilityModuleOptions`.
        permissions,
        roles: {
          systemRoles,
          // Tenant-managed custom roles. Library invokes once per
          // request, validates names against system roles + permission
          // refs, and silently drops misconfigured rows through the
          // configured logger (defaults to NestJS `Logger`).
          loadCustomRoles: async (tenantId) => {
            const rows = await customRolesRepo.find({ where: { tenantId } });
            return rows.map((r) => ({
              name: r.name,
              description: r.description ?? undefined,
              permissions: r.permissions,
            }));
          },
        },
      }),
    }),
    MerchantsModule,
    PaymentsModule,
  ],
  providers: [
    // JwtAuthGuard runs BEFORE the TenantPoliciesGuard so request.user is
    // available when the policies guard / interceptor read it.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Wraps the controller in `tenantAls.run(...)` so `TenantSubscriber`
    // (registered on the singleton DataSource) can read the per-request
    // tenant id from inside TypeORM's synchronous hooks. Must run AFTER
    // nest-warden's `TenantContextInterceptor` (which populates
    // `TenantContextService`) — that interceptor comes from
    // `TenantAbilityModule` and is registered earlier in the dep graph,
    // so it always wraps outermost.
    { provide: APP_INTERCEPTOR, useClass: TenantAlsInterceptor },
  ],
})
export class AppModule implements OnModuleInit {
  constructor(@InjectDataSource() @Inject() private readonly dataSource: DataSource) {}

  /**
   * Application-layer defense in depth on top of Postgres RLS.
   * `TenantSubscriber` stamps tenant_id on every insert and refuses
   * cross-tenant updates regardless of the SQL the service emitted.
   * The resolver pulls the active tenant id out of the per-request
   * `AsyncLocalStorage` populated by `TenantAlsInterceptor`. See
   * `src/auth/tenant-als.ts` for the why behind the ALS bridge.
   *
   * Registered here rather than in `DataSourceOptions.subscribers`
   * because TypeORM only accepts class refs in that field — pre-
   * instantiated subscribers are silently dropped. Pushing onto
   * `dataSource.subscribers` after init is the supported path for
   * subscribers that need a captured-closure resolver.
   */
  onModuleInit(): void {
    this.dataSource.subscribers.push(new TenantSubscriber(resolveTenantIdFromAls));
  }
}
