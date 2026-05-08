import { describe, expect, it } from 'vitest';
import { evaluateRelatedTo } from '../../../src/core/relationships/related-to-operator.js';
import { RelationshipGraph } from '../../../src/core/relationships/graph.js';
import { foreignKey, joinTable } from '../../../src/core/relationships/resolver.js';

interface Agent {
  id: string;
  name: string;
}
interface Merchant {
  id: string;
  // Allow sparse entries (null/undefined) to exercise the matcher's
  // skip-empties path; the in-memory accessor returns this verbatim.
  agents?: Array<Agent | null | undefined>;
}
interface Payment {
  id: string;
  merchant?: Merchant | null;
}

const buildGraph = (): RelationshipGraph =>
  new RelationshipGraph()
    .define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: foreignKey({ fromColumn: 'merchant_id' }),
      accessor: (p) => (p as Payment).merchant,
    })
    .define({
      name: 'agents_of_merchant',
      from: 'Merchant',
      to: 'Agent',
      resolver: joinTable({
        table: 'agent_merchant_assignments',
        fromKey: 'merchant_id',
        toKey: 'agent_id',
      }),
      accessor: (m) => (m as Merchant).agents,
    });

describe('evaluateRelatedTo — forward-direction $relatedTo', () => {
  it('matches when a single-hop path leads to a leaf satisfying the where', () => {
    const g = buildGraph();
    const payment: Payment = { id: 'p1', merchant: { id: 'm1' } };
    expect(
      evaluateRelatedTo(payment, { path: ['merchant_of_payment'], where: { id: 'm1' } }, g),
    ).toBe(true);
  });

  it('returns false when single-hop leaf does not match where', () => {
    const g = buildGraph();
    const payment: Payment = { id: 'p1', merchant: { id: 'm1' } };
    expect(
      evaluateRelatedTo(payment, { path: ['merchant_of_payment'], where: { id: 'm2' } }, g),
    ).toBe(false);
  });

  it('matches across a multi-hop path with array fan-out', () => {
    const g = buildGraph();
    const payment: Payment = {
      id: 'p1',
      merchant: {
        id: 'm1',
        agents: [
          { id: 'a1', name: 'Alice' },
          { id: 'a2', name: 'Bob' },
        ],
      },
    };
    expect(
      evaluateRelatedTo(
        payment,
        { path: ['merchant_of_payment', 'agents_of_merchant'], where: { id: 'a2' } },
        g,
      ),
    ).toBe(true);
  });

  it('returns false when the leaf where excludes all fan-out items', () => {
    const g = buildGraph();
    const payment: Payment = {
      id: 'p1',
      merchant: { id: 'm1', agents: [{ id: 'a1', name: 'Alice' }] },
    };
    expect(
      evaluateRelatedTo(
        payment,
        { path: ['merchant_of_payment', 'agents_of_merchant'], where: { id: 'a99' } },
        g,
      ),
    ).toBe(false);
  });

  it('returns false when an intermediate hop yields undefined (path collapses)', () => {
    const g = buildGraph();
    const payment: Payment = { id: 'p1', merchant: undefined };
    expect(
      evaluateRelatedTo(
        payment,
        { path: ['merchant_of_payment', 'agents_of_merchant'], where: { id: 'a1' } },
        g,
      ),
    ).toBe(false);
  });

  it('returns false when a hop yields null (treats as missing)', () => {
    const g = buildGraph();
    const payment: Payment = { id: 'p1', merchant: null };
    expect(
      evaluateRelatedTo(payment, { path: ['merchant_of_payment'], where: { id: 'm1' } }, g),
    ).toBe(false);
  });

  it('skips null/undefined items inside an array result', () => {
    const g = buildGraph();
    // Merchant.agents includes a sparse element — we want it ignored, not crashed-on.
    const payment: Payment = {
      id: 'p1',
      merchant: {
        id: 'm1',
        agents: [null, { id: 'a1', name: 'Alice' }, undefined],
      },
    };
    expect(
      evaluateRelatedTo(
        payment,
        { path: ['merchant_of_payment', 'agents_of_merchant'], where: { id: 'a1' } },
        g,
      ),
    ).toBe(true);
  });

  it('returns false (not throw) when a hop has no accessor (forward eval cannot proceed)', () => {
    const g = new RelationshipGraph().define({
      name: 'no_accessor',
      from: 'A',
      to: 'B',
      resolver: foreignKey({ fromColumn: 'b_id' }),
      // accessor intentionally omitted
    });
    expect(evaluateRelatedTo({ id: 'a1' }, { path: ['no_accessor'], where: { id: 'b1' } }, g)).toBe(
      false,
    );
  });

  it('honors mongo operators in the leaf where', () => {
    const g = buildGraph();
    const payment: Payment = {
      id: 'p1',
      merchant: {
        id: 'm1',
        agents: [
          { id: 'a1', name: 'Alice' },
          { id: 'a2', name: 'Bob' },
        ],
      },
    };
    expect(
      evaluateRelatedTo(
        payment,
        {
          path: ['merchant_of_payment', 'agents_of_merchant'],
          where: { id: { $in: ['a2', 'a3'] } },
        },
        g,
      ),
    ).toBe(true);
  });

  it('returns false when the path resolves but the frontier is empty after a hop', () => {
    const g = buildGraph();
    const payment: Payment = {
      id: 'p1',
      merchant: { id: 'm1', agents: [] },
    };
    expect(
      evaluateRelatedTo(
        payment,
        { path: ['merchant_of_payment', 'agents_of_merchant'], where: { id: 'a1' } },
        g,
      ),
    ).toBe(false);
  });
});
