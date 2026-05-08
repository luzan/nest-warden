import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm';
import { TenantColumn } from '../../src/typeorm/tenant-column.decorator.js';
import { TenantAwareRepository } from '../../src/typeorm/tenant-aware.repository.js';

@Entity('merchants')
class Merchant {
  @PrimaryColumn('text')
  id!: string;

  @Column('text')
  @TenantColumn()
  tenantId!: string;

  @Column('text')
  name!: string;

  @Column('text')
  status!: string;
}

@Entity('system_currencies')
class Currency {
  @PrimaryColumn('text')
  code!: string;

  @Column('text')
  symbol!: string;
}

let dataSource: DataSource;

const seed = async (): Promise<void> => {
  const repo = dataSource.getRepository(Merchant);
  await repo.save([
    { id: 'm1', tenantId: 't1', name: 'Acme', status: 'active' },
    { id: 'm2', tenantId: 't1', name: 'Acme 2', status: 'closed' },
    { id: 'm3', tenantId: 't2', name: 'Beta', status: 'active' },
    { id: 'm4', tenantId: 't2', name: 'Beta 2', status: 'closed' },
  ]);
  await dataSource.getRepository(Currency).save([
    { code: 'USD', symbol: '$' },
    { code: 'EUR', symbol: '€' },
  ]);
};

beforeEach(async () => {
  dataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    dropSchema: true,
    entities: [Merchant, Currency],
    synchronize: true,
  });
  await dataSource.initialize();
  await seed();
});

afterEach(async () => {
  await dataSource.destroy();
});

describe('TenantAwareRepository — find / findBy / findOne', () => {
  const tenantProvider = (tenantId: string) => () => tenantId;

  it('find() filters by the active tenant', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const rows = await repo.find();
    expect(rows.map((r) => r.id).sort()).toEqual(['m1', 'm2']);
  });

  it('find() with explicit where merges the tenant predicate', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const rows = await repo.find({ where: { status: 'active' } });
    expect(rows.map((r) => r.id)).toEqual(['m1']);
  });

  it('find() with array where applies tenant predicate to each branch', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const rows = await repo.find({ where: [{ status: 'active' }, { status: 'closed' }] });
    expect(rows.every((r) => r.tenantId === 't1')).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('find() with array where preserves explicit tenantId in any branch (idempotent)', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    // First branch: explicit tenantId t2 (different); second: implicit t1.
    const rows = await repo.find({
      where: [{ tenantId: 't2', status: 'active' }, { status: 'closed' }],
    });
    // Branch 1 returns the m3 row from t2; branch 2 returns m2 from t1.
    expect(rows.map((r) => r.id).sort()).toEqual(['m2', 'm3']);
  });

  it('findBy() applies the tenant predicate', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const rows = await repo.findBy({ status: 'active' });
    expect(rows.map((r) => r.id)).toEqual(['m1']);
  });

  it('findOne() respects the tenant predicate', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const m3 = await repo.findOne({ where: { id: 'm3' } });
    expect(m3).toBeNull();
    const m1 = await repo.findOne({ where: { id: 'm1' } });
    expect(m1?.id).toBe('m1');
  });

  it('findOneBy() respects the tenant predicate', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const m3 = await repo.findOneBy({ id: 'm3' });
    expect(m3).toBeNull();
  });

  it('findAndCount() returns scoped rows + count', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    const [rows, total] = await repo.findAndCount();
    expect(total).toBe(2);
    expect(rows.every((r) => r.tenantId === 't1')).toBe(true);
  });

  it('count() returns scoped count', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    expect(await repo.count()).toBe(2);
  });

  it('scopeWhere() returns the same object when tenant field already specified', () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), () => 't1');
    const where = { tenantId: 't2', status: 'active' };
    expect(repo.scopeWhere(where)).toBe(where);
  });

  it('scopeWhere() is a no-op for non-tenant entities', () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Currency), () => 't1');
    const where = { code: 'USD' };
    expect(repo.scopeWhere(where)).toBe(where);
  });

  it('respects an explicit tenant value in where (no overwrite)', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), tenantProvider('t1'));
    // Rare but valid: the consumer wants to filter by a different tenant
    // explicitly. Auto-injection should NOT overwrite an explicit value.
    const rows = await repo.find({ where: { tenantId: 't2' } });
    expect(rows.map((r) => r.id).sort()).toEqual(['m3', 'm4']);
  });

  it('non-tenant entities (no @TenantColumn) are passthrough', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Currency), tenantProvider('t1'));
    expect(repo.tenantField).toBeUndefined();
    const rows = await repo.find();
    expect(rows.map((r) => r.code).sort()).toEqual(['EUR', 'USD']);
  });
});

describe('TenantAwareRepository — query builder', () => {
  it('createQueryBuilder() pre-applies the tenant predicate', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), () => 't1');
    const rows = await repo.createQueryBuilder('m').getMany();
    expect(rows.every((r) => r.tenantId === 't1')).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it('scopeQueryBuilder() applies predicate to an externally-built builder', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), () => 't2');
    const qb = dataSource.getRepository(Merchant).createQueryBuilder('m');
    repo.scopeQueryBuilder(qb, 'm');
    const rows = await qb.getMany();
    expect(rows.every((r) => r.tenantId === 't2')).toBe(true);
  });

  it('scopeQueryBuilder() is a no-op for non-tenant entities', () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Currency), () => 't1');
    const qb = dataSource.getRepository(Currency).createQueryBuilder('c');
    expect(repo.scopeQueryBuilder(qb, 'c')).toBe(qb);
  });
});

describe('TenantAwareRepository — save', () => {
  it('save() persists through the underlying repository', async () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), () => 't1');
    const saved = await repo.save({ id: 'm5', tenantId: 't1', name: 'New', status: 'active' });
    expect(saved.id).toBe('m5');
  });

  it('exposes the underlying TypeORM target for advanced consumers', () => {
    const repo = new TenantAwareRepository(dataSource.getRepository(Merchant), () => 't1');
    expect(repo.target).toBe(Merchant);
    expect(repo.repository).toBeDefined();
  });
});
