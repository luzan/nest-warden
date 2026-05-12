import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresWithSchema } from '../fixtures/postgres-fixture.js';
import { authHeader } from '../fixtures/auth-helpers.js';
import {
  MERCHANT_M1,
  TENANT_ACME,
  TENANT_BETA,
  USER_ISO_ADMIN_ACME,
  seedFixture,
} from '../fixtures/seed.js';
import { AppModule } from '../../src/app.module.js';
import { setExampleDataSourceConfig } from '../../src/database/datasource.config.js';
import type { DataSource } from 'typeorm';

/**
 * TenantSubscriber — end-to-end demonstration of the application-layer
 * defense in depth on top of Postgres RLS.
 *
 * The subscriber is wired into the example's TypeORM `DataSource` via
 * `src/app.module.ts`'s `TypeOrmModule.forRootAsync`. The resolver
 * pulls the active tenant id out of an `AsyncLocalStorage` populated
 * by `src/auth/tenant-als.interceptor.ts`. See
 * `src/auth/tenant-als.ts` for the why behind the ALS bridge.
 *
 * What this file proves:
 *
 *   1. **A controller update that tries to move a row to a different
 *      tenant is rejected.** Even though the iso-admin role grants
 *      `manage Merchant` and the policy guard passes, the subscriber
 *      catches the cross-tenant write in `beforeUpdate` and refuses
 *      it. RLS would also catch this if it ever reached the database
 *      — the subscriber surfaces the rejection at the application
 *      layer with a more descriptive error before the SQL fires.
 *
 *   2. **Same-tenant updates still pass through.** Sanity check that
 *      the wiring doesn't break the golden path.
 *
 * The narrow scope here (one rejection, one happy path) is
 * intentional. The library's `test/typeorm/tenant-subscriber.test.ts`
 * already covers the full `beforeInsert` / `beforeUpdate` matrix in
 * unit-test isolation. This file's value is proving the WIRING
 * works against real Postgres + NestJS + TypeORM, not re-asserting
 * the subscriber's internal logic.
 */
describe('TenantSubscriber — cross-tenant update rejection (E2E)', () => {
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

  it('rejects an update that moves a row to a different tenant', async () => {
    // ACME iso-admin attempts to PATCH an ACME merchant with a body
    // that overrides `tenantId` to BETA. The controller passes the
    // body through `Object.assign(merchant, partial)` (no DTO
    // sanitiser), so the in-memory entity carries BETA when
    // `repo.save(...)` is called. `TenantSubscriber.beforeUpdate`
    // fires synchronously inside TypeORM's pre-write hook and
    // throws; NestJS's default exception filter returns 500 with
    // the message redacted to "Internal server error".
    //
    // Status alone could be coincidence — assert the row also did
    // NOT actually move. A subsequent GET as the original ACME
    // admin must still find the merchant unchanged.
    const attempt = await request(app.getHttpServer())
      .patch(`/merchants/${MERCHANT_M1}`)
      .set(authHeader(USER_ISO_ADMIN_ACME, TENANT_ACME))
      .send({ tenantId: TENANT_BETA, name: 'Smuggled cross-tenant' });

    expect(attempt.status).toBe(500);

    // Verify no persistence happened — m1 is still in ACME with its
    // original name. If the subscriber had failed open, ACME admin
    // would now see a 404 (the row "moved" to BETA) and a BETA
    // admin would see a row with the smuggled name.
    const followUp = await request(app.getHttpServer())
      .get(`/merchants/${MERCHANT_M1}`)
      .set(authHeader(USER_ISO_ADMIN_ACME, TENANT_ACME));
    expect(followUp.status).toBe(200);
    expect((followUp.body as { name: string }).name).not.toBe('Smuggled cross-tenant');
  });

  it('allows updates that keep the row in its original tenant (regression guard)', async () => {
    // Same ACME admin, same merchant, but the body only touches
    // non-tenant fields. The subscriber must not fire for this
    // case — if it did, every legitimate update would 500.
    const res = await request(app.getHttpServer())
      .patch(`/merchants/${MERCHANT_M1}`)
      .set(authHeader(USER_ISO_ADMIN_ACME, TENANT_ACME))
      .send({ name: 'Acme Coffee (renamed)' });

    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe('Acme Coffee (renamed)');
  });
});
