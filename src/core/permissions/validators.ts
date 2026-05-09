import { SystemRoleCollisionError, UnknownPermissionError } from '../errors.js';
import type { PermissionRegistry, RoleRegistry } from './types.js';

/**
 * Verify that every permission name referenced by `rolePermissions`
 * exists in the `permissions` registry. Throws `UnknownPermissionError`
 * on the first unknown name, including the role name for diagnostic
 * context.
 *
 * Used at module bootstrap to validate system roles, and at every
 * `loadCustomRoles` invocation to validate custom roles before they
 * influence the per-request ability.
 *
 * Phase A of RFC 001. Phase B (builder integration) calls this from
 * `applyRoles`; Phase C (custom roles) calls it from the load path.
 *
 * @param permissions - The permission registry returned by
 *   `definePermissions`.
 * @param roleName - The role being validated. Used purely for the
 *   error message; not looked up.
 * @param rolePermissions - The permission names the role references.
 * @throws UnknownPermissionError on the first unknown reference.
 */
export function validatePermissionReferences(
  permissions: PermissionRegistry,
  roleName: string,
  rolePermissions: readonly string[],
): void {
  for (const name of rolePermissions) {
    if (!Object.prototype.hasOwnProperty.call(permissions, name)) {
      throw new UnknownPermissionError(roleName, name);
    }
  }
}

/**
 * Verify that a custom role's `name` does not collide with any system
 * role. Throws `SystemRoleCollisionError` if a collision is found.
 *
 * RFC 001 § Q4 — system role names are reserved. A `loadCustomRoles`
 * callback that returns a colliding entry causes the per-request role
 * set to fail closed (the request proceeds with no custom roles
 * applied; behavior implemented by the caller of this validator in
 * Phase C).
 *
 * @param systemRoles - The system role registry returned by
 *   `defineRoles`.
 * @param customRoleName - The candidate custom role's name.
 * @throws SystemRoleCollisionError if `customRoleName` is a key in
 *   `systemRoles`.
 */
export function assertNoSystemRoleCollision(
  systemRoles: RoleRegistry,
  customRoleName: string,
): void {
  if (Object.prototype.hasOwnProperty.call(systemRoles, customRoleName)) {
    throw new SystemRoleCollisionError(customRoleName);
  }
}
