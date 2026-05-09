import { definePermissions, defineRoles } from 'nest-warden';
import type { AppAction, AppSubject } from './permissions.js';

/**
 * Permission registry — RFC 001 Phases B + D.
 *
 * Each entry maps a UI-friendly permission name (e.g.,
 * `'merchants:approve-pending'`) onto a CASL `(action, subject,
 * conditions?, fields?, crossTenant?)` tuple. The registry is the
 * single source of truth for what permissions exist; system roles
 * and tenant-managed custom roles both draw from it.
 *
 * Permissions are grouped by subject for readability. The naming
 * convention is `<subject>:<verb>[-<modifier>]`:
 *   - `merchants:read`           — read any merchant in the tenant
 *   - `merchants:read-public`    — read but with field projection
 *   - `merchants:approve-pending`— approve only pending merchants
 *   - `merchants:manage`         — manage = all actions
 *   - `platform:*`               — cross-tenant permissions (RFC § Q3)
 *
 * Two roles in the example intentionally REMAIN INLINE in
 * `permissions.ts` rather than moving here:
 *
 *   - `agent`            — the `$relatedTo` rule references
 *                          `ctx.subjectId`, a per-request value.
 *                          Custom roles in the registry are static
 *                          at definition time; closures over
 *                          per-request data don't fit. Phase D
 *                          documents this trade-off rather than
 *                          forcing it.
 *   - `cautious-approver`— mixes `can` + `cannot` rules.
 *                          `PermissionDef` doesn't carry a `negate`
 *                          flag (RFC 001 § Q2 — per-permission only,
 *                          no negation), so the role is half-
 *                          expressible through the registry. Keeping
 *                          it inline is clearer than splitting.
 */
export const permissions = definePermissions<AppAction, AppSubject>({
  // -----------------------------------------------------------------
  // Merchant permissions
  // -----------------------------------------------------------------
  'merchants:read': {
    action: 'read',
    subject: 'Merchant',
  },
  'merchants:read-public': {
    action: 'read',
    subject: 'Merchant',
    fields: ['id', 'name', 'status'],
  },
  'merchants:approve-pending': {
    action: 'approve',
    subject: 'Merchant',
    conditions: { status: 'pending' },
  },
  'merchants:manage': {
    action: 'manage',
    subject: 'Merchant',
  },

  // -----------------------------------------------------------------
  // Payment permissions
  // -----------------------------------------------------------------
  'payments:manage': {
    action: 'manage',
    subject: 'Payment',
  },

  // -----------------------------------------------------------------
  // Agent permissions (records, not the user role)
  // -----------------------------------------------------------------
  'agents:manage': {
    action: 'manage',
    subject: 'Agent',
  },

  // -----------------------------------------------------------------
  // Platform staff — cross-tenant read access. The `crossTenant: true`
  // flag opts each permission out of the auto-injected tenant
  // predicate. Tenant-resolution still happens; the rule simply
  // doesn't filter on `tenantId`.
  // -----------------------------------------------------------------
  'platform:read-merchants': {
    action: 'read',
    subject: 'Merchant',
    crossTenant: true,
  },
  'platform:read-payments': {
    action: 'read',
    subject: 'Payment',
    crossTenant: true,
  },
  'platform:read-agents': {
    action: 'read',
    subject: 'Agent',
    crossTenant: true,
  },
});

export type Permission = keyof typeof permissions;

/**
 * System roles. Migrated from the inline `if (ctx.roles.includes(...))`
 * branches in `permissions.ts` (Phase D). The roles below are
 * stable, code-defined, and apply across all tenants. Tenant-managed
 * custom roles load via `loadCustomRoles` in `app.module.ts` — they
 * draw from the same permission registry but their names and
 * compositions are per-tenant.
 *
 * RFC 001 § Q4 — system role names are reserved. A custom role
 * carrying the same name as a system role is dropped at validation
 * time (the system role wins).
 */
export const systemRoles = defineRoles<Permission>({
  'platform-admin': {
    description: 'Cross-tenant read access for support staff',
    permissions: [
      'platform:read-merchants',
      'platform:read-payments',
      'platform:read-agents',
    ],
  },
  'iso-admin': {
    description: 'Full tenant management (manage = all actions)',
    permissions: [
      'merchants:manage',
      'payments:manage',
      'agents:manage',
    ],
  },
  'merchant-approver': {
    description: 'Reads merchants in tenant; approves pending merchants',
    permissions: ['merchants:read', 'merchants:approve-pending'],
  },
  'merchant-viewer-public': {
    description:
      'Read access limited to id/name/status fields (field-level restriction demo)',
    permissions: ['merchants:read-public'],
  },
});
