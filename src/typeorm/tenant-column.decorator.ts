import 'reflect-metadata';

/**
 * Reflect-metadata key under which the tenant column name is stored on
 * the entity prototype. Symbol-keyed to avoid collision with consumer
 * metadata.
 */
export const TENANT_COLUMN_METADATA = Symbol.for('nest-warden:tenant-column');

/**
 * Property decorator that marks the tenant-FK column on a TypeORM entity.
 *
 * The library reads this metadata from {@link TenantSubscriber} (to stamp
 * the column on insert/update) and from {@link TenantAwareRepository} (to
 * inject the tenant predicate into auto-generated WHERE clauses).
 *
 * Combine with TypeORM's own `@Column()` — `@TenantColumn` is purely a
 * marker; it does not configure the column itself.
 *
 * @example
 *   @Entity('merchants')
 *   class Merchant {
 *     @PrimaryGeneratedColumn('uuid')
 *     id!: string;
 *
 *     @Column('uuid')
 *     @TenantColumn()
 *     tenantId!: string;
 *
 *     @Column()
 *     name!: string;
 *   }
 *
 * Each entity may have AT MOST ONE `@TenantColumn`; declaring two on the
 * same class throws at module load time.
 */
export function TenantColumn(): PropertyDecorator {
  return (target, propertyKey) => {
    if (typeof propertyKey !== 'string') {
      throw new TypeError('@TenantColumn() must be applied to a string-named property.');
    }
    const ctor = (target as { constructor: object }).constructor;
    const existing = Reflect.getOwnMetadata(TENANT_COLUMN_METADATA, ctor) as string | undefined;
    if (existing && existing !== propertyKey) {
      throw new Error(
        `Entity "${ctor.constructor.name}" already has a @TenantColumn on "${existing}"; ` +
          `cannot also mark "${propertyKey}".`,
      );
    }
    Reflect.defineMetadata(TENANT_COLUMN_METADATA, propertyKey, ctor);
  };
}

/**
 * Read the `@TenantColumn`-marked property name for an entity class.
 *
 * Returns the property name (a string) or `undefined` when no
 * `@TenantColumn` is declared. The library treats `undefined` as "this
 * entity is not tenant-scoped" — non-tenant entities skip the
 * stamp/inject logic entirely.
 */
export function getTenantColumn(target: object): string | undefined {
  return Reflect.getMetadata(TENANT_COLUMN_METADATA, target) as string | undefined;
}
