import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantMembership } from './tenant-membership.entity.js';

/**
 * Server-side lookup that resolves `(userId, tenantId) → roles[]`.
 *
 * **Trust-boundary contract — read this before changing anything.**
 *
 * The JWT carries `sub` (the user id) and `tenantId` (which tenant
 * the user is acting as on this request). It carries NO role claim,
 * by design. Roles live in the `tenant_memberships` table on the
 * server; this service is the ONLY thing that should be reading them
 * during request handling.
 *
 * Two failure modes the lookup catches that a "trust the token"
 * implementation does not:
 *
 *   1. **Tampered `tenantId`** — a user with a valid signed token
 *      changes the `tenantId` claim to one they have no membership
 *      in. `findRoles` returns `null` and the guard issues 403.
 *   2. **Stale roles** — a role was revoked after the token was
 *      issued but before it expired. The fresh DB read sees the
 *      revocation immediately; a roles-in-token implementation
 *      would honour the stale claim until expiry.
 *
 * The third class — replay of an expired token — is caught by
 * `JwtService.verifyAsync` before this service is reached.
 */
@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(TenantMembership)
    private readonly memberships: Repository<TenantMembership>,
  ) {}

  /**
   * Returns the user's role list for the given tenant, or `null` if
   * no membership exists. The caller (JWT guard) treats `null` as
   * 403 Forbidden.
   *
   * Returning a frozen array would be more defensive but adds noise
   * to the call site for very little gain — the result feeds directly
   * into `ctx.roles` in `resolveTenantContext` and is read-only by
   * convention.
   */
  async findRoles(userId: string, tenantId: string): Promise<readonly string[] | null> {
    const membership = await this.memberships.findOne({
      where: { userId, tenantId },
    });

    if (!membership) {
      return null;
    }

    return membership.roles;
  }
}
