import type { ExecutionContext, LoggerService } from '@nestjs/common';
import type { AbilityClass, AnyAbility, CreateAbility } from '@casl/ability';
import type { TenantContext } from '../core/tenant-context.js';
import type { TenantAbilityBuilder } from '../core/tenant-ability.builder.js';
import type { TenantIdValue } from '../core/tenant-id.js';
import type {
  CustomRoleEntry,
  PermissionRegistry,
  RoleRegistry,
} from '../core/permissions/index.js';
import type { RelationshipGraph } from '../core/relationships/graph.js';

/**
 * Options accepted by `TenantAbilityModule.forRoot()`.
 *
 * The module is generic in both the ability type and the tenant ID
 * type so applications get end-to-end IDE support for their own
 * action / subject vocabularies.
 *
 * **0.5.0-alpha shape (Theme 8B).** The options surface has been
 * restructured for v1.0 readiness. Top-level fields fall into
 * three tiers:
 *
 *   1. **Required callbacks** — `defineAbilities` and
 *      `resolveTenantContext`. These ARE the contract.
 *   2. **Foundational vocabulary** — `permissions`. The permission
 *      registry is intentionally NOT nested under `roles` because
 *      roles are only ONE way to compose permissions; future
 *      composers (user-level grants, group/department permissions,
 *      attribute-based overrides) would all reference the same
 *      registry. Putting it under `roles` would imply it's
 *      role-exclusive — which it isn't.
 *   3. **Optional config groups** — each grouped sub-object scopes
 *      a related concern:
 *      - `builder` — how the per-request `TenantAbilityBuilder` is
 *        constructed (tenant field name, ability class, rule
 *        validation).
 *      - `roles` — role registries and the custom-role loader
 *        (RFC 001 Phase C). One consumer of `permissions`.
 *      - `graph` — relationship graph for `$relatedTo` (kept flat
 *        because it's a single instance, not a config bag).
 *      - `module` — NestJS module wiring (isPublic, global
 *        registration).
 *
 * See the 0.5.0-alpha CHANGELOG for the complete before/after
 * mapping if you're migrating from 0.4.x.
 *
 * @typeParam TAbility - The application's CASL ability type
 *   (commonly `MongoAbility<[Action, Subject]>`).
 * @typeParam TId - The runtime type of `tenantId` — `string` (UUID)
 *   or `number` (integer PK). Defaults to `string`.
 */
export interface TenantAbilityModuleOptions<
  TAbility extends AnyAbility = AnyAbility,
  TId extends TenantIdValue = string,
> {
  // ── Required callbacks ─────────────────────────────────────────────

  /**
   * Imperatively define the rules for the resolved context. Called
   * once per request. The provided builder is pre-bound to the
   * context's `tenantId`, so every `can()` / `cannot()` call
   * automatically pins the tenant predicate. Use
   * `builder.crossTenant.*` for explicit cross-tenant rules.
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
   * Resolver invoked once per authenticated request to produce the
   * request-scoped {@link TenantContext}. The return value MUST come
   * from a server-side membership lookup, NOT from a client-supplied
   * JWT claim — the library cannot enforce this, but it's the
   * security contract.
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

  // ── Foundational vocabulary ───────────────────────────────────────

  /**
   * Permission registry produced by `definePermissions()`. The shared
   * vocabulary of "what actions can be performed against what
   * subjects." Required only if you intend to use
   * {@link TenantAbilityBuilder.applyRoles} inside `defineAbilities`,
   * OR to validate any other permission-composing surface (custom
   * roles loaded at request time, future user-level overrides, etc.).
   *
   * Intentionally at top level rather than nested under `roles`:
   * roles are only ONE composer of permissions. Future composers
   * (user-level grants, group/department permissions, attribute-
   * based overrides) would all reference this same registry. Putting
   * it under `roles` would mislead implementers into thinking it's
   * role-exclusive.
   *
   * RFC 001 Phase B; the library forwards this verbatim to the
   * per-request builder so `applyRoles` can resolve names against it.
   */
  readonly permissions?: PermissionRegistry;

  // ── Grouped configuration ─────────────────────────────────────────

  /**
   * How the per-request {@link TenantAbilityBuilder} is constructed.
   * Every field is optional; omit the entire group to take the
   * defaults.
   */
  readonly builder?: {
    /** Resource field that carries the tenant ID. Default: `tenantId`. */
    readonly tenantField?: string;

    /**
     * The CASL ability class or factory used to instantiate per-request
     * abilities. Defaults to `createMongoAbility`. Override to plug in
     * a `PureAbility` (no in-memory matching) or a custom subclass.
     */
    readonly abilityClass?: AbilityClass<TAbility> | CreateAbility<TAbility>;

    /**
     * Run `validateTenantRules` at `.build()` time. Default: `true`.
     * Setting this to `false` is intentionally undocumented in the
     * README — it exists for library-internal tests of the bypass
     * path. Leave it on in production.
     *
     * **Renamed from `validateRulesAtBuild` in 0.5.0-alpha** — the
     * `builder` group prefix made "AtBuild" redundant.
     */
    readonly validateRules?: boolean;
  };

  /**
   * Role registries, tenant-managed custom-role loader, and
   * logging knobs (RFC 001 Phase C). One specific composer of
   * `permissions` (the top-level field). Every field is optional;
   * omit the entire group if you don't use registry-driven roles.
   */
  readonly roles?: {
    /**
     * System role registry produced by `defineRoles()`. Required
     * only if you intend to use
     * {@link TenantAbilityBuilder.applyRoles}. Coexists cleanly with
     * raw `builder.can(...)` calls in `defineAbilities`; both styles
     * can appear in the same callback.
     */
    readonly systemRoles?: RoleRegistry;

    /**
     * Tenant-managed custom roles loaded once per request.
     *
     * @experimental
     * The shape of `CustomRoleEntry`, the validation error vocabulary
     * (`UnknownPermissionError` / `SystemRoleCollisionError`), and the
     * fail-closed dropout policy may change before v1.0. See Theme 9
     * in the roadmap. Pin to an exact version of `nest-warden` if you
     * depend on this option.
     *
     * @example
     *   roles: {
     *     loadCustomRoles: async (tenantId, ctx) => {
     *       const rows = await this.customRolesRepo.find({
     *         where: { tenantId },
     *       });
     *       return rows.map((r) => ({
     *         name: r.name,
     *         permissions: r.permissions,
     *         description: r.description,
     *       }));
     *     }
     *   }
     */
    readonly loadCustomRoles?: (
      tenantId: TId,
      context: TenantContext<TId>,
    ) => readonly CustomRoleEntry[] | Promise<readonly CustomRoleEntry[]>;

    /**
     * Logger used by the per-request factory to report custom-role
     * dropouts (Theme 8E). Accepts any {@link LoggerService} — the
     * NestJS-provided `Logger`, a Pino adapter, a Winston wrapper, a
     * test capture, etc.
     *
     * When omitted, the factory falls back to
     * `new Logger('TenantAbilityFactory')` which honours the
     * application's global NestJS log-level configuration.
     */
    readonly logger?: LoggerService;

    /**
     * When `true`, suppress the per-request log calls for custom-role
     * dropouts (collisions with system roles and unknown-permission
     * references). Defaults to `false` — dropouts are logged.
     *
     * **Renamed from `silentRoleDropouts` in 0.5.0-alpha** — the
     * `roles` group prefix made "Role" redundant.
     */
    readonly silentDropouts?: boolean;
  };

  /**
   * Optional relationship graph passed to the per-request ability.
   * The graph is shared across requests and built once at module
   * bootstrap. Required only when rules use `$relatedTo`.
   *
   * Stays flat (not wrapped) because it's a single instance, not a
   * config bag — wrapping would just be `graph: { graph: ... }`.
   */
  readonly graph?: RelationshipGraph;

  /**
   * NestJS module wiring. Every field is optional; omit the entire
   * group to take the defaults.
   */
  readonly module?: {
    /**
     * Predicate identifying routes that are public (no auth, no tenant
     * context, no policy check). When omitted, the guard relies on
     * the `@Public()` decorator alone.
     */
    readonly isPublic?: (context: ExecutionContext) => boolean;

    /**
     * Whether to register the `TenantPoliciesGuard` and
     * `TenantContextInterceptor` as global APP_GUARD /
     * APP_INTERCEPTOR. Default: `true` — recommended for new apps.
     * Set to `false` and wire them yourself when migrating an
     * existing app incrementally.
     */
    readonly registerAsGlobal?: boolean;
  };
}
