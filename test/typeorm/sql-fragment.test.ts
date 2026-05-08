import { describe, expect, it } from 'vitest';
import {
  combineFragments,
  EMPTY_FRAGMENT,
  fragment,
  mergeParams,
  negateFragment,
} from '../../src/typeorm/compiler/sql-fragment.js';

describe('SqlFragment helpers', () => {
  it('fragment() builds with default empty params', () => {
    const f = fragment('a = 1');
    expect(f).toEqual({ sql: 'a = 1', params: {} });
  });

  it('fragment() accepts explicit params', () => {
    const f = fragment('a = :p', { p: 1 });
    expect(f.params).toEqual({ p: 1 });
  });

  it('EMPTY_FRAGMENT has empty sql and params', () => {
    expect(EMPTY_FRAGMENT.sql).toBe('');
    expect(EMPTY_FRAGMENT.params).toEqual({});
  });

  describe('combineFragments', () => {
    it('AND of two fragments parenthesizes both', () => {
      const r = combineFragments([fragment('a'), fragment('b')], 'AND');
      expect(r.sql).toBe('(a) AND (b)');
    });

    it('OR of two fragments parenthesizes both', () => {
      const r = combineFragments([fragment('a'), fragment('b')], 'OR');
      expect(r.sql).toBe('(a) OR (b)');
    });

    it('a single fragment is returned unwrapped', () => {
      const inner = fragment('a');
      expect(combineFragments([inner], 'AND')).toBe(inner);
    });

    it('an empty array returns EMPTY_FRAGMENT', () => {
      expect(combineFragments([], 'AND')).toBe(EMPTY_FRAGMENT);
      expect(combineFragments([], 'OR')).toBe(EMPTY_FRAGMENT);
    });

    it('AND with one empty fragment skips it', () => {
      const r = combineFragments([fragment('a'), EMPTY_FRAGMENT, fragment('b')], 'AND');
      expect(r.sql).toBe('(a) AND (b)');
    });

    it('OR with any empty fragment short-circuits to EMPTY (no restriction)', () => {
      const r = combineFragments([fragment('a'), EMPTY_FRAGMENT], 'OR');
      expect(r).toBe(EMPTY_FRAGMENT);
    });

    it('merges params across all combined fragments', () => {
      const r = combineFragments(
        [fragment('a = :p1', { p1: 1 }), fragment('b = :p2', { p2: 2 })],
        'AND',
      );
      expect(r.params).toEqual({ p1: 1, p2: 2 });
    });
  });

  describe('negateFragment', () => {
    it('wraps a non-empty fragment in NOT(...)', () => {
      const r = negateFragment(fragment('a = 1', { p: 1 }));
      expect(r.sql).toBe('NOT (a = 1)');
      expect(r.params).toEqual({ p: 1 });
    });

    it('NOT of EMPTY_FRAGMENT is the false-tautology (matches nothing)', () => {
      const r = negateFragment(EMPTY_FRAGMENT);
      expect(r.sql).toBe('1 = 0');
    });
  });

  describe('mergeParams', () => {
    it('merges multiple bags; later wins on collision', () => {
      const r = mergeParams([
        { a: 1, b: 2 },
        { b: 3, c: 4 },
      ]);
      expect(r).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('handles empty input', () => {
      expect(mergeParams([])).toEqual({});
    });
  });
});
