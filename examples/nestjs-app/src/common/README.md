# `common/` — cross-cutting application-level utilities

Application-level (not library-level) helpers shared between feature
modules. The pieces here demonstrate how to compose nest-warden's
primitives in a real codebase without forking the library.

| File | Purpose |
|------|---------|
| `dto/pagination-query.dto.ts` | Shared `?limit` / `?offset` parsing with sane clamps. Used by both `/merchants` and `/payments` so the two endpoints behave identically. |
| `decorators/any-of.decorator.ts` | Disjunction (`OR`) composition over `@CheckPolicies`. Wraps the library's AND-by-default semantics into a single handler. |

These patterns are **example app code, not library API.** If you build
a similar utility in your own codebase, copy the file rather than
importing — the contract here is the demonstration, not a published
surface.
