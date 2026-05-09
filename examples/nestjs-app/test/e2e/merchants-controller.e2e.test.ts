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
  MERCHANT_M3,
  MERCHANT_M4,
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

  describe('conditional authorization: GET /merchants/approvable', () => {
    // The `merchant-approver` rule is `can('approve', 'Merchant',
    // { status: 'pending' })`. The fixture has m1=active, m2=pending,
    // m3=closed in ACME and m4=active in BETA. Both assertions below
    // are categorical: the SQL emitted by `accessibleBy()` must
    // include `WHERE status = 'pending'`, so non-pending rows never
    // come back even though they exist in the same tenant.

    it('an approver in ACME sees only the pending merchant (m2)', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants/approvable')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['merchant-approver']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toEqual([MERCHANT_M2]);
    });

    it('an approver in BETA sees nothing (BETA has no pending merchants)', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants/approvable')
        .set(fakeAuth('any-user-id', TENANT_BETA, ['merchant-approver']));

      expect(res.status).toBe(200);
      expect(res.body as unknown[]).toEqual([]);
    });
  });

  describe('custom roles loaded at request time (RFC 001 Phase C)', () => {
    // The seed inserts ONE custom role into ACME's `custom_roles`
    // table: `tenant-auditor` with permission `merchants:read`. The
    // role is loaded by `loadCustomRoles` in app.module.ts and
    // expanded by `builder.applyRoles(ctx.roles)` in
    // permissions.ts the same way system roles are.

    it('a user with the tenant-auditor custom role can list ACME merchants', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['tenant-auditor']));

      expect(res.status).toBe(200);
      // tenant-auditor → permissions=['merchants:read'] → sees all
      // ACME merchants the request can read (no $relatedTo, no
      // status filter).
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });

    it('the same role assigned in BETA does nothing — it was registered for ACME only', async () => {
      // BETA's custom_roles table is empty; the loader returns []
      // for BETA. A user with role name 'tenant-auditor' in BETA
      // gets no rule expansion.
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth('any-user-id', TENANT_BETA, ['tenant-auditor']));

      // Without any rules, the policy guard denies — 403 from guard
      // OR a passing 200 with empty body if read happens to be
      // allowed elsewhere. We assert the user gets nothing.
      if (res.status === 200) {
        expect(res.body as unknown[]).toEqual([]);
      } else {
        expect([403, 404]).toContain(res.status);
      }
    });
  });

  describe('multi-role merge: composing rules from multiple roles', () => {
    // CASL composes rules across roles by union. The two assertions
    // below pin down both halves of that contract:
    //
    //   1. The broader rule wins for a given action/subject. Bob is an
    //      `agent` (sees only assigned merchants via $relatedTo) and a
    //      `merchant-approver` (reads everything in tenant). With both
    //      roles he sees ALL ACME merchants — the approver's
    //      unconditional read subsumes the agent's relationship-scoped
    //      read in the union.
    //
    //   2. Conditions stay attached to their originating rule. The
    //      same Bob, listing approvable merchants, gets only the
    //      pending one — the agent role contributes no `approve`
    //      rule, so the approver's `{ status: 'pending' }` predicate
    //      is what runs.

    it('a user with [agent, merchant-approver] sees all merchants in their tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent', 'merchant-approver']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toHaveLength(3); // m1, m2, m3 — agent's $relatedTo doesn't restrict
    });

    it('the same user listing approvable merchants gets only the pending one', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants/approvable')
        .set(fakeAuth(AGENT_BOB, TENANT_ACME, ['agent', 'merchant-approver']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toEqual([MERCHANT_M2]);
    });
  });

  describe('negative authorization: cannot subtracts from can', () => {
    // The `cautious-approver` role grants the same positive
    // `approve Merchant where status=pending` as `merchant-approver`,
    // but adds `cannot('approve', 'Merchant', { name: 'Acme Plumbing' })`.
    // m2 is the only pending merchant in ACME and its name is
    // 'Acme Plumbing' (per the seed), so the cautious approver gets
    // an empty result for /merchants/approvable while the regular
    // approver gets [m2]. The cannot rule is scoped to `approve`; the
    // role's `read` access is unaffected.

    it('a cautious approver gets [] (the only pending merchant is excluded by cannot)', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants/approvable')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['cautious-approver']));

      expect(res.status).toBe(200);
      expect(res.body as unknown[]).toEqual([]);
    });

    it('the same cautious approver can still read all merchants — cannot is action-scoped', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['cautious-approver']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id);
      expect(ids).toHaveLength(3); // m1, m2, m3 — read rule has no cannot counterpart
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

  describe('field-level restrictions: GET /merchants/:id/projected', () => {
    // CASL's `permittedFieldsOf` intersects the field arrays of every
    // matching rule. The merchant-viewer-public role grants
    // `can('read', 'Merchant', ['id', 'name', 'status'])` — only those
    // three fields appear in the response. iso-admin's `manage`
    // (no field list) grants every field.

    it('a public viewer sees only id, name, and status', async () => {
      const res = await request(app.getHttpServer())
        .get(`/merchants/${MERCHANT_M1}/projected`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['merchant-viewer-public']));

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body as Record<string, unknown>).sort();
      expect(keys).toEqual(['id', 'name', 'status']);
    });

    it('an iso-admin sees every field on the same projected endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get(`/merchants/${MERCHANT_M1}/projected`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body as Record<string, unknown>).sort();
      expect(keys).toEqual(['createdAt', 'id', 'name', 'status', 'tenantId']);
    });
  });

  // -----------------------------------------------------------------
  // Mutating endpoints. This block runs LAST so writes don't disturb
  // earlier read-only assertions: PATCH targets m1 and DELETE targets
  // m3, both of which are not asserted on by name in any earlier
  // test (only counted in the iso-admin assertion, which has already
  // run by the time this block executes).
  // -----------------------------------------------------------------
  describe('mutating endpoints: PATCH and DELETE', () => {
    it('an iso-admin can update an in-tenant merchant', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/merchants/${MERCHANT_M1}`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']))
        .send({ status: 'closed' });

      expect(res.status).toBe(200);
      expect((res.body as { id: string; status: string }).status).toBe('closed');
    });

    it('an agent (no update rule) is denied by the policy guard', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/merchants/${MERCHANT_M1}`)
        .set(fakeAuth(AGENT_ALICE, TENANT_ACME, ['agent']))
        .send({ status: 'active' });
      expect([403, 404]).toContain(res.status);
    });

    it('an iso-admin patching a cross-tenant merchant gets 404 (existence not leaked)', async () => {
      // ACME admin attempting to PATCH m4 (BETA tenant). The service's
      // tenant-scoped findOne returns null, so the service throws
      // NotFoundException — same response shape as for an unknown id.
      const res = await request(app.getHttpServer())
        .patch(`/merchants/${MERCHANT_M4}`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']))
        .send({ status: 'closed' });
      expect(res.status).toBe(404);
    });

    it('an iso-admin can delete an in-tenant merchant', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/merchants/${MERCHANT_M3}`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(204);

      // Confirm it's gone.
      const followUp = await request(app.getHttpServer())
        .get(`/merchants/${MERCHANT_M3}`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));
      expect(followUp.status).toBe(404);
    });

    it('an iso-admin deleting a cross-tenant merchant gets 404', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/merchants/${MERCHANT_M4}`)
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));
      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------
  // Soft-delete behavior. Runs after the mutating-endpoints block —
  // the prior describe issued DELETE on m3, which now sets the
  // `deleted_at` column instead of issuing a SQL DELETE. The two
  // assertions below verify both halves of the contract:
  //
  //   - default reads exclude soft-deleted rows (TypeORM applies
  //     `WHERE deletedAt IS NULL` automatically; accessibleBy()
  //     composes via AND).
  //   - opt-in surfaces them again with the tenant predicate and
  //     authorization predicate still applied.
  // -----------------------------------------------------------------
  describe('soft delete: deleted rows hidden by default, surfaced via withDeleted', () => {
    it('default listing excludes the soft-deleted merchant', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      // m3 was soft-deleted by the prior describe; only m1 and m2
      // come back.
      expect(ids).toEqual([MERCHANT_M1, MERCHANT_M2].sort());
    });

    it('with_deleted=true surfaces soft-deleted rows (still tenant-scoped)', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants?with_deleted=true')
        .set(fakeAuth('any-user-id', TENANT_ACME, ['iso-admin']));

      expect(res.status).toBe(200);
      const ids = (res.body as { id: string }[]).map((r) => r.id).sort();
      // All three ACME merchants reappear; m4 (BETA) stays
      // excluded by the tenant predicate.
      expect(ids).toEqual([MERCHANT_M1, MERCHANT_M2, MERCHANT_M3].sort());
    });
  });
});
