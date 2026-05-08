import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
} from '@nestjs/common';
import { CheckPolicies } from 'nest-warden/nestjs';
import { MerchantsService } from './merchants.service.js';
import type { AppAbility } from '../auth/permissions.js';
import type { Merchant, MerchantStatus } from '../entities/merchant.entity.js';

interface UpdateMerchantBody {
  readonly status?: MerchantStatus;
  readonly name?: string;
}

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

  // Conditional-authz demo. The route is gated on `approve Merchant`,
  // and the rule that grants it carries `{ status: 'pending' }`. The
  // emitted SQL filters by status — no rows of other statuses are
  // returned even though they exist in the same tenant.
  @CheckPolicies((ability: AppAbility) => ability.can('approve', 'Merchant'))
  @Get('approvable')
  async approvable(): Promise<Merchant[]> {
    return this.merchants.findApprovable();
  }

  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
  @Get(':id')
  async get(@Param('id') id: string): Promise<Merchant> {
    return this.merchants.findOne(id);
  }

  @CheckPolicies((ability: AppAbility) => ability.can('update', 'Merchant'))
  @Patch(':id')
  async patch(
    @Param('id') id: string,
    @Body() body: UpdateMerchantBody,
  ): Promise<Merchant> {
    return this.merchants.update(id, body);
  }

  @CheckPolicies((ability: AppAbility) => ability.can('delete', 'Merchant'))
  @HttpCode(204)
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    return this.merchants.remove(id);
  }
}
