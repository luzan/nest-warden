import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from 'nest-warden/nestjs';
import { MembershipService } from './membership.service.js';
import type { JwtClaims } from './tokens.js';

/**
 * Production-style JWT authentication for the example app. Replaces
 * the previous `FakeAuthGuard` end-to-end.
 *
 * **Trust-boundary contract — read carefully before changing.**
 *
 * The guard does three things, in order, and refuses the request if
 * any of them fail:
 *
 *   1. Verify the JWT signature + freshness via
 *      `JwtService.verifyAsync`. Rejects tampered tokens and
 *      expired tokens.
 *   2. Treat the resulting claims as un-trusted input. Specifically:
 *      `sub` (the user id) and `tenantId` (which tenant the user is
 *      acting as) are accepted; any `roles` claim that happens to
 *      be present is IGNORED.
 *   3. Look up `(sub, tenantId)` in the server-side
 *      `tenant_memberships` table via `MembershipService`. If no
 *      membership row exists, the user has either tampered with the
 *      `tenantId` claim or had their membership revoked since the
 *      token was issued. Either way, 403.
 *
 * On success the guard populates `request.user` with the shape that
 * `app.module.ts`'s `resolveTenantContext` expects:
 *
 *   { userId: string, tenantId: string, roles: readonly string[] }
 *
 * This shape is INTENTIONALLY identical to what `FakeAuthGuard`
 * produced, so the swap is invisible to controllers / policies /
 * the rest of the tenant context plumbing.
 *
 * Common mistakes consumers make that this guard avoids:
 *
 *   - Reading `roles` from the JWT claim instead of the DB. Lets a
 *     stale or forged token retain access after revocation.
 *   - Skipping the `tenantId`-membership cross-check. Lets any user
 *     with a valid token impersonate any tenant by changing the
 *     claim (verification only checks the signature, not the value).
 *   - Wiring the guard at controller scope instead of as
 *     `APP_GUARD`. Leaves un-guarded endpoints by default.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(MembershipService) private readonly memberships: MembershipService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = executionContext.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: { userId: string; tenantId: string; roles: readonly string[] };
    }>();

    const token = this.extractBearerToken(request.headers.authorization);
    if (token === null) {
      throw new UnauthorizedException('Missing or malformed Authorization header.');
    }

    let claims: JwtClaims;
    try {
      claims = await this.jwt.verifyAsync<JwtClaims>(token);
    } catch {
      // verifyAsync throws for invalid signature, expired tokens, malformed
      // payloads, and missing claims. Collapse all four into 401 — the
      // adversary doesn't need to know which one tripped them.
      throw new UnauthorizedException('Invalid or expired token.');
    }

    if (typeof claims.sub !== 'string' || typeof claims.tenantId !== 'string') {
      throw new UnauthorizedException('Token is missing required claims (sub, tenantId).');
    }

    const roles = await this.memberships.findRoles(claims.sub, claims.tenantId);
    if (roles === null) {
      // Distinct from the 401 path above: signature is valid AND the
      // token is fresh, but the user has no membership in the claimed
      // tenant. That's "authentic but unauthorized" → 403.
      throw new ForbiddenException(
        `No active membership for user "${claims.sub}" in tenant "${claims.tenantId}".`,
      );
    }

    request.user = {
      userId: claims.sub,
      tenantId: claims.tenantId,
      roles,
    };
    return true;
  }

  private extractBearerToken(header: string | string[] | undefined): string | null {
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+(.+)$/.exec(header.trim());
    return match?.[1] ?? null;
  }
}
