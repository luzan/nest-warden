import { mongoQueryMatcher, type ConditionsMatcher, type MongoQuery } from '@casl/ability';
import { RELATED_TO_OPERATOR, type RelatedToCondition } from './relationships/definition.js';
import { evaluateRelatedTo } from './relationships/related-to-operator.js';
import type { RelationshipGraph } from './relationships/graph.js';

export type TenantConditions = MongoQuery;

/**
 * Stock CASL matcher. Use this when no relationship graph is required —
 * e.g., the rules in question never reference `$relatedTo`. Equivalent to
 * `@casl/ability`'s `mongoQueryMatcher`.
 */
export const tenantConditionsMatcher: ConditionsMatcher<MongoQuery> = mongoQueryMatcher;

/**
 * Build a conditions matcher that recognizes the `$relatedTo` operator at
 * the top level of a rule's conditions and delegates everything else to
 * CASL's `mongoQueryMatcher`.
 *
 * Why a factory: the matcher must close over the {@link RelationshipGraph}
 * so it can resolve relationship names into hops. Stock CASL exposes
 * matchers as plain functions, so the closure is the natural shape.
 *
 * Conditions object handling:
 *
 *   - `{ tenantId: 't1' }` — no `$relatedTo`; pure delegation to
 *     `mongoQueryMatcher`. Same behavior as {@link tenantConditionsMatcher}.
 *
 *   - `{ $relatedTo: { path, where } }` — pure relationship check; walks
 *     the path on the subject and matches the leaf via `mongoQueryMatcher`.
 *
 *   - `{ tenantId: 't1', $relatedTo: { ... } }` — combined: both must
 *     match (logical AND). Tenant predicate is evaluated by the standard
 *     matcher; `$relatedTo` runs separately. Order is undefined but the
 *     final result is deterministic.
 *
 * The factory is idempotent for null/undefined inputs (returns a matcher
 * that matches everything, mirroring CASL's contract).
 *
 * @example
 *   const graph = new RelationshipGraph().define({ ... });
 *   const matcher = createTenantConditionsMatcher({ graph });
 *   const Ability = createMongoAbility([], { conditionsMatcher: matcher });
 */
export function createTenantConditionsMatcher(
  options: { readonly graph?: RelationshipGraph } = {},
): ConditionsMatcher<MongoQuery> {
  const graph = options.graph;
  if (!graph) return mongoQueryMatcher;

  return (conditions: MongoQuery): ((object: Record<string, unknown>) => boolean) => {
    // Defer everything that doesn't carry $relatedTo (including null/undefined,
    // which CASL's underlying parser does NOT accept — defensive guard).
    if (
      conditions === null ||
      conditions === undefined ||
      typeof conditions !== 'object' ||
      !(RELATED_TO_OPERATOR in conditions)
    ) {
      return mongoQueryMatcher(conditions);
    }

    // Split $relatedTo from the rest of the conditions.
    const { [RELATED_TO_OPERATOR]: relatedTo, ...rest } = conditions as Record<string, unknown> & {
      [RELATED_TO_OPERATOR]: RelatedToCondition;
    };

    const restKeys = Object.keys(rest);
    const restMatcher =
      restKeys.length === 0 ? (): boolean => true : mongoQueryMatcher(rest as MongoQuery);

    return (object: Record<string, unknown>): boolean => {
      if (!restMatcher(object)) return false;
      return evaluateRelatedTo(object, relatedTo, graph);
    };
  };
}
