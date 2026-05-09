import { definePermissions, defineRoles } from 'nest-warden';
import type { AppAction, AppSubject } from './permissions.js';

/**
 * Permission registry — RFC 001 Phase B demo.
 *
 * Each entry maps a UI-friendly permission name (e.g.,
 * `'merchants:approve-pending'`) onto a CASL `(action, subject,
 * conditions?, fields?)` tuple. The registry is the single source of
 * truth for what permissions exist; system roles and custom roles
 * draw from it.
 *
 * Permissions whose rule shape includes `$relatedTo` (the example's
 * `agent` role) intentionally remain in `permissions.ts` as raw
 * `builder.can(...)` calls. The registry pattern fits cleanly for
 * value-condition rules; relationship-graph rules carry CASL-typing
 * awkwardness (the `as never` cast) that's clearer when expressed
 * inline.
 */
export const permissions = definePermissions<AppAction, AppSubject>({
  'merchants:read': {
    action: 'read',
    subject: 'Merchant',
  },
  'merchants:approve-pending': {
    action: 'approve',
    subject: 'Merchant',
    conditions: { status: 'pending' },
  },
});

export type Permission = keyof typeof permissions;

/**
 * System roles — RFC 001 Phase B demo. The `merchant-approver` role
 * previously lived as an `if (ctx.roles.includes(...))` branch in
 * `permissions.ts`; migrating it to the registry shows the equivalent
 * rule shape via the registry/role pattern.
 *
 * Tenant-managed custom roles will load via `loadCustomRoles` in
 * Phase C — the wiring is the same, just with an extra registry
 * concatenated at request time.
 */
export const systemRoles = defineRoles<Permission>({
  'merchant-approver': {
    description: 'Reads merchants in tenant; approves pending merchants',
    permissions: ['merchants:read', 'merchants:approve-pending'],
  },
});
