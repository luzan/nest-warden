import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RLS_SESSION_VARIABLE,
  buildRlsSet,
} from '../../src/typeorm/rls-session.js';

describe('buildRlsSet', () => {
  it('builds a parameterized set_config call with the default variable name', () => {
    const [sql, params] = buildRlsSet('t1');
    expect(sql).toBe('SELECT set_config($1, $2, true)');
    expect(params).toEqual(['app.current_tenant_id', 't1']);
  });

  it('coerces numeric tenant IDs to text', () => {
    const [, params] = buildRlsSet(42);
    expect(params).toEqual(['app.current_tenant_id', '42']);
  });

  it('honors a custom variable name', () => {
    const [sql, params] = buildRlsSet('t1', 'my.tenant');
    expect(sql).toBe('SELECT set_config($1, $2, true)');
    expect(params).toEqual(['my.tenant', 't1']);
  });

  it('rejects variable names with semicolons', () => {
    expect(() => buildRlsSet('t1', 'evil;DROP')).toThrow(/Invalid RLS variable name/);
  });

  it('rejects variable names with spaces', () => {
    expect(() => buildRlsSet('t1', 'has space')).toThrow(/Invalid RLS variable name/);
  });

  it('rejects variable names starting with a digit', () => {
    expect(() => buildRlsSet('t1', '1bad')).toThrow();
  });

  it('accepts dotted identifiers (Postgres GUC convention)', () => {
    expect(() => buildRlsSet('t1', 'my_app.tenant_id')).not.toThrow();
  });

  it('exports the default variable name for adapter use', () => {
    expect(DEFAULT_RLS_SESSION_VARIABLE).toBe('app.current_tenant_id');
  });
});
