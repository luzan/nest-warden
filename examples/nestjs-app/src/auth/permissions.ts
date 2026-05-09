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

  // -----------------------------------------------------------------
  // Merchant approver: a tenant-scoped role demonstrating CONDITIONAL
  // authorization. Read is unconditional within the tenant, but
  // `approve` only matches merchants whose status is 'pending'. The
  // condition flows through both forward checks (in-memory matcher)
  // and reverse lookups (compiled to a SQL `WHERE status = 'pending'`
  // by `accessibleBy()`).
  // -----------------------------------------------------------------
  // -----------------------------------------------------------------
  // Merchant approver — registry-based (RFC 001 Phase B).
  //
  // Defined in `permission-registry.ts` as
  //   'merchants:read'             → can read Merchant
  //   'merchants:approve-pending'  → can approve Merchant where
  //                                  status='pending'
  // and bundled into the `merchant-approver` system role.
  //
  // `applyRoles` walks `ctx.roles`, expands each into rules, attaches
  // a `reason` field to every emitted rule for future audit-log
  // attribution. Unknown role names are silently dropped, so this
  // call is safe to invoke with the full role list — the other roles
  // (handled below as raw `builder.can` calls) won't conflict.
  // -----------------------------------------------------------------
  builder.applyRoles(ctx.roles);

  // -----------------------------------------------------------------
  // Cautious approver: demonstrates NEGATIVE authorization. Same
  // positive grant as `merchant-approver` (approve pending), but
  // adds a `cannot` rule that subtracts a specific merchant by name.
  // The negative rule composes with the positive one — for the
  // forbidden row, `cannot` wins regardless of role count.
  //
  // The `cannot` is scoped to the `approve` action only; the role's
  // `read` access is unaffected.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('cautious-approver')) {
    builder.can('read', 'Merchant');
    builder.can('approve', 'Merchant', { status: 'pending' } as never);
    builder.cannot('approve', 'Merchant', { name: 'Acme Plumbing' } as never);
  }

  // -----------------------------------------------------------------
  // Public viewer: demonstrates FIELD-LEVEL authorization. The role
  // can read merchants in their tenant, but only specific fields:
  // id, name, and status. tenantId and createdAt are not exposed.
  // The library doesn't auto-mask responses — the controller uses
  // CASL's `permittedFieldsOf` to project the loaded entity before
  // returning it. See merchants.service#findOneProjected.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('merchant-viewer-public')) {
    builder.can('read', 'Merchant', ['id', 'name', 'status']);
  }
}
