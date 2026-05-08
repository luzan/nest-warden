---
title: API Overview
---

This page enumerates the public surface of nest-warden's three
subpath exports. Every symbol below is also documented in the
source via JSDoc — your IDE / `tsdoc` / API extractor will pull the
detailed signatures from there. A future iteration of the docs site
will auto-generate per-symbol pages from JSDoc.

## `nest-warden` (core, isomorphic)

### Types

- `TenantContext<TId extends TenantIdValue = string>` — request-scope identity bag.
- `TenantIdValue = string | number` — admissible tenant ID types.
- `TenantAbility<A, C>` — public alias for `MongoAbility<A, C>` produced by the builder.
- `Relationship<TFrom, TTo>` — graph edge declaration.
- `RelatedToCondition` — the `$relatedTo` operator value shape.
- `RelationshipPath` — resolved sequence of hops returned by graph lookups.

### Classes

- `TenantAbilityBuilder<TAbility, TId>` — the auto-tenant-scoped builder.
  - `.can`, `.cannot` — auto-scoped rule additions (CASL-compatible signature).
  - `.crossTenant.can`, `.crossTenant.cannot` — explicit cross-tenant opt-out.
  - `.build(options?)` — runs `validateTenantRules` then delegates to CASL.
  - `.tenantField`, `.tenantContext` — read-only accessors.
- `RelationshipGraph` — registry of relationships + BFS path resolver.
  - `.define(relationship)` — add a relationship; throws on duplicate names.
  - `.has(name)`, `.get(name)`, `.all()` — lookups.
  - `.path(from, to, options?)` — BFS shortest path.
  - `.resolvePath(names)` — validate and resolve a hand-specified path.

### Resolver factories

- `foreignKey(options)` — 1:N or N:1 via FK column.
- `joinTable(options)` — M:N via junction table.
- `custom(options)` — escape hatch with raw SQL fragment.

### Helpers

- `validateTenantRules(rules, options)` — assert tenant-predicate presence.
- `tenantConditionsMatcher` — alias for CASL's `mongoQueryMatcher`.
- `createTenantConditionsMatcher({ graph })` — matcher that handles `$relatedTo`.
- `evaluateRelatedTo(subject, condition, graph)` — forward-direction `$relatedTo` check.
- `markCrossTenant(rule)`, `isCrossTenantRule(rule)` — opt-out marker helpers.
- `createTenantAbility` — re-export of `createMongoAbility` for parity.

### Errors

- `MultiTenantCaslError` — base class; check via `instanceof`.
- `CrossTenantViolationError` — rule lacks tenant predicate at `.build()`.
- `MissingTenantContextError` — `TenantContextService.get()` before resolution.
- `UnsupportedOperatorError` — TypeORM compiler hit an unknown operator.
- `RelationshipNotDefinedError` — `$relatedTo` references unregistered relationship.
- `InvalidRelationshipPathError` — hand-specified path doesn't chain.
- `RelationshipDepthExceededError` — `graph.path` couldn't find a path within depth limit.
- `DuplicateRelationshipError` — `graph.define` saw a name collision.

### Constants

- `DEFAULT_TENANT_FIELD = 'tenantId'`
- `DEFAULT_MAX_DEPTH = 5`
- `RELATED_TO_OPERATOR = '$relatedTo'`
- `CROSS_TENANT_MARKER` — Symbol-keyed marker on opt-out rules.

## `nest-warden/typeorm` (TypeORM adapter)

### Public API

- `accessibleBy(ability, action, subjectType, options)` — main entry point. Returns `{ sql, applyTo(qb) }`.
- `buildAccessibleSql(ability, action, subjectType, options)` — lower-level SQL fragment builder.
- `TenantAwareRepository<T>` — Repository wrapper with auto WHERE injection.
- `TenantSubscriber` — TypeORM subscriber for auto-stamping inserts.
- `RlsTransactionInterceptor` — NestJS interceptor that opens a transaction and runs `set_config(...)`.

### Decorators

- `@TenantColumn()` — marker for the tenant-FK column on entities.

### Helpers

- `getTenantColumn(target)` — read the `@TenantColumn` metadata.
- `buildRlsSet(tenantId, variableName?)` — build the `set_config(...)` statement.

### Constants

- `DEFAULT_RLS_SESSION_VARIABLE = 'app.current_tenant_id'`
- `TENANT_COLUMN_METADATA` — Symbol-keyed metadata key for `@TenantColumn`.

## `nest-warden/nestjs` (NestJS adapter)

### Module

- `TenantAbilityModule.forRoot<TAbility, TId>(options)` — dynamic module entry.

### Services

- `TenantContextService<TId>` — request-scoped holder for the resolved context.
- `TenantAbilityFactory<TAbility, TId>` — request-scoped per-request ability builder.

### Guards

- `TenantPoliciesGuard<TAbility>` — runs `@CheckPolicies(...)` handlers.

### Interceptors

- `TenantContextInterceptor<TId>` — optional explicit hook (the policies guard self-resolves).

### Decorators

- `@Public()` — bypass auth + tenant resolution.
- `@CheckPolicies(...handlers)` — attach policy handlers to a route.
- `@AllowCrossTenant(reasonCode)` — mark route as deliberately cross-tenant.
- `@CurrentTenant(field?)` — inject the resolved context (or one field) into a controller param.

### Types

- `TenantAbilityModuleOptions<TAbility, TId>` — `forRoot()` options shape.
- `PolicyHandler<TAbility>` — object form of a policy handler.
- `PolicyHandlerFn<TAbility>` — function form.
- `PolicyHandlerLike<TAbility>` — union of both.

### Tokens

- `MTC_OPTIONS` — Symbol-keyed token for the resolved options.
- `IS_PUBLIC_KEY`, `CHECK_POLICIES_KEY`, `ALLOW_CROSS_TENANT_KEY` — Reflector metadata keys.

## TypeScript module resolution

For the subpath exports to resolve, set TypeScript's module
resolution to one that respects them:

```json
{
  "compilerOptions": {
    "moduleResolution": "Bundler",
    "// or:": "NodeNext (Node.js 18+)",
    "module": "ESNext"
  }
}
```

`moduleResolution: "Node"` (TypeScript's old default) does NOT
support package subpath exports — upgrade to `Bundler` (TS 5.0+) or
`NodeNext`.

## See also

- [Installation](/docs/get-started/installation/)
- [NestJS integration](/docs/integration/nestjs/)
- [TypeORM integration](/docs/integration/typeorm/)
