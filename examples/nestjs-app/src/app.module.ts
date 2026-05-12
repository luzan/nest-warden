import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { TenantAbilityModule } from 'nest-warden/nestjs';
import type { ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt.guard.js';
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
        tenantField: 'tenantId',
        graph: relationshipGraph,
        permissions,
        systemRoles,
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
        // Tenant-managed custom roles. Library invokes once per
        // request, validates names against system roles + permission
        // refs, and silently drops misconfigured rows (with a
        // console.warn).
        loadCustomRoles: async (tenantId) => {
          const rows = await customRolesRepo.find({ where: { tenantId } });
          return rows.map((r) => ({
            name: r.name,
            description: r.description ?? undefined,
            permissions: r.permissions,
          }));
        },
        defineAbilities,
      }),
    }),
    MerchantsModule,
    PaymentsModule,
  ],
  providers: [
    // JwtAuthGuard runs BEFORE the TenantPoliciesGuard so request.user is
    // available when the policies guard / interceptor read it.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
