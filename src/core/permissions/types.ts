/**
 * Public types for the permission/role registry. Phase A of RFC 001.
 *
 * The types here are interfaces only — the runtime helpers
 * (`definePermissions`, `defineRoles`, validators) live in sibling
 * files. This module is excluded from the coverage threshold via
 * `vitest.config.ts` because it has no executable code at runtime.
 */

/**
 * A single named permission. Maps a CASL `(action, subject)` pair plus
 * optional conditions and field restrictions onto a stable, UI-friendly
 * identifier (e.g., `'merchants:read'`).
 *
 * Per RFC 001 § Q1, permission names use colon-delimited
 * `<resource>:<verb>` form by convention; the `:` character is reserved
 * within names. The registry does not enforce the format at runtime —
 * names are opaque keys — but the convention is what UIs and audit
 * logs depend on.
 *
 * Per RFC 001 § Q2, conditions and field arrays live on the permission,
 * not on the role-permission attachment. If a role needs a stricter
 * variant of an existing permission, define a second permission entry
 * (e.g., `'merchants:approve-na-only'`) rather than overriding at
 * attachment time.
 */
export interface PermissionDef<TAction extends string = string, TSubject extends string = string> {
  readonly action: TAction;
  readonly subject: TSubject;
  /**
   * MongoDB-style conditions that narrow which subject instances the
   * permission applies to. Same shape as CASL's
   * [`MongoQuery`](https://casl.js.org/v6/en/guide/conditions-in-depth)
   * — see also `/docs/core-concepts/conditional-authorization/`.
   */
  readonly conditions?: Readonly<Record<string, unknown>>;
  /**
   * If set, the permission applies only to the listed fields. Forward
   * checks (`ability.can(action, subject, field)`) and CASL's
   * `permittedFieldsOf` both honor this list. nest-warden does not
   * auto-mask responses; the consumer projects explicitly. See
   * `/docs/core-concepts/conditional-authorization/#field-level-restrictions`.
   */
  readonly fields?: readonly string[];
  /**
   * If `true`, the permission opts out of the auto-injected tenant
   * predicate. Used for platform-staff style access (e.g., support
   * staff reading any tenant's merchants for an investigation). RFC
   * 001 § Q3 — `crossTenant` is an opt-out from the tenant predicate,
   * not an opt-out from authorization itself.
   */
  readonly crossTenant?: boolean;
}

/**
 * A system role: a stable, code-defined bundle of permissions. System
 * roles are immutable at runtime — they describe the shape of
 * authorization across all tenants. RFC 001 § Q4 — system role names
 * are reserved; custom roles cannot redefine them.
 */
export interface RoleDef<TPermission extends string = string> {
  readonly description?: string;
  readonly permissions: readonly TPermission[];
}

/**
 * A custom role loaded at request time via `loadCustomRoles`. Carries
 * the same `permissions` shape as a system role, plus the `name` the
 * tenant admin chose. Matched against `ctx.roles` at rule-build time.
 *
 * Phase A defines the shape; the actual `loadCustomRoles` wiring lands
 * in Phase C.
 */
export interface CustomRoleEntry<TPermission extends string = string> {
  readonly name: string;
  readonly permissions: readonly TPermission[];
  readonly description?: string;
}

/**
 * The shape returned by `definePermissions`. A read-only record keyed
 * by permission name. The literal-typed key set is the basis for
 * `Permission` string-literal unions in consumer code:
 *
 *     const permissions = definePermissions<...>({...});
 *     type Permission = keyof typeof permissions;
 */
export type PermissionRegistry<
  TAction extends string = string,
  TSubject extends string = string,
> = Readonly<Record<string, PermissionDef<TAction, TSubject>>>;

/**
 * The shape returned by `defineRoles`. Read-only record of system
 * roles, keyed by role name.
 */
export type RoleRegistry<TPermission extends string = string> = Readonly<
  Record<string, RoleDef<TPermission>>
>;
