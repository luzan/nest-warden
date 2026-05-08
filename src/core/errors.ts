/**
 * Base class for all errors raised by `nest-warden`. Allows consumers to
 * `instanceof MultiTenantCaslError` to distinguish library errors from
 * unrelated exceptions.
 *
 * Class name retained as `MultiTenantCaslError` for API compatibility — the
 * library was renamed from `multi-tenant-casl` to `nest-warden` after the
 * 0.1.0-alpha cycle but the error symbol stayed.
 */
export class MultiTenantCaslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by `validateTenantRules` at `.build()` time when a rule lacks a
 * tenant predicate and is not marked `crossTenant`. This is the structural
 * guarantee that no rule can leak across tenants.
 */
export class CrossTenantViolationError extends MultiTenantCaslError {
  constructor(
    public readonly action: string | readonly string[],
    public readonly subject: string | readonly string[] | undefined,
    public readonly tenantField: string,
  ) {
    super(
      `Rule for action="${stringifyActionOrSubject(action)}" subject="${stringifyActionOrSubject(subject) ?? '<all>'}" ` +
        `is missing the required tenant predicate "${tenantField}" and is not marked as crossTenant. ` +
        `Either include "${tenantField}" in the rule's conditions or use builder.crossTenant.can(...) for ` +
        `intentionally cross-tenant rules (e.g., platform-staff access).`,
    );
  }
}

/** Thrown when a tenant context cannot be resolved for a request. */
export class MissingTenantContextError extends MultiTenantCaslError {
  constructor(reason = 'No tenant context was resolved for this request.') {
    super(reason);
  }
}

/**
 * Thrown by the TypeORM compiler when a rule's condition uses a Mongo-style
 * operator that is not supported in v1 (e.g., `$where`, `$mod`, `$text`).
 *
 * Explicit failure beats silent dropping — hand-rolled condition
 * translators that emit invalid Mongo syntax (e.g., `{ equals: value }`
 * instead of `{ $eq: value }`) produce rules that match everything with
 * no runtime error. This library refuses unknown operators rather than
 * letting them disappear.
 */
export class UnsupportedOperatorError extends MultiTenantCaslError {
  constructor(public readonly operator: string) {
    super(
      `Operator "${operator}" is not supported by the TypeORM compiler. ` +
        `Supported: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, and, or, $relatedTo.`,
    );
  }
}

/**
 * Thrown when a `$relatedTo` operator references a relationship name that
 * was never registered with the graph, or when a path cannot be resolved
 * end-to-end.
 */
export class RelationshipNotDefinedError extends MultiTenantCaslError {
  constructor(public readonly relationshipName: string) {
    super(
      `Relationship "${relationshipName}" was referenced in a $relatedTo ` +
        `path but is not registered in the RelationshipGraph. Define it ` +
        `via graph.define({ name: "${relationshipName}", from, to, resolver }).`,
    );
  }
}

/**
 * Thrown when a registered relationship sequence does not chain
 * (the `to` of one hop does not match the `from` of the next hop).
 */
export class InvalidRelationshipPathError extends MultiTenantCaslError {
  constructor(
    public readonly path: readonly string[],
    public readonly reason: string,
  ) {
    super(`Invalid $relatedTo path [${path.join(' → ')}]: ${reason}`);
  }
}

/**
 * Thrown when `RelationshipGraph.path()` encounters a path that exceeds
 * the configured maximum depth — a guard against pathological multi-hop
 * joins that would generate massive SQL queries.
 */
export class RelationshipDepthExceededError extends MultiTenantCaslError {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly maxDepth: number,
  ) {
    super(
      `No path from "${from}" to "${to}" within depth ${maxDepth}. ` +
        `Increase maxDepth in graph.path() options if a deeper path is genuinely needed, ` +
        `or add intermediate relationships to shorten the route.`,
    );
  }
}

/**
 * Thrown when registering a relationship whose `name` is already in use.
 */
export class DuplicateRelationshipError extends MultiTenantCaslError {
  constructor(public readonly relationshipName: string) {
    super(
      `Relationship "${relationshipName}" is already registered. Each ` +
        `relationship must have a unique name; choose a different one or ` +
        `remove the existing definition first.`,
    );
  }
}

function stringifyActionOrSubject(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(',') : (value as string);
}
