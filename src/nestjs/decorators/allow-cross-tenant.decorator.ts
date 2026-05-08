import { SetMetadata } from '@nestjs/common';
import { ALLOW_CROSS_TENANT_KEY } from '../tokens.js';

/**
 * Mark a route as deliberately cross-tenant — i.e., the tenant predicate
 * injection is intentionally bypassed for this handler. Combined with a
 * platform-staff role check inside the handler, this is the safe pattern
 * for "support staff impersonating across tenants" or
 * "platform admin viewing aggregate data."
 *
 * The decorator stores the supplied `reasonCode` on the route's metadata
 * so audit-log scrapers can surface every cross-tenant action with its
 * justification.
 *
 * Note: this decorator does NOT bypass the policies guard. The route's
 * `@CheckPolicies(...)` handlers still run; they should typically check
 * `ability.can(...)` against rules created via `builder.crossTenant.*`.
 * The decorator's role is purely declarative — it makes "this route is
 * cross-tenant" a first-class searchable/auditable property of the
 * codebase.
 *
 * @example
 *   @AllowCrossTenant('platform-support-impersonation')
 *   @CheckPolicies(new CanImpersonate())
 *   @Post('admin/impersonate/:userId')
 *   impersonate() { ... }
 */
export const AllowCrossTenant = (reasonCode: string): MethodDecorator =>
  SetMetadata(ALLOW_CROSS_TENANT_KEY, reasonCode);
