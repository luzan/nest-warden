import type { ExecutionContext } from '@nestjs/common';
import type { AbilityClass, AnyAbility, CreateAbility } from '@casl/ability';
import type { TenantContext } from '../core/tenant-context.js';
import type { TenantAbilityBuilder } from '../core/tenant-ability.builder.js';
import type { TenantIdValue } from '../core/tenant-id.js';
import type { PermissionRegistry, RoleRegistry } from '../core/permissions/index.js';
import type { RelationshipGraph } from '../core/relationships/graph.js';

/**
 * Options accepted by `TenantAbilityModule.forRoot()`.
 *
 * The module is intentionally generic in both the ability type and the
 * tenant ID type so applications get end-to-end IDE support for their own
 * action / subject vocabularies.
 *
 * @typeParam TAbility - The application's CASL ability type (commonly
 *   `MongoAbility<[Action, Subject]>`).
 * @typeParam TId - The runtime type of `tenantId` — `string` (UUID) or
 *   `number` (integer PK). Defaults to `string`.
 */
export interface TenantAbilityModuleOptions<
  TAbility extends AnyAbility = AnyAbility,
  TId extends TenantIdValue = string,
> {
  /** Resource field that carries the tenant ID. Default: `tenantId`. */
  readonly tenantField?: string;

  /**
   * The CASL ability class or factory used to instantiate per-request
   * abilities. Defaults to `createMongoAbility`. Override to plug in a
   * `PureAbility` (no in-memory matching) or a custom subclass.
   */
  readonly abilityClass?: AbilityClass<TAbility> | CreateAbility<TAbility>;

  /**
   * Resolver invoked once per authenticated request to produce the
   * request-scoped {@link TenantContext}. The return value MUST come
   * from a server-side membership lookup, NOT from a client-supplied JWT
   * claim — the library cannot enforce this, but it's the security
   * contract.
   *
   * @example
   *   resolveTenantContext: async (req) => {
   *     const user = req.user;
   *     const m = await memberships.findOne({
   *       userId: user.sub, tenantId: user.claimedTenantId, active: true,
   *     });
   *     if (!m) throw new ForbiddenException('No active membership');
   *     return { tenantId: m.tenantId, subjectId: user.sub, roles: m.roles };
   *   }
   */
  readonly resolveTenantContext: (
    request: unknown,
  ) => TenantContext<TId> | Promise<TenantContext<TId>>;

  /**
   * Imperatively define the rules for the resolved context. Called once
   * per request. The provided builder is pre-bound to the context's
   * `tenantId`, so every `can()` / `cannot()` call automatically pins the
   * tenant predicate. Use `builder.crossTenant.*` for explicit cross-
   * tenant rules.
   *
   * The function may be sync or return a Promise — useful when role
   * permissions need to be loaded from a database.
   */
  readonly defineAbilities: (
    builder: TenantAbilityBuilder<TAbility, TId>,
    context: TenantContext<TId>,
    request: unknown,
  ) => void | Promise<void>;

  /**
   * Optional relationship graph passed to the per-request ability. The
   * graph is shared across requests and built once at module bootstrap.
   * Required only when rules use `$relatedTo`.
   */
  readonly graph?: RelationshipGraph;

  /**
   * Permission registry produced by `definePermissions()`. Optional —
   * supply only if you intend to use {@link TenantAbilityBuilder.applyRoles}
   * inside `defineAbilities`. RFC 001 Phase B; the library forwards
   * this verbatim to the per-request builder.
   */
  readonly permissions?: PermissionRegistry;

  /**
   * System role registry produced by `defineRoles()`. Optional —
   * supply only if you intend to use {@link TenantAbilityBuilder.applyRoles}.
   * Coexists cleanly with raw `builder.can(...)` calls in
   * `defineAbilities`; both styles can appear in the same callback.
   */
  readonly systemRoles?: RoleRegistry;

  /**
   * Run `validateTenantRules` at `.build()` time. Default: `true`. Setting
   * this to `false` is intentionally undocumented in the README — it
   * exists for library-internal tests of the bypass path. Leave it on in
   * production.
   */
  readonly validateRulesAtBuild?: boolean;

  /**
   * Predicate identifying routes that are public (no auth, no tenant
   * context, no policy check). When omitted, the guard relies on the
   * `@Public()` decorator alone.
   */
  readonly isPublic?: (context: ExecutionContext) => boolean;

  /**
   * Whether to register the `TenantPoliciesGuard` and
   * `TenantContextInterceptor` as global APP_GUARD / APP_INTERCEPTOR.
   * Default: `true` — recommended for new apps. Set to `false` and wire
   * them yourself when migrating an existing app incrementally.
   */
  readonly registerAsGlobal?: boolean;
}
