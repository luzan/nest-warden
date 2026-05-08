import { describe, expect, it } from 'vitest';
import { Ability } from '@casl/ability';
import { createTenantConditionsMatcher } from '../../../src/core/matcher.js';
import { RelationshipGraph } from '../../../src/core/relationships/graph.js';
import { foreignKey, joinTable } from '../../../src/core/relationships/resolver.js';

interface PaymentEager {
  merchant?: { id: string; agents?: Array<{ id: string }> };
}

const buildGraph = (): RelationshipGraph =>
  new RelationshipGraph()
    .define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: foreignKey({ fromColumn: 'merchant_id' }),
      accessor: (p) => (p as PaymentEager).merchant,
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
      accessor: (m) => (m as { agents?: Array<{ id: string }> }).agents,
    });

const tag = (kind: string, props: Record<string, unknown>) => ({
  ...props,
  __caslSubjectType__: kind,
});

describe('createTenantConditionsMatcher — end-to-end with @casl/ability', () => {
  it('returns mongoQueryMatcher when no graph is given', () => {
    const matcher = createTenantConditionsMatcher();
    const m = matcher({ status: 'active' });
    expect(m({ status: 'active' })).toBe(true);
    expect(m({ status: 'inactive' })).toBe(false);
  });

  it('matches a rule with $relatedTo when traversed in-memory', () => {
    const graph = buildGraph();
    const matcher = createTenantConditionsMatcher({ graph });

    const ability = new Ability(
      [
        {
          action: 'approve',
          subject: 'Payment',
          conditions: {
            $relatedTo: {
              path: ['merchant_of_payment', 'agents_of_merchant'],
              where: { id: 'alice' },
            },
          },
        } as any,
      ],
      { conditionsMatcher: matcher },
    );

    const matchingPayment = tag('Payment', {
      id: 'p1',
      merchant: { id: 'm1', agents: [{ id: 'alice' }] },
    });
    const nonMatchingPayment = tag('Payment', {
      id: 'p2',
      merchant: { id: 'm1', agents: [{ id: 'bob' }] },
    });

    expect(ability.can('approve', matchingPayment)).toBe(true);
    expect(ability.can('approve', nonMatchingPayment)).toBe(false);
  });

  it('combines $relatedTo with other top-level conditions (logical AND)', () => {
    const graph = buildGraph();
    const matcher = createTenantConditionsMatcher({ graph });

    const ability = new Ability(
      [
        {
          action: 'approve',
          subject: 'Payment',
          conditions: {
            tenantId: 't1',
            $relatedTo: {
              path: ['merchant_of_payment', 'agents_of_merchant'],
              where: { id: 'alice' },
            },
          },
        } as any,
      ],
      { conditionsMatcher: matcher },
    );

    const correctTenantCorrectAgent = tag('Payment', {
      id: 'p1',
      tenantId: 't1',
      merchant: { id: 'm1', agents: [{ id: 'alice' }] },
    });
    const wrongTenantCorrectAgent = tag('Payment', {
      id: 'p2',
      tenantId: 't2',
      merchant: { id: 'm1', agents: [{ id: 'alice' }] },
    });
    const correctTenantWrongAgent = tag('Payment', {
      id: 'p3',
      tenantId: 't1',
      merchant: { id: 'm1', agents: [{ id: 'bob' }] },
    });

    expect(ability.can('approve', correctTenantCorrectAgent)).toBe(true);
    expect(ability.can('approve', wrongTenantCorrectAgent)).toBe(false);
    expect(ability.can('approve', correctTenantWrongAgent)).toBe(false);
  });

  it('handles a $relatedTo-only rule with no other conditions', () => {
    const graph = buildGraph();
    const matcher = createTenantConditionsMatcher({ graph });

    const ability = new Ability(
      [
        {
          action: 'read',
          subject: 'Payment',
          conditions: {
            $relatedTo: {
              path: ['merchant_of_payment'],
              where: { id: 'm-allowed' },
            },
          },
        } as any,
      ],
      { conditionsMatcher: matcher },
    );

    expect(ability.can('read', tag('Payment', { id: 'p1', merchant: { id: 'm-allowed' } }))).toBe(
      true,
    );
    expect(ability.can('read', tag('Payment', { id: 'p2', merchant: { id: 'm-other' } }))).toBe(
      false,
    );
  });

  it('rules with no conditions are matched globally (CASL contract)', () => {
    // CASL's Rule never invokes the matcher when `conditions` is undefined —
    // the rule matches by default. This test exercises the no-conditions
    // path through a real ability instance.
    const graph = buildGraph();
    const matcher = createTenantConditionsMatcher({ graph });
    const ability = new Ability([{ action: 'read', subject: 'Merchant' }], {
      conditionsMatcher: matcher,
    });
    expect(ability.can('read', 'Merchant')).toBe(true);
  });

  it('returns a function regardless of conditions shape (graph-less behavior)', () => {
    const graph = buildGraph();
    const matcher = createTenantConditionsMatcher({ graph });
    const m = matcher({ status: 'active' });
    expect(typeof m).toBe('function');
  });
});
