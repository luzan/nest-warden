import type { AnyAbility } from '@casl/ability';
import { rulesToAST } from '@casl/ability/extra';
import type { RelationshipGraph } from '../core/relationships/graph.js';
import { compileCondition, type CompileContext } from './compiler/ast-walker.js';
import { ParameterBag } from './compiler/parameter-bag.js';
import { EMPTY_FRAGMENT, type SqlFragment } from './compiler/sql-fragment.js';

/**
 * Options accepted by {@link buildAccessibleSql} and {@link accessibleBy}.
 */
export interface AccessibleByOptions {
  /** Alias of the root entity in the consumer's QueryBuilder. */
  readonly alias: string;
  /**
   * Optional graph; required only if any rule uses `$relatedTo`. If
   * omitted and a rule references `$relatedTo`, the compiler throws.
   */
  readonly graph?: RelationshipGraph;
  /**
   * Optional namespace prefix for parameter names. Defaults to `mtc`.
   * Override this if your QueryBuilder already has parameters whose
   * names could clash (e.g., another instance of accessibleBy in the
   * same builder).
   */
  readonly parameterPrefix?: string;
}

/**
 * Compile every CASL rule for `(action, subjectType)` from the given
 * ability into a single parameterized SQL WHERE-clause fragment.
 *
 * The fragment can be applied to a TypeORM `QueryBuilder` via
 * `qb.andWhere(fragment.sql, fragment.params)`, or composed into a raw
 * SQL string for non-TypeORM consumers.
 *
 * **Empty / no-restriction cases.**
 *
 *   - No rules at all → `null` (caller must decide whether to allow or
 *     deny). Returning `null` rather than the empty fragment avoids
 *     ambiguity between "no rules → deny everything" and "an unconditional
 *     can rule → allow everything."
 *   - Unconditional `can` (no conditions) → empty fragment
 *     (caller should NOT add any WHERE constraint).
 *   - Mixed unconditional `can` plus higher-priority `cannot`s → emits
 *     just the `NOT (...)` constraints from the cannots.
 *
 * The flattening logic comes from CASL's own `rulesToCondition` helper,
 * which guarantees the same boolean semantics CASL uses at runtime —
 * critical for "in-memory `ability.can()` and SQL `accessibleBy` give
 * identical answers" (see Phase 3 verification test #6).
 *
 * @returns The compiled fragment, or `null` if no rule grants access.
 */
export function buildAccessibleSql(
  ability: AnyAbility,
  action: string,
  subjectType: string,
  options: AccessibleByOptions,
): SqlFragment | null {
  const rules = ability.rulesFor(action, subjectType);
  if (rules.length === 0) return null;

  // CASL flattens the rule list into a single AST that already encodes
  // boolean precedence (cannot rules wrapped in `not`, can rules combined
  // with `or`, etc.). We just walk the result.
  const ast = rulesToAST(ability, action, subjectType);
  if (ast === null) {
    // No applicable can rule survived the flattening — caller should
    // treat as "no access."
    return null;
  }

  const bag = new ParameterBag(options.parameterPrefix ?? 'mtc');
  const ctx: CompileContext = { alias: options.alias, bag, graph: options.graph };
  return compileCondition(ast, ctx);
}

/**
 * Sentinel return type — same shape and semantics as `@casl/prisma`'s
 * `accessibleBy()` for API familiarity. Carries the SQL fragment plus a
 * convenience `applyTo(qb)` that calls `qb.andWhere(...)`.
 *
 * The CASL parallel:
 *
 *   ```ts
 *   // CASL Prisma:
 *   const where = accessibleBy(ability).Merchant;
 *   prisma.merchant.findMany({ where });
 *
 *   // This library:
 *   const sql = accessibleBy(ability, 'read', 'Merchant', { alias: 'm' });
 *   sql.applyTo(qb);
 *   const merchants = await qb.getMany();
 *   ```
 */
export interface AccessibleBySql {
  /** Compiled fragment, or `null` when no rule grants access. */
  readonly sql: SqlFragment | null;
  /**
   * Apply the WHERE clause to a TypeORM QueryBuilder via `.andWhere(...)`.
   * Returns the builder for chaining.
   *
   * If the compiler returned `null` (no rule grants access), this method
   * applies a tautological-false WHERE (`1 = 0`) so the query returns no
   * rows — this is the safer default than silently bypassing the check.
   */
  applyTo<
    TBuilder extends { andWhere: (sql: string, params?: Record<string, unknown>) => TBuilder },
  >(
    qb: TBuilder,
  ): TBuilder;
}

/**
 * Compile the rules for `(action, subjectType)` and return an
 * {@link AccessibleBySql} bundle.
 *
 * @example
 *   const ability = builder.build();
 *   const acc = accessibleBy(ability, 'read', 'Merchant', { alias: 'm', graph });
 *   const qb = repo.createQueryBuilder('m');
 *   acc.applyTo(qb);
 *   const merchants = await qb.take(50).getMany();
 */
export function accessibleBy(
  ability: AnyAbility,
  action: string,
  subjectType: string,
  options: AccessibleByOptions,
): AccessibleBySql {
  const sql = buildAccessibleSql(ability, action, subjectType, options);
  return {
    sql,
    applyTo<
      TBuilder extends { andWhere: (sql: string, params?: Record<string, unknown>) => TBuilder },
    >(qb: TBuilder): TBuilder {
      if (!sql) {
        return qb.andWhere('1 = 0');
      }
      if (sql.sql.length === 0) {
        // Unconditional can — no WHERE needed.
        return qb;
      }
      return qb.andWhere(sql.sql, { ...sql.params });
    },
  };
}

// Re-export the unused-flagged ability type for consumers wiring custom
// helpers around accessibleBy().
export type { AnyAbility };
// Re-export EMPTY_FRAGMENT for consumers building their own fragment math.
export { EMPTY_FRAGMENT };
