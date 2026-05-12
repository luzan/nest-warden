/**
 * Base class for all errors raised by `nest-warden`. Allows consumers to
 * `instanceof NestWardenError` to distinguish library errors from
 * unrelated exceptions.
 *
 * Renamed from `MultiTenantCaslError` in 0.3.0-alpha. The old name
 * remains exported as a `@deprecated` value- and type-level alias
 * (see bottom of file) so existing `catch (e instanceof
 * MultiTenantCaslError)` sites compile and behave identically. The
 * alias is the **same constructor reference**, not a subclass — that's
 * the only shape that lets both names participate in `instanceof`
 * symmetrically. The alias is slated for removal in v1.0.
 */
export class NestWardenError extends Error {
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
export class CrossTenantViolationError extends NestWardenError {
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
export class MissingTenantContextError extends NestWardenError {
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
export class UnsupportedOperatorError extends NestWardenError {
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
export class RelationshipNotDefinedError extends NestWardenError {
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
export class InvalidRelationshipPathError extends NestWardenError {
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
export class RelationshipDepthExceededError extends NestWardenError {
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
export class DuplicateRelationshipError extends NestWardenError {
  constructor(public readonly relationshipName: string) {
    super(
      `Relationship "${relationshipName}" is already registered. Each ` +
        `relationship must have a unique name; choose a different one or ` +
        `remove the existing definition first.`,
    );
  }
}

/**
 * Thrown when a role references a permission name that does not exist
 * in the permission registry. See RFC 001 (Roles abstraction) for the
 * registry contract — permission references are validated at module
 * bootstrap and at every `loadCustomRoles` invocation.
 *
 * @experimental
 * Part of the tenant-managed-roles surface (`loadCustomRoles` +
 * `CustomRoleEntry`). The class name, the public fields, and the
 * message shape may change before v1.0 as the surface stabilises.
 * See Theme 9 in the roadmap.
 */
export class UnknownPermissionError extends NestWardenError {
  constructor(
    public readonly roleName: string,
    public readonly permission: string,
  ) {
    super(
      `Role "${roleName}" references unknown permission "${permission}". ` +
        `Add it to the permission registry via definePermissions(), or ` +
        `correct the spelling on the role.`,
    );
  }
}

/**
 * Thrown when a custom role's name collides with a system role of the
 * same name. System role names are reserved (RFC 001 § Q4); the request
 * fails closed with an empty role set if a `loadCustomRoles` callback
 * returns a colliding entry.
 *
 * @experimental
 * Part of the tenant-managed-roles surface (`loadCustomRoles` +
 * `CustomRoleEntry`). The class name, the public fields, and the
 * message shape may change before v1.0 as the surface stabilises.
 * See Theme 9 in the roadmap.
 */
export class SystemRoleCollisionError extends NestWardenError {
  constructor(public readonly roleName: string) {
    super(
      `Custom role "${roleName}" collides with a system role of the same ` +
        `name. System role names are reserved and cannot be redefined ` +
        `per-tenant. Rename the custom role.`,
    );
  }
}

function stringifyActionOrSubject(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.join(',') : (value as string);
}

/**
 * @deprecated Renamed to {@link NestWardenError} in 0.3.0-alpha.
 * Slated for removal in v1.0. The alias is the **same constructor
 * reference** as `NestWardenError` (not a subclass), so all existing
 * `instanceof MultiTenantCaslError` catch-sites continue to match
 * library-thrown errors transparently. Migrate by find-and-replacing
 * the identifier; no behavior changes.
 *
 * Re-exported as both a value (constructor) and a type (instance shape)
 * so call-sites that use it as either form keep compiling.
 */
export const MultiTenantCaslError = NestWardenError;
/**
 * @deprecated Renamed to {@link NestWardenError} in 0.3.0-alpha.
 * Slated for removal in v1.0. See the value-level alias above for the
 * migration story.
 */
export type MultiTenantCaslError = NestWardenError;
