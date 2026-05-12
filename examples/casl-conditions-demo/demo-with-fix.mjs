// Verifies the proposed strictOperators flag from
// https://github.com/stalniy/ucast/pull/84.
//
// It imports ObjectQueryParser DIRECTLY from a local checkout of the
// @ucast fork rather than the npm-published version, because the flag
// is only present on the unreleased branch. The fork is expected at
//   ../../../ucast (relative to this file)
// and must be built before running this script:
//   cd /path/to/ucast && pnpm install && pnpm -r build
//
// We then build a Mongo-flavoured parser the same way @ucast/mongo's
// MongoQueryParser builds itself ($eq default, $-prefix stripping),
// once with strictOperators ON and once with it OFF, and feed the same
// wrong-shape rules from demo.mjs through both.
//
// Run with:  pnpm install && node demo-with-fix.mjs

import { ObjectQueryParser } from '../../../ucast/packages/core/dist/esm/index.mjs';
import { allParsingInstructions } from '@ucast/mongo';

const baseOptions = {
  defaultOperatorName: '$eq',
  operatorToConditionName: (name) => name.slice(1), // $eq -> eq
};

const parserStrict = new ObjectQueryParser(allParsingInstructions, {
  ...baseOptions,
  strictOperators: true,
});

const parserDefault = new ObjectQueryParser(allParsingInstructions, baseOptions);

const run = (label, parser, query) => {
  try {
    parser.parse(query);
    console.log(`  ${label.padEnd(56)} | parsed without error`);
  } catch (err) {
    console.log(`  ${label.padEnd(56)} | THREW: ${err.message}`);
  }
};

// Cases 2 and 5 from demo.mjs — the realistic translator-typo / dialect
// mix-up shape (unknown operator key with an OBJECT right-hand-side).
// strictOperators should catch both of these.
const wrongShapeObjectRHS = [
  ['Case 2: { status: { equals: "x" } }', { status: { equals: 'published' } }],
  ['Case 5: { status: { $equals: "x" } }', { status: { $equals: 'published' } }],
];

// Case 3 from demo.mjs — top-level key with PRIMITIVE value. This shape
// is intentionally NOT caught by strictOperators because it collides
// with legitimate field-name shorthand (`{ name: 'alice' }`). Listed
// separately so the limitation is visible.
const wrongShapePrimitive = [
  ['Case 3: { equals: "...", value: "..." }', { equals: 'status', value: 'published' }],
];

const valid = [
  ['Valid:  { status: { $eq: "x" } }', { status: { $eq: 'published' } }],
  ['Valid:  { name: "alice" } (shorthand)', { name: 'alice' }],
  ['Valid:  { status: {} } (empty object)', { status: {} }],
  ['Valid:  { tags: ["a", "b"] } (array value)', { tags: ['a', 'b'] }],
  ['Valid:  { createdAt: <Date> }', { createdAt: new Date() }],
];

console.log('\n=== With strictOperators: true (proposed fix) ===\n');
console.log('  Wrong-shape, object RHS (should throw):');
for (const [label, query] of wrongShapeObjectRHS) run(label, parserStrict, query);
console.log('\n  Wrong-shape, primitive RHS (NOT caught — see note below):');
for (const [label, query] of wrongShapePrimitive) run(label, parserStrict, query);
console.log('\n  Valid inputs (should parse cleanly):');
for (const [label, query] of valid) run(label, parserStrict, query);

console.log('\n=== With strictOperators: false (current behaviour) ===\n');
console.log('  Wrong-shape, object RHS (silently accepted today):');
for (const [label, query] of wrongShapeObjectRHS) run(label, parserDefault, query);
console.log('\n  Wrong-shape, primitive RHS:');
for (const [label, query] of wrongShapePrimitive) run(label, parserDefault, query);
console.log('\n  Valid inputs:');
for (const [label, query] of valid) run(label, parserDefault, query);

console.log(
  '\nVerdict: strictOperators catches the realistic translator-typo /\n' +
  '         dialect-mix-up shape (unknown operator key with an OBJECT\n' +
  '         right-hand-side — Cases 2 and 5 from demo.mjs). Case 3\'s\n' +
  '         top-level primitive shape is intentionally NOT caught\n' +
  '         because it is indistinguishable from legitimate field-name\n' +
  '         shorthand at the parser level — for that failure mode, the\n' +
  '         consumer needs schema validation (e.g. zod) on the rule\n' +
  '         shape before it ever reaches the parser.\n'
);
