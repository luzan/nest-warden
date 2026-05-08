import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Query,
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
  async list(@Query('with_deleted') withDeleted?: string): Promise<Merchant[]> {
    return this.merchants.findAll({ withDeleted: withDeleted === 'true' });
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

  // Field-level projection demo. Same `read Merchant` gate at the
  // controller layer; the service applies `permittedFieldsOf` to
  // limit the response to fields the caller's rule covers. A user
  // with `can('read', 'Merchant', ['id', 'name', 'status'])` sees
  // only those keys; a user with broader manage rights sees the
  // whole entity.
  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Merchant'))
  @Get(':id/projected')
  async getProjected(@Param('id') id: string): Promise<Partial<Merchant>> {
    return this.merchants.findOneProjected(id);
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
