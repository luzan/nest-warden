import type {
  DeepPartial,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import type { TenantIdValue } from '../core/tenant-id.js';
import { getTenantColumn } from './tenant-column.decorator.js';

/**
 * Source of the active tenant ID, called once per repository operation.
 * Most consumers will pass `() => tenantContextService.tenantId` in NestJS;
 * standalone scripts can pass a constant or environment-driven function.
 */
export type TenantIdProvider<TId extends TenantIdValue = TenantIdValue> = () => TId;

/**
 * `Repository<T>` wrapper that auto-injects `WHERE <tenantField> = :tenantId`
 * into every find/update/delete and stamps the column on inserts.
 *
 * Reads the `@TenantColumn`-marked property at construction time. If the
 * entity has no `@TenantColumn`, the wrapper degrades to a passthrough —
 * useful for shared "system" tables (currencies, country codes) that
 * legitimately exist outside tenant scope.
 *
 * The wrapper is intentionally thin: it does NOT subclass `Repository<T>`
 * (TypeORM's API is large and shifts between minor versions), it simply
 * wraps an existing repository and intercepts the most-common method
 * surface. For one-off SQL or features the wrapper doesn't cover, get the
 * underlying `repository` and apply the predicate manually with
 * {@link TenantAwareRepository.scopeWhere} or
 * {@link TenantAwareRepository.scopeQueryBuilder}.
 *
 * @example
 *   const repo = new TenantAwareRepository(
 *     dataSource.getRepository(Merchant),
 *     () => tenantContext.tenantId,
 *   );
 *   const merchants = await repo.find();      // WHERE tenantId = :tid
 *   const m = await repo.findOneBy({ id });   // also scoped
 */
export class TenantAwareRepository<T extends object, TId extends TenantIdValue = TenantIdValue> {
  /** Property name marked with `@TenantColumn`, or `undefined` for non-tenant entities. */
  public readonly tenantField: string | undefined;

  constructor(
    /** Underlying TypeORM repository — exposed for advanced operations. */
    public readonly repository: Repository<T>,
    /** Read the active request's tenant ID. */
    private readonly tenantIdProvider: TenantIdProvider<TId>,
  ) {
    this.tenantField = getTenantColumn(repository.metadata.target as object);
  }

  /** Convenience accessor matching `Repository<T>.target`. */
  get target(): EntityTarget<T> {
    return this.repository.target;
  }

  /**
   * Run `find` with the tenant predicate auto-merged into `where`.
   * Multi-clause `where` arrays are NOT supported here — pass a single
   * object, or use {@link TenantAwareRepository.repository} directly.
   */
  find(options?: FindManyOptions<T>): Promise<T[]> {
    return this.repository.find(this.scopeOptions(options));
  }

  findAndCount(options?: FindManyOptions<T>): Promise<[T[], number]> {
    return this.repository.findAndCount(this.scopeOptions(options));
  }

  findOne(options: FindOneOptions<T>): Promise<T | null> {
    return this.repository.findOne(this.scopeOptions(options));
  }

  findOneBy(where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOneBy(this.scopeWhere(where));
  }

  findBy(where: FindOptionsWhere<T>): Promise<T[]> {
    return this.repository.findBy(this.scopeWhere(where));
  }

  count(options?: FindManyOptions<T>): Promise<number> {
    return this.repository.count(this.scopeOptions(options));
  }

  /**
   * `save` routes through TypeORM's normal lifecycle, so
   * {@link TenantSubscriber} stamps the tenant column. Provided for API
   * completeness — call `repository.save()` directly if you prefer.
   */
  save<E extends DeepPartial<T>>(entity: E): Promise<E & T> {
    return this.repository.save(entity);
  }

  /**
   * Build a `SelectQueryBuilder<T>` with the tenant predicate applied via
   * `andWhere`. The result is a regular TypeORM query builder you can
   * extend with joins, ordering, pagination, etc.
   *
   * @param alias - Required (TypeORM convention). Use a short identifier
   *   matching the table's role in the query.
   */
  createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    const qb = this.repository.createQueryBuilder(alias);
    return this.scopeQueryBuilder(qb, alias);
  }

  /**
   * Apply the tenant predicate to an existing `SelectQueryBuilder`. Use
   * when composing query builders that didn't originate from this
   * wrapper — e.g., joins from a parent entity's repository.
   */
  scopeQueryBuilder(qb: SelectQueryBuilder<T>, alias: string): SelectQueryBuilder<T> {
    if (!this.tenantField) return qb;
    const tenantId = this.tenantIdProvider();
    const paramName = `mtc_tenant_${alias}`;
    return qb.andWhere(`${alias}.${this.tenantField} = :${paramName}`, {
      [paramName]: tenantId,
    });
  }

  /**
   * Add the tenant predicate to a `where` object, returning a new
   * (frozen) object. Idempotent: if the caller already specified the
   * tenant field, the existing value wins.
   */
  scopeWhere(where: FindOptionsWhere<T>): FindOptionsWhere<T> {
    if (!this.tenantField) return where;
    const field = this.tenantField;
    if (Object.prototype.hasOwnProperty.call(where, field)) return where;
    return { ...where, [field]: this.tenantIdProvider() };
  }

  /** Apply tenant scope to the `where` clause of a find-options object. */
  private scopeOptions<O extends FindManyOptions<T> | FindOneOptions<T>>(options?: O): O {
    if (!this.tenantField) return (options ?? {}) as O;
    const tenantId = this.tenantIdProvider();
    const where = options?.where;
    const tenantField = this.tenantField;

    if (!where) {
      return { ...(options ?? {}), where: { [tenantField]: tenantId } } as O;
    }
    if (Array.isArray(where)) {
      // Each branch gets the tenant predicate (idempotently).
      const scoped = where.map((w: FindOptionsWhere<T>) =>
        Object.prototype.hasOwnProperty.call(w, tenantField)
          ? w
          : ({ ...w, [tenantField]: tenantId } as FindOptionsWhere<T>),
      );
      return { ...options, where: scoped };
    }
    if (Object.prototype.hasOwnProperty.call(where, tenantField)) {
      return options;
    }
    return {
      ...options,
      where: { ...where, [tenantField]: tenantId },
    };
  }
}
