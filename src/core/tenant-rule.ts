/**
 * Marker key set on a raw CASL rule when it was created via the
 * `crossTenant` opt-out — i.e., the consumer explicitly chose NOT to scope
 * the rule to a single tenant. CASL ignores unknown properties, so this
 * survives `Rule.origin` and is inspectable at build/validate time.
 */
export const CROSS_TENANT_MARKER = '__mtCrossTenant' as const;

/**
 * Minimal structural shape for a raw rule augmented with our cross-tenant
 * marker. We don't import CASL's `RawRule` here because its generic
 * constraint (`AbilityTypes`) is awkward to plumb through utility code that
 * just needs "an object that might have these fields."
 */
export interface TaggedRawRule {
  action?: string | readonly string[];
  subject?: string | readonly string[];
  conditions?: unknown;
  fields?: string | string[];
  inverted?: boolean;
  reason?: string;
  readonly [CROSS_TENANT_MARKER]?: true;
}

/**
 * Returns true if the given rule was tagged via {@link markCrossTenant}.
 *
 * Accepts any object — the marker is a non-enumerable property that survives
 * round-trips through CASL's rule index intact, so library consumers can
 * inspect the origin rule from `Rule.origin` for audit-log scraping.
 */
export function isCrossTenantRule(rule: object): boolean {
  return (rule as { readonly [k: string]: unknown })[CROSS_TENANT_MARKER] === true;
}

/**
 * Marks a raw rule as cross-tenant. The marker is non-enumerable and
 * non-writable, so it does not appear in JSON, structuredClone, or
 * `Object.keys` output, but it remains observable via property access and
 * `getOwnPropertyDescriptor`.
 *
 * Calling `markCrossTenant` on the same object twice is a no-op-but-safe:
 * the second call is rejected silently by V8 because the property is
 * `configurable: false` and the value is identical. We let JavaScript's
 * default behavior handle that case rather than wrapping with our own
 * guard.
 */
export function markCrossTenant(rule: object): void {
  if (isCrossTenantRule(rule)) return;
  Object.defineProperty(rule, CROSS_TENANT_MARKER, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}
