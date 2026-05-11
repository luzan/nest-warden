import {
  AbilityBuilder,
  type AbilityClass,
  type AbilityOptionsOf,
  type AnyAbility,
  type CreateAbility,
} from '@casl/ability';
import { NestWardenError } from './errors.js';
import {
  type CustomRoleEntry,
  type PermissionRegistry,
  type RoleRegistry,
  validatePermissionReferences,
} from './permissions/index.js';
import { DEFAULT_TENANT_FIELD, type TenantIdValue } from './tenant-id.js';
import type { TenantContext } from './tenant-context.js';
import { markCrossTenant } from './tenant-rule.js';
import { validateTenantRules } from './validate-rules.js';

export interface TenantBuilderOptions {
  /** Resource field that carries the tenant ID. Default: `tenantId`. */
  readonly tenantField?: string;
  /** Run `validateTenantRules` at `.build()`. Default: `true`. */
  readonly validateRules?: boolean;
  /**
   * Permission registry used by `applyRoles`. Optional — supply only
   * if you intend to use the role-based rule expansion. RFC 001
   * Phase B; see `definePermissions` and `defineRoles`.
   */
  readonly permissions?: PermissionRegistry;
  /** System role registry used by `applyRoles`. Optional. */
  readonly systemRoles?: RoleRegistry;
  /**
   * Per-request tenant-scoped custom roles, typically loaded from
   * the consumer's database via `loadCustomRoles` in the NestJS
   * module options. The builder consumes them the same way it
   * consumes `systemRoles`: `applyRoles(roleNames)` looks up each
   * name in `systemRoles` first, then in this array. Names not
   * found in either are silently dropped.
   *
   * RFC 001 Phase C — the validation responsibility (collision with
   * system role names, unknown permission references) belongs to
   * the caller that produces this array. The builder trusts whatever
   * is passed in. The factory at `nest-warden/nestjs` runs the
   * validators and fails closed when they throw.
   */
  readonly customRoles?: readonly CustomRoleEntry[];
}

/**
 * `AbilityBuilder` extension that automatically injects a tenant predicate
 * (`{ <tenantField>: <ctx.tenantId> }`) into every rule's conditions, unless
 * the rule is created via the `crossTenant` opt-out.
 *
 * The injection happens at `can`/`cannot` time so rules that go through the
 * standard call sites are tenant-safe by construction. At `.build()`, every
 * accumulated rule is re-checked by `validateTenantRules` as defense in
 * depth — protecting against rules pushed directly onto `this.rules` or
 * imported from external sources.
 *
 * @example
 *   const builder = new TenantAbilityBuilder<AppAbility, string>(
 *     createMongoAbility,
 *     { tenantId: 't1', subjectId: 'u1', roles: ['agent'] },
 *   );
 *   builder.can('read', 'Merchant', { agentId: 'u1' });
 *   // Rule conditions become: { agentId: 'u1', tenantId: 't1' }
 *
 *   builder.crossTenant.can('read', 'Merchant'); // explicit cross-tenant rule
 *   const ability = builder.build();
 */
export class TenantAbilityBuilder<
  TAbility extends AnyAbility,
  TId extends TenantIdValue = string,
> extends AbilityBuilder<TAbility> {
  private readonly _ctx: TenantContext<TId>;
  private readonly _opts: Required<Pick<TenantBuilderOptions, 'tenantField' | 'validateRules'>> &
    Pick<TenantBuilderOptions, 'permissions' | 'systemRoles' | 'customRoles'>;

  /**
   * Cross-tenant opt-out. Rules added via `crossTenant.can` / `cannot` skip
   * predicate injection and are tagged so `validateTenantRules` accepts them.
   * Use sparingly — typically only for platform-staff and system roles.
   */
  public readonly crossTenant: {
    readonly can: AbilityBuilder<TAbility>['can'];
    readonly cannot: AbilityBuilder<TAbility>['cannot'];
  };

  constructor(
    AbilityClassOrFactory: AbilityClass<TAbility> | CreateAbility<TAbility>,
    context: TenantContext<TId>,
    options: TenantBuilderOptions = {},
  ) {
    super(AbilityClassOrFactory);
    this._ctx = context;
    this._opts = {
      tenantField: options.tenantField ?? DEFAULT_TENANT_FIELD,
      validateRules: options.validateRules ?? true,
      permissions: options.permissions,
      systemRoles: options.systemRoles,
      customRoles: options.customRoles,
    };

    // CASL's AbilityBuilder assigns `can`/`cannot`/`build` as INSTANCE
    // properties in its own constructor (see casl-ability/src/AbilityBuilder.ts).
    // After `super()`, `this.can`/`this.cannot`/`this.build` are the
    // bound functions we want to wrap. There is no usable `super.*` —
    // the prototype is empty for these names.
    //
    // This implementation detail is load-bearing: every rule built through
    // the wrapped `can`/`cannot` gets a tenant predicate injected. If a
    // future CASL release moves these to the prototype, the captures
    // below would silently be `undefined` and the wraps would no-op,
    // shipping rules without a tenant predicate — a silent data-leak
    // class. `assertCaslCouplingInvariant` is the load-bearing safety
    // check that fails LOUDLY at construction time instead.
    const baseCan = this.can;
    const baseCannot = this.cannot;
    const baseBuild = this.build;
    assertCaslCouplingInvariant({
      can: baseCan,
      cannot: baseCannot,
      build: baseBuild,
    });

    // We splat `args` into the captured base methods rather than typing this
    // wrapper against `AddRule<T>`'s heavy overload set — TS narrows the
    // overloads when the call sites use the original type, and our wrapper
    // is invoked through the same `this.can` / `this.cannot` references.
    // The wrappers preserve CASL's overload set verbatim — we use a
    // single-cast pattern so consumers see the exact same `AddRule<T>` shape
    // they'd see on the parent `AbilityBuilder`. `Parameters<...>` would
    // widen the tuple to the union of all overloads, breaking the cast.
    const wrap = (delegate: typeof baseCan): typeof baseCan => {
      const wrapped = (...args: unknown[]): unknown => {
        const result = (delegate as (...a: unknown[]) => unknown)(...args);
        injectTenantIntoLastRule(this.rules, this._opts.tenantField, this._ctx.tenantId);
        return result;
      };
      return wrapped as typeof baseCan;
    };

    const wrapCrossTenant = (delegate: typeof baseCan): typeof baseCan => {
      const wrapped = (...args: unknown[]): unknown => {
        const result = (delegate as (...a: unknown[]) => unknown)(...args);
        markLastRuleCrossTenant(this.rules);
        return result;
      };
      return wrapped as typeof baseCan;
    };

    this.can = wrap(baseCan);
    this.cannot = wrap(baseCannot);
    this.crossTenant = {
      can: wrapCrossTenant(baseCan),
      cannot: wrapCrossTenant(baseCannot),
    };

    // Wrap `build` identically to `can`/`cannot` so the validator runs
    // even when consumers store the builder behind the parent type.
    this.build = (options?: AbilityOptionsOf<TAbility>): TAbility => {
      if (this._opts.validateRules) {
        validateTenantRules(this.rules, {
          tenantField: this._opts.tenantField,
        });
      }
      return baseBuild(options);
    };
  }

  /** Resolved options (for adapters that need to know the tenant field name). */
  public get tenantField(): string {
    return this._opts.tenantField;
  }

  /** The context this builder was constructed with. Read-only. */
  public get tenantContext(): TenantContext<TId> {
    return this._ctx;
  }

  /**
   * Expand a list of role names into rules using the permission and
   * system-role registries provided in {@link TenantBuilderOptions}.
   * RFC 001 Phase B — the bridge between the typed registry primitives
   * and the underlying CASL builder.
   *
   * For each role name:
   *
   *   1. Look up the role in `systemRoles`. **Unknown role names are
   *      silently dropped** so adding a new role to the registry
   *      doesn't require coordinating JWTs across all live sessions.
   *   2. Validate every permission reference against `permissions`
   *      via {@link validatePermissionReferences}. The first unknown
   *      reference throws `UnknownPermissionError` with the offending
   *      role + permission name attached.
   *   3. For each permission, call `can()` (or `crossTenant.can()` if
   *      the permission carries `crossTenant: true`) with the
   *      permission's action, subject, fields, and conditions. The
   *      emitted rule's CASL `reason` field is set to the JSON string
   *      `{ "role": <name>, "permission": <name> }` so a future
   *      decision logger (RFC 001 § Q6 — Theme 5) can attribute
   *      decisions back to the originating role-permission pair
   *      without re-engineering.
   *
   * Calling `applyRoles` without configuring both `permissions` and
   * `systemRoles` throws — the registries are required for expansion.
   * Phase C will add `loadCustomRoles` to handle tenant-managed
   * roles; this method's contract is unchanged when that lands.
   *
   * @example
   *   const builder = new TenantAbilityBuilder(createMongoAbility, ctx, {
   *     permissions, // from definePermissions()
   *     systemRoles, // from defineRoles()
   *   });
   *   builder.applyRoles(ctx.roles); // ['admin', 'qa-reviewer']
   *   builder.can('manage', 'AuditLog'); // ad-hoc rules still allowed
   *   const ability = builder.build();
   *
   * @throws MultiTenantCaslError when `permissions` or `systemRoles`
   *   was not supplied to the builder.
   * @throws UnknownPermissionError when a role references a permission
   *   not in the registry.
   */
  public applyRoles(roleNames: readonly string[]): void {
    const permissions = this._opts.permissions;
    const systemRoles = this._opts.systemRoles;
    if (!permissions || !systemRoles) {
      throw new NestWardenError(
        'applyRoles() requires both `permissions` and `systemRoles` to be provided in ' +
          'TenantBuilderOptions. Pass them via definePermissions(...) and defineRoles(...).',
      );
    }

    // Custom roles loaded per-request via the factory's `loadCustomRoles`
    // hook. Indexed once per applyRoles invocation, not per role-name
    // lookup, since role lists are typically short and the array
    // typically small.
    const customRolesByName: ReadonlyMap<string, { permissions: readonly string[] }> = new Map(
      (this._opts.customRoles ?? []).map((r) => [r.name, { permissions: r.permissions }]),
    );

    for (const roleName of roleNames) {
      // System roles take precedence by name. The factory's validation
      // step rejects custom roles whose names collide with system
      // roles, so a well-formed setup never has both — but if
      // somehow both exist (e.g., consumer bypassed the factory), the
      // system role wins.
      const role = systemRoles[roleName] ?? customRolesByName.get(roleName);
      // Forward-compat: unknown role names are silently dropped so
      // adding a new role to the registry doesn't require coordinating
      // JWTs across all live sessions. RFC 001 § Q4 commentary.
      if (!role) continue;

      // Throws UnknownPermissionError on first unknown reference.
      validatePermissionReferences(permissions, roleName, role.permissions);

      for (const permissionName of role.permissions) {
        // Validation above guarantees this is defined.
        const permission = permissions[permissionName] as NonNullable<(typeof permissions)[string]>;
        const target = permission.crossTenant ? this.crossTenant : this;
        const reason = JSON.stringify({ role: roleName, permission: permissionName });

        // CASL's `can` has a heavy overload set we can't unify through
        // `Parameters<>` indexing. Cast to a permissive call signature
        // (same trick used by the wrap helpers above) so we can invoke
        // each variant: with fields + conditions, with fields only,
        // with conditions only, or with neither.
        const can = target.can as unknown as (...args: unknown[]) => {
          because?: (r: string) => unknown;
        };

        // Clone fields and conditions before handing them to CASL.
        // The `can` wrapper above mutates the rule's `conditions`
        // object in place to inject the tenant predicate; if we
        // passed the registry's object directly, the SHARED object
        // would accumulate state across requests (including across
        // tenants), which is a cross-tenant leak. Spreading creates
        // a per-call copy that the wrapper is free to mutate.
        const fields = permission.fields ? [...permission.fields] : undefined;
        const conditions = permission.conditions ? { ...permission.conditions } : undefined;

        const ruleBuilder =
          fields !== undefined && conditions !== undefined
            ? can(permission.action, permission.subject, fields, conditions)
            : fields !== undefined
              ? can(permission.action, permission.subject, fields)
              : conditions !== undefined
                ? can(permission.action, permission.subject, conditions)
                : can(permission.action, permission.subject);

        // Attach attribution metadata for the future decision logger
        // (RFC 001 § Q6). CASL's RuleBuilder exposes `.because(reason)`
        // which sets the rule's `reason` field; we call it via the
        // loose type above to avoid coupling to CASL's internal
        // RuleBuilder generic shape.
        ruleBuilder.because?.(reason);
      }
    }
  }
}

/**
 * Mutates the most-recently-pushed rule to merge the tenant predicate into
 * its `conditions`. Idempotent: if `tenantField` is already present, the
 * existing value wins (the consumer was explicit). If `conditions` is
 * absent, a fresh object is created.
 */
function injectTenantIntoLastRule(
  rules: ReadonlyArray<unknown>,
  tenantField: string,
  tenantId: TenantIdValue,
): void {
  const lastRule = rules[rules.length - 1] as { conditions?: Record<string, unknown> } | undefined;
  /* c8 ignore next */
  if (!lastRule) return; // unreachable: CASL's _addRule always pushes before this runs.

  const existing = lastRule.conditions;
  if (existing && typeof existing === 'object') {
    if (!Object.prototype.hasOwnProperty.call(existing, tenantField)) {
      existing[tenantField] = tenantId;
    }
    return;
  }

  lastRule.conditions = { [tenantField]: tenantId };
}

function markLastRuleCrossTenant(rules: ReadonlyArray<unknown>): void {
  const lastRule = rules[rules.length - 1];
  if (lastRule && typeof lastRule === 'object') {
    markCrossTenant(lastRule);
  }
}

/**
 * Asserts that CASL's `AbilityBuilder` constructor still assigns
 * `can`, `cannot`, and `build` as **instance properties** (not
 * prototype methods). `TenantAbilityBuilder` captures these instance
 * methods after `super()` and wraps them to inject the tenant
 * predicate; if a future CASL release moves them to the prototype,
 * the captures would be `undefined` and the wraps would silently
 * no-op — shipping rules without a tenant predicate, which is a
 * data-leak class.
 *
 * Called from `TenantAbilityBuilder`'s constructor. Exported so the
 * contract is testable from outside and so a future regression
 * (e.g., removing the call) fails loudly under the existing test
 * suite.
 *
 * @throws {NestWardenError} when any of the three captured references
 *   is not a function — typically the signal that the installed
 *   `@casl/ability` version has refactored its `AbilityBuilder`
 *   internals in a way that breaks nest-warden's wrap technique.
 *   nest-warden requires `@casl/ability` >=6.7.0 <7.0.0.
 */
export function assertCaslCouplingInvariant(captured: {
  can: unknown;
  cannot: unknown;
  build: unknown;
}): void {
  const missing: string[] = [];
  if (typeof captured.can !== 'function') missing.push('can');
  if (typeof captured.cannot !== 'function') missing.push('cannot');
  if (typeof captured.build !== 'function') missing.push('build');
  if (missing.length === 0) return;

  throw new NestWardenError(
    `Incompatible @casl/ability version: AbilityBuilder no longer ` +
      `assigns ${missing.map((m) => `\`${m}\``).join(', ')} as instance ` +
      `properties after construction. nest-warden's tenant-predicate ` +
      `injection wraps these instance methods, so a CASL refactor that ` +
      `moves them to the prototype would silently produce rules without ` +
      `a tenant predicate — a data-leak class. Pin @casl/ability to a ` +
      `compatible release: >=6.7.0 <7.0.0.`,
  );
}
