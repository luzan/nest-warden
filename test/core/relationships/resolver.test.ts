import { describe, expect, it } from 'vitest';
import { custom, foreignKey, joinTable } from '../../../src/core/relationships/resolver.js';

describe('resolver factories', () => {
  describe('foreignKey', () => {
    it('builds a foreign-key resolver with default toColumn=id', () => {
      const r = foreignKey({ fromColumn: 'merchant_id' });
      expect(r).toEqual({ kind: 'foreign-key', fromColumn: 'merchant_id', toColumn: 'id' });
    });

    it('honors explicit toColumn override', () => {
      const r = foreignKey({ fromColumn: 'org_uuid', toColumn: 'uuid' });
      expect(r.toColumn).toBe('uuid');
    });

    it('preserves optional table names', () => {
      const r = foreignKey({
        fromColumn: 'agent_id',
        fromTable: 'merchants',
        toTable: 'agents',
      });
      expect(r.fromTable).toBe('merchants');
      expect(r.toTable).toBe('agents');
    });
  });

  describe('joinTable', () => {
    it('builds a join-table resolver with primary keys defaulted to id', () => {
      const r = joinTable({
        table: 'agent_merchant_assignments',
        fromKey: 'agent_id',
        toKey: 'merchant_id',
      });
      expect(r).toEqual({
        kind: 'join-table',
        table: 'agent_merchant_assignments',
        fromKey: 'agent_id',
        toKey: 'merchant_id',
        fromPrimaryKey: 'id',
        toPrimaryKey: 'id',
      });
    });

    it('honors explicit primary key overrides', () => {
      const r = joinTable({
        table: 'memberships',
        fromKey: 'user_uuid',
        toKey: 'tenant_uuid',
        fromPrimaryKey: 'uuid',
        toPrimaryKey: 'uuid',
      });
      expect(r.fromPrimaryKey).toBe('uuid');
      expect(r.toPrimaryKey).toBe('uuid');
    });
  });

  describe('custom', () => {
    it('builds a custom resolver carrying the SQL fragment', () => {
      const r = custom({ sql: 'SELECT 1 FROM t WHERE x = :from_id AND y = :to_id' });
      expect(r.kind).toBe('custom');
      expect(r.sql).toContain(':from_id');
      expect(r.params).toBeUndefined();
    });

    it('preserves params when provided', () => {
      const r = custom({
        sql: 'SELECT 1 FROM t WHERE active = :active',
        params: { active: true },
      });
      expect(r.params).toEqual({ active: true });
    });
  });
});
