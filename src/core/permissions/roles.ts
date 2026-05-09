import type { RoleDef, RoleRegistry } from './types.js';

/**
 * Define the system role registry. Returns the input unchanged at
 * runtime — value comes from the typing: when the consumer passes
 * a `Permission` string-literal union as `TPermission`, every entry
 * in every role's `permissions` array is checked against it at
 * compile time.
 *
 * Phase A of RFC 001. Custom roles loaded at runtime via
 * `loadCustomRoles` are validated against the same permission
 * registry but at runtime — see `validators.ts`.
 *
 * @example
 * type Permission = keyof typeof permissions;
 *
 * export const systemRoles = defineRoles<Permission>({
 *   admin: {
 *     description: 'Full tenant administration',
 *     permissions: ['merchants:read', 'merchants:approve', 'payments:refund'],
 *   },
 *   developer: {
 *     description: 'Read access for engineering staff',
 *     permissions: ['merchants:read'],
 *   },
 * });
 *
 * @typeParam TPermission - String-literal union of valid permission
 *   names. Typically `keyof typeof permissions` from a registry built
 *   with `definePermissions`.
 * @typeParam TMap - Inferred; `const` modifier preserves literal-typed
 *   role names.
 */
export function defineRoles<
  TPermission extends string = string,
  const TMap extends Readonly<Record<string, RoleDef<TPermission>>> = Readonly<
    Record<string, RoleDef<TPermission>>
  >,
>(map: TMap): TMap {
  return map;
}

export type { RoleRegistry };
