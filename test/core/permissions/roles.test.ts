import { describe, expect, it } from 'vitest';
import { defineRoles } from '../../../src/core/permissions/roles.js';

type Permission = 'merchants:read' | 'merchants:approve' | 'payments:refund';

describe('defineRoles', () => {
  it('returns the input map unchanged at runtime', () => {
    const input = {
      admin: {
        description: 'Full administration',
        permissions: ['merchants:read', 'merchants:approve', 'payments:refund'],
      },
      developer: { permissions: ['merchants:read'] },
    } as const;

    const out = defineRoles<Permission>(input);
    expect(out).toBe(input);
  });

  it('preserves literal-typed role names for `keyof typeof` derivation', () => {
    const roles = defineRoles<Permission>({
      admin: { permissions: ['merchants:read'] },
      viewer: { permissions: ['merchants:read'] },
    });

    type RoleName = keyof typeof roles;
    const r: RoleName = 'admin';
    expect(r).toBe('admin');
    expect(Object.keys(roles).sort()).toEqual(['admin', 'viewer']);
  });

  it('accepts an empty role registry', () => {
    const empty = defineRoles<Permission>({});
    expect(empty).toEqual({});
  });

  it('keeps the permissions array reference identical to the input', () => {
    const adminPerms = ['merchants:read', 'merchants:approve'] as const;
    const roles = defineRoles<Permission>({
      admin: { permissions: adminPerms },
    });
    expect(roles.admin?.permissions).toBe(adminPerms);
  });

  it('preserves the optional description field', () => {
    const roles = defineRoles<Permission>({
      admin: {
        description: 'Highest privilege role',
        permissions: ['merchants:read'],
      },
    });
    expect(roles.admin?.description).toBe('Highest privilege role');
  });
});
