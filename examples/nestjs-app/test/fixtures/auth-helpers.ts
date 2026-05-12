import { JwtService } from '@nestjs/jwt';
import { DEV_JWT_SECRET, type JwtClaims } from '../../src/auth/tokens.js';

/**
 * E2E auth helpers. Mints JWTs with the same `DEV_JWT_SECRET` that
 * `AuthModule` configures — the runtime guard and the test fixture
 * MUST agree on the signing key, otherwise every request 401s with
 * "invalid signature" and the failure mode is hard to read.
 *
 * The fixture instantiates a fresh `JwtService` rather than reaching
 * into the app's DI container: mint operations are pure and need no
 * Nest scaffolding, and a standalone service makes per-test config
 * (e.g., negative `expiresIn` for an already-expired token) trivial.
 */
const jwtService = new JwtService({ secret: DEV_JWT_SECRET });

/**
 * Sign a JWT for the given user + tenant. Token lifetime defaults to
 * 15 minutes — matches the `AuthModule` runtime config. Pass a past
 * `expiresIn` (e.g., `'-1s'`) to mint an already-expired token for
 * adversarial-scenario tests.
 */
export function signTokenFor(
  userId: string,
  tenantId: string,
  options: { expiresIn?: string | number; secret?: string } = {},
): string {
  const claims: Omit<JwtClaims, 'iat' | 'exp'> = { sub: userId, tenantId };
  const signer = options.secret
    ? new JwtService({ secret: options.secret })
    : jwtService;
  return signer.sign(claims, {
    expiresIn: options.expiresIn ?? '15m',
  });
}

/**
 * Build the `Authorization: Bearer <token>` header for supertest.
 * Returns a record so it can be passed straight to `.set(...)`.
 */
export function authHeader(userId: string, tenantId: string): Record<string, string> {
  return { Authorization: `Bearer ${signTokenFor(userId, tenantId)}` };
}
