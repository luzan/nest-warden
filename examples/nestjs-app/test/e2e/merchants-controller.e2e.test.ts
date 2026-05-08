import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresWithSchema } from '../fixtures/postgres-fixture.js';
import {
  AGENT_ALICE,
  AGENT_BOB,
  AGENT_CAROL,
  MERCHANT_M1,
  MERCHANT_M2,
  TENANT_ACME,
  TENANT_BETA,
  seedFixture,
} from '../fixtures/seed.js';
import { AppModule } from '../../src/app.module.js';
import { setExampleDataSourceConfig } from '../../src/database/datasource.config.js';
import type { DataSource } from 'typeorm';

/**
 * End-to-end test for the merchants endpoints. Demonstrates:
 *
 *   1. **Forward checks**: `GET /merchants/:id` runs `ability.can('read',
 *      merchant)`. An ACME agent reading a BETA merchant gets 403.
 *
 *   2. **Reverse lookups via accessibleBy()**: `GET /merchants` lists
 *      every merchant the caller is allowed to see, in a SINGLE SQL
 *      query. Alice (assigned to m1+m2) sees both. Bob (assigned to m2)
 *      sees only m2. Carol (BETA tenant) sees only m4. The relationship
 *      graph traverses the agent_merchant_assignments junction table.
 *
 *   3. **RLS as defense in depth**: even if a developer bypassed the
 *      library, RLS would prevent the leak. The previous test file
 *      proves that property at the database layer.
 *
 * Authentication is faked via an `x-fake-user` header — production code
 * would use a real JWT guard. The fake header carries a JSON object
 * with `userId`, `tenantId`, `roles`. The example's `FakeAuthGuard`
 * (in `src/auth/`) populates `request.user` from it.
 */
describe('GET /merchants — multi-tenant access control', () => {
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

  describe('reverse lookup: GET /merchants (list)', () => {
    it('Alice (ACME agent, assigned to m1+m2) sees exactly her assignments', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth(AGENT_ALICE, TENANT_ACME, ['agent']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      expect(ids).toEqual([MERCHANT_M1, MERCHANT_M2].sort());
    });

    it('Bob (ACME agent, assigned only to m2) sees only m2', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent']));

      expect(res.status).toBe(200);
      expect((res.body as { id: string }[]).map((r) => r.id)).toEqual([MERCHANT_M2]);
    });

    it('Carol (BETA agent) sees only BETA merchants', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth(AGENT_CAROL, TENANT_BETA, ['agent']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toHaveLength(1);
      // The Beta tenant has exactly one merchant (m4).
      expect(ids[0]?.startsWith('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbb0004')).toBe(true);
    });

    it('an ISO admin (ACME) sees all ACME merchants regardless of agent assignments', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toHaveLength(3); // m1, m2, m3
    });
  });

  describe('forward check: GET /merchants/:id', () => {
    it('Alice can read m1 (assigned)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/merchants/${MERCHANT_M1}`)
        .set(fakeAuth(AGENT_ALICE, TENANT_ACME, ['agent']));
      expect(res.status).toBe(200);
      expect((res.body as { id: string }).id).toBe(MERCHANT_M1);
    });

    it('Bob cannot read m1 (not assigned, but same tenant)', async () => {
      // The service intentionally returns 404 instead of 403 for resources
      // that exist but the caller can't see — avoids leaking existence
      // across permission boundaries. 403 (from a guard-level deny) would
      // also be acceptable; we accept either.
      const res = await request(app.getHttpServer())
        .get(`/merchants/${MERCHANT_M1}`)
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent']));
      expect([403, 404]).toContain(res.status);
    });

    it('Carol cannot read m1 (different tenant)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/merchants/${MERCHANT_M1}`)
        .set(fakeAuth(AGENT_CAROL, TENANT_BETA, ['agent']));
      // 404 (not found) is also acceptable here — RLS returns no rows for
      // cross-tenant lookups, so the merchant simply isn't visible. The
      // controller maps "not found" to 404. We accept either 403 (caught
      // at the guard) or 404 (caught at the service).
      expect([403, 404]).toContain(res.status);
    });
  });
});
