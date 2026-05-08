import { Controller, Get, Inject, Param } from '@nestjs/common';
import { CheckPolicies } from 'nest-warden/nestjs';
import { MerchantsService } from './merchants.service.js';
import type { AppAbility } from '../auth/permissions.js';
import type { Merchant } from '../entities/merchant.entity.js';

/**
 * Merchant endpoints. Both routes are policy-gated:
 *
 *   - `GET /merchants` requires `read Merchant` (the rule itself
 *     determines which merchants come back via `accessibleBy`).
 *
 *   - `GET /merchants/:id` requires `read Merchant` at the rule level;
 *     the service does an additional per-instance forward check.
 *
 * The library's `TenantPoliciesGuard` auto-installs as a global
 * `APP_GUARD` (see `app.module.ts`), so the `@CheckPolicies(...)` here
 * is the only thing the controller needs.
 */
@Controller('merchants')
export class MerchantsController {
  constructor(@Inject(MerchantsService) private readonly merchants: MerchantsService) {}

  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
  @Get()
  async list(): Promise<Merchant[]> {
    return this.merchants.findAll();
  }

  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
  @Get(':id')
  async get(@Param('id') id: string): Promise<Merchant> {
    return this.merchants.findOne(id);
  }
}
