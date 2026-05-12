# CASL conditions silent-fallback demo

A minimal, runnable repro for a question I'm raising with the CASL
author (@stalniy):

> "Hand-rolled condition translators silently produce wrong-shape
>  rules when the developer types an unrecognised operator. CASL's
>  parser falls back to treating the unknown key as a field name.
>  The result is a rule that either never matches OR (in adapters
>  that drop unknown operators) matches every row — and no error
>  is raised at runtime."

## How to run

```bash
cd examples/casl-conditions-demo
pnpm install     # or: npm install
node demo.mjs
```

Tested against `@casl/ability@6.8.1` + `@casl/prisma@1.4.1` on
2026-05-11. Node 18+ is sufficient.

## What you'll see

`demo.mjs` walks seven cases against both `createMongoAbility` and
`createPrismaAbility`:

| # | Builder | Rule shape | Result | Threw? |
|---|---|---|---|---|
| 1 | Mongo | `{ status: { $eq: 'published' } }` | correct (published ✅, draft ❌) | — |
| 2 | Mongo | `{ status: { equals: 'published' } }` | published ❌, draft ❌ — **silent** | no |
| 3 | Mongo | `{ equals: 'status', value: 'published' }` | published ❌, draft ❌ — **silent** | no |
| 4 | Mongo | `{}` (translator error fallback) | published ✅, draft ✅ — **over-permissive** | no |
| 5 | Mongo | `{ status: { $equals: 'published' } }` | published ❌, draft ❌ — **silent** | no |
| 6 | Prisma | `{ status: { $eq: 'published' } }` (wrong dialect) | — | **YES (good)** |
| 7a | Mongo | `{ status: { $eq: { nested: 'obj' } } }` | published ❌ — **silent** | no |
| 7b | Prisma | `{ status: { equals: { nested: 'obj' } } }` | — | **YES (good)** |

The interesting comparison is Case 6/7b vs Case 7a:

- **Prisma's `equals` instruction has a `validate()` that rejects
  array/object values.** When the parser falls back to "field
  equals object", validation fires and throws `ParsingQueryError`.
  This is the behaviour I'd love to see consistently.

- **Mongo's `$eq` instruction is registered as just
  `{ type: 'field' }` with NO `validate()`** (see
  [`@ucast/mongo`'s `$eq`](https://github.com/stalniy/ucast/blob/master/packages/mongo/src/parsing-instructions.ts)).
  Passing an object as the right-hand side never triggers
  validation — the matcher quietly compares string-to-object and
  returns `false`.

So the unsafe path (silent false) is the Mongo default. The same
asymmetry repeats across most of `$ne`, `$in`, etc.

## What's happening in the parser

CASL's `ObjectQueryParser.parse` in
[`@ucast/core`](https://github.com/stalniy/ucast/blob/master/packages/core/src/parsers/ObjectQueryParser.ts)
applies, roughly:

```
for each key K in conditions:
  if K is a registered operator      -> parse as operator
  else if value(K) has a registered
        operator inside it           -> parse as field-with-operators
  else                                -> treat K as a field name,
                                          value(K) as the RHS of the
                                          default operator
                                          ($eq for Mongo, equals for Prisma)
```

The third branch is what I'm calling the silent fallback. An unknown
operator is indistinguishable to the parser from a poorly-named
field. There is no opt-in strict mode that errors when an unknown
operator is encountered.

## Why this matters (security)

Forward-check (`ability.can(subject)`) silently fails **closed** —
the rule returns `false` for everything. Authorization regresses to
"nobody can do this", which is annoying but visible: users open
tickets.

Reverse-lookup (`accessibleBy(ability, action, subject)`) is the
dangerous path. CASL itself does not generate the WHERE clause —
that's the adapter's job (`@casl/prisma`, `@casl/mongoose`, or a
consumer's hand-rolled translator). The CASL-shipped adapters tend
to throw on unknown shapes. But consumers building their own
SQL/TypeORM/Drizzle adapters — a common pattern because there is no
official `@casl/typeorm` — frequently drop unknown operators when
assembling the WHERE clause. In those adapters the rule's
conditions collapse to "no filter" and **every row** is returned.
That is a silent permission **escalation**: users see data they
shouldn't, and nobody opens a ticket because the UI looks fine.

This isn't hypothetical — hand-rolling a TypeORM adapter is the
exact situation that motivated [`nest-warden`](../../README.md)
to ship its own SQL compiler. The compiler refuses unknown
operators with `UnsupportedOperatorError` rather than passing them
through:

- [`src/core/errors.ts`](../../src/core/errors.ts) —
  `UnsupportedOperatorError` definition with the
  hand-rolled-translator failure mode documented inline.
- [`src/typeorm/compiler/operators.ts`](../../src/typeorm/compiler/operators.ts)
  — the allow-list that throws.
- [`examples/nestjs-app`](../nestjs-app) — the full E2E example
  that exercises the compiler end-to-end against real Postgres.

We catch the bug at boot / test time, not as a silent leak in
production.

## The question

Would CASL be open to an **opt-in strict parsing mode** on
`ObjectQueryParser` that throws `ParsingQueryError` on unknown
operator keys at the moment the conditions are first walked
(rule-build / first-can), instead of silently reinterpreting them
as field names?

The trade-off:

- **Pro:** translator bugs (typos, dialect mix-ups, hand-rolled
  emitters) surface at the same moment the misconfigured rule is
  declared, not as silent regressions / escalations in production.
- **Con:** legacy codebases that intentionally use unusual field
  names colliding with operator names of other dialects would
  have to opt out.

The opt-in nature keeps current behaviour as the default — no
breaking change for the ecosystem.

Happy to draft a PR against `@ucast/core` if the design direction
seems reasonable. The simplest sketch would be a constructor option
on `ObjectQueryParser`:

```ts
new ObjectQueryParser(instructions, {
  defaultOperatorName: '$eq',
  strictOperators: true,   // <-- new; throws on unknown operator keys
});
```

…wired down to the existing `parse` loop so the silent-fallback
branch becomes an explicit error path when the flag is on.
