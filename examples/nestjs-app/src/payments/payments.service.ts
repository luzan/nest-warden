import { Inject, Injectable, NotFoundException, Scope } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { accessibleBy } from 'nest-warden/typeorm';
import { TenantAbilityFactory, TenantContextService } from 'nest-warden/nestjs';
import { Payment, type PaymentStatus } from '../entities/payment.entity.js';
import { relationshipGraph } from '../app.relationships.js';
import { resolvePagination, type ResolvedPagination } from '../common/dto/pagination-query.dto.js';
import type { AppAbility } from '../auth/permissions.js';

/**
 * Service layer for the payments endpoints. Mirrors `MerchantsService`
 * in structure: reverse-lookup listing via `accessibleBy()`, forward
 * checks via `ability.can()`, and explicit status transitions
 * (`capture`, `refund`) that demonstrate conditional + negative
 * authorization end-to-end.
 *
 * The relationship hop here is two-deep: `Payment → Merchant → Agent`
 * via `merchant_of_payment` + `agents_of_merchant`. The library
 * compiles that path into a correlated EXISTS subquery — a single
 * round-trip regardless of agent-merchant cardinality.
 */
@Injectable({ scope: Scope.REQUEST })
export class PaymentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TenantAbilityFactory)
    private readonly abilityFactory: TenantAbilityFactory<AppAbility>,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * List the payments the caller is allowed to read. Tenant scope and
   * the agent-merchant relationship graph fold into the emitted SQL
   * — no in-memory filtering, no N+1.
   */
  async findAll(pagination: ResolvedPagination): Promise<Payment[]> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Payment);
    const qb = repo.createQueryBuilder('p');
    accessibleBy(ability, 'read', 'Payment', { alias: 'p', graph: relationshipGraph }).applyTo(qb);
    // ORDER BY id (a UUID, unique per row) to give stable pagination.
    // ORDER BY created_at would tie when fixtures insert in a single
    // statement (Postgres uses statement-start time for every row),
    // producing non-deterministic offset behavior in tests.
    return qb.take(pagination.limit).skip(pagination.offset).orderBy('p.id', 'ASC').getMany();
  }

  /**
   * Read one payment. Like `MerchantsService.findOne`, the tenant
   * predicate is enforced in the SQL load, and the per-instance
   * forward check falls back to an EXISTS query when the in-memory
   * matcher can't traverse the agent-merchant join.
   */
  async findOne(id: string): Promise<Payment> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Payment);

    const payment = await repo.findOne({
      where: { id, tenantId: this.tenantContext.tenantId },
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found.`);

    if (!ability.can('read', { ...payment, __caslSubjectType__: 'Payment' } as never)) {
      const allowed = await this.canReadViaQuery(id);
      if (!allowed) throw new NotFoundException(`Payment ${id} not found.`);
    }

    return payment;
  }

  /**
   * Capture an authorized payment. The `payments:capture` permission
   * carries `conditions: { status: 'authorized' }`, so the emitted rule
   * only matches authorized payments. Already-captured rows fail the
   * forward check and surface as 404 (existence not leaked beyond
   * "this row is not actionable for you").
   */
  async capture(id: string): Promise<Payment> {
    return this.transitionStatus(id, 'update', 'captured');
  }

  /**
   * Refund a payment. The positive `refund Payment` rule is granted by
   * the `payment-approver` role; the `cautious-refunder` role
   * subtracts payments whose `amountCents` exceeds the threshold via
   * `cannot`. The forward check is the gate — the service simply
   * persists the new status when the rule allows.
   */
  async refund(id: string): Promise<Payment> {
    return this.transitionStatus(id, 'refund', 'refunded');
  }

  /**
   * Shared persistence path for status transitions. Loads the row
   * tenant-scoped, runs the forward authorization check for the
   * requested action, then writes the new status. Surfaces 404 on
   * any failure mode so cross-tenant existence isn't leaked.
   *
   * The action is what gates: `capture` runs `ability.can('update',
   * payment)` and the rule's `{ status: 'authorized' }` condition
   * filters out already-captured rows. `refund` runs
   * `ability.can('refund', payment)` and the negative rule's
   * threshold filters out high-value payments.
   */
  private async transitionStatus(
    id: string,
    action: 'update' | 'refund',
    nextStatus: PaymentStatus,
  ): Promise<Payment> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Payment);

    const payment = await repo.findOne({
      where: { id, tenantId: this.tenantContext.tenantId },
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found.`);

    const subject = { ...payment, __caslSubjectType__: 'Payment' } as never;
    if (!ability.can(action, subject)) {
      throw new NotFoundException(`Payment ${id} not found.`);
    }

    payment.status = nextStatus;
    return repo.save(payment);
  }

  /**
   * EXISTS-query fallback for the `$relatedTo`-based read path.
   * Identical to `MerchantsService.canReadViaQuery` — the same SQL
   * that `findAll()` emits, scoped to one payment ID.
   */
  private async canReadViaQuery(paymentId: string): Promise<boolean> {
    const ability = await this.abilityFactory.build();
    const qb = this.dataSource
      .getRepository(Payment)
      .createQueryBuilder('p')
      .select('1')
      .where('p.id = :id', { id: paymentId });
    accessibleBy(ability, 'read', 'Payment', { alias: 'p', graph: relationshipGraph }).applyTo(qb);
    const row = await qb.getRawOne<unknown>();
    return row !== undefined && row !== null;
  }

  /**
   * Re-exported so the controller can compose its own pagination
   * query without duplicating the clamp logic. Lives on the service
   * to keep the controller declarative.
   */
  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  parsePagination(raw: { limit?: string | string[]; offset?: string | string[] }): ResolvedPagination {
    return resolvePagination(raw);
  }
}
