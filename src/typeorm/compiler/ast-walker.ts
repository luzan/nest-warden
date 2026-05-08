import type { Condition } from '@ucast/core';
import { CompoundCondition, FieldCondition } from '@ucast/core';
import { UnsupportedOperatorError } from '../../core/errors.js';
import type { RelationshipGraph } from '../../core/relationships/graph.js';
import { compileFieldOperator } from './operators.js';
import type { ParameterBag } from './parameter-bag.js';
import {
  combineFragments,
  EMPTY_FRAGMENT,
  fragment,
  negateFragment,
  type SqlFragment,
} from './sql-fragment.js';
import { compileRelatedTo } from './related-to.js';

/**
 * Compilation context shared across one rule's AST walk.
 *
 * Every fragment emitted during a single walk pulls parameter names from
 * the same {@link ParameterBag} so collisions across nested operators are
 * impossible.
 */
export interface CompileContext {
  /** Alias of the root table being filtered (e.g., `"m"`). */
  readonly alias: string;
  /** Parameter allocator for this compilation pass. */
  readonly bag: ParameterBag;
  /** Optional graph; required only when rules use `$relatedTo`. */
  readonly graph?: RelationshipGraph;
}

/**
 * Compound operators understood by the walker. We deliberately do NOT
 * support `nor`: it composes as `not + or`, and the `not` form is
 * sufficient.
 */
const COMPOUND_OPS = new Set(['and', 'or', 'not']);

/**
 * Walk a ucast {@link Condition} tree and emit a parameterized
 * {@link SqlFragment}.
 *
 * Conditions come from `Rule.ast` (set by CASL's `mongoQueryMatcher`),
 * which yields a normalized AST: scalar `{ field: value }` becomes a
 * `FieldCondition` with operator `eq`, operator-form `{ field: { $op: v } }`
 * becomes a `FieldCondition` with operator `op`, and `$and`/`$or`/`$not`
 * become `CompoundCondition`s.
 *
 * Throws {@link UnsupportedOperatorError} for any operator outside our
 * v1 set — see {@link compileFieldOperator} and `$relatedTo`.
 */
export function compileCondition(condition: Condition, ctx: CompileContext): SqlFragment {
  if (condition instanceof FieldCondition) {
    return compileFieldCondition(condition, ctx);
  }
  if (condition instanceof CompoundCondition) {
    return compileCompound(condition as CompoundCondition<Condition>, ctx);
  }
  /* c8 ignore start */
  // Defensive: mongo2js could in principle emit a top-level DocumentCondition
  // for unrecognized operators. CASL's current parser routes `$relatedTo`
  // through the FieldCondition path (handled in compileFieldCondition); this
  // branch exists only as a forward-compat catch-all for future ucast
  // versions that may emit DocumentConditions for operator-keyed top-level
  // entries.
  if (condition.operator === '$relatedTo' || condition.operator === 'relatedTo') {
    if (!ctx.graph) {
      throw new Error(
        '$relatedTo encountered in a rule but no RelationshipGraph was provided to the compiler. ' +
          'Pass `graph` when creating accessibleBy(...).',
      );
    }
    return compileRelatedTo(condition.value as never, ctx);
  }
  /* c8 ignore stop */
  throw new UnsupportedOperatorError(`$${condition.operator}`);
}

function compileFieldCondition(c: FieldCondition, ctx: CompileContext): SqlFragment {
  // ucast preserves the `$relatedTo` operator at the field level when it
  // appears as an object property. Detect and route to the related-to
  // compiler.
  if (c.field === '$relatedTo' && (c.operator === 'eq' || c.operator === 'relatedTo')) {
    if (!ctx.graph) {
      throw new Error(
        '$relatedTo encountered in a rule but no RelationshipGraph was provided to the compiler. ' +
          'Pass `graph` when creating accessibleBy(...).',
      );
    }
    return compileRelatedTo(c.value as never, ctx);
  }

  const column = `${ctx.alias}.${c.field}`;
  return compileFieldOperator(column, c.operator, c.value, ctx.bag);
}

function compileCompound(c: CompoundCondition<Condition>, ctx: CompileContext): SqlFragment {
  if (!COMPOUND_OPS.has(c.operator)) {
    throw new UnsupportedOperatorError(`$${c.operator}`);
  }

  if (c.operator === 'not') {
    const inner = c.value;
    if (inner.length === 0) return EMPTY_FRAGMENT;
    const child = compileCondition(inner[0] as Condition, ctx);
    return negateFragment(child);
  }

  const children = c.value.map((sub) => compileCondition(sub, ctx));
  return combineFragments(children, c.operator === 'and' ? 'AND' : 'OR');
}

// Re-export for downstream API surface.
export { fragment, EMPTY_FRAGMENT };
