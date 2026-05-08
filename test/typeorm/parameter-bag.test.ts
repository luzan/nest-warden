import { describe, expect, it } from 'vitest';
import { ParameterBag } from '../../src/typeorm/compiler/parameter-bag.js';

describe('ParameterBag', () => {
  it('allocates sequential placeholders with the default prefix', () => {
    const bag = new ParameterBag();
    expect(bag.next('a')).toBe(':mtc_0');
    expect(bag.next('b')).toBe(':mtc_1');
    expect(bag.next('c')).toBe(':mtc_2');
  });

  it('honors a custom prefix', () => {
    const bag = new ParameterBag('foo');
    expect(bag.next(1)).toBe(':foo_0');
    expect(bag.next(2)).toBe(':foo_1');
  });

  it('snapshot returns bound values keyed by name (without leading colon)', () => {
    const bag = new ParameterBag();
    bag.next('alice');
    bag.next(42);
    expect(bag.snapshot()).toEqual({ mtc_0: 'alice', mtc_1: 42 });
  });

  it('snapshot is a defensive copy', () => {
    const bag = new ParameterBag();
    bag.next('a');
    const snap = bag.snapshot() as Record<string, unknown>;
    snap.injected = 'x';
    expect(bag.snapshot()).toEqual({ mtc_0: 'a' });
  });

  it('rejects an invalid prefix at construction', () => {
    expect(() => new ParameterBag('1bad')).toThrow();
    expect(() => new ParameterBag('with space')).toThrow();
    expect(() => new ParameterBag('semi;colon')).toThrow();
  });

  it('accepts valid identifier-like prefixes', () => {
    expect(() => new ParameterBag('valid_prefix')).not.toThrow();
    expect(() => new ParameterBag('_underscore')).not.toThrow();
    expect(() => new ParameterBag('CamelCase42')).not.toThrow();
  });
});
