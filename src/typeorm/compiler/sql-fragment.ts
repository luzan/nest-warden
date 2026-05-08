/**
 * A piece of parameterized SQL produced by the TypeORM compiler.
 *
 * `sql` is a WHERE-clause fragment using TypeORM's `:name` parameter
 * placeholders. `params` carries the values referenced by those names.
 *
 * Fragments are immutable; combining them produces a new fragment whose
 * `params` is the merged map of the inputs. Parameter names are unique
 * across an entire compilation pass thanks to {@link ParameterBag}.
 *
 * The empty fragment (an SQL string of `''` and no params) represents
 * "no constraint" — used by `rulesToCondition`'s `empty()` hook to
 * indicate an unconditional `can` rule.
 */
export interface SqlFragment {
  readonly sql: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** A fragment that adds no constraint (matches everything). */
export const EMPTY_FRAGMENT: SqlFragment = { sql: '', params: {} };

/** Construct a fragment with safe defaults. */
export function fragment(sql: string, params: Record<string, unknown> = {}): SqlFragment {
  return { sql, params };
}

/**
 * Combine an array of fragments with `AND` or `OR`, parenthesizing each
 * non-empty fragment so operator precedence is preserved.
 *
 * Empty fragments are filtered out (an empty fragment in an AND list is a
 * no-op; an empty fragment in an OR list collapses the OR to "true").
 *
 * If all fragments are empty, the result is the empty fragment.
 *
 * @internal Used by the AST walker and `rulesToCondition` aggregation hooks.
 */
export function combineFragments(
  fragments: readonly SqlFragment[],
  operator: 'AND' | 'OR',
): SqlFragment {
  // OR-with-empty: `X OR (no restriction)` is "no restriction." This
  // check must come BEFORE the single-element optimization so the
  // unconditional branch wins. AND-with-empty is the opposite — empty
  // operands are no-ops and can be filtered out.
  if (operator === 'OR' && fragments.some((f) => f.sql.length === 0)) {
    return EMPTY_FRAGMENT;
  }

  const non = fragments.filter((f) => f.sql.length > 0);
  if (non.length === 0) return EMPTY_FRAGMENT;
  if (non.length === 1) {
    // Safe: filter() returned exactly one element so [0] is defined.
    return non[0] as SqlFragment;
  }

  const sql = non.map((f) => `(${f.sql})`).join(` ${operator} `);
  return { sql, params: mergeParams(non.map((f) => f.params)) };
}

/** Wrap a fragment in `NOT (...)`. */
export function negateFragment(f: SqlFragment): SqlFragment {
  if (f.sql.length === 0) {
    // NOT of "no constraint" should logically be "match nothing." Use a
    // tautological-false fragment to prevent the NOT from being elided.
    return { sql: '1 = 0', params: {} };
  }
  return { sql: `NOT (${f.sql})`, params: f.params };
}

/** Merge multiple parameter maps; later keys win on collision. */
export function mergeParams(
  bags: ReadonlyArray<Readonly<Record<string, unknown>>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const bag of bags) {
    Object.assign(out, bag);
  }
  return out;
}
