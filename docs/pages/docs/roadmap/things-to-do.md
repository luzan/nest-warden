---
title: Things to do
---

Where nest-warden is headed after v0.1.0-alpha. This page is the
public roadmap — items here are deliberately scoped, not promised
on a date. Concrete design decisions show up as RFC issues on the
GitHub repo before any of these ship.

## Where we are

**v0.1.0-alpha** — released April 2026.

- Tenant-aware ability builder with cross-tenant safety enforced
  at `.build()` time
- Conditional authorization wired through `@ucast/mongo2js` (no
  silent-drop bugs)
- Relationship graph + `$relatedTo` operator (foreignKey, joinTable,
  custom resolvers)
- TypeORM `accessibleBy()` reverse-lookup adapter — single-query
  resolution, parameterized SQL, EXISTS subqueries for graph hops
- NestJS module, guards, decorators, request-scoped context
- Postgres RLS interceptor (defense-in-depth)
- 100% test coverage on the library; 14 E2E tests against
  testcontainers Postgres in the example
- Documentation site (this site)

The library is **API-unstable** at this stage. Names, signatures,
and module boundaries may change before v1.0.0.

## Roadmap themes

The work below is grouped by theme, in rough priority order. Within
each theme, items are concrete enough to land in a milestone but
loose enough that the API design is still open for input.

### 1. Roles on top of PBAC

**Problem.** Today, consumers express authorization as CASL rules in
a `defineAbilities` callback. That works for engineering teams who
can author rules in TypeScript — it does not work for non-technical
tenant admins who need to manage permissions through a UI.

The pattern most multi-tenant SaaS apps end up with is: hard-code a
small set of "system roles" (Admin, Developer, View Only) and let
tenants create custom roles by composing predefined permissions.
nest-warden has no first-class affordance for this today.

**Sketch.**

```ts
// Define named permissions once
const permissions = definePermissions({
  'merchants:read': { action: 'read', subject: 'Merchant' },
  'merchants:approve': {
    action: 'approve',
    subject: 'Merchant',
    conditions: { status: 'pending' },
  },
  'payments:refund': { action: 'refund', subject: 'Payment' },
});

// Define system roles (or load from DB for tenant-managed roles)
const roles = defineRoles({
  admin: ['merchants:read', 'merchants:approve', 'payments:refund'],
  developer: ['merchants:read', 'payments:refund'],
  viewOnly: ['merchants:read'],
});

// In the ability factory, expand role names into rules
builder.applyRoles(ctx.roles, { roles, permissions });
```

**Open design questions** (need decisions before coding):

- **Custom roles per tenant**, or only a global system-role registry?
  Tenant-managed custom roles need persistence the library doesn't
  ship today. System-only is far simpler.
- **Inheritance model.** Does "Admin extends Developer + adds X"
  carry weight, or does role union (no inheritance) cover the
  common case?
- **Permission naming.** Are permission names (`merchants:read`) the
  primary identifier, or is the underlying CASL `(action, subject)`
  pair? Names are friendlier for UIs; pairs preserve full
  conditional-authz expressiveness.
- **Storage.** Ship a sample TypeORM entity (`@Entity Role` with
  a `permissions` jsonb column), or stay storage-agnostic and let
  consumers wire whatever ORM they use?

A future RFC issue will pin these down. For now: **input wanted.**

### 2. Deeper example coverage

**Problem.** The example app's 14 E2E tests cover cross-tenant
isolation, ISO admin reach, agent restriction, and the
`@AllowCrossTenant` opt-out. They cover the headline behaviors
but not the long tail — and the long tail is where bugs hide.

**Concrete additions:**

- **Conditional rules in flight** — assert that a rule with
  `{ status: 'active' }` actually filters out inactive rows in
  both forward checks and `accessibleBy()` SQL.
- **Update/Delete paths** — `TenantSubscriber.beforeUpdate` should
  reject rows whose persisted `tenantId` doesn't match the request
  context. Today this is unit-tested but not E2E-tested.
- **Field-level restrictions** — `builder.can('read', 'Merchant',
  ['name', 'status'])` should hide other fields. Verify CASL's
  field projection through to the controller response.
- **Multi-role merge** — a user holding both `iso_admin` and
  `agent` roles: rules from both should compose via union, not
  conflict.
- **Negative authorization** — `builder.cannot('refund',
  'Payment', { amount: { $gt: 10000 } })` blocks high-value
  refunds even when the positive role permits refunds. E2E
  proof.
- **Soft-deleted rows** — interaction between
  `@DeleteDateColumn` and `accessibleBy()` (does `WHERE
  deleted_at IS NULL` compose correctly?).
- **Once role abstraction lands (theme 1)** — wire one tenant
  in the example to use named roles end-to-end, including
  a controller that lets the tenant edit roles and immediately
  see the effect.

These tests are TDD-first per the example's existing pattern:
the test goes in before the code or fixture change.

### 3. Tenant-aware webhook security

**Problem.** Inbound webhooks (Stripe, Twilio, GitHub, etc.)
arrive without a JWT. They carry an HMAC signature, and the
correct tenant must be identified before any business logic
runs. nest-warden's current `TenantContextInterceptor` assumes
a JWT-bearing request.

**Sketch.**

```ts
@Controller('webhooks')
export class StripeWebhookController {
  @Post(':tenantId/stripe')
  @UseGuards(WebhookGuard)
  @WebhookProvider('stripe')          // names which secret to use
  async handle(
    @CurrentTenant() ctx: TenantContext,
    @Body() payload: StripeEvent,
  ) {
    // ctx is verified-via-HMAC at this point; payload is the
    // verified payload. Repos called from here are tenant-scoped
    // exactly like a JWT-authenticated request.
  }
}
```

**Open design questions:**

- **Tenant identification.** From URL path (`/webhooks/:tenantId/...`),
  HTTP header, or payload inspection? Each has tradeoffs — URL is
  simplest but exposes tenant IDs; header requires provider support;
  payload requires parse-before-verify which is a footgun.
- **Per-tenant secrets.** Where does the webhook secret live?
  Ship a sample table, or require a callback
  `resolveWebhookSecret(tenantId, provider)`?
- **Provider scope.** First class for "generic HMAC" only, or
  ship Stripe/Twilio/GitHub adapters? Generic is more useful
  long-term; provider-specific is more useful short-term for
  consumers who don't want to read 5 different signature schemes.
- **Outbound webhooks.** Out of scope for v0.x or in scope?
  Outbound is more about secret rotation and per-tenant URL
  storage than authorization, so it may not belong here at all.

### 4. API stability commitment

**Problem.** v0.1 is alpha and the API will change. Without an
explicit "API freeze" gate, every rename is a downstream
breaking change with no warning.

**Plan.**

- Tag v0.x releases with explicit `BREAKING CHANGE` entries in
  the CHANGELOG when the public surface shifts.
- Before v1.0.0, publish an **API freeze RFC** — a single doc
  enumerating every exported symbol with a "stable / experimental
  / deprecated" tag. Anything still experimental at freeze gets
  hidden from `index.ts` until it's ready.
- Adopt `@deprecated` JSDoc tags + an ESLint rule
  (`@typescript-eslint/no-deprecated`) so consumers see warnings
  before removal.
- The freeze gate is one of two v1.0.0 prerequisites. The other
  is theme 6 (production soak).

### 5. Authorization decision logging

**Problem.** CASL has no hook for "rule X allowed/denied this
request for tenant Y." For PCI-scoped systems, audit trails of
authorization decisions are a compliance ask. Today, consumers
who want this either monkey-patch CASL or wrap every check site.

**Sketch.**

```ts
TenantAbilityModule.forRoot({
  decisionLogger: (decision) => {
    // decision: { allowed, action, subject, tenantId, subjectId,
    //   matchedRule, conditions, timestamp }
    auditLog.write(decision);
  },
});
```

The library would call the logger from `TenantPoliciesGuard`
after each check (and from `accessibleBy()` for reverse lookups,
where the "decision" is the SQL emitted). Logger is sync to keep
the surface simple; consumers can buffer/batch async on their
side.

**Open questions:**

- Log every decision (high volume, full trail) or only denials
  (low volume, partial trail)?
- Include the loaded entity in `read`/`update` decisions? PII
  concern — the entity may contain CHD or PII that doesn't belong
  in the audit log.
- Coverage: does the `accessibleBy()` reverse lookup get logged
  per-row or per-query? Per-query is the only sane choice for
  performance, but it changes the audit grain.

### 6. Production soak — the v1.0 gate

**Problem.** Library code can be 100%-covered and still wrong in
ways only production traffic surfaces — race conditions on the
RLS session variable across pooled connections, transaction
boundaries that don't compose with consumer middleware, edge
cases in `$relatedTo` paths that the example schema doesn't
hit.

The v1.0 milestone is "exercised in a real production NestJS +
TypeORM app for at least one quarter." That's not a feature; it's
a soak period. It exists on the roadmap so the v1.0 cut isn't
arbitrary.

Concrete asks of the soak phase:

- Capture every issue surfaced under real load in the
  `examples/nestjs-app/FINDINGS.md` format (symptom, root cause,
  fix, regression test) — these are the highest-value
  documentation artifacts the project produces.
- Benchmark `accessibleBy()` against
  `loadAll().filter(can(...))` on a realistic dataset (10k+
  resources). Publish the numbers.
- Stress-test RLS under connection pooling — a leaked session
  variable across requests is the failure mode that's hardest
  to detect and worst to ship.

## Not on this roadmap

Items that have been considered and deliberately deferred:

- **Mongoose / Sequelize / Drizzle adapters.** TypeORM-only for
  v0.x. If demand surfaces post-v1.0, an adapter can mirror the
  shape of the TypeORM compiler.
- **Distributed relationship store / Zanzibar tuples.**
  Relationships live in the application's own tables, by design.
  If a consumer needs sub-second propagation across services, they
  can pair nest-warden with OpenFGA or SpiceDB directly — those
  are decision engines and we're not.
- **A built-in role management UI.** Storage-agnostic. UI is
  always the consumer's problem.
- **Policy persistence.** Where rules come from
  (database, JWT, hardcoded registry) is the consumer's concern.

## How to influence this roadmap

- Open a GitHub Discussion for design questions (no commitment,
  early input).
- Open a GitHub Issue with the `rfc:` prefix for a concrete
  proposal you'd like reviewed.
- Pull requests welcome — the open design questions in each
  theme are the natural starting points.

## See also

- [CHANGELOG](https://github.com/luzan/nest-warden/blob/main/CHANGELOG.md) — what shipped, what's pending
- [Why nest-warden?](/docs/get-started/why/) — the four CASL gaps that motivated the project
