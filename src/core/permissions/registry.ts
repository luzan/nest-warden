import type { PermissionDef, PermissionRegistry } from './types.js';

/**
 * Define the permission registry for the application. Returns the input
 * unchanged at runtime — the value of this helper is purely typing:
 * it preserves literal-typed keys via the `const` modifier on `TMap`,
 * so consumers can derive a `Permission` union from `keyof typeof`.
 *
 * Phase A of RFC 001. Validation of cross-references (a role
 * referencing an unknown permission) lives in `validators.ts`; the
 * registry itself is just data.
 *
 * @example
 * type AppAction = 'read' | 'approve' | 'refund';
 * type AppSubject = 'Merchant' | 'Payment';
 *
 * export const permissions = definePermissions<AppAction, AppSubject>({
 *   'merchants:read':    { action: 'read',    subject: 'Merchant' },
 *   'merchants:approve': {
 *     action: 'approve',
 *     subject: 'Merchant',
 *     conditions: { status: 'pending' },
 *   },
 *   'payments:refund': {
 *     action: 'refund',
 *     subject: 'Payment',
 *     conditions: { amount: { $lte: 10_000 } },
 *   },
 * });
 *
 * export type Permission = keyof typeof permissions;
 *
 * @typeParam TAction - The application's action vocabulary. Pass the
 *   same union you use for your CASL ability so typos in `action`
 *   surface at definition time.
 * @typeParam TSubject - The application's subject vocabulary, same
 *   reasoning as `TAction`.
 * @typeParam TMap - Inferred. The `const` modifier on this parameter
 *   keeps the literal-typed key set so consumers can derive
 *   `keyof typeof <returned>` as a string-literal union.
 */
export function definePermissions<
  TAction extends string = string,
  TSubject extends string = string,
  const TMap extends Readonly<Record<string, PermissionDef<TAction, TSubject>>> = Readonly<
    Record<string, PermissionDef<TAction, TSubject>>
  >,
>(map: TMap): TMap {
  return map;
}

// Re-export the registry type for consumers who want to write
// pass-through helpers around the registry without re-importing from
// `./types.js`.
export type { PermissionRegistry };
