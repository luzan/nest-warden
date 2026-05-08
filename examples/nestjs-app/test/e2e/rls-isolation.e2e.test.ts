import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  TENANT_ACME,
  TENANT_BETA,
  MERCHANT_M1,
  seedFixture,
} from '../fixtures/seed.js';
import { startPostgresWithSchema } from '../fixtures/postgres-fixture.js';

/**
 * RLS layer test — proves the database refuses cross-tenant reads even
 * when the application forgets to add a WHERE clause.
 *
 * This is the headline guarantee of the example app: the nest-warden
 * library's auto-injection is the FIRST line of defense; Postgres RLS is
 * the second. Either alone is insufficient; both together is fail-closed.
 */
describe('RLS — database-layer tenant isolation', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    ({ container, dataSource } = await startPostgresWithSchema());
    await seedFixture(dataSource);
    // Create a non-superuser role that doesn't bypass RLS, mirroring
    // the production `app_user` role from `sql/init.sql`.
    await dataSource.query(
      `CREATE ROLE app_user LOGIN PASSWORD 'app_password' NOBYPASSRLS`,
    );
    await dataSource.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`);
    await dataSource.query(`GRANT USAGE ON SCHEMA public TO app_user`);
  }, 60_000);

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  }, 30_000);

  /**
   * Run a query as `app_user` (RLS-enforced) with the given tenant ID.
   *
   * Critical: every query must run on the SAME connection as the
   * `set_config(...)` call — otherwise the session variable doesn't
   * apply. We achieve this by acquiring a queryRunner, opening a
   * transaction (which pins the connection), and exposing
   * `runner.query()` to the callback as the only way to issue SQL.
   */
  async function asAppUser<T>(
    tenantId: string | null,
    fn: (q: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<T>,
  ): Promise<T> {
    const userDataSource = new DataSource({
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      username: 'app_user',
      password: 'app_password',
      database: container.getDatabase(),
      synchronize: false,
      logging: false,
    });
    await userDataSource.initialize();
    try {
      const runner = userDataSource.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        if (tenantId !== null) {
          await runner.query(`SELECT set_config($1, $2, true)`, [
            'app.current_tenant_id',
            tenantId,
          ]);
        }
        const result = await fn((sql, params) => runner.query(sql, params ?? []));
        await runner.commitTransaction();
        return result;
      } catch (err) {
        await runner.rollbackTransaction();
        throw err;
      } finally {
        await runner.release();
      }
    } finally {
      await userDataSource.destroy();
    }
  }

  it('returns only ACME merchants when app.current_tenant_id is ACME', async () => {
    const rows = (await asAppUser(TENANT_ACME, async (q) =>
      q('SELECT id FROM merchants ORDER BY name'),
    )) as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toContain(MERCHANT_M1);
    expect(rows.length).toBe(3); // m1, m2, m3 — all three ACME merchants
    // No BETA merchants leak in.
    expect(rows.every((r) => r.id !== 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0004')).toBe(true);
  });

  it('returns only BETA merchants when app.current_tenant_id is BETA', async () => {
    const rows = (await asAppUser(TENANT_BETA, async (q) =>
      q('SELECT id FROM merchants'),
    )) as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0004');
  });

  it('returns ZERO rows when no tenant context is set (fail-closed)', async () => {
    // RLS policy uses current_setting('app.current_tenant_id', true) which
    // returns NULL when unset; tenant_id::text = NULL is NULL (not true),
    // so the RESTRICTIVE policy denies every row.
    const rows = (await asAppUser(null, async (q) =>
      q('SELECT id FROM merchants'),
    )) as { id: string }[];
    expect(rows).toHaveLength(0);
  });

  it('refuses cross-tenant queries even when the app forgets a WHERE clause', async () => {
    // Application-layer code that does `SELECT * FROM payments` (no WHERE)
    // and expects all payments to be returned — RLS still blocks it.
    const rows = (await asAppUser(TENANT_ACME, async (q) =>
      q('SELECT tenant_id FROM payments'),
    )) as { tenant_id: string }[];
    expect(rows.every((r) => r.tenant_id === TENANT_ACME)).toBe(true);
  });

  it('JOINs respect RLS on every joined table', async () => {
    // Without RLS this query would return all 4 merchant→payment pairs;
    // with RLS scoped to BETA we should see only Beta Bakery's payment.
    const rows = (await asAppUser(TENANT_BETA, async (q) =>
      q(`
        SELECT m.name AS merchant_name, p.amount_cents
        FROM payments p INNER JOIN merchants m ON m.id = p.merchant_id
      `),
    )) as { merchant_name: string; amount_cents: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.merchant_name).toBe('Beta Bakery');
  });

  it('rejects INSERTs whose tenant_id mismatches app.current_tenant_id', async () => {
    // PERMISSIVE policies have an implicit WITH CHECK derived from USING,
    // so an attempt to insert a row outside the active tenant fails at
    // write time with `new row violates row-level security policy`.
    await expect(
      asAppUser(TENANT_BETA, async (q) => {
        await q(
          `INSERT INTO merchants(id, tenant_id, name, status) VALUES ($1, $2, 'sneaky', 'active')`,
          ['cccccccc-bbbb-bbbb-bbbb-bbbbbbbb9999', TENANT_ACME],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('allows INSERTs whose tenant_id matches the active session', async () => {
    await asAppUser(TENANT_ACME, async (q) => {
      await q(
        `INSERT INTO merchants(id, tenant_id, name, status) VALUES ($1, $2, 'fresh', 'active')`,
        ['cccccccc-aaaa-aaaa-aaaa-aaaaaaaa9000', TENANT_ACME],
      );
      const rows = (await q(
        `SELECT id FROM merchants WHERE name = 'fresh'`,
      )) as { id: string }[];
      expect(rows).toHaveLength(1);
    });
  });
});
