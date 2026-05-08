/**
 * Strategy types for resolving how two subject types are related at the
 * data-storage layer.
 *
 * Resolvers are pure metadata at the core layer. The Phase 3 TypeORM
 * compiler reads them to generate SQL `JOIN` / `EXISTS` fragments;
 * forward-direction (`ability.can(...)`) checks use the optional
 * `accessor` on a {@link Relationship} instead, never the resolver.
 *
 * Three built-in shapes cover ~95% of real-world schemas:
 *
 *   • {@link ForeignKeyResolver} — `from.fk = to.pk` (1:N or N:1)
 *   • {@link JoinTableResolver} — `from ⋈ join_table ⋈ to` (M:N)
 *   • {@link CustomResolver} — consumer-supplied SQL fragment for closure
 *     tables, recursive CTEs, materialized hierarchies, and other exotica.
 */

export type RelationshipResolverKind = 'foreign-key' | 'join-table' | 'custom';

/**
 * Common base shape; every resolver carries a `kind` discriminator so the
 * Phase 3 SQL compiler can dispatch in a tagged-union switch.
 */
export interface RelationshipResolverBase {
  readonly kind: RelationshipResolverKind;
}

/**
 * Resolves a one-to-many (or many-to-one) relationship via a single
 * foreign-key column. The most common shape:
 *
 *   `Payment(merchant_id) → Merchant(id)`
 *
 * @example
 *   foreignKey({ fromColumn: 'merchant_id', toColumn: 'id' })
 */
export interface ForeignKeyResolver extends RelationshipResolverBase {
  readonly kind: 'foreign-key';
  /** Column on the `from` table that references the `to` table. */
  readonly fromColumn: string;
  /** Column on the `to` table that's referenced. Defaults to `'id'`. */
  readonly toColumn?: string;
  /**
   * Optional explicit table names. When omitted, the TypeORM compiler
   * infers them from the entity registered for each subject type.
   */
  readonly fromTable?: string;
  readonly toTable?: string;
}

/**
 * Resolves a many-to-many relationship via a junction table:
 *
 *   `Agent ⋈ agent_merchant_assignments ⋈ Merchant`
 *
 * @example
 *   joinTable({
 *     table: 'agent_merchant_assignments',
 *     fromKey: 'agent_id',
 *     toKey: 'merchant_id',
 *   })
 */
export interface JoinTableResolver extends RelationshipResolverBase {
  readonly kind: 'join-table';
  /** Junction table name. */
  readonly table: string;
  /** Column on the junction table referencing the `from` subject. */
  readonly fromKey: string;
  /** Column on the junction table referencing the `to` subject. */
  readonly toKey: string;
  /** Defaults to `'id'`. The PK column on the `from` table. */
  readonly fromPrimaryKey?: string;
  /** Defaults to `'id'`. The PK column on the `to` table. */
  readonly toPrimaryKey?: string;
}

/**
 * Escape hatch for relationships that don't fit the FK or join-table
 * patterns — closure tables, materialized paths, recursive CTEs, etc.
 *
 * The Phase 3 compiler embeds `sql` verbatim into an EXISTS subquery, so
 * the consumer is responsible for parameterization and SQL injection
 * safety. Use only with trusted, hard-coded fragments.
 *
 * @example
 *   custom({
 *     // Recursive CTE walking the org hierarchy
 *     sql: `
 *       WITH RECURSIVE descendants(id) AS (
 *         SELECT id FROM organizations WHERE id = :from_id
 *         UNION ALL
 *         SELECT o.id FROM organizations o JOIN descendants d ON o.parent_id = d.id
 *       )
 *       SELECT 1 FROM descendants WHERE id = :to_id
 *     `,
 *   })
 */
export interface CustomResolver extends RelationshipResolverBase {
  readonly kind: 'custom';
  /**
   * SQL fragment used inside the EXISTS subquery. The compiler binds the
   * `:from_id` and `:to_id` placeholders; any other parameters must be
   * provided via `params`.
   */
  readonly sql: string;
  /** Optional named parameters for the SQL fragment. */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** Discriminated union of all built-in resolver kinds. */
export type RelationshipResolver = ForeignKeyResolver | JoinTableResolver | CustomResolver;

// --- Factory functions --------------------------------------------------

/**
 * Build a {@link ForeignKeyResolver} with sensible defaults.
 * @param options Resolver fields; `toColumn` defaults to `'id'`.
 */
export function foreignKey(options: Omit<ForeignKeyResolver, 'kind'>): ForeignKeyResolver {
  return { kind: 'foreign-key', toColumn: 'id', ...options };
}

/**
 * Build a {@link JoinTableResolver} with sensible defaults.
 * @param options Resolver fields; primary keys default to `'id'`.
 */
export function joinTable(options: Omit<JoinTableResolver, 'kind'>): JoinTableResolver {
  return { kind: 'join-table', fromPrimaryKey: 'id', toPrimaryKey: 'id', ...options };
}

/**
 * Build a {@link CustomResolver}. Consumer is responsible for SQL safety.
 */
export function custom(options: Omit<CustomResolver, 'kind'>): CustomResolver {
  return { kind: 'custom', ...options };
}
