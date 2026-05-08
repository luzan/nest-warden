import type { RelatedToCondition } from '../../core/relationships/definition.js';
import {
  type CustomResolver,
  type ForeignKeyResolver,
  type JoinTableResolver,
} from '../../core/relationships/resolver.js';
import type { Relationship, RelationshipPath } from '../../core/relationships/definition.js';
import type { CompileContext } from './ast-walker.js';
import { compileFieldOperator } from './operators.js';
import { fragment, type SqlFragment } from './sql-fragment.js';

/**
 * Compile a `$relatedTo` operator into an `EXISTS (SELECT 1 ...)` SQL
 * fragment that joins the relationship path and applies the leaf `where`.
 *
 * Algorithm:
 *
 *   1. Resolve the path of relationships from `condition.path`.
 *   2. Build the EXISTS subquery from the first hop forward:
 *      - The FIRST hop generates `FROM <table> <alias>` PLUS a WHERE
 *        conjunct correlating with the outer alias. CORRELATION HAPPENS
 *        IN WHERE, NOT JOIN — the outer alias is not a table inside the
 *        subquery and trying to JOIN to it raises
 *        `relation "<alias>" does not exist` at runtime.
 *      - Subsequent hops are emitted as INNER JOINs against the
 *        previous hop's `to`-side alias.
 *   3. Append the leaf `where` filter as additional WHERE conjuncts.
 *
 * The original implementation tried to JOIN every hop including the
 * first; see `examples/nestjs-app/FINDINGS.md` § 5 for the full
 * symptom-and-fix story.
 *
 * Phase 3 v1 supports `foreign-key` and `join-table` resolvers natively;
 * `custom` resolvers embed consumer-provided SQL.
 */
export function compileRelatedTo(condition: RelatedToCondition, ctx: CompileContext): SqlFragment {
  /* c8 ignore next 3 */
  // Defensive: ast-walker checks for the graph before dispatching here.
  if (!ctx.graph) throw new Error('compileRelatedTo invoked without a graph in context.');
  const path = ctx.graph.resolvePath(condition.path);
  /* c8 ignore next 3 */
  // Defensive: graph.resolvePath() rejects empty paths.
  if (path.hops.length === 0) throw new Error('compileRelatedTo: empty path.');

  const aliasGen = makeAliasGenerator(`${ctx.alias}_rt`);
  const allParams: Record<string, unknown> = {};

  // Walk hops in order, assigning aliases. The FIRST hop's alias is also
  // where the outer-alias correlation lands.
  const hopAliases: string[] = [];
  for (let i = 0; i < path.hops.length; i++) {
    hopAliases.push(aliasGen());
  }

  // Build the FROM ... JOIN ... chain. Strategy:
  //   - The FIRST hop's table is the FROM target.
  //   - Each subsequent hop is INNER JOIN'd to the previous hop's `to` side.
  //   - The first hop carries an additional WHERE clause that correlates
  //     with the outer alias via the FK or join-table column.
  const fromAndJoins: string[] = [];
  const correlations: string[] = [];

  let prevAlias: string | null = null;
  let prevToColumn = 'id';

  for (let i = 0; i < path.hops.length; i++) {
    const hop = path.hops[i] as Relationship;
    const isFirst = i === 0;
    const myAlias = hopAliases[i] as string;
    const segment = buildHopSegment(
      hop,
      myAlias,
      isFirst ? ctx.alias : (prevAlias as string),
      isFirst,
      prevToColumn,
      aliasGen,
      ctx,
      allParams,
    );
    if (isFirst) {
      fromAndJoins.push(segment.fromClause);
      if (segment.outerCorrelation) correlations.push(segment.outerCorrelation);
    } else {
      fromAndJoins.push(segment.joinClause);
    }
    prevAlias = segment.toAlias;
    prevToColumn = segment.toPrimaryKey;
  }

  // Apply the leaf where filter to the final hop's alias.
  const finalAlias = prevAlias as string;
  const leafFragment = compileLeafWhere(condition.where, finalAlias, ctx);
  Object.assign(allParams, leafFragment.params);

  const whereParts = [...correlations];
  if (leafFragment.sql.length > 0) whereParts.push(leafFragment.sql);
  const wherePart = whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : '';

  const existsSql = `EXISTS (SELECT 1 ${fromAndJoins.join(' ')}${wherePart})`;
  return fragment(existsSql, allParams);
}

interface HopSegment {
  /** SQL emitted for the first hop: `FROM <table> <alias>`. */
  readonly fromClause: string;
  /** SQL emitted for subsequent hops: `INNER JOIN <table> <alias> ON ...`. */
  readonly joinClause: string;
  /** WHERE conjunct correlating the first hop with the outer alias. */
  readonly outerCorrelation?: string;
  readonly toAlias: string;
  readonly toPrimaryKey: string;
}

function buildHopSegment(
  hop: Relationship,
  myAlias: string,
  prevAlias: string,
  isFirst: boolean,
  prevToColumn: string,
  aliasGen: () => string,
  ctx: CompileContext,
  paramSink: Record<string, unknown>,
): HopSegment {
  const resolver = hop.resolver;

  if (resolver.kind === 'foreign-key') {
    return buildForeignKeyHop(hop, resolver, myAlias, prevAlias, isFirst);
  }
  if (resolver.kind === 'join-table') {
    return buildJoinTableHop(hop, resolver, myAlias, prevAlias, isFirst, aliasGen);
  }
  return buildCustomHop(hop, resolver, myAlias, prevAlias, isFirst, ctx, paramSink, prevToColumn);
}

function buildForeignKeyHop(
  hop: Relationship,
  resolver: ForeignKeyResolver,
  myAlias: string,
  prevAlias: string,
  isFirst: boolean,
): HopSegment {
  const toTable = resolver.toTable ?? tableForSubject(hop.to);
  /* c8 ignore next */
  const toColumn = resolver.toColumn ?? 'id';

  if (isFirst) {
    // First hop: correlate with the outer alias via WHERE.
    return {
      fromClause: `FROM ${toTable} ${myAlias}`,
      joinClause: '',
      outerCorrelation: `${prevAlias}.${resolver.fromColumn} = ${myAlias}.${toColumn}`,
      toAlias: myAlias,
      toPrimaryKey: toColumn,
    };
  }
  // Subsequent hop: INNER JOIN against the previous alias inside the subquery.
  return {
    fromClause: '',
    joinClause: `INNER JOIN ${toTable} ${myAlias} ON ${prevAlias}.${resolver.fromColumn} = ${myAlias}.${toColumn}`,
    toAlias: myAlias,
    toPrimaryKey: toColumn,
  };
}

function buildJoinTableHop(
  hop: Relationship,
  resolver: JoinTableResolver,
  myAlias: string,
  prevAlias: string,
  isFirst: boolean,
  aliasGen: () => string,
): HopSegment {
  const toTable = tableForSubject(hop.to);
  /* c8 ignore next 2 */
  const toPk = resolver.toPrimaryKey ?? 'id';
  const fromPk = resolver.fromPrimaryKey ?? 'id';
  const junctionAlias = aliasGen();

  if (isFirst) {
    // First hop: junction table FROM, with correlation to outer alias.
    // Layout: FROM junction j INNER JOIN to t ON j.toKey = t.toPk
    //         WHERE j.fromKey = <outer>.fromPk
    return {
      fromClause:
        `FROM ${resolver.table} ${junctionAlias} ` +
        `INNER JOIN ${toTable} ${myAlias} ON ${junctionAlias}.${resolver.toKey} = ${myAlias}.${toPk}`,
      joinClause: '',
      outerCorrelation: `${junctionAlias}.${resolver.fromKey} = ${prevAlias}.${fromPk}`,
      toAlias: myAlias,
      toPrimaryKey: toPk,
    };
  }
  return {
    fromClause: '',
    joinClause:
      `INNER JOIN ${resolver.table} ${junctionAlias} ON ${junctionAlias}.${resolver.fromKey} = ${prevAlias}.${fromPk} ` +
      `INNER JOIN ${toTable} ${myAlias} ON ${junctionAlias}.${resolver.toKey} = ${myAlias}.${toPk}`,
    toAlias: myAlias,
    toPrimaryKey: toPk,
  };
}

function buildCustomHop(
  _hop: Relationship,
  resolver: CustomResolver,
  myAlias: string,
  prevAlias: string,
  isFirst: boolean,
  ctx: CompileContext,
  paramSink: Record<string, unknown>,
  prevColumn: string,
): HopSegment {
  let expanded = resolver.sql
    .replace(/\{from_alias\}/g, prevAlias)
    .replace(/\{from_column\}/g, prevColumn)
    .replace(/\{to_alias\}/g, myAlias);

  // Bind consumer-supplied params into the bag.
  const params = resolver.params ?? {};
  for (const [key, value] of Object.entries(params)) {
    const { placeholder, name } = ctx.bag.allocate(value);
    const re = new RegExp(`\\{:${escapeRegex(key)}\\}`, 'g');
    expanded = expanded.replace(re, placeholder);
    paramSink[name] = value;
  }

  return {
    fromClause: isFirst ? expanded : '',
    joinClause: isFirst ? '' : expanded,
    toAlias: myAlias,
    toPrimaryKey: 'id',
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile the leaf `where` filter into a fragment qualified by `alias`.
 * Reuses the same operator compiler used at the top level — supports
 * scalar equality, $eq/$ne/$in/etc. Nested $relatedTo is NOT supported
 * inside a leaf where (would be unusual; document and reject early).
 */
function compileLeafWhere(
  where: Record<string, unknown>,
  alias: string,
  ctx: CompileContext,
): SqlFragment {
  const fragments: SqlFragment[] = [];

  for (const [field, value] of Object.entries(where)) {
    if (field.startsWith('$')) {
      throw new Error(
        `Top-level operator "${field}" is not allowed inside a $relatedTo.where filter; ` +
          `use field-level operators (e.g., { id: { $in: [...] } }) instead.`,
      );
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Operator form: { id: { $eq: 'x' } }
      for (const [opKey, opValue] of Object.entries(value as Record<string, unknown>)) {
        const op = opKey.startsWith('$') ? opKey.slice(1) : opKey;
        const frag = compileFieldOperator(`${alias}.${field}`, op, opValue, ctx.bag);
        fragments.push(frag);
      }
    } else {
      // Scalar — equivalent to $eq.
      const frag = compileFieldOperator(`${alias}.${field}`, 'eq', value, ctx.bag);
      fragments.push(frag);
    }
  }

  if (fragments.length === 0) return fragment('');
  if (fragments.length === 1) return fragments[0] as SqlFragment;
  const merged: Record<string, unknown> = {};
  for (const f of fragments) Object.assign(merged, f.params);
  return fragment(fragments.map((f) => `(${f.sql})`).join(' AND '), merged);
}

/**
 * Map a subject type name to its underlying SQL table. v1 uses a simple
 * snake_case + pluralization rule; consumers can override by passing
 * explicit `fromTable`/`toTable` on the resolver.
 *
 * `Merchant` → `merchants`, `Agent` → `agents`, `OrgUnit` → `org_units`.
 */
function tableForSubject(subject: string): string {
  const snake = subject.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  if (snake.endsWith('s')) return snake;
  if (snake.endsWith('y')) return `${snake.slice(0, -1)}ies`;
  return `${snake}s`;
}

function makeAliasGenerator(prefix: string): () => string {
  let counter = 0;
  return () => `${prefix}_${String(counter++)}`;
}

export type { RelationshipPath };
