import { UnsupportedOperatorError } from '../../core/errors.js';
import type { ParameterBag } from './parameter-bag.js';
import { fragment, type SqlFragment } from './sql-fragment.js';

/**
 * Set of MongoDB-style operators the v1 TypeORM compiler understands.
 *
 * The list is intentionally narrow: the goal is "everything CASL users
 * commonly write today" plus our own `$relatedTo`. Operators not on this
 * list throw {@link UnsupportedOperatorError} at compile time — explicit
 * failure beats the silent dropping that bites consumers with hand-rolled
 * condition translators.
 */
export const SUPPORTED_FIELD_OPERATORS = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'nin',
] as const;

export type SupportedFieldOperator = (typeof SUPPORTED_FIELD_OPERATORS)[number];

/**
 * Compile a {@link SupportedFieldOperator} applied to `column` against
 * `value` into a parameterized SQL fragment.
 *
 * @param column   Fully-qualified column reference (e.g., `"m"."status"`).
 *                 Caller is responsible for quoting/aliasing.
 * @param operator The Mongo-style operator (without the `$` prefix in
 *                 ucast's normalized form — `eq`, `in`, etc.).
 * @param value    The right-hand-side value. Arrays are required for
 *                 `in` / `nin`; scalar otherwise. Nullability is honored
 *                 (`null` triggers `IS NULL` / `IS NOT NULL`).
 * @param bag      Parameter allocator; mutated to bind the value.
 * @throws {@link UnsupportedOperatorError} for any operator not in
 *         {@link SUPPORTED_FIELD_OPERATORS}.
 */
export function compileFieldOperator(
  column: string,
  operator: string,
  value: unknown,
  bag: ParameterBag,
): SqlFragment {
  const emit = (sqlOp: string): SqlFragment => {
    const { placeholder, name } = bag.allocate(value);
    return fragment(`${column} ${sqlOp} ${placeholder}`, { [name]: value });
  };

  switch (operator) {
    case 'eq':
      // `null` requires the IS-NULL form because `column = NULL` is
      // always FALSE in three-valued SQL logic.
      if (value === null) return fragment(`${column} IS NULL`);
      return emit('=');

    case 'ne':
      if (value === null) return fragment(`${column} IS NOT NULL`);
      return emit('<>');

    case 'lt':
      return emit('<');
    case 'lte':
      return emit('<=');
    case 'gt':
      return emit('>');
    case 'gte':
      return emit('>=');

    case 'in': {
      assertArray(value, '$in');
      if (value.length === 0) return fragment('1 = 0'); // empty IN matches nothing
      const { placeholder, name } = bag.allocate(value);
      return fragment(`${column} IN (${placeholder})`, { [name]: value });
    }

    case 'nin': {
      assertArray(value, '$nin');
      // Empty NIN matches everything, but we still need a fragment that
      // composes correctly with AND — emit a tautology.
      if (value.length === 0) return fragment('1 = 1');
      const { placeholder, name } = bag.allocate(value);
      return fragment(`${column} NOT IN (${placeholder})`, { [name]: value });
    }

    default:
      throw new UnsupportedOperatorError(`$${operator}`);
  }
}

function assertArray(value: unknown, op: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${op} expects an array operand; got ${typeof value === 'object' ? 'object' : typeof value}.`,
    );
  }
}
