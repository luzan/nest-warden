import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startPostgresWithSchema } from '../fixtures/postgres-fixture.js';
import { authHeader, signTokenFor } from '../fixtures/auth-helpers.js';
import {
  TENANT_ACME,
  TENANT_BETA,
  USER_ISO_ADMIN_ACME,
  USER_PAT,
  USER_STRANGER,
  seedFixture,
} from '../fixtures/seed.js';
import { AppModule } from '../../src/app.module.js';
import { setExampleDataSourceConfig } from '../../src/database/datasource.config.js';
import type { DataSource } from 'typeorm';

/**
 * Auth-layer E2E. Exercises `JwtAuthGuard` end-to-end against a real
 * Postgres + the `tenant_memberships` table. Companion to the
 * security-hardening test plan in
 * `docs/pages/docs/roadmap/things-to-do.md` § Theme 7 (this is
 * PR A — production-style JWT auth).
 *
 * Theme 7 PR E will fill in the `describe.skip` block at the bottom
 * with the adversarial scenarios (tampered signature, expired token,
 * no-membership claim). Each placeholder names the failure mode it
 * will assert so the wiring of the future PR is unambiguous.
 */
describe('JWT auth — happy path + missing-header rejection', () => {
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

  describe('happy path', () => {
    it('a valid token for a user with a membership returns 200', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(authHeader(USER_ISO_ADMIN_ACME, TENANT_ACME));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('the SAME user gets DIFFERENT roles depending on the tenantId claim', async () => {
      // Pat is iso-admin in ACME and merchant-viewer-public in BETA.
      // The role list is sourced from `tenant_memberships`, not from
      // the JWT — so flipping `tenantId` in the token shifts Pat's
      // role set without any change to the token's other claims.
      // This is the load-bearing property of the trust-boundary
      // contract: roles are not carried in the token.

      const acmeResponse = await request(app.getHttpServer())
        .get('/merchants')
        .set(authHeader(USER_PAT, TENANT_ACME));

      const betaResponse = await request(app.getHttpServer())
        .get('/merchants')
        .set(authHeader(USER_PAT, TENANT_BETA));

      expect(acmeResponse.status).toBe(200);
      expect(betaResponse.status).toBe(200);
      // ACME: iso-admin sees all 3 ACME merchants (m1, m2, m3-or-deleted).
      // BETA: merchant-viewer-public sees the 1 BETA merchant (m4).
      const acmeIds = (acmeResponse.body as { id: string }[]).map((r) => r.id);
      const betaIds = (betaResponse.body as { id: string }[]).map((r) => r.id);
      expect(acmeIds.length).toBeGreaterThanOrEqual(1);
      expect(betaIds).toHaveLength(1);
      // Critically: no ACME id appears in BETA's response, and vice
      // versa. The cross-tenant leak the trust boundary prevents.
      for (const id of betaIds) expect(acmeIds).not.toContain(id);
    });
  });

  describe('rejection paths', () => {
    it('missing Authorization header → 401', async () => {
      const res = await request(app.getHttpServer()).get('/merchants');
      expect(res.status).toBe(401);
    });

    it('malformed Authorization header (not "Bearer …") → 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set('Authorization', 'Basic abc123');
      expect(res.status).toBe(401);
    });

    it('valid token but user has no membership in the claimed tenant → 403', async () => {
      // Stranger is in `users` but has no row in
      // `tenant_memberships` for either tenant. `JwtService.verifyAsync`
      // accepts the token (signature + freshness check), but the
      // server-side lookup returns no membership → 403.
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(authHeader(USER_STRANGER, TENANT_ACME));
      expect(res.status).toBe(403);
    });

    it('valid token but user has no membership in the WRONG tenant → 403', async () => {
      // Pat has memberships in BOTH tenants but neither covers
      // a third (synthetic) tenant id. The membership lookup must
      // return `null` for any (sub, tenantId) pair without a row,
      // including pairs where `sub` exists in the membership table
      // for other tenants.
      const FAKE_TENANT = '99999999-9999-9999-9999-999999999999';
      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set(authHeader(USER_PAT, FAKE_TENANT));
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------
  // Theme 7 PR E — adversarial JWT scenarios.
  //
  // The four placeholders below name the failure modes PR E will fill
  // in. They run zero assertions today (the block is skipped) but the
  // structure mirrors the rejection-paths block above so the future
  // PR has a clear shape to follow. Each scenario has a one-line
  // description of the expected status + reason; the PR's job is to
  // turn each `it.skip` into a real assertion.
  // -------------------------------------------------------------------
  describe.skip('Theme 7 PR E — adversarial scenarios (TODO)', () => {
    it.skip('tampered payload (mutate sub after sign) → 401', () => {
      // Sign a token, base64-decode the payload, change `sub`, re-
      // base64-encode, reassemble. The signature now fails to verify
      // because it was computed over the original payload.
      // Expected: `JwtService.verifyAsync` throws → guard 401.
    });

    it.skip('tampered signature (swap signing key) → 401', () => {
      // Sign the token with a DIFFERENT secret (e.g., 'evil-secret')
      // and send it. The guard's `verifyAsync` rejects it.
      // Use the `secret` option of `signTokenFor` to mint:
      //   signTokenFor(USER_PAT, TENANT_ACME, { secret: 'evil-secret' })
      void signTokenFor; // keep import used while the test is skipped
    });

    it.skip('expired token → 401', () => {
      // Mint a token with negative `expiresIn`:
      //   signTokenFor(USER_PAT, TENANT_ACME, { expiresIn: '-1s' })
      // The guard's `verifyAsync` should reject it as expired.
    });

    it.skip('algorithm-confusion attack (alg: "none") → 401', () => {
      // Manually construct a JWT with header `{ "alg": "none" }`
      // and an empty signature segment. `verifyAsync` rejects
      // because the configured algorithm is HS256.
    });
  });
});
