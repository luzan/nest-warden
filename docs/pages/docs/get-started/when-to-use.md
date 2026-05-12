---
title: When (not) to use nest-warden
---

nest-warden is a TypeScript library that lives **inside your NestJS
process**. There's no separate authorization server, no daemon, no
API endpoint to call. Rules are JS objects rebuilt per request; they
compile to SQL that runs on your existing Postgres; RLS in the same
Postgres is the second layer.

The boundary of the system is **one app talking to one database**
(or a small set of apps sharing the same database). That shape
determines what's possible — and what isn't.

## Possible — because the app + database is the boundary

| Use case | Why it works |
|---|---|
| One NestJS app, multi-tenant SaaS, one Postgres | Rule evaluation and SQL emission run in the same request, against the same connection |
| Conditional row-level access (e.g., `status: 'pending'`) | Conditions compile to SQL, executed by the same DB that holds the rows |
| Graph traversal within one DB (`Payment → Merchant → Agent`) | `$relatedTo` becomes an `EXISTS` subquery — same DB, same transaction |
| Postgres RLS as defense-in-depth | Library and DB cooperate via a session variable; both layers see the same tenant context |
| Per-request rule rebuild | Rules are cheap; new role assignments take effect on the next request |
| Frontend UI gating with the same rules | Core is isomorphic — the same `ability.can(...)` checks run in the browser |

For these workloads, nest-warden is faster than calling out to an
authorization service (no network hop), simpler to operate (no extra
fleet to run), and has full conditional + graph support compiled to
native SQL.

## Not possible — or possible only with extra plumbing you'd build yourself

| Use case | Why nest-warden alone can't do it |
|---|---|
| App A and App B (different services, different DBs) sharing authorization state | nest-warden has no way to know about App B's relationships. You'd have to replicate relationship tables across DBs or move authorization to a shared decision service |
| Global, instant revocation across many services | Revoking a role in your DB only takes effect in apps that re-read your DB on every request. Existing JWTs stay valid until expiry. OpenFGA propagates tuple deletes via its API |
| Sub-second permission changes propagating across a fleet | Same root cause — no shared decision service. Each app reads the world independently |
| Native iOS / Android / Go service running the same checks | The rule engine is JavaScript. CASL has Java/Python ports, but nest-warden's multi-tenant + `$relatedTo` extensions don't. OpenFGA has SDKs in many languages all hitting the same Check API |
| Centralized audit trail of every authorization decision across services | Each nest-warden process produces its own log. To unify, you'd ship logs to a central store yourself. OpenFGA's Check API records every decision in one place |
| External integrations (webhooks, partner APIs, batch jobs) enforcing your permissions without DB access | They'd have to query your DB or call your app. With OpenFGA, they call the Check API directly |
| Ground-truth permission tuples managed by a security team independent of app deploys | Roles and rules live in your code or your DB. Changing them goes through your normal deploy / migration cycle |

Some of these are solvable with engineering — replicating tables,
shipping logs to a central store, hitting your app's `/check` endpoint
from external services. The honest framing: at that point you're
re-implementing what
[OpenFGA](https://openfga.dev/),
[SpiceDB](https://authzed.com/spicedb/),
or
[Permit.io](https://www.permit.io/)
already ship.

## Decision boundary

Pick nest-warden when:

- Your authorization model fits in one app + one database.
- You want full conditional and graph support compiled to native SQL.
- You don't want to operate another service.
- The same rules need to gate UI and backend, in JavaScript.

Pick a Zanzibar-style decision service ([OpenFGA](https://openfga.dev/),
[SpiceDB](https://authzed.com/spicedb/),
[Permit.io](https://www.permit.io/)) when:

- Multiple services in different languages need to enforce the same
  permissions.
- You need sub-second propagation of permission changes across a
  fleet.
- External integrations (webhooks, partner APIs, batch jobs) need
  to enforce your permissions without DB access.
- A centralized audit trail of every decision is a hard requirement.

## Hybrid is fine

The two worlds can coexist. A common shape:

- nest-warden inside your NestJS app for fast in-process gating —
  every controller request is checked locally, with conditions and
  graph traversal compiled to SQL.
- A separate decision service for the cross-service cases — your
  webhook handler or background job calls the decision service
  before performing actions on tenant data.

This roadmap doesn't preclude that shape. Theme 5 (decision logging)
and Theme 3 (webhook security) are designed so a future decision
service can plug in without re-engineering the in-process path.

## See also

- [Why nest-warden?](/docs/get-started/why/) — what the library is, what it adds on top of CASL, and what it isn't.
- [Roadmap](/docs/roadmap/things-to-do/) — what's queued for v1.0 and beyond.
- [Forward vs Reverse Lookups](/docs/core-concepts/forward-vs-reverse/) — the two query shapes nest-warden answers.
