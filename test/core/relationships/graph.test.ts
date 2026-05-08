import { describe, expect, it } from 'vitest';
import { foreignKey, joinTable } from '../../../src/core/relationships/resolver.js';
import { DEFAULT_MAX_DEPTH, RelationshipGraph } from '../../../src/core/relationships/graph.js';
import {
  DuplicateRelationshipError,
  InvalidRelationshipPathError,
  RelationshipDepthExceededError,
  RelationshipNotDefinedError,
} from '../../../src/core/errors.js';
import type { Relationship } from '../../../src/core/relationships/definition.js';

const fk = (fromColumn: string) => foreignKey({ fromColumn });

const buildSampleGraph = (): RelationshipGraph =>
  new RelationshipGraph()
    .define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: fk('merchant_id'),
    })
    .define({
      name: 'agent_of_merchant',
      from: 'Merchant',
      to: 'Agent',
      resolver: joinTable({
        table: 'agent_merchant_assignments',
        fromKey: 'merchant_id',
        toKey: 'agent_id',
      }),
    })
    .define({
      name: 'iso_of_agent',
      from: 'Agent',
      to: 'ISO',
      resolver: fk('iso_id'),
    });

describe('RelationshipGraph — define / has / get', () => {
  it('registers and looks up a relationship by name', () => {
    const g = new RelationshipGraph();
    g.define({ name: 'a_to_b', from: 'A', to: 'B', resolver: fk('b_id') });
    expect(g.has('a_to_b')).toBe(true);
    expect(g.get('a_to_b').from).toBe('A');
  });

  it('returns false from has() for unregistered names', () => {
    expect(new RelationshipGraph().has('nope')).toBe(false);
  });

  it('throws RelationshipNotDefinedError when getting an unknown name', () => {
    expect(() => new RelationshipGraph().get('nope')).toThrow(RelationshipNotDefinedError);
  });

  it('rejects duplicate relationship names', () => {
    const g = new RelationshipGraph();
    g.define({ name: 'dup', from: 'A', to: 'B', resolver: fk('b_id') });
    expect(() => g.define({ name: 'dup', from: 'A', to: 'C', resolver: fk('c_id') })).toThrow(
      DuplicateRelationshipError,
    );
  });

  it('all() returns all registered relationships', () => {
    const g = buildSampleGraph();
    expect(g.all()).toHaveLength(3);
    expect(
      g
        .all()
        .map((r) => r.name)
        .sort(),
    ).toEqual(['agent_of_merchant', 'iso_of_agent', 'merchant_of_payment']);
  });

  it('define() returns the graph for fluent chaining', () => {
    const g = new RelationshipGraph();
    const ret = g.define({ name: 'a', from: 'A', to: 'B', resolver: fk('b_id') });
    expect(ret).toBe(g);
  });
});

describe('RelationshipGraph — path() (BFS)', () => {
  it('returns a 0-hop path when from === to', () => {
    const g = new RelationshipGraph();
    const p = g.path('Merchant', 'Merchant');
    expect(p).toEqual({ from: 'Merchant', to: 'Merchant', hops: [] });
  });

  it('finds a single-hop path', () => {
    const g = buildSampleGraph();
    const p = g.path('Payment', 'Merchant');
    expect(p?.hops.map((h) => h.name)).toEqual(['merchant_of_payment']);
  });

  it('finds a multi-hop shortest path', () => {
    const g = buildSampleGraph();
    const p = g.path('Payment', 'ISO');
    expect(p?.hops.map((h) => h.name)).toEqual([
      'merchant_of_payment',
      'agent_of_merchant',
      'iso_of_agent',
    ]);
  });

  it('returns null when no path exists', () => {
    const g = buildSampleGraph();
    expect(g.path('ISO', 'Payment')).toBeNull();
  });

  it('returns null when no path is reachable', () => {
    const g = new RelationshipGraph().define({
      name: 'unrelated',
      from: 'X',
      to: 'Y',
      resolver: fk('y_id'),
    });
    expect(g.path('A', 'B')).toBeNull();
  });

  it('respects an explicit maxDepth limit', () => {
    const g = buildSampleGraph();
    expect(g.path('Payment', 'ISO', { maxDepth: 2 })).toBeNull();
    expect(g.path('Payment', 'ISO', { maxDepth: 3 })?.hops).toHaveLength(3);
  });

  it('uses DEFAULT_MAX_DEPTH when maxDepth is omitted', () => {
    expect(DEFAULT_MAX_DEPTH).toBe(5);
  });

  it('memoizes path lookups (second call returns the same instance)', () => {
    const g = buildSampleGraph();
    const a = g.path('Payment', 'Merchant');
    const b = g.path('Payment', 'Merchant');
    expect(a).toBe(b);
  });

  it('memoizes per-maxDepth (different keys, possibly different results)', () => {
    const g = buildSampleGraph();
    const shallow = g.path('Payment', 'ISO', { maxDepth: 2 });
    const deep = g.path('Payment', 'ISO', { maxDepth: 5 });
    expect(shallow).toBeNull();
    expect(deep?.hops).toHaveLength(3);
  });

  it('clears the cache when define() adds a new relationship', () => {
    const g = new RelationshipGraph();
    expect(g.path('A', 'B')).toBeNull();
    g.define({ name: 'a_to_b', from: 'A', to: 'B', resolver: fk('b_id') });
    expect(g.path('A', 'B')?.hops).toHaveLength(1);
  });

  it('throws RelationshipDepthExceededError when throwOnMissing is set', () => {
    const g = buildSampleGraph();
    expect(() => g.path('Payment', 'ISO', { maxDepth: 1, throwOnMissing: true })).toThrow(
      RelationshipDepthExceededError,
    );
  });

  it('throwOnMissing applies to cached null results too', () => {
    const g = buildSampleGraph();
    expect(g.path('Payment', 'ISO', { maxDepth: 1 })).toBeNull(); // populates cache
    expect(() => g.path('Payment', 'ISO', { maxDepth: 1, throwOnMissing: true })).toThrow(
      RelationshipDepthExceededError,
    );
  });

  it('does not revisit subject types (cycle-safe)', () => {
    // A → B → A → B → ... could loop forever without visited tracking.
    const g = new RelationshipGraph()
      .define({ name: 'a_to_b', from: 'A', to: 'B', resolver: fk('b_id') })
      .define({ name: 'b_to_a', from: 'B', to: 'A', resolver: fk('a_id') })
      .define({ name: 'a_to_c', from: 'A', to: 'C', resolver: fk('c_id') });
    const p = g.path('B', 'C');
    expect(p?.hops.map((h) => h.name)).toEqual(['b_to_a', 'a_to_c']);
  });
});

describe('RelationshipGraph — resolvePath()', () => {
  it('resolves a valid sequence of named hops', () => {
    const g = buildSampleGraph();
    const p = g.resolvePath(['merchant_of_payment', 'agent_of_merchant']);
    expect(p.from).toBe('Payment');
    expect(p.to).toBe('Agent');
    expect(p.hops).toHaveLength(2);
  });

  it('resolves a single-hop path', () => {
    const g = buildSampleGraph();
    const p = g.resolvePath(['merchant_of_payment']);
    expect(p.hops.map((h) => h.name)).toEqual(['merchant_of_payment']);
  });

  it('throws when an empty path is given', () => {
    const g = new RelationshipGraph();
    expect(() => g.resolvePath([])).toThrow(InvalidRelationshipPathError);
  });

  it('throws RelationshipNotDefinedError on an unknown relationship name', () => {
    const g = buildSampleGraph();
    expect(() => g.resolvePath(['merchant_of_payment', 'mystery_hop'])).toThrow(
      RelationshipNotDefinedError,
    );
  });

  it('throws InvalidRelationshipPathError when consecutive hops do not chain', () => {
    const g = buildSampleGraph();
    // merchant_of_payment ends at Merchant; iso_of_agent starts at Agent — mismatched.
    expect(() => g.resolvePath(['merchant_of_payment', 'iso_of_agent'])).toThrow(
      InvalidRelationshipPathError,
    );
  });

  it('error message names the offending hops in the path', () => {
    const g = buildSampleGraph();
    try {
      g.resolvePath(['merchant_of_payment', 'iso_of_agent']);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('iso_of_agent');
      expect((err as Error).message).toContain('Merchant');
    }
  });

  it('preserves the order of hops in the result', () => {
    const g = buildSampleGraph();
    const p = g.resolvePath(['merchant_of_payment', 'agent_of_merchant', 'iso_of_agent']);
    expect(p.hops.map((h) => h.name)).toEqual([
      'merchant_of_payment',
      'agent_of_merchant',
      'iso_of_agent',
    ]);
  });

  it('declares accessor as optional in the type (sanity check)', () => {
    const rel: Relationship = {
      name: 'a',
      from: 'A',
      to: 'B',
      resolver: fk('b_id'),
    };
    expect(rel.accessor).toBeUndefined();
  });
});
