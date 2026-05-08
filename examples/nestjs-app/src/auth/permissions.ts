import { type MongoAbility } from '@casl/ability';
import type { TenantAbilityBuilder } from 'nest-warden';
import type { TenantContext } from 'nest-warden';

/**
 * Application's action and subject vocabulary. Narrowing the
 * `MongoAbility` generic gives controllers and policy handlers strong
 * IDE support: `ability.can('approve', 'Payment')` autocompletes both
 * arguments.
 */
export type AppAction = 'read' | 'create' | 'update' | 'delete' | 'manage' | 'approve';
export type AppSubject = 'Merchant' | 'Payment' | 'Agent' | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * Centralized rule definition. Called once per request by the library's
 * `TenantAbilityFactory`. The `builder` is pre-bound to the resolved
 * tenant ID, so every `builder.can()` call automatically pins the tenant
 * predicate — no chance of cross-tenant leakage from a forgotten
 * condition.
 *
 * Note the use of `$relatedTo` for graph-based rules: agents see only
 * merchants they are assigned to, regardless of what tenant they belong
 * to. The relationship graph in `app.module.ts` resolves the path into a
 * single SQL `EXISTS` clause when reverse lookups (`accessibleBy`) run.
 */
export function defineAbilities(
  builder: TenantAbilityBuilder<AppAbility>,
  ctx: TenantContext,
): void {
  // -----------------------------------------------------------------
  // Platform admin: cross-tenant read-only access for support staff.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('platform-admin')) {
    builder.crossTenant.can('read', 'Merchant');
    builder.crossTenant.can('read', 'Payment');
    builder.crossTenant.can('read', 'Agent');
  }

  // -----------------------------------------------------------------
  // ISO admin: tenant-wide management within their own tenant.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('iso-admin')) {
    builder.can('manage', 'Merchant');
    builder.can('manage', 'Payment');
    builder.can('manage', 'Agent');
  }

  // -----------------------------------------------------------------
  // Agent: sees only merchants they're assigned to (graph traversal).
  //
  // CASL's `MongoQuery` type doesn't recognize `$relatedTo` since it's
  // an extension introduced by this library. Cast through `never` at the
  // call site to bypass the operator-set check; the runtime compiler
  // recognizes and handles the operator end-to-end. See FINDINGS.md § 6.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', {
      $relatedTo: {
        path: ['agents_of_merchant'],
        where: { id: ctx.subjectId },
      },
    } as never);
    // For payments: traverse Payment → Merchant → Agent.
    builder.can('read', 'Payment', {
      $relatedTo: {
        path: ['merchant_of_payment', 'agents_of_merchant'],
        where: { id: ctx.subjectId },
      },
    } as never);
  }
}
