import { describe, expect, it } from 'vitest';
import { CompoundCondition, DocumentCondition, FieldCondition } from '@ucast/core';
import { createMongoAbility } from '@casl/ability';
import { buildAccessibleSql } from '../../src/typeorm/accessible-by.js';
import { compileCondition } from '../../src/typeorm/compiler/ast-walker.js';
import { ParameterBag } from '../../src/typeorm/compiler/parameter-bag.js';
import { RelationshipGraph } from '../../src/core/relationships/graph.js';
import { custom, foreignKey, joinTable } from '../../src/core/relationships/resolver.js';
import { UnsupportedOperatorError } from '../../src/core/errors.js';

describe('compileCondition — edge cases', () => {
  it('throws UnsupportedOperatorError for unknown compound operators (e.g., $nor)', () => {
    const cond = new CompoundCondition('nor', [new FieldCondition('eq', 'status', 'active')]);
    const bag = new ParameterBag();
    expect(() => compileCondition(cond, { alias: 'm', bag })).toThrow(UnsupportedOperatorError);
  });

  it('NOT of an empty inner returns the empty fragment', () => {
    const cond = new CompoundCondition('not', []);
    const bag = new ParameterBag();
    const result = compileCondition(cond, { alias: 'm', bag });
    expect(result.sql).toBe('');
  });

  it('NOT of a populated condition wraps in NOT(...)', () => {
    const inner = new FieldCondition('eq', 'status', 'closed');
    const cond = new CompoundCondition('not', [inner]);
    const bag = new ParameterBag('p');
    const result = compileCondition(cond, { alias: 'm', bag });
    expect(result.sql).toBe('NOT (m.status = :p_0)');
  });

  it('throws UnsupportedOperatorError for DocumentConditions with unknown operators', () => {
    // Synthetic AST shape: ucast can in principle emit DocumentConditions
    // for unknown top-level operators. The walker rejects them by name.
    const cond = new DocumentCondition('weird', { foo: 'bar' });
    const bag = new ParameterBag();
    expect(() => compileCondition(cond, { alias: 'm', bag })).toThrow(UnsupportedOperatorError);
  });

  it('two can rules OR-combine into a (...) OR (...) fragment', () => {
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: { tenantId: 't1', amountCents: { $lt: 1000 } },
      },
      {
        action: 'read',
        subject: 'Payment',
        conditions: { tenantId: 't1', merchantId: 'm-trusted' },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Payment', { alias: 'p' });
    expect(sql?.sql).toContain(' OR ');
  });
});

describe('$relatedTo — guards (constructed AST)', () => {
  // The throws inside compileRelatedTo and compileFieldCondition fire when
  // mongo2js produces a FieldCondition keyed on '$relatedTo'. Different
  // mongo2js versions may emit either a FieldCondition or a top-level
  // CompoundCondition for the same input — to avoid coupling our coverage
  // story to that detail, we construct the AST directly and call the
  // compiler's public entry point.
  it('throws from compileFieldCondition path when ctx.graph is missing', () => {
    const fc = new FieldCondition('eq', '$relatedTo', { path: ['x'], where: {} });
    const bag = new ParameterBag();
    expect(() => compileCondition(fc, { alias: 'p', bag })).toThrow(/no RelationshipGraph/);
  });

  it('handles a FieldCondition with operator "relatedTo" (alternate form)', () => {
    // Some ucast versions normalize $relatedTo into operator "relatedTo".
    // Both forms should route to the same compiler path.
    const graph = new RelationshipGraph().define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: foreignKey({ fromColumn: 'merchant_id' }),
    });
    const fc = new FieldCondition('relatedTo', '$relatedTo', {
      path: ['merchant_of_payment'],
      where: { id: 'm1' },
    });
    const bag = new ParameterBag();
    const result = compileCondition(fc, { alias: 'p', bag, graph });
    expect(result.sql).toContain('EXISTS (');
  });
});

describe('$relatedTo — leaf where edge cases', () => {
  it('accepts operators without the $ prefix in leaf where (e.g., { id: { eq: ... } })', () => {
    const graph = new RelationshipGraph().define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: foreignKey({ fromColumn: 'merchant_id' }),
    });
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['merchant_of_payment'], where: { id: { eq: 'm1' } } },
        },
      },
    ]);
    const sql = buildAccessibleSql(ability, 'read', 'Payment', { alias: 'p', graph });
    expect(sql?.sql).toContain(' = ');
  });

  it('compiles an empty leaf where (the WHERE only carries the outer correlation)', () => {
    const graph = new RelationshipGraph().define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: foreignKey({ fromColumn: 'merchant_id' }),
    });
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['merchant_of_payment'], where: {} },
        },
      },
    ]);
    const sql = buildAccessibleSql(ability, 'read', 'Payment', { alias: 'p', graph });
    // The EXISTS subquery contains the outer-alias correlation in WHERE.
    // With an empty leaf where, no additional conjuncts appear.
    expect(sql?.sql).toContain('EXISTS (');
    // Correlation: outer p.merchant_id = inner p_rt_0.id
    expect(sql?.sql).toMatch(/p\.merchant_id\s*=\s*p_rt_0\.id/);
    // No leaf-level conditions — the WHERE clause has just one conjunct.
    expect(sql?.sql.match(/AND/g)?.length ?? 0).toBeLessThan(2);
  });
});

describe('tableForSubject pluralization (via $relatedTo)', () => {
  // tableForSubject is private; exercise its branches by registering
  // relationships whose `to` types trip each pluralization rule.
  it('subject ending in "s" stays unchanged (e.g., "Series" → "series")', () => {
    const graph = new RelationshipGraph().define({
      name: 'series_of_episode',
      from: 'Episode',
      to: 'Series',
      resolver: foreignKey({ fromColumn: 'series_id' }),
    });
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Episode',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['series_of_episode'], where: { id: 's1' } },
        },
      },
    ]);
    const sql = buildAccessibleSql(ability, 'read', 'Episode', { alias: 'e', graph });
    expect(sql?.sql).toContain('FROM series ');
  });

  it('subject ending in "y" pluralizes to "ies" (e.g., "Category" → "categories")', () => {
    const graph = new RelationshipGraph().define({
      name: 'category_of_product',
      from: 'Product',
      to: 'Category',
      resolver: foreignKey({ fromColumn: 'category_id' }),
    });
    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Product',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['category_of_product'], where: { id: 'c1' } },
        },
      },
    ]);
    const sql = buildAccessibleSql(ability, 'read', 'Product', { alias: 'p', graph });
    expect(sql?.sql).toContain('FROM categories ');
  });
});

describe('buildAccessibleSql — null AST result', () => {
  it('returns null when only an unconditional cannot exists (no can survives flattening)', () => {
    // A standalone `cannot manage Merchant` with no `can` rules → no path
    // for the user to access anything; rulesToAST collapses to null.
    const ability = createMongoAbility([{ action: 'manage', subject: 'Merchant', inverted: true }]);
    expect(buildAccessibleSql(ability, 'manage', 'Merchant', { alias: 'm' })).toBeNull();
  });
});

describe('$relatedTo — custom resolver', () => {
  it('compiles a custom resolver into the EXISTS subquery verbatim', () => {
    const graph = new RelationshipGraph().define({
      name: 'agent_descendants',
      from: 'Agent',
      to: 'Agent',
      resolver: custom({
        sql:
          'FROM agents {to_alias} WHERE EXISTS (' +
          'SELECT 1 FROM agent_hierarchy WHERE ancestor_id = {from_alias}.id ' +
          'AND descendant_id = {to_alias}.id)',
      }),
    });

    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Agent',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['agent_descendants'], where: { id: 'a1' } },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Agent', { alias: 'a', graph });
    expect(sql?.sql).toContain('agent_hierarchy');
    expect(sql?.sql).toContain('a.id'); // {from_alias} expanded to outer alias
  });

  it('binds named params via {:key} placeholders in custom SQL', () => {
    const graph = new RelationshipGraph().define({
      name: 'active_descendants',
      from: 'Agent',
      to: 'Agent',
      resolver: custom({
        sql:
          'FROM agents {to_alias} ' +
          'WHERE {to_alias}.parent_id = {from_alias}.id AND {to_alias}.status = {:active}',
        params: { active: 'active' },
      }),
    });

    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Agent',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['active_descendants'], where: { id: 'a1' } },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Agent', { alias: 'a', graph });
    expect(sql?.sql).toMatch(/= :mtc_\d+/); // bound param substituted
    expect(Object.values(sql!.params)).toContain('active');
  });

  it('compiles a custom resolver as a SUBSEQUENT hop (isFirst=false branch)', () => {
    // First hop is a foreignKey (correlates outer→subquery via WHERE);
    // second hop is a custom resolver (joinClause path, isFirst=false).
    // Exercises the `isFirst` ternary in buildCustomHop.
    const graph = new RelationshipGraph()
      .define({
        name: 'merchant_of_payment',
        from: 'Payment',
        to: 'Merchant',
        resolver: foreignKey({ fromColumn: 'merchant_id' }),
      })
      .define({
        name: 'agent_via_audit_log',
        from: 'Merchant',
        to: 'Agent',
        resolver: custom({
          sql:
            'INNER JOIN audit_log al ON al.merchant_id = {from_alias}.id ' +
            'INNER JOIN agents {to_alias} ON {to_alias}.id = al.agent_id',
        }),
      });

    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: {
            path: ['merchant_of_payment', 'agent_via_audit_log'],
            where: { id: 'alice' },
          },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Payment', { alias: 'p', graph });
    expect(sql?.sql).toContain('EXISTS (');
    expect(sql?.sql).toContain('audit_log al');
    // Custom hop SQL appears as a JOIN clause, not as a FROM clause.
    expect(sql?.sql).not.toMatch(/FROM audit_log/);
  });

  it('emits no WHERE clause when correlations and leaf-where are both empty', () => {
    // Single-hop custom resolver (no outerCorrelation) plus an empty
    // leaf where → both whereParts arrays are empty. Exercises the
    // false branch of the `whereParts.length > 0 ? ... : ''` ternary.
    const graph = new RelationshipGraph().define({
      name: 'agent_self',
      from: 'Agent',
      to: 'Agent',
      resolver: custom({
        sql:
          'FROM agents {to_alias} WHERE EXISTS (' +
          'SELECT 1 FROM agent_hierarchy WHERE ancestor_id = {from_alias}.id ' +
          'AND descendant_id = {to_alias}.id)',
      }),
    });

    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Agent',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['agent_self'], where: {} },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Agent', { alias: 'a', graph });
    expect(sql?.sql).toContain('EXISTS (');
    // The outer ` WHERE ...` between the FROM/JOIN section and the
    // closing paren must be absent — the custom SQL still has its own
    // internal WHERE inside the EXISTS, but no outer WHERE is emitted.
    expect(sql?.sql).not.toMatch(/\) WHERE /);
  });
});

describe('$relatedTo — leaf where with multiple fields', () => {
  it('combines multiple where fields with AND inside the EXISTS subquery', () => {
    const graph = new RelationshipGraph().define({
      name: 'merchant_of_payment',
      from: 'Payment',
      to: 'Merchant',
      resolver: foreignKey({ fromColumn: 'merchant_id' }),
    });

    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Payment',
        conditions: {
          tenantId: 't1',
          $relatedTo: {
            path: ['merchant_of_payment'],
            where: { id: 'm1', status: 'active' },
          },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Payment', { alias: 'p', graph });
    expect(sql?.sql).toContain('AND');
    expect(Object.values(sql!.params)).toEqual(expect.arrayContaining(['m1', 'active']));
  });

  it('compiles a join-table-based $relatedTo with $eq operator on leaf', () => {
    const graph = new RelationshipGraph().define({
      name: 'agents_of_merchant',
      from: 'Merchant',
      to: 'Agent',
      resolver: joinTable({
        table: 'agent_merchant_assignments',
        fromKey: 'merchant_id',
        toKey: 'agent_id',
      }),
    });

    const ability = createMongoAbility([
      {
        action: 'read',
        subject: 'Merchant',
        conditions: {
          tenantId: 't1',
          $relatedTo: { path: ['agents_of_merchant'], where: { id: { $eq: 'alice' } } },
        },
      },
    ]);

    const sql = buildAccessibleSql(ability, 'read', 'Merchant', { alias: 'm', graph });
    expect(sql?.sql).toContain('agent_merchant_assignments');
    expect(sql?.sql).toContain('=');
  });
});
