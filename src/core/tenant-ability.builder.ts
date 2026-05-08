import {
  AbilityBuilder,
  type AbilityClass,
  type AbilityOptionsOf,
  type AnyAbility,
  type CreateAbility,
} from '@casl/ability';
import { DEFAULT_TENANT_FIELD, type TenantIdValue } from './tenant-id.js';
import type { TenantContext } from './tenant-context.js';
import { markCrossTenant } from './tenant-rule.js';
import { validateTenantRules } from './validate-rules.js';

export interface TenantBuilderOptions {
  /** Resource field that carries the tenant ID. Default: `tenantId`. */
  readonly tenantField?: string;
  /** Run `validateTenantRules` at `.build()`. Default: `true`. */
  readonly validateRules?: boolean;
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
  private readonly _opts: Required<TenantBuilderOptions>;

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
    };

    // CASL's AbilityBuilder assigns `can`/`cannot` as instance properties in
    // its own constructor (see casl-ability/src/AbilityBuilder.ts). After
    // `super()`, `this.can` is the bound function we want to wrap. There is
    // no usable `super.can` — the prototype is empty for these names.
    const baseCan = this.can;
    const baseCannot = this.cannot;

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

    // CASL declares `build` as an instance field too; we wrap it identically
    // to `can`/`cannot` rather than via class inheritance so the validator
    // runs even when consumers store the builder behind the parent type.
    const baseBuild = this.build;
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
