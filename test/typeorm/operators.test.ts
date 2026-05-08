import { describe, expect, it } from 'vitest';
import { compileFieldOperator } from '../../src/typeorm/compiler/operators.js';
import { ParameterBag } from '../../src/typeorm/compiler/parameter-bag.js';
import { UnsupportedOperatorError } from '../../src/core/errors.js';

const bag = (): ParameterBag => new ParameterBag('p');

describe('compileFieldOperator', () => {
  it('eq with a scalar value emits "= :param"', () => {
    const f = compileFieldOperator('m.status', 'eq', 'active', bag());
    expect(f.sql).toBe('m.status = :p_0');
    expect(f.params).toEqual({ p_0: 'active' });
  });

  it('eq with null emits IS NULL (no param)', () => {
    const f = compileFieldOperator('m.deleted_at', 'eq', null, bag());
    expect(f.sql).toBe('m.deleted_at IS NULL');
    expect(f.params).toEqual({});
  });

  it('ne with a scalar emits "<> :param"', () => {
    const f = compileFieldOperator('m.status', 'ne', 'closed', bag());
    expect(f.sql).toBe('m.status <> :p_0');
  });

  it('ne with null emits IS NOT NULL', () => {
    const f = compileFieldOperator('m.deleted_at', 'ne', null, bag());
    expect(f.sql).toBe('m.deleted_at IS NOT NULL');
  });

  it.each([
    ['lt', '<'],
    ['lte', '<='],
    ['gt', '>'],
    ['gte', '>='],
  ])('comparison operator %s emits %s', (op, sqlOp) => {
    const f = compileFieldOperator('p.amount', op, 100, bag());
    expect(f.sql).toBe(`p.amount ${sqlOp} :p_0`);
    expect(f.params).toEqual({ p_0: 100 });
  });

  it('in with a non-empty array emits IN (...)', () => {
    const f = compileFieldOperator('m.status', 'in', ['active', 'pending'], bag());
    expect(f.sql).toBe('m.status IN (:p_0)');
    expect(f.params).toEqual({ p_0: ['active', 'pending'] });
  });

  it('in with an empty array emits the false-tautology', () => {
    const f = compileFieldOperator('m.status', 'in', [], bag());
    expect(f.sql).toBe('1 = 0');
    expect(f.params).toEqual({});
  });

  it('nin with a non-empty array emits NOT IN (...)', () => {
    const f = compileFieldOperator('m.status', 'nin', ['closed'], bag());
    expect(f.sql).toBe('m.status NOT IN (:p_0)');
  });

  it('nin with an empty array emits the true-tautology (matches all)', () => {
    const f = compileFieldOperator('m.status', 'nin', [], bag());
    expect(f.sql).toBe('1 = 1');
    expect(f.params).toEqual({});
  });

  it('throws TypeError when in receives a non-array (string)', () => {
    expect(() => compileFieldOperator('m.status', 'in', 'oops', bag())).toThrow(TypeError);
  });

  it('throws TypeError when nin receives a non-array (number)', () => {
    expect(() => compileFieldOperator('m.status', 'nin', 42, bag())).toThrow(TypeError);
  });

  it('error message reports "object" for non-array object operands', () => {
    expect(() => compileFieldOperator('m.x', 'in', { not: 'array' }, bag())).toThrow(
      /got object/,
    );
  });

  it('throws UnsupportedOperatorError for an unknown operator', () => {
    expect(() => compileFieldOperator('m.x', 'where', '...', bag())).toThrow(
      UnsupportedOperatorError,
    );
  });
});
