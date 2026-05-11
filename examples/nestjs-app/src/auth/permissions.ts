import { type MongoAbility } from '@casl/ability';
import type { TenantAbilityBuilder } from 'nest-warden';
import type { TenantContext } from 'nest-warden';

/**
 * Application's action and subject vocabulary. Narrowing the
 * `MongoAbility` generic gives controllers and policy handlers strong
 * IDE support: `ability.can('approve', 'Payment')` autocompletes both
 * arguments.
 */
export type AppAction =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'manage'
  | 'approve'
  | 'refund';
export type AppSubject = 'Merchant' | 'Payment' | 'Agent' | 'all';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * Centralized rule definition. Called once per request by the library's
 * `TenantAbilityFactory`. The `builder` is pre-bound to the resolved
 * tenant ID, so every `builder.can()` call automatically pins the tenant
 * predicate.
 *
 * **The hybrid pattern** — most roles are defined in
 * `permission-registry.ts` and applied here via `builder.applyRoles`.
 * Two roles intentionally remain inline because their rule shape
 * doesn't fit `PermissionDef` cleanly:
 *
 *   - `agent` — uses `$relatedTo` with a `where` that closes over
 *     `ctx.subjectId` (a per-request value). The registry stores
 *     static permission shapes; a closure over per-request data
 *     can't be expressed there.
 *   - `cautious-approver` — combines `can` with `cannot`.
 *     `PermissionDef` is positive-only by RFC 001 design.
 *
 * Both styles compose cleanly: rules emitted by `applyRoles` and
 * rules emitted by raw `builder.can/cannot` go into the same rule
 * list, deduplicate by CASL's normal merging, and respect the
 * tenant-predicate auto-injection identically.
 */
export function defineAbilities(
  builder: TenantAbilityBuilder<AppAbility>,
  ctx: TenantContext,
): void {
  // -----------------------------------------------------------------
  // Registry-driven roles (Phase B + C).
  //
  // `applyRoles` resolves each name in ctx.roles against:
  //   1. The system-role registry exported from
  //      `permission-registry.ts` — loaded statically at module
  //      init.
  //   2. The tenant-managed custom roles loaded by
  //      `loadCustomRoles` in `app.module.ts` from the
  //      `custom_roles` table.
  //
  // Names not found in either registry are silently dropped (RFC §
  // Q4 — forward compatibility for live JWTs after a role is added
  // or removed).
  //
  // System roles defined here:
  //   - platform-admin       (cross-tenant read for support staff)
  //   - iso-admin            (manage Merchant/Payment/Agent in tenant)
  //   - merchant-approver    (read + approve pending merchants)
  //   - merchant-viewer-public (field-projected read)
  // -----------------------------------------------------------------
  builder.applyRoles(ctx.roles);

  // -----------------------------------------------------------------
  // Inline role: `agent` — graph-traversal via $relatedTo.
  //
  // The condition references ctx.subjectId, a per-request value.
  // The permission registry stores static shapes and can't capture
  // closures over request context, so the agent rule lives here as
  // a direct builder call. CASL's `MongoQuery` type doesn't
  // recognize `$relatedTo` (it's a nest-warden extension), so the
  // call site casts through `never` to satisfy the type checker;
  // the runtime compiler handles the operator end-to-end. See
  // FINDINGS.md § 6.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('agent')) {
    builder.can('read', 'Merchant', {
      $relatedTo: {
        path: ['agents_of_merchant'],
        where: { id: ctx.subjectId },
      },
    } as never);
    // Payments: traverse Payment → Merchant → Agent.
    builder.can('read', 'Payment', {
      $relatedTo: {
        path: ['merchant_of_payment', 'agents_of_merchant'],
        where: { id: ctx.subjectId },
      },
    } as never);
  }

  // -----------------------------------------------------------------
  // Inline role: `cautious-approver` — negative authorization.
  //
  // `PermissionDef` is positive-only (RFC 001 § Q2). A role that
  // mixes `can` + `cannot` rules can't be expressed through the
  // registry, so this role lives inline.
  //
  // Behavior: can read all, can approve pending, but the `cannot`
  // rule subtracts a specific merchant by name. The cannot wins
  // even though `merchant-approver` has overlapping positive grants.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('cautious-approver')) {
    builder.can('read', 'Merchant');
    builder.can('approve', 'Merchant', { status: 'pending' } as never);
    builder.cannot('approve', 'Merchant', { name: 'Acme Plumbing' } as never);
  }

  // -----------------------------------------------------------------
  // Inline role: `cautious-refunder` — negative authorization on a
  // numeric threshold.
  //
  // Mirrors `cautious-approver` but for payments: read all payments,
  // refund all payments, BUT cannot refund payments whose
  // `amountCents` exceeds 10 000 (US$100). The `cannot` rule overrides
  // the positive `refund` grant for matching rows, regardless of how
  // the role was assigned.
  //
  // Lives inline because `PermissionDef` is positive-only (RFC 001 §
  // Q2). A role mixing `can` + `cannot` can't be expressed through
  // the registry; the hybrid pattern (registry-driven roles + inline
  // closures for negative rules) is the documented escape hatch.
  // -----------------------------------------------------------------
  if (ctx.roles.includes('cautious-refunder')) {
    builder.can('read', 'Payment');
    builder.can('refund', 'Payment');
    builder.cannot('refund', 'Payment', {
      amountCents: { $gt: 10000 },
    } as never);
  }
}
