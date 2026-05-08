import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { TenantColumn } from '../../src/typeorm/tenant-column.decorator.js';
import { TenantSubscriber } from '../../src/typeorm/tenant-subscriber.js';

class Merchant {
  @TenantColumn()
  tenantId!: string;
  id!: string;
  name!: string;
}

class SystemTable {
  id!: string;
  code!: string;
}

const insertEvent = (entity: object): { entity: object } => ({ entity });
const updateEvent = (
  entity: object,
  databaseEntity?: object,
  metadata?: { target: object },
): { entity: object; databaseEntity?: object; metadata?: { target: object } } => ({
  entity,
  databaseEntity,
  metadata,
});

describe('TenantSubscriber — beforeInsert', () => {
  it('stamps the tenant column when missing', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = new Merchant();
    sub.beforeInsert(insertEvent(m) as never);
    expect(m.tenantId).toBe('t1');
  });

  it('does not overwrite when value matches the resolved tenant', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 't1' });
    sub.beforeInsert(insertEvent(m) as never);
    expect(m.tenantId).toBe('t1');
  });

  it('throws when value mismatches the resolved tenant (cross-tenant insert)', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 't2' });
    expect(() => sub.beforeInsert(insertEvent(m) as never)).toThrow(/cross-tenant insert/);
  });

  it('throws when no tenant context is resolved and column is missing', () => {
    const sub = new TenantSubscriber(() => undefined);
    const m = new Merchant();
    expect(() => sub.beforeInsert(insertEvent(m) as never)).toThrow(/no tenant context resolved/);
  });

  it('skips entities without @TenantColumn (system tables)', () => {
    const sub = new TenantSubscriber(() => 't1');
    const s = new SystemTable();
    expect(() => sub.beforeInsert(insertEvent(s) as never)).not.toThrow();
    // System tables don't gain a tenantId field.
    expect(Object.prototype.hasOwnProperty.call(s, 'tenantId')).toBe(false);
  });

  it('skips when the event has no entity (e.g., bulk operations)', () => {
    const sub = new TenantSubscriber(() => 't1');
    expect(() => sub.beforeInsert({ entity: undefined } as never)).not.toThrow();
  });

  it('skips when the entity is not an object', () => {
    const sub = new TenantSubscriber(() => 't1');
    expect(() => sub.beforeInsert({ entity: 'not-an-object' } as never)).not.toThrow();
  });

  it('error message renders object values as JSON (safeFormat)', () => {
    const sub = new TenantSubscriber(() => 't1');
    // Pathological: tenantId is set to an object (shouldn't happen in real
    // usage, but defensive code paths must format gracefully).
    const m = Object.assign(new Merchant(), { tenantId: { weird: true } as unknown as string });
    expect(() => sub.beforeInsert(insertEvent(m) as never)).toThrow(/"weird":true/);
  });

  it('error message handles BigInt tenant IDs', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 999n as unknown as string });
    expect(() => sub.beforeInsert(insertEvent(m) as never)).toThrow(/999/);
  });

  it('error message handles boolean / null in pathological inputs', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: true as unknown as string });
    expect(() => sub.beforeInsert(insertEvent(m) as never)).toThrow(/true/);
  });

  it('error message handles values that JSON.stringify rejects (cyclic)', () => {
    const sub = new TenantSubscriber(() => 't1');
    type Cycle = { self?: Cycle };
    const cycle: Cycle = {};
    cycle.self = cycle;
    const m = Object.assign(new Merchant(), { tenantId: cycle as unknown as string });
    // Should fall back to '[object Object]' from Object.prototype.toString
    expect(() => sub.beforeInsert(insertEvent(m) as never)).toThrow(/object Object/);
  });

  it('treats null tenantId as missing (and stamps it)', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: null as unknown as string });
    sub.beforeInsert(insertEvent(m) as never);
    expect(m.tenantId).toBe('t1');
  });
});

describe('TenantSubscriber — beforeUpdate', () => {
  it('passes through when context and DB row match', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 't1' });
    expect(() =>
      sub.beforeUpdate(updateEvent(m, { tenantId: 't1' }, { target: Merchant }) as never),
    ).not.toThrow();
  });

  it('throws when caller tries to set a different tenantId on update', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 't2' });
    expect(() =>
      sub.beforeUpdate(updateEvent(m, { tenantId: 't1' }, { target: Merchant }) as never),
    ).toThrow(/must equal active tenant/);
  });

  it('throws when DB row belongs to a different tenant (cross-tenant update)', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 't1' });
    expect(() =>
      sub.beforeUpdate(updateEvent(m, { tenantId: 't2' }, { target: Merchant }) as never),
    ).toThrow(/cross-tenant update/);
  });

  it('skips enforcement when no tenant context is resolved (system jobs)', () => {
    const sub = new TenantSubscriber(() => undefined);
    const m = Object.assign(new Merchant(), { tenantId: 't1' });
    expect(() =>
      sub.beforeUpdate(updateEvent(m, { tenantId: 't1' }, { target: Merchant }) as never),
    ).not.toThrow();
  });

  it('skips entities without @TenantColumn', () => {
    const sub = new TenantSubscriber(() => 't1');
    const s = new SystemTable();
    expect(() => sub.beforeUpdate(updateEvent(s) as never)).not.toThrow();
  });

  it('skips when the event has no entity', () => {
    const sub = new TenantSubscriber(() => 't1');
    expect(() => sub.beforeUpdate({ entity: undefined } as never)).not.toThrow();
  });

  it('skips when the entity is not an object', () => {
    const sub = new TenantSubscriber(() => 't1');
    expect(() => sub.beforeUpdate({ entity: 'foo' } as never)).not.toThrow();
  });

  it('uses event.metadata.target when provided', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign({}, { tenantId: 't1' }); // plain object, no constructor metadata
    expect(() =>
      sub.beforeUpdate(updateEvent(m, { tenantId: 't1' }, { target: Merchant }) as never),
    ).not.toThrow();
  });

  it('falls back to entity.constructor when metadata is absent', () => {
    const sub = new TenantSubscriber(() => 't1');
    const m = Object.assign(new Merchant(), { tenantId: 't1' });
    // No metadata on the event — uses entity.constructor (Merchant).
    expect(() => sub.beforeUpdate(updateEvent(m, { tenantId: 't1' }) as never)).not.toThrow();
  });
});
