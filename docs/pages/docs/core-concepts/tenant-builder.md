---
title: Tenant-aware Builder
---

`TenantAbilityBuilder` is the centerpiece of nest-warden — it extends
CASL's `AbilityBuilder` with **automatic tenant-predicate injection** on
every rule.

## The behavior

Without nest-warden:

```ts
// Stock CASL — manual tenant scoping (footgun-prone)
const builder = new AbilityBuilder<AppAbility>(createMongoAbility);
builder.can('read', 'Merchant', { tenantId: ctx.tenantId, status: 'active' });
//                                ^^^^^^^^^^^^^^^^^^^^^^^^
//                                forget once → cross-tenant leak
builder.can('update', 'Merchant', { tenantId: ctx.tenantId, agentId: ctx.subjectId });
//                                  ^^^^^^^^^^^^^^^^^^^^^^^^
//                                  repeated on every rule
```

With nest-warden:

```ts
// nest-warden — auto-scoped by construction
const builder = new TenantAbilityBuilder<AppAbility>(createMongoAbility, ctx);
builder.can('read', 'Merchant', { status: 'active' });
//   ↑ tenantId injected from `ctx` at this exact call
builder.can('update', 'Merchant', { agentId: ctx.subjectId });
//   ↑ also auto-scoped, no repetition
```

After `builder.build()`, both rules carry the tenant predicate exactly
as if you'd written it manually. The runtime behavior is identical to
stock CASL — the only difference is who wrote the predicate.

## How it works

`TenantAbilityBuilder` overrides `can()` and `cannot()` to call CASL's
internal `_addRule`, then post-process the just-pushed rule to merge in
the tenant predicate. The base CASL plumbing is intact; we only bolt
on a one-line mutation per rule.

At `.build()`, `validateTenantRules` walks every rule and asserts each
either:

1. Has the `tenantField` key in its conditions, or
2. Is marked with the cross-tenant opt-out (created via
   `builder.crossTenant.*`).

A violation throws `CrossTenantViolationError` immediately — no rule
makes it into a built ability without one of those two markers.

## Custom tenant field

If your app uses a different column name (e.g., `orgId`):

```ts
const builder = new TenantAbilityBuilder<AppAbility>(
  createMongoAbility,
  ctx,
  { tenantField: 'orgId' },
);
```

The injection and validation now use `orgId`. This must match the
`@TenantColumn()` you've placed on your TypeORM entities and the
`tenantField` option on `TenantAbilityModule.forRoot()`.

## Numeric tenant IDs

Pass `number` as the second generic:

```ts
const builder = new TenantAbilityBuilder<AppAbility, number>(
  createMongoAbility,
  { tenantId: 42, subjectId: 1, roles: ['agent'] },
);
builder.can('read', 'Merchant');
// → conditions: { tenantId: 42 }
```

## Disabling the validator (escape hatch)

For library-internal tests of the bypass path:

```ts
const builder = new TenantAbilityBuilder<AppAbility>(
  createMongoAbility,
  ctx,
  { validateRules: false },
);
```

This is intentionally undocumented in the README. **Don't use this
in production code** — it removes the structural guarantee. If you
have a legitimate cross-tenant rule, use `builder.crossTenant.can(...)`
instead; the validator accepts it.

## Builder API at a glance

```ts
class TenantAbilityBuilder<TAbility, TId extends TenantIdValue = string>
  extends AbilityBuilder<TAbility>
{
  // Auto tenant-scoped (default usage)
  can: (action, subject, conditions?, fields?) => RuleBuilder;
  cannot: (action, subject, conditions?, fields?) => RuleBuilder;

  // Cross-tenant opt-out (no injection, marked for audit)
  crossTenant: {
    can: AbilityBuilder['can'];
    cannot: AbilityBuilder['cannot'];
  };

  // Build with validation (throws on missing tenant predicate)
  build(options?: AbilityOptions): TAbility;

  // Read-only accessors
  get tenantField(): string;
  get tenantContext(): TenantContext<TId>;
}
```

## See also

- [Tenant Context](/docs/core-concepts/tenant-context/) — what feeds the builder.
- [Cross-tenant Opt-out](/docs/core-concepts/cross-tenant/) — when to bypass injection.
- [Conditional Authorization](/docs/core-concepts/conditional-authorization/) — Mongo operators that compose with the tenant predicate.
