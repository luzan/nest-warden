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
  // Each test takes a known-attack shape and asserts the guard rejects
  // it with 401. Together they pin the four properties a JWT-based
  // auth layer cannot afford to get wrong:
  //
  //   - The signature actually protects the payload (tampered-payload
  //     attack).
  //   - The signing key is checked, not just decoded (tampered-
  //     signature attack).
  //   - Token freshness is enforced (expired-token attack).
  //   - The algorithm allow-list is enforced (alg-confusion / alg:none
  //     attack).
  //
  // All four are routine "things to test" in any production JWT setup
  // — codifying them here so a future refactor of `JwtAuthGuard` or
  // `auth.module.ts`'s `JwtModule.registerAsync` config can't
  // silently regress any of them.
  // -------------------------------------------------------------------
  describe('Theme 7 PR E — adversarial scenarios', () => {
    /**
     * Build a fresh base64url-encoded JWT segment from any object.
     * `Buffer.toString('base64url')` already omits padding per the
     * JWS spec, so no manual `/=$/g`-stripping is needed.
     */
    const b64url = (value: object): string =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    it('tampered payload (mutate `sub` after signing) → 401', async () => {
      // Sign a valid token, decode the payload, mutate `sub`, re-
      // encode the payload, reassemble with the ORIGINAL signature.
      // The signature was computed over the original payload; the
      // verifier recomputes the HMAC over the new payload and the
      // mismatch trips the check.
      const validToken = signTokenFor(USER_ISO_ADMIN_ACME, TENANT_ACME);
      const [header, payload, signature] = validToken.split('.');
      if (!header || !payload || !signature) throw new Error('unexpected token shape');

      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        sub: string;
        tenantId: string;
        exp?: number;
        iat?: number;
      };
      decoded.sub = 'cccccccc-cccc-cccc-cccc-cccccccc9999'; // an arbitrary forged id
      const tamperedPayload = b64url(decoded);
      const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set('Authorization', `Bearer ${tamperedToken}`);
      expect(res.status).toBe(401);
    });

    it('tampered signature (signed with a different secret) → 401', async () => {
      // Mint a token using a DIFFERENT signing key. Header and payload
      // shape are valid (algorithm, exp, etc.) — only the signature
      // doesn't verify under the guard's configured secret.
      const evilToken = signTokenFor(USER_ISO_ADMIN_ACME, TENANT_ACME, {
        secret: 'evil-secret-not-the-real-one',
      });

      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set('Authorization', `Bearer ${evilToken}`);
      expect(res.status).toBe(401);
    });

    it('expired token (negative `expiresIn`) → 401', async () => {
      // jsonwebtoken's `verify` rejects tokens whose `exp` is in the
      // past. The `-1s` lifetime mints a token that's already expired
      // by the time the request arrives — no real-time wait needed.
      const expiredToken = signTokenFor(USER_ISO_ADMIN_ACME, TENANT_ACME, {
        expiresIn: '-1s',
      });

      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    it('algorithm-confusion attack (alg: "none") → 401', async () => {
      // Manually build a token whose header advertises `alg: "none"`
      // and whose signature segment is empty. The classic 2015-era
      // JWT vulnerability was that some verifiers accepted this when
      // no explicit `algorithms` allow-list was configured — they'd
      // see `alg: none` and skip signature verification entirely.
      //
      // `auth.module.ts` configures `verifyOptions: { algorithms:
      // ['HS256'] }` on the JwtModule, so any token whose header
      // declares an algorithm outside the allow-list is rejected
      // before the (empty) signature is even consulted.
      const header = b64url({ alg: 'none', typ: 'JWT' });
      const payload = b64url({
        sub: USER_ISO_ADMIN_ACME,
        tenantId: TENANT_ACME,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
      });
      const noneToken = `${header}.${payload}.`; // intentionally empty signature

      const res = await request(app.getHttpServer())
        .get('/merchants')
        .set('Authorization', `Bearer ${noneToken}`);
      expect(res.status).toBe(401);
    });
  });
});
