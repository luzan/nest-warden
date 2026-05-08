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
