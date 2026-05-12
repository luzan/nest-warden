// Repro for the question raised in conversation with @stalniy.
//
// Claim: hand-rolled condition translators silently produce wrong-shape
// rules when the developer types an unrecognised operator. CASL's
// parser falls back to treating the unknown key as a field name. The
// rule either never matches (forward check fails closed) OR — in
// adapters that drop unknown operators when assembling a WHERE clause
// — matches every row (reverse lookup fails open). In both Mongo and
// Prisma builders, several cases produce NO error at runtime.
//
// Run with:  pnpm install && node demo.mjs   (or npm i && node demo.mjs)
//
// All assertions below were verified against @casl/ability 6.8.1
// and @casl/prisma 1.4.1 on 2026-05-11.

import { createMongoAbility, AbilityBuilder } from '@casl/ability';
import { createPrismaAbility } from '@casl/prisma';

const header = (title) => console.log(`\n=== ${title} ===`);

const publishedDoc = { __caslSubjectType__: 'Document', status: 'published' };
const draftDoc = { __caslSubjectType__: 'Document', status: 'draft' };

const safe = (label, fn) => {
  try {
    fn();
  } catch (e) {
    console.log(`  ${label} THREW: ${e.name}: ${e.message}`);
  }
};

// ---------------------------------------------------------------------
// Case 1 — Baseline: correctly-spelled Mongo operator.
// ---------------------------------------------------------------------
header('Case 1: Mongo, correct ($eq) — baseline');
{
  const { can, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Document', { status: { $eq: 'published' } });
  const ability = build();
  console.log('  published doc =>', ability.can('read', publishedDoc));
  console.log('  draft doc     =>', ability.can('read', draftDoc));
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
}

// ---------------------------------------------------------------------
// Case 2 — The exact scenario from the question.
//
// A consumer writes a translator that emits Prisma-style `equals`
// instead of Mongo-style `$eq`. CASL does NOT throw. The parser sees:
//   - `status` -> not a known operator, treat as field name
//   - `{ equals: 'published' }` -> hasOperators() returns false because
//     `equals` is not a $-prefixed Mongo operator
//   - Falls back to default operator: status $eq { equals: 'published' }
//   - The Mongo matcher compares the STRING 'published' to the OBJECT
//     `{ equals: 'published' }` -> always false
//
// Net effect: silent permission regression. No exception, no warning,
// no log line.
// ---------------------------------------------------------------------
header('Case 2: Mongo, { equals: value } instead of { $eq: value }');
safe('case 2', () => {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Document', { status: { equals: 'published' } });
  const ability = build();
  console.log('  published doc =>', ability.can('read', publishedDoc));
  console.log('  draft doc     =>', ability.can('read', draftDoc));
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
});

// ---------------------------------------------------------------------
// Case 3 — Translator drops the field nesting entirely.
//
// A common bug in hand-rolled translators that forget to wrap the
// operator under a field key. CASL parses `equals` and `value` as
// field names of the subject. No real Document has those columns,
// so the rule never matches. Again — no error.
// ---------------------------------------------------------------------
header('Case 3: Mongo, top-level { equals: ..., value: ... } (no field nesting)');
safe('case 3', () => {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Document', { equals: 'status', value: 'published' });
  const ability = build();
  console.log('  published doc =>', ability.can('read', publishedDoc));
  console.log('  draft doc     =>', ability.can('read', draftDoc));
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
});

// ---------------------------------------------------------------------
// Case 4 — Translator's error path returns `{}`.
//
// This is the failure mode that DOES "match everything". If the
// translator catches a parse error and returns empty conditions,
// CASL treats the rule as unconditional. Every Document is now
// readable, including drafts the user should not see.
// ---------------------------------------------------------------------
header('Case 4: Mongo, translator error path returns {} (silent over-permissive)');
safe('case 4', () => {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Document', {});
  const ability = build();
  console.log('  published doc =>', ability.can('read', publishedDoc));
  console.log('  draft doc     =>', ability.can('read', draftDoc));
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
});

// ---------------------------------------------------------------------
// Case 5 — Unknown $-prefixed operator.
//
// Even with the conventional `$` prefix, an unknown operator
// (e.g., $equals, a plausible typo of $eq) does NOT throw. It
// follows the same silent-fallback path as Case 2 and never matches.
// ---------------------------------------------------------------------
header('Case 5: Mongo, unknown $-prefixed operator ($equals)');
safe('case 5', () => {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Document', { status: { $equals: 'published' } });
  const ability = build();
  console.log('  published doc =>', ability.can('read', publishedDoc));
  console.log('  draft doc     =>', ability.can('read', draftDoc));
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
});

// ---------------------------------------------------------------------
// Case 6 — Mongo-shaped rule on Prisma ability.
//
// A team uses createPrismaAbility everywhere. A dev copies a rule
// from a Mongo example: `{ status: { $eq: 'published' } }`.
//
// Surprise (the GOOD kind): Prisma's `equals` instruction has a
// validate() that rejects objects, so when the parser falls back to
// "status equals { $eq: 'published' }" it throws ParsingQueryError.
// This is exactly the behaviour I'd like to see consistently.
// ---------------------------------------------------------------------
header('Case 6: Prisma ability + Mongo-shaped rule — DOES throw');
safe('case 6', () => {
  const { can, build } = new AbilityBuilder(createPrismaAbility);
  can('read', 'Document', { status: { $eq: 'published' } });
  const ability = build();
  console.log('  published doc =>', ability.can('read', publishedDoc));
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
});

// ---------------------------------------------------------------------
// Case 7 — The asymmetry that matters.
//
// The Mongo $eq instruction is registered as just `b={type:"field"}`
// with NO validate() function (see @ucast/mongo source). So when the
// parser falls back to "status $eq { equals: 'published' }" — passing
// an OBJECT as the right-hand side of $eq — no validation fires.
// The matcher silently compares string-to-object and returns false.
//
// Prisma's `equals` happens to have a validate() that catches this
// shape. Mongo's `$eq` does not. The behaviour is inconsistent across
// operators AND across builders, and the unsafe direction (silent
// false) is the Mongo default.
// ---------------------------------------------------------------------
header('Case 7: Mongo $eq vs Prisma equals — validation asymmetry');
safe('case 7a (Mongo $eq with object value, silent)', () => {
  const { can, build } = new AbilityBuilder(createMongoAbility);
  can('read', 'Document', { status: { $eq: { nested: 'object' } } });
  const ability = build();
  console.log('  Mongo $eq w/ object RHS:', ability.can('read', publishedDoc), '(no throw)');
  console.log('  rule.conditions:', JSON.stringify(ability.rules[0].conditions));
});
safe('case 7b (Prisma equals with object value, throws)', () => {
  const { can, build } = new AbilityBuilder(createPrismaAbility);
  can('read', 'Document', { status: { equals: { nested: 'object' } } });
  const ability = build();
  console.log('  Prisma equals w/ object RHS:', ability.can('read', publishedDoc));
});

// ---------------------------------------------------------------------
// Summary
//
// Cases 2, 3, 4, 5, 7a all produce a rule that compiles and runs
// without any runtime signal that the authorization rule is broken.
// Case 6 and 7b are the ones we'd like to be the rule (pun intended)
// rather than the exception.
//
// Forward-check (ability.can) fails CLOSED in cases 2, 3, 5, 7a
// — returns false even when the developer meant to allow.
//
// Case 4 fails OPEN — returns true for every subject.
//
// Reverse-lookup (accessibleBy) routes through an adapter. The
// CASL-shipped adapters (@casl/prisma, @casl/mongoose) pass the AST
// through their own translators which often catch shape errors —
// good. But consumers building their own SQL/TypeORM/Drizzle
// adapters (a common pattern; there is no official @casl/typeorm)
// frequently drop unknown operators when assembling a WHERE clause.
// In those adapters the rule's conditions collapse to "no filter"
// and every row is returned. That is a silent permission
// escalation.
//
// Question for the CASL author:
//
//   Would CASL be open to an opt-in "strict" parsing mode on
//   ObjectQueryParser that throws ParsingQueryError on unknown
//   operator keys at the time the conditions are first walked
//   (rule-build / first-can), instead of silently reinterpreting
//   them as field names?
//
//   Trade-off:
//     - Pro: translator bugs (typos, dialect mix-ups, hand-rolled
//       emitters) surface at the same moment the misconfigured rule
//       is declared, instead of as silent regressions / escalations
//       in production.
//     - Con: legacy codebases that intentionally use unusual field
//       names that happen to collide with operator names of other
//       dialects would have to opt out.
//
//   The opt-in nature keeps current behaviour the default — no
//   breaking change for the ecosystem.
//
// I'm happy to draft a PR if the design direction makes sense.
// ---------------------------------------------------------------------
