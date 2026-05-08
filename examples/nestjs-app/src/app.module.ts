import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantAbilityModule } from 'nest-warden/nestjs';
import type { ForbiddenException } from '@nestjs/common';
import { FakeAuthGuard } from './auth/fake-auth.guard.js';
import { defineAbilities, type AppAbility } from './auth/permissions.js';
import { Tenant } from './entities/tenant.entity.js';
import { Merchant } from './entities/merchant.entity.js';
import { Agent } from './entities/agent.entity.js';
import { Payment } from './entities/payment.entity.js';
import { AgentMerchantAssignment } from './entities/agent-merchant-assignment.entity.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { getExampleDataSourceConfig } from './database/datasource.config.js';
import { relationshipGraph } from './app.relationships.js';

void (null as unknown as ForbiddenException); // type-only retain

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...getExampleDataSourceConfig(),
        entities: [Tenant, Merchant, Agent, Payment, AgentMerchantAssignment],
        synchronize: false,
        logging: false,
      }),
    }),
    TenantAbilityModule.forRoot<AppAbility>({
      tenantField: 'tenantId',
      graph: relationshipGraph,
      // For the example, the request comes pre-authenticated by FakeAuthGuard
      // which sets request.user. In production, replace with a JWT lookup
      // that hits a `tenant_memberships` table to verify the claim.
      resolveTenantContext: (req) => {
        const user = (req as { user?: { userId: string; tenantId: string; roles: string[] } }).user;
        if (!user) throw new Error('No authenticated user — FakeAuthGuard must run before TenantContextInterceptor.');
        return {
          tenantId: user.tenantId,
          subjectId: user.userId,
          roles: user.roles,
        };
      },
      defineAbilities,
    }),
    MerchantsModule,
  ],
  providers: [
    // FakeAuthGuard runs BEFORE the TenantPoliciesGuard so request.user is
    // available when the policies guard / interceptor read it.
    { provide: APP_GUARD, useClass: FakeAuthGuard },
  ],
})
export class AppModule {}
