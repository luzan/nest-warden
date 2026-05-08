import type { RelationshipResolver } from './resolver.js';

/**
 * A relationship between two subject types in the application's data graph.
 *
 * Relationships are registered once at module bootstrap (typically inside
 * the NestJS module's `forRoot()` configuration) and referenced by name in
 * rule conditions via the `$relatedTo` operator.
 *
 * @example
 *   graph.define({
 *     name: 'agent_of_merchant',
 *     from: 'Agent',
 *     to: 'Merchant',
 *     resolver: joinTable({
 *       table: 'agent_merchant_assignments',
 *       fromKey: 'agent_id',
 *       toKey: 'merchant_id',
 *     }),
 *     accessor: (agent: Agent) => agent.merchants,
 *   });
 */
export interface Relationship<
  TFrom extends string = string,
  TTo extends string = string,
> {
  /** Unique identifier referenced from `$relatedTo.path`. */
  readonly name: string;
  /** Source subject type (string id, e.g., `'Agent'`). */
  readonly from: TFrom;
  /** Target subject type (string id, e.g., `'Merchant'`). */
  readonly to: TTo;
  /**
   * Resolution strategy — used by the Phase 3 TypeORM compiler to emit
   * SQL fragments. Forward-direction (`ability.can`) checks ignore this
   * field and use {@link Relationship.accessor} instead.
   */
  readonly resolver: RelationshipResolver;
  /**
   * Optional in-memory accessor: given a fully-loaded `from` instance,
   * return the related `to` instance(s).
   *
   * Provide this when forward-direction `$relatedTo` checks need to
   * succeed without a database round-trip — typical for resources whose
   * relations are eager-loaded by the calling endpoint. When omitted,
   * forward-direction `$relatedTo` evaluates to `false` (the rule
   * cannot match without enough information). Reverse lookups via
   * `accessibleBy()` are unaffected.
   *
   * The accessor may return a single instance, an array of instances, or
   * `undefined` / `null` (treated as "no related instance" — the path
   * dead-ends).
   */
  readonly accessor?: RelationshipAccessor;
}

/**
 * Function signature for a relationship's in-memory accessor.
 *
 * Receives a `from`-side instance, returns the related `to`-side
 * instance(s). The matcher consumes the result, normalizing scalars and
 * arrays uniformly.
 */
export type RelationshipAccessor = (
  fromInstance: unknown,
) => RelationshipAccessorResult;

/**
 * Permitted return shapes for a {@link RelationshipAccessor}.
 *
 * - A single related instance (any object).
 * - An array of related instances (sparse entries are skipped by the matcher).
 * - `null` or `undefined` when the relation is not loaded or not present.
 */
export type RelationshipAccessorResult =
  | object
  | readonly (object | null | undefined)[]
  | null
  | undefined;

/**
 * Resolved sequence of relationships forming a path between two subject
 * types. Returned by {@link RelationshipGraph.path} and
 * {@link RelationshipGraph.resolvePath}.
 */
export interface RelationshipPath {
  /** Starting subject type. */
  readonly from: string;
  /** Ending subject type. */
  readonly to: string;
  /** The relationships traversed, in order from `from` to `to`. */
  readonly hops: readonly Relationship[];
}

/**
 * Operator value for the `$relatedTo` condition.
 *
 * @example
 *   builder.can('approve', 'Payment', {
 *     $relatedTo: {
 *       path: ['merchant_of_payment', 'agent_of_merchant'],
 *       where: { id: ctx.subjectId },
 *     },
 *   });
 */
export interface RelatedToCondition {
  /** Relationship names traversed in order. */
  readonly path: readonly string[];
  /**
   * Mongo-style filter applied to the leaf instance(s). Scalar values match
   * via equality; the standard supported operators (`$eq`, `$in`, etc.)
   * are honored exactly as in top-level conditions.
   */
  readonly where: Record<string, unknown>;
}

/** Symbol-key form of the `$relatedTo` operator embedded in conditions. */
export const RELATED_TO_OPERATOR = '$relatedTo' as const;
