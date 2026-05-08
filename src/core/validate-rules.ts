import { CrossTenantViolationError } from './errors.js';
import { CROSS_TENANT_MARKER, isCrossTenantRule } from './tenant-rule.js';

export interface ValidateTenantRulesOptions {
  /** Field name expected at the top level of `conditions`. Defaults to `tenantId`. */
  readonly tenantField: string;
}

/**
 * Walks compiled raw rules and asserts every rule either:
 *   - has a top-level `tenantField` key in its `conditions`, or
 *   - is marked with the cross-tenant opt-out (created via `builder.crossTenant.*`).
 *
 * Throws `CrossTenantViolationError` on the first violation.
 *
 * Called by `TenantAbilityBuilder.build()` unless explicitly disabled via
 * `TenantBuilderOptions.validateRules: false`. Disabling validation is
 * intentionally undocumented in the README — it exists only to support
 * library-internal tests of the bypass path.
 *
 * Accepts any rule-like object so it composes with both CASL's strongly-typed
 * `RawRule<...>` and the loose `TaggedRawRule` shape used internally — the
 * runtime check is structural, so a permissive parameter type is the right
 * surface here.
 */
export function validateTenantRules(
  rules: ReadonlyArray<object>,
  options: ValidateTenantRulesOptions,
): void {
  for (const rule of rules) {
    if (isCrossTenantRule(rule)) continue;
    if (hasTenantPredicate(rule, options.tenantField)) continue;

    const r = rule as { action?: string | readonly string[]; subject?: string | readonly string[] };
    throw new CrossTenantViolationError(
      r.action ?? '<unspecified>',
      r.subject,
      options.tenantField,
    );
  }
}

/**
 * Detects whether a rule's `conditions` object pins the tenant field at the
 * top level. We deliberately do NOT recurse into `$or`/`$and`/`$nor` —
 * a tenant constraint inside a disjunction (`$or`) is not a global
 * tenant scope and would not protect against the other branch leaking.
 *
 * Acceptable shapes (all true):
 *   { tenantId: 'abc' }
 *   { tenantId: { $eq: 'abc' } }
 *   { tenantId: 'abc', other: 'foo' }
 *   { $and: [{ tenantId: 'abc' }, { other: 'foo' }] }
 *
 * Rejected shapes (all false):
 *   undefined / null
 *   {}
 *   { other: 'foo' }
 *   { $or: [{ tenantId: 'a' }, { tenantId: 'b' }] }   // not pinned at top
 *   { $or: [{ tenantId: 'a' }, { other: 'foo' }] }    // leaks via 2nd branch
 */
function hasTenantPredicate(rule: object, tenantField: string): boolean {
  const conditions = (rule as { conditions?: unknown }).conditions;
  if (conditions === undefined || conditions === null) return false;
  if (typeof conditions !== 'object') return false;

  const cond = conditions as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(cond, tenantField)) return true;

  // `$and` is the only conjunctive form that propagates tenant scope to all
  // siblings; if any direct child of `$and` pins the tenant field, we're safe.
  const andClause = cond['$and'];
  if (Array.isArray(andClause)) {
    for (const child of andClause) {
      if (
        child !== null &&
        typeof child === 'object' &&
        Object.prototype.hasOwnProperty.call(child, tenantField)
      ) {
        return true;
      }
    }
  }

  return false;
}

// Re-exported for downstream tooling (e.g., audit-log scrapers that need to
// distinguish tenant-scoped from cross-tenant rules).
export { CROSS_TENANT_MARKER };
