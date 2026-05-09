import { describe, expect, it } from 'vitest';
import { definePermissions } from '../../../src/core/permissions/registry.js';

type AppAction = 'read' | 'approve' | 'refund';
type AppSubject = 'Merchant' | 'Payment';

describe('definePermissions', () => {
  it('returns the input map unchanged at runtime', () => {
    const input = {
      'merchants:read': { action: 'read', subject: 'Merchant' },
      'merchants:approve': {
        action: 'approve',
        subject: 'Merchant',
        conditions: { status: 'pending' },
      },
    } as const;

    const out = definePermissions<AppAction, AppSubject>(input);

    expect(out).toBe(input);
  });

  it('preserves literal-typed keys for `keyof typeof` derivation', () => {
    const permissions = definePermissions<AppAction, AppSubject>({
      'merchants:read': { action: 'read', subject: 'Merchant' },
      'payments:refund': {
        action: 'refund',
        subject: 'Payment',
        conditions: { amount: { $lte: 10_000 } },
      },
    });

    type Permission = keyof typeof permissions;

    // Compile-time check: only the two declared names assignable.
    const a: Permission = 'merchants:read';
    const b: Permission = 'payments:refund';
    expect(a).toBe('merchants:read');
    expect(b).toBe('payments:refund');

    // Runtime: keys exactly match.
    expect(Object.keys(permissions).sort()).toEqual(['merchants:read', 'payments:refund'].sort());
  });

  it('accepts an empty registry', () => {
    const empty = definePermissions<AppAction, AppSubject>({});
    expect(empty).toEqual({});
    expect(Object.keys(empty)).toHaveLength(0);
  });

  it('preserves all PermissionDef fields including crossTenant and fields', () => {
    const permissions = definePermissions<AppAction, AppSubject>({
      'merchants:read-public': {
        action: 'read',
        subject: 'Merchant',
        fields: ['id', 'name', 'status'],
      },
      'platform:read-any': {
        action: 'read',
        subject: 'Merchant',
        crossTenant: true,
      },
    });

    expect(permissions['merchants:read-public']?.fields).toEqual(['id', 'name', 'status']);
    expect(permissions['platform:read-any']?.crossTenant).toBe(true);
  });
});
