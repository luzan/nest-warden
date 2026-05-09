import { describe, expect, it } from 'vitest';
import { createMongoAbility, type MongoAbility } from '@casl/ability';
import { TenantAbilityBuilder } from '../../../src/core/tenant-ability.builder.js';
import { definePermissions, defineRoles } from '../../../src/core/permissions/index.js';
import { MultiTenantCaslError, UnknownPermissionError } from '../../../src/core/errors.js';
import type { TenantContext } from '../../../src/core/tenant-context.js';

type AppAction = 'read' | 'approve' | 'manage';
type AppSubject = 'Merchant' | 'Payment';
type AppAbility = MongoAbility<[AppAction, AppSubject]>;

const ctx: TenantContext<string> = { tenantId: 't1', subjectId: 'u1', roles: ['admin'] };

const permissions = definePermissions<AppAction, AppSubject>({
  'merchants:read': { action: 'read', subject: 'Merchant' },
  'merchants:approve': {
    action: 'approve',
    subject: 'Merchant',
    conditions: { status: 'pending' },
  },
  'merchants:read-public': {
    action: 'read',
    subject: 'Merchant',
    fields: ['id', 'name', 'status'],
  },
  'merchants:read-public-pending': {
    action: 'read',
    subject: 'Merchant',
    conditions: { status: 'pending' },
    fields: ['id', 'name'],
  },
  'platform:read-any': {
    action: 'read',
    subject: 'Merchant',
    crossTenant: true,
  },
});

type Permission = keyof typeof permissions;

const systemRoles = defineRoles<Permission>({
  admin: { permissions: ['merchants:read', 'merchants:approve'] },
  developer: { permissions: ['merchants:read'] },
  publicViewer: { permissions: ['merchants:read-public'] },
  publicViewerPending: { permissions: ['merchants:read-public-pending'] },
  platformStaff: { permissions: ['platform:read-any'] },
  empty: { permissions: [] },
});

const newBuilder = (): TenantAbilityBuilder<AppAbility, string> =>
  new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx, {
    permissions,
    systemRoles,
  });

describe('TenantAbilityBuilder.applyRoles', () => {
  it('expands a role to one rule per permission', () => {
    const b = newBuilder();
    b.applyRoles(['admin']);
    expect(b.rules).toHaveLength(2);
  });

  it('expands multiple roles by union', () => {
    const b = newBuilder();
    b.applyRoles(['admin', 'developer']);
    // admin: 2 rules; developer: 1 rule (read Merchant); duplicates allowed —
    // CASL doesn't dedupe by (action, subject) at builder time.
    expect(b.rules.length).toBeGreaterThanOrEqual(3);
  });

  it('emits an empty rule set when role list is empty', () => {
    const b = newBuilder();
    b.applyRoles([]);
    expect(b.rules).toHaveLength(0);
  });

  it('silently drops unknown role names (forward-compat per RFC § Q4)', () => {
    const b = newBuilder();
    b.applyRoles(['admin', 'never-defined-role']);
    expect(b.rules).toHaveLength(2); // only admin's rules
  });

  it('emits zero rules for a role with an empty permission list', () => {
    const b = newBuilder();
    b.applyRoles(['empty']);
    expect(b.rules).toHaveLength(0);
  });

  it('attaches a JSON `reason` carrying { role, permission } to every emitted rule', () => {
    const b = newBuilder();
    b.applyRoles(['admin']);

    for (const rule of b.rules) {
      const r = rule as { reason?: string };
      expect(r.reason).toBeTypeOf('string');
      const parsed = JSON.parse(r.reason!) as { role: string; permission: string };
      expect(parsed.role).toBe('admin');
      expect(['merchants:read', 'merchants:approve']).toContain(parsed.permission);
    }
  });

  it('preserves a permission `conditions` field on the emitted rule', () => {
    const b = newBuilder();
    b.applyRoles(['admin']);

    const approveRule = b.rules.find((r) => (r as { action: AppAction }).action === 'approve') as {
      conditions?: Record<string, unknown>;
    };
    expect(approveRule).toBeDefined();
    expect(approveRule.conditions?.status).toBe('pending');
    // Tenant predicate auto-injected by the builder.
    expect(approveRule.conditions?.tenantId).toBe('t1');
  });

  it('preserves a permission `fields` array on the emitted rule', () => {
    const b = newBuilder();
    b.applyRoles(['publicViewer']);

    const rule = b.rules[0] as { fields?: readonly string[] };
    expect(rule.fields).toEqual(['id', 'name', 'status']);
  });

  it('preserves both `fields` and `conditions` when a permission carries both', () => {
    const b = newBuilder();
    b.applyRoles(['publicViewerPending']);

    const rule = b.rules[0] as {
      fields?: readonly string[];
      conditions?: Record<string, unknown>;
    };
    expect(rule.fields).toEqual(['id', 'name']);
    expect(rule.conditions?.status).toBe('pending');
    expect(rule.conditions?.tenantId).toBe('t1');
  });

  it('uses crossTenant.can for permissions marked crossTenant: true', () => {
    const b = newBuilder();
    b.applyRoles(['platformStaff']);

    const rule = b.rules[0] as { conditions?: Record<string, unknown> };
    // Cross-tenant rule — tenant predicate must NOT be auto-injected.
    expect(rule.conditions?.tenantId).toBeUndefined();
  });

  it('cross-tenant rules still receive the attribution reason', () => {
    const b = newBuilder();
    b.applyRoles(['platformStaff']);

    const rule = b.rules[0] as { reason?: string };
    const parsed = JSON.parse(rule.reason!) as { role: string; permission: string };
    expect(parsed.role).toBe('platformStaff');
    expect(parsed.permission).toBe('platform:read-any');
  });

  it('throws UnknownPermissionError when a role references a missing permission', () => {
    const corruptRoles = defineRoles<string>({
      bad: { permissions: ['merchants:read', 'merchants:does-not-exist'] },
    });
    const b = new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx, {
      permissions,
      systemRoles: corruptRoles,
    });
    expect(() => b.applyRoles(['bad'])).toThrow(UnknownPermissionError);
  });

  it('throws when called without a permission registry', () => {
    const b = new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx, {
      systemRoles,
    });
    expect(() => b.applyRoles(['admin'])).toThrow(MultiTenantCaslError);
  });

  it('throws when called without a systemRoles registry', () => {
    const b = new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx, {
      permissions,
    });
    expect(() => b.applyRoles(['admin'])).toThrow(MultiTenantCaslError);
  });

  it('builds an ability whose rules are usable with ability.can()', () => {
    const b = newBuilder();
    b.applyRoles(['admin']);
    const ability = b.build();

    expect(ability.can('read', 'Merchant')).toBe(true);
    // Approve rule has condition status=pending; without an instance, can()
    // returns true if any matching rule exists at all.
    expect(ability.can('approve', 'Merchant')).toBe(true);
  });

  it('coexists with ad-hoc builder.can() calls', () => {
    const b = newBuilder();
    b.applyRoles(['developer']);
    b.can('manage', 'Payment');
    const ability = b.build();

    expect(ability.can('read', 'Merchant')).toBe(true);
    expect(ability.can('manage', 'Payment')).toBe(true);
  });

  it('does NOT mutate the registry across builder invocations (cross-tenant safety)', () => {
    // Regression: an earlier implementation passed
    // `permission.conditions` to CASL's `can` by reference. The tenant-
    // predicate wrapper mutates the rule's conditions object in place,
    // so the registry's shared object accumulated state across
    // requests — leaking the previous request's tenantId into the
    // next request's rule. Clone the conditions before handing them
    // to CASL.

    // Snapshot the registry's pristine condition for the conditional
    // permission. After running applyRoles for two different tenants,
    // the snapshot must remain unchanged.
    const approvePerm = permissions['merchants:approve']!;
    const originalConditions = { ...approvePerm.conditions };

    const ctx1: TenantContext<string> = {
      tenantId: 'tenant-A',
      subjectId: 'u1',
      roles: ['admin'],
    };
    const ctx2: TenantContext<string> = {
      tenantId: 'tenant-B',
      subjectId: 'u2',
      roles: ['admin'],
    };

    const b1 = new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx1, {
      permissions,
      systemRoles,
    });
    b1.applyRoles(['admin']);

    const b2 = new TenantAbilityBuilder<AppAbility, string>(createMongoAbility, ctx2, {
      permissions,
      systemRoles,
    });
    b2.applyRoles(['admin']);

    // Registry source-of-truth is unchanged.
    expect(approvePerm.conditions).toEqual(originalConditions);
    expect(approvePerm.conditions).not.toHaveProperty('tenantId');

    // The two builders' rules each carry their own tenant.
    const approve1 = b1.rules.find((r) => (r as { action: AppAction }).action === 'approve') as {
      conditions?: Record<string, unknown>;
    };
    const approve2 = b2.rules.find((r) => (r as { action: AppAction }).action === 'approve') as {
      conditions?: Record<string, unknown>;
    };
    expect(approve1.conditions?.tenantId).toBe('tenant-A');
    expect(approve2.conditions?.tenantId).toBe('tenant-B');
  });

  it('does NOT mutate the registry fields array across builder invocations', () => {
    const publicPerm = permissions['merchants:read-public']!;
    const originalFields = [...(publicPerm.fields ?? [])];

    const b = newBuilder();
    b.applyRoles(['publicViewer']);

    expect(publicPerm.fields).toEqual(originalFields);
  });
});
