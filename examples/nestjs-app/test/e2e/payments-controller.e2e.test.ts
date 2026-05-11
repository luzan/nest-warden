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
  PAYMENT_P1,
  PAYMENT_P2,
  PAYMENT_P3,
  PAYMENT_P4,
  PAYMENT_P5,
  PAYMENT_P6,
  TENANT_ACME,
  TENANT_BETA,
  seedFixture,
} from '../fixtures/seed.js';
import { AppModule } from '../../src/app.module.js';
import { setExampleDataSourceConfig } from '../../src/database/datasource.config.js';
import type { DataSource } from 'typeorm';

/**
 * End-to-end tests for the payments endpoints. The payments module is
 * the second domain in the example (merchants being the first); its
 * primary purpose is to exercise the multi-hop relationship path
 * `Payment → Merchant → Agent` end-to-end against real Postgres.
 *
 * What this file covers:
 *
 *   1. **Cross-tenant isolation on reverse lookup.** ACME agents and
 *      ISO admins never see BETA payments, and vice versa. The library
 *      injects `tenantId` on every rule; the SQL emitted by
 *      `accessibleBy()` carries the predicate.
 *
 *   2. **Graph scoping via `$relatedTo`.** An agent's payment access
 *      compiles into a two-hop EXISTS chain
 *      (`merchant_of_payment → agents_of_merchant`) so Bob (assigned
 *      only to m2) sees exactly the payments belonging to m2 — not
 *      m1's payments, even though they're in the same tenant.
 *
 *   3. **Conditional state transition.** Capturing a payment requires
 *      the status to be `authorized` (rule:
 *      `can('update', 'Payment', { status: 'authorized' })`). Already-
 *      captured payments return 404 from the service (existence not
 *      leaked).
 *
 *   4. **Negative authorization with a threshold.** The
 *      `cautious-refunder` role grants
 *      `can('refund', 'Payment')` then subtracts
 *      `cannot('refund', 'Payment', { amountCents: { $gt: 10000 } })`.
 *      Refunds of payments ≤ $100 succeed; refunds of payments above
 *      that threshold are rejected, even though the positive grant
 *      would otherwise permit them.
 *
 *   5. **Forward-check vs reverse-lookup parity.** For every payment in
 *      the fixture, `GET /payments/:id` (forward check) agrees with
 *      whether the same payment appears in `GET /payments` (reverse
 *      lookup). Catches matcher/SQL-compiler divergence.
 */
describe('GET/POST /payments — multi-tenant access control', () => {
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

  describe('reverse lookup: GET /payments (list)', () => {
    // ACME payments per the seed: p1 (m1, $50, captured), p2 (m1, $120,
    // pending), p3 (m2, $75, captured), p5 (m1, $80, authorized),
    // p6 (m2, $250, captured). BETA has only p4 (m4, $99.99,
    // authorized).
    //
    // Agent assignments:
    //   alice → m1 + m2  → can see p1, p2, p3, p5, p6
    //   bob   → m2       → can see p3, p6
    //   carol → m4       → can see p4

    it('Alice (ACME agent, assigned to m1+m2) sees every ACME payment via the two-hop graph', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set(fakeAuth(AGENT_ALICE, TENANT_ACME, ['agent']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      expect(ids).toEqual([PAYMENT_P1, PAYMENT_P2, PAYMENT_P3, PAYMENT_P5, PAYMENT_P6].sort());
    });

    it('Bob (ACME agent, assigned only to m2) sees only m2 payments', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      expect(ids).toEqual([PAYMENT_P3, PAYMENT_P6].sort());
    });

    it('Carol (BETA agent) sees only BETA payments — zero ACME rows', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set(fakeAuth(AGENT_CAROL, TENANT_BETA, ['agent']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toEqual([PAYMENT_P4]);
    });

    it('an ISO admin (ACME) sees every ACME payment via `manage`', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      expect(ids).toEqual([PAYMENT_P1, PAYMENT_P2, PAYMENT_P3, PAYMENT_P5, PAYMENT_P6].sort());
    });

    it('a platform-admin sees every payment across tenants (cross-tenant opt-out)', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['platform-admin']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      expect(ids).toEqual(
        [PAYMENT_P1, PAYMENT_P2, PAYMENT_P3, PAYMENT_P4, PAYMENT_P5, PAYMENT_P6].sort(),
      );
    });
  });

  describe('forward check: GET /payments/:id', () => {
    // The forward path: load the row tenant-scoped, then run
    // `ability.can('read', payment)`. The service falls back to an
    // EXISTS query for `$relatedTo` rules because in-memory matching
    // can't traverse the agent-merchant join.

    it('Alice can read p1 (in m1, assigned)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${PAYMENT_P1}`)
        .set(fakeAuth(AGENT_ALICE, TENANT_ACME, ['agent']));
      expect(res.status).toBe(200);
      expect((res.body as { id: string }).id).toBe(PAYMENT_P1);
    });

    it('Bob cannot read p1 (in m1, not assigned to m1)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${PAYMENT_P1}`)
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent']));
      expect([403, 404]).toContain(res.status);
    });

    it('Bob can read p3 (in m2, assigned)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${PAYMENT_P3}`)
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent']));
      expect(res.status).toBe(200);
      expect((res.body as { id: string }).id).toBe(PAYMENT_P3);
    });

    it('Carol (BETA) cannot read p1 (ACME) — cross-tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${PAYMENT_P1}`)
        .set(fakeAuth(AGENT_CAROL, TENANT_BETA, ['agent']));
      // RLS makes the row invisible; service returns 404.
      expect([403, 404]).toContain(res.status);
    });
  });

  describe('conditional state transition: POST /payments/:id/capture', () => {
    // The `payment-approver` role grants
    // `can('update', 'Payment', { status: 'authorized' })`. The
    // emitted rule's `status: 'authorized'` predicate is what
    // matters: only authorized payments can be captured. Already-
    // captured payments return 404 (existence not leaked; the
    // policy guard treats the row as un-actionable).

    it('an approver in ACME can capture p5 (status=authorized)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${PAYMENT_P5}/capture`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['payment-approver']));

      expect(res.status).toBe(200);
      expect((res.body as { id: string; status: string }).status).toBe('captured');
    });

    it('the same approver cannot capture p1 (status=captured already) — 404', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${PAYMENT_P1}/capture`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['payment-approver']));

      expect([403, 404]).toContain(res.status);
    });

    it('cross-tenant capture returns 404 (existence not leaked)', async () => {
      // ACME approver attempting to capture p4 (BETA, authorized).
      // Tenant predicate kicks in before the status check.
      const res = await request(app.getHttpServer())
        .post(`/payments/${PAYMENT_P4}/capture`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['payment-approver']));

      expect(res.status).toBe(404);
    });
  });

  describe('negative authorization: cautious-refunder refund threshold', () => {
    // The `cautious-refunder` inline role builds:
    //   builder.can('read', 'Payment');
    //   builder.can('refund', 'Payment');
    //   builder.cannot('refund', 'Payment', {
    //     amountCents: { $gt: 10000 }
    //   });
    //
    // p1 = $50  → under threshold → refund allowed
    // p3 = $75  → under threshold → refund allowed
    // p6 = $250 → over threshold  → refund blocked

    it('a cautious refunder can refund p1 ($50, under threshold)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${PAYMENT_P1}/refund`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['cautious-refunder']));

      expect(res.status).toBe(200);
      expect((res.body as { id: string; status: string }).status).toBe('refunded');
    });

    it('the same cautious refunder cannot refund p6 ($250, over threshold)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${PAYMENT_P6}/refund`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['cautious-refunder']));

      expect([403, 404]).toContain(res.status);
    });

    it('a vanilla payment-approver CAN refund p6 — no threshold rule on that role', async () => {
      // Sanity check that the cannot belongs to the role, not the
      // amount. A different role with the same refund permission and
      // no negative rule should succeed.
      const res = await request(app.getHttpServer())
        .post(`/payments/${PAYMENT_P6}/refund`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['payment-approver']));

      expect(res.status).toBe(200);
      expect((res.body as { id: string; status: string }).status).toBe('refunded');
    });
  });

  describe('forward-check / reverse-lookup parity', () => {
    // For every fixture payment, ensure that whether the row appears
    // in `GET /payments` (reverse lookup via accessibleBy SQL) agrees
    // with whether `GET /payments/:id` returns 200 (forward check via
    // ability.can / accessibleBy fallback). Catches matcher / SQL-
    // compiler divergence — the class of bug that's nearly impossible
    // to find by hand because both halves look "obviously correct"
    // in isolation.

    it('Alice: every payment in the list is readable individually', async () => {
      const auth = fakeAuth(AGENT_ALICE, TENANT_ACME, ['agent']);

      const list = await request(app.getHttpServer()).get('/payments').set(auth);
      expect(list.status).toBe(200);
      const visibleIds = (list.body as { id: string }[]).map((r) => r.id);

      // Every id in the list must be readable via the forward path.
      for (const id of visibleIds) {
        const single = await request(app.getHttpServer()).get(`/payments/${id}`).set(auth);
        expect(single.status).toBe(200);
      }

      // And every fixture payment NOT in Alice's visible set must be
      // unreadable individually. Use the full ACME + BETA seed set.
      const acmePayments = [PAYMENT_P1, PAYMENT_P2, PAYMENT_P3, PAYMENT_P5, PAYMENT_P6];
      const betaPayments = [PAYMENT_P4];
      const fixtureAll = [...acmePayments, ...betaPayments];
      const invisible = fixtureAll.filter((id) => !visibleIds.includes(id));
      for (const id of invisible) {
        const single = await request(app.getHttpServer()).get(`/payments/${id}`).set(auth);
        expect([403, 404]).toContain(single.status);
      }
    });
  });
});
