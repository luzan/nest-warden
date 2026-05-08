import {
  DuplicateRelationshipError,
  InvalidRelationshipPathError,
  RelationshipDepthExceededError,
  RelationshipNotDefinedError,
} from '../errors.js';
import type { Relationship, RelationshipPath } from './definition.js';

/** Default cap on path length to prevent pathological multi-hop joins. */
export const DEFAULT_MAX_DEPTH = 5;

/**
 * Options for {@link RelationshipGraph.path}.
 */
export interface PathOptions {
  /** Maximum number of hops to consider. Default: {@link DEFAULT_MAX_DEPTH}. */
  readonly maxDepth?: number;
  /**
   * If `true`, throws {@link RelationshipDepthExceededError} when no path
   * is found within `maxDepth`. If `false` (default), returns `null` for
   * "no path found." The throwing form is useful in build-time validation
   * where missing paths are a hard error.
   */
  readonly throwOnMissing?: boolean;
}

/**
 * Registry of named relationships plus a BFS path resolver.
 *
 * The graph models the application's data shape: each `Relationship`
 * declares an edge between two subject types, and the graph answers
 * "what's the shortest path from type A to type B?" as a sequence of
 * relationship hops. Paths are cached per (`from`, `to`, `maxDepth`)
 * triple to avoid re-walking on every request.
 *
 * The graph is **directed** — `agent_of_merchant` (Agent → Merchant) is a
 * different edge from `merchant_of_agent` (Merchant → Agent). Define both
 * if you need to traverse in either direction.
 *
 * @example
 *   const graph = new RelationshipGraph();
 *   graph
 *     .define({ name: 'merchant_of_payment', from: 'Payment', to: 'Merchant',
 *               resolver: foreignKey({ fromColumn: 'merchant_id' }) })
 *     .define({ name: 'agent_of_merchant', from: 'Merchant', to: 'Agent',
 *               resolver: foreignKey({ fromColumn: 'agent_id' }) });
 *
 *   const path = graph.path('Payment', 'Agent');
 *   // → { from: 'Payment', to: 'Agent', hops: [merchant_of_payment, agent_of_merchant] }
 */
export class RelationshipGraph {
  private readonly relationships = new Map<string, Relationship>();
  /** subject-type → set of outgoing relationship names. */
  private readonly outgoing = new Map<string, Set<string>>();
  /** memoized path lookups keyed by `from→to:maxDepth`. */
  private readonly pathCache = new Map<string, RelationshipPath | null>();

  /**
   * Register a new relationship. Throws {@link DuplicateRelationshipError}
   * if a relationship with the same name already exists.
   *
   * Returns `this` for fluent chaining.
   */
  define(rel: Relationship): this {
    if (this.relationships.has(rel.name)) {
      throw new DuplicateRelationshipError(rel.name);
    }
    this.relationships.set(rel.name, rel);
    let outgoing = this.outgoing.get(rel.from);
    if (!outgoing) {
      outgoing = new Set();
      this.outgoing.set(rel.from, outgoing);
    }
    outgoing.add(rel.name);
    // Invalidate the path cache; new edges may shorten existing paths.
    this.pathCache.clear();
    return this;
  }

  /** Whether a relationship with the given name is registered. */
  has(name: string): boolean {
    return this.relationships.has(name);
  }

  /**
   * Look up a relationship by name.
   * @throws {@link RelationshipNotDefinedError} if no such relationship exists.
   */
  get(name: string): Relationship {
    const rel = this.relationships.get(name);
    if (!rel) throw new RelationshipNotDefinedError(name);
    return rel;
  }

  /** Read-only iterator over all registered relationships. */
  all(): readonly Relationship[] {
    return Array.from(this.relationships.values());
  }

  /**
   * Find the shortest sequence of relationship hops connecting `from` to
   * `to`. Returns `null` (or throws, see {@link PathOptions.throwOnMissing})
   * if no path exists within `maxDepth`.
   *
   * The implementation is breadth-first, so the first path found is the
   * shortest. Cycles are naturally handled by tracking visited subject
   * types; revisiting a type is rejected (BFS guarantees the first visit
   * was the shortest).
   *
   * Result is memoized per (`from`, `to`, `maxDepth`) triple. Calling
   * {@link RelationshipGraph.define} clears the cache.
   */
  path(from: string, to: string, options: PathOptions = {}): RelationshipPath | null {
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const throwOnMissing = options.throwOnMissing ?? false;
    const cacheKey = `${from}→${to}:${String(maxDepth)}`;

    if (this.pathCache.has(cacheKey)) {
      const cached = this.pathCache.get(cacheKey) ?? null;
      if (cached === null && throwOnMissing) {
        throw new RelationshipDepthExceededError(from, to, maxDepth);
      }
      return cached;
    }

    const result = this.bfs(from, to, maxDepth);
    this.pathCache.set(cacheKey, result);
    if (result === null && throwOnMissing) {
      throw new RelationshipDepthExceededError(from, to, maxDepth);
    }
    return result;
  }

  /**
   * Resolve a hand-specified sequence of relationship names into a
   * fully-typed {@link RelationshipPath}.
   *
   * Validates that:
   *   - every name is registered (throws {@link RelationshipNotDefinedError})
   *   - consecutive hops chain correctly: `hops[i].to === hops[i+1].from`
   *     (throws {@link InvalidRelationshipPathError})
   *
   * This is the form used by `$relatedTo` operators, which name their
   * path explicitly rather than asking the graph to compute it.
   */
  resolvePath(names: readonly string[]): RelationshipPath {
    if (names.length === 0) {
      throw new InvalidRelationshipPathError(names, 'path is empty');
    }

    const hops: Relationship[] = [];
    let expectedFrom: string | undefined;

    for (const name of names) {
      const rel = this.relationships.get(name);
      if (!rel) throw new RelationshipNotDefinedError(name);
      if (expectedFrom !== undefined && rel.from !== expectedFrom) {
        throw new InvalidRelationshipPathError(
          names,
          `hop "${name}" starts at "${rel.from}" but the previous hop ended at "${expectedFrom}"`,
        );
      }
      hops.push(rel);
      expectedFrom = rel.to;
    }

    // Safe: we just pushed at least one hop into `hops` (the empty-path case
    // is rejected at the top of this method) so [0] and [length - 1] are
    // both defined.
    const first = hops[0] as Relationship;
    const last = hops[hops.length - 1] as Relationship;
    return { from: first.from, to: last.to, hops };
  }

  // ---- internals --------------------------------------------------------

  private bfs(from: string, to: string, maxDepth: number): RelationshipPath | null {
    if (from === to) {
      // A subject type is trivially reachable from itself in 0 hops.
      return { from, to, hops: [] };
    }

    interface QueueItem {
      readonly node: string;
      readonly hops: readonly Relationship[];
    }

    const queue: QueueItem[] = [{ node: from, hops: [] }];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const item = queue.shift();
      /* c8 ignore next */
      if (!item) break; // unreachable: queue.length > 0 above
      if (item.hops.length >= maxDepth) continue;

      const outNames = this.outgoing.get(item.node);
      if (!outNames) continue;

      for (const name of outNames) {
        const rel = this.relationships.get(name);
        /* c8 ignore next */
        if (!rel) continue; // unreachable: outgoing[name] is only set alongside relationships[name]
        if (visited.has(rel.to)) continue;
        const nextHops: readonly Relationship[] = [...item.hops, rel];
        if (rel.to === to) {
          return { from, to, hops: nextHops };
        }
        visited.add(rel.to);
        queue.push({ node: rel.to, hops: nextHops });
      }
    }

    return null;
  }
}
