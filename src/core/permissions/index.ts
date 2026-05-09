export { definePermissions } from './registry.js';
export { defineRoles } from './roles.js';
export { assertNoSystemRoleCollision, validatePermissionReferences } from './validators.js';
export type {
  CustomRoleEntry,
  PermissionDef,
  PermissionRegistry,
  RoleDef,
  RoleRegistry,
} from './types.js';
