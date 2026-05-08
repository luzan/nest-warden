import { describe, expect, it } from 'vitest';
import { createMongoAbility } from '@casl/ability';
import { accessibleBy, buildAccessibleSql } from '../../src/typeorm/accessible-by.js';
import { TenantAbilityBuilder } from '../../src/core/tenant-ability.builder.js';
import type { TenantContext } from '../../src/core/tenant-context.js';
import { RelationshipGraph } from '../../src/core/relationships/graph.js';
import { foreignKey, joinTable } from '../../src/core/relationships/resolver.js';
import { UnsupportedOperatorError } from '../../src/core/errors.js';

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['agent'] };

describe('buildAccessibleSql — basic conditions', () => {
  it('returns null when there are no rules for (action, subject)', () => {
    const ability = createMongoAbility([]);
    expect(buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm' })).toBeNull();
  });

  it('compiles a single can rule with scalar conditions', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant');
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm' });
    expect(sql?.sql).toContain('m.tenantId');
    expect(sql?.sql).toContain(':');
    expect(Object.values(sql!.params)).toContain('t1');
  });

  it('compiles a rule with a $eq operator', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: { $eq: 'active' } });
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm' });
    expect(sql?.sql).toContain('m.status =');
    expect(sql?.sql).toContain('m.tenantId');
    expect(Object.values(sql!.params)).toEqual(expect.arrayContaining(['active', 't1']));
  });

  it('compiles a rule with $in', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: { $in: ['active', 'pending'] } });
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm' });
    expect(sql?.sql).toContain('m.status IN (');
  });

  it('compiles $gt / $lt operators', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('update', 'Payment', { amountCents: { $lt: 100_000 } });
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'update', 'Payment', { alias: 'p' });
    expect(sql?.sql).toContain('p.amountCents <');
  });

  it('combines multiple can rules with OR', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: 'active' });
    b.can('read', 'Merchant', { agentId: 'u1' });
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm' });
    expect(sql?.sql).toContain(' OR ');
  });

  it('emits NOT (...) for cannot rules', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('manage', 'Merchant');
    b.cannot('manage', 'Merchant', { status: 'closed' });
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'manage', 'Merchant', { alias: 'm' });
    expect(sql?.sql).toContain('NOT');
  });

  it('throws UnsupportedOperatorError for unsupported operators (e.g., $regex)', () => {
    const ability = createMongoAbility([
      { action: 'read', subject: 'Merchant', conditions: { name: { $regex: '^acme' } } },
    ]);
    expect(() => buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm' })).toThrow(
      UnsupportedOperatorError,
    );
  });

  it('uses the parameterPrefix option for parameter names', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: 'active' });
    const ability = b.build();

    const sql = buildAccessibleSql(ability, 'read', 'Merchant', {
      alias: 'm',
      parameterPrefix: 'auth',
    });
    expect(sql?.sql).toMatch(/:auth_\d/);
    expect(Object.keys(sql!.params).every((k) => k.startsWith('auth_'))).toBe(true);
  });
});

describe('accessibleBy — applyTo a fake QueryBuilder', () => {
  interface FakeQB {
    readonly calls: Array<{ sql: string; params?: Record<string, unknown> }>;
    andWhere: (sql: string, params?: Record<string, unknown>) => FakeQB;
  }

  const fakeQb = (): FakeQB => {
    const calls: FakeQB['calls'] = [];
    const qb: FakeQB = {
      calls,
      andWhere(sql, params) {
        calls.push({ sql, params });
        return qb;
      },
    };
    return qb;
  };

  it('applies the compiled fragment via andWhere when conditions exist', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant', { status: 'active' });
    const ability = b.build();
    const qb = fakeQb();

    accessibleBy(ability, 'read', 'Merchant', { alias: 'm' }).applyTo(qb);

    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0]!.sql).toContain('m.');
    expect(qb.calls[0]!.params).toBeDefined();
  });

  it('applies a tautological-false WHERE when no rules grant access', () => {
    const ability = createMongoAbility([]);
    const qb = fakeQb();

    accessibleBy(ability, 'read', 'Merchant', { alias: 'm' }).applyTo(qb);

    expect(qb.calls).toHaveLength(1);
    expect(qb.calls[0]!.sql).toBe('1 = 0');
  });

  it('skips andWhere when the rule is unconditional (empty fragment)', () => {
    const ability = createMongoAbility([{ action: 'read', subject: 'Merchant' }]);
    const qb = fakeQb();

    accessibleBy(ability, 'read', 'Merchant', { alias: 'm' }).applyTo(qb);

    expect(qb.calls).toHaveLength(0);
  });

  it('returns the QB for fluent chaining', () => {
    const b = new TenantAbilityBuilder(createMongoAbility, ctx);
    b.can('read', 'Merchant');
    const ability = b.build();
    const qb = fakeQb();

    const ret = accessibleBy(ability, 'read', 'Merchant', { alias: 'm' }).applyTo(qb);
    expect(ret).toBe(qb);
  });
});

describe('buildAccessibleSql — $relatedTo (with graph)', () => {
  const buildGraph = (): RelationshipGraph =>
    new RelationshipGraph()
      .define({
        name: 'merchant_of_payment',
        from: 'Payment',
        to: 'Merchant',
        resolver: foreignKey({ fromColumn: 'merchant_id' }),
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
      });

  it('compiles a single-hop $relatedTo into an EXISTS subquery', () => {
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['merchant_of_payment'], where: { id: 'm1' } },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Payment', {
      alias: 'p',
      graph: buildGraph(),
    });
    expect(sql?.sql).toContain('EXISTS (');
    expect(sql?.sql).toContain('SELECT 1');
    expect(sql?.sql).toContain('p.tenantId');
  });

  it('compiles a multi-hop $relatedTo with a join table', () => {
    const ability = createMongoAbility([
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
      },
    ]);

    const sql = buildAccessibleSql(ability, 'approve', 'Payment', {
      alias: 'p',
      graph: buildGraph(),
    });
    expect(sql?.sql).toContain('EXISTS (');
    expect(sql?.sql).toContain('agent_merchant_assignments');
  });

  it('throws when $relatedTo is used without a graph', () => {
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: { $relatedTo: { path: ['merchant_of_payment'], where: { id: 'm1' } } },
      },
    ]);
    expect(() => buildAccessibleSql(ability, 'read', 'Payment', { alias: 'p' })).toThrow(
      /no RelationshipGraph/,
    );
  });

  it('honors $in operator inside $relatedTo.where', () => {
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: {
            path: ['merchant_of_payment'],
            where: { id: { $in: ['m1', 'm2'] } },
          },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Payment', {
      alias: 'p',
      graph: buildGraph(),
    });
    expect(sql?.sql).toContain('IN (');
  });

  it('rejects top-level operators inside $relatedTo.where', () => {
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: {
            path: ['merchant_of_payment'],
            // $or at the where level is not allowed in v1
            where: { $or: [{ id: 'a' }, { id: 'b' }] } as Record<string, unknown>,
          },
        },
      },
    ]);

    expect(() =>
      buildAccessibleSql(ability, 'read', 'Payment', {
        alias: 'p',
        graph: buildGraph(),
      }),
    ).toThrow(/Top-level operator/);
  });
});
