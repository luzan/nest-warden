import { Inject, Injectable, NotFoundException, Scope } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { accessibleBy } from 'nest-warden/typeorm';
import { TenantAbilityFactory, TenantContextService } from 'nest-warden/nestjs';
import { Merchant } from '../entities/merchant.entity.js';
import { relationshipGraph } from '../app.relationships.js';
import type { AppAbility } from '../auth/permissions.js';

/**
 * Reads merchants the requesting user is allowed to see.
 *
 * Two read paths:
 *
 *   - `findAll(ability)`: builds a `QueryBuilder`, applies
 *     `accessibleBy(...)`, returns rows in a single SQL query. Used by
 *     listing endpoints; scales to thousands of merchants per ISO.
 *
 *   - `findOne(id, ability)`: loads the merchant first, then runs a
 *     forward check via `ability.can('read', merchant)`. Throws
 *     NotFoundException if the row doesn't exist OR the rule denies it
 *     (we deliberately do not leak existence cross-tenant).
 */
@Injectable({ scope: Scope.REQUEST })
export class MerchantsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TenantAbilityFactory)
    private readonly abilityFactory: TenantAbilityFactory<AppAbility>,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(): Promise<Merchant[]> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Merchant);
    const qb = repo.createQueryBuilder('m');
    accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph: relationshipGraph }).applyTo(qb);
    return qb.getMany();
  }

  /**
   * Lists merchants the caller is allowed to `approve`. Demonstrates
   * conditional authorization end-to-end: the rule attached to the
   * `merchant-approver` role carries `{ status: 'pending' }`, which
   * `accessibleBy()` compiles into the emitted SQL — the database
   * never returns active or closed rows for an approver. No
   * in-memory filtering.
   */
  async findApprovable(): Promise<Merchant[]> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Merchant);
    const qb = repo.createQueryBuilder('m');
    accessibleBy(ability, 'approve', 'Merchant', { alias: 'm', graph: relationshipGraph }).applyTo(qb);
    return qb.getMany();
  }

  /**
   * Update a merchant. Demonstrates the standard write pattern:
   *
   *   1. Tenant-scoped load — `findOne` with `tenantId` filter so
   *      cross-tenant IDs surface as 404, not as authorization
   *      errors. Avoids leaking existence across tenant boundaries.
   *   2. Forward authorization check — `ability.can('update',
   *      merchant)` gates per-row. Cheaper than rebuilding ability
   *      twice and necessary for rules with row-level conditions.
   *   3. Persist via the same repository; `TenantSubscriber.beforeUpdate`
   *      runs as defense-in-depth, refusing the write if the loaded
   *      row's `tenantId` no longer matches the active context.
   */
  async update(id: string, partial: Partial<Merchant>): Promise<Merchant> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Merchant);

    const merchant = await repo.findOne({
      where: { id, tenantId: this.tenantContext.tenantId },
    });
    if (!merchant) throw new NotFoundException(`Merchant ${id} not found.`);

    if (!ability.can('update', { ...merchant, __caslSubjectType__: 'Merchant' } as never)) {
      throw new NotFoundException(`Merchant ${id} not found.`);
    }

    Object.assign(merchant, partial);
    return repo.save(merchant);
  }

  /**
   * Hard-delete a merchant. Same gating pattern as `update`. Soft
   * delete is intentionally not modeled here — see the roadmap for
   * the slice that introduces `@DeleteDateColumn` and verifies its
   * interaction with `accessibleBy()`.
   */
  async remove(id: string): Promise<void> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Merchant);

    const merchant = await repo.findOne({
      where: { id, tenantId: this.tenantContext.tenantId },
    });
    if (!merchant) throw new NotFoundException(`Merchant ${id} not found.`);

    if (!ability.can('delete', { ...merchant, __caslSubjectType__: 'Merchant' } as never)) {
      throw new NotFoundException(`Merchant ${id} not found.`);
    }

    await repo.remove(merchant);
  }

  async findOne(id: string): Promise<Merchant> {
    const ability = await this.abilityFactory.build();
    const repo = this.dataSource.getRepository(Merchant);

    // Pre-flight: respect the tenant context so the row even loads.
    const merchant = await repo.findOne({
      where: { id, tenantId: this.tenantContext.tenantId },
    });
    if (!merchant) throw new NotFoundException(`Merchant ${id} not found.`);

    // Forward check: relationship-aware (agent assignments).
    if (!ability.can('read', { ...merchant, __caslSubjectType__: 'Merchant' } as never)) {
      // The `$relatedTo` rule for agents needs the merchant→agents
      // relation eager-loaded. Fall back to an EXISTS query when the
      // accessor can't resolve in-memory.
      const allowed = await this.canReadViaQuery(id);
      if (!allowed) throw new NotFoundException(`Merchant ${id} not found.`);
    }

    return merchant;
  }

  /**
   * Verify access via a single EXISTS query — the same SQL the listing
   * endpoint generates, scoped to one merchant ID. This is the fallback
   * used when in-memory `ability.can()` can't traverse the relationship
   * graph (assignments aren't eager-loaded).
   */
  private async canReadViaQuery(merchantId: string): Promise<boolean> {
    const ability = await this.abilityFactory.build();
    const qb = this.dataSource
      .getRepository(Merchant)
      .createQueryBuilder('m')
      .select('1')
      .where('m.id = :id', { id: merchantId });
    accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph: relationshipGraph }).applyTo(qb);
    const row = await qb.getRawOne<unknown>();
    return row !== undefined && row !== null;
  }
}
