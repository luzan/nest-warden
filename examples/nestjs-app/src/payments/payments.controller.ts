import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { CheckPolicies } from 'nest-warden/nestjs';
import { PaymentsService } from './payments.service.js';
import { AnyOf } from '../common/decorators/any-of.decorator.js';
import type { AppAbility } from '../auth/permissions.js';
import type { Payment } from '../entities/payment.entity.js';

/**
 * REST endpoints for the payments domain.
 *
 *   - `GET /payments`              — tenant-scoped list. Agents see
 *                                    only payments of merchants they're
 *                                    assigned to (two-hop $relatedTo).
 *   - `GET /payments/:id`          — per-row forward check.
 *   - `POST /payments/:id/capture` — conditional transition; only
 *                                    authorized payments can be
 *                                    captured (rule's `{ status:
 *                                    'authorized' }` predicate).
 *   - `POST /payments/:id/refund`  — negative-auth pattern; the
 *                                    `cautious-refunder` role
 *                                    subtracts high-value payments
 *                                    even when the positive grant
 *                                    permits refund.
 *
 * The `@CheckPolicies` decorators here gate on the *action* (read /
 * update / refund). The library's `TenantPoliciesGuard` (global via
 * `app.module.ts`) consults the request's ability and either lets
 * the handler run or returns 403. Per-instance checks happen inside
 * the service, where the loaded row is available.
 */
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  // `@AnyOf` demonstrates the OR-composition decorator from `common/`.
  // A consumer with `read Payment` OR `manage Payment` can list. The
  // disjunction is semantically equivalent to a single `read` check
  // (manage subsumes read in CASL), but expressing both shapes
  // documents the intent.
  @AnyOf<AppAbility>(
    (ability) => ability.can('read', 'Payment'),
    (ability) => ability.can('manage', 'Payment'),
  )
  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Payment[]> {
    const pagination = this.payments.parsePagination({ limit, offset });
    return this.payments.findAll(pagination);
  }

  @CheckPolicies((ability: AppAbility) => ability.can('read', 'Payment'))
  @Get(':id')
  async get(@Param('id') id: string): Promise<Payment> {
    return this.payments.findOne(id);
  }

  // Capture is an `update` action — the conditional rule on
  // `payments:capture` carries `{ status: 'authorized' }`. Guard
  // gates on action only; the service's forward check enforces the
  // status predicate per-row.
  @CheckPolicies((ability: AppAbility) => ability.can('update', 'Payment'))
  @HttpCode(200)
  @Post(':id/capture')
  async capture(@Param('id') id: string): Promise<Payment> {
    return this.payments.capture(id);
  }

  // Refund uses the standalone `refund` action — the negative
  // `cannot('refund', 'Payment', { amountCents: { $gt: 10000 } })`
  // rule applied by the `cautious-refunder` role is what kicks in
  // when the row's amount exceeds the threshold.
  @CheckPolicies((ability: AppAbility) => ability.can('refund', 'Payment'))
  @HttpCode(200)
  @Post(':id/refund')
  async refund(@Param('id') id: string): Promise<Payment> {
    return this.payments.refund(id);
  }
}
