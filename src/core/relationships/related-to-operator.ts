import { mongoQueryMatcher, type MongoQuery } from '@casl/ability';
import type { RelatedToCondition } from './definition.js';
import type { RelationshipGraph } from './graph.js';

/**
 * Evaluate a `$relatedTo` condition against a forward-direction subject
 * instance. Returns `true` if walking the path from the subject yields at
 * least one leaf instance matching the `where` filter.
 *
 * "Forward direction" means `ability.can(action, subject)` checking
 * **this specific instance**. For reverse lookups ("which instances can
 * this subject access?") the TypeORM compiler in Phase 3 handles the
 * `$relatedTo` operator separately by emitting SQL EXISTS subqueries.
 *
 * Algorithm:
 *
 *   1. Resolve the path of relationships from the named hops.
 *   2. Start with `[subject]` as the current frontier.
 *   3. For each hop, expand each frontier instance via
 *      {@link Relationship.accessor}. If a hop has no accessor, the
 *      frontier collapses to empty (forward eval cannot proceed without
 *      eager-loaded relations) and the function returns `false`.
 *   4. After the last hop, evaluate the leaf `where` filter against any
 *      remaining frontier instance. Returns `true` if any matches.
 *
 * Returning `false` when an accessor is missing is a deliberate
 * conservative choice: it makes forward-direction checks fail-closed for
 * paths the consumer didn't fully wire. The consumer can either:
 *   • supply accessors so eager-loaded relations resolve in-memory, or
 *   • rely on `accessibleBy()` (Phase 3) which generates SQL and never
 *     needs accessors.
 */
export function evaluateRelatedTo(
  subject: unknown,
  condition: RelatedToCondition,
  graph: RelationshipGraph,
): boolean {
  const path = graph.resolvePath(condition.path);

  let frontier: readonly unknown[] = [subject];

  for (const hop of path.hops) {
    if (!hop.accessor) return false;
    const next: unknown[] = [];
    for (const node of frontier) {
      const result = hop.accessor(node);
      if (result === undefined || result === null) continue;
      if (Array.isArray(result)) {
        for (const item of result) {
          if (item !== undefined && item !== null) next.push(item);
        }
      } else {
        next.push(result);
      }
    }
    if (next.length === 0) return false;
    frontier = next;
  }

  const leafMatcher = mongoQueryMatcher(condition.where as MongoQuery);
  return frontier.some((node) => leafMatcher(node as Record<string, unknown>));
}
