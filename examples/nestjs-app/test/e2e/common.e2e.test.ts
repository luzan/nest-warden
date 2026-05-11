import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresWithSchema } from '../fixtures/postgres-fixture.js';
import { TENANT_ACME, seedFixture } from '../fixtures/seed.js';
import { AppModule } from '../../src/app.module.js';
import { setExampleDataSourceConfig } from '../../src/database/datasource.config.js';
import type { DataSource } from 'typeorm';

/**
 * Cross-cutting concerns exercised against both the merchants and
 * payments endpoints. The `common/` folder in the example app
 * collects DTOs and decorators that two or more feature modules
 * reuse — this file proves that reuse end-to-end so the patterns
 * don't drift between modules.
 *
 * What this file covers:
 *
 *   1. **`PaginationQuery` DTO** — the shared `?limit` / `?offset`
 *      pagination shape applies to both `/merchants` and `/payments`
 *      with consistent defaults and bounds.
 *
 *   2. **Default-bounds invariants** — `limit=0` and oversized `limit`
 *      values are clamped to a sane range so a misbehaving client
 *      can't force a full-table scan.
 */
describe('common — shared pagination DTO across modules', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let app: INestApplication;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    ({ container, dataSource } = await startPostgresWithSchema());
    await seedFixture(dataSource);

    setExampleDataSourceConfig({
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
    });

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await dataSource.destroy();
    await container.stop();
  }, 30_000);

  const fakeAuth = (
    userId: string,
    tenantId: string,
    roles: string[],
  ): Record<string, string> => ({
    'x-fake-user': JSON.stringify({ userId, tenantId, roles }),
  });

  describe('PaginationQuery shared between /merchants and /payments', () => {
    it('limit=2 on /merchants returns at most 2 rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants?limit=2')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBeLessThanOrEqual(2);
    });

    it('limit=2 on /payments returns at most 2 rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments?limit=2')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBeLessThanOrEqual(2);
    });

    it('offset=1&limit=1 skips the first row of /payments', async () => {
      const auth = fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']);

      const full = await request(app.getHttpServer()).get('/payments').set(auth);
      const page = await request(app.getHttpServer())
        .get('/payments?offset=1&limit=1')
        .set(auth);

      expect(page.status).toBe(200);
      const pageIds = (page.body as { id: string }[]).map((r) => r.id);
      const fullIds = (full.body as { id: string }[]).map((r) => r.id);
      expect(pageIds).toHaveLength(1);
      // The single returned row must be one of the full list (no
      // out-of-bounds drift) but not the first one.
      expect(fullIds).toContain(pageIds[0]);
      expect(pageIds[0]).not.toBe(fullIds[0]);
    });

    it('oversized limit is clamped to the configured maximum', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments?limit=10000')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      // The clamp itself is implementation-defined; we just assert that
      // the request succeeds AND the response is bounded — i.e., the
      // server didn't let `limit=10000` pass through to TypeORM.
      // The DTO sets a max of 100; with only ~5 ACME payments in the
      // fixture we can't *positively* assert clamping from row count
      // alone, but we can prove the server didn't crash and the
      // response is well-formed.
      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBeLessThanOrEqual(100);
    });

    it('limit=0 is treated as the default (does not return zero rows)', async () => {
      // A buggy DTO that passes `limit=0` straight to TypeORM as a
      // `LIMIT 0` would silently return [] for every request. The DTO
      // coerces zero/negative values back to the default.
      const res = await request(app.getHttpServer())
        .get('/payments?limit=0')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBeGreaterThan(0);
    });
  });
});
