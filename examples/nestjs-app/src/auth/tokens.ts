/**
 * JWT signing + verification configuration shared by the example app's
 * runtime guard and the E2E test fixtures.
 *
 * The dev secret embedded here is intentionally weak — it lives in
 * source so the example "just runs" without env-var setup. A real
 * deployment MUST override `JWT_SECRET` with a high-entropy value
 * (typically 256-bit base64 or hex from a secret manager) and rotate
 * on compromise. The guard reads the secret from `process.env` via
 * `JwtModule.registerAsync` in `auth.module.ts`, so flipping it in
 * production is one env-var change away.
 */
export const DEV_JWT_SECRET = 'dev-secret-not-for-production';

/**
 * Resolves the active JWT secret. Production callers set `JWT_SECRET`;
 * everything else (E2E suite, `pnpm start:dev`) falls back to
 * `DEV_JWT_SECRET`. Centralised so the guard and the fixture token
 * minter never disagree about which key they're signing with — a
 * common cause of "signature invalid" mysteries in JWT examples.
 */
export function resolveJwtSecret(): string {
  return process.env.JWT_SECRET ?? DEV_JWT_SECRET;
}

/**
 * The claim shape the example mints and verifies. `sub` is the user's
 * `users.id`; `tenantId` is the tenant the user is *acting as* on
 * this request (a single user can hold memberships in multiple
 * tenants and switch context by minting a fresh token with a
 * different `tenantId`).
 *
 * Notably absent: `roles`. Roles are NEVER carried in the token —
 * they're resolved server-side from `tenant_memberships` so a
 * compromised or tampered token can't escalate privileges. The
 * guard enforces this contract; see `jwt.guard.ts` for the lookup.
 */
export interface JwtClaims {
  readonly sub: string;
  readonly tenantId: string;
  readonly iat?: number;
  readonly exp?: number;
}
