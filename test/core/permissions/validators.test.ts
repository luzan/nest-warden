import { describe, expect, it } from 'vitest';
import {
  assertNoSystemRoleCollision,
  validatePermissionReferences,
} from '../../../src/core/permissions/validators.js';
import { SystemRoleCollisionError, UnknownPermissionError } from '../../../src/core/errors.js';
import type { PermissionRegistry, RoleRegistry } from '../../../src/core/permissions/types.js';

const permissions: PermissionRegistry = {
  'merchants:read': { action: 'read', subject: 'Merchant' },
  'merchants:approve': { action: 'approve', subject: 'Merchant' },
  'payments:refund': { action: 'refund', subject: 'Payment' },
};

describe('validatePermissionReferences', () => {
  it('is a no-op when every reference is registered', () => {
    expect(() =>
      validatePermissionReferences(permissions, 'admin', ['merchants:read', 'merchants:approve']),
    ).not.toThrow();
  });

  it('throws UnknownPermissionError on the first unregistered reference', () => {
    expect(() =>
      validatePermissionReferences(permissions, 'admin', [
        'merchants:read',
        'merchants:typo',
        'payments:refund',
      ]),
    ).toThrow(UnknownPermissionError);
  });

  it('error carries the offending role name and permission', () => {
    try {
      validatePermissionReferences(permissions, 'qa-reviewer', ['merchants:typo']);
      expect.fail('Expected UnknownPermissionError to be thrown');
    } catch (e) {
      const err = e as UnknownPermissionError;
      expect(err).toBeInstanceOf(UnknownPermissionError);
      expect(err.roleName).toBe('qa-reviewer');
      expect(err.permission).toBe('merchants:typo');
      expect(err.message).toContain('qa-reviewer');
      expect(err.message).toContain('merchants:typo');
    }
  });

  it('accepts an empty permission list (no references = no check)', () => {
    expect(() => validatePermissionReferences(permissions, 'placeholder', [])).not.toThrow();
  });

  it('does not match keys via the prototype chain', () => {
    // `'toString' in permissions` is true via Object.prototype, but the
    // permission registry should treat only own keys as registered.
    expect(() => validatePermissionReferences(permissions, 'sneaky', ['toString'])).toThrow(
      UnknownPermissionError,
    );
  });
});

describe('assertNoSystemRoleCollision', () => {
  const systemRoles: RoleRegistry = {
    admin: { permissions: ['merchants:read'] },
    developer: { permissions: ['merchants:read'] },
  };

  it('is a no-op when names are distinct', () => {
    expect(() => assertNoSystemRoleCollision(systemRoles, 'qa-reviewer')).not.toThrow();
    expect(() => assertNoSystemRoleCollision(systemRoles, 'support-tier-1')).not.toThrow();
  });

  it('throws SystemRoleCollisionError on name match', () => {
    expect(() => assertNoSystemRoleCollision(systemRoles, 'admin')).toThrow(
      SystemRoleCollisionError,
    );
    expect(() => assertNoSystemRoleCollision(systemRoles, 'developer')).toThrow(
      SystemRoleCollisionError,
    );
  });

  it('error carries the colliding role name', () => {
    try {
      assertNoSystemRoleCollision(systemRoles, 'admin');
      expect.fail('Expected SystemRoleCollisionError to be thrown');
    } catch (e) {
      const err = e as SystemRoleCollisionError;
      expect(err).toBeInstanceOf(SystemRoleCollisionError);
      expect(err.roleName).toBe('admin');
      expect(err.message).toContain('admin');
    }
  });

  it('does not match prototype chain keys', () => {
    expect(() => assertNoSystemRoleCollision(systemRoles, 'toString')).not.toThrow();
    expect(() => assertNoSystemRoleCollision(systemRoles, 'hasOwnProperty')).not.toThrow();
  });
});
